import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { companyIdOf } from '../../core/context';
import { CreateGrnDto, CreatePurchaseOrderDto, CreateRequisitionDto, CreateSupplierInvoiceDto, CreateSupplierPaymentDto, SupplierDto, UpdatePurchaseOrderDto } from './procurement.dto';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { PostingService } from '../finance/posting.service';
import { StatusDto } from '../sales/sales.dto';
import { getTransactionPostingMode } from '../finance/transaction-mode';
import { ApprovalService } from '../approvals/approval.service';
import { InventoryMovementService } from '../inventory/inventory-movement.service';
import { ItemResolverService } from '../inventory/item-resolver.service';
import { isStockTracked, normalizeItemType, ITEM_TYPE } from '../inventory/item-type';

@ApiTags('Procurement') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('procurement')
export class ProcurementController {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService, private posting: PostingService, private approvals: ApprovalService, private stock: InventoryMovementService, private items: ItemResolverService) {}

  private async accountByCode(companyId: string, id?: string) {
    if (!id) return { code: '1000', name: 'Cash / Bank' };
    const acc = await this.prisma.ledgerAccount.findFirst({ where: { id, companyId } });
    if (!acc) throw new BadRequestException('Pay-from account not found');
    return { code: acc.code, name: acc.name };
  }
  // A bill line account must be a posting-destination type (EXPENSE/ASSET) — never AP/bank/equity/receivable.
  private async validateLineAccount(companyId: string, accountId?: string): Promise<{ id: string; code: string } | null> {
    if (!accountId) return null;
    const acc = await this.prisma.ledgerAccount.findFirst({ where: { id: accountId, companyId } });
    if (!acc) throw new BadRequestException('Line account not found');
    const t = String(acc.type || '').toUpperCase();
    if (!['ASSET', 'EXPENSE'].includes(t)) throw new BadRequestException(`Account ${acc.code} ${acc.name} is not a valid bill-line account (choose EXPENSE or ASSET).`);
    const name = `${acc.code} ${acc.name}`.toLowerCase();
    if (/payable|receivable|equity|capital|retained|vat|tax payable|cash|bank|petty/.test(name)) throw new BadRequestException(`Account ${acc.code} ${acc.name} cannot be used as a bill-line account.`);
    return { id: acc.id, code: acc.code };
  }
  private computeLines(lines: any[]) {
    let subtotal = 0, taxTotal = 0;
    const mapped = lines.map((l) => {
      const qty = Number(l.quantity || 0);
      const rate = Number(l.unitPrice ?? l.estimatedCost ?? 0);
      const discount = Number(l.discount || 0);
      const net = qty * rate * (1 - discount / 100);
      const taxRate = Number(l.taxRate || 0);
      const tax = net * taxRate / 100;
      subtotal += net;
      taxTotal += tax;
      return { ...l, quantity: qty, unitPrice: rate, estimatedCost: rate, discount, taxRate, taxAmount: Number(tax.toFixed(2)), lineTotal: Number((net + tax).toFixed(2)) };
    });
    return { mapped, subtotal: Number(subtotal.toFixed(2)), taxTotal: Number(taxTotal.toFixed(2)), total: Number((subtotal + taxTotal).toFixed(2)) };
  }
  private nameOf(req: any) { return req.user?.name || req.user?.email || 'System'; }

  // ----- Suppliers -----
  @Get('suppliers') async suppliers(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const list = await this.prisma.supplier.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
    const invoices = await this.prisma.supplierInvoice.findMany({ where: { companyId, status: { not: 'DRAFT' }, supplierId: { in: list.map((s) => s.id) } }, select: { supplierId: true, total: true, amountPaid: true, status: true } });
    const bal: Record<string, number> = {};
    for (const i of invoices) { if (i.status === 'VOID') continue; bal[i.supplierId] = (bal[i.supplierId] || 0) + Math.max(0, Number(i.total) - Number(i.amountPaid)); }
    return list.map((s) => ({ ...s, outstanding: Number((bal[s.id] || 0).toFixed(2)) }));
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.suppliers.manage')
  @Post('suppliers') async createSupplier(@Req() req: any, @Body() dto: SupplierDto) {
    const companyId = companyIdOf(req.user);
    const { code, ...rest } = dto;
    const supplier = await this.prisma.supplier.create({ data: { companyId, code: code || await this.numbering.next(companyId, 'SUP'), ...rest } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Supplier', supplier.id, { code: supplier.code });
    return supplier;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.suppliers.manage')
  @Patch('suppliers/:id') updateSupplier(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<SupplierDto>) {
    return this.prisma.supplier.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: dto });
  }
  @Get('suppliers/:id') async supplierDetail(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const supplier = await this.prisma.supplier.findFirst({ where: { id, companyId } });
    if (!supplier) throw new Error('Supplier not found');
    const [orders, grns, invoices] = await Promise.all([
      this.prisma.purchaseOrder.findMany({ where: { companyId, supplierId: id }, include: { lines: true }, orderBy: { orderDate: 'desc' } }),
      this.prisma.goodsReceivedNote.findMany({ where: { companyId, supplierId: id }, include: { purchaseOrder: true, lines: true }, orderBy: { receivedAt: 'desc' } }),
      this.prisma.supplierInvoice.findMany({ where: { companyId, supplierId: id }, include: { lines: true, payments: true }, orderBy: { invoiceDate: 'desc' } }),
    ]);
    const invoiceIds = invoices.map((i) => i.id);
    const orderIds = orders.map((o) => o.id);
    const payments = await this.prisma.supplierPayment.findMany({ where: { companyId, OR: [{ supplierInvoiceId: { in: invoiceIds } }, { purchaseOrderId: { in: orderIds } }, { supplierId: id }] }, include: { allocations: { include: { supplierInvoice: true } }, supplierInvoice: true, supplier: true } });
    const resolvedInvoices = [];
    for (const i of invoices) { const r = await this.resolveBill(i); resolvedInvoices.push({ ...i, status: r.documentStatus, documentStatus: r.documentStatus, amountPaid: r.paid, balanceDue: r.remaining, remaining: r.remaining, paymentStatus: r.paymentStatus }); }
    const outstanding = resolvedInvoices.filter((i) => i.documentStatus === 'POSTED' && Number(i.remaining) > 0).reduce((s, i) => s + Number(i.remaining), 0);
    return { supplier, outstanding: Number(outstanding.toFixed(2)), purchaseOrders: orders, grns, invoices: resolvedInvoices, payments };
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.suppliers.manage')
  @Delete('suppliers/:id') async deleteSupplier(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const s = await this.prisma.supplier.findFirst({ where: { id, companyId }, include: { _count: { select: { orders: true, goodsReceivedNotes: true, supplierInvoices: true, vendorCredits: true } } } });
    if (s && (s._count.orders || s._count.supplierInvoices || s._count.goodsReceivedNotes)) throw new BadRequestException('This supplier has transaction history and cannot be deleted. Set it to INACTIVE instead.');
    await this.prisma.supplier.deleteMany({ where: { id, companyId } });
    return { ok: true };
  }

  @Get('dashboard') async dashboard(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [pos, bills, payAgg, monthPayAgg] = await Promise.all([
      this.prisma.purchaseOrder.findMany({ where: { companyId }, select: { total: true, status: true } }),
      this.prisma.supplierInvoice.findMany({ where: { companyId, status: { notIn: ['DRAFT', 'VOID'] } }, select: { total: true, amountPaid: true, balanceDue: true, paymentStatus: true, dueDate: true } }),
      this.prisma.supplierPayment.findMany({ where: { companyId }, select: { amount: true } }),
      this.prisma.supplierPayment.aggregate({ where: { companyId, paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    ]);
    const committed = pos.reduce((s, p) => s + Number(p.total), 0);
    let openPayables = 0, dueOverdue = 0, overdueCount = 0;
    for (const b of bills) {
      const balance = Math.max(0, Number(b.total) - Number(b.amountPaid));
      openPayables += balance;
      if (balance > 0.005) {
        const due = b.dueDate ? new Date(b.dueDate) : null;
        if (due && due < new Date(now.getFullYear(), now.getMonth(), now.getDate()) && (b.paymentStatus === 'UNPAID' || b.paymentStatus === 'PARTIALLY_PAID')) { dueOverdue += balance; overdueCount++; }
      }
    }
    return {
      purchaseOrders: pos.length, purchaseOrderValue: Number(committed.toFixed(2)),
      openPayables: Number(openPayables.toFixed(2)),
      dueOverdue: Number(dueOverdue.toFixed(2)), overdueBills: overdueCount,
      paymentsThisMonth: Number((monthPayAgg._sum.amount || 0).toFixed(2)),
      paymentCount: payAgg.length,
    };
  }

  // ----- Purchase requisitions -----
  @Get('requisitions') requisitions(@Req() req: any) {
    return this.prisma.purchaseRequisition.findMany({ where: { companyId: companyIdOf(req.user) }, include: { branch: true, lines: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('requisitions') async createRequisition(@Req() req: any, @Body() dto: CreateRequisitionDto) {
    const companyId = companyIdOf(req.user);
    const { mapped, total } = this.computeLines(dto.lines);
    const requisitionNo = await this.numbering.next(companyId, 'PRQ');
    const r = await this.prisma.purchaseRequisition.create({ data: { companyId, branchId: dto.branchId, requisitionNo, requestedBy: dto.requestedBy, dateRequired: dto.dateRequired ? new Date(dto.dateRequired) : undefined, notes: dto.notes, lines: { create: mapped.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, estimatedCost: l.estimatedCost, lineTotal: l.lineTotal })) } }, include: { lines: true } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'PurchaseRequisition', r.id, { requisitionNo });
    return r;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.requisitions.approve', 'procurement.requisitions.create')
  @Patch('requisitions/:id/status') setRequisitionStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.prisma.purchaseRequisition.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { status: dto.status } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.purchase_orders.create')
  @Post('requisitions/:id/convert') async convertRequisition(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const r = await this.prisma.purchaseRequisition.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!r) throw new Error('Requisition not found');
    if (r.status !== 'APPROVED') throw new Error('Requisition must be approved before conversion');
    const supplier = await this.prisma.supplier.findFirst({ where: { companyId } });
    if (!supplier) throw new Error('Create a supplier first');
    const { total } = this.computeLines(r.lines);
    const poNo = await this.numbering.next(companyId, 'PO');
    const po = await this.prisma.purchaseOrder.create({
      data: { companyId, supplierId: supplier.id, requisitionId: r.id, poNo, status: 'DRAFT', total, lines: { create: r.lines.map((l) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.estimatedCost || 0, lineTotal: l.lineTotal })) } },
      include: { lines: true },
    });
    await this.prisma.purchaseRequisition.update({ where: { id: r.id }, data: { status: 'CONVERTED' } });
    await this.audit.log(companyId, req.user.sub, 'CONVERT', 'PurchaseRequisition', r.id, { poNo });
    return po;
  }
  @Delete('requisitions/:id') async deleteRequisition(@Req() req: any, @Param('id') id: string) {
    await this.prisma.purchaseRequisition.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Purchase orders -----
  private r2 = (n: any) => Number(Number(n || 0).toFixed(2));

  /** Item id -> is-stock-tracked, for one or many POs (batched). */
  private async stockMap(companyId: string, lines: any[]) {
    const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean))] as string[];
    if (!ids.length) return new Map<string, boolean>();
    const items = await this.prisma.inventoryItem.findMany({ where: { id: { in: ids }, companyId }, select: { id: true, type: true } });
    return new Map(items.map((i) => [i.id, isStockTracked(i.type)]));
  }

  /**
   * Independent receipt + billing progress. Receiving and billing are separate
   * dimensions; this never collapses them into one contradictory status. Stock
   * lines are billable only up to what was received; non-stock (service) lines
   * skip receiving and are billable in full.
   */
  private poProgress(po: any, stockByItem: Map<string, boolean>) {
    const posted = (po.goodsReceivedNotes || []).filter((g: any) => g.status === 'POSTED');
    const receivedRows = posted.flatMap((g: any) => g.lines || []);
    const invoiceRows = (po.supplierInvoices || []).filter((si: any) => si.status !== 'VOID').flatMap((si: any) => si.lines || []);
    const recvOf = (itemId?: string | null) => (itemId ? receivedRows.filter((l: any) => l.itemId === itemId).reduce((s: number, l: any) => s + Number(l.quantity), 0) : 0);
    const billOf = (itemId?: string | null) => (itemId ? invoiceRows.filter((l: any) => l.itemId === itemId).reduce((s: number, l: any) => s + Number(l.quantity), 0) : 0);
    let ordered = 0, received = 0, billed = 0, remainingToReceive = 0, remainingToBill = 0, receivingRequired = false;
    for (const l of po.lines || []) {
      const qty = Number(l.quantity);
      const isStock = l.itemId ? (stockByItem.get(l.itemId) ?? true) : true;
      if (isStock) receivingRequired = true;
      const r = isStock ? Math.min(recvOf(l.itemId), qty) : 0;
      const billable = isStock ? r : qty;
      ordered += qty; received += r; billed += Math.min(billOf(l.itemId), billable);
      remainingToReceive += Math.max(0, qty - r);
      remainingToBill += Math.max(0, billable - billOf(l.itemId));
    }
    return { ordered: this.r2(ordered), received: this.r2(received), billed: this.r2(billed), remainingToReceive: this.r2(remainingToReceive), remainingToBill: this.r2(remainingToBill), receivingRequired };
  }

  private async assertPoEditable(companyId: string, po: any, action: string) {
    const status = String(po.status || '').toUpperCase();
    if (['CANCELLED', 'CLOSED'].includes(status)) throw new BadRequestException(`Cannot ${action} a ${status} purchase order.`);
    const postedGrn = (po.goodsReceivedNotes || []).filter((g: any) => g.status === 'POSTED').length;
    const bills = (po.supplierInvoices || []).filter((si: any) => si.status !== 'VOID').length;
    if (postedGrn || bills) throw new BadRequestException(`Cannot ${action} this purchase order: it has ${postedGrn} posted receipt(s) and ${bills} bill(s). Use a return or credit instead.`);
    if (action === 'edit' && !['DRAFT', 'OPEN', 'APPROVED'].includes(status)) throw new BadRequestException('Only draft or approved purchase orders can be edited.');
  }

  @Get('purchase-orders') async orders(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const pos = await this.prisma.purchaseOrder.findMany({ where: { companyId }, include: { supplier: true, lines: true, goodsReceivedNotes: { include: { lines: true } }, supplierInvoices: { include: { lines: true } } }, orderBy: { createdAt: 'desc' } });
    const stockByItem = await this.stockMap(companyId, pos.flatMap((p) => p.lines));
    return pos.map((p) => ({ ...p, progress: this.poProgress(p, stockByItem) }));
  }
  @Post('purchase-orders') async createOrder(@Req() req: any, @Body() dto: CreatePurchaseOrderDto) {
    const companyId = companyIdOf(req.user);
    const supplier = await this.prisma.supplier.findFirst({ where: { id: dto.supplierId, companyId } });
    if (!supplier) throw new BadRequestException('Supplier not found for this company');
    await this.items.applyPurchaseDefaults(companyId, dto.lines as any[]);
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    const discount = mapped.reduce((s: number, l: any) => s + Number(l.quantity) * Number(l.unitPrice) * Number(l.discount || 0) / 100, 0);
    const poNo = await this.numbering.next(companyId, 'PO');
    const po = await this.prisma.purchaseOrder.create({ data: { companyId, supplierId: dto.supplierId, requisitionId: dto.requisitionId, poNo, orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(), expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null, currency: dto.currency || 'USD', paymentTerms: dto.paymentTerms, supplierReference: dto.supplierReference, shipTo: dto.shipTo, warehouseId: dto.warehouseId, memo: dto.memo, subtotal, discount: this.r2(discount), taxTotal, total, lines: { create: mapped.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })) } }, include: { lines: true } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'PurchaseOrder', po.id, { poNo });
    return po;
  }
  /** Open purchase orders for a vendor with a remaining billable balance ("Add from PO"). */
  @Get('purchase-orders/eligible') async eligiblePos(@Req() req: any, @Query('supplierId') supplierId: string) {
    const companyId = companyIdOf(req.user);
    if (!supplierId) throw new BadRequestException('supplierId is required');
    const pos = await this.prisma.purchaseOrder.findMany({ where: { companyId, supplierId, status: { in: ['OPEN', 'APPROVED', 'PART_RECEIVED', 'RECEIVED'] } }, include: { supplier: true, lines: true, goodsReceivedNotes: { include: { lines: true } }, supplierInvoices: { include: { lines: true } } }, orderBy: { createdAt: 'desc' } });
    const stockByItem = await this.stockMap(companyId, pos.flatMap((p) => p.lines));
    return pos
      .map((p) => ({ id: p.id, poNo: p.poNo, status: p.status, orderDate: p.orderDate, expectedDate: p.expectedDate, currency: p.currency, supplier: { id: p.supplier.id, name: p.supplier.name }, progress: this.poProgress(p, stockByItem) }))
      .filter((p) => p.progress.remainingToBill > 0);
  }
  /** Per-line prefill for "Add from PO": unbilled quantity, cost, unit, tax and account mapping. */
  @Get('purchase-orders/:id/bill-lines') async billLines(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: { lines: true, goodsReceivedNotes: { include: { lines: true } } } });
    if (!po) throw new BadRequestException('Purchase order not found');
    const stockByItem = await this.stockMap(companyId, po.lines);
    const receivedRows = po.goodsReceivedNotes.filter((g: any) => g.status === 'POSTED').flatMap((g: any) => g.lines || []);
    const lines = [];
    for (const l of po.lines) {
      const isStock = l.itemId ? (stockByItem.get(l.itemId) ?? true) : true;
      const received = l.itemId ? receivedRows.filter((r: any) => r.itemId === l.itemId).reduce((s: number, r: any) => s + Number(r.quantity), 0) : 0;
      const eligible = isStock ? Math.min(received, Number(l.quantity)) : Number(l.quantity);
      const remainingToBill = Math.max(0, eligible - Number(l.invoicedQty || 0));
      let taxCode: string | null = null, accountId: string | null = null, accountCode: string | null = null, unit = 'EA';
      if (l.itemId) {
        const d = await this.items.resolveForPurchase(companyId, l.itemId);
        taxCode = d.taxCode; accountId = d.accountId; accountCode = d.accountCode; unit = d.unit;
      }
      lines.push({ purchaseOrderLineId: l.id, itemId: l.itemId, description: l.description, ordered: Number(l.quantity), received, invoiced: Number(l.invoicedQty || 0), remainingToBill, unitPrice: Number(l.unitPrice), unit, taxCode, accountId, accountCode });
    }
    return { purchaseOrderId: po.id, poNo: po.poNo, supplierId: po.supplierId, currency: po.currency, lines };
  }
  @Get('purchase-orders/:id') async orderDetail(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: { supplier: true, lines: true, goodsReceivedNotes: { include: { lines: true } }, supplierInvoices: { include: { lines: true } } } });
    if (!po) throw new BadRequestException('Purchase order not found');
    const stockByItem = await this.stockMap(companyId, po.lines);
    return { ...po, progress: this.poProgress(po, stockByItem) };
  }
  @Patch('purchase-orders/:id') async updateOrder(@Req() req: any, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto) {
    const companyId = companyIdOf(req.user);
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: { lines: true, goodsReceivedNotes: true, supplierInvoices: true } });
    if (!po) throw new BadRequestException('Purchase order not found');
    await this.assertPoEditable(companyId, po, 'edit');
    if (dto.supplierId) { const s = await this.prisma.supplier.findFirst({ where: { id: dto.supplierId, companyId } }); if (!s) throw new BadRequestException('Supplier not found for this company'); }
    const data: any = {};
    if (dto.supplierId !== undefined) data.supplierId = dto.supplierId;
    if (dto.orderDate !== undefined) data.orderDate = new Date(dto.orderDate);
    if (dto.expectedDate !== undefined) data.expectedDate = dto.expectedDate ? new Date(dto.expectedDate) : null;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.paymentTerms !== undefined) data.paymentTerms = dto.paymentTerms;
    if (dto.supplierReference !== undefined) data.supplierReference = dto.supplierReference;
    if (dto.shipTo !== undefined) data.shipTo = dto.shipTo;
    if (dto.warehouseId !== undefined) data.warehouseId = dto.warehouseId;
    if (dto.memo !== undefined) data.memo = dto.memo;
    if (dto.lines) {
      await this.items.applyPurchaseDefaults(companyId, dto.lines as any[]);
      const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
      const discount = mapped.reduce((s: number, l: any) => s + Number(l.quantity) * Number(l.unitPrice) * Number(l.discount || 0) / 100, 0);
      data.subtotal = subtotal; data.taxTotal = taxTotal; data.total = total; data.discount = this.r2(discount);
      await this.prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      data.lines = { create: mapped.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })) };
    }
    const saved = await this.prisma.purchaseOrder.update({ where: { id }, data, include: { lines: true } });
    await this.audit.log(companyId, req.user.sub, 'UPDATE', 'PurchaseOrder', id, { module: 'procurement', metadata: { fields: Object.keys(data) } });
    return saved;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.purchase_orders.approve')
  @Patch('purchase-orders/:id/status') async setOrderStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    const companyId = companyIdOf(req.user);
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: { goodsReceivedNotes: true, supplierInvoices: true } });
    if (!po) throw new BadRequestException('Purchase order not found');
    const target = String(dto.status || '').toUpperCase();
    const current = String(po.status || '').toUpperCase();
    const postedGrn = (po.goodsReceivedNotes || []).filter((g: any) => g.status === 'POSTED').length;
    const bills = (po.supplierInvoices || []).filter((si: any) => si.status !== 'VOID').length;
    const allowed: Record<string, string[]> = {
      OPEN: ['DRAFT'],
      APPROVED: ['DRAFT', 'OPEN', 'CLOSED'],
      CLOSED: ['APPROVED', 'OPEN', 'PART_RECEIVED', 'RECEIVED'],
      CANCELLED: ['DRAFT', 'OPEN', 'APPROVED'],
      DRAFT: ['OPEN', 'APPROVED'],
    };
    if (!(allowed[target] || []).includes(current)) throw new BadRequestException(`Cannot change purchase order from ${current} to ${target}.`);
    if (target === 'CANCELLED' && (postedGrn || bills)) throw new BadRequestException('Cannot cancel a purchase order that has posted receipts or bills.');
    await this.prisma.purchaseOrder.update({ where: { id }, data: { status: target as any } });
    await this.audit.log(companyId, req.user.sub, 'PO_STATUS_CHANGED', 'PurchaseOrder', id, { module: 'procurement', metadata: { from: current, to: target } });
    return this.prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: { lines: true } });
  }
  @Get('purchase-orders/:id/receiving') async receiving(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: { lines: true, goodsReceivedNotes: { include: { lines: true } } } });
    if (!po) throw new BadRequestException('Purchase order not found');
    const stockByItem = await this.stockMap(companyId, po.lines);
    const receivedRows = po.goodsReceivedNotes.filter((g: any) => g.status === 'POSTED').flatMap((g: any) => g.lines || []);
    return {
      poNo: po.poNo,
      status: po.status,
      warehouseId: po.warehouseId,
      lines: po.lines.map((l) => {
        const prev = receivedRows.filter((r: any) => r.itemId === l.itemId).reduce((s: number, r: any) => s + Number(r.quantity), 0);
        const ordered = Number(l.quantity);
        return { lineId: l.id, itemId: l.itemId, description: l.description, ordered, previouslyReceived: prev, remaining: Math.max(0, ordered - prev), unitCost: Number(l.unitPrice), stockTracked: l.itemId ? (stockByItem.get(l.itemId) ?? true) : true };
      }),
    };
  }
  @Post('purchase-orders/:id/receive') async receiveOrder(@Req() req: any, @Param('id') id: string, @Body() dto: { warehouseId?: string; reference?: string; lines?: { quantity: number }[]; confirm?: boolean } = {}) {
    const companyId = companyIdOf(req.user);
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!po) throw new BadRequestException('Purchase order not found');
    if (['CANCELLED', 'CLOSED', 'DRAFT'].includes(String(po.status).toUpperCase())) throw new BadRequestException(`Cannot receive against a ${po.status} purchase order. Approve it first.`);
    const payload = dto || {};
    if (payload.lines?.some((x) => Number(x.quantity) < 0)) throw new BadRequestException('Receipt quantity cannot be negative');
    const warehouseId = payload.warehouseId || po.warehouseId || (await this.prisma.warehouse.findFirst({ where: { companyId } }))?.id;
    if (!warehouseId) throw new BadRequestException('Create a warehouse first');
    const wh = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, companyId } });
    if (!wh) throw new BadRequestException('Warehouse not found for this company');
    const requested = payload.lines?.length ? payload.lines : po.lines.map((l) => ({ quantity: Number(l.quantity) }));
    const lines = po.lines
      .map((l, i) => ({ itemId: l.itemId, quantity: Number(requested[i]?.quantity ?? l.quantity), unitCost: l.unitPrice }))
      .filter((l) => l.quantity > 0)
      .map((l) => ({ ...l, lineTotal: Number((Number(l.unitCost) * l.quantity).toFixed(2)) }));
    if (!lines.length) throw new BadRequestException('Nothing to receive — enter a receipt quantity greater than zero.');
    const grnNo = await this.numbering.next(companyId, 'GRN');
    const grn = await this.prisma.goodsReceivedNote.create({ data: { companyId, purchaseOrderId: po.id, supplierId: po.supplierId, warehouseId, grnNo, reference: payload.reference || po.poNo, status: 'DRAFT', lines: { create: lines } }, include: { lines: true } });
    await this.audit.log(companyId, req.user.sub, 'RECEIVE', 'PurchaseOrder', po.id, { grnNo });
    const mode = await getTransactionPostingMode(this.prisma, companyId);
    const shouldConfirm = payload.confirm !== false && mode !== 'MANUAL';
    if (shouldConfirm) return this.confirmGrn(companyId, grn.id, req.user.sub);
    return grn;
  }
  @Get('purchase-orders/:id/match') async match(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: { lines: true, goodsReceivedNotes: { include: { lines: true } }, supplierInvoices: { include: { lines: true } } } });
    if (!po) throw new BadRequestException('Purchase order not found');
    const recv = (itemId?: string) => po.goodsReceivedNotes.filter((g: any) => g.status === 'POSTED').flatMap((g: any) => g.lines).filter((l: any) => l.itemId === itemId).reduce((s: number, l: any) => s + Number(l.quantity), 0);
    const inv = (itemId?: string) => po.supplierInvoices.filter((si: any) => si.status !== 'VOID').flatMap((si: any) => si.lines).filter((l: any) => l.itemId === itemId).reduce((s: number, l: any) => s + Number(l.quantity), 0);
    const stockByItem = await this.stockMap(companyId, po.lines);
    return po.lines.map((l) => {
      const receivedQty = recv(l.itemId ?? undefined);
      const invoiceQty = inv(l.itemId ?? undefined);
      const isStock = l.itemId ? (stockByItem.get(l.itemId) ?? true) : true;
      const billable = isStock ? Math.min(receivedQty, Number(l.quantity)) : Number(l.quantity);
      const invoicePrice = po.supplierInvoices[0]?.lines.find((x: any) => x.itemId === l.itemId)?.unitPrice ?? l.unitPrice;
      return { lineId: l.id, description: l.description, poQty: Number(l.quantity), receivedQty, invoiceQty, remainingToReceive: Math.max(0, Number(l.quantity) - receivedQty), remainingToBill: Math.max(0, billable - invoiceQty), poPrice: Number(l.unitPrice), invoicePrice: Number(invoicePrice), variance: Number((Number(invoicePrice) - Number(l.unitPrice)).toFixed(2)) };
    });
  }
  @Delete('purchase-orders/:id') async deleteOrder(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: { goodsReceivedNotes: true, supplierInvoices: true } });
    if (!po) throw new BadRequestException('Purchase order not found');
    const postedGrn = (po.goodsReceivedNotes || []).filter((g: any) => g.status === 'POSTED').length;
    const bills = (po.supplierInvoices || []).filter((si: any) => si.status !== 'VOID').length;
    if (postedGrn || bills) throw new BadRequestException('Cannot delete a purchase order that has posted receipts or bills. Cancel it instead.');
    await this.prisma.purchaseOrder.deleteMany({ where: { id, companyId } });
    await this.audit.log(companyId, req.user.sub, 'DELETE', 'PurchaseOrder', id, {});
    return { ok: true };
  }

  // ----- Goods received notes -----
  @Get('grns') grns(@Req() req: any) {
    return this.prisma.goodsReceivedNote.findMany({ where: { companyId: companyIdOf(req.user) }, include: { purchaseOrder: true, supplier: true, warehouse: true, lines: true }, orderBy: { receivedAt: 'desc' } });
  }
  @Post('grns') async createGrn(@Req() req: any, @Body() dto: CreateGrnDto) {
    const companyId = companyIdOf(req.user);
    const { mapped, total } = this.computeLines(dto.lines);
    const grnNo = await this.numbering.next(companyId, 'GRN');
    const grn = await this.prisma.goodsReceivedNote.create({ data: { companyId, purchaseOrderId: dto.purchaseOrderId, supplierId: dto.supplierId, warehouseId: dto.warehouseId, grnNo, reference: dto.reference, lines: { create: mapped.map((l: any) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitPrice, lineTotal: l.lineTotal })) } }, include: { lines: true } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'GoodsReceivedNote', grn.id, { grnNo });
    return grn;
  }
  @Post('grns/:id/post') async postGrn(@Req() req: any, @Param('id') id: string) {
    return this.confirmGrn(companyIdOf(req.user), id, req.user.sub);
  }
  /** User-facing alias — Confirm Receipt (same as post GRN / inventory update). */
  @Post('grns/:id/confirm') async confirmGrnRoute(@Req() req: any, @Param('id') id: string) {
    return this.confirmGrn(companyIdOf(req.user), id, req.user.sub);
  }

  private async confirmGrn(companyId: string, id: string, userId?: string) {
    const grn = await this.prisma.goodsReceivedNote.findFirst({ where: { id, companyId }, include: { lines: true, purchaseOrder: { include: { lines: true } } } });
    if (!grn) throw new Error('GRN not found');
    if (grn.status !== 'DRAFT') return grn;
    if (!grn.warehouseId) throw new BadRequestException('GRN requires a warehouse');
    const wh = await this.prisma.warehouse.findFirst({ where: { id: grn.warehouseId, companyId } });
    if (!wh) throw new BadRequestException('Warehouse not found for this company');
    await this.prisma.$transaction(async (tx) => {
      const receiptValueLines: { accountCode: string; amount: number }[] = [];
      for (const line of grn.lines) {
        if (!line.itemId) continue;
        if (!(Number(line.quantity) > 0)) continue;
        const item = await tx.inventoryItem.findFirst({ where: { id: line.itemId, companyId } });
        // Only Inventory Products create stock receipts; services / non-inventory update PO received qty only.
        if (item && isStockTracked(item.type)) {
          await this.stock.create(companyId, {
            warehouseId: grn.warehouseId!,
            itemId: line.itemId,
            type: 'RECEIPT',
            quantity: Number(line.quantity),
            unitCost: Number(line.unitCost),
            reference: grn.grnNo,
            occurredAt: grn.receivedAt,
          }, userId, tx);
          // Capitalise Inventory Asset / credit GRNI for the received value (GRNI accrual).
          let accountCode = '1200';
          if (item.inventoryAssetAccountId) {
            const a = await tx.ledgerAccount.findFirst({ where: { id: item.inventoryAssetAccountId, companyId } });
            if (a?.code) accountCode = a.code;
          }
          receiptValueLines.push({ accountCode, amount: Number(line.quantity) * Number(line.unitCost) });
        }
        const poi = grn.purchaseOrder?.lines.find((l: any) => l.itemId === line.itemId);
        if (poi) {
          const newRecv = Number(poi.receivedQty || 0) + Number(line.quantity);
          if (newRecv > Number(poi.quantity) + 0.001) throw new BadRequestException(`Over-receipt blocked: received exceeds ordered for ${poi.description}`);
          await tx.purchaseOrderLine.update({ where: { id: poi.id }, data: { receivedQty: newRecv } });
        }
      }
      if (receiptValueLines.length) {
        await this.posting.postGoodsReceipt(companyId, { date: grn.receivedAt, reference: grn.grnNo, sourceId: grn.id, lines: receiptValueLines, userId }, tx);
      }
      await tx.goodsReceivedNote.update({ where: { id: grn.id }, data: { status: 'POSTED' } });
      if (grn.purchaseOrderId) {
        const po = await tx.purchaseOrder.findFirst({ where: { id: grn.purchaseOrderId }, include: { lines: true } });
        if (po) {
          const allRecv = po.lines.every((l) => Number(l.receivedQty || 0) >= Number(l.quantity) - 0.001);
          const anyRecv = po.lines.some((l) => Number(l.receivedQty || 0) > 0);
          const receiptStatus = allRecv ? 'RECEIVED' : anyRecv ? 'PARTIALLY_RECEIVED' : 'NOT_RECEIVED';
          const status = allRecv ? 'RECEIVED' : anyRecv ? 'PART_RECEIVED' : po.status;
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { receiptStatus, status: status as any } });
        }
      }
    });
    await this.audit.log(companyId, userId, 'RECEIPT_CONFIRMED', 'GoodsReceivedNote', id, { grnNo: grn.grnNo });
    return this.prisma.goodsReceivedNote.findUnique({ where: { id }, include: { lines: true, purchaseOrder: true, warehouse: true } });
  }
  @Delete('grns/:id') async deleteGrn(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const grn = await this.prisma.goodsReceivedNote.findFirst({ where: { id, companyId } });
    if (!grn) throw new BadRequestException('GRN not found');
    if (grn.status === 'POSTED') throw new BadRequestException('Posted GRNs cannot be deleted. Reverse stock via a return or adjustment.');
    await this.prisma.goodsReceivedNote.deleteMany({ where: { id, companyId } });
    return { ok: true };
  }

  // ----- Bill Management (Accounts Payable workspace) -----
  private dueStatusOf(b: any): string {
    if (b.dueDate) {
      const due = new Date(b.dueDate); const today = new Date(); const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const due0 = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      if (due0 < today0) return 'OVERDUE';
      if (due0.getTime() === today0.getTime()) return 'DUE_TODAY';
      const weekEnd = new Date(today0.getTime() + 7 * 86400000);
      if (due0 <= weekEnd) return 'DUE_THIS_WEEK';
      const monthEnd = new Date(today0.getFullYear(), today0.getMonth() + 1, 0);
      if (due0 <= monthEnd) return 'DUE_THIS_MONTH';
      return 'NOT_YET_DUE';
    }
    return 'NO_DUE_DATE';
  }
  // Authoritative AP status resolver — derives paid/remaining/paymentStatus from real allocation/payment data
  // (never trusts a stale stored label) and idempotently backfills the cached columns.
  private async resolveBill(bill: any) {
    const total = Number(bill.total || 0);
    const [allocs, direct] = await Promise.all([
      this.prisma.supplierPaymentAllocation.findMany({ where: { supplierInvoiceId: bill.id, payment: { status: 'POSTED' } }, include: { payment: { select: { id: true, paymentNo: true, paidAt: true, method: true, referenceNo: true, status: true, payFromAccountName: true, createdBy: true, amount: true } } } }),
      this.prisma.supplierPayment.findMany({ where: { supplierInvoiceId: bill.id, status: 'POSTED' } }),
    ]);
    const allocPaid = allocs.reduce((s, a) => s + Number(a.amountApplied || 0), 0);
    const directPaid = direct.reduce((s, p) => s + Number(p.amount || 0), 0);
    const paid = Math.max(allocPaid, directPaid);
    const creditsApplied = Number(bill.creditsApplied || 0);
    const remaining = Math.max(0, total - paid - creditsApplied);
    // Distinct POSTED payments touching this bill (allocations or legacy direct).
    const paymentIds = new Set<string>([...allocs.map((a: any) => a.payment.id), ...direct.map((p: any) => p.id)]);
    const appliedPayments = [
      ...allocs.map((a: any) => ({ paymentId: a.payment.id, paymentNo: a.payment.paymentNo, paidAt: a.payment.paidAt, method: a.payment.method, referenceNo: a.payment.referenceNo, status: a.payment.status, paymentAmount: Number(a.payment.amount || 0), appliedToBill: Number(a.amountApplied || 0) })),
      ...direct.filter((p: any) => !paymentIds.has(p.id) || !allocs.some((a: any) => a.payment.id === p.id)).map((p: any) => ({ paymentId: p.id, paymentNo: p.paymentNo, paidAt: p.paidAt, method: p.method, referenceNo: p.referenceNo, status: p.status, paymentAmount: Number(p.amount || 0), appliedToBill: Number(p.amount || 0) })),
    ];
    const rawStatus = String(bill.status || 'DRAFT').toUpperCase();
    const doc = ['POSTED', 'PAID', 'UNPAID', 'PART_PAID', 'PARTIALLY_PAID'].includes(rawStatus) ? 'POSTED' : rawStatus;
    let paymentStatus = 'NOT_POSTED';
    if (doc === 'POSTED') {
      if (remaining <= 0.005) paymentStatus = 'PAID';
      else {
        const overdue = bill.dueDate && new Date(bill.dueDate) < new Date(new Date().toDateString());
        paymentStatus = overdue ? 'OVERDUE' : (paid > 0.005 ? 'PARTIALLY_PAID' : 'UNPAID');
      }
    }
    // idempotent backfill so stored columns agree with the resolver everywhere
    if (bill.status !== doc || Math.abs(Number(bill.amountPaid || 0) - paid) > 0.01 || Math.abs(Number(bill.balanceDue || 0) - remaining) > 0.01 || bill.paymentStatus !== paymentStatus) {
      await this.prisma.supplierInvoice.update({ where: { id: bill.id }, data: { status: doc, amountPaid: paid, balanceDue: remaining, paymentStatus } }).catch(() => {});
    }
    return { total, paid: Number(paid.toFixed(2)), remaining: Number(remaining.toFixed(2)), paymentStatus, documentStatus: doc, paymentCount: paymentIds.size, appliedPayments };
  }
  @Get('bills') async bills(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId };
    if (q.vendorId) where.supplierId = q.vendorId;
    if (q.documentStatus) where.status = q.documentStatus;
    if (q.paymentStatus) where.paymentStatus = { in: String(q.paymentStatus).split(',') };
    if (q.currency) where.currency = q.currency;
    if (q.projectId) where.projectId = q.projectId;
    if (q.matchStatus) where.matchStatus = q.matchStatus;
    if (q.billDateFrom || q.billDateTo) where.invoiceDate = { ...(q.billDateFrom ? { gte: new Date(q.billDateFrom) } : {}), ...(q.billDateTo ? { lte: new Date(q.billDateTo) } : {}) };
    if (q.dueDateFrom || q.dueDateTo) where.dueDate = { ...(q.dueDateFrom ? { gte: new Date(q.dueDateFrom) } : {}), ...(q.dueDateTo ? { lte: new Date(q.dueDateTo) } : {}) };
    if (q.q) where.OR = [{ invoiceNo: { contains: q.q, mode: 'insensitive' } }, { supplierInvoiceNo: { contains: q.q, mode: 'insensitive' } }, { ref: { contains: q.q, mode: 'insensitive' } }, { memo: { contains: q.q, mode: 'insensitive' } }, { supplier: { name: { contains: q.q, mode: 'insensitive' } } }];
    const bills = await this.prisma.supplierInvoice.findMany({ where, include: { supplier: true, purchaseOrder: true }, orderBy: { invoiceDate: 'desc' } });
    let rows: any[] = [];
    for (const b of bills) {
      const r = await this.resolveBill(b);
      rows.push({ ...b, status: r.documentStatus, documentStatus: r.documentStatus, amountPaid: r.paid, balanceDue: r.remaining, remaining: r.remaining, paid: r.paid, paymentStatus: r.paymentStatus, paymentCount: r.paymentCount, appliedPayments: r.appliedPayments, dueStatus: this.dueStatusOf(b) });
    }
    if (q.dueStatus && q.dueStatus !== 'ALL') rows = rows.filter((r) => r.dueStatus === q.dueStatus);
    if (q.onlyOutstanding === 'true') rows = rows.filter((r) => r.documentStatus === 'POSTED' && r.remaining > 0);
    const sortFns: Record<string, (a: any, b: any) => number> = { billNo: (a, b) => String(a.invoiceNo).localeCompare(String(b.invoiceNo)), vendor: (a, b) => String(a.supplier?.name || '').localeCompare(String(b.supplier?.name || '')), invoiceDate: (a, b) => new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime(), dueDate: (a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity), total: (a, b) => Number(a.total) - Number(b.total), paid: (a, b) => Number(a.paid) - Number(b.paid), remaining: (a, b) => a.remaining - b.remaining, paymentStatus: (a, b) => String(a.paymentStatus).localeCompare(String(b.paymentStatus)), documentStatus: (a, b) => String(a.documentStatus).localeCompare(String(b.documentStatus)) };
    const sf = sortFns[q.sortBy]; if (sf) rows.sort(sf); if (q.sortDirection === 'desc') rows.reverse();
    const page = Math.max(1, Number(q.page) || 1); const pageSize = Math.max(1, Number(q.pageSize) || 25);
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
  }
  @Get('bills/:id') async billDetail(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const bill = await this.prisma.supplierInvoice.findFirst({ where: { id, companyId }, include: { supplier: true, purchaseOrder: true, project: true, lines: { include: { } }, payments: { include: { allocations: true } }, attachments: true, paymentAllocations: { include: { payment: true } } } });
    if (!bill) throw new BadRequestException('Bill not found');
    const r = await this.resolveBill(bill);
    return { ...bill, status: r.documentStatus, documentStatus: r.documentStatus, amountPaid: r.paid, balanceDue: r.remaining, remaining: r.remaining, paid: r.paid, paymentStatus: r.paymentStatus, paymentCount: r.paymentCount, appliedPayments: r.appliedPayments };
  }
  @Get('supplier-invoices') async supplierInvoices(@Req() req: any) {
    const list = await this.prisma.supplierInvoice.findMany({ where: { companyId: companyIdOf(req.user) }, include: { supplier: true, purchaseOrder: true, lines: true, payments: true, attachments: true }, orderBy: { invoiceDate: 'desc' } });
    const out = [];
    for (const i of list) { const r = await this.resolveBill(i); out.push({ ...i, status: r.documentStatus, documentStatus: r.documentStatus, amountPaid: r.paid, balanceDue: r.remaining, remaining: r.remaining, paymentStatus: r.paymentStatus, paymentCount: r.paymentCount }); }
    return out;
  }

  // Authoritative Accounts Payable Aging & payment-planning report (due-date based,
  // 5 buckets, bill drill-down, historical as-of, AP control reconciliation).
  @Get('ap-aging') async apAging(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const round = (n: any) => Number(Number(n).toFixed(2));
    const asOf = q.asOf ? new Date(String(q.asOf).concat('T23:59:59')) : new Date();
    const bills = await this.prisma.supplierInvoice.findMany({ where: { companyId, status: 'POSTED' }, include: { supplier: true, purchaseOrder: true, payments: true }, orderBy: { invoiceDate: 'desc' } });
    const termsDays = (terms?: string | null) => { const m = /(\d+)/.exec(String(terms || '')); return m ? Number(m[1]) : null; };
    const bucketOf = (due: Date | null) => {
      if (!due) return { key: 'current', daysOverdue: null, missing: true };
      const days = Math.floor((asOf.getTime() - due.getTime()) / 86400000);
      if (days <= 0) return { key: 'current', daysOverdue: 0, missing: false };
      if (days <= 30) return { key: 'd1_30', daysOverdue: days, missing: false };
      if (days <= 60) return { key: 'd31_60', daysOverdue: days, missing: false };
      if (days <= 90) return { key: 'd61_90', daysOverdue: days, missing: false };
      return { key: 'd90plus', daysOverdue: days, missing: false };
    };
    const payStatus = (remaining: number, original: number, overdue: boolean) => { if (remaining <= 0.005) return 'PAID'; if (overdue) return 'OVERDUE'; if (remaining < original - 0.005) return 'PARTIALLY_PAID'; return 'UNPAID'; };
    const byVendor: Record<string, any> = {};
    for (const bill of bills) {
      const paidAsOf = (bill.payments || []).filter((p) => p.status !== 'REVERSED' && new Date(p.paidAt) <= asOf).reduce((s: number, p: any) => s + Number(p.amount), 0);
      const original = round(Number(bill.total || 0));
      const remaining = Math.max(0, round(original - paidAsOf - Number(bill.creditsApplied || 0)));
      if (remaining <= 0.005) continue;
      let due = bill.dueDate ? new Date(bill.dueDate) : null;
      let missingDue = false;
      if (!due) { const td = termsDays(bill.terms); if (td) due = new Date(bill.invoiceDate.getTime() + td * 86400000); else missingDue = true; }
      const b = bucketOf(due);
      const key = bill.supplierId || 'unknown';
      if (!byVendor[key]) {
        const s = bill.supplier;
        byVendor[key] = { vendorId: bill.supplierId || 'unknown', vendorCode: s?.code || '', vendorName: s?.name || (bill.supplierId ? 'Unknown Vendor' : 'Archived Vendor'), paymentTerms: bill.terms || (s as any)?.defaultTerms || '', currency: bill.currency || 'USD', current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0, openBillCount: 0, missingDue: false, invoices: [] };
      }
      const row = byVendor[key];
      row[b.key] += remaining;
      row.total += remaining;
      row.openBillCount += 1;
      if (missingDue) row.missingDue = true;
      row.invoices.push({ billId: bill.id, billNumber: bill.invoiceNo, supplierInvoiceNumber: bill.supplierInvoiceNo || '', billDate: bill.invoiceDate, dueDate: bill.dueDate || null, effectiveDue: due, daysOverdue: b.daysOverdue, missingDue, originalAmount: original, paidAmount: round(paidAsOf), creditApplied: round(Number(bill.creditsApplied || 0)), remainingAmount: remaining, bucket: b.key, paymentStatus: payStatus(remaining, original, !!(b.daysOverdue && b.daysOverdue > 0)), documentStatus: 'POSTED', purchaseOrderId: bill.purchaseOrderId, purchaseOrderNumber: bill.purchaseOrder?.poNo || null, grnId: bill.purchaseOrderId });
    }
    const vendors = Object.values(byVendor).sort((a: any, b: any) => b.total - a.total);
    let totalPayables = 0, overduePayables = 0, over90 = 0, vendorsWithBalance = 0, current = 0, d1_30 = 0, d31_60 = 0, d61_90 = 0;
    for (const v of vendors) { totalPayables += v.total; overduePayables += v.d1_30 + v.d31_60 + v.d61_90 + v.d90plus; over90 += v.d90plus; if (v.total > 0) vendorsWithBalance++; current += v.current; d1_30 += v.d1_30; d31_60 += v.d31_60; d61_90 += v.d61_90; }
    const apAcct = await this.prisma.ledgerAccount.findFirst({ where: { companyId, name: { contains: 'Accounts Payable' } } });
    let control: number | null = null;
    if (apAcct) { const agg = await this.prisma.journalLine.aggregate({ where: { accountId: apAcct.id, journal: { companyId, status: 'POSTED', date: { lte: asOf } } }, _sum: { debit: true, credit: true } }); control = round(Number(agg._sum.credit || 0) - Number(agg._sum.debit || 0)); }
    return {
      asOf: q.asOf || null,
      summary: { totalPayables: round(totalPayables), overduePayables: round(overduePayables), vendorsWithBalance, over90: round(over90), current: round(current), d1_30: round(d1_30), d31_60: round(d31_60), d61_90: round(d61_90) },
      vendors,
      reconciliation: { subledger: round(totalPayables), control, difference: control == null ? null : round(totalPayables - control) },
      totalVendors: vendors.length,
    };
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.bills.manage')
  @Post('supplier-invoices') async createSupplierInvoice(@Req() req: any, @Body() dto: CreateSupplierInvoiceDto) {
    const companyId = companyIdOf(req.user);
    if (dto.invoiceNo && dto.invoiceNo.trim()) {
      const normalized = dto.invoiceNo.trim().replace(/\s+/g, ' ').toLowerCase();
      const existing = await this.prisma.supplierInvoice.findMany({ where: { companyId, supplierId: dto.supplierId, status: { notIn: ['VOID'] }, supplierInvoiceNo: { not: null } }, select: { id: true, invoiceNo: true, supplierInvoiceNo: true } });
      const dup = existing.find((b) => String(b.supplierInvoiceNo || '').trim().replace(/\s+/g, ' ').toLowerCase() === normalized);
      if (dup) throw new BadRequestException(`This supplier invoice number (${dto.invoiceNo.trim()}) already exists for this supplier. Bill: ${dup.invoiceNo}`);
    }
    if (dto.purchaseOrderId) {
      // Partial billing is bounded by what has been received (stock) or ordered (non-stock),
      // checked per line so one PO can be billed across many bills without double-billing.
      const po = await this.prisma.purchaseOrder.findFirst({ where: { id: dto.purchaseOrderId, companyId }, include: { lines: true, goodsReceivedNotes: { include: { lines: true } } } });
      if (!po) throw new BadRequestException('Purchase order not found');
      const stockByItem = await this.stockMap(companyId, po.lines);
      const receivedRows = po.goodsReceivedNotes.filter((g: any) => g.status === 'POSTED').flatMap((g: any) => g.lines || []);
      const recvOf = (itemId?: string | null) => (itemId ? receivedRows.filter((r: any) => r.itemId === itemId).reduce((s: number, r: any) => s + Number(r.quantity), 0) : 0);
      for (const l of dto.lines) {
        const poLine = l.purchaseOrderLineId
          ? po.lines.find((p: any) => p.id === l.purchaseOrderLineId)
          : po.lines.find((p: any) => p.itemId && p.itemId === l.itemId);
        if (l.purchaseOrderLineId && !poLine) throw new BadRequestException('A bill line references a purchase order line that does not belong to this purchase order.');
        if (!poLine) continue;
        const isStock = poLine.itemId ? (stockByItem.get(poLine.itemId) ?? true) : true;
        const eligible = isStock ? Math.min(recvOf(poLine.itemId), Number(poLine.quantity)) : Number(poLine.quantity);
        const remaining = eligible - Number(poLine.invoicedQty || 0);
        if (Number(l.quantity) > remaining + 0.001) {
          throw new BadRequestException(`Cannot bill ${l.quantity} for "${poLine.description}": only ${remaining} remaining to bill (eligible ${eligible}, already billed ${Number(poLine.invoicedQty || 0)}).`);
        }
      }
    }
    // Resolve item-master defaults (description, cost, account mapping) for item lines
    // — applies equally to direct bills and PO-linked bills. Line values win.
    await this.items.applyPurchaseDefaults(companyId, dto.lines as any[]);
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    for (const l of mapped) { if (l.accountId) { const v = await this.validateLineAccount(companyId, l.accountId); l.accountCode = v?.code; } }
    const invoiceNo = await this.numbering.next(companyId, 'PINV');
    const si = await this.prisma.supplierInvoice.create({ data: { companyId, purchaseOrderId: dto.purchaseOrderId, supplierId: dto.supplierId, projectId: dto.projectId, invoiceNo, supplierInvoiceNo: dto.invoiceNo?.trim() || null, invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : new Date(), dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, terms: dto.terms, currency: dto.currency || 'USD', ref: dto.ref, memo: dto.memo, warehouseId: dto.warehouseId || null, receiveNow: dto.receiveNow ?? false, subtotal, taxTotal, total, balanceDue: total, status: 'DRAFT', paymentStatus: 'UNPAID', matchStatus: 'NOT_MATCHED', lines: { create: mapped.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal, accountId: l.accountId, accountCode: l.accountCode, purchaseOrderLineId: l.purchaseOrderLineId, grnLineId: l.grnLineId })) } }, include: { lines: true } });
    if (dto.purchaseOrderId && si.id) {
      await this.prisma.$transaction(async (tx) => {
        for (const l of si.lines) {
          const poi = l.purchaseOrderLineId
            ? await tx.purchaseOrderLine.findFirst({ where: { id: l.purchaseOrderLineId, purchaseOrderId: dto.purchaseOrderId } })
            : await tx.purchaseOrderLine.findFirst({ where: { purchaseOrderId: dto.purchaseOrderId, itemId: l.itemId } });
          if (poi) await tx.purchaseOrderLine.update({ where: { id: poi.id }, data: { invoicedQty: Number(poi.invoicedQty || 0) + Number(l.quantity) } });
        }
        const po2 = await tx.purchaseOrder.findUnique({ where: { id: dto.purchaseOrderId }, include: { lines: true } });
        const received = po2!.lines.reduce((s, l) => s + Number(l.receivedQty || 0), 0);
        const invoiced = po2!.lines.reduce((s, l) => s + Number(l.invoicedQty || 0), 0);
        const bs = invoiced >= received - 0.001 ? 'BILLED' : invoiced > 0 ? 'PARTIALLY_BILLED' : 'NOT_BILLED';
        await tx.purchaseOrder.update({ where: { id: dto.purchaseOrderId }, data: { billingStatus: bs } });
      });
    }
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'SupplierInvoice', si.id, { invoiceNo });
    return si;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.bills.manage')
  @Post('supplier-invoices/:id/post') async postSupplierInvoice(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const si = await this.prisma.supplierInvoice.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!si) throw new BadRequestException('Supplier bill not found');
    await this.ensureBillReceipt(companyId, si, req.user.sub);
    const res = await this.posting.postSupplierInvoice(companyId, id);
    await this.audit.log(companyId, req.user.sub, 'POSTED_AUTOMATICALLY', 'SupplierInvoice', id, { module: 'procurement', result: 'SUCCESS' });
    return res;
  }

  /**
   * Direct (no-PO) bill with goods received now: create the goods receipt (stock
   * movement) exactly once before the bill posts, so Inventory is capitalised
   * against a real receipt and never double-counted. Idempotent via stockReceivedAt.
   */
  private async ensureBillReceipt(companyId: string, si: any, userId?: string) {
    if (!si.receiveNow || si.stockReceivedAt) return si;
    const warehouseId = si.warehouseId || (await this.prisma.warehouse.findFirst({ where: { companyId } }))?.id;
    if (!warehouseId) throw new BadRequestException('A warehouse is required to receive goods on this bill.');
    const stockLines: any[] = [];
    for (const l of si.lines) {
      if (!l.itemId) continue;
      const item = await this.prisma.inventoryItem.findFirst({ where: { id: l.itemId, companyId } });
      if (item && isStockTracked(item.type)) stockLines.push({ itemId: l.itemId, quantity: Number(l.quantity), unitCost: Number(l.unitPrice), lineTotal: Number(l.lineTotal) });
    }
    if (stockLines.length) {
      const grnNo = await this.numbering.next(companyId, 'GRN');
      const grn = await this.prisma.goodsReceivedNote.create({ data: { companyId, supplierId: si.supplierId, warehouseId, grnNo, reference: si.invoiceNo, status: 'DRAFT', lines: { create: stockLines } }, include: { lines: true } });
      await this.confirmGrn(companyId, grn.id, userId);
    }
    await this.prisma.supplierInvoice.update({ where: { id: si.id }, data: { stockReceivedAt: new Date() } });
    return this.prisma.supplierInvoice.findFirst({ where: { id: si.id }, include: { lines: true } });
  }
  /** Save & Post / Submit for Approval — business finalize for supplier bills. */
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.bills.manage')
  @Post('supplier-invoices/:id/finalize') async finalizeSupplierInvoice(@Req() req: any, @Param('id') id: string, @Body() body: { action?: 'POST' | 'SUBMIT' }) {
    const companyId = companyIdOf(req.user);
    const action = (body?.action || 'POST').toUpperCase();
    const bill = await this.prisma.supplierInvoice.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!bill) throw new BadRequestException('Supplier bill not found');
    if (action === 'SUBMIT') {
      await this.prisma.supplierInvoice.update({ where: { id }, data: { status: 'AWAITING_APPROVAL' } });
      await this.approvals.submit(companyId, req.user.sub, {
        documentType: 'SUPPLIER_INVOICE',
        documentId: id,
        documentNo: bill.invoiceNo,
        amount: Number(bill.total || 0),
        comment: 'Submitted for approval from procurement',
      });
      await this.audit.log(companyId, req.user.sub, 'SUBMITTED_FOR_APPROVAL', 'SupplierInvoice', id, {});
      return this.prisma.supplierInvoice.findUnique({ where: { id }, include: { lines: true } });
    }
    await this.ensureBillReceipt(companyId, bill, req.user.sub);
    const res = await this.posting.postSupplierInvoice(companyId, id);
    await this.audit.log(companyId, req.user.sub, 'POSTED_AUTOMATICALLY', 'SupplierInvoice', id, {});
    return res;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.bills.manage')
  @Post('supplier-invoices/:id/attachments') async addBillAttachment(@Req() req: any, @Param('id') id: string, @Body() b: any) {
    const companyId = companyIdOf(req.user);
    const bill = await this.prisma.supplierInvoice.findFirst({ where: { id, companyId } });
    if (!bill) throw new BadRequestException('Supplier bill not found');
    if (!b?.name) throw new BadRequestException('Attachment name is required');
    const att = await this.prisma.supplierInvoiceAttachment.create({ data: { companyId, supplierInvoiceId: id, name: b.name, mime: b.mime || 'application/pdf', size: b.size || 0, dataUrl: b.dataUrl, createdBy: this.nameOf(req) } });
    await this.audit.log(companyId, req.user.sub, 'ATTACHMENT_ADDED', 'SupplierInvoice', id, { attachmentName: b.name });
    return att;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.bills.manage')
  @Delete('supplier-invoices/:id/attachments/:attId') async removeBillAttachment(@Req() req: any, @Param('id') id: string, @Param('attId') attId: string) {
    const companyId = companyIdOf(req.user);
    const att = await this.prisma.supplierInvoiceAttachment.findFirst({ where: { id: attId, supplierInvoiceId: id, companyId } });
    if (att) await this.prisma.supplierInvoiceAttachment.delete({ where: { id: att.id } });
    await this.audit.log(companyId, req.user.sub, 'ATTACHMENT_REMOVED', 'SupplierInvoice', id, { attachmentName: att?.name });
    return { ok: true };
  }
  @Delete('supplier-invoices/:id') async deleteSupplierInvoice(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const bill = await this.prisma.supplierInvoice.findFirst({ where: { id, companyId } });
    if (!bill) throw new BadRequestException('Supplier bill not found');
    if (!['DRAFT', 'AWAITING_APPROVAL'].includes(bill.status)) throw new BadRequestException('Only draft / awaiting-approval bills can be deleted. Void or credit posted bills.');
    await this.prisma.supplierInvoice.deleteMany({ where: { id, companyId } });
    return { ok: true };
  }

  // ----- Supplier payments -----
  @Get('supplier-payments') supplierPayments(@Req() req: any) {
    return this.prisma.supplierPayment.findMany({ where: { companyId: companyIdOf(req.user) }, include: { supplierInvoice: { include: { supplier: true } }, supplier: true, allocations: { include: { supplierInvoice: true } } }, orderBy: { paidAt: 'desc' } });
  }
  private async prepayCode(companyId: string, needed: number) {
    if (!(needed > 0)) return null;
    const acc = await this.prisma.ledgerAccount.findFirst({ where: { companyId, type: 'ASSET', OR: [{ name: { contains: 'prepay', mode: 'insensitive' } }, { name: { contains: 'advance', mode: 'insensitive' } }, { code: { startsWith: '14' } }] }, orderBy: { code: 'asc' } });
    if (!acc) throw new BadRequestException('Supplier advance requires a Supplier Prepayment account. Configure one first.');
    return acc.code;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.payments.manage')
  @Post('supplier-payments') async createSupplierPayment(@Req() req: any, @Body() dto: CreateSupplierPaymentDto) {
    const companyId = companyIdOf(req.user);
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('Payment amount must be greater than 0');
    const allocs = (dto.allocations || []).map((a) => ({ supplierInvoiceId: a.supplierInvoiceId, amount: Number(a.amount) })).filter((a) => a.amount > 0);
    const applied = allocs.reduce((s, a) => s + a.amount, 0);
    if (applied > amount + 0.005) throw new BadRequestException('Total applied exceeds payment amount');
    let supplierId = dto.supplierId;
    if (!supplierId && allocs.length) supplierId = (await this.prisma.supplierInvoice.findFirst({ where: { id: allocs[0].supplierInvoiceId, companyId } }))?.supplierId;
    if (!supplierId) throw new BadRequestException('Supplier is required');
    // Concurrency: re-read each bill's true outstanding balance before applying.
    for (const a of allocs) {
      const b = await this.prisma.supplierInvoice.findFirst({ where: { id: a.supplierInvoiceId, companyId } });
      if (!b) throw new BadRequestException('Invoice not found');
      if (b.supplierId !== supplierId) throw new BadRequestException('All bills must belong to the same supplier');
      if (b.status !== 'POSTED') throw new BadRequestException('Only posted bills can be paid');
      const balance = Math.max(0, Number(b.total) - Number(b.amountPaid));
      if (a.amount > balance + 0.005) throw new BadRequestException(`Bill ${b.invoiceNo} balance has changed. Current outstanding balance: ${balance.toFixed(2)}`);
    }
    const payFrom = await this.accountByCode(companyId, dto.payFromAccountId);
    const unapplied = Math.max(0, amount - applied);
    const prepay = await this.prepayCode(companyId, unapplied);
    const paymentNo = await this.numbering.next(companyId, 'SP');
    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.supplierPayment.create({ data: { companyId, supplierId, paymentNo, paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(), amount, applied, unapplied, method: dto.method || 'BANK', referenceNo: dto.referenceNo, note: dto.note, payFromAccountId: dto.payFromAccountId, payFromAccountCode: payFrom.code, payFromAccountName: payFrom.name, status: 'POSTED', createdBy: this.nameOf(req), createdById: req.user?.sub, allocations: { create: allocs.map((a) => ({ supplierInvoiceId: a.supplierInvoiceId, amountApplied: a.amount })) } } });
      for (const a of allocs) {
        const b = await tx.supplierInvoice.findUnique({ where: { id: a.supplierInvoiceId } });
        if (!b) continue;
        const newPaid = Number(b.amountPaid || 0) + a.amount;
        const newDue = Math.max(0, Number(b.total) - newPaid);
        const ps = newPaid <= 0.005 ? 'UNPAID' : newDue <= 0.005 ? 'PAID' : 'PARTIALLY_PAID';
        await tx.supplierInvoice.update({ where: { id: b.id }, data: { amountPaid: newPaid, balanceDue: newDue, paymentStatus: ps, status: 'POSTED' } });
      }
      return p;
    });
    await this.posting.postJournal(companyId, {
      date: payment.paidAt, description: `Supplier payment ${paymentNo}${supplierId ? ` to ${payFrom.name}` : ''}`, reference: paymentNo, sourceType: 'SUPPLIER_PAYMENT', sourceId: payment.id,
      lines: [
        ...allocs.map((a) => ({ code: '2000', debit: a.amount, credit: 0, description: 'Accounts payable settlement' })),
        ...(unapplied > 0 && prepay ? [{ code: prepay, debit: unapplied, credit: 0, description: 'Supplier prepayment' }] : []),
        { code: payFrom.code, debit: 0, credit: amount, description: 'Cash / bank' },
      ],
    }).catch(async (e: any) => {
      await this.prisma.$transaction(async (tx) => {
        for (const a of allocs) { const b = await tx.supplierInvoice.findUnique({ where: { id: a.supplierInvoiceId } }); if (b) await tx.supplierInvoice.update({ where: { id: b.id }, data: { amountPaid: Math.max(0, Number(b.amountPaid) - a.amount), balanceDue: Number(b.balanceDue) + a.amount, paymentStatus: Number(b.balanceDue) + a.amount <= 0.005 ? 'PAID' : 'PARTIALLY_PAID' } }); }
        await tx.supplierPayment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      });
      throw new BadRequestException(e.message || 'Payment posting failed');
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'SupplierPayment', payment.id, { paymentNo, amount, applied, unapplied });
    return this.prisma.supplierPayment.findUnique({ where: { id: payment.id }, include: { allocations: { include: { supplierInvoice: true } }, supplier: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('procurement.payments.manage')
  @Post('supplier-payments/:id/reverse') async reverseSupplierPayment(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const payment = await this.prisma.supplierPayment.findFirst({ where: { id, companyId }, include: { allocations: true } });
    if (!payment) throw new BadRequestException('Payment not found');
    if (payment.status === 'REVERSED') throw new BadRequestException('Payment already reversed');
    if (!body?.reason) throw new BadRequestException('Reversal reason is required');
    await this.prisma.$transaction(async (tx) => {
      for (const a of payment.allocations) {
        const b = await tx.supplierInvoice.findUnique({ where: { id: a.supplierInvoiceId } });
        if (!b) continue;
        const newPaid = Math.max(0, Number(b.amountPaid) - Number(a.amountApplied));
        const newDue = Number(b.total) - newPaid;
        const ps = newPaid <= 0.005 ? 'UNPAID' : newDue <= 0.005 ? 'PAID' : 'PARTIALLY_PAID';
        await tx.supplierInvoice.update({ where: { id: b.id }, data: { amountPaid: newPaid, balanceDue: Math.max(0, newDue), paymentStatus: ps } });
      }
      await tx.supplierPayment.update({ where: { id }, data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: body.reason, reversalOfId: payment.reversalOfId || null } });
    });
    await this.posting.postJournal(companyId, {
      date: new Date(), description: `Reverse payment ${payment.paymentNo}`, reference: `${payment.paymentNo}-REV`, sourceType: 'SUPPLIER_PAYMENT_REVERSAL', sourceId: payment.id,
      lines: [
        { code: '2000', debit: Number(payment.applied), credit: 0, description: 'Reverse accounts payable settlement' },
        { code: payment.payFromAccountCode || '1000', debit: 0, credit: Number(payment.amount), description: 'Cash / bank reversal' },
      ],
    }).catch((e: any) => { throw new BadRequestException(e.message || 'Reversal GL posting failed'); });
    await this.audit.log(companyId, req.user.sub, 'REVERSE', 'SupplierPayment', id, { paymentNo: payment.paymentNo, reason: body.reason });
    return this.prisma.supplierPayment.findUnique({ where: { id }, include: { allocations: true } });
  }
  @Delete('supplier-payments/:id') async deleteSupplierPayment(@Req() req: any, @Param('id') id: string) {
    await this.prisma.supplierPayment.deleteMany({ where: { id, companyId: companyIdOf(req.user), status: { not: 'POSTED' } } });
    return { ok: true };
  }

  @Get('purchase-report') async purchaseReport(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const pos = await this.prisma.purchaseOrder.findMany({ where: { companyId } });
    const byMonth: Record<string, { month: string; value: number }> = {};
    for (const po of pos) {
      const key = `${po.orderDate.getFullYear()}-${String(po.orderDate.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = { month: key, value: 0 };
      byMonth[key].value += Number(po.total);
    }
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }

  // ----- Supplier goods returns (physical RETURN_OUT → optional Vendor Credit) -----
  @Get('supplier-returns') supplierReturns(@Req() req: any) {
    return this.prisma.supplierReturn.findMany({
      where: { companyId: companyIdOf(req.user) },
      include: { supplier: true, purchaseOrder: true, grn: true, supplierInvoice: true, warehouse: true, vendorCredit: true, lines: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('supplier-returns') async createSupplierReturn(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    if (!body?.supplierId) throw new BadRequestException('Supplier is required');
    if (!body?.warehouseId) throw new BadRequestException('Warehouse is required for goods returns');
    const lines = Array.isArray(body.lines) ? body.lines.filter((l: any) => Number(l.quantity) > 0) : [];
    if (!lines.length) throw new BadRequestException('Add at least one return line with quantity');
    if (lines.some((l: any) => !l.itemId)) throw new BadRequestException('Every goods-return line needs an inventory item');
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId } });
    if (!warehouse) throw new BadRequestException('Warehouse not found');
    const returnNo = await this.numbering.next(companyId, 'SRTN');
    const row = await this.prisma.supplierReturn.create({
      data: {
        companyId,
        returnNo,
        supplierId: body.supplierId,
        purchaseOrderId: body.purchaseOrderId || null,
        grnId: body.grnId || null,
        supplierInvoiceId: body.supplierInvoiceId || null,
        warehouseId: body.warehouseId,
        reason: body.reason || 'Supplier return',
        notes: body.notes,
        returnedAt: body.returnedAt ? new Date(body.returnedAt) : new Date(),
        status: 'DRAFT',
        lines: {
          create: lines.map((l: any) => ({
            description: l.description || 'Return line',
            itemId: l.itemId,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice || 0),
            taxRate: Number(l.taxRate || 0),
            unitCost: Number(l.unitCost || 0),
          })),
        },
      },
      include: { lines: true, supplier: true },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'SupplierReturn', row.id, { returnNo });
    if (body.confirm) return this.confirmSupplierReturn(req, row.id, { issueCredit: body.issueCredit !== false, postCredit: !!body.postCredit });
    return row;
  }

  @Post('supplier-returns/:id/confirm') async confirmSupplierReturn(@Req() req: any, @Param('id') id: string, @Body() body: any = {}) {
    const companyId = companyIdOf(req.user);
    const ret = await this.prisma.supplierReturn.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!ret) throw new BadRequestException('Supplier return not found');
    if (ret.status === 'CONFIRMED') {
      return this.prisma.supplierReturn.findFirst({ where: { id }, include: { lines: true, vendorCredit: true, supplier: true, warehouse: true, purchaseOrder: true, grn: true, supplierInvoice: true } });
    }
    if (ret.status === 'CANCELLED') throw new BadRequestException('Return is cancelled');
    if (!ret.warehouseId) throw new BadRequestException('Warehouse is required');

    let vendorCreditId = ret.vendorCreditId;
    await this.prisma.$transaction(async (tx) => {
      for (const line of ret.lines) {
        if (!line.itemId) continue;
        const item = await tx.inventoryItem.findFirst({ where: { id: line.itemId, companyId } });
        if (!item || !isStockTracked(item.type)) continue;
        await this.stock.create(companyId, {
          warehouseId: ret.warehouseId!,
          itemId: line.itemId,
          type: 'RETURN_OUT',
          quantity: Number(line.quantity),
          unitCost: Number(line.unitCost || line.unitPrice || 0),
          reference: ret.returnNo,
          occurredAt: ret.returnedAt,
        }, req.user.sub, tx);
      }
      await tx.supplierReturn.update({ where: { id: ret.id }, data: { status: 'CONFIRMED' } });
    });

    if (body?.issueCredit !== false && !vendorCreditId) {
      let subtotal = 0; let taxTotal = 0;
      const mapped = ret.lines.map((l) => {
        const net = Number(l.quantity) * Number(l.unitPrice);
        const tax = net * (Number(l.taxRate) / 100);
        subtotal += net; taxTotal += tax;
        return {
          description: l.description,
          itemId: l.itemId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxRate: Number(l.taxRate),
          taxAmount: Number(tax.toFixed(2)),
          lineTotal: Number((net + tax).toFixed(2)),
        };
      });
      const no = await this.numbering.next(companyId, 'VC');
      const vc = await this.prisma.vendorCredit.create({
        data: {
          companyId,
          supplierId: ret.supplierId,
          vendorCreditNo: no,
          creditDate: ret.returnedAt,
          status: 'DRAFT',
          applicationStatus: 'UNAPPLIED',
          currency: 'USD',
          subtotal: Number(subtotal.toFixed(2)),
          taxTotal: Number(taxTotal.toFixed(2)),
          total: Number((subtotal + taxTotal).toFixed(2)),
          reason: ret.reason || 'Supplier return',
          sourceInvoiceId: ret.supplierInvoiceId,
          sourcePurchaseOrderId: ret.purchaseOrderId,
          sourceGrnId: ret.grnId,
          createdById: req.user.sub,
          lines: { create: mapped },
        },
      });
      vendorCreditId = vc.id;
      await this.prisma.supplierReturn.update({ where: { id: ret.id }, data: { vendorCreditId: vc.id } });
      await this.audit.log(companyId, req.user.sub, 'VENDOR_CREDIT_CREATED', 'VendorCredit', vc.id, { vcNo: no, via: 'supplierReturn', returnNo: ret.returnNo });
      if (body?.postCredit) {
        // Reuse finance posting path via PostingService journal shape used by vendor credits
        const lines: any[] = [];
        for (const l of mapped) {
          lines.push({ code: l.itemId ? '1200' : '6000', debit: 0, credit: Number((l.lineTotal - l.taxAmount).toFixed(2)), description: l.description });
        }
        if (taxTotal > 0) lines.push({ code: '2100', debit: 0, credit: Number(taxTotal.toFixed(2)), description: 'Input VAT reversal' });
        lines.push({ code: '2000', debit: Number((subtotal + taxTotal).toFixed(2)), credit: 0, description: 'Accounts payable reduction' });
        await this.posting.postJournal(companyId, { date: ret.returnedAt, description: `Vendor credit ${no}`, reference: no, sourceType: 'VENDOR_CREDIT', sourceId: vc.id, lines, userId: req.user.sub });
        await this.prisma.vendorCredit.update({ where: { id: vc.id }, data: { status: 'POSTED' } });
      }
    }

    await this.audit.log(companyId, req.user.sub, 'CONFIRM', 'SupplierReturn', ret.id, { returnNo: ret.returnNo, vendorCreditId });
    return this.prisma.supplierReturn.findFirst({ where: { id: ret.id }, include: { lines: true, vendorCredit: true, supplier: true, warehouse: true, purchaseOrder: true, grn: true, supplierInvoice: true } });
  }
}
