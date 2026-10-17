import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { PostingService } from '../finance/posting.service';
import { InvoiceStatusService } from '../finance/invoice-status.service';
import { InventoryMovementService } from '../inventory/inventory-movement.service';
import { PricingService } from '../sales/pricing.service';
import { FiscalisationService } from '../fiscalisation/fiscalisation.service';
import { isStockTracked } from '../inventory/item-type';
import { assertTransition as checkTransition, priceLine, roundMoney, sumLines } from './pos.calc';

function assertTransition(family: Parameters<typeof checkTransition>[0], from: string, to: string) {
  try {
    checkTransition(family, from, to);
  } catch (e: any) {
    throw new BadRequestException(e?.message || 'That status change is not allowed');
  }
}

const EXTERNAL = new Set(['CARD', 'BANK', 'MOBILE']);

@Injectable()
export class PosService {
  constructor(
    private prisma: PrismaService,
    private numbering: NumberingService,
    private audit: AuditService,
    private posting: PostingService,
    private invoiceStatus: InvoiceStatusService,
    private stock: InventoryMovementService,
    private pricing: PricingService,
    private fiscal: FiscalisationService,
  ) {}

  async bootstrap(companyId: string, branchId?: string) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId }, select: { id: true, baseCurrency: true, legalName: true } });
    if (!company) throw new BadRequestException('Company not found');
    const branches = await this.prisma.branch.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } });
    const branch = branches.find((b) => b.id === branchId) || branches[0];
    if (!branch) throw new BadRequestException('Create a branch before using POS');
    const settings = await this.ensureSettings(companyId, branch.id);
    const registers = await this.prisma.posRegister.findMany({ where: { companyId, branchId: branch.id, active: true }, include: { shifts: { where: { status: 'OPEN' }, take: 1 } } });
    const warehouses = await this.prisma.warehouse.findMany({ where: { companyId, branchId: branch.id } });
    const fiscalDevices = await this.prisma.fiscalDevice.findMany({ where: { branchId: branch.id }, select: { id: true, name: true, serialNumber: true } });
    return { company, branch, branches, settings, registers, warehouses, fiscalDevices, currency: company.baseCurrency || 'USD' };
  }

  async cashAccounts(companyId: string) {
    return this.prisma.ledgerAccount.findMany({
      where: { companyId, type: 'ASSET' as any, isGroup: false, active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  async ensureSettings(companyId: string, branchId: string) {
    const existing = await this.prisma.posBranchSettings.findUnique({ where: { branchId } });
    if (existing) return existing;
    return this.prisma.posBranchSettings.create({ data: { companyId, branchId } });
  }

  async saveSettings(companyId: string, branchId: string, body: any) {
    await this.branchInCompany(companyId, branchId);
    if (body.defaultWarehouseId) {
      const wh = await this.prisma.warehouse.findFirst({ where: { id: body.defaultWarehouseId, companyId, branchId } });
      if (!wh) throw new BadRequestException('Warehouse is not in this branch');
    }
    if (body.walkInCustomerId) {
      const c = await this.prisma.customer.findFirst({ where: { id: body.walkInCustomerId, companyId } });
      if (!c) throw new BadRequestException('Customer not found');
    }
    if (body.fiscalDeviceId) {
      const device = await this.prisma.fiscalDevice.findFirst({ where: { id: body.fiscalDeviceId, branchId } });
      if (!device) throw new BadRequestException('Fiscal device is not registered to this branch');
    }
    return this.prisma.posBranchSettings.upsert({
      where: { branchId },
      create: { companyId, branchId, ...this.settingsData(body) },
      update: this.settingsData(body),
    });
  }

  private settingsData(body: any) {
    const data: any = {};
    for (const k of ['defaultMode', 'retailEnabled', 'serviceEnabled', 'restaurantEnabled', 'taxInclusive', 'allowCredit', 'defaultWarehouseId', 'walkInCustomerId', 'fiscalDeviceId', 'tipAccountCode']) {
      if (body[k] !== undefined) data[k] = body[k] || (typeof body[k] === 'boolean' ? body[k] : null);
      if (typeof body[k] === 'boolean') data[k] = body[k];
    }
    if (body.defaultMode) data.defaultMode = body.defaultMode;
    return data;
  }

  async catalog(companyId: string, q: { branchId?: string; mode?: string; search?: string; barcode?: string; categoryId?: string }) {
    const boot = await this.bootstrap(companyId, q.branchId);
    const mode = String(q.mode || boot.settings.defaultMode || 'RETAIL').toUpperCase();
    const where: any = { companyId, active: true };
    if (mode === 'SERVICE') where.type = { in: ['SERVICE', 'INVENTORY_PRODUCT', 'NON_INVENTORY_PRODUCT'] };
    else if (mode === 'RETAIL') where.type = { in: ['INVENTORY_PRODUCT', 'NON_INVENTORY_PRODUCT'] };
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.barcode) where.barcode = q.barcode;
    else if (q.search) {
      const s = q.search.trim();
      where.OR = [{ name: { contains: s, mode: 'insensitive' } }, { sku: { contains: s, mode: 'insensitive' } }, { barcode: { equals: s } }];
    }
    const take = q.barcode ? 5 : 60;
    const page = Math.max(Number((q as any).page || 1), 1);
    const items = await this.prisma.inventoryItem.findMany({ where, orderBy: { name: 'asc' }, skip: q.barcode ? 0 : (page - 1) * take, take, include: { category: true } });
    const warehouseId = boot.settings.defaultWarehouseId || boot.warehouses[0]?.id;
    const ids = items.map((i) => i.id);
    const sums = warehouseId && ids.length
      ? await this.prisma.stockMovement.groupBy({ by: ['itemId'], where: { warehouseId, itemId: { in: ids } }, _sum: { signedQuantity: true } })
      : [];
    const onHand = Object.fromEntries(sums.map((s) => [s.itemId, Number(s._sum.signedQuantity || 0)]));
    return {
      branchId: boot.branch.id,
      warehouseId,
      currency: boot.currency,
      taxInclusive: boot.settings.taxInclusive,
      page,
      hasMore: !q.barcode && items.length === take,
      items: items.map((i) => ({
        id: i.id, sku: i.sku, name: i.name, barcode: i.barcode, type: i.type, unit: i.unit,
        price: Number(i.sellingPrice), category: i.category?.name || null, imageUrl: i.imageUrl,
        salesTaxCode: i.salesTaxCode, onHand: onHand[i.id] ?? null, tracked: isStockTracked(i.type),
      })),
    };
  }

  async listSales(companyId: string, q: { branchId?: string; status?: string; take?: string; search?: string; mode?: string; fiscal?: string }) {
    const statuses = q.status ? String(q.status).split(',').filter(Boolean) : [];
    const search = String(q.search || '').trim();
    return this.prisma.posSale.findMany({
      where: {
        companyId,
        ...(q.branchId ? { branchId: q.branchId } : {}),
        ...(statuses.length ? { saleStatus: { in: statuses as any } } : {}),
        ...(q.mode ? { mode: q.mode as any } : {}),
        ...(q.fiscal ? { fiscalStatus: q.fiscal as any } : {}),
        ...(search ? { OR: [{ saleNo: { contains: search, mode: 'insensitive' } }, { invoice: { invoiceNo: { contains: search, mode: 'insensitive' } } }, { customer: { name: { contains: search, mode: 'insensitive' } } }] } : {}),
      },
      include: {
        customer: { select: { id: true, name: true } }, lines: true, tenders: true,
        invoice: { select: { id: true, invoiceNo: true, fiscalStatus: true } },
        returns: { select: { id: true, returnNo: true, status: true, lines: { select: { saleLineId: true, quantity: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.take || 50), 200),
    });
  }

  /** Held carts are open orders with no stock, journal, or payment until checkout. */
  async hold(companyId: string, userId: string, body: any) {
    const sale = await this.openOrder(companyId, userId, body);
    assertTransition('cart', sale.cartStatus, 'HELD');
    return this.prisma.posSale.update({ where: { id: sale.id }, data: { cartStatus: 'HELD' }, include: { lines: true } });
  }

  async resume(companyId: string, id: string) {
    const sale = await this.saleInCompany(companyId, id);
    if (sale.saleStatus !== 'DRAFT') throw new BadRequestException('Only an open cart can be resumed');
    assertTransition('cart', sale.cartStatus, 'ACTIVE');
    return this.prisma.posSale.update({ where: { id }, data: { cartStatus: 'ACTIVE' }, include: { lines: { where: { voided: false } }, tenders: true } });
  }

  /** Brings a held cart back into the terminal. The held record closes so the cart cannot be rung twice. */
  async recallHeld(companyId: string, userId: string, id: string) {
    const sale = await this.prisma.posSale.findFirst({ where: { id, companyId }, include: { lines: { where: { voided: false } }, tenders: true } });
    if (!sale || sale.saleStatus !== 'DRAFT' || sale.cartStatus !== 'HELD') throw new BadRequestException('This cart is no longer on hold');
    if (sale.tenders.length) throw new BadRequestException('This cart has payments. Open it as an order instead.');
    const claimed = await this.prisma.posSale.updateMany({ where: { id, cartStatus: 'HELD', saleStatus: 'DRAFT' }, data: { cartStatus: 'ABANDONED', orderStatus: 'CANCELLED', notes: [sale.notes, 'Recalled to terminal'].filter(Boolean).join(' · ') } });
    if (!claimed.count) throw new ConflictException('This cart was just recalled on another terminal');
    await this.audit.log(companyId, userId, 'POS_CART_RECALLED', 'PosSale', id, { module: 'pos', result: 'SUCCESS' });
    return sale;
  }

  async staff(companyId: string) {
    const rows = await this.prisma.employee.findMany({ where: { companyId }, select: { id: true, firstName: true, lastName: true, employeeNo: true }, orderBy: { firstName: 'asc' }, take: 500 });
    return rows.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), employeeNo: e.employeeNo }));
  }

  /** Server-priced totals for the cart on screen. Nothing is saved. */
  async quote(companyId: string, body: any) {
    const boot = await this.bootstrap(companyId, body.branchId);
    if (!body.lines?.length) return { lines: [], subtotal: 0, taxTotal: 0, discountTotal: 0, serviceCharge: 0, tip: 0, total: 0 };
    if (body.lines.some((l: any) => Number(l.discount) > 0) && !body.allowDiscount) throw new BadRequestException('You do not have permission to give discounts');
    const customerId = body.customerId || boot.settings.walkInCustomerId || null;
    const priced = await this.priceCart(companyId, customerId, boot.currency, boot.settings.taxInclusive, body.lines, !!body.allowPriceOverride);
    return {
      lines: priced.map((p) => ({ itemId: p.itemId, unitPrice: p.unitPrice, tax: p.priced.tax, total: p.priced.total })),
      ...sumLines(priced.map((p) => p.priced), { serviceCharge: body.serviceCharge, tip: body.tip }),
    };
  }

  async abandonCart(companyId: string, userId: string, id: string) {
    const sale = await this.saleInCompany(companyId, id);
    if (sale.saleStatus !== 'DRAFT') throw new BadRequestException('Only an unpaid cart can be voided');
    if (sale.tenders?.some((t: any) => t.kind === 'DEPOSIT')) throw new BadRequestException('Refund the deposit before voiding this order');
    assertTransition('cart', sale.cartStatus, 'ABANDONED');
    await this.audit.log(companyId, userId, 'POS_CART_VOIDED', 'PosSale', id, { module: 'pos', result: 'SUCCESS' });
    return this.prisma.posSale.update({ where: { id }, data: { cartStatus: 'ABANDONED', orderStatus: 'CANCELLED' } });
  }

  async openOrders(companyId: string, q: { branchId?: string; mode?: string; tableId?: string; cart?: string }) {
    return this.prisma.posSale.findMany({
      where: {
        companyId, saleStatus: 'DRAFT', cartStatus: (q.cart as any) || { in: ['ACTIVE', 'HELD'] }, orderStatus: { not: 'CANCELLED' },
        ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.mode ? { mode: q.mode as any } : {}), ...(q.tableId ? { tableId: q.tableId } : {}),
      },
      include: { lines: { where: { voided: false } }, tenders: true, table: true, customer: { select: { id: true, name: true } }, assignedEmployee: { select: { id: true, firstName: true, lastName: true } }, tickets: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async openOrder(companyId: string, userId: string, body: any) {
    const boot = await this.bootstrap(companyId, body.branchId);
    const settings = boot.settings;
    const mode = String(body.mode || settings.defaultMode || 'RETAIL').toUpperCase();
    const enabled: Record<string, boolean> = { RETAIL: settings.retailEnabled, SERVICE: settings.serviceEnabled, RESTAURANT: settings.restaurantEnabled };
    if (!enabled[mode]) throw new BadRequestException(`${mode.charAt(0)}${mode.slice(1).toLowerCase()} POS is disabled for this branch`);
    if (body.tableId && mode !== 'RESTAURANT') throw new BadRequestException('Only restaurant orders can use a table');
    if (body.tableId) {
      const table = await this.prisma.restaurantTable.findFirst({ where: { id: body.tableId, companyId, branchId: boot.branch.id } });
      if (!table) throw new BadRequestException('Table not found');
      const busy = await this.prisma.posSale.findFirst({ where: { tableId: table.id, saleStatus: { in: ['DRAFT', 'PENDING_PAYMENT'] }, cartStatus: { not: 'ABANDONED' }, orderStatus: { not: 'CANCELLED' } } });
      if (busy && !body.allowSecondOrder) throw new ConflictException(`Table ${table.name} already has open order ${busy.saleNo}`);
    }
    if (body.assignedEmployeeId) {
      const emp = await this.prisma.employee.findFirst({ where: { id: body.assignedEmployeeId, companyId } });
      if (!emp) throw new BadRequestException('Staff member not found');
    }
    if (body.lines?.some((l: any) => Number(l.discount) > 0) && !body.allowDiscount) throw new BadRequestException('You do not have permission to discount this order');
    const customerId = body.customerId || settings.walkInCustomerId || null;
    const priced = body.lines?.length
      ? await this.priceCart(companyId, customerId, boot.currency, settings.taxInclusive, body.lines, !!body.allowPriceOverride)
      : [];
    const saleNo = await this.numbering.next(companyId, 'POS');
    const sale = await this.prisma.posSale.create({
      data: {
        companyId, branchId: boot.branch.id, saleNo, mode: mode as any, customerId,
        warehouseId: settings.defaultWarehouseId || boot.warehouses[0]?.id || null,
        tableId: body.tableId || null, orderType: body.orderType || (body.tableId ? 'DINE_IN' : null),
        assignedEmployeeId: body.assignedEmployeeId || null, registerId: body.registerId || null,
        notes: body.notes || null, currency: boot.currency, createdById: userId,
        lines: { create: priced.map((p) => this.lineRow(p)) },
      },
    });
    if (body.tableId) await this.prisma.restaurantTable.update({ where: { id: body.tableId }, data: { status: 'OCCUPIED' } });
    await this.recalcOrder(sale.id);
    await this.audit.log(companyId, userId, 'POS_ORDER_OPENED', 'PosSale', sale.id, { module: 'pos', result: 'SUCCESS', metadata: { saleNo, mode, tableId: body.tableId } });
    return this.prisma.posSale.findUniqueOrThrow({ where: { id: sale.id }, include: { lines: { where: { voided: false } }, tenders: true, table: true } });
  }

  private lineRow(p: any) {
    return {
      itemId: p.itemId, description: p.description, sku: p.sku, quantity: p.quantity, unitPrice: p.unitPrice,
      discount: p.priced.discount, taxRate: p.taxRate, taxAmount: p.priced.tax, lineTotal: p.priced.total,
      notes: p.notes, modifiers: p.modifiers ?? undefined, assignedEmployeeId: p.assignedEmployeeId || null,
    };
  }

  private async editableOrder(companyId: string, id: string) {
    const sale = await this.prisma.posSale.findFirst({ where: { id, companyId }, include: { lines: true, tenders: true } });
    if (!sale) throw new BadRequestException('Order not found');
    if (sale.saleStatus !== 'DRAFT' || sale.cartStatus === 'ABANDONED' || sale.orderStatus === 'CANCELLED') throw new BadRequestException('This order can no longer be changed');
    return sale;
  }

  async recalcOrder(saleId: string) {
    const sale = await this.prisma.posSale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: { where: { voided: false } } } });
    const subtotal = roundMoney(sale.lines.reduce((s, l) => s + Number(l.lineTotal) - Number(l.taxAmount), 0));
    const taxTotal = roundMoney(sale.lines.reduce((s, l) => s + Number(l.taxAmount), 0));
    const discountTotal = roundMoney(sale.lines.reduce((s, l) => s + Number(l.discount), 0));
    await this.prisma.posSale.update({ where: { id: saleId }, data: { subtotal, taxTotal, discountTotal, total: roundMoney(subtotal + taxTotal + Number(sale.serviceCharge) + Number(sale.tip)) } });
  }

  async addLines(companyId: string, id: string, body: any) {
    const sale = await this.editableOrder(companyId, id);
    if (body.lines?.some((l: any) => Number(l.discount) > 0) && !body.allowDiscount) throw new BadRequestException('You do not have permission to discount this order');
    const settings = await this.ensureSettings(companyId, sale.branchId);
    const priced = await this.priceCart(companyId, sale.customerId, sale.currency, settings.taxInclusive, body.lines || [], !!body.allowPriceOverride);
    await this.prisma.posSaleLine.createMany({ data: priced.map((p) => ({ saleId: sale.id, ...this.lineRow(p), modifiers: p.modifiers ?? undefined })) });
    await this.recalcOrder(sale.id);
    return this.prisma.posSale.findUniqueOrThrow({ where: { id: sale.id }, include: { lines: { where: { voided: false } }, tenders: true, table: true } });
  }

  /** Unsent lines can be removed by the cashier. Lines already sent to the kitchen need cancel permission. */
  async voidLine(companyId: string, userId: string, id: string, lineId: string, canCancel: boolean, reason?: string) {
    const sale = await this.editableOrder(companyId, id);
    const line = sale.lines.find((l) => l.id === lineId && !l.voided);
    if (!line) throw new BadRequestException('Line not found');
    if (line.sentAt && !canCancel) throw new BadRequestException('This item was sent to the kitchen. A manager must cancel it.');
    await this.prisma.posSaleLine.update({ where: { id: lineId }, data: { voided: true, notes: [line.notes, reason ? `Cancelled: ${reason}` : 'Cancelled'].filter(Boolean).join(' · ') } });
    await this.recalcOrder(sale.id);
    await this.audit.log(companyId, userId, 'POS_LINE_VOIDED', 'PosSale', sale.id, { module: 'pos', result: 'SUCCESS', metadata: { lineId, description: line.description, sent: !!line.sentAt, reason } });
    return this.prisma.posSale.findUniqueOrThrow({ where: { id: sale.id }, include: { lines: { where: { voided: false } }, tenders: true, table: true } });
  }

  async setOrderStatus(companyId: string, id: string, status: string) {
    const sale = await this.editableOrder(companyId, id);
    if (status === 'COMPLETED') throw new BadRequestException('An order completes when it is paid');
    assertTransition('order', sale.orderStatus, status);
    return this.prisma.posSale.update({ where: { id }, data: { orderStatus: status as any } });
  }

  async moveTable(companyId: string, userId: string, id: string, tableId: string) {
    const sale = await this.editableOrder(companyId, id);
    const table = await this.prisma.restaurantTable.findFirst({ where: { id: tableId, companyId, branchId: sale.branchId } });
    if (!table) throw new BadRequestException('Table not found');
    const busy = await this.prisma.posSale.findFirst({ where: { tableId, id: { not: id }, saleStatus: { in: ['DRAFT', 'PENDING_PAYMENT'] }, cartStatus: { not: 'ABANDONED' }, orderStatus: { not: 'CANCELLED' } } });
    if (busy) throw new ConflictException(`Table ${table.name} is in use by order ${busy.saleNo}`);
    await this.prisma.$transaction([
      this.prisma.posSale.update({ where: { id }, data: { tableId } }),
      this.prisma.restaurantTable.update({ where: { id: tableId }, data: { status: 'OCCUPIED' } }),
      ...(sale.tableId ? [this.prisma.restaurantTable.update({ where: { id: sale.tableId }, data: { status: 'NEEDS_CLEANING' } })] : []),
    ]);
    await this.audit.log(companyId, userId, 'POS_TABLE_MOVED', 'PosSale', id, { module: 'pos', result: 'SUCCESS', metadata: { from: sale.tableId, to: tableId } });
    return this.prisma.posSale.findUniqueOrThrow({ where: { id }, include: { table: true } });
  }

  /** Moves chosen lines onto a new open order for the same table so each bill pays separately. */
  async splitOrder(companyId: string, userId: string, id: string, lineIds: string[]) {
    const sale = await this.editableOrder(companyId, id);
    if (sale.tenders.some((t) => t.kind === 'DEPOSIT')) throw new BadRequestException('Orders with deposits cannot be split');
    const moving = sale.lines.filter((l) => !l.voided && lineIds.includes(l.id));
    const staying = sale.lines.filter((l) => !l.voided && !lineIds.includes(l.id));
    if (!moving.length || !staying.length) throw new BadRequestException('Choose some, but not all, items to split');
    const saleNo = await this.numbering.next(companyId, 'POS');
    const child = await this.prisma.posSale.create({
      data: {
        companyId, branchId: sale.branchId, saleNo, mode: sale.mode, customerId: sale.customerId, warehouseId: sale.warehouseId,
        tableId: sale.tableId, orderType: sale.orderType, orderStatus: sale.orderStatus, assignedEmployeeId: sale.assignedEmployeeId,
        registerId: sale.registerId, currency: sale.currency, notes: `Split from ${sale.saleNo}`, createdById: userId,
      },
    });
    await this.prisma.posSaleLine.updateMany({ where: { id: { in: moving.map((l) => l.id) } }, data: { saleId: child.id } });
    await Promise.all([this.recalcOrder(sale.id), this.recalcOrder(child.id)]);
    await this.audit.log(companyId, userId, 'POS_ORDER_SPLIT', 'PosSale', sale.id, { module: 'pos', result: 'SUCCESS', metadata: { child: child.saleNo, lines: moving.length } });
    return this.openOrders(companyId, { tableId: sale.tableId || undefined, branchId: sale.branchId });
  }

  async mergeOrders(companyId: string, userId: string, id: string, sourceId: string) {
    if (id === sourceId) throw new BadRequestException('Choose a different order to combine');
    const target = await this.editableOrder(companyId, id);
    const source = await this.editableOrder(companyId, sourceId);
    if (source.tenders.some((t) => t.kind === 'DEPOSIT')) throw new BadRequestException('Orders with deposits cannot be combined');
    if (target.branchId !== source.branchId) throw new BadRequestException('Orders are in different branches');
    await this.prisma.$transaction([
      this.prisma.posSaleLine.updateMany({ where: { saleId: source.id }, data: { saleId: target.id } }),
      this.prisma.kitchenTicket.updateMany({ where: { saleId: source.id }, data: { saleId: target.id } }),
      this.prisma.posSale.update({ where: { id: source.id }, data: { cartStatus: 'ABANDONED', orderStatus: 'CANCELLED', notes: `Combined into ${target.saleNo}` } }),
      ...(source.tableId && source.tableId !== target.tableId ? [this.prisma.restaurantTable.update({ where: { id: source.tableId }, data: { status: 'NEEDS_CLEANING' } })] : []),
    ]);
    await Promise.all([this.recalcOrder(target.id), this.recalcOrder(source.id)]);
    await this.audit.log(companyId, userId, 'POS_ORDER_MERGED', 'PosSale', target.id, { module: 'pos', result: 'SUCCESS', metadata: { source: source.saleNo } });
    return this.prisma.posSale.findUniqueOrThrow({ where: { id: target.id }, include: { lines: { where: { voided: false } }, table: true } });
  }

  async cancelOrder(companyId: string, userId: string, id: string, reason?: string) {
    const sale = await this.editableOrder(companyId, id);
    if (sale.tenders.some((t) => t.kind === 'DEPOSIT')) throw new BadRequestException('Refund the deposit before cancelling this order');
    assertTransition('order', sale.orderStatus, 'CANCELLED');
    await this.prisma.$transaction([
      this.prisma.posSale.update({ where: { id }, data: { orderStatus: 'CANCELLED', cartStatus: 'ABANDONED', notes: [sale.notes, reason && `Cancelled: ${reason}`].filter(Boolean).join(' · ') || null } }),
      this.prisma.kitchenTicket.updateMany({ where: { saleId: id, status: { in: ['QUEUED', 'PREPARING'] } }, data: { status: 'CANCELLED' } }),
      ...(sale.tableId ? [this.prisma.restaurantTable.update({ where: { id: sale.tableId }, data: { status: 'AVAILABLE' } })] : []),
    ]);
    await this.audit.log(companyId, userId, 'POS_ORDER_CANCELLED', 'PosSale', id, { module: 'pos', result: 'SUCCESS', metadata: { reason } });
    return { ok: true };
  }

  /** A deposit is an unapplied customer receipt. It is allocated to the invoice when the job is paid. */
  async takeDeposit(companyId: string, userId: string, id: string, body: any) {
    const sale = await this.editableOrder(companyId, id);
    const settings = await this.ensureSettings(companyId, sale.branchId);
    if (!sale.customerId || sale.customerId === settings.walkInCustomerId) throw new BadRequestException('Select the customer before taking a deposit');
    const method = String(body.method || 'CASH').toUpperCase();
    if (!['CASH', 'CARD', 'BANK', 'MOBILE'].includes(method)) throw new BadRequestException('Unknown deposit method');
    if (EXTERNAL.has(method) && !body.reference) throw new BadRequestException(`${method} deposits need the reference from the payment terminal`);
    const amount = roundMoney(body.amount);
    const taken = sale.tenders.filter((t) => t.kind === 'DEPOSIT').reduce((s, t) => s + Number(t.amount), 0);
    if (!(amount > 0)) throw new BadRequestException('Deposit must be greater than zero');
    if (Number(sale.total) > 0 && taken + amount > Number(sale.total) + 0.009) throw new BadRequestException('Deposits cannot exceed the job total');
    const registerId = body.registerId || sale.registerId;
    if (registerId && method === 'CASH') {
      const shift = await this.prisma.posShift.findFirst({ where: { companyId, registerId, status: 'OPEN' } });
      if (!shift) throw new BadRequestException('Open a cashier shift before taking cash');
    }
    const register = registerId ? await this.prisma.posRegister.findFirst({ where: { id: registerId, companyId }, include: { ledgerAccount: true } }) : null;
    const index = sale.tenders.filter((t) => t.kind === 'DEPOSIT').length;
    const receiptNo = await this.numbering.next(companyId, 'RCP');
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.receipt.create({
        data: {
          companyId, customerId: sale.customerId!, receiptNo, amount, applied: 0, unapplied: amount, method, referenceNo: body.reference,
          depositAccountId: register?.ledgerAccountId || undefined, idempotencyKey: `${sale.id}:D${index}`, note: `Deposit for ${sale.saleNo}`, status: 'POSTED',
        },
      });
      await this.posting.postJournal(companyId, {
        date: r.receiptDate, description: `Deposit ${receiptNo} for ${sale.saleNo}`, reference: receiptNo, sourceType: 'RECEIPT', sourceId: r.id, userId,
        lines: [
          { code: register?.ledgerAccount?.code || '1000', debit: amount, credit: 0, description: `${method} deposit` },
          { code: '1100', debit: 0, credit: amount, description: 'Customer deposit' },
        ],
      }, tx);
      await tx.posTender.create({ data: { saleId: sale.id, method, kind: 'DEPOSIT', amount, reference: body.reference, status: 'CAPTURED', receiptId: r.id } });
      if (method === 'CASH' && registerId) {
        const shift = await tx.posShift.findFirst({ where: { companyId, registerId, status: 'OPEN' } });
        if (shift) await tx.posCashMovement.create({ data: { shiftId: shift.id, kind: 'DEPOSIT', amount, note: `${sale.saleNo} ${receiptNo}`, createdById: userId } });
      }
    });
    await this.audit.log(companyId, userId, 'POS_DEPOSIT_TAKEN', 'PosSale', sale.id, { module: 'pos', result: 'SUCCESS', metadata: { receiptNo, amount, method } });
    return this.prisma.posSale.findUniqueOrThrow({ where: { id: sale.id }, include: { lines: { where: { voided: false } }, tenders: true } });
  }

  private async allocateDeposits(companyId: string, invoiceId: string, receiptIds: string[], total: number) {
    let remaining = total;
    for (const receiptId of receiptIds) {
      if (remaining <= 0.005) break;
      const r = await this.prisma.receipt.findFirst({ where: { id: receiptId, companyId } });
      if (!r || Number(r.unapplied) <= 0.005) continue;
      const amount = roundMoney(Math.min(Number(r.unapplied), remaining));
      await this.prisma.$transaction([
        this.prisma.paymentAllocation.create({ data: { receiptId: r.id, invoiceId, amountApplied: amount } }),
        this.prisma.receipt.update({ where: { id: r.id }, data: { applied: { increment: amount }, unapplied: { decrement: amount }, invoiceId: r.invoiceId || invoiceId } }),
      ]);
      remaining = roundMoney(remaining - amount);
    }
    if (receiptIds.length) await this.invoiceStatus.recalc(companyId, invoiceId);
  }

  async complete(companyId: string, userId: string, body: any, idempotencyKey?: string) {
    const key = String(idempotencyKey || body.idempotencyKey || '').trim() || undefined;
    if (key) {
      const existing = await this.prisma.posSale.findFirst({ where: { companyId, idempotencyKey: key }, include: { lines: true, tenders: true, invoice: true } });
      if (existing?.saleStatus === 'POSTED') return existing;
      if (existing) throw new ConflictException('This checkout was already started. Open it from Transactions instead of charging again.');
    }
    const boot = await this.bootstrap(companyId, body.branchId);
    const settings = boot.settings;
    const mode = String(body.mode || settings.defaultMode || 'RETAIL').toUpperCase();
    if (mode === 'RETAIL' && !settings.retailEnabled) throw new BadRequestException('Retail POS is disabled for this branch');
    if (mode === 'SERVICE' && !settings.serviceEnabled) throw new BadRequestException('Services POS is disabled for this branch');
    if (mode === 'RESTAURANT' && !settings.restaurantEnabled) throw new BadRequestException('Restaurant POS is disabled for this branch');
    const currency = boot.currency || 'USD';
    if (body.currency && String(body.currency).toUpperCase() !== currency) {
      throw new BadRequestException(`POS currently posts in the company currency ${currency}`);
    }
    const warehouseId = body.warehouseId || settings.defaultWarehouseId || boot.warehouses[0]?.id;
    if (!warehouseId) throw new BadRequestException('This branch has no warehouse');
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, companyId, branchId: boot.branch.id } });
    if (!warehouse) throw new BadRequestException('Warehouse is not in this branch');

    if (body.registerId) {
      const shift = await this.prisma.posShift.findFirst({ where: { companyId, registerId: body.registerId, status: 'OPEN' } });
      if (!shift) throw new BadRequestException('Open a cashier shift on this register before selling');
      body.shiftId = shift.id;
    }

    const order = body.saleId
      ? await this.prisma.posSale.findFirst({ where: { id: body.saleId, companyId }, include: { lines: { where: { voided: false } }, tenders: true } })
      : null;
    if (body.saleId) {
      if (!order || order.saleStatus !== 'DRAFT' || order.cartStatus === 'ABANDONED') throw new BadRequestException('This order is no longer open');
      if (order.branchId !== boot.branch.id) throw new BadRequestException('This order belongs to another branch');
    }

    const customerId = body.customerId || order?.customerId || settings.walkInCustomerId;
    if (!customerId) throw new BadRequestException('Select a customer, or set a walk-in customer in POS settings');
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, companyId } });
    if (!customer || customer.status !== 'ACTIVE') throw new BadRequestException('Customer is not available');

    const lines = order
      ? order.lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discount: Number(l.discount), notes: l.notes, modifiers: l.modifiers, assignedEmployeeId: l.assignedEmployeeId }))
      : body.lines || [];
    if (!order && lines.some((l: any) => Number(l.discount) > 0) && !body.allowDiscount) throw new BadRequestException('You do not have permission to discount this sale');
    const priced = await this.priceCart(companyId, customerId, currency, settings.taxInclusive, lines, !!body.allowPriceOverride, !!order);
    const extras = sumLines(priced.map((p) => p.priced), { serviceCharge: body.serviceCharge, tip: body.tip });
    const deposits = (order?.tenders || []).filter((t) => t.kind === 'DEPOSIT' && t.status === 'CAPTURED' && t.receiptId);
    const depositTotal = roundMoney(deposits.reduce((s, t) => s + Number(t.amount), 0));
    const tenders = this.normaliseTenders(body.tenders || [], roundMoney(Math.max(0, extras.total - depositTotal)), !!body.allowCredit && settings.allowCredit, customerId === settings.walkInCustomerId);

    const plan = await this.stockPlan(companyId, priced);
    await this.assertStock(companyId, warehouse.id, plan);

    const totals = {
      subtotal: extras.subtotal, discountTotal: extras.discountTotal, taxTotal: extras.taxTotal,
      serviceCharge: extras.serviceCharge, tip: extras.tip, total: extras.total,
    };
    const lineRows = priced.map((p) => ({ itemId: p.itemId, description: p.description, sku: p.sku, quantity: p.quantity, unitPrice: p.unitPrice, discount: p.priced.discount, taxRate: p.taxRate, taxAmount: p.priced.tax, lineTotal: p.priced.total, notes: p.notes, modifiers: p.modifiers ?? undefined, assignedEmployeeId: p.assignedEmployeeId }));
    let sale: { id: string; saleNo: string };
    if (order) {
      const claimed = await this.prisma.posSale.updateMany({ where: { id: order.id, saleStatus: 'DRAFT' }, data: { saleStatus: 'PENDING_PAYMENT', idempotencyKey: key } });
      if (!claimed.count) throw new ConflictException('This order is already being paid on another register');
      await this.prisma.posSale.update({
        where: { id: order.id },
        data: { ...totals, customerId, warehouseId, registerId: body.registerId || order.registerId, shiftId: body.shiftId || order.shiftId, notes: body.notes ?? order.notes },
      });
      sale = order;
    } else {
      const saleNo = await this.numbering.next(companyId, 'POS');
      try {
        sale = await this.prisma.posSale.create({
          data: {
            companyId, branchId: boot.branch.id, saleNo, idempotencyKey: key, mode: mode as any,
            cartStatus: 'ACTIVE', orderStatus: 'OPEN', saleStatus: 'PENDING_PAYMENT',
            customerId, warehouseId, registerId: body.registerId || null, shiftId: body.shiftId || null,
            terminalId: body.terminalId || null, tableId: body.tableId || null, orderType: body.orderType || null,
            assignedEmployeeId: body.assignedEmployeeId || null, currency, notes: body.notes || null,
            ...totals, createdById: userId,
            lines: { create: lineRows },
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('This checkout is already being processed. Wait for it to finish instead of charging again.');
        }
        throw e;
      }
    }
    const saleNo = sale.saleNo;

    const invoiceNo = await this.numbering.next(companyId, 'INV');
    const invoiceLines = [
      ...priced.map((p) => ({ description: p.description, itemId: p.itemId, quantity: p.quantity, unitPrice: p.priced.exclusiveUnit, discount: 0, taxRate: p.taxRate, taxAmount: p.priced.tax, lineTotal: p.priced.total })),
      ...(extras.serviceCharge > 0 ? [{ description: 'Service charge', quantity: 1, unitPrice: extras.serviceCharge, discount: 0, taxRate: 0, taxAmount: 0, lineTotal: extras.serviceCharge }] : []),
      ...(extras.tip > 0 ? [{ description: 'Tip', quantity: 1, unitPrice: extras.tip, discount: 0, taxRate: 0, taxAmount: 0, lineTotal: extras.tip }] : []),
    ];
    const invoice = await this.prisma.salesInvoice.create({
      data: {
        companyId, branchId: boot.branch.id, customerId, invoiceNo, currency, exchangeRate: 1,
        subtotal: extras.subtotal + extras.serviceCharge + extras.tip, taxTotal: extras.taxTotal, total: extras.total,
        status: 'DRAFT', invoiceStatus: 'DRAFT', fiscalRequired: true, fiscalStatus: 'READY', salesperson: body.cashierName || undefined,
        lines: { create: invoiceLines },
      },
    });
    await this.prisma.posSale.update({ where: { id: sale.id }, data: { invoiceId: invoice.id } });

    const abandon = async (cause: any) => {
      const data = order
        ? { saleStatus: 'DRAFT' as const, invoiceId: null, idempotencyKey: null }
        : { saleStatus: 'DRAFT' as const, cartStatus: 'ABANDONED' as const, invoiceId: null, idempotencyKey: null };
      await this.prisma.posSale.update({ where: { id: sale.id }, data }).catch(() => {});
      await this.prisma.salesInvoice.delete({ where: { id: invoice.id } }).catch(() => {});
      await this.audit.log(companyId, userId, 'POS_SALE_ABANDONED', 'PosSale', sale.id, { module: 'pos', result: 'FAILURE', metadata: { error: cause?.message } });
    };
    try {
      await this.posting.postSalesInvoice(companyId, invoice.id, userId);
    } catch (e) {
      await abandon(e);
      throw e;
    }
    try {
      await this.issueStock(companyId, invoice.id, invoiceNo, warehouse.id, plan, userId);
    } catch (e) {
      await this.revertInvoice(companyId, invoice.id, userId, e);
      await abandon(e);
      throw e;
    }
    try {
      await this.allocateDeposits(companyId, invoice.id, deposits.map((d) => d.receiptId!), extras.total);
      await this.recordTenders(companyId, userId, sale.id, invoice.id, customerId, tenders, body.registerId);
    } catch (e: any) {
      await this.audit.log(companyId, userId, 'POS_PAYMENT_RECORD_FAILED', 'PosSale', sale.id, { module: 'pos', result: 'FAILURE', metadata: { error: e?.message } });
      throw new ConflictException(`Sale ${saleNo} is posted but its payment was not fully recorded. Do not charge the customer again. Finish the payment from Transactions.`);
    }

    const fiscalStatus = await this.fiscaliseSale(companyId, userId, sale.id, invoice.id, boot.branch.id, settings.fiscalDeviceId);

    const tableId = order?.tableId || body.tableId;
    if (tableId) await this.prisma.restaurantTable.updateMany({ where: { id: tableId, companyId }, data: { status: 'NEEDS_CLEANING' } });
    if (order) await this.prisma.kitchenTicket.updateMany({ where: { saleId: order.id, status: 'READY' }, data: { status: 'COMPLETED' } });
    const posted = await this.prisma.posSale.update({
      where: { id: sale.id },
      data: { saleStatus: 'POSTED', orderStatus: 'COMPLETED', cartStatus: 'ACTIVE', fiscalStatus, completedAt: new Date() },
      include: { lines: true, tenders: true, invoice: true, customer: true },
    });
    await this.audit.log(companyId, userId, 'POS_SALE_POSTED', 'PosSale', sale.id, { module: 'pos', result: 'SUCCESS', metadata: { saleNo, invoiceNo, total: extras.total } });
    return posted;
  }

  /**
   * Server-side price resolution. Client prices are only accepted with the override permission.
   * `trusted` lines come from an open order that was already priced by this method.
   */
  async priceCart(companyId: string, customerId: string | null, currency: string, taxInclusive: boolean, lines: any[], allowOverride: boolean, trusted = false) {
    if (!lines.length) throw new BadRequestException('Add at least one item');
    const taxRates = await this.prisma.taxRate.findMany({ where: { companyId, active: true } });
    const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean))] as string[];
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, id: { in: ids }, active: true } });
    const modifierIds = [...new Set(lines.flatMap((l) => l.modifierIds || []))] as string[];
    const modifiers = modifierIds.length
      ? await this.prisma.menuModifier.findMany({ where: { id: { in: modifierIds }, group: { companyId } }, include: { group: true } })
      : [];
    const employeeIds = [...new Set(lines.map((l) => l.assignedEmployeeId).filter(Boolean))] as string[];
    if (employeeIds.length) {
      const count = await this.prisma.employee.count({ where: { companyId, id: { in: employeeIds } } });
      if (count !== employeeIds.length) throw new BadRequestException('Assigned staff member not found');
    }
    const out = [];
    for (const raw of lines) {
      const item = raw.itemId ? items.find((i) => i.id === raw.itemId) : null;
      if (raw.itemId && !item) throw new BadRequestException('Product not found or inactive');
      const quantity = Number(raw.quantity);
      if (!(quantity > 0)) throw new BadRequestException('Quantity must be greater than zero');
      let unitPrice: number;
      let chosen: { name: string; priceDelta: number }[] | null = raw.modifiers || null;
      if (trusted) {
        unitPrice = Number(raw.unitPrice);
      } else {
        const picked = (raw.modifierIds || []).map((id: string) => modifiers.find((m) => m.id === id));
        if (picked.some((m: any) => !m || (m.group.itemId && m.group.itemId !== item?.id))) throw new BadRequestException('A modifier does not belong to this menu item');
        const delta = picked.reduce((s: number, m: any) => s + Number(m.priceDelta), 0);
        if (picked.length) chosen = picked.map((m: any) => ({ name: m.name, priceDelta: Number(m.priceDelta) }));
        if (!item) {
          if (!allowOverride) throw new BadRequestException('Custom lines need the price override permission');
          unitPrice = Number(raw.unitPrice || 0);
        } else {
          const resolved = await this.pricing.resolve(companyId, { itemId: item.id, customerId, currency, quantity });
          unitPrice = roundMoney(Number(resolved?.price ?? item.sellingPrice) + delta);
          if (raw.unitPrice != null && Math.abs(Number(raw.unitPrice) - unitPrice) > 0.009) {
            if (!allowOverride) throw new BadRequestException(`Price override is not allowed for ${item.name}`);
            unitPrice = Number(raw.unitPrice);
          }
        }
        if (!(unitPrice >= 0)) throw new BadRequestException('Invalid price');
      }
      const rateRow = taxRates.find((t) => t.code === item?.salesTaxCode) || taxRates.find((t) => t.isDefault);
      const taxRate = Number(rateRow?.rate ?? 0);
      let priced: ReturnType<typeof priceLine>;
      try {
        priced = priceLine({ quantity, unitPrice, discount: Number(raw.discount || 0), taxRate, taxInclusive });
      } catch (e: any) {
        throw new BadRequestException(`${raw.description || item?.name || 'Item'}: ${e?.message}`);
      }
      out.push({
        itemId: item?.id, description: raw.description || item?.name || 'Item', sku: item?.sku, quantity, unitPrice, taxRate, priced,
        notes: raw.notes || null, modifiers: chosen, type: item?.type, assignedEmployeeId: raw.assignedEmployeeId || null,
      });
    }
    return out;
  }

  private normaliseTenders(raw: any[], total: number, allowCredit: boolean, walkIn: boolean) {
    const tenders = (raw || []).map((t) => ({ method: String(t.method || 'CASH').toUpperCase(), amount: roundMoney(t.amount), reference: t.reference ? String(t.reference).trim() : undefined }));
    if (total <= 0.005 && !tenders.length) return [];
    if (!tenders.length) throw new BadRequestException('Add a payment');
    for (const t of tenders) if (!['CASH', 'CARD', 'BANK', 'MOBILE', 'CREDIT'].includes(t.method)) throw new BadRequestException(`Unknown payment method ${t.method}`);
    if (tenders.filter((t) => t.method === 'CASH').length > 1) throw new BadRequestException('Combine cash into one payment line');
    let captured = 0;
    let credit = 0;
    for (const t of tenders) {
      if (!(t.amount > 0)) throw new BadRequestException('Payment amount must be greater than zero');
      if (EXTERNAL.has(t.method) && !t.reference) throw new BadRequestException(`${t.method} requires the approval reference from the terminal. It is not captured automatically.`);
      if (t.method === 'CREDIT') {
        if (!allowCredit) throw new BadRequestException('Customer credit is not enabled for this branch');
        if (walkIn) throw new BadRequestException('Select a customer before selling on credit');
        credit += t.amount;
      } else captured += t.amount;
    }
    if (credit > 0 && captured + credit + 0.02 < total) throw new BadRequestException('Payments do not cover the sale');
    if (credit === 0 && captured + 0.02 < total) throw new BadRequestException('Payments do not cover the sale');
    let remaining = total;
    const ordered = [...tenders.filter((t) => t.method !== 'CASH' && t.method !== 'CREDIT'), ...tenders.filter((t) => t.method === 'CREDIT'), ...tenders.filter((t) => t.method === 'CASH')];
    return ordered.map((t) => {
      const applied = roundMoney(Math.min(t.amount, Math.max(remaining, 0)));
      if (t.method !== 'CASH' && t.amount - applied > 0.009) throw new BadRequestException(`${t.method} amount is more than the balance due. Only cash can give change.`);
      const changeAmount = t.method === 'CASH' ? roundMoney(Math.max(0, t.amount - applied)) : 0;
      remaining = roundMoney(remaining - applied);
      return { ...t, applied, changeAmount };
    });
  }

  /** Stock each line consumes: recipe components when a recipe exists, otherwise the tracked item itself. */
  async stockPlan(companyId: string, lines: { itemId?: string | null; quantity: number }[]) {
    const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean) as string[])];
    const needed = new Map<string, number>();
    if (!ids.length) return needed;
    const [items, recipes] = await Promise.all([
      this.prisma.inventoryItem.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, type: true } }),
      this.prisma.recipeLine.findMany({ where: { companyId, parentItemId: { in: ids } } }),
    ]);
    for (const line of lines) {
      if (!line.itemId) continue;
      const parts = recipes.filter((r) => r.parentItemId === line.itemId);
      const item = items.find((i) => i.id === line.itemId);
      if (parts.length) {
        for (const part of parts) needed.set(part.componentItemId, (needed.get(part.componentItemId) || 0) + Number(part.quantity) * Number(line.quantity));
      } else if (item && isStockTracked(item.type)) {
        needed.set(line.itemId, (needed.get(line.itemId) || 0) + Number(line.quantity));
      }
    }
    return needed;
  }

  private async assertStock(companyId: string, warehouseId: string, needed: Map<string, number>) {
    if (!needed.size || (await this.stock.allowNegativeStock(companyId))) return;
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, id: { in: [...needed.keys()] } }, select: { id: true, name: true } });
    for (const [itemId, qty] of needed) {
      const bal = await this.stock.balance(companyId, itemId, warehouseId);
      if (bal.onHand + 0.0001 < qty) {
        const name = items.find((i) => i.id === itemId)?.name || 'an item';
        throw new BadRequestException(`Not enough stock for ${name}. ${Number(bal.onHand)} available, ${qty} needed.`);
      }
    }
  }

  /** Ledger codes for COGS and inventory per item, falling back to the chart defaults 5000 and 1200. */
  private async costAccounts(companyId: string, itemIds: string[]) {
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, id: { in: itemIds } }, select: { id: true, cogsAccountId: true, inventoryAssetAccountId: true } });
    const accountIds = items.flatMap((i) => [i.cogsAccountId, i.inventoryAssetAccountId]).filter(Boolean) as string[];
    const accounts = accountIds.length ? await this.prisma.ledgerAccount.findMany({ where: { companyId, id: { in: accountIds } }, select: { id: true, code: true } }) : [];
    const code = (id?: string | null) => accounts.find((a) => a.id === id)?.code;
    return new Map(items.map((i) => [i.id, { cogs: code(i.cogsAccountId) || '5000', inventory: code(i.inventoryAssetAccountId) || '1200' }]));
  }

  private costLines(totals: Map<string, { cogs: string; inventory: string; amount: number }>, reverse: boolean) {
    const debit = new Map<string, number>();
    const credit = new Map<string, number>();
    for (const row of totals.values()) {
      const dr = reverse ? row.inventory : row.cogs;
      const cr = reverse ? row.cogs : row.inventory;
      debit.set(dr, (debit.get(dr) || 0) + row.amount);
      credit.set(cr, (credit.get(cr) || 0) + row.amount);
    }
    return [
      ...[...debit].map(([code, amount]) => ({ code, debit: roundMoney(amount), credit: 0, description: reverse ? 'Inventory returned' : 'Cost of sales' })),
      ...[...credit].map(([code, amount]) => ({ code, debit: 0, credit: roundMoney(amount), description: reverse ? 'COGS reversal' : 'Inventory reduction' })),
    ].filter((l) => l.debit > 0 || l.credit > 0);
  }

  private async issueStock(companyId: string, invoiceId: string, invoiceNo: string, warehouseId: string, needed: Map<string, number>, userId: string) {
    if (!needed.size) {
      await this.prisma.salesInvoice.update({ where: { id: invoiceId }, data: { stockIssuedAt: new Date() } });
      return;
    }
    const accounts = await this.costAccounts(companyId, [...needed.keys()]);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.salesInvoice.updateMany({ where: { id: invoiceId, stockIssuedAt: null }, data: { stockIssuedAt: new Date() } });
      if (!claimed.count) return;
      const totals = new Map<string, { cogs: string; inventory: string; amount: number }>();
      for (const [itemId, qty] of needed) {
        const bal = await this.stock.balance(companyId, itemId, warehouseId, tx);
        const unitCost = Number(bal.avgCost || 0);
        await this.stock.create(companyId, { warehouseId, itemId, type: 'ISSUE', quantity: qty, unitCost, reference: invoiceNo, occurredAt: new Date() }, userId, tx);
        const acc = accounts.get(itemId) || { cogs: '5000', inventory: '1200' };
        totals.set(itemId, { ...acc, amount: unitCost * qty });
      }
      const lines = this.costLines(totals, false);
      if (lines.length) {
        await this.posting.postJournal(companyId, {
          date: new Date(), description: `COGS ${invoiceNo}`, reference: invoiceNo, sourceType: 'COGS_DIRECT_INVOICE', sourceId: invoiceId, userId, lines,
        }, tx);
      }
    }, { timeout: 30_000 });
  }

  private async fiscaliseSale(companyId: string, userId: string, saleId: string, invoiceId: string, branchId: string, deviceId?: string | null) {
    if (!deviceId) {
      const devices = await this.prisma.fiscalDevice.count({ where: { branchId } });
      return devices ? 'PENDING' : 'NOT_REQUIRED';
    }
    try {
      const receipt: any = await this.fiscal.fiscalise(companyId, deviceId, invoiceId);
      return receipt?.status === 'FISCALISED' ? 'FISCALISED' : 'SUBMITTED';
    } catch (err: any) {
      await this.audit.log(companyId, userId, 'POS_FISCAL_FAILED', 'PosSale', saleId, { module: 'pos', result: 'FAILURE', metadata: { error: err?.message } });
      return 'FAILED';
    }
  }

  /** Retry reuses the invoice's existing fiscal receipt, so it cannot create a second submission. */
  async retryFiscal(companyId: string, userId: string, saleId: string) {
    const sale = await this.prisma.posSale.findFirst({ where: { id: saleId, companyId } });
    if (!sale || sale.saleStatus !== 'POSTED' || !sale.invoiceId) throw new BadRequestException('Only a posted sale can be fiscalised');
    if (sale.fiscalStatus === 'FISCALISED') return sale;
    const settings = await this.prisma.posBranchSettings.findUnique({ where: { branchId: sale.branchId } });
    if (!settings?.fiscalDeviceId) throw new BadRequestException('Choose a fiscal device in POS settings for this branch');
    const fiscalStatus = await this.fiscaliseSale(companyId, userId, sale.id, sale.invoiceId, sale.branchId, settings.fiscalDeviceId);
    await this.audit.log(companyId, userId, 'POS_FISCAL_RETRY', 'PosSale', sale.id, { module: 'pos', result: fiscalStatus === 'FAILED' ? 'FAILURE' : 'SUCCESS', metadata: { fiscalStatus } });
    return this.prisma.posSale.update({ where: { id: sale.id }, data: { fiscalStatus: fiscalStatus as any }, include: { invoice: true } });
  }

  private async recordTenders(companyId: string, userId: string, saleId: string, invoiceId: string, customerId: string, tenders: any[], registerId?: string) {
    const register = registerId ? await this.prisma.posRegister.findFirst({ where: { id: registerId, companyId }, include: { ledgerAccount: true } }) : null;
    const cashCode = register?.ledgerAccount?.code || '1000';
    for (const [i, t] of tenders.entries()) {
      const status = t.method === 'CREDIT' ? 'AUTHORISED' : 'CAPTURED';
      let receiptId: string | undefined;
      if (t.method !== 'CREDIT' && t.applied > 0) {
        const receiptNo = await this.numbering.next(companyId, 'RCP');
        const receipt = await this.prisma.$transaction(async (tx) => {
          const r = await tx.receipt.create({
            data: {
              companyId, customerId, invoiceId, receiptNo, amount: t.applied, applied: t.applied, unapplied: 0,
              method: t.method, referenceNo: t.reference, depositAccountId: register?.ledgerAccountId || undefined,
              idempotencyKey: `${saleId}:${i}`, status: 'POSTED',
            },
          });
          await tx.paymentAllocation.create({ data: { receiptId: r.id, invoiceId, amountApplied: t.applied } });
          await this.posting.postJournal(companyId, {
            date: r.receiptDate, description: `Receipt ${receiptNo}`, reference: receiptNo, sourceType: 'RECEIPT', sourceId: r.id, userId,
            lines: [
              { code: cashCode, debit: t.applied, credit: 0, description: t.method },
              { code: '1100', debit: 0, credit: t.applied, description: 'Accounts receivable' },
            ],
          }, tx);
          return r;
        });
        receiptId = receipt.id;
        await this.invoiceStatus.recalc(companyId, invoiceId);
      }
      await this.prisma.posTender.create({ data: { saleId, method: t.method, amount: t.amount, changeAmount: t.changeAmount || 0, reference: t.reference, status: status as any, receiptId } });
    }
  }

  private async revertInvoice(companyId: string, invoiceId: string, userId: string, cause: any) {
    await this.prisma.$transaction(async (tx) => {
      const je = await tx.journalEntry.findFirst({ where: { companyId, sourceType: 'SALES_INVOICE', sourceId: invoiceId } });
      if (je) {
        await tx.journalLine.deleteMany({ where: { journalId: je.id } });
        await tx.journalEntry.delete({ where: { id: je.id } });
      }
      const cogs = await tx.journalEntry.findFirst({ where: { companyId, sourceType: 'COGS_DIRECT_INVOICE', sourceId: invoiceId } });
      if (cogs) {
        await tx.journalLine.deleteMany({ where: { journalId: cogs.id } });
        await tx.journalEntry.delete({ where: { id: cogs.id } });
      }
    }).catch(() => {});
    await this.audit.log(companyId, userId, 'POS_SALE_REVERTED', 'SalesInvoice', invoiceId, { module: 'pos', result: 'FAILURE', metadata: { error: cause?.message } });
  }

  /** Records a return. Users without refund approval create a pending request that posts nothing. */
  async returnSale(companyId: string, userId: string, saleId: string, body: any) {
    const sale = await this.prisma.posSale.findFirst({ where: { id: saleId, companyId }, include: { lines: true, returns: { include: { lines: true } } } });
    if (!sale || sale.saleStatus !== 'POSTED' || !sale.invoiceId) throw new BadRequestException('Only a posted sale can be refunded');
    const requested = body.lines || [];
    if (!requested.length) throw new BadRequestException('Choose lines to return');
    const reason = String(body.reason || '').trim();
    if (!reason) throw new BadRequestException('Enter a return reason');
    const refundMethod = String(body.refundMethod || 'CASH').toUpperCase();
    if (!['CASH', 'CARD', 'BANK', 'MOBILE', 'ACCOUNT'].includes(refundMethod)) throw new BadRequestException('Unknown refund method');
    if (EXTERNAL.has(refundMethod) && !body.refundReference) throw new BadRequestException(`${refundMethod} refunds need the reference from the payment terminal`);

    const already = new Map<string, number>();
    for (const ret of sale.returns) {
      if (ret.status === 'REJECTED') continue;
      for (const line of ret.lines) if (line.saleLineId) already.set(line.saleLineId, (already.get(line.saleLineId) || 0) + Number(line.quantity));
    }
    const lines = [];
    for (const req of requested) {
      const line = sale.lines.find((l) => l.id === req.saleLineId);
      if (!line || line.voided) throw new BadRequestException('Return line is not on this sale');
      const qty = Number(req.quantity);
      if (!(qty > 0)) continue;
      const left = Number(line.quantity) - (already.get(line.id) || 0);
      if (qty > left + 0.0001) throw new BadRequestException(`Only ${Math.max(left, 0)} can be returned for ${line.description}`);
      const ratio = qty / Number(line.quantity);
      lines.push({ saleLineId: line.id, itemId: line.itemId, description: line.description, quantity: qty, amount: roundMoney(Number(line.lineTotal) * ratio) });
    }
    if (!lines.length) throw new BadRequestException('Choose a quantity to return');
    const total = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
    const returnNo = await this.numbering.next(companyId, 'PRT');
    const ret = await this.prisma.posReturn.create({
      data: {
        companyId, saleId, returnNo, reason, total, createdById: userId, status: 'PENDING_APPROVAL',
        refundMethod, refundReference: body.refundReference || null, lines: { create: lines },
      },
      include: { lines: true },
    });
    await this.audit.log(companyId, userId, 'POS_RETURN_REQUESTED', 'PosReturn', ret.id, { module: 'pos', result: 'SUCCESS', metadata: { returnNo, saleNo: sale.saleNo, total } });
    if (!body.canApprove) return ret;
    return this.approveReturn(companyId, userId, ret.id);
  }

  async rejectReturn(companyId: string, userId: string, returnId: string) {
    const ret = await this.prisma.posReturn.findFirst({ where: { id: returnId, companyId } });
    if (!ret || ret.status !== 'PENDING_APPROVAL') throw new BadRequestException('Only a pending return can be rejected');
    await this.audit.log(companyId, userId, 'POS_RETURN_REJECTED', 'PosReturn', ret.id, { module: 'pos', result: 'SUCCESS' });
    return this.prisma.posReturn.update({ where: { id: ret.id }, data: { status: 'REJECTED', approvedById: userId, approvedAt: new Date() } });
  }

  async approveReturn(companyId: string, userId: string, returnId: string) {
    const claimed = await this.prisma.posReturn.updateMany({ where: { id: returnId, companyId, status: 'PENDING_APPROVAL' }, data: { status: 'POSTING' } });
    if (!claimed.count) throw new ConflictException('This return is not waiting for approval');
    const ret = await this.prisma.posReturn.findFirstOrThrow({ where: { id: returnId }, include: { lines: true } });
    const sale = await this.prisma.posSale.findFirstOrThrow({ where: { id: ret.saleId, companyId }, include: { lines: true, tenders: true, invoice: true, returns: true } });
    let creditPosted = false;
    try {
      const creditLines = ret.lines.map((l) => {
        const line = sale.lines.find((s) => s.id === l.saleLineId)!;
        const ratio = Number(l.quantity) / Number(line.quantity);
        const taxAmount = roundMoney(Number(line.taxAmount) * ratio);
        const lineTotal = Number(l.amount);
        return { description: l.description, itemId: l.itemId, quantity: Number(l.quantity), unitPrice: roundMoney((lineTotal - taxAmount) / Number(l.quantity)), taxRate: Number(line.taxRate), taxAmount, lineTotal };
      });
      const taxTotal = roundMoney(creditLines.reduce((s, l) => s + l.taxAmount, 0));
      const total = Number(ret.total);
      const subtotal = roundMoney(total - taxTotal);
      const creditNoteNo = await this.numbering.next(companyId, 'CN');
      const cn = await this.prisma.creditNote.create({
        data: { companyId, customerId: sale.customerId, invoiceId: sale.invoiceId, creditNoteNo, reason: ret.reason || 'POS return', subtotal, taxTotal, total, lines: { create: creditLines } },
      });
      await this.posting.postCreditNote(companyId, cn.id, userId);
      creditPosted = true;
      await this.prisma.posReturn.update({ where: { id: ret.id }, data: { creditNoteId: cn.id } });

      if (sale.warehouseId) await this.restoreStock(companyId, userId, sale.warehouseId, ret.returnNo, ret.id, sale.invoice?.invoiceNo, creditLines);

      const paid = sale.tenders.filter((t) => t.status === 'CAPTURED').reduce((s, t) => s + Number(t.amount) - Number(t.changeAmount), 0);
      const refundedBefore = sale.returns.filter((r) => r.status === 'POSTED').reduce((s, r) => s + Number(r.refundAmount || 0), 0);
      const refundable = roundMoney(Math.max(0, paid - refundedBefore));
      const refundAmount = ret.refundMethod === 'ACCOUNT' ? 0 : roundMoney(Math.min(total, refundable));
      if (refundAmount > 0) await this.postRefund(companyId, userId, sale, ret, refundAmount);

      let fiscalStatus: string | null = null;
      const settings = await this.prisma.posBranchSettings.findUnique({ where: { branchId: sale.branchId } });
      if (settings?.fiscalDeviceId && sale.invoice?.fiscalStatus === 'FISCALISED') {
        try {
          await this.fiscal.fiscaliseCreditNote(companyId, settings.fiscalDeviceId, cn.id);
          fiscalStatus = 'FISCALISED';
        } catch (err: any) {
          fiscalStatus = 'FAILED';
          await this.audit.log(companyId, userId, 'POS_RETURN_FISCAL_FAILED', 'PosReturn', ret.id, { module: 'pos', result: 'FAILURE', metadata: { error: err?.message } });
        }
      }

      const returnedQty = new Map<string, number>();
      const posted = await this.prisma.posReturn.findMany({ where: { saleId: sale.id, status: { in: ['POSTED', 'POSTING'] } }, include: { lines: true } });
      for (const r of posted) for (const l of r.lines) if (l.saleLineId) returnedQty.set(l.saleLineId, (returnedQty.get(l.saleLineId) || 0) + Number(l.quantity));
      const fullyReturned = sale.lines.filter((l) => !l.voided).every((l) => (returnedQty.get(l.id) || 0) + 0.0001 >= Number(l.quantity));
      if (fullyReturned) {
        assertTransition('sale', sale.saleStatus, 'REVERSED');
        await this.prisma.posSale.update({ where: { id: sale.id }, data: { saleStatus: 'REVERSED' } });
      }
      await this.audit.log(companyId, userId, 'POS_RETURN_POSTED', 'PosReturn', ret.id, { module: 'pos', result: 'SUCCESS', metadata: { creditNoteNo, refundAmount, fiscalStatus } });
      return this.prisma.posReturn.update({
        where: { id: ret.id },
        data: { status: 'POSTED', refundAmount, taxTotal, approvedById: userId, approvedAt: new Date(), fiscalStatus },
        include: { lines: true },
      });
    } catch (e) {
      await this.prisma.posReturn.update({ where: { id: ret.id }, data: { status: creditPosted ? 'RECONCILIATION_REQUIRED' : 'PENDING_APPROVAL' } }).catch(() => {});
      throw e;
    }
  }

  /** Money paid back to the customer: Dr receivables, Cr the register's cash or bank account. */
  private async postRefund(companyId: string, userId: string, sale: any, ret: any, amount: number) {
    const register = sale.registerId ? await this.prisma.posRegister.findFirst({ where: { id: sale.registerId, companyId }, include: { ledgerAccount: true } }) : null;
    const cashCode = register?.ledgerAccount?.code || '1000';
    await this.prisma.$transaction(async (tx) => {
      await this.posting.postJournal(companyId, {
        date: new Date(), description: `POS refund ${ret.returnNo}`, reference: ret.returnNo, sourceType: 'POS_REFUND', sourceId: ret.id, userId,
        lines: [
          { code: '1100', debit: amount, credit: 0, description: 'Customer refund' },
          { code: cashCode, debit: 0, credit: amount, description: `${ret.refundMethod} refund` },
        ],
      }, tx);
      if (ret.refundMethod === 'CASH' && sale.registerId) {
        const shift = await tx.posShift.findFirst({ where: { companyId, registerId: sale.registerId, status: 'OPEN' } });
        if (shift) {
          await tx.posCashMovement.create({ data: { shiftId: shift.id, kind: 'REFUND', amount, note: ret.returnNo, createdById: userId } });
          await tx.posShift.update({ where: { id: shift.id }, data: { expectedCash: { decrement: amount } } });
        }
      }
    });
    if (sale.invoiceId) await this.invoiceStatus.recalc(companyId, sale.invoiceId).catch(() => {});
  }

  async returns(companyId: string, q: { status?: string }) {
    return this.prisma.posReturn.findMany({
      where: { companyId, ...(q.status ? { status: q.status } : {}) },
      include: { lines: true, sale: { select: { saleNo: true, currency: true, customer: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async registers(companyId: string, branchId?: string) {
    return this.prisma.posRegister.findMany({ where: { companyId, ...(branchId ? { branchId } : {}) }, include: { shifts: { where: { status: { in: ['OPEN', 'CLOSING'] } }, take: 1, include: { user: { select: { firstName: true, lastName: true } } } } }, orderBy: { name: 'asc' } });
  }

  async saveRegister(companyId: string, body: any) {
    await this.branchInCompany(companyId, body.branchId);
    if (body.ledgerAccountId) {
      const acc = await this.prisma.ledgerAccount.findFirst({ where: { id: body.ledgerAccountId, companyId } });
      if (!acc) throw new BadRequestException('Ledger account not found');
    }
    if (body.id) return this.prisma.posRegister.updateMany({ where: { id: body.id, companyId }, data: { name: body.name, ledgerAccountId: body.ledgerAccountId || null, defaultMode: body.defaultMode, active: body.active ?? true } });
    const code = body.code || await this.numbering.next(companyId, 'REG');
    return this.prisma.posRegister.create({ data: { companyId, branchId: body.branchId, code, name: body.name || code, ledgerAccountId: body.ledgerAccountId || null, defaultMode: body.defaultMode || 'RETAIL' } });
  }

  async openShift(companyId: string, userId: string, body: any) {
    const register = await this.prisma.posRegister.findFirst({ where: { id: body.registerId, companyId, active: true } });
    if (!register) throw new BadRequestException('Register not found');
    const openingFloat = roundMoney(body.openingFloat || 0);
    if (openingFloat < 0) throw new BadRequestException('Opening float cannot be negative');
    const shift = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-register:${register.id}`}))`;
      const open = await tx.posShift.findFirst({ where: { registerId: register.id, status: { in: ['OPEN', 'CLOSING'] } } });
      if (open) throw new ConflictException(open.status === 'OPEN' ? 'This register already has an open shift' : 'The last shift on this register is waiting for manager approval');
      return tx.posShift.create({ data: { companyId, registerId: register.id, userId, openingFloat, expectedCash: openingFloat } });
    });
    await this.audit.log(companyId, userId, 'POS_SHIFT_OPENED', 'PosShift', shift.id, { module: 'pos', result: 'SUCCESS', metadata: { register: register.code, openingFloat } });
    return shift;
  }

  async cashMove(companyId: string, userId: string, shiftId: string, body: any) {
    const shift = await this.prisma.posShift.findFirst({ where: { id: shiftId, companyId, status: 'OPEN' } });
    if (!shift) throw new BadRequestException('Shift is not open');
    const kind = String(body.kind || '').toUpperCase();
    if (!['IN', 'OUT'].includes(kind)) throw new BadRequestException('Cash movement must be IN or OUT');
    const amount = roundMoney(body.amount);
    if (!(amount > 0)) throw new BadRequestException('Amount must be greater than zero');
    if (!String(body.note || '').trim()) throw new BadRequestException('Enter a reason for the cash movement');
    const signed = kind === 'IN' ? amount : -amount;
    const [row] = await this.prisma.$transaction([
      this.prisma.posCashMovement.create({ data: { shiftId, kind, amount, note: body.note, createdById: userId } }),
      this.prisma.posShift.update({ where: { id: shiftId }, data: { expectedCash: { increment: signed } } }),
    ]);
    return row;
  }

  /** Expected drawer cash: float, cash sales net of change, and every recorded cash movement. */
  async shiftCash(companyId: string, shiftId: string) {
    const shift = await this.prisma.posShift.findFirst({
      where: { id: shiftId, companyId },
      include: { movements: true, sales: { where: { saleStatus: { in: ['POSTED', 'REVERSED'] } }, include: { tenders: true } } },
    });
    if (!shift) throw new BadRequestException('Shift not found');
    const cashSales = roundMoney(shift.sales.flatMap((s) => s.tenders)
      .filter((t) => t.method === 'CASH' && t.kind === 'PAYMENT' && t.status === 'CAPTURED')
      .reduce((s, t) => s + Number(t.amount) - Number(t.changeAmount), 0));
    const sign: Record<string, number> = { IN: 1, DEPOSIT: 1, OUT: -1, REFUND: -1 };
    const movements = roundMoney(shift.movements.reduce((s, m) => s + (sign[m.kind] ?? 0) * Number(m.amount), 0));
    const byTender: Record<string, number> = {};
    for (const t of shift.sales.flatMap((s) => s.tenders)) if (t.status === 'CAPTURED') byTender[t.method] = roundMoney((byTender[t.method] || 0) + Number(t.amount) - Number(t.changeAmount));
    return { shift, cashSales, movements, byTender, expected: roundMoney(Number(shift.openingFloat) + cashSales + movements) };
  }

  /** A counted difference parks the shift in CLOSING until a manager approves it. */
  async closeShift(companyId: string, userId: string, shiftId: string, body: any) {
    const { shift, expected } = await this.shiftCash(companyId, shiftId);
    if (shift.status !== 'OPEN') throw new BadRequestException('Only an open shift can be counted');
    const pending = await this.prisma.posSale.count({ where: { shiftId, saleStatus: 'PENDING_PAYMENT' } });
    if (pending) throw new BadRequestException(`${pending} sale(s) on this shift still need their payment finished`);
    if (body.actualCash == null || Number.isNaN(Number(body.actualCash))) throw new BadRequestException('Enter the counted cash');
    const actual = roundMoney(body.actualCash);
    const variance = roundMoney(actual - expected);
    const balanced = Math.abs(variance) <= 0.009;
    const status = balanced || body.approveVariance ? 'CLOSED' : 'CLOSING';
    assertTransition('shift', shift.status, status);
    const row = await this.prisma.posShift.update({
      where: { id: shiftId },
      data: { status: status as any, actualCash: actual, expectedCash: expected, variance, note: body.note, closedAt: status === 'CLOSED' ? new Date() : null },
    });
    await this.audit.log(companyId, userId, status === 'CLOSED' ? 'POS_SHIFT_CLOSED' : 'POS_SHIFT_VARIANCE', 'PosShift', shiftId, { module: 'pos', result: 'SUCCESS', metadata: { expected, actual, variance } });
    return row;
  }

  async approveShift(companyId: string, userId: string, shiftId: string, note?: string) {
    const shift = await this.prisma.posShift.findFirst({ where: { id: shiftId, companyId } });
    if (!shift) throw new BadRequestException('Shift not found');
    if (shift.status !== 'CLOSING') throw new BadRequestException('Only a shift waiting for approval can be approved');
    assertTransition('shift', shift.status, 'CLOSED');
    await this.audit.log(companyId, userId, 'POS_SHIFT_VARIANCE_APPROVED', 'PosShift', shiftId, { module: 'pos', result: 'SUCCESS', metadata: { variance: Number(shift.variance) } });
    return this.prisma.posShift.update({ where: { id: shiftId }, data: { status: 'CLOSED', closedAt: new Date(), note: [shift.note, note && `Approved: ${note}`].filter(Boolean).join(' · ') || null } });
  }

  async reopenShift(companyId: string, userId: string, shiftId: string) {
    const shift = await this.prisma.posShift.findFirst({ where: { id: shiftId, companyId } });
    if (!shift || shift.status !== 'CLOSING') throw new BadRequestException('Only a shift waiting for approval can be recounted');
    assertTransition('shift', shift.status, 'OPEN');
    return this.prisma.posShift.update({ where: { id: shiftId }, data: { status: 'OPEN', actualCash: null, variance: null } });
  }

  async shifts(companyId: string, branchId?: string) {
    return this.prisma.posShift.findMany({
      where: { companyId, ...(branchId ? { register: { branchId } } : {}) },
      include: { register: true, user: { select: { firstName: true, lastName: true, email: true } }, movements: true },
      orderBy: { openedAt: 'desc' },
      take: 50,
    });
  }

  /** Table occupancy comes from open orders on the server, not from the stored status alone. */
  async areas(companyId: string, branchId: string) {
    await this.branchInCompany(companyId, branchId);
    const areas = await this.prisma.diningArea.findMany({
      where: { companyId, branchId },
      include: {
        tables: {
          orderBy: { code: 'asc' },
          include: {
            sales: {
              where: { saleStatus: { in: ['DRAFT', 'PENDING_PAYMENT'] }, cartStatus: { not: 'ABANDONED' }, orderStatus: { not: 'CANCELLED' } },
              select: { id: true, saleNo: true, total: true, orderStatus: true, createdAt: true, assignedEmployee: { select: { firstName: true, lastName: true } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return areas.map((area) => ({
      ...area,
      tables: area.tables.map(({ sales, ...table }) => ({
        ...table,
        openOrders: sales,
        status: sales.length ? 'OCCUPIED' : table.status === 'OCCUPIED' ? 'AVAILABLE' : table.status,
      })),
    }));
  }

  async saveArea(companyId: string, body: any) {
    await this.branchInCompany(companyId, body.branchId);
    return this.prisma.diningArea.create({ data: { companyId, branchId: body.branchId, name: body.name } });
  }

  async saveTable(companyId: string, body: any) {
    await this.branchInCompany(companyId, body.branchId);
    return this.prisma.restaurantTable.create({ data: { companyId, branchId: body.branchId, areaId: body.areaId || null, code: body.code, name: body.name || body.code, capacity: Number(body.capacity || 2) } });
  }

  async setTableStatus(companyId: string, id: string, status: string) {
    const table = await this.prisma.restaurantTable.findFirst({ where: { id, companyId } });
    if (!table) throw new BadRequestException('Table not found');
    return this.prisma.restaurantTable.update({ where: { id }, data: { status: status as any } });
  }

  /** Sends only lines that have not been fired yet, so adding items to an order creates a new ticket. */
  async sendKitchen(companyId: string, saleId: string, stationId?: string) {
    const sale = await this.editableOrder(companyId, saleId);
    if (sale.mode !== 'RESTAURANT') throw new BadRequestException('Only restaurant orders go to the kitchen');
    if (stationId) {
      const station = await this.prisma.kitchenStation.findFirst({ where: { id: stationId, companyId, branchId: sale.branchId } });
      if (!station) throw new BadRequestException('Kitchen station not found');
    }
    const unsent = sale.lines.filter((l) => !l.voided && !l.sentAt);
    if (!unsent.length) throw new BadRequestException('Nothing new to send to the kitchen');
    if (sale.orderStatus !== 'IN_PREPARATION') assertTransition('order', sale.orderStatus, 'IN_PREPARATION');
    const sentAt = new Date();
    const ticket = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.posSaleLine.updateMany({ where: { id: { in: unsent.map((l) => l.id) }, sentAt: null }, data: { sentAt } });
      if (claimed.count !== unsent.length) throw new ConflictException('These items were just sent from another device');
      const created = await tx.kitchenTicket.create({
        data: {
          saleId, stationId: stationId || null,
          lines: { create: unsent.map((l) => ({ description: l.description, quantity: l.quantity, modifiers: l.modifiers || undefined, notes: l.notes })) },
        },
        include: { lines: true, sale: { include: { table: true } } },
      });
      await tx.posSale.update({ where: { id: saleId }, data: { orderStatus: 'IN_PREPARATION' } });
      if (sale.tableId) await tx.restaurantTable.update({ where: { id: sale.tableId }, data: { status: 'OCCUPIED' } });
      return created;
    });
    return ticket;
  }

  async kitchen(companyId: string, branchId?: string) {
    return this.prisma.kitchenTicket.findMany({
      where: { sale: { companyId, ...(branchId ? { branchId } : {}) }, status: { in: ['QUEUED', 'PREPARING', 'READY'] } },
      include: { lines: true, station: true, sale: { include: { table: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async kitchenStatus(companyId: string, userId: string, id: string, status: string, canCancel: boolean) {
    const ticket = await this.prisma.kitchenTicket.findFirst({ where: { id, sale: { companyId } }, include: { sale: true } });
    if (!ticket) throw new BadRequestException('Ticket not found');
    if (status === 'CANCELLED' && !canCancel) throw new BadRequestException('Only a manager can cancel a kitchen ticket');
    assertTransition('kitchen', ticket.status, status);
    const updated = await this.prisma.kitchenTicket.updateMany({ where: { id, status: ticket.status }, data: { status: status as any } });
    if (!updated.count) throw new ConflictException('This ticket was just updated on another screen');
    if (status === 'CANCELLED') await this.audit.log(companyId, userId, 'POS_KITCHEN_CANCELLED', 'KitchenTicket', id, { module: 'pos', result: 'SUCCESS', metadata: { saleId: ticket.saleId } });
    if (ticket.sale.saleStatus === 'DRAFT' && ['READY', 'COMPLETED', 'CANCELLED'].includes(status)) {
      const open = await this.prisma.kitchenTicket.count({ where: { saleId: ticket.saleId, status: { in: ['QUEUED', 'PREPARING'] } } });
      const ready = await this.prisma.kitchenTicket.count({ where: { saleId: ticket.saleId, status: 'READY' } });
      if (!open && ready && ticket.sale.orderStatus === 'IN_PREPARATION') {
        await this.prisma.posSale.update({ where: { id: ticket.saleId }, data: { orderStatus: 'READY' } });
      }
    }
    return this.prisma.kitchenTicket.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  }

  async stations(companyId: string, branchId: string) {
    return this.prisma.kitchenStation.findMany({ where: { companyId, branchId }, orderBy: { name: 'asc' } });
  }

  async saveStation(companyId: string, body: any) {
    await this.branchInCompany(companyId, body.branchId);
    if (!String(body.name || '').trim()) throw new BadRequestException('Station name is required');
    return this.prisma.kitchenStation.create({ data: { companyId, branchId: body.branchId, name: String(body.name).trim() } });
  }

  async saveRecipe(companyId: string, body: any) {
    const parent = await this.prisma.inventoryItem.findFirst({ where: { id: body.parentItemId, companyId } });
    const component = await this.prisma.inventoryItem.findFirst({ where: { id: body.componentItemId, companyId } });
    if (!parent || !component) throw new BadRequestException('Recipe items must belong to this company');
    if (!isStockTracked(component.type)) throw new BadRequestException('Recipe components must be inventory products');
    return this.prisma.recipeLine.upsert({
      where: { parentItemId_componentItemId: { parentItemId: parent.id, componentItemId: component.id } },
      create: { companyId, parentItemId: parent.id, componentItemId: component.id, quantity: body.quantity },
      update: { quantity: body.quantity },
    });
  }

  async saveModifier(companyId: string, body: any) {
    if (body.itemId) {
      const item = await this.prisma.inventoryItem.findFirst({ where: { id: body.itemId, companyId } });
      if (!item) throw new BadRequestException('Menu item not found');
    }
    return this.prisma.menuModifierGroup.create({
      data: { companyId, itemId: body.itemId || null, name: body.name, required: !!body.required, modifiers: { create: (body.modifiers || []).map((m: any) => ({ name: m.name, priceDelta: m.priceDelta || 0 })) } },
      include: { modifiers: true },
    });
  }

  /**
   * Figures come from completed sales and their posted journals. Returns are counted in the
   * period they were approved, and profit is on tax-exclusive amounts.
   */
  async summary(companyId: string, q: { from?: string; to?: string; branchId?: string; mode?: string; cashierId?: string; registerId?: string; method?: string }) {
    const range = q.from || q.to ? { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } : undefined;
    const scope: any = { companyId };
    if (q.branchId) scope.branchId = q.branchId;
    if (q.mode) scope.mode = q.mode;
    if (q.cashierId) scope.createdById = q.cashierId;
    if (q.registerId) scope.registerId = q.registerId;
    if (q.method) scope.tenders = { some: { method: q.method, status: 'CAPTURED' } };
    const where: any = { ...scope, saleStatus: { in: ['POSTED', 'REVERSED'] }, ...(range ? { completedAt: range } : {}) };
    const sales = await this.prisma.posSale.findMany({ where, include: { tenders: true, lines: true } });
    const invoiceIds = sales.map((s) => s.invoiceId).filter(Boolean) as string[];
    const debit = (rows: { lines: { debit: any }[] }[]) => rows.reduce((s, j) => s + j.lines.reduce((a, l) => a + Number(l.debit), 0), 0);
    const cogs = invoiceIds.length ? debit(await this.prisma.journalEntry.findMany({ where: { companyId, sourceType: 'COGS_DIRECT_INVOICE', sourceId: { in: invoiceIds } }, include: { lines: true } })) : 0;
    const returns = await this.prisma.posReturn.findMany({
      where: { companyId, status: 'POSTED', sale: scope, ...(range ? { approvedAt: range } : {}) },
      select: { id: true, total: true, taxTotal: true, refundAmount: true, refundMethod: true },
    });
    const returnCogs = returns.length ? debit(await this.prisma.journalEntry.findMany({ where: { companyId, sourceType: 'POS_RETURN_COGS', sourceId: { in: returns.map((r) => r.id) } }, include: { lines: true } })) : 0;

    const byMethod: Record<string, number> = {};
    const byMode: Record<string, { count: number; total: number }> = {};
    const byHour: Record<string, number> = {};
    const byCashier: Record<string, { count: number; total: number }> = {};
    const items = new Map<string, { description: string; quantity: number; total: number }>();
    for (const sale of sales) {
      for (const t of sale.tenders) if (t.status === 'CAPTURED') byMethod[t.method] = roundMoney((byMethod[t.method] || 0) + Number(t.amount) - Number(t.changeAmount));
      const m = (byMode[sale.mode] ||= { count: 0, total: 0 });
      m.count++; m.total = roundMoney(m.total + Number(sale.total));
      const hour = String((sale.completedAt || sale.createdAt).getHours()).padStart(2, '0');
      byHour[hour] = roundMoney((byHour[hour] || 0) + Number(sale.total));
      const c = (byCashier[sale.createdById || 'unknown'] ||= { count: 0, total: 0 });
      c.count++; c.total = roundMoney(c.total + Number(sale.total));
      for (const l of sale.lines) {
        if (l.voided) continue;
        const key = l.itemId || l.description;
        const row = items.get(key) || { description: l.description, quantity: 0, total: 0 };
        row.quantity += Number(l.quantity); row.total = roundMoney(row.total + Number(l.lineTotal));
        items.set(key, row);
      }
    }
    const users = await this.prisma.user.findMany({ where: { id: { in: Object.keys(byCashier) } }, select: { id: true, firstName: true, lastName: true, email: true } });
    const name = (id: string) => { const u = users.find((x) => x.id === id); return u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email : 'Unknown'; };

    const gross = sales.reduce((s, sale) => s + Number(sale.total), 0);
    const tax = sales.reduce((s, sale) => s + Number(sale.taxTotal), 0);
    const returnTotal = returns.reduce((s, r) => s + Number(r.total), 0);
    const returnTax = returns.reduce((s, r) => s + Number(r.taxTotal), 0);
    const netSales = gross - tax - (returnTotal - returnTax);
    const netCogs = cogs - returnCogs;
    const [pendingReturns, pendingPayment, openShifts] = await Promise.all([
      this.prisma.posReturn.count({ where: { companyId, status: { in: ['PENDING_APPROVAL', 'RECONCILIATION_REQUIRED'] }, sale: scope } }),
      this.prisma.posSale.count({ where: { ...scope, saleStatus: 'PENDING_PAYMENT', invoiceId: { not: null } } }),
      this.prisma.posShift.count({ where: { companyId, status: { in: ['OPEN', 'CLOSING'] }, ...(q.registerId ? { registerId: q.registerId } : {}) } }),
    ]);
    return {
      transactions: sales.length,
      revenue: roundMoney(gross),
      average: sales.length ? roundMoney(gross / sales.length) : 0,
      discounts: roundMoney(sales.reduce((s, sale) => s + Number(sale.discountTotal), 0)),
      tax: roundMoney(tax - returnTax),
      netSales: roundMoney(netSales),
      cogs: roundMoney(netCogs),
      grossProfit: roundMoney(netSales - netCogs),
      margin: netSales ? roundMoney(((netSales - netCogs) / netSales) * 100) : 0,
      refunds: roundMoney(returnTotal),
      refundsPaid: roundMoney(returns.reduce((s, r) => s + Number(r.refundAmount), 0)),
      refundCount: returns.length,
      byMethod,
      byMode,
      byHour,
      byCashier: Object.entries(byCashier).map(([id, v]) => ({ id, name: name(id), ...v })).sort((a, b) => b.total - a.total),
      topItems: [...items.values()].sort((a, b) => b.total - a.total).slice(0, 10),
      fiscalFailed: sales.filter((s) => s.fiscalStatus === 'FAILED').length,
      fiscalPending: sales.filter((s) => s.fiscalStatus === 'PENDING').length,
      pendingReturns,
      pendingPayment,
      openShifts,
    };
  }

  /** Returned goods come back at the cost they were issued at, so COGS reverses exactly. */
  private async restoreStock(companyId: string, userId: string, warehouseId: string, returnNo: string, returnId: string, invoiceNo: string | undefined, lines: { itemId?: string | null; quantity: number }[]) {
    const needed = await this.stockPlan(companyId, lines);
    if (!needed.size) return;
    const accounts = await this.costAccounts(companyId, [...needed.keys()]);
    const issues = invoiceNo
      ? await this.prisma.stockMovement.findMany({ where: { warehouseId, reference: invoiceNo, type: 'ISSUE', itemId: { in: [...needed.keys()] } } })
      : [];
    await this.prisma.$transaction(async (tx) => {
      const totals = new Map<string, { cogs: string; inventory: string; amount: number }>();
      for (const [itemId, qty] of needed) {
        const issued = issues.find((m) => m.itemId === itemId);
        const unitCost = issued ? Number(issued.unitCost) : Number((await this.stock.balance(companyId, itemId, warehouseId, tx)).avgCost || 0);
        await this.stock.create(companyId, { warehouseId, itemId, type: 'RETURN_IN', quantity: qty, unitCost, reference: returnNo }, userId, tx);
        const acc = accounts.get(itemId) || { cogs: '5000', inventory: '1200' };
        totals.set(itemId, { ...acc, amount: unitCost * qty });
      }
      const lines = this.costLines(totals, true);
      if (lines.length) {
        await this.posting.postJournal(companyId, {
          date: new Date(), description: `POS return ${returnNo}`, reference: returnNo, sourceType: 'POS_RETURN_COGS', sourceId: returnId, userId, lines,
        }, tx);
      }
    }, { timeout: 30_000 });
  }

  private async saleInCompany(companyId: string, id: string) {
    const sale = await this.prisma.posSale.findFirst({ where: { id, companyId }, include: { lines: true, tenders: true } });
    if (!sale) throw new BadRequestException('Sale not found');
    return sale;
  }

  private async branchInCompany(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, companyId } });
    if (!branch) throw new BadRequestException('Branch not found');
    return branch;
  }
}
