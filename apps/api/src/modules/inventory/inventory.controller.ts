import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { companyIdOf } from '../../core/context';
import { CountLineDto, CreateAdjustmentDto, CreateCountDto, CreateMovementDto, InventoryCategoryDto, ItemDto, PriceListDto, TransferDto, WarehouseDto } from './inventory.dto';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { InventoryMovementService } from './inventory-movement.service';
import { PostingService } from '../finance/posting.service';
import { ITEM_TYPE, isService, isStockTracked, normalizeItemType, trackingStatus, itemTypeFromTracking } from './item-type';

@ApiTags('Inventory') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('inventory')
export class InventoryController {
  constructor(
    private prisma: PrismaService,
    private numbering: NumberingService,
    private audit: AuditService,
    private movementService: InventoryMovementService,
    private posting: PostingService,
  ) {}

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
    return this.movementService.balance(companyId, itemId, warehouseId);
  }

  /** Resolve inventory asset + adjustment P&L account codes (never hard-code UUIDs). */
  private async resolveInventoryAccounts(companyId: string, item: { inventoryAssetAccountId?: string | null; adjustmentAccountId?: string | null; cogsAccountId?: string | null }) {
    const byCode = await this.posting.accountsByCode(companyId);
    let assetCode = '1200';
    let adjCode = '6500';
    if (item.inventoryAssetAccountId) {
      const a = await this.prisma.ledgerAccount.findFirst({ where: { id: item.inventoryAssetAccountId, companyId } });
      if (a) assetCode = a.code;
    } else if (!byCode['1200']) {
      await this.prisma.ledgerAccount.create({ data: { companyId, code: '1200', name: 'Inventory', type: 'ASSET' } });
    }
    if (item.adjustmentAccountId) {
      const a = await this.prisma.ledgerAccount.findFirst({ where: { id: item.adjustmentAccountId, companyId } });
      if (a) adjCode = a.code;
    } else if (!byCode['6500']) {
      await this.prisma.ledgerAccount.create({ data: { companyId, code: '6500', name: 'Inventory Adjustments', type: 'EXPENSE' } });
    }
    return { assetCode, adjCode };
  }

  private adjustmentMovementType(reason: string, delta: number): string {
    if (reason === 'OPENING_BALANCE') return 'RECEIPT';
    if (delta > 0) return 'ADJUSTMENT_IN';
    return 'ADJUSTMENT_OUT';
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
    if (q.type) {
      const nt = normalizeItemType(String(q.type));
      // Accept legacy short codes in filters too
      where.type = { in: [nt, ...(nt === ITEM_TYPE.INVENTORY_PRODUCT ? ['INVENTORY'] : nt === ITEM_TYPE.NON_INVENTORY_PRODUCT ? ['NON_INVENTORY'] : [])] };
    } else if (q.tracking) {
      const fromTracking = itemTypeFromTracking(String(q.tracking));
      if (fromTracking) {
        where.type = { in: [fromTracking, ...(fromTracking === ITEM_TYPE.INVENTORY_PRODUCT ? ['INVENTORY'] : fromTracking === ITEM_TYPE.NON_INVENTORY_PRODUCT ? ['NON_INVENTORY'] : [])] };
      }
    }
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
      const performance = isService(i.type) ? 'SERVICE' : this.classifyPerf(Number(s.qty), b.onHand, i.createdAt, s.lastSale);
      const incoming = isStockTracked(i.type) ? openPOs.filter((p) => p.itemId === i.id).reduce((sum, p) => sum + Math.max(0, Number(p.quantity) - Number(p.receivedQty)), 0) : 0;
      rows.push({
        ...i,
        type: normalizeItemType(i.type),
        trackingStatus: trackingStatus(i.type),
        movements: undefined,
        onHand: isStockTracked(i.type) ? b.onHand : null,
        reserved: isStockTracked(i.type) ? b.reserved : null,
        available: isStockTracked(i.type) ? b.available : null,
        avgCost: isStockTracked(i.type) ? b.avgCost : null,
        value: isStockTracked(i.type) ? b.value : null,
        qtySold: Number(s.qty.toFixed(2)),
        net: Number(s.net.toFixed(2)),
        lastSale: s.lastSale,
        performance,
        incoming: isStockTracked(i.type) ? incoming : null,
        warehouses: warehouses.length,
      });
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
    const itemType = normalizeItemType(dto.type || ITEM_TYPE.INVENTORY_PRODUCT);
    const stock = isStockTracked(itemType);
    const item = await this.prisma.inventoryItem.create({
      data: {
        companyId, sku, name: dto.name, unit: dto.unit || (itemType === ITEM_TYPE.SERVICE ? 'Hour' : 'EA'),
        hsCode: dto.hsCode, barcode: stock || itemType === ITEM_TYPE.NON_INVENTORY_PRODUCT ? dto.barcode : undefined,
        brand: dto.brand, description: dto.description, salesDescription: dto.salesDescription, purchaseDescription: dto.purchaseDescription,
        type: itemType, itemCategory: dto.itemCategory, categoryId: cat?.id, imageUrl: dto.imageUrl,
        reorderLevel: stock ? (dto.reorderLevel ?? 0) : 0,
        reorderQuantity: stock ? (dto.reorderQuantity ?? 0) : 0,
        safetyStock: stock ? (dto.safetyStock ?? 0) : 0,
        sellingPrice: dto.sellingPrice ?? 0, minSellingPrice: dto.minSellingPrice, purchaseCost: dto.purchaseCost ?? 0,
        costingMethod: stock ? (dto.costingMethod || 'WEIGHTED_AVERAGE') : null,
        trackBatch: stock ? (dto.trackBatch ?? false) : false,
        trackSerial: stock ? (dto.trackSerial ?? false) : false,
        trackExpiry: stock ? (dto.trackExpiry ?? false) : false,
        salesTaxCode: dto.salesTaxCode ?? cat?.salesTaxCode, purchaseTaxCode: dto.purchaseTaxCode ?? cat?.purchaseTaxCode,
        incomeAccountId: dto.incomeAccountId ?? cat?.incomeAccountId,
        cogsAccountId: stock ? (dto.cogsAccountId ?? cat?.cogsAccountId) : undefined,
        inventoryAssetAccountId: stock ? (dto.inventoryAssetAccountId ?? cat?.inventoryAssetAccountId) : undefined,
        expenseAccountId: !stock ? (dto.expenseAccountId ?? cat?.expenseAccountId ?? dto.cogsAccountId) : (dto.expenseAccountId ?? cat?.expenseAccountId),
        adjustmentAccountId: stock ? dto.adjustmentAccountId : undefined,
        defaultWarehouseId: stock ? dto.defaultWarehouseId : undefined,
        preferredSupplierId: dto.preferredSupplierId, supplierSku: dto.supplierSku, leadTimeDays: dto.leadTimeDays,
        allowDiscount: dto.allowDiscount ?? true, active: dto.active ?? true,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'InventoryItem', item.id, { sku, type: itemType });
    return item;
  }
  @Patch('items/:id') async updateItem(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<ItemDto>) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.inventoryItem.findFirst({
      where: { id, companyId },
      include: { _count: { select: { movements: true, reservations: true } } },
    });
    if (!existing) throw new BadRequestException('Item not found');
    if (dto.sku && dto.sku !== existing.sku) {
      const dup = await this.prisma.inventoryItem.findFirst({ where: { companyId, sku: dto.sku, NOT: { id } } });
      if (dup) throw new BadRequestException('SKU already exists for this company');
    }
    // Master-data only — never accept quantity / on-hand fields.
    const forbidden = ['onHand', 'quantityOnHand', 'quantity', 'available', 'reserved', 'value', 'avgCost'];
    for (const k of forbidden) if ((dto as any)[k] !== undefined) throw new BadRequestException('Quantity on hand cannot be edited. Use Adjust Stock instead.');

    const data: any = { ...dto };
    if (dto.type !== undefined) {
      const nextType = normalizeItemType(dto.type);
      const prevType = normalizeItemType(existing.type);
      if (nextType !== prevType) {
        const hasHistory = await this.itemHasTransactionHistory(companyId, id, existing._count);
        if (hasHistory) {
          throw new BadRequestException("This item's type cannot be changed because it already has transaction history.");
        }
      }
      data.type = nextType;
      if (!isStockTracked(nextType)) {
        data.reorderLevel = 0;
        data.reorderQuantity = 0;
        data.safetyStock = 0;
        data.inventoryAssetAccountId = null;
        data.defaultWarehouseId = null;
        data.trackBatch = false;
        data.trackSerial = false;
        data.trackExpiry = false;
        if (nextType === ITEM_TYPE.SERVICE) data.cogsAccountId = data.cogsAccountId ?? null;
      }
    }

    await this.prisma.inventoryItem.updateMany({ where: { id, companyId }, data });
    const changes: Record<string, { from: any; to: any }> = {};
    for (const key of ['name', 'sku', 'barcode', 'sellingPrice', 'purchaseCost', 'categoryId', 'unit', 'active', 'reorderLevel', 'description', 'type'] as const) {
      if ((dto as any)[key] !== undefined && String((dto as any)[key] ?? '') !== String((existing as any)[key] ?? '')) {
        changes[key] = { from: (existing as any)[key], to: key === 'type' ? data.type : (dto as any)[key] };
      }
    }
    if (Object.keys(changes).length) {
      await this.audit.log(companyId, req.user.sub, 'ITEM_UPDATED', 'InventoryItem', id, { module: 'inventory', metadata: changes });
    }
    return this.prisma.inventoryItem.findFirst({ where: { id, companyId } });
  }

  /** Stock movements, reservations, or document lines referencing this item. */
  private async itemHasTransactionHistory(companyId: string, itemId: string, counts?: { movements: number; reservations: number }) {
    if (counts && (counts.movements > 0 || counts.reservations > 0)) return true;
    const [inv, quote, so, po, bill, cn, del] = await Promise.all([
      this.prisma.salesInvoiceLine.count({ where: { itemId, invoice: { companyId } } }),
      this.prisma.quotationLine.count({ where: { itemId, quotation: { companyId } } }),
      this.prisma.salesOrderLine.count({ where: { itemId, salesOrder: { companyId } } }),
      this.prisma.purchaseOrderLine.count({ where: { itemId, purchaseOrder: { companyId } } }),
      this.prisma.supplierInvoiceLine.count({ where: { itemId, supplierInvoice: { companyId } } }).catch(() => 0),
      this.prisma.creditNoteLine.count({ where: { itemId, creditNote: { companyId } } }).catch(() => 0),
      this.prisma.deliveryLine.count({ where: { itemId, deliveryNote: { companyId } } }).catch(() => 0),
    ]);
    return inv + quote + so + po + bill + cn + del > 0;
  }

  @Post('items/:id/archive')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('inventory.adjust')
  async archiveItem(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, companyId } });
    if (!item) throw new BadRequestException('Item not found');
    const bal = await this.itemBalance(companyId, id);
    if (Math.abs(bal.onHand) > 0.0001) {
      throw new BadRequestException(`Cannot archive while stock on hand is ${bal.onHand}. Adjust or transfer stock to zero first.`);
    }
    await this.prisma.inventoryItem.updateMany({ where: { id, companyId }, data: { active: false } });
    await this.audit.log(companyId, req.user.sub, 'ARCHIVE', 'InventoryItem', id, { module: 'inventory', metadata: { sku: item.sku } });
    return this.prisma.inventoryItem.findFirst({ where: { id, companyId } });
  }

  @Post('items/:id/restore')
  async restoreItem(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    await this.prisma.inventoryItem.updateMany({ where: { id, companyId }, data: { active: true } });
    await this.audit.log(companyId, req.user.sub, 'RESTORE', 'InventoryItem', id, { module: 'inventory' });
    return this.prisma.inventoryItem.findFirst({ where: { id, companyId } });
  }

  @Delete('items/:id') async deleteItem(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, companyId },
      include: { _count: { select: { movements: true, reservations: true, priceListItems: true } } },
    });
    if (!item) throw new BadRequestException('Item not found');
    const bal = await this.itemBalance(companyId, id);
    if (Math.abs(bal.onHand) > 0.0001) {
      throw new BadRequestException(`Cannot delete: quantity on hand is ${bal.onHand}. Adjust/transfer to zero, then archive.`);
    }
    const hasHistory = item._count.movements > 0 || item._count.reservations > 0;
    if (hasHistory) {
      throw new BadRequestException('Cannot delete this item because it has transaction history. You can archive it instead.');
    }
    await this.prisma.inventoryItem.deleteMany({ where: { id, companyId } });
    await this.audit.log(companyId, req.user.sub, 'DELETE', 'InventoryItem', id, { module: 'inventory', metadata: { sku: item.sku } });
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
    const typeLocked = await this.itemHasTransactionHistory(companyId, id, {
      movements: movements.length,
      reservations: reservations.length,
    });
    return {
      item: { ...item, type: normalizeItemType(item.type), trackingStatus: trackingStatus(item.type) },
      stock: isStockTracked(item.type) ? stock : [],
      total: isStockTracked(item.type) ? total : { onHand: 0, reserved: 0, available: 0, avgCost: 0, value: 0 },
      movements: isStockTracked(item.type) ? movements : [],
      priceListItems,
      reservations,
      typeLocked,
      incoming: isStockTracked(item.type)
        ? (await this.prisma.purchaseOrderLine.findMany({ where: { itemId: id, purchaseOrder: { companyId, status: { in: ['APPROVED', 'PART_RECEIVED'] } } } }))
            .reduce((s, p) => s + Math.max(0, Number(p.quantity) - Number(p.receivedQty)), 0)
        : null,
    };
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
    const companyId = companyIdOf(req.user);
    const moves = await this.prisma.stockMovement.count({ where: { warehouseId: id, warehouse: { companyId } } });
    if (moves) throw new BadRequestException('Cannot delete a warehouse with stock movement history.');
    await this.prisma.warehouse.deleteMany({ where: { id, companyId } });
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
        const status = !isStockTracked(i.type) ? 'N/A' : (b.onHand <= 0 ? 'OUT OF STOCK' : b.available <= Number(i.reorderLevel) ? 'LOW STOCK' : b.onHand > Number(i.reorderLevel) * 4 ? 'OVERSTOCK' : 'IN STOCK');
        if (!isStockTracked(i.type)) continue;
        rows.push({ id: `${i.id}__${w.id}`, itemId: i.id, sku: i.sku, name: i.name, unit: i.unit, type: normalizeItemType(i.type), warehouseId: w.id, warehouse: w.name, onHand: b.onHand, reserved: b.reserved, available: b.available, incoming, reorderLevel: Number(i.reorderLevel), unitCost: b.avgCost, value: b.value, status });
      }
    }
    return rows;
  }

  @Get('movements') movements(@Req() req: any) {
    return this.prisma.stockMovement.findMany({ where: { warehouse: { companyId: companyIdOf(req.user) } }, include: { item: true, warehouse: { include: { branch: true } } }, orderBy: { occurredAt: 'desc' }, take: 200 });
  }

  /** Stock movement ledger is immutable — create only. Corrections must be new reversing movements. */
  @Post('movements')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('inventory.adjust')
  async createMovement(@Req() req: any, @Body() dto: CreateMovementDto) {
    const companyId = companyIdOf(req.user);
    return this.movementService.create(companyId, dto, req.user.sub);
  }

  @Post('transfers')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('inventory.transfer')
  async transfer(@Req() req: any, @Body() dto: TransferDto) {
    const companyId = companyIdOf(req.user);
    const [from, to] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { id: dto.fromWarehouseId, companyId } }),
      this.prisma.warehouse.findFirst({ where: { id: dto.toWarehouseId, companyId } }),
    ]);
    if (!from || !to) throw new BadRequestException('Warehouse not found');
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestException('Source and destination warehouses must differ');
    const date = dto.date ? new Date(dto.date) : new Date();
    await this.movementService.assertPeriodOpen(companyId, date);
    const bal = await this.movementService.balance(companyId, dto.itemId, from.id);
    const unitCost = bal.avgCost;
    const ref = dto.reference || await this.numbering.next(companyId, 'TRF');
    const results = await this.prisma.$transaction(async (tx) => {
      const out = await this.movementService.create(companyId, {
        warehouseId: from.id, itemId: dto.itemId, type: 'TRANSFER_OUT', quantity: Number(dto.quantity),
        unitCost, reference: ref, notes: dto.notes, occurredAt: date,
      }, req.user.sub, tx);
      const inn = await this.movementService.create(companyId, {
        warehouseId: to.id, itemId: dto.itemId, type: 'TRANSFER_IN', quantity: Number(dto.quantity),
        unitCost, reference: ref, notes: dto.notes, occurredAt: date,
      }, req.user.sub, tx);
      return [out, inn];
    });
    await this.audit.log(companyId, req.user.sub, 'TRANSFER', 'StockMovement', results[0].id, {
      module: 'inventory',
      metadata: { ref, from: from.id, to: to.id, qty: dto.quantity, unitCost, notes: dto.notes },
    });
    return results;
  }

  /**
   * Proper stock adjustment workflow.
   * Never edits quantityOnHand — creates an immutable movement (+ optional GL).
   */
  @Post('adjustments')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('inventory.adjust')
  async createAdjustment(@Req() req: any, @Body() dto: CreateAdjustmentDto) {
    const companyId = companyIdOf(req.user);
    const item = await this.prisma.inventoryItem.findFirst({ where: { id: dto.itemId, companyId } });
    if (!item) throw new BadRequestException('Item not found');
    if (!isStockTracked(item.type)) throw new BadRequestException('Only Inventory Products can be stock-adjusted');
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, companyId } });
    if (!warehouse) throw new BadRequestException('Warehouse not found');

    const date = dto.date ? new Date(dto.date) : new Date();
    await this.movementService.assertPeriodOpen(companyId, date);
    const before = await this.movementService.balance(companyId, item.id, warehouse.id);

    let delta = 0;
    if (dto.mode === 'set') {
      if (dto.countedQty === undefined || dto.countedQty === null) throw new BadRequestException('countedQty is required for set mode');
      delta = Number((Number(dto.countedQty) - before.onHand).toFixed(4));
    } else {
      if (dto.quantity === undefined || dto.quantity === null) throw new BadRequestException('quantity is required for delta mode');
      delta = Number(dto.quantity);
      if (dto.reason === 'QUANTITY_DECREASE' || ['DAMAGED', 'LOST', 'EXPIRED'].includes(dto.reason)) {
        delta = -Math.abs(delta);
      } else if (dto.reason === 'QUANTITY_INCREASE' || dto.reason === 'FOUND' || dto.reason === 'OPENING_BALANCE') {
        delta = Math.abs(delta);
      }
    }
    if (Math.abs(delta) < 0.0001) throw new BadRequestException('No quantity difference to adjust');

    const type = this.adjustmentMovementType(dto.reason, delta);
    const qty = Math.abs(delta);
    const unitCost = dto.unitCost !== undefined && dto.unitCost !== null
      ? Number(dto.unitCost)
      : (type === 'RECEIPT' || type === 'ADJUSTMENT_IN'
        ? (before.avgCost || Number(item.purchaseCost) || 0)
        : before.avgCost);
    const ref = dto.reference || await this.numbering.next(companyId, 'ADJ');
    const noteText = dto.notes?.trim() || undefined;
    const journalNote = [dto.reason, noteText].filter(Boolean).join(': ');

    const result = await this.prisma.$transaction(async (tx) => {
      const movement = await this.movementService.create(companyId, {
        warehouseId: warehouse.id,
        itemId: item.id,
        type,
        quantity: qty,
        unitCost,
        reference: ref,
        notes: noteText,
        occurredAt: date,
      }, req.user.sub, tx);

      let journal: any = null;
      const shouldPost = dto.postJournal !== false && isStockTracked(item.type) && Number(unitCost) * qty > 0.0001;
      if (shouldPost) {
        const { assetCode, adjCode } = await this.resolveInventoryAccounts(companyId, item);
        const amount = Number((qty * Number(unitCost)).toFixed(2));
        // Opening balance capitalizes against equity (3000); other gains/losses use adjustment P&L.
        const offsetCode = dto.reason === 'OPENING_BALANCE' ? '3000' : adjCode;
        const lines = delta > 0
          ? [
              { code: assetCode, debit: amount, credit: 0, description: `Stock increase ${item.sku}` },
              { code: offsetCode, debit: 0, credit: amount, description: journalNote || (dto.reason === 'OPENING_BALANCE' ? `Opening stock ${ref}` : `Adjustment gain ${ref}`) },
            ]
          : [
              { code: adjCode, debit: amount, credit: 0, description: journalNote || `Adjustment loss ${ref}` },
              { code: assetCode, debit: 0, credit: amount, description: `Stock decrease ${item.sku}` },
            ];
        journal = await this.posting.postJournal(companyId, {
          date,
          description: `Stock adjustment ${ref} (${dto.reason})${noteText ? `: ${noteText}` : ''}`,
          reference: ref,
          sourceType: 'STOCK_ADJUSTMENT',
          sourceId: movement.id,
          lines,
          userId: req.user.sub,
        }, tx);
      }
      return { movement, journal };
    });

    const after = await this.movementService.balance(companyId, item.id, warehouse.id);
    await this.audit.log(companyId, req.user.sub, 'STOCK_ADJUSTMENT', 'StockMovement', result.movement.id, {
      module: 'inventory',
      metadata: {
        reason: dto.reason, mode: dto.mode, beforeQty: before.onHand, afterQty: after.onHand, delta,
        unitCost, reference: ref, notes: noteText, journalId: result.journal?.id,
      },
    });
    return {
      ...result,
      beforeQty: before.onHand,
      afterQty: after.onHand,
      delta,
      unitCost: Number(result.movement.unitCost),
      reference: ref,
    };
  }

  // ----- Stock counts -----
  @Get('counts') counts(@Req() req: any) {
    return this.prisma.stockCount.findMany({ where: { companyId: companyIdOf(req.user) }, include: { warehouse: true, lines: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('counts')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('inventory.adjust')
  async createCount(@Req() req: any, @Body() dto: CreateCountDto) {
    const companyId = companyIdOf(req.user);
    const countNo = await this.numbering.next(companyId, 'SC');
    const lines = [];
    for (const l of dto.lines) {
      const bal = await this.movementService.balance(companyId, l.itemId, dto.warehouseId);
      const variance = Number((Number(l.countedQty) - bal.onHand).toFixed(4));
      lines.push({ itemId: l.itemId, systemQty: bal.onHand, countedQty: l.countedQty, variance });
    }
    const count = await this.prisma.stockCount.create({
      data: { companyId, warehouseId: dto.warehouseId, countNo, lines: { create: lines } },
      include: { lines: true },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'StockCount', count.id, { countNo });
    return count;
  }
  @Post('counts/:id/post')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('inventory.adjust')
  async postCount(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const count = await this.prisma.stockCount.findFirst({ where: { id, companyId }, include: { lines: true, warehouse: true } });
    if (!count) throw new BadRequestException('Stock count not found');
    if (count.status !== 'DRAFT') return count;
    await this.movementService.assertPeriodOpen(companyId, count.countDate);

    await this.prisma.$transaction(async (tx) => {
      for (const line of count.lines) {
        const bal = await this.movementService.balance(companyId, line.itemId, count.warehouseId, tx);
        const variance = Number((Number(line.countedQty) - bal.onHand).toFixed(4));
        await tx.stockCountLine.update({ where: { id: line.id }, data: { systemQty: bal.onHand, variance } });
        if (Math.abs(variance) < 0.0001) continue;
        const item = await tx.inventoryItem.findFirst({ where: { id: line.itemId, companyId } });
        if (!item || !isStockTracked(item.type)) continue;
        const type = variance > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
        const qty = Math.abs(variance);
        const movement = await this.movementService.create(companyId, {
          warehouseId: count.warehouseId,
          itemId: line.itemId,
          type,
          quantity: qty,
          unitCost: bal.avgCost,
          reference: count.countNo,
          occurredAt: count.countDate,
        }, req.user.sub, tx);
        if (isStockTracked(item.type) && bal.avgCost * qty > 0.0001) {
          const { assetCode, adjCode } = await this.resolveInventoryAccounts(companyId, item);
          const amount = Number((qty * bal.avgCost).toFixed(2));
          const lines = variance > 0
            ? [{ code: assetCode, debit: amount, credit: 0 }, { code: adjCode, debit: 0, credit: amount }]
            : [{ code: adjCode, debit: amount, credit: 0 }, { code: assetCode, debit: 0, credit: amount }];
          await this.posting.postJournal(companyId, {
            date: count.countDate,
            description: `Stock count ${count.countNo}`,
            reference: count.countNo,
            sourceType: 'STOCK_COUNT',
            sourceId: `${count.id}:${line.id}`,
            lines,
            userId: req.user.sub,
          }, tx);
          void movement;
        }
      }
      await tx.stockCount.update({ where: { id: count.id }, data: { status: 'POSTED' } });
    });
    await this.audit.log(companyId, req.user.sub, 'POST', 'StockCount', count.id, { countNo: count.countNo });
    return this.prisma.stockCount.findUnique({ where: { id: count.id }, include: { lines: true } });
  }
  @Delete('counts/:id') async deleteCount(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const count = await this.prisma.stockCount.findFirst({ where: { id, companyId } });
    if (!count) throw new BadRequestException('Stock count not found');
    if (count.status !== 'DRAFT') throw new BadRequestException('Posted stock counts cannot be deleted. Create a reversing adjustment instead.');
    await this.prisma.stockCount.deleteMany({ where: { id, companyId } });
    return { ok: true };
  }

  // ----- Reports -----
  @Get('valuation') async valuation(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, ...(q.type ? { type: q.type } : {}) } });
    const rows = [];
    for (const i of items) {
      if (!isStockTracked(i.type)) continue;
      const movements = await this.prisma.stockMovement.findMany({ where: { itemId: i.id, warehouse: { companyId } } });
      const b = this.wac(movements);
      rows.push({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, type: normalizeItemType(i.type), onHand: b.onHand, avgCost: b.avgCost, value: b.value, inventoryAccount: i.inventoryAssetAccountId || null });
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
      if (!isStockTracked(it.type)) continue;
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
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, active: true } });
    const warehouses = await this.prisma.warehouse.findMany({ where: { companyId } });
    const rows: any[] = [];
    for (const it of items) {
      if (!isStockTracked(it.type)) continue;
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
      const a = (agg[l.itemId] ||= { itemId: l.itemId, sku: it?.sku, name: it?.name, type: normalizeItemType(it?.type), category: it?.category?.name || 'Uncategorised', qty: 0, net: 0, invoiceCount: 0, lastSale: null, sales: [] });
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
    let rows = await this.salesByItem(companyIdOf(req.user), q);
    if (q.itemType) rows = rows.filter((r: any) => normalizeItemType(r.type) === normalizeItemType(q.itemType));
    if (q.kind === 'product') rows = rows.filter((r: any) => !isService(r.type));
    if (q.kind === 'service') rows = rows.filter((r: any) => isService(r.type));
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
      if (!isStockTracked(i.type)) continue;
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
      if (!isStockTracked(i.type)) continue;
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
      if (!isStockTracked(i.type)) continue;
      const b = await this.itemBalance(companyId, i.id);
      const key = i.categoryId || 'uncat';
      const a = (rows[key] ||= { categoryId: i.categoryId, category: (i.categoryId ? cats.find((c) => c.id === i.categoryId)?.name : null) || 'Uncategorised', items: 0, units: 0, value: 0, lowStock: 0, outOfStock: 0 });
      a.items += 1; a.units += Number(b.onHand); a.value += Number(b.value);
      if (b.available <= 0 && b.onHand <= 0) a.outOfStock += 1; else if (b.available <= 0) a.lowStock += 1;
    }
    return Object.values(rows).map((r: any) => ({ ...r, units: Number(r.units.toFixed(2)), value: Number(r.value.toFixed(2)) }));
  }
} 