import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { CountLineDto, CreateCountDto, CreateMovementDto, InventoryCategoryDto, ItemDto, PriceListDto, TransferDto, WarehouseDto } from './inventory.dto';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { InventoryMovementService } from './inventory-movement.service';

@ApiTags('Inventory') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('inventory')
export class InventoryController {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService, private movementService: InventoryMovementService) {}

  private sign = (t: string) => ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'].includes(t) ? 1 : -1;
  private onHandOf = (m: any[]) => m.reduce((s, x) => s + this.sign(x.type) * Number(x.quantity), 0);
  // Chronological weighted-average cost (uses stored unitCost on receipt of stock).
  private wac(movements: any[]): { onHand: number; avgCost: number; value: number } {
    let qty = 0, value = 0;
    const sorted = [...movements].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    for (const m of sorted) {
      const q = Number(m.quantity || 0);
      const isIn = ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'].includes(m.type);
      if (isIn) { qty += q; value += q * Number(m.unitCost || 0); }
      else { const avg = qty > 0 ? value / qty : 0; const out = Math.min(q, qty); value -= out * avg; qty -= out; }
    }
    const avgCost = qty > 0.0001 ? value / qty : 0;
    return { onHand: qty, avgCost: Number(avgCost.toFixed(2)), value: Number(value.toFixed(2)) };
  }
  private async itemBalance(companyId: string, itemId: string, warehouseId?: string) {
    const where: any = { itemId };
    const wh = warehouseId ? await this.prisma.warehouse.findFirst({ where: { id: warehouseId, companyId } }) : null;
    if (wh) where.warehouseId = wh.id;
    const movements = await this.prisma.stockMovement.findMany({ where });
    const onHand = Number(movements.reduce((s, m) => s + (Number((m as any).signedQuantity) || this.sign(m.type) * Number(m.quantity)), 0).toFixed(4));
    const reservedAgg = await this.prisma.stockReservation.aggregate({ where: { itemId, status: 'ACTIVE', ...(wh ? { OR: [{ warehouseId: wh.id }, { warehouseId: null }] } : {}) }, _sum: { qty: true } });
    const reserved = Number((reservedAgg._sum.qty || 0).toFixed(4));
    const avg = this.wac(movements);
    return { onHand, reserved, available: Number((onHand - reserved).toFixed(4)), avgCost: avg.avgCost, value: avg.value };
  }

  // ----- Inventory categories -----
  private async ensureDefaultCategories(companyId: string) {
    const count = await this.prisma.inventoryCategory.count({ where: { companyId } });
    if (count) return;
    const names = ['Networking Equipment', 'CCTV', 'Computers', 'Accessories', 'Consumables', 'Software', 'Services', 'Uncategorised'];
    await this.prisma.inventoryCategory.createMany({ data: names.map((name) => ({ companyId, name, active: true })) });
  }
  @Get('categories') async categories(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    await this.ensureDefaultCategories(companyId);
    return this.prisma.inventoryCategory.findMany({ where: { companyId }, include: { _count: { select: { items: true } } }, orderBy: [{ name: 'asc' }] });
  }
  @Post('categories') async createCategory(@Req() req: any, @Body() dto: InventoryCategoryDto) {
    const companyId = companyIdOf(req.user);
    if (dto.code) {
      const dup = await this.prisma.inventoryCategory.findFirst({ where: { companyId, code: dto.code } });
      if (dup) throw new BadRequestException('Category code already exists');
    }
    const cat = await this.prisma.inventoryCategory.create({ data: { companyId, name: dto.name, code: dto.code, parentId: dto.parentId, description: dto.description, active: dto.active ?? true, incomeAccountId: dto.incomeAccountId, cogsAccountId: dto.cogsAccountId, inventoryAssetAccountId: dto.inventoryAssetAccountId, expenseAccountId: dto.expenseAccountId, salesTaxCode: dto.salesTaxCode, purchaseTaxCode: dto.purchaseTaxCode } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'InventoryCategory', cat.id, { name: dto.name });
    return cat;
  }
  @Patch('categories/:id') async updateCategory(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<InventoryCategoryDto>) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.inventoryCategory.findFirst({ where: { id, companyId }, include: { _count: { select: { items: true } } } });
    if (!existing) throw new BadRequestException('Category not found');
    // Reassignment / deactivation support
    if (dto.active === false && existing._count.items > 0) {
      const moveTo = dto.parentId;
      if (moveTo) await this.prisma.inventoryItem.updateMany({ where: { categoryId: id, companyId }, data: { categoryId: moveTo } });
      else throw new BadRequestException('This category has items. Provide a reassignment target (parentId) before deactivating.');
    }
    const data: any = { ...dto };
    if (dto.parentId === '') data.parentId = null;
    return this.prisma.inventoryCategory.updateMany({ where: { id, companyId }, data });
  }
  @Delete('categories/:id') async deleteCategory(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const cat = await this.prisma.inventoryCategory.findFirst({ where: { id, companyId }, include: { _count: { select: { items: true, children: true } } } });
    if (!cat) throw new BadRequestException('Category not found');
    if (cat._count.items || cat._count.children) throw new BadRequestException('This category has items or subcategories and cannot be deleted. Deactivate it instead.');
    await this.prisma.inventoryCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ----- Item sales performance helper -----
  private async itemSales(companyId: string, itemIds: string[], days = 30) {
    const since = new Date(Date.now() - days * 86400000);
    const lines = await this.prisma.salesInvoiceLine.findMany({ where: { itemId: { in: itemIds }, invoice: { companyId, status: 'POSTED', invoiceDate: { gte: since } } }, select: { itemId: true, quantity: true, lineTotal: true } });
    const lastSales = await this.prisma.salesInvoiceLine.findMany({ where: { itemId: { in: itemIds }, invoice: { companyId, status: 'POSTED' } }, select: { itemId: true, invoice: { select: { invoiceDate: true } } }, orderBy: { invoice: { invoiceDate: 'desc' } } });
    const map: Record<string, any> = {};
    for (const id of itemIds) map[id] = { qty: 0, net: 0, lastSale: null };
    for (const l of lines) if (l.itemId && map[l.itemId]) { map[l.itemId].qty += Number(l.quantity); map[l.itemId].net += Number(l.lineTotal); }
    for (const s of lastSales) if (s.itemId && map[s.itemId] && !map[s.itemId].lastSale) map[s.itemId].lastSale = s.invoice.invoiceDate;
    for (const k of Object.keys(map)) map[k].net = Number(map[k].net.toFixed(2));
    return map;
  }
  private classifyPerf(qty: number, onHand: number, createdAt: any, lastSale: any) {
    if (qty >= 10) return 'BEST_SELLER';
    if (qty > 0) return 'SELLING';
    if (onHand > 0) return 'SLOW_MOVING';
    if (createdAt && new Date(createdAt) > new Date(Date.now() - 14 * 86400000)) return 'NEW';
    return lastSale ? 'SLOW_MOVING' : 'NO_SALES';
  }
  private sortItems(rows: any[], sortBy: string, dir: 'asc' | 'desc') {
    const mult = dir === 'desc' ? -1 : 1;
    const keyFor: Record<string, (r: any) => any> = { sku: (r) => r.sku, name: (r) => r.name, type: (r) => r.type, sellingPrice: (r) => Number(r.sellingPrice), onHand: (r) => r.onHand, available: (r) => r.available, value: (r) => r.value, avgCost: (r) => r.avgCost, qtySold: (r) => r.qtySold, net: (r) => r.net, performance: (r) => r.performance, createdAt: (r) => new Date(r.createdAt || 0).getTime() };
    const fn = keyFor[sortBy] || keyFor.name;
    rows.sort((a, b) => { const va = fn(a), vb = fn(b); if (va === vb) return 0; return (va > vb ? 1 : -1) * mult; });
    return rows;
  }
  @Get('items') async items(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId };
    if (q.q) where.OR = [{ sku: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }, { barcode: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }, { hsCode: { contains: q.q, mode: 'insensitive' } }];
    if (q.type) where.type = q.type;
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.active !== undefined) where.active = q.active === 'true' || q.active === true;
    if (q.createdFrom || q.createdTo) where.createdAt = { ...(q.createdFrom ? { gte: new Date(q.createdFrom) } : {}), ...(q.createdTo ? { lte: new Date(q.createdTo) } : {}) };
    const items = await this.prisma.inventoryItem.findMany({ where });
    const ids = items.map((i: any) => i.id);
    const perf = await this.itemSales(companyId, ids, Number(q.performanceDays) || 30);
    const warehouses = await this.prisma.warehouse.findMany({ where: { companyId } });
    const openPOs = await this.prisma.purchaseOrderLine.findMany({ where: { purchaseOrder: { companyId, status: { in: ['APPROVED', 'PART_RECEIVED'] } } } });
    const rows: any[] = [];
    for (const i of items) {
      const b = await this.itemBalance(companyId, i.id);
      const s = perf[i.id] || { qty: 0, net: 0, lastSale: null };
      const performance = i.type === 'SERVICE' ? 'SERVICE' : this.classifyPerf(Number(s.qty), b.onHand, i.createdAt, s.lastSale);
      const incoming = openPOs.filter((p) => p.itemId === i.id).reduce((sum, p) => sum + Math.max(0, Number(p.quantity) - Number(p.receivedQty)), 0);
      rows.push({ ...i, movements: undefined, onHand: b.onHand, reserved: b.reserved, available: b.available, avgCost: b.avgCost, value: b.value, qtySold: Number(s.qty.toFixed(2)), net: Number(s.net.toFixed(2)), lastSale: s.lastSale, performance, incoming, warehouses: warehouses.length });
    }
    let filtered = rows;
    if (q.performance && q.performance !== 'ALL') filtered = rows.filter((r) => r.performance === q.performance);
    filtered = this.sortItems(filtered, q.sortBy || 'createdAt', q.sortDirection === 'asc' ? 'asc' : 'desc');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.max(1, Number(q.pageSize) || 25);
    return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
  }
  @Post('items') async createItem(@Req() req: any, @Body() dto: ItemDto) {
    const companyId = companyIdOf(req.user);
    const sku = dto.sku || await this.numbering.next(companyId, 'SKU');
    let cat: any = null;
    if (dto.categoryId) cat = await this.prisma.inventoryCategory.findFirst({ where: { id: dto.categoryId, companyId } });
    const item = await this.prisma.inventoryItem.create({ data: { companyId, sku, name: dto.name, unit: dto.unit || 'EA', hsCode: dto.hsCode, barcode: dto.barcode, brand: dto.brand, description: dto.description, salesDescription: dto.salesDescription, purchaseDescription: dto.purchaseDescription, type: dto.type || 'INVENTORY', itemCategory: dto.itemCategory, categoryId: cat?.id, imageUrl: dto.imageUrl, reorderLevel: dto.reorderLevel ?? 0, reorderQuantity: dto.reorderQuantity ?? 0, safetyStock: dto.safetyStock ?? 0, sellingPrice: dto.sellingPrice ?? 0, minSellingPrice: dto.minSellingPrice, purchaseCost: dto.purchaseCost ?? 0, costingMethod: dto.costingMethod, trackBatch: dto.trackBatch ?? false, trackSerial: dto.trackSerial ?? false, trackExpiry: dto.trackExpiry ?? false, salesTaxCode: dto.salesTaxCode ?? cat?.salesTaxCode, purchaseTaxCode: dto.purchaseTaxCode ?? cat?.purchaseTaxCode, incomeAccountId: dto.incomeAccountId ?? cat?.incomeAccountId, cogsAccountId: dto.cogsAccountId ?? cat?.cogsAccountId, inventoryAssetAccountId: dto.inventoryAssetAccountId ?? cat?.inventoryAssetAccountId, expenseAccountId: dto.expenseAccountId ?? cat?.expenseAccountId, adjustmentAccountId: dto.adjustmentAccountId, defaultWarehouseId: dto.defaultWarehouseId, preferredSupplierId: dto.preferredSupplierId, supplierSku: dto.supplierSku, leadTimeDays: dto.leadTimeDays, allowDiscount: dto.allowDiscount ?? true, active: dto.active ?? true } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'InventoryItem', item.id, { sku });
    return item;
  }
  @Patch('items/:id') async updateItem(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<ItemDto>) {
    const existing = await this.prisma.inventoryItem.findFirst({ where: { id, companyId: companyIdOf(req.user) } });
    const data: any = { ...dto };
    const res = await this.prisma.inventoryItem.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
    if (existing && dto.sellingPrice !== undefined && Number(dto.sellingPrice) !== Number(existing.sellingPrice)) await this.audit.log(companyIdOf(req.user), req.user.sub, 'PRICE_CHANGED', 'InventoryItem', id, { from: Number(existing.sellingPrice), to: Number(dto.sellingPrice) });
    if (existing && dto.purchaseCost !== undefined && Number(dto.purchaseCost) !== Number(existing.purchaseCost)) await this.audit.log(companyIdOf(req.user), req.user.sub, 'PURCHASE_COST_CHANGED', 'InventoryItem', id, { from: Number(existing.purchaseCost), to: Number(dto.purchaseCost) });
    return res;
  }
  @Delete('items/:id') async deleteItem(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, companyId }, include: { _count: { select: { movements: true } } } });
    if (item && item._count.movements) throw new BadRequestException('This item has stock movement history and cannot be deleted. Deactivate it instead.');
    await this.prisma.inventoryItem.deleteMany({ where: { id, companyId } });
    return { ok: true };
  }

  // ----- Item detail 360 -----
  @Get('items/:id') async itemDetail(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, companyId } });
    if (!item) throw new BadRequestException('Item not found');
    const [movements, warehouses, priceListItems, reservations] = await Promise.all([
      this.prisma.stockMovement.findMany({ where: { itemId: id, warehouse: { companyId } }, include: { warehouse: { include: { branch: true } } }, orderBy: { occurredAt: 'desc' } }),
      this.prisma.warehouse.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
      this.prisma.priceListItem.findMany({ where: { itemId: id }, include: { priceList: true } }),
      this.prisma.stockReservation.findMany({ where: { itemId: id, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const stock = [];
    for (const w of warehouses) { const b = await this.itemBalance(companyId, id, w.id); stock.push({ warehouseId: w.id, warehouse: w.name, onHand: b.onHand, reserved: b.reserved, available: b.available, unitCost: b.avgCost, value: b.value }); }
    const total = await this.itemBalance(companyId, id);
    return { item, stock, total, movements, priceListItems, reservations };
  }

  // ----- Warehouses -----
  @Get('warehouses') warehouses(@Req() req: any) { return this.prisma.warehouse.findMany({ where: { companyId: companyIdOf(req.user) }, include: { branch: true } }); }
  @Post('warehouses') async createWarehouse(@Req() req: any, @Body() dto: WarehouseDto) {
    const companyId = companyIdOf(req.user);
    const code = dto.code || await this.numbering.next(companyId, 'WH');
    const w = await this.prisma.warehouse.create({ data: { companyId, branchId: dto.branchId, code, name: dto.name } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Warehouse', w.id, { code });
    return w;
  }
  @Patch('warehouses/:id') updateWarehouse(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<WarehouseDto>) {
    return this.prisma.warehouse.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: dto });
  }
  @Delete('warehouses/:id') async deleteWarehouse(@Req() req: any, @Param('id') id: string) {
    await this.prisma.warehouse.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Stock -----
  @Get('stock') async stock(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } });
    const warehouses = await this.prisma.warehouse.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
    const openPOs = await this.prisma.purchaseOrderLine.findMany({ where: { purchaseOrder: { companyId, status: { in: ['APPROVED', 'PART_RECEIVED'] } } }, include: { purchaseOrder: { select: { poNo: true } } } });
    const rows: any[] = [];
    for (const i of items) {
      const incoming = openPOs.filter((p) => p.itemId === i.id).reduce((s, p) => s + Math.max(0, Number(p.quantity) - Number(p.receivedQty)), 0);
      for (const w of warehouses) {
        const b = await this.itemBalance(companyId, i.id, w.id);
        const status = i.type === 'SERVICE' ? 'ACTIVE' : (b.onHand <= 0 ? 'OUT OF STOCK' : b.available <= Number(i.reorderLevel) ? 'LOW STOCK' : b.onHand > Number(i.reorderLevel) * 4 ? 'OVERSTOCK' : 'IN STOCK');
        rows.push({ id: `${i.id}__${w.id}`, itemId: i.id, sku: i.sku, name: i.name, unit: i.unit, type: i.type, warehouseId: w.id, warehouse: w.name, onHand: b.onHand, reserved: b.reserved, available: b.available, incoming, reorderLevel: Number(i.reorderLevel), unitCost: b.avgCost, value: b.value, status });
      }
    }
    return rows;
  }

  @Get('movements') movements(@Req() req: any) {
    return this.prisma.stockMovement.findMany({ where: { warehouse: { companyId: companyIdOf(req.user) } }, include: { item: true, warehouse: { include: { branch: true } } }, orderBy: { occurredAt: 'desc' }, take: 200 });
  }

  @Post('movements') async createMovement(@Req() req: any, @Body() dto: CreateMovementDto) {
    const companyId = companyIdOf(req.user);
    return this.movementService.create(companyId, dto, req.user.sub);
  }

  @Post('transfers') async transfer(@Req() req: any, @Body() dto: TransferDto) {
    const companyId = companyIdOf(req.user);
    const [from, to] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { id: dto.fromWarehouseId, companyId } }),
      this.prisma.warehouse.findFirst({ where: { id: dto.toWarehouseId, companyId } }),
    ]);
    if (!from || !to) throw new Error('Warehouse not found');
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new Error('Source and destination warehouses must differ');
    const ref = dto.reference || await this.numbering.next(companyId, 'TRF');
    const results = await this.prisma.$transaction(async (tx) => {
      const out = await this.movementService.create(companyId, { warehouseId: from.id, itemId: dto.itemId, type: 'TRANSFER_OUT', quantity: Number(dto.quantity), unitCost: 0, reference: ref }, req.user.sub, tx);
      const inn = await this.movementService.create(companyId, { warehouseId: to.id, itemId: dto.itemId, type: 'TRANSFER_IN', quantity: Number(dto.quantity), unitCost: 0, reference: ref }, req.user.sub, tx);
      return [out, inn];
    });
    await this.audit.log(companyId, req.user.sub, 'TRANSFER', 'StockMovement', results[0].id, { ref });
    return results;
  }

  // ----- Stock counts -----
  @Get('counts') counts(@Req() req: any) {
    return this.prisma.stockCount.findMany({ where: { companyId: companyIdOf(req.user) }, include: { warehouse: true, lines: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('counts') async createCount(@Req() req: any, @Body() dto: CreateCountDto) {
    const companyId = companyIdOf(req.user);
    const countNo = await this.numbering.next(companyId, 'SC');
    const count = await this.prisma.stockCount.create({
      data: { companyId, warehouseId: dto.warehouseId, countNo, lines: { create: dto.lines.map((l: CountLineDto) => ({ itemId: l.itemId, systemQty: 0, countedQty: l.countedQty, variance: 0 })) } },
      include: { lines: true },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'StockCount', count.id, { countNo });
    return count;
  }
  @Post('counts/:id/post') async postCount(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const count = await this.prisma.stockCount.findFirst({ where: { id, companyId }, include: { lines: true, warehouse: true } });
    if (!count) throw new Error('Stock count not found');
    if (count.status !== 'DRAFT') return count;
    const movements: any[] = [];
    for (const line of count.lines) {
      const movementsAll = await this.prisma.stockMovement.findMany({ where: { warehouseId: count.warehouseId, itemId: line.itemId } });
      const onHand = movementsAll.reduce((s, m) => s + (Number((m as any).signedQuantity) || (['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'].includes(m.type) ? Number(m.quantity) : -Number(m.quantity))), 0);
      const variance = Number(line.countedQty) - onHand;
      await this.prisma.stockCountLine.update({ where: { id: line.id }, data: { systemQty: onHand, variance } });
      if (Math.abs(variance) > 0.0001) {
        movements.push({ warehouseId: count.warehouseId, itemId: line.itemId, type: variance > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', quantity: Math.abs(variance), signedQuantity: variance, unitCost: 0, reference: count.countNo, occurredAt: count.countDate });
      }
    }
    if (movements.length) await this.prisma.stockMovement.createMany({ data: movements });
    await this.prisma.stockCount.update({ where: { id: count.id }, data: { status: 'POSTED' } });
    await this.audit.log(companyId, req.user.sub, 'POST', 'StockCount', count.id, { countNo: count.countNo });
    return this.prisma.stockCount.findUnique({ where: { id: count.id }, include: { lines: true } });
  }
  @Delete('counts/:id') async deleteCount(@Req() req: any, @Param('id') id: string) {
    await this.prisma.stockCount.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Reports -----
  @Get('valuation') async valuation(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, ...(q.type ? { type: q.type } : {}) } });
    const rows = [];
    for (const i of items) {
      const movements = await this.prisma.stockMovement.findMany({ where: { itemId: i.id, warehouse: { companyId } } });
      const b = this.wac(movements);
      rows.push({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, type: i.type, onHand: b.onHand, avgCost: b.avgCost, value: b.value, inventoryAccount: i.inventoryAssetAccountId || null });
    }
    return { rows, totalValue: Number(rows.reduce((s, r) => s + r.value, 0).toFixed(2)) };
  }

  // ---------------------------------------------------------------------------
  // Authoritative Inventory Costing & Valuation report (as-of, per item /
  // warehouse / category, period COGS, GL reconciliation, cost exceptions).
  // ---------------------------------------------------------------------------
  private simCost(movements: any[], from: Date, to: Date) {
    let qty = 0, value = 0, cogs = 0;
    const sorted = [...movements].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    for (const m of sorted) {
      const q = Number(m.quantity || 0);
      const isIn = ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'].includes(m.type);
      const d = new Date(m.occurredAt);
      if (isIn) { qty += q; value += q * Number(m.unitCost || 0); }
      else { const avg = qty > 0 ? value / qty : 0; const out = Math.min(q, qty); const removed = out * avg; value -= removed; qty -= out; if (d >= from && d <= to) cogs += removed; }
    }
    return { onHand: Number(qty.toFixed(4)), avgCost: Number((qty > 0.0001 ? value / qty : 0).toFixed(2)), value: Number(value.toFixed(2)), cogsPeriod: Number(cogs.toFixed(2)) };
  }

  @Get('costing-report') async costingReport(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const asOf = q.asOf ? new Date(String(q.asOf).concat('T23:59:59')) : new Date();
    const from = q.from ? new Date(String(q.from)) : new Date(asOf.getFullYear(), 0, 1);
    const to = q.to ? new Date(String(q.to).concat('T23:59:59')) : asOf;
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId }, include: { category: true } });
    const warehouses = await this.prisma.warehouse.findMany({ where: { companyId } });
    const whMap = new Map(warehouses.map((w) => [w.id, w]));
    const movements = await this.prisma.stockMovement.findMany({ where: { item: { companyId }, ...(q.warehouseId ? { warehouseId: String(q.warehouseId) } : {}) }, orderBy: { occurredAt: 'asc' } });
    const byItem: Record<string, any[]> = {}; const byItemWh: Record<string, any[]> = {}; const lastMove: Record<string, Date> = {};
    for (const m of movements) {
      (byItem[m.itemId] = byItem[m.itemId] || []).push(m);
      (byItemWh[`${m.itemId}__${m.warehouseId}`] = byItemWh[`${m.itemId}__${m.warehouseId}`] || []).push(m);
      if (!lastMove[m.itemId] || new Date(m.occurredAt) > lastMove[m.itemId]) lastMove[m.itemId] = new Date(m.occurredAt);
    }

    let totalValue = 0, units = 0, itemsInStock = 0, cogsPeriod = 0, negative = 0, missingCost = 0;
    const rows: any[] = [];
    const byWh: Record<string, { warehouseId: string; name: string; items: number; units: number; value: number }> = {};
    const byCat: Record<string, { categoryId: string | null; name: string; items: number; units: number; value: number; pct: number }> = {};
    for (const it of items) {
      if (q.categoryId && it.categoryId !== q.categoryId) continue;
      const ms = byItem[it.id] || [];
      const s = this.simCost(ms, from, to);
      const onHand = s.onHand; const val = s.value;
      if (onHand > 0) itemsInStock++;
      units += Math.max(onHand, 0);
      totalValue += val; cogsPeriod += s.cogsPeriod;
      if (onHand < 0) negative++;
      if (onHand > 0 && s.avgCost <= 0.0001) missingCost++;
      const status = onHand < 0 ? 'NEGATIVE' : (onHand > 0 && s.avgCost <= 0.0001) ? 'MISSING_COST' : 'NORMAL';
      const inventoryAccountId = it.inventoryAssetAccountId;
      rows.push({ itemId: it.id, sku: it.sku, name: it.name, unit: it.unit, categoryId: it.categoryId, category: it.itemCategory || it.category?.name || '', onHand, avgCost: s.avgCost, value: val, lastCost: it.purchaseCost != null ? Number(it.purchaseCost) : null, lastMovement: lastMove[it.id] || null, costingMethod: it.costingMethod || 'Weighted Average', status, inventoryAccountId, cogsAccountId: it.cogsAccountId });
      // per-warehouse / per-category aggregation (value by item, split across warehouse qty)
      const catKey = it.categoryId || 'none';
      if (!byCat[catKey]) byCat[catKey] = { categoryId: it.categoryId, name: it.itemCategory || it.category?.name || 'Uncategorised', items: 0, units: 0, value: 0, pct: 0 };
      byCat[catKey].items += onHand > 0 ? 1 : 0; byCat[catKey].units += Math.max(onHand, 0); byCat[catKey].value += val;
      for (const [k, wms] of Object.entries(byItemWh)) {
        const [iid, wid] = k.split('__');
        if (iid !== it.id) continue;
        const ws = this.simCost(wms, from, to);
        if (!byWh[wid]) byWh[wid] = { warehouseId: wid, name: whMap.get(wid)?.name || 'Warehouse', items: 0, units: 0, value: 0 };
        byWh[wid].items += ws.onHand > 0 ? 1 : 0; byWh[wid].units += Math.max(ws.onHand, 0); byWh[wid].value += ws.value;
      }
    }
    const catList = Object.values(byCat).sort((a: any, b: any) => b.value - a.value).map((c: any) => ({ ...c, pct: totalValue ? Number(((c.value / totalValue) * 100).toFixed(1)) : 0 }));
    const whList = Object.values(byWh).sort((a: any, b: any) => b.value - a.value);

    // GL inventory asset reconciliation (as-of).
    const assetIds = [...new Set(items.map((i) => i.inventoryAssetAccountId).filter(Boolean))];
    let control: number | null = null;
    if (assetIds.length) {
      const agg = await this.prisma.journalLine.aggregate({ where: { accountId: { in: assetIds as string[] }, journal: { companyId, status: 'POSTED', date: { lte: asOf } } }, _sum: { debit: true, credit: true } });
      control = Number((Number(agg._sum.debit || 0) - Number(agg._sum.credit || 0)).toFixed(2));
    }

    return {
      asOf: q.asOf || null,
      summary: { inventoryValue: Number(totalValue.toFixed(2)), itemsInStock, unitsOnHand: Math.round(units), cogsPeriod: Number(cogsPeriod.toFixed(2)), negativeStock: negative, missingCost },
      rows,
      warehouses: whList, categories: catList,
      reconciliation: { subledger: Number(totalValue.toFixed(2)), control, difference: control == null ? null : Number((totalValue - control).toFixed(2)) },
    };
  }

  @Get('reorder') async reorder(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, active: true, type: { not: 'SERVICE' } } });
    const warehouses = await this.prisma.warehouse.findMany({ where: { companyId } });
    const rows: any[] = [];
    for (const it of items) {
      for (const w of warehouses) {
        const b = await this.itemBalance(companyId, it.id, w.id);
        if (b.available <= Number(it.reorderLevel)) {
          rows.push({ id: `${it.id}__${w.id}`, itemId: it.id, sku: it.sku, name: it.name, unit: it.unit, warehouseId: w.id, warehouse: w.name, onHand: b.onHand, reserved: b.reserved, available: b.available, reorderLevel: Number(it.reorderLevel), suggestedQty: Math.max(Number(it.reorderQuantity) || Number(it.reorderLevel) * 2, Number(it.reorderLevel) - b.available), preferredSupplierId: it.preferredSupplierId, leadTimeDays: it.leadTimeDays, estimatedCost: it.purchaseCost });
        }
      }
    }
    return rows;
  }

  // ----- Price lists -----
  private async ensureDefaultPriceLists(companyId: string) {
    const count = await this.prisma.priceList.count({ where: { companyId } });
    if (count) return;
    await this.prisma.priceList.createMany({ data: ['Retail', 'Wholesale'].map((name) => ({ companyId, name, currency: 'USD', active: true })) });
  }
  @Get('price-lists') async priceLists(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    await this.ensureDefaultPriceLists(companyId);
    return this.prisma.priceList.findMany({ where: { companyId }, include: { items: { include: { item: { select: { sku: true, name: true, unit: true } } } } }, orderBy: { name: 'asc' } });
  }
  @Post('price-lists') async createPriceList(@Req() req: any, @Body() dto: PriceListDto) {
    const companyId = companyIdOf(req.user);
    const pl = await this.prisma.priceList.create({ data: { companyId, name: dto.name, description: dto.description, currency: dto.currency || 'USD', active: dto.active ?? true, customerGroup: dto.customerGroup, effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined, effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'PriceList', pl.id, { name: dto.name });
    return pl;
  }
  @Post('price-lists/:id/items') async upsertPriceListItem(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const pl = await this.prisma.priceList.findFirst({ where: { id, companyId } });
    if (!pl) throw new BadRequestException('Price list not found');
    const rec = await this.prisma.priceListItem.upsert({ where: { priceListId_itemId: { priceListId: id, itemId: body.itemId } }, create: { priceListId: id, itemId: body.itemId, price: Number(body.price || 0), minQty: body.minQty ? Number(body.minQty) : undefined }, update: { price: Number(body.price || 0), minQty: body.minQty ? Number(body.minQty) : undefined } });
    await this.audit.log(companyId, req.user.sub, 'PRICE_LIST_SET', 'PriceListItem', rec.id, { priceListId: id, itemId: body.itemId, price: Number(body.price) });
    return rec;
  }
  @Delete('price-lists/:id/items/:itemId') deletePriceListItem(@Req() req: any, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.prisma.priceListItem.deleteMany({ where: { priceListId: id, itemId } });
  }

  // ----- Item price resolution -----
  @Get('items/:id/price') async itemPrice(@Req() req: any, @Param('id') id: string, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, companyId } });
    if (!item) throw new BadRequestException('Item not found');
    const priceListId = q.customerId ? (await this.prisma.customer.findFirst({ where: { id: q.customerId, companyId }, select: { priceListId: true } }))?.priceListId : undefined;
    let price = Number(item.sellingPrice), priceSource = 'ITEM_DEFAULT', sourceId: string | null = null;
    if (priceListId) {
      const pli = await this.prisma.priceListItem.findFirst({ where: { priceListId, itemId: id } });
      if (pli) { price = Number(pli.price); priceSource = 'CUSTOMER_PRICE_LIST'; sourceId = priceListId; }
    }
    return { itemId: id, price, priceSource, priceListId: sourceId, currency: 'USD' };
  }

  // ----- Reservations -----
  @Get('reservations') reservations(@Req() req: any) {
    return this.prisma.stockReservation.findMany({ where: { companyId: companyIdOf(req.user) }, include: { item: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('reservations') async reserve(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const items = body.items || [];
    const created = [];
    for (const it of items) {
      if (!(Number(it.qty) > 0)) continue;
      const b = await this.itemBalance(companyId, it.itemId);
      if (it.qty > b.available + 0.001) throw new BadRequestException(`Cannot reserve ${it.qty}: only ${b.available} available for ${it.itemId}`);
      created.push(await this.prisma.stockReservation.create({ data: { companyId, itemId: it.itemId, salesOrderId: body.salesOrderId, referencedBy: body.referencedBy, qty: Number(it.qty), status: 'ACTIVE' } }));
    }
    await this.audit.log(companyId, req.user.sub, 'RESERVED', 'StockReservation', body.salesOrderId, { count: created.length });
    return created;
  }
  @Post('reservations/:id/release') async releaseReservation(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const r = await this.prisma.stockReservation.findFirst({ where: { id, companyId } });
    if (!r) throw new BadRequestException('Reservation not found');
    await this.prisma.stockReservation.update({ where: { id }, data: { status: 'RELEASED', releasedAt: new Date() } });
    await this.audit.log(companyId, req.user.sub, 'RESERVATION_RELEASED', 'StockReservation', id, { itemId: r.itemId, qty: Number(r.qty) });
    return this.prisma.stockReservation.findUnique({ where: { id } });
  }
  @Post('reservations/release-by-order') async releaseByOrder(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const res = await this.prisma.stockReservation.updateMany({ where: { companyId, salesOrderId: body.salesOrderId, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
    return { released: res.count };
  }

  // ----- Reports (reuse posted invoices + inventory valuation) -----
  private async reportRange(q: any, days: number) {
    if (q.from || q.to) return { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined };
    return { gte: new Date(Date.now() - days * 86400000) };
  }
  private async salesByItem(companyId: string, q: any) {
    const range = await this.reportRange(q, 30);
    const invDate: any = {};
    if (range.gte) invDate.gte = range.gte;
    if (range.lte) invDate.lte = range.lte;
    const where: any = { invoice: { companyId, status: 'POSTED' } };
    if (Object.keys(invDate).length) where.invoice.invoiceDate = invDate;
    if (q.itemId) where.itemId = q.itemId;
    const lines = await this.prisma.salesInvoiceLine.findMany({ where, include: { invoice: { include: { customer: true } } } });
    const itemIds = [...new Set(lines.map((l: any) => l.itemId).filter(Boolean))];
    const items = await this.prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, include: { category: true } });
    const itemMap = new Map(items.map((i: any) => [i.id, i]));
    const agg: Record<string, any> = {};
    for (const l of lines) {
      if (!l.itemId) continue;
      const it = itemMap.get(l.itemId);
      const a = (agg[l.itemId] ||= { itemId: l.itemId, sku: it?.sku, name: it?.name, category: it?.category?.name || 'Uncategorised', qty: 0, net: 0, invoiceCount: 0, lastSale: null, sales: [] });
      a.qty += Number(l.quantity);
      a.net += Number(l.lineTotal);
      a.invoiceCount += 1;
      const dd = l.invoice.invoiceDate;
      if (!a.lastSale || dd > a.lastSale) a.lastSale = dd;
      a.sales.push({ invoiceId: l.invoice.id, invoiceNo: l.invoice.invoiceNo, date: dd, customer: l.invoice.customer?.name, qty: Number(l.quantity), amount: Number(l.lineTotal) });
    }
    return Object.values(agg).map((a: any) => { a.qty = Number(a.qty.toFixed(2)); a.net = Number(a.net.toFixed(2)); return a; });
  }
  @Get('reports/sales-by-item') async salesByItemReport(@Req() req: any, @Query() q: any) {
    const rows = await this.salesByItem(companyIdOf(req.user), q);
    return rows.sort((a: any, b: any) => b.net - a.net);
  }
  @Get('reports/best-sellers') async bestSellers(@Req() req: any, @Query() q: any) {
    const rows = await this.salesByItem(companyIdOf(req.user), q);
    let byQty = rows.sort((a: any, b: any) => b.qty - a.qty);
    const ids = byQty.slice(0, 25).map((r: any) => r.itemId);
    const avail: Record<string, any> = {};
    for (const id of ids) { const b = await this.itemBalance(companyIdOf(req.user), id); avail[id] = { available: b.available, avgCost: b.avgCost }; }
    return byQty.map((r: any, i: number) => ({ rank: i + 1, ...r, available: avail[r.itemId]?.available || 0, cogs: Number((r.qty * (avail[r.itemId]?.avgCost || 0)).toFixed(2)) }));
  }
  @Get('reports/slow-moving') async slowMoving(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const saleMap = await this.itemSales(companyId, (await this.prisma.inventoryItem.findMany({ where: { companyId } })).map((i: any) => i.id), Number(q.days) || 90);
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId } });
    const rows = [];
    for (const i of items) {
      const b = await this.itemBalance(companyId, i.id);
      const s = saleMap[i.id] || { qty: 0, lastSale: null };
      if (b.onHand > 0 && Number(s.qty) < Number(q.threshold ?? 1)) rows.push({ id: i.id, sku: i.sku, name: i.name, category: i.categoryId || null, onHand: b.onHand, value: b.value, avgCost: b.avgCost, lastSale: s.lastSale, qtySold30d: Number(s.qty) });
    }
    return rows;
  }
  @Get('reports/dead-stock') async deadStock(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const days = Number(q.days) || 180;
    const saleMap = await this.itemSales(companyId, (await this.prisma.inventoryItem.findMany({ where: { companyId } })).map((i: any) => i.id), days);
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId } });
    const rows = [];
    for (const i of items) {
      const b = await this.itemBalance(companyId, i.id);
      const s = saleMap[i.id] || { qty: 0, lastSale: null };
      if (b.onHand > 0 && Number(s.qty) <= 0) rows.push({ id: i.id, sku: i.sku, name: i.name, onHand: b.onHand, avgCost: b.avgCost, value: b.value, lastSale: s.lastSale, daysIdle: s.lastSale ? Math.floor((Date.now() - new Date(s.lastSale).getTime()) / 86400000) : days });
    }
    return rows;
  }
  @Get('reports/sales-by-category') async salesByCategory(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const rows = await this.salesByItem(companyId, q);
    const cats = await this.prisma.inventoryCategory.findMany({ where: { companyId } });
    const nameOf = new Map(cats.map((c) => [c.id, c.name]));
    const parentOf = new Map(cats.map((c) => [c.id, c.parentId]));
    const byCat: Record<string, any> = {};
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId }, select: { id: true, categoryId: true } });
    const catByItem = new Map(items.map((i) => [i.id, i.categoryId]));
    for (const r of rows) {
      const cid = catByItem.get(r.itemId) || null;
      const key = cid || 'uncat';
      const a = (byCat[key] ||= { categoryId: cid, category: cid ? nameOf.get(cid) : 'Uncategorised', qty: 0, net: 0 });
      a.qty += r.qty; a.net += r.net;
    }
    // aggregate children into parents
    for (const [id, a] of Object.entries(byCat)) { const pid = parentOf.get(id); if (pid && byCat[pid]) { byCat[pid].qty += a.qty; byCat[pid].net += a.net; } }
    return Object.values(byCat).map((c: any) => ({ ...c, qty: Number(c.qty.toFixed(2)), net: Number(c.net.toFixed(2)) })).sort((a: any, b: any) => b.net - a.net);
  }
  @Get('reports/stock-by-category') async stockByCategory(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId }, select: { id: true, categoryId: true, type: true } });
    const cats = await this.prisma.inventoryCategory.findMany({ where: { companyId } });
    const rows: Record<string, any> = {};
    for (const i of items) {
      if (i.type === 'SERVICE') continue;
      const b = await this.itemBalance(companyId, i.id);
      const key = i.categoryId || 'uncat';
      const a = (rows[key] ||= { categoryId: i.categoryId, category: (i.categoryId ? cats.find((c) => c.id === i.categoryId)?.name : null) || 'Uncategorised', items: 0, units: 0, value: 0, lowStock: 0, outOfStock: 0 });
      a.items += 1; a.units += Number(b.onHand); a.value += Number(b.value);
      if (b.available <= 0 && b.onHand <= 0) a.outOfStock += 1; else if (b.available <= 0) a.lowStock += 1;
    }
    return Object.values(rows).map((r: any) => ({ ...r, units: Number(r.units.toFixed(2)), value: Number(r.value.toFixed(2)) }));
  }
} 