const normPhone = (v: any): any => { if (!v) return v; const s = String(v).replace(/[^0-9+]/g, ''); if (s.startsWith('+')) return s; if (/^0\d{9}$/.test(s)) return '+263' + s.slice(1); if (/^263\d{9}$/.test(s)) return '+' + s; return s; };
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { companyIdOf } from '../../core/context';
import { CreateInvoiceDto, CreateQuotationDto, CreateReceiptDto, CreateSalesOrderDto, CreateCreditNoteDto, CustomerDto, StatusDto, UpdateInvoiceDto } from './sales.dto';
import { PostingService } from '../finance/posting.service';
import { InvoiceStatusService } from '../finance/invoice-status.service';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { DocumentTrailService } from '../document-trail/document-trail.service';
import { DocumentEmailService } from '../document-trail/document-email.service';
import { CustomerPaymentsService } from './customer-payments.service';
import { PricingService } from './pricing.service';
import { QuotationStatusService } from './quotation-status.service';
import { POSTED_INVOICE_EDIT_MESSAGE, SalesIntegrityService } from './sales-integrity.service';
import { InventoryMovementService } from '../inventory/inventory-movement.service';
import { getTransactionPostingMode } from '../finance/transaction-mode';
import { isStockTracked } from '../inventory/item-type';

@ApiTags('Sales') @ApiBearerAuth() @UseGuards(JwtAuthGuard, PermissionsGuard) @Controller('sales')
export class SalesController {
  constructor(
    private prisma: PrismaService,
    private posting: PostingService,
    private numbering: NumberingService,
    private audit: AuditService,
    private trail: DocumentTrailService,
    private email: DocumentEmailService,
    private payments: CustomerPaymentsService,
    private invoiceStatus: InvoiceStatusService,
    private pricing: PricingService,
    private quoteStatus: QuotationStatusService,
    private integrity: SalesIntegrityService,
    private stock: InventoryMovementService,
  ) {}

  /**
   * Authoritative Display Name resolution (spec: blank display name auto-generates):
   * explicit value → companyName → firstName+lastName → firstName → lastName → customer code.
   */
  private resolveDisplayName(input: { name?: string; companyName?: string; firstName?: string; lastName?: string }, fallbackCode: string, existing?: { firstName?: string | null; lastName?: string | null; companyName?: string | null }): string {
    const explicit = String(input.name ?? '').trim();
    if (explicit) return explicit;
    const company = String(input.companyName ?? existing?.companyName ?? '').trim();
    if (company) return company;
    const first = String(input.firstName ?? existing?.firstName ?? '').trim();
    const last = String(input.lastName ?? existing?.lastName ?? '').trim();
    const person = [first, last].filter(Boolean).join(' ').trim();
    if (person) return person;
    if (first) return first;
    if (last) return last;
    return fallbackCode;
  }

  private computeLines(lines: any[]) {
    this.integrity.validateLines(lines);
    let subtotal = 0, taxTotal = 0;
    const mapped = lines.map((l) => {
      const qty = Number(l.quantity);
      const rate = Number(l.unitPrice);
      const discount = Number(l.discount || 0);
      const net = qty * rate - discount;
      const taxRate = Number(l.taxRate || 0);
      const tax = net * (taxRate / 100);
      const { priceSource, ..._ignored } = l;
      subtotal += net; taxTotal += tax;
      return {
        description: String(l.description || ''),
        itemId: l.itemId || undefined,
        quantity: qty,
        unitPrice: rate,
        taxRate,
        taxAmount: Number(tax.toFixed(2)),
        lineTotal: Number((net + tax).toFixed(2)),
        hsCode: l.hsCode,
        unit: l.unit,
        discount,
        salesOrderLineId: l.salesOrderLineId,
      };
    });
    return { mapped, subtotal: Number(subtotal.toFixed(2)), taxTotal: Number(taxTotal.toFixed(2)), total: Number((subtotal + taxTotal).toFixed(2)) };
  }

  /** Terms engine: Net 30 + 2026-09-06 → 2026-10-06. */
  private dueDateFromTerms(terms?: string | null, invoiceDate?: string | null): Date | undefined {
    if (!invoiceDate) return undefined;
    const d = new Date(invoiceDate);
    if (Number.isNaN(d.getTime())) return undefined;
    const t = String(terms || '').toLowerCase();
    if (t.includes('net 15')) { d.setDate(d.getDate() + 15); return d; }
    if (t.includes('net 30')) { d.setDate(d.getDate() + 30); return d; }
    if (t.includes('net 60')) { d.setDate(d.getDate() + 60); return d; }
    if (t.includes('net 90')) { d.setDate(d.getDate() + 90); return d; }
    return undefined; // Due on Receipt / unknown terms: leave unset
  }

  // Deactivated customers cannot be used to create anything new.
  private async ensureCustomerActive(companyId: string, customerId?: string | null) {
    if (!customerId) return;
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, companyId } });
    if (!c) throw new BadRequestException('Customer not found');
    if (c.status && c.status !== 'ACTIVE') throw new BadRequestException('Customer is deactivated and cannot be used');
  }
  private async customerInCompany(companyId: string, id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, companyId } });
    if (!c) throw new BadRequestException('Customer not found');
    return c;
  }

  // ----- Customers -----
  @Get('customers') customers(@Req() req: any) { return this.prisma.customer.findMany({ where: { companyId: companyIdOf(req.user) }, orderBy: { name: 'asc' } }); }

  /** Shared customer → document hydration defaults (quote/order/invoice use the same path). */
  @Get('customers/:id/document-defaults') async documentDefaults(@Req() req: any, @Param('id') id: string) {
    const d = await this.pricing.documentDefaults(companyIdOf(req.user), id);
    if (!d) throw new BadRequestException('Customer not found');
    return d;
  }

  /** Authoritative sales price resolution (price list → default selling price). */
  @Get('pricing/resolve') async resolvePrice(@Req() req: any, @Query() q: { itemId?: string; customerId?: string; currency?: string; quantity?: string }) {
    if (!q.itemId) throw new BadRequestException('itemId is required');
    return this.pricing.resolve(companyIdOf(req.user), { itemId: q.itemId, customerId: q.customerId, currency: q.currency, quantity: q.quantity ? Number(q.quantity) : null });
  }

  @Post('customers') @RequirePermissions('sales.customers.manage') async createCustomer(@Req() req: any, @Body() dto: CustomerDto) {
    const companyId = companyIdOf(req.user);
    const code = dto.code || await this.numbering.next(companyId, 'CUS');
    const name = this.resolveDisplayName(dto, code);
    const customer = await this.prisma.customer.create({ data: { companyId, code, name, firstName: dto.firstName, lastName: dto.lastName, companyName: dto.companyName, email: dto.email, phone: normPhone(dto.phone), mobile: normPhone(dto.mobile), address1: dto.address1, address2: dto.address2, city: dto.city, state: dto.state, zip: dto.zip, country: dto.country, paymentTerms: dto.paymentTerms || null, notes: dto.notes, taxStatus: dto.taxStatus, defaultTaxRate: dto.defaultTaxRate ?? 0, tin: dto.tin, vatNumber: dto.vatNumber, creditLimit: dto.creditLimit ?? 0, priceListId: dto.priceListId || null, status: dto.status || 'ACTIVE' } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Customer', customer.id, { code });
    await this.trail.create(companyId, { documentType: 'CUSTOMER', documentId: customer.id, eventType: 'CREATED', title: 'Customer Created', description: `Customer ${customer.name} created.`, userId: req.user.sub }).catch(() => {});
    return customer;
  }
  @Patch('customers/:id') @RequirePermissions('sales.customers.manage') async updateCustomer(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<CustomerDto>) {
    const companyId = companyIdOf(req.user);
    const before = await this.prisma.customer.findFirst({ where: { id, companyId } });
    if (!before) throw new BadRequestException('Customer not found');
    const data = { ...dto } as any;
    // Display Name cleared → regenerate from company/person fields (never store an empty string).
    if (data.name !== undefined) {
      const cleared = !String(data.name ?? '').trim();
      if (cleared) data.name = this.resolveDisplayName({ ...dto, name: undefined }, before.code, before);
      else data.name = String(data.name).trim();
    }
    if (data.phone) data.phone = normPhone(data.phone);
    if (data.mobile) data.mobile = normPhone(data.mobile);
    const res = await this.prisma.customer.updateMany({ where: { id, companyId }, data });
    await this.audit.log(companyId, req.user.sub, 'UPDATE', 'Customer', id, data);
    if (dto.status && dto.status !== before.status) {
      const active = dto.status === 'ACTIVE';
      await this.trail.create(companyId, { documentType: 'CUSTOMER', documentId: id, eventType: active ? 'CUSTOMER_ACTIVATED' : 'CUSTOMER_DEACTIVATED', title: active ? 'Customer Activated' : 'Customer Deactivated', description: `${before.name} was ${active ? 'activated' : 'deactivated'}.`, userId: req.user.sub }).catch(() => {});
    } else if (!dto.status || JSON.stringify(data) !== '{}') {
      await this.trail.create(companyId, { documentType: 'CUSTOMER', documentId: id, eventType: 'UPDATED', title: 'Customer Updated', description: `${before.name} details updated.`, userId: req.user.sub }).catch(() => {});
    }
    return this.prisma.customer.findUnique({ where: { id }, include: { interactions: true } });
  }
  @Get('customers/:id/trail') customerTrail(@Req() req: any, @Param('id') id: string, @Query() q: any) {
    return this.trail.list(companyIdOf(req.user), 'CUSTOMER', id, { limit: q.limit, cursor: q.cursor });
  }
  @Post('customers/:id/notes') async addCustomerNote(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    await this.customerInCompany(companyId, id);
    if (!body?.note?.trim()) throw new BadRequestException('Note is required');
    return this.trail.addNote(companyId, 'CUSTOMER', id, body.note, req.user.sub);
  }
  @Delete('customers/:id') @RequirePermissions('sales.customers.manage') async deleteCustomer(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    await this.prisma.customer.deleteMany({ where: { id, companyId } });
    await this.audit.log(companyId, req.user.sub, 'DELETE', 'Customer', id);
    return { ok: true };
  }

  // ----- Quotations -----
  @Get('quotations') quotations(@Req() req: any) {
    return this.prisma.quotation.findMany({ where: { companyId: companyIdOf(req.user) }, include: { customer: true, branch: true, lines: true, invoices: { where: { invoiceStatus: { not: 'VOID' } }, select: { id: true, invoiceNo: true, status: true } }, salesOrders: { select: { id: true, orderNo: true, status: true } } }, orderBy: { createdAt: 'desc' } });
  }
  @Post('quotations') @RequirePermissions('sales.quotes.create', 'sales.quotes.manage') async createQuotation(@Req() req: any, @Body() dto: CreateQuotationDto) {
    const companyId = companyIdOf(req.user);
    await this.integrity.assertCustomer(companyId, dto.customerId);
    await this.integrity.assertProducts(companyId, dto.lines);
    await this.integrity.assertCurrency(companyId, dto.currency || 'USD');
    await this.integrity.applyPricing(companyId, { customerId: dto.customerId, currency: dto.currency || 'USD', lines: dto.lines as any[] });
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    const quotationNo = await this.numbering.next(companyId, 'QT');
    const quotation = await this.prisma.quotation.create({ data: { companyId, branchId: dto.branchId, customerId: dto.customerId, projectId: dto.projectId, quotationNo, address: dto.address, notes: dto.notes, statementMemo: dto.statementMemo, validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined, currency: dto.currency || 'USD', status: 'DRAFT', subtotal, taxTotal, total, lines: { create: mapped.map((l) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) } }, include: { lines: true } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Quotation', quotation.id, { quotationNo });
    await this.trail.create(companyId, { documentType: 'QUOTE', documentId: quotation.id, eventType: 'CREATED', title: 'Quote Created', description: `Quotation ${quotationNo} created.`, userId: req.user.sub }).catch(() => {});
    if (dto.status && this.quoteStatus.normalize(dto.status) !== 'DRAFT') {
      await this.quoteStatus.transition(companyId, quotation.id, dto.status, req.user.sub);
      return this.prisma.quotation.findUnique({ where: { id: quotation.id }, include: { lines: true } });
    }
    return quotation;
  }
  @Patch('quotations/:id/status') @RequirePermissions('sales.quotes.update', 'sales.quotes.manage', 'sales.quotes.approve', 'sales.quotes.cancel') async setQuotationStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    const companyId = companyIdOf(req.user);
    const to = this.quoteStatus.normalize(dto.status);
    if (to === 'APPROVED' || to === 'PENDING_APPROVAL') {
      // approve is a distinct permission when not covered by manage — guard is OR so manage still works
    }
    return this.quoteStatus.transition(companyId, id, dto.status, req.user.sub);
  }
  @Post('quotations/:id/convert') @RequirePermissions('sales.quotes.convert_order', 'sales.quotes.manage') async convertQuotation(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const quotation = await this.prisma.quotation.findFirst({ where: { id, companyId }, include: { lines: true, customer: true } });
    if (!quotation) throw new BadRequestException('Quotation not found');
    this.quoteStatus.assertConvertible(quotation.status, quotation.validUntil);
    if (quotation.conversionType || String(quotation.status).toUpperCase() === 'CONVERTED') throw new BadRequestException('Quote already converted');
    await this.ensureCustomerActive(companyId, quotation.customerId);
    const orderNo = await this.numbering.next(companyId, 'SO');
    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const o = await tx.salesOrder.create({
          data: { companyId, branchId: quotation.branchId ?? undefined, customerId: quotation.customerId, projectId: quotation.projectId, quotationId: quotation.id, orderNo, status: 'CONFIRMED',
            orderDate: new Date(), expectedDate: quotation.validUntil ? new Date(quotation.validUntil) : undefined, dueDate: quotation.validUntil ? new Date(quotation.validUntil) : undefined,
            billingAddress: quotation.address, customerReference: quotation.customer?.name, customerMessage: quotation.notes, notes: quotation.notes,
            currency: quotation.currency || 'USD', exchangeRate: Number(quotation.exchangeRate || 1), subtotal: quotation.subtotal, taxTotal: quotation.taxTotal, total: quotation.total,
            lines: { create: quotation.lines.map((l) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) },
          },
          include: { lines: true },
        });
        await tx.quotation.update({ where: { id: quotation.id }, data: { status: 'CONVERTED', conversionType: 'SALES_ORDER', conversionDate: new Date() } });
        await tx.documentTrailEvent.create({ data: { companyId, documentType: 'SALES_ORDER', documentId: o.id, eventType: 'CREATED', title: 'Quote Converted to Order', description: `Sales order ${orderNo} created from quotation ${quotation.quotationNo}.`, metadata: { quotationId: quotation.id, quotationNo: quotation.quotationNo }, userId: req.user.sub } });
        return o;
      });
      await this.trail.create(companyId, { documentType: 'QUOTE', documentId: quotation.id, eventType: 'QUOTE_CONVERTED', title: 'Converted to Sales Order', description: `Quotation ${quotation.quotationNo} converted to Sales Order ${orderNo}.`, metadata: { orderId: order.id, orderNo }, userId: req.user.sub }).catch(() => {});
      await this.audit.log(companyId, req.user.sub, 'CONVERT', 'Quotation', quotation.id, { orderNo, conversionType: 'SALES_ORDER' });
      await this.confirmOrder(req, order.id);
      return this.prisma.salesOrder.findUnique({ where: { id: order.id }, include: { lines: true } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException('Quote already converted');
      throw e;
    }
  }
  @Delete('quotations/:id') @RequirePermissions('sales.quotes.cancel', 'sales.quotes.manage') async deleteQuotation(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const q = await this.prisma.quotation.findFirst({ where: { id, companyId } });
    if (!q) throw new BadRequestException('Quotation not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.salesOrder.updateMany({ where: { quotationId: id }, data: { quotationId: null } });
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      await tx.documentTrailEvent.deleteMany({ where: { documentType: 'QUOTE', documentId: id } });
      await tx.quotation.delete({ where: { id } });
    });
    return { ok: true };
  }
  @Post('quotations/:id/convert-invoice') @RequirePermissions('sales.quotes.convert_invoice', 'sales.quotes.manage') async convertQuotationToInvoice(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const quotation = await this.prisma.quotation.findFirst({ where: { id, companyId }, include: { lines: true, customer: true } });
    if (!quotation) throw new BadRequestException('Quotation not found');
    this.quoteStatus.assertConvertible(quotation.status, quotation.validUntil);
    if (quotation.conversionType || String(quotation.status).toUpperCase() === 'CONVERTED') throw new BadRequestException('Quote already converted');
    await this.ensureCustomerActive(companyId, quotation.customerId);
    const branchId = quotation.branchId || (await this.prisma.branch.findFirst({ where: { companyId } }))?.id;
    if (!branchId) throw new BadRequestException('Create a branch first');
    const invoiceNo = await this.numbering.next(companyId, 'INV');
    const perLine = body?.lines?.length ? body.lines : quotation.lines;
    const invoice = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.create({
        data: { companyId, branchId, customerId: quotation.customerId, invoiceNo, currency: quotation.currency || 'USD', exchangeRate: Number(quotation.exchangeRate || 1),
          invoiceDate: new Date(), dueDate: quotation.validUntil ? new Date(quotation.validUntil) : undefined,
          billingAddress: quotation.address, customerReference: quotation.customer?.name, projectId: quotation.projectId, sourceQuoteId: quotation.id,
          subtotal: quotation.subtotal, taxTotal: quotation.taxTotal, total: quotation.total, fiscalRequired: true, fiscalStatus: 'READY', status: 'DRAFT', invoiceStatus: 'DRAFT',
          lines: { create: perLine.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) },
        },
        include: { lines: true },
      });
      await tx.quotation.update({ where: { id: quotation.id }, data: { status: 'CONVERTED', conversionType: 'INVOICE', conversionDate: new Date() } });
      await tx.documentTrailEvent.create({ data: { companyId, documentType: 'INVOICE', documentId: inv.id, eventType: 'CREATED', title: 'Invoice Created', description: `Created directly from Quote ${quotation.quotationNo}.`, metadata: { quotationId: quotation.id, quotationNo: quotation.quotationNo }, userId: req.user.sub } });
      return inv;
    });
    await this.trail.create(companyId, { documentType: 'QUOTE', documentId: quotation.id, eventType: 'QUOTE_CONVERTED', title: 'Converted to Invoice', description: `Quotation ${quotation.quotationNo} converted to Invoice ${invoiceNo}.`, metadata: { invoiceId: invoice.id, invoiceNo }, userId: req.user.sub }).catch(() => {});
    await this.audit.log(companyId, req.user.sub, 'CONVERT', 'Quotation', quotation.id, { invoiceNo, conversionType: 'INVOICE' });
    return invoice;
  }
  @Patch('quotations/:id') @RequirePermissions('sales.quotes.update', 'sales.quotes.manage') async updateQuotation(@Req() req: any, @Param('id') id: string, @Body() dto: CreateQuotationDto) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.quotation.findFirst({ where: { id, companyId } });
    if (!existing) throw new BadRequestException('Quotation not found');
    const st = this.quoteStatus.normalize(existing.status);
    if (['CONVERTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(st)) throw new BadRequestException(`A ${st} quotation cannot be edited`);
    await this.integrity.assertCustomer(companyId, dto.customerId ?? existing.customerId);
    await this.integrity.assertProducts(companyId, dto.lines);
    await this.integrity.assertCurrency(companyId, (dto as any).currency || existing.currency);
    await this.integrity.applyPricing(companyId, { customerId: dto.customerId ?? existing.customerId, currency: existing.currency, lines: dto.lines as any[] });
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    await this.prisma.$transaction([
      this.prisma.quotationLine.deleteMany({ where: { quotationId: id } }),
      this.prisma.quotation.update({ where: { id }, data: { customerId: dto.customerId, address: dto.address, notes: dto.notes, statementMemo: dto.statementMemo, validUntil: dto.validUntil ? new Date(dto.validUntil) : existing.validUntil, subtotal, taxTotal, total } }),
    ]);
    await this.prisma.quotationLine.createMany({ data: mapped.map((l) => ({ quotationId: id, description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) });
    await this.trail.create(companyId, { documentType: 'QUOTE', documentId: id, eventType: 'UPDATED', title: 'Quote Updated', description: `Quotation ${existing.quotationNo} updated.`, userId: req.user.sub }).catch(() => {});
    if (dto.status && this.quoteStatus.normalize(dto.status) !== st) {
      await this.quoteStatus.transition(companyId, id, dto.status, req.user.sub);
    }
    return this.prisma.quotation.findUnique({ where: { id }, include: { lines: true } });
  }

  // ----- Sales orders -----
  private async deriveOrder(o: any) {
    const lines = o.lines || [];
    const totalQty = lines.reduce((s: number, l: any) => s + Number(l.quantity || 0), 0);
    const fulfilledQty = lines.reduce((s: number, l: any) => s + Number(l.deliveredQty || 0), 0);
    const invoicedQty = lines.reduce((s: number, l: any) => s + Number(l.invoicedQty || 0), 0);
    const fulfilmentStatus = totalQty <= 0 ? 'NOT_FULFILLED' : fulfilledQty <= 0 ? 'NOT_FULFILLED' : fulfilledQty >= totalQty - 0.001 ? 'FULFILLED' : 'PARTIALLY_FULFILLED';
    const invoiceProgress = totalQty <= 0 ? 'NOT_INVOICED' : invoicedQty <= 0 ? 'NOT_INVOICED' : invoicedQty >= totalQty - 0.001 ? 'INVOICED' : 'PARTIALLY_INVOICED';
    const invoicedAmount = lines.reduce((s: number, l: any) => s + Number(l.invoicedQty || 0) * Number(l.unitPrice || 0), 0);
    const fulfilmentPct = totalQty <= 0 ? 0 : Math.min(100, Math.round((fulfilledQty / totalQty) * 100));
    const invoicePct = totalQty <= 0 ? 0 : Math.min(100, Math.round((invoicedQty / totalQty) * 100));
    return { ...o, fulfilmentStatus, invoiceProgress, invoicedAmount: Number(invoicedAmount.toFixed(2)), fulfilmentPct, invoicePct, fulfilledQty: Number(fulfilledQty.toFixed(2)), invoicedQty: Number(invoicedQty.toFixed(2)), totalQty: Number(totalQty.toFixed(2)) };
  }
  private async orderLinesFor(lines: any[], qty: number) {
    // order-level discount accounting is handled by computeLines; here just map SO lines.
    return lines;
  }
  @Get('sales-orders') async orders(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const list = await this.prisma.salesOrder.findMany({
      where: { companyId },
      include: {
        customer: true, branch: true, quotation: true, lines: true,
        deliveryNotes: { select: { id: true, deliveryNo: true, status: true } },
        invoices: { where: { invoiceStatus: { not: 'VOID' } }, select: { id: true, invoiceNo: true, status: true, invoiceStatus: true, paymentStatus: true, total: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(list.map((o) => this.deriveOrder(o)));
  }
  @Get('sales-orders/:id') async getOrder(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const o = await this.prisma.salesOrder.findFirst({ where: { id, companyId }, include: { customer: true, branch: true, quotation: true, lines: true, deliveryNotes: true, invoices: { where: { invoiceStatus: { not: 'VOID' } }, include: { lines: true, customer: true } } } });
    if (!o) throw new BadRequestException('Sales order not found');
    return this.deriveOrder(o);
  }
  @Post('sales-orders') @RequirePermissions('sales.orders.create', 'sales.orders.manage') async createOrder(@Req() req: any, @Body() dto: any) {
    const companyId = companyIdOf(req.user);
    await this.integrity.assertCustomer(companyId, dto.customerId);
    await this.integrity.assertProducts(companyId, dto.lines || []);
    await this.integrity.assertWarehouse(companyId, dto.warehouseId);
    await this.integrity.assertCurrency(companyId, dto.currency || 'USD');
    await this.integrity.applyPricing(companyId, { customerId: dto.customerId, currency: dto.currency || 'USD', lines: dto.lines as any[] });
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    const lineDiscount = (dto.lines || []).reduce((s: number, l: any) => s + Number(l.discount || 0), 0);
    const discount = Number(dto.discount || lineDiscount || 0);
    const gross = Number(subtotal) - discount;
    const orderNo = await this.numbering.next(companyId, 'SO');
    const order = await this.prisma.salesOrder.create({
      data: { companyId, branchId: dto.branchId, customerId: dto.customerId, projectId: dto.projectId, quotationId: dto.quotationId || dto.sourceQuoteId || undefined, orderNo,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(), expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined, dueDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
        warehouseId: dto.warehouseId, salesperson: dto.salesperson, customerReference: dto.customerReference,
        billingAddress: dto.billingAddress, shippingAddress: dto.shippingAddress, customerMessage: dto.customerMessage, internalMemo: dto.internalMemo, terms: dto.terms,
        currency: dto.currency || 'USD', exchangeRate: Number(dto.exchangeRate || 1), discount, subtotal, taxTotal, total: Number((gross + Number(taxTotal)).toFixed(2)), notes: dto.customerMessage, status: 'DRAFT',
        lines: { create: mapped.map((l: any, i: number) => ({ description: l.description, itemId: l.itemId, unit: (dto.lines?.[i] || {}).unit, quantity: l.quantity, unitPrice: l.unitPrice, discount: Number((dto.lines?.[i] || {}).discount || 0), taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) },
      },
      include: { lines: true },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'SalesOrder', order.id, { orderNo });
    await this.trail.create(companyId, { documentType: 'SALES_ORDER', documentId: order.id, eventType: 'ORDER_CREATED', title: 'Order Created', description: `Sales order ${orderNo} created.`, userId: req.user.sub }).catch(() => {});
    return order;
  }
  @Patch('sales-orders/:id') @RequirePermissions('sales.orders.edit', 'sales.orders.manage') async updateOrder(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.salesOrder.findFirst({ where: { id, companyId }, include: { lines: true, invoices: { select: { id: true } }, deliveryNotes: { select: { id: true } } } });
    if (!existing) throw new BadRequestException('Sales order not found');
    if ((existing.invoices?.length || 0) > 0 || (existing.deliveryNotes?.length || 0) > 0) {
      throw new BadRequestException('Cannot edit lines while linked invoices/deliveries exist. Cancel the order instead.');
    }
    await this.ensureCustomerActive(companyId, dto.customerId ?? existing.customerId);
    await this.integrity.assertProducts(companyId, dto.lines || []);
    await this.integrity.assertWarehouse(companyId, dto.warehouseId ?? existing.warehouseId);
    await this.integrity.applyPricing(companyId, { customerId: dto.customerId ?? existing.customerId, currency: dto.currency || existing.currency, lines: dto.lines as any[] });
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    const lineDiscount = (dto.lines || []).reduce((s: number, l: any) => s + Number(l.discount || 0), 0);
    const discount = Number(dto.discount ?? lineDiscount ?? 0);
    const gross = Number(subtotal) - discount;
    await this.prisma.$transaction([
      this.prisma.salesOrderLine.deleteMany({ where: { salesOrderId: id } }),
      this.prisma.salesOrder.update({ where: { id }, data: {
        branchId: dto.branchId ?? existing.branchId, customerId: dto.customerId ?? existing.customerId, projectId: dto.projectId ?? existing.projectId,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : existing.orderDate, expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : existing.expectedDate, dueDate: dto.expectedDate ? new Date(dto.expectedDate) : existing.dueDate,
        warehouseId: dto.warehouseId ?? existing.warehouseId, salesperson: dto.salesperson ?? existing.salesperson, customerReference: dto.customerReference ?? existing.customerReference,
        billingAddress: dto.billingAddress ?? existing.billingAddress, shippingAddress: dto.shippingAddress ?? existing.shippingAddress, customerMessage: dto.customerMessage, internalMemo: dto.internalMemo, terms: dto.terms ?? existing.terms,
        currency: dto.currency ?? existing.currency, exchangeRate: Number(dto.exchangeRate ?? existing.exchangeRate), discount, subtotal, taxTotal, total: Number((gross + Number(taxTotal)).toFixed(2)), notes: dto.customerMessage,
      } }),
    ]);
    await this.prisma.salesOrderLine.createMany({ data: mapped.map((l: any, i: number) => ({ salesOrderId: id, description: l.description, itemId: l.itemId, unit: (dto.lines?.[i] || {}).unit, quantity: l.quantity, unitPrice: l.unitPrice, discount: Number((dto.lines?.[i] || {}).discount || 0), taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) });
    await this.trail.create(companyId, { documentType: 'SALES_ORDER', documentId: id, eventType: 'UPDATED', title: 'Order Updated', description: `Sales order ${existing.orderNo} updated.`, userId: req.user.sub }).catch(() => {});
    return this.prisma.salesOrder.findUnique({ where: { id }, include: { lines: true } });
  }
  @Patch('sales-orders/:id/status') async setOrderStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    const companyId = companyIdOf(req.user);
    const before = await this.prisma.salesOrder.findFirst({ where: { id, companyId } });
    if (!before) throw new BadRequestException('Sales order not found');
    const status = String(dto.status || '').toUpperCase();
    const allowed = ['DRAFT', 'OPEN', 'CONFIRMED', 'CLOSED', 'CANCELLED'];
    if (!allowed.includes(status)) throw new BadRequestException('Invalid sales order status');
    await this.prisma.salesOrder.updateMany({ where: { id, companyId }, data: { status } });
    await this.audit.log(companyId, req.user.sub, 'STATUS', 'SalesOrder', id, { from: before.status, to: status });
    const titles: Record<string, string> = { CONFIRMED: 'Order Confirmed', CLOSED: 'Order Closed', CANCELLED: 'Order Cancelled', OPEN: 'Order Opened' };
    await this.trail.create(companyId, { documentType: 'SALES_ORDER', documentId: id, eventType: status === 'CANCELLED' ? 'ORDER_CANCELLED' : status === 'CLOSED' ? 'ORDER_CLOSED' : status === 'CONFIRMED' ? 'ORDER_CONFIRMED' : 'ORDER_UPDATED', title: titles[status] || 'Order Updated', description: `Sales order ${before.orderNo} ${status.replace(/_/g, ' ').toLowerCase()}.`, fromStatus: before.status, toStatus: status, userId: req.user.sub }).catch(() => {});
    return { ok: true };
  }
  @Post('sales-orders/:id/confirm') @RequirePermissions('sales.orders.confirm', 'sales.orders.manage') async confirmOrder(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const order = await this.prisma.salesOrder.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!order) throw new BadRequestException('Sales order not found');
    if (order.status !== 'CONFIRMED') await this.setOrderStatus(req, id, { status: 'CONFIRMED' } as StatusDto);
    for (const l of order.lines) {
      if (!l.itemId || !(Number(l.quantity) > 0)) continue;
      const existingRes = await this.prisma.stockReservation.findFirst({ where: { companyId, salesOrderId: id, itemId: l.itemId, status: 'ACTIVE' } });
      if (existingRes) continue;
      const bal = await this.stock.balance(companyId, l.itemId, order.warehouseId);
      if (Number(l.quantity) > bal.available + 0.001) throw new BadRequestException(`Cannot reserve ${l.itemId}: only ${bal.available.toFixed(2)} available.`);
      await this.prisma.stockReservation.create({ data: { companyId, itemId: l.itemId, warehouseId: order.warehouseId || undefined, salesOrderId: id, referencedBy: order.orderNo, qty: Number(l.quantity), status: 'ACTIVE' } });
    }
    return this.prisma.salesOrder.findUnique({ where: { id } });
  }
  @Post('sales-orders/:id/close') async closeOrder(@Req() req: any, @Param('id') id: string) {
    return this.setOrderStatus(req, id, { status: 'CLOSED' } as StatusDto);
  }
  @Post('sales-orders/:id/cancel') @RequirePermissions('sales.orders.cancel', 'sales.orders.manage') async cancelOrder(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    await this.setOrderStatus(req, id, { status: 'CANCELLED' } as StatusDto);
    await this.prisma.stockReservation.updateMany({ where: { companyId, salesOrderId: id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
    return this.prisma.salesOrder.findUnique({ where: { id } });
  }
  @Delete('sales-orders/:id') async deleteOrder(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.salesOrder.findFirst({ where: { id, companyId }, include: { invoices: { select: { id: true } }, deliveryNotes: { select: { id: true } } } });
    if (!existing) throw new BadRequestException('Sales order not found');
    if ((existing.invoices?.length || 0) > 0 || (existing.deliveryNotes?.length || 0) > 0) {
      throw new BadRequestException('Cannot delete a sales order with linked invoices/deliveries. Cancel it instead.');
    }
    await this.prisma.$transaction([
      this.prisma.salesOrderLine.deleteMany({ where: { salesOrderId: id } }),
      this.prisma.documentTrailEvent.deleteMany({ where: { documentType: 'SALES_ORDER', documentId: id } }),
      this.prisma.salesOrder.deleteMany({ where: { id, companyId } }),
    ]);
    await this.audit.log(companyId, req.user.sub, 'DELETE', 'SalesOrder', id);
    return { ok: true };
  }
  @Post('sales-orders/:id/convert-invoice') @RequirePermissions('sales.orders.convert_invoice', 'sales.orders.manage') async convertOrderToInvoice(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    const companyId = companyIdOf(req.user);
    const order = await this.prisma.salesOrder.findFirst({ where: { id, companyId }, include: { lines: true, quotation: true, customer: true } });
    if (!order) throw new BadRequestException('Sales order not found');
    if (!['OPEN', 'CONFIRMED'].includes(order.status)) throw new BadRequestException('Only open/confirmed orders can be invoiced');
    await this.ensureCustomerActive(companyId, order.customerId);
    const branchId = order.branchId || (await this.prisma.branch.findFirst({ where: { companyId } }))?.id;
    if (!branchId) throw new BadRequestException('Create a branch first');
    const invoiceNo = await this.numbering.next(companyId, 'INV');
    // Build lines from requested quantities (or full remaining).
    const requested = dto?.lines || [];
    const invoiceLines: any[] = [];
    const lineUpdates: any[] = [];
    let sub = 0, disc = 0, tax = 0, totalQty = 0;
    for (const l of order.lines) {
      const already = Number(l.invoicedQty || 0);
      const remaining = Number(l.quantity) - already;
      if (remaining <= 0.001) continue;
      const req = requested.find((x: any) => x.salesOrderLineId === l.id);
      const qty = Math.min(Number(req?.quantity ?? remaining), remaining);
      if (qty <= 0.001) continue;
      const net = qty * Number(l.unitPrice);
      const discL = Number(l.discount || 0);
      const taxable = net - discL;
      const t = taxable * (Number(l.taxRate) / 100);
      const lineTotal = taxable + t;
      sub += net; disc += discL; tax += t; totalQty += qty;
      invoiceLines.push({ salesOrderLineId: l.id, description: l.description, itemId: l.itemId, quantity: qty, unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate), taxAmount: Number(t.toFixed(2)), lineTotal: Number(lineTotal.toFixed(2)) });
      lineUpdates.push({ id: l.id, invoicedQty: already + qty });
    }
    if (!invoiceLines.length) throw new BadRequestException('Nothing left to invoice');
    const invoice = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.create({
        data: { companyId, branchId, customerId: order.customerId, invoiceNo, currency: order.currency || 'USD', exchangeRate: Number(order.exchangeRate || 1), invoiceDate: new Date(),
          dueDate: order.expectedDate ? new Date(order.expectedDate) : order.dueDate ? new Date(order.dueDate) : undefined,
          terms: undefined, billingAddress: order.billingAddress, customerReference: order.customerReference, salesperson: order.salesperson, projectId: order.projectId,
          sourceQuoteId: order.quotationId || undefined, sourceSalesOrderId: order.id,
          subtotal: Number(sub.toFixed(2)), taxTotal: Number(tax.toFixed(2)), total: Number((sub - disc + tax).toFixed(2)),
          fiscalRequired: true, fiscalStatus: 'READY', status: 'DRAFT', invoiceStatus: 'DRAFT', lines: { create: invoiceLines },
        },
        include: { lines: true },
      });
      for (const u of lineUpdates) await tx.salesOrderLine.update({ where: { id: u.id }, data: { invoicedQty: u.invoicedQty } });
      await tx.salesOrder.update({ where: { id: order.id }, data: { invoicedAmount: Number((Number(order.invoicedAmount || 0) + sub - disc).toFixed(2)) } });
      await tx.documentTrailEvent.create({ data: { companyId, documentType: 'SALES_ORDER', documentId: order.id, eventType: 'INVOICE_CREATED', title: 'Invoice Created', description: `Invoice ${invoiceNo} created from this order.`, metadata: { invoiceId: inv.id, invoiceNo }, userId: req.user.sub } });
      return inv;
    });
    await this.trail.create(companyId, { documentType: 'INVOICE', documentId: invoice.id, eventType: 'CREATED', title: 'Invoice Created', description: `Created from Sales Order ${order.orderNo}${order.quotation ? `. Source Quote: ${order.quotation.quotationNo}.` : ''}`, userId: req.user.sub }).catch(() => {});
    await this.audit.log(companyId, req.user.sub, 'CONVERT', 'SalesOrder', order.id, { invoiceNo });
    return invoice;
  }
  @Post('sales-orders/:id/duplicate') async duplicateOrder(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const order = await this.prisma.salesOrder.findFirst({ where: { id, companyId }, include: { lines: true, quotation: true } });
    if (!order) throw new BadRequestException('Sales order not found');
    const orderNo = await this.numbering.next(companyId, 'SO');
    const newOrder = await this.prisma.salesOrder.create({ data: { companyId, branchId: order.branchId, customerId: order.customerId, projectId: order.projectId, orderNo,
      orderDate: new Date(), expectedDate: order.expectedDate, warehouseId: order.warehouseId, salesperson: order.salesperson, customerReference: order.customerReference,
      billingAddress: order.billingAddress, shippingAddress: order.shippingAddress, customerMessage: order.customerMessage, internalMemo: order.internalMemo, terms: order.terms,
      currency: order.currency, exchangeRate: order.exchangeRate, discount: order.discount, subtotal: order.subtotal, taxTotal: order.taxTotal, total: order.total, notes: order.notes, status: 'DRAFT',
      lines: { create: order.lines.map((l) => ({ description: l.description, itemId: l.itemId, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) },
    }, include: { lines: true } });
    await this.trail.create(companyId, { documentType: 'SALES_ORDER', documentId: newOrder.id, eventType: 'ORDER_CREATED', title: 'Order Created', description: `Sales order ${orderNo} created (duplicate of ${order.orderNo}).`, userId: req.user.sub }).catch(() => {});
    return newOrder;
  }
  // ----- Related transactions -----
  @Get('sales-orders/:id/related') async orderRelated(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const order = await this.prisma.salesOrder.findFirst({ where: { id, companyId }, include: { quotation: true, invoices: { where: { invoiceStatus: { not: 'VOID' } }, select: { id: true, invoiceNo: true, status: true, invoiceStatus: true, total: true } }, deliveryNotes: { select: { id: true, deliveryNo: true, status: true } } } });
    if (!order) throw new BadRequestException('Sales order not found');
    return { sourceQuote: order.quotation, invoices: order.invoices, deliveries: order.deliveryNotes };
  }

  // ----- Invoices -----
  @Get('invoices') invoices(@Req() req: any) {
    return this.prisma.salesInvoice.findMany({ where: { companyId: companyIdOf(req.user) }, include: { customer: true, branch: true, lines: true, fiscalReceipt: true, receipts: true, sourceQuote: true, sourceSalesOrder: { include: { deliveryNotes: { select: { id: true, deliveryNo: true, status: true } } } }, creditNotes: { select: { id: true, creditNoteNo: true, status: true, total: true } } }, orderBy: { createdAt: 'desc' } });
  }
  @Post('invoices') @RequirePermissions('sales.invoices.create') async create(@Req() req: any, @Body() dto: CreateInvoiceDto) {
    const companyId = companyIdOf(req.user);
    const branchId = dto.branchId || (await this.prisma.branch.findFirst({ where: { companyId } }))?.id;
    if (!branchId) throw new BadRequestException('Create a branch first');
    await this.integrity.assertCustomer(companyId, dto.customerId);
    await this.integrity.assertProducts(companyId, dto.lines);
    await this.integrity.assertCurrency(companyId, dto.currency || 'USD');
    await this.integrity.applyPricing(companyId, { customerId: dto.customerId, currency: dto.currency || 'USD', lines: dto.lines as any[] });
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    const invoiceNo = dto.invoiceNo || await this.numbering.next(companyId, 'INV');
    const invoice = await this.prisma.salesInvoice.create({
      data: { companyId, branchId, customerId: dto.customerId, projectId: dto.projectId, invoiceNo, currency: dto.currency || 'USD', invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined, terms: dto.terms, billingAddress: dto.billingAddress, notes: dto.notes, statementMemo: dto.statementMemo, email: dto.email, customerReference: dto.customerReference, poReference: dto.poReference, salesperson: dto.salesperson, dueDate: dto.dueDate ? new Date(dto.dueDate) : this.dueDateFromTerms(dto.terms, dto.invoiceDate), subtotal, taxTotal, total, status: 'DRAFT', invoiceStatus: 'DRAFT', fiscalRequired: dto.fiscalRequired ?? true, fiscalStatus: (dto.fiscalRequired ?? true) ? 'READY' : 'NOT_REQUIRED', lines: { create: mapped.map((l) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal, hsCode: l.hsCode })) } },
      include: { lines: true },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'SalesInvoice', invoice.id, { invoiceNo });
    await this.trail.create(companyId, { documentType: 'INVOICE', documentId: invoice.id, eventType: 'CREATED', title: 'Invoice Created', description: `Invoice ${invoiceNo} created.`, userId: req.user.sub }).catch(() => {});
    return invoice;
  }
  @Patch('invoices/:id/status') @RequirePermissions('sales.invoices.update', 'sales.invoices.post') async setInvoiceStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    const companyId = companyIdOf(req.user);
    const before = await this.prisma.salesInvoice.findFirst({ where: { id, companyId } });
    if (!before) throw new BadRequestException('Invoice not found');
    if (this.integrity.isInvoiceFinanciallyLocked(before)) throw new ConflictException(POSTED_INVOICE_EDIT_MESSAGE);
    const res = await this.prisma.salesInvoice.updateMany({ where: { id, companyId }, data: { status: dto.status as any } });
    await this.trail.statusChange(companyId, 'INVOICE', before, before.status, dto.status, req.user.sub).catch(() => {});
    return res;
  }
  @Post('invoices/:id/post') @RequirePermissions('sales.invoices.post') async post(@Req() req: any, @Param('id') id: string) {
    return this.finalizeInvoice(req, id, 'POST');
  }

  /**
   * Business finalize: POST (accounting only) or SEND (post then email).
   * Idempotent posting — already-posted invoices do not create a second journal.
   * Email failure after a successful post does NOT roll back accounting.
   */
  @Post('invoices/:id/finalize') @RequirePermissions('sales.invoices.post')
  async finalize(@Req() req: any, @Param('id') id: string, @Body() body: { action?: 'POST' | 'SEND'; to?: string[]; subject?: string; message?: string }) {
    const action = (body?.action || 'POST').toUpperCase() as 'POST' | 'SEND';
    return this.finalizeInvoice(req, id, action, body);
  }

  private async finalizeInvoice(req: any, id: string, action: 'POST' | 'SEND', body?: { to?: string[]; subject?: string; message?: string }) {
    const companyId = companyIdOf(req.user);
    const mode = await getTransactionPostingMode(this.prisma, companyId);
    if (mode === 'APPROVAL_BASED') {
      // Still allow privileged post/send when approval mode is on — approvals gate is enforced by UI/permissions for submitters.
    }
    const before = await this.prisma.salesInvoice.findFirst({ where: { id, companyId }, include: { customer: true } });
    if (!before) throw new BadRequestException('Invoice not found');
    const wasDraft = String(before.invoiceStatus || before.status || '').toUpperCase() === 'DRAFT';

    // Xero/QB: block (or allow via settings) BEFORE AR posts — never leave a posted invoice with failed stock.
    if (wasDraft) await this.assertDirectInvoiceStock(companyId, id);

    const res = await this.posting.postSalesInvoice(companyId, id, req.user.sub);
    if (wasDraft) {
      try {
        await this.issueDirectInvoiceStock(companyId, id, req.user.sub);
      } catch (e) {
        await this.revertInvoicePostAfterStockFailure(companyId, id, req.user.sub, e);
        throw e;
      }
      await this.trail.create(companyId, { documentType: 'INVOICE', documentId: id, eventType: 'POSTED', title: 'Invoice Posted', description: 'Invoice posted to Accounts Receivable (automatic business action).', userId: req.user.sub }).catch(() => {});
      await this.audit.log(companyId, req.user.sub, 'POSTED_AUTOMATICALLY', 'SalesInvoice', id, { module: 'sales', result: 'SUCCESS', metadata: { action } });
    }

    let emailed = false;
    let emailError: string | null = null;
    if (action === 'SEND') {
      try {
        const to = (body?.to?.length ? body.to : [before.email || before.customer?.email].filter(Boolean)) as string[];
        if (!to.length) throw new BadRequestException('No recipient email on the invoice or customer. Add an email and use Resend.');
        await this.email.send(companyId, req.user.sub, {
          documentType: 'INVOICE',
          documentId: id,
          to,
          subject: body?.subject || `Invoice ${before.invoiceNo}`,
          message: body?.message,
        });
        emailed = true;
        await this.audit.log(companyId, req.user.sub, 'SENT', 'SalesInvoice', id, { module: 'sales', result: 'SUCCESS' });
      } catch (e: any) {
        emailError = e?.message || 'Email could not be sent';
        await this.audit.log(companyId, req.user.sub, 'SEND_FAILED', 'SalesInvoice', id, { module: 'sales', result: 'FAILURE', metadata: { error: emailError } });
      }
    }

    const invoice = await this.prisma.salesInvoice.findUnique({ where: { id }, include: { lines: true, customer: true } });
    return { invoice: invoice || res, posted: true, emailed, emailError, displayStatus: this.userFacingInvoiceStatus(invoice || res) };
  }

  private userFacingInvoiceStatus(inv: any) {
    const life = String(inv?.invoiceStatus || inv?.status || '').toUpperCase();
    if (life === 'DRAFT') return 'DRAFT';
    if (life === 'VOID') return 'VOID';
    const pay = String(inv?.paymentStatus || 'UNPAID').toUpperCase();
    if (pay === 'PAID') return 'PAID';
    if (pay === 'PARTIALLY_PAID') return 'PARTIALLY_PAID';
    if (pay === 'OVERDUE') return 'OVERDUE';
    return 'AWAITING_PAYMENT';
  }

  @Post('invoices/:id/void') @RequirePermissions('sales.invoices.void', 'sales.invoices.credit') async voidInvoice(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const inv = await this.prisma.salesInvoice.findFirst({ where: { id, companyId }, include: { receipts: true } });
    if (!inv) throw new BadRequestException('Invoice not found');
    if (String(inv.invoiceStatus || inv.status).toUpperCase() === 'VOID') return inv;
    if (String(inv.invoiceStatus || inv.status).toUpperCase() === 'DRAFT') throw new BadRequestException('Delete a draft invoice instead of voiding it');
    if (Number(inv.amountPaid || 0) > 0.005) throw new BadRequestException('Cannot void an invoice with payments. Reverse receipts first or raise a credit note.');
    await this.prisma.$transaction(async (tx) => {
      await this.posting.postJournal(companyId, {
        date: new Date(),
        description: `Void invoice ${inv.invoiceNo}`,
        reference: `${inv.invoiceNo}-VOID`,
        sourceType: 'SALES_INVOICE_VOID',
        sourceId: inv.id,
        lines: [
          { code: '4000', debit: Number(inv.subtotal), credit: 0, description: 'Sales reversal' },
          ...(Number(inv.taxTotal) > 0 ? [{ code: '2100', debit: Number(inv.taxTotal), credit: 0, description: 'VAT reversal' }] : []),
          { code: '1100', debit: 0, credit: Number(inv.total), description: 'AR reversal' },
        ],
        userId: req.user.sub,
      }, tx);
      await tx.salesInvoice.update({ where: { id }, data: { status: 'VOID', invoiceStatus: 'VOID' } });
    });
    await this.audit.log(companyId, req.user.sub, 'INVOICE_VOIDED', 'SalesInvoice', id, { module: 'sales', result: 'SUCCESS', metadata: { invoiceNo: inv.invoiceNo, reason: body?.reason } });
    await this.trail.create(companyId, { documentType: 'INVOICE', documentId: id, eventType: 'VOIDED', title: 'Invoice Voided', description: `Invoice ${inv.invoiceNo} voided.`, userId: req.user.sub }).catch(() => {});
    return this.prisma.salesInvoice.findUnique({ where: { id }, include: { lines: true } });
  }
  @Delete('invoices/:id') @RequirePermissions('sales.invoices.update', 'sales.invoices.create') async deleteInvoice(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const inv = await this.prisma.salesInvoice.findFirst({ where: { id, companyId } });
    if (!inv) throw new BadRequestException('Invoice not found');
    if (this.integrity.isInvoiceFinanciallyLocked(inv)) throw new ConflictException(POSTED_INVOICE_EDIT_MESSAGE);
    await this.prisma.$transaction(async (tx) => {
      // delete related features first (fiscal receipts, payments/receipts, lines), unlink credit/debit notes
      await tx.fiscalReceipt.deleteMany({ where: { invoiceId: id } });
      await tx.receipt.deleteMany({ where: { invoiceId: id } });
      await tx.creditNote.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      await tx.debitNote.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.documentTrailEvent.deleteMany({ where: { documentType: 'INVOICE', documentId: id } });
      await tx.salesInvoice.delete({ where: { id } });
    });
    await this.audit.log(companyId, req.user.sub, 'DELETE', 'SalesInvoice', id, { invoiceNo: inv.invoiceNo });
    return { ok: true };
  }
  @Patch('invoices/:id') @RequirePermissions('sales.invoices.update', 'sales.invoices.create') async updateInvoice(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.salesInvoice.findFirst({ where: { id, companyId } });
    if (!existing) throw new BadRequestException('Invoice not found');
    const mode = this.integrity.assertInvoiceEditable(existing, dto, req.user.sub, companyId);
    if (mode === 'META') {
      await this.prisma.salesInvoice.update({ where: { id }, data: { notes: dto.notes ?? existing.notes, statementMemo: dto.statementMemo ?? existing.statementMemo, customerReference: dto.customerReference ?? existing.customerReference, poReference: dto.poReference ?? existing.poReference } });
      await this.audit.log(companyId, req.user.sub, 'INVOICE_META_UPDATED', 'SalesInvoice', id, { module: 'sales', metadata: { invoiceNo: existing.invoiceNo } });
      return this.prisma.salesInvoice.findUnique({ where: { id }, include: { lines: true } });
    }
    if (!dto.lines?.length) throw new BadRequestException('Lines are required');
    await this.integrity.assertCustomer(companyId, dto.customerId);
    await this.integrity.assertProducts(companyId, dto.lines);
    await this.integrity.assertCurrency(companyId, dto.currency || existing.currency);
    await this.integrity.applyPricing(companyId, { customerId: dto.customerId, currency: dto.currency || existing.currency, lines: dto.lines as any[] });
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    await this.prisma.$transaction([
      this.prisma.salesInvoiceLine.deleteMany({ where: { invoiceId: id } }),
      this.prisma.salesInvoice.update({ where: { id }, data: { customerId: dto.customerId, currency: dto.currency || existing.currency, invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : existing.invoiceDate, terms: dto.terms ?? existing.terms, billingAddress: dto.billingAddress ?? existing.billingAddress, notes: dto.notes ?? existing.notes, statementMemo: dto.statementMemo ?? existing.statementMemo, email: dto.email ?? existing.email, customerReference: dto.customerReference ?? existing.customerReference, poReference: dto.poReference ?? existing.poReference, salesperson: dto.salesperson ?? existing.salesperson, dueDate: dto.dueDate ? new Date(dto.dueDate) : existing.dueDate, subtotal, taxTotal, total } }),
    ]);
    await this.prisma.salesInvoiceLine.createMany({ data: mapped.map((l) => ({ invoiceId: id, description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal, hsCode: l.hsCode })) });
    await this.trail.create(companyId, { documentType: 'INVOICE', documentId: id, eventType: 'UPDATED', title: 'Invoice Updated', description: `Invoice ${existing.invoiceNo} updated.`, userId: req.user.sub }).catch(() => {});
    return this.prisma.salesInvoice.findUnique({ where: { id }, include: { lines: true } });
  }

  // ----- Receipts -----
  @Get('receipts') async receipts(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const list = await this.prisma.receipt.findMany({ where: { companyId }, include: { customer: true, allocations: { include: { invoice: true } }, invoice: { include: { customer: true } } }, orderBy: { receiptDate: 'desc' } });
    return list.map((r) => ({ ...r, applied: Number(r.applied || 0), unapplied: Number(r.unapplied || 0), invoiceIds: r.allocations.map((a) => a.invoiceId) }));
  }
  @Get('receipts/:id') async getReceipt(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const r = await this.prisma.receipt.findFirst({ where: { id, companyId }, include: { customer: true, allocations: { include: { invoice: true } }, invoice: { include: { customer: true } } } });
    if (!r) throw new BadRequestException('Receipt not found');
    return r;
  }
  @Post('receipts') @RequirePermissions('sales.receipts.create', 'sales.receipts.manage', 'sales.payments.create') async createReceipt(@Req() req: any, @Body() dto: any, @Headers('idempotency-key') idempotencyHeader?: string) {
    const companyId = companyIdOf(req.user);
    const idempotencyKey = String(dto.idempotencyKey || idempotencyHeader || '').trim() || undefined;
    if (idempotencyKey) {
      const existing = await this.prisma.receipt.findFirst({ where: { companyId, idempotencyKey } });
      if (existing) return this.prisma.receipt.findUnique({ where: { id: existing.id }, include: { allocations: { include: { invoice: true } }, customer: true } });
    }
    if (!dto?.customerId) throw new BadRequestException('Customer is required');
    await this.ensureCustomerActive(companyId, String(dto.customerId));
    const amount = Number(dto.amount || 0);
    if (!(amount > 0)) throw new BadRequestException('Receipt amount must be greater than zero');
    const allocations = (dto.allocations || []).filter((a: any) => Number(a.amount) > 0.001);
    const applied = allocations.reduce((s: number, a: any) => s + Number(a.amount), 0);
    if (applied > amount + 0.001) throw new BadRequestException('Applied amount exceeds receipt amount');
    const unapplied = Math.max(0, amount - applied);
    // Concurrency/over-allocation safeguard: re-read authoritative balances and reject
    // applying more than an invoice's outstanding balance.
    const allocByInv = new Map<string, number>();
    for (const a of allocations) {
      const inv: any = await this.prisma.salesInvoice.findFirst({ where: { id: a.invoiceId, companyId } });
      if (!inv) throw new BadRequestException('Invoice not found');
      const bal = Number(inv.balanceDue ?? (Number(inv.total || 0) - Number(inv.amountPaid || 0) - Number(inv.creditsApplied || 0)));
      const existing = allocByInv.get(a.invoiceId) || 0;
      if (existing + Number(a.amount) > bal + 0.005) throw new BadRequestException(`Applied amount exceeds outstanding balance for invoice ${inv.invoiceNo}. Current balance due: ${bal.toFixed(2)}`);
      allocByInv.set(a.invoiceId, existing + Number(a.amount));
    }
    const receiptNo = await this.numbering.next(companyId, 'RCP');
    const depAccount = dto.depositAccountId ? await this.prisma.ledgerAccount.findFirst({ where: { id: dto.depositAccountId, companyId } }) : null;
    const receipt = await this.prisma.$transaction(async (tx) => {
      const r = await tx.receipt.create({ data: { companyId, customerId: String(dto.customerId), receiptNo, receiptDate: dto.receiptDate ? new Date(dto.receiptDate) : new Date(), amount, applied, unapplied, method: dto.method || 'CASH', referenceNo: dto.referenceNo, depositAccountId: dto.depositAccountId || undefined, note: dto.note, status: 'POSTED', idempotencyKey } });
      const allocs = allocations.length ? allocations : (dto.invoiceId ? [{ invoiceId: dto.invoiceId, amount }] : []);
      if (allocs.length) await tx.paymentAllocation.createMany({ data: allocs.map((a: any) => ({ receiptId: r.id, invoiceId: a.invoiceId, amountApplied: Number(a.amount) })) });
      await this.posting.postJournal(companyId, { date: r.receiptDate, description: `Receipt ${receiptNo}`, reference: receiptNo, sourceType: 'RECEIPT', sourceId: r.id, lines: [
        { code: depAccount?.code || '1000', debit: amount, credit: 0, description: 'Cash / bank' },
        { code: '1100', debit: 0, credit: amount, description: 'Accounts receivable' },
      ] }, tx);
      return r;
    });
    await this.audit.log(companyId, req.user.sub, 'PAYMENT_RECORDED', 'Receipt', receipt.id, { module: 'sales', result: 'SUCCESS', metadata: { receiptNo, amount, invoiceIds: [...allocByInv.keys()] } });
    const dedup = new Set<string>();
    for (const a of (allocations.length ? allocations : (dto.invoiceId ? [{ invoiceId: dto.invoiceId, amount }] : []))) {
      if (dedup.has(a.invoiceId)) continue;
      dedup.add(a.invoiceId);
      try {
        const inv: any = await this.prisma.salesInvoice.findUnique({ where: { id: a.invoiceId } });
        await this.invoiceStatus.recalc(companyId, a.invoiceId);
        const bal = Number(inv?.total || 0) - Number(inv?.amountPaid || 0) - Number(inv?.creditsApplied || 0);
        const status = bal <= 0.005 ? 'PAID' : 'PARTIALLY_PAID';
        await this.trail.create(companyId, { documentType: 'INVOICE', documentId: a.invoiceId, eventType: status === 'PAID' ? 'PAID' : 'PAYMENT_RECEIVED', title: status === 'PAID' ? 'Invoice Paid' : 'Payment Received', description: `${status === 'PAID' ? 'Final payment' : 'Payment'} of ${Number(a.amount).toFixed(2)} applied. Remaining balance: ${Math.max(0, bal).toFixed(2)}.`, metadata: { receiptNo, amount: Number(a.amount) }, userId: req.user.sub }).catch(() => {});
      } catch {}
    }
    return this.prisma.receipt.findUnique({ where: { id: receipt.id }, include: { allocations: { include: { invoice: true } }, customer: true } });
  }
  @Post('receipts/:id/reverse') async reverseReceipt(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const r = await this.prisma.receipt.findFirst({ where: { id, companyId }, include: { allocations: true } });
    if (!r) throw new BadRequestException('Receipt not found');
    if (r.status === 'REVERSED') throw new BadRequestException('Receipt already reversed');
    // Reverse GL
    await this.posting.postJournal(companyId, { date: new Date(), description: `Reversal of receipt ${r.receiptNo}`, reference: `${r.receiptNo}-REV`, sourceType: 'RECEIPT_REVERSAL', sourceId: r.id, lines: [
      { code: '1000', debit: 0, credit: Number(r.amount), description: 'Cash / bank' },
      { code: '1100', debit: Number(r.amount), credit: 0, description: 'Accounts receivable' },
    ] });
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAllocation.deleteMany({ where: { receiptId: r.id } });
      await tx.receipt.update({ where: { id: r.id }, data: { status: 'REVERSED', applied: 0, unapplied: 0 } });
      await tx.documentTrailEvent.create({ data: { companyId, documentType: 'RECEIPT', documentId: r.id, eventType: 'RECEIPT_REVERSED', title: 'Receipt Reversed', description: `Receipt ${r.receiptNo} reversed.`, userId: req.user.sub } });
    });
    for (const a of r.allocations) {
      try { await this.invoiceStatus.recalc(companyId, a.invoiceId); } catch {}
    }
    await this.audit.log(companyId, req.user.sub, 'REVERSE', 'Receipt', r.id, { receiptNo: r.receiptNo });
    return { ok: true };
  }
  @Delete('receipts/:id') async deleteReceipt(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const r = await this.prisma.receipt.findFirst({ where: { id, companyId } });
    if (!r) throw new BadRequestException('Receipt not found');
    if (r.status !== 'REVERSED') throw new BadRequestException('Posted receipts cannot be deleted — reverse them instead');
    await this.prisma.$transaction([
      this.prisma.paymentAllocation.deleteMany({ where: { receiptId: id } }),
      this.prisma.documentTrailEvent.deleteMany({ where: { documentType: 'RECEIPT', documentId: id } }),
      this.prisma.receipt.deleteMany({ where: { id, companyId } }),
    ]);
    return { ok: true };
  }

  // ----- Credit notes -----
  @Get('credit-notes') creditNotes(@Req() req: any) {
    return this.prisma.creditNote.findMany({ where: { companyId: companyIdOf(req.user) }, include: { customer: true, invoice: true, lines: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('credit-notes') @RequirePermissions('sales.invoices.credit', 'sales.credit_notes.create') async createCreditNote(@Req() req: any, @Body() dto: CreateCreditNoteDto) {
    const companyId = companyIdOf(req.user);
    await this.ensureCustomerActive(companyId, dto.customerId);
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    const creditNoteNo = await this.numbering.next(companyId, 'CN');
    const cn = await this.prisma.creditNote.create({ data: { companyId, customerId: dto.customerId, invoiceId: dto.invoiceId, creditNoteNo, creditNoteDate: dto.creditNoteDate ? new Date(dto.creditNoteDate) : new Date(), reason: dto.reason, subtotal, taxTotal, total, lines: { create: mapped.map((l) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) } }, include: { lines: true } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'CreditNote', cn.id, { creditNoteNo });
    return cn;
  }
  @Post('credit-notes/:id/post') postCreditNote(@Req() req: any, @Param('id') id: string) {
    return this.posting.postCreditNote(companyIdOf(req.user), id);
  }
  @Delete('credit-notes/:id') async deleteCreditNote(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const cn = await this.prisma.creditNote.findFirst({ where: { id, companyId } });
    if (!cn) throw new BadRequestException('Credit note not found');
    if (cn.status !== 'DRAFT') throw new BadRequestException('Only draft credit notes can be deleted');
    await this.prisma.$transaction([
      this.prisma.creditNoteLine.deleteMany({ where: { creditNoteId: id } }),
      this.prisma.documentTrailEvent.deleteMany({ where: { documentType: 'CREDIT_NOTE', documentId: id } }),
      this.prisma.creditNote.deleteMany({ where: { id, companyId } }),
    ]);
    return { ok: true };
  }

  // ----- Debit notes -----
  @Get('debit-notes') debitNotes(@Req() req: any) {
    return this.prisma.debitNote.findMany({ where: { companyId: companyIdOf(req.user) }, include: { customer: true, invoice: true, lines: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('debit-notes') async createDebitNote(@Req() req: any, @Body() dto: any) {
    const companyId = companyIdOf(req.user);
    await this.ensureCustomerActive(companyId, dto.customerId);
    const { mapped, subtotal, taxTotal, total } = this.computeLines(dto.lines);
    const debitNoteNo = await this.numbering.next(companyId, 'DN');
    const dn = await this.prisma.debitNote.create({ data: { companyId, customerId: dto.customerId, invoiceId: dto.invoiceId, debitNoteNo, date: dto.date ? new Date(dto.date) : new Date(), reason: dto.reason, subtotal, taxTotal, total, lines: { create: mapped.map((l: any) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) } }, include: { lines: true } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'DebitNote', dn.id, { debitNoteNo });
    return dn;
  }
  @Post('debit-notes/:id/post') postDebitNote(@Req() req: any, @Param('id') id: string) {
    return this.posting.postDebitNote(companyIdOf(req.user), id);
  }
  @Delete('debit-notes/:id') async deleteDebitNote(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const dn = await this.prisma.debitNote.findFirst({ where: { id, companyId } });
    if (!dn) throw new BadRequestException('Debit note not found');
    if (dn.status !== 'DRAFT') throw new BadRequestException('Only draft debit notes can be deleted');
    await this.prisma.$transaction([
      this.prisma.debitNoteLine.deleteMany({ where: { debitNoteId: id } }),
      this.prisma.documentTrailEvent.deleteMany({ where: { documentType: 'DEBIT_NOTE', documentId: id } }),
      this.prisma.debitNote.deleteMany({ where: { id, companyId } }),
    ]);
    return { ok: true };
  }
  @Get('credit-notes/:id') async getCreditNote(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const cn = await this.prisma.creditNote.findFirst({ where: { id, companyId }, include: { customer: true, invoice: true, lines: true } });
    if (!cn) throw new BadRequestException('Credit note not found');
    return cn;
  }
  @Post('credit-notes/:id/apply') async applyCreditNote(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const cn = await this.prisma.creditNote.findFirst({ where: { id, companyId } });
    if (!cn) throw new BadRequestException('Credit note not found');
    if (cn.status !== 'POSTED') throw new BadRequestException('Only posted credit notes can be applied');
    if (cn.applicationStatus === 'APPLIED') throw new BadRequestException('Credit note already applied');
    if (!body?.invoiceId) throw new BadRequestException('Select an invoice');
    const inv = await this.prisma.salesInvoice.findFirst({ where: { id: body.invoiceId, companyId } });
    if (!inv) throw new BadRequestException('Invoice not found');
    if (inv.customerId !== cn.customerId) throw new BadRequestException('Invoice belongs to a different customer');
    await this.prisma.$transaction(async (tx) => {
      await tx.creditNote.update({ where: { id }, data: { invoiceId: inv.id, applicationStatus: 'APPLIED', appliedAmount: Number(cn.total) } });
      await tx.documentTrailEvent.create({ data: { companyId, documentType: 'CREDIT_NOTE', documentId: id, eventType: 'CREDIT_APPLIED', title: 'Credit Applied', description: `Credit note ${cn.creditNoteNo} applied to invoice ${inv.invoiceNo}.`, userId: req.user.sub } });
    });
    try { await this.invoiceStatus.recalc(companyId, inv.id); } catch {}
    await this.audit.log(companyId, req.user.sub, 'APPLY', 'CreditNote', id, { invoiceNo: inv.invoiceNo });
    return { ok: true };
  }
  @Post('credit-notes/:id/void') async voidCreditNote(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const cn = await this.prisma.creditNote.findFirst({ where: { id, companyId } });
    if (!cn) throw new BadRequestException('Credit note not found');
    if (cn.status !== 'POSTED') throw new BadRequestException('Cannot void a draft credit note');
    await this.posting.postJournal(companyId, { date: new Date(), description: `Void credit note ${cn.creditNoteNo}`, reference: `${cn.creditNoteNo}-VOID`, sourceType: 'CREDIT_NOTE_VOID', sourceId: cn.id, lines: [
      { code: '1100', debit: Number(cn.total), credit: 0, description: 'Accounts receivable reversal' },
      { code: '4000', debit: 0, credit: Number(cn.subtotal), description: 'Sales returns reversal' },
      ...(Number(cn.taxTotal) > 0 ? [{ code: '2100', debit: 0, credit: Number(cn.taxTotal), description: 'VAT reversal' }] : []),
    ] });
    await this.prisma.$transaction(async (tx) => {
      await tx.creditNote.update({ where: { id }, data: { status: 'VOID', applicationStatus: 'UNAPPLIED', appliedAmount: 0 } });
      await tx.documentTrailEvent.create({ data: { companyId, documentType: 'CREDIT_NOTE', documentId: id, eventType: 'CREDIT_NOTE_VOIDED', title: 'Credit Note Voided', description: `Credit note ${cn.creditNoteNo} voided.`, userId: req.user.sub } });
    });
    if (cn.invoiceId) { try { await this.invoiceStatus.recalc(companyId, cn.invoiceId); } catch {} }
    await this.audit.log(companyId, req.user.sub, 'VOID', 'CreditNote', id, { reason: body?.reason });
    return { ok: true };
  }

  // ----- Customer goods returns (physical RETURN_IN → optional Credit Note) -----
  @Get('customer-returns') customerReturns(@Req() req: any) {
    return this.prisma.customerReturn.findMany({
      where: { companyId: companyIdOf(req.user) },
      include: { customer: true, invoice: true, warehouse: true, creditNote: true, lines: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('customer-returns') @RequirePermissions('sales.invoices.credit', 'sales.credit_notes.create')
  async createCustomerReturn(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    if (!body?.customerId) throw new BadRequestException('Customer is required');
    if (!body?.warehouseId) throw new BadRequestException('Warehouse is required for goods returns');
    const lines = Array.isArray(body.lines) ? body.lines.filter((l: any) => Number(l.quantity) > 0) : [];
    if (!lines.length) throw new BadRequestException('Add at least one return line with quantity');
    if (lines.some((l: any) => !l.itemId)) throw new BadRequestException('Every goods-return line needs an inventory item');
    if (body.invoiceId) {
      const inv = await this.prisma.salesInvoice.findFirst({ where: { id: body.invoiceId, companyId } });
      if (!inv) throw new BadRequestException('Invoice not found');
      if (inv.customerId && inv.customerId !== body.customerId) throw new BadRequestException('Invoice belongs to a different customer');
    }
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId } });
    if (!warehouse) throw new BadRequestException('Warehouse not found');
    const returnNo = await this.numbering.next(companyId, 'CRTN');
    const row = await this.prisma.customerReturn.create({
      data: {
        companyId,
        returnNo,
        customerId: body.customerId,
        invoiceId: body.invoiceId || null,
        warehouseId: body.warehouseId,
        reason: body.reason || 'Returned Goods',
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
      include: { lines: true, customer: true, invoice: true },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'CustomerReturn', row.id, { returnNo });
    if (body.confirm) return this.confirmCustomerReturn(req, row.id, { issueCredit: body.issueCredit !== false, postCredit: !!body.postCredit });
    return row;
  }

  @Post('customer-returns/:id/confirm') @RequirePermissions('sales.invoices.credit', 'sales.credit_notes.create')
  async confirmCustomerReturn(@Req() req: any, @Param('id') id: string, @Body() body: any = {}) {
    const companyId = companyIdOf(req.user);
    const ret = await this.prisma.customerReturn.findFirst({ where: { id, companyId }, include: { lines: true, creditNote: true } });
    if (!ret) throw new BadRequestException('Customer return not found');
    if (ret.status === 'CONFIRMED') {
      return this.prisma.customerReturn.findFirst({ where: { id }, include: { lines: true, creditNote: true, customer: true, invoice: true, warehouse: true } });
    }
    if (ret.status === 'CANCELLED') throw new BadRequestException('Return is cancelled');
    if (!ret.warehouseId) throw new BadRequestException('Warehouse is required');
    const cogs = await this.ensureCogsAccount(companyId);
    const itemIds = ret.lines.map((l) => l.itemId).filter(Boolean) as string[];
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, id: { in: itemIds } }, include: { movements: true } });
    const avgCost = (itemId?: string | null) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return 0;
      const receipts = item.movements.filter((m) => ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'].includes(m.type));
      const qty = receipts.reduce((s, m) => s + Number(m.quantity), 0);
      if (qty > 0) return receipts.reduce((s, m) => s + Number(m.unitCost) * Number(m.quantity), 0) / qty;
      return Number(item.purchaseCost || 0);
    };

    let creditNoteId = ret.creditNoteId;
    await this.prisma.$transaction(async (tx) => {
      let cogsTotal = 0;
      for (const line of ret.lines) {
        if (!line.itemId) continue;
        const item = items.find((i) => i.id === line.itemId);
        if (!item || !isStockTracked(item.type)) continue;
        const cost = Number(line.unitCost) > 0 ? Number(line.unitCost) : avgCost(line.itemId);
        cogsTotal += cost * Number(line.quantity);
        await this.stock.create(companyId, {
          warehouseId: ret.warehouseId!,
          itemId: line.itemId,
          type: 'RETURN_IN',
          quantity: Number(line.quantity),
          unitCost: cost,
          reference: ret.returnNo,
          occurredAt: ret.returnedAt,
        }, req.user.sub, tx);
      }
      if (cogsTotal > 0.005) {
        await this.posting.postJournal(companyId, {
          date: ret.returnedAt,
          description: `Return COGS reversal ${ret.returnNo}`,
          reference: ret.returnNo,
          sourceType: 'CUSTOMER_RETURN_COGS',
          sourceId: ret.id,
          lines: [
            { code: '1200', debit: Number(cogsTotal.toFixed(2)), credit: 0, description: 'Inventory returned' },
            { code: cogs.code, debit: 0, credit: Number(cogsTotal.toFixed(2)), description: 'COGS reversal' },
          ],
          userId: req.user.sub,
        }, tx);
      }
      await tx.customerReturn.update({ where: { id: ret.id }, data: { status: 'CONFIRMED' } });
    });

    if (body?.issueCredit !== false && !creditNoteId) {
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
      const creditNoteNo = await this.numbering.next(companyId, 'CN');
      const cn = await this.prisma.creditNote.create({
        data: {
          companyId,
          customerId: ret.customerId,
          invoiceId: ret.invoiceId,
          creditNoteNo,
          creditNoteDate: ret.returnedAt,
          reason: ret.reason || 'Returned Goods',
          subtotal: Number(subtotal.toFixed(2)),
          taxTotal: Number(taxTotal.toFixed(2)),
          total: Number((subtotal + taxTotal).toFixed(2)),
          lines: { create: mapped },
        },
      });
      creditNoteId = cn.id;
      await this.prisma.customerReturn.update({ where: { id: ret.id }, data: { creditNoteId: cn.id } });
      await this.audit.log(companyId, req.user.sub, 'CREATE', 'CreditNote', cn.id, { creditNoteNo, via: 'customerReturn', returnNo: ret.returnNo });
      if (body?.postCredit) await this.posting.postCreditNote(companyId, cn.id, req.user.sub);
    }

    await this.audit.log(companyId, req.user.sub, 'CONFIRM', 'CustomerReturn', ret.id, { returnNo: ret.returnNo, creditNoteId });
    return this.prisma.customerReturn.findFirst({ where: { id: ret.id }, include: { lines: true, creditNote: true, customer: true, invoice: true, warehouse: true } });
  }

  @Get('debit-notes/:id') async getDebitNote(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const dn = await this.prisma.debitNote.findFirst({ where: { id, companyId }, include: { customer: true, invoice: true, lines: true } });
    if (!dn) throw new BadRequestException('Debit note not found');
    return dn;
  }
  @Post('debit-notes/:id/void') async voidDebitNote(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const dn = await this.prisma.debitNote.findFirst({ where: { id, companyId } });
    if (!dn) throw new BadRequestException('Debit note not found');
    if (dn.status !== 'POSTED') throw new BadRequestException('Cannot void a draft debit note');
    await this.posting.postJournal(companyId, { date: new Date(), description: `Void debit note ${dn.debitNoteNo}`, reference: `${dn.debitNoteNo}-VOID`, sourceType: 'DEBIT_NOTE_VOID', sourceId: dn.id, lines: [
      { code: '1100', debit: 0, credit: Number(dn.total), description: 'Accounts receivable reversal' },
      { code: '4000', debit: Number(dn.subtotal), credit: 0, description: 'Revenue reversal' },
      ...(Number(dn.taxTotal) > 0 ? [{ code: '2100', debit: Number(dn.taxTotal), credit: 0, description: 'VAT reversal' }] : []),
    ] });
    await this.prisma.$transaction(async (tx) => {
      await tx.debitNote.update({ where: { id }, data: { status: 'VOID' } });
      await tx.documentTrailEvent.create({ data: { companyId, documentType: 'DEBIT_NOTE', documentId: id, eventType: 'DEBIT_NOTE_VOIDED', title: 'Debit Note Voided', description: `Debit note ${dn.debitNoteNo} voided.`, userId: req.user.sub } });
    });
    await this.audit.log(companyId, req.user.sub, 'VOID', 'DebitNote', id, { reason: body?.reason });
    return { ok: true };
  }
  @Post('debit-notes/:id/pay') async payDebitNote(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const dn = await this.prisma.debitNote.findFirst({ where: { id, companyId } });
    if (!dn) throw new BadRequestException('Debit note not found');
    if (dn.status !== 'POSTED') throw new BadRequestException('Only posted debit notes can be paid');
    const pay = Number(body?.amount || 0);
    const remaining = Number(dn.balanceDue ?? dn.total);
    if (pay <= 0 || pay > remaining + 0.005) throw new BadRequestException('Invalid payment amount');
    const newPaid = Number(dn.amountPaid || 0) + pay;
    const newBal = Math.max(0, remaining - pay);
    const status = newBal <= 0.005 ? 'PAID' : newPaid > 0.005 ? 'PARTIALLY_PAID' : 'UNPAID';
    await this.prisma.$transaction(async (tx) => {
      await tx.debitNote.update({ where: { id }, data: { amountPaid: newPaid, balanceDue: newBal, paymentStatus: status } });
      await tx.documentTrailEvent.create({ data: { companyId, documentType: 'DEBIT_NOTE', documentId: id, eventType: status === 'PAID' ? 'PAID' : 'PAYMENT_RECEIVED', title: status === 'PAID' ? 'Debit Note Paid' : 'Payment Received', description: `Payment of ${pay.toFixed(2)} applied to debit note ${dn.debitNoteNo}. Remaining: ${newBal.toFixed(2)}.`, userId: req.user.sub } });
    });
    await this.audit.log(companyId, req.user.sub, 'PAY', 'DebitNote', id, { amount: pay });
    return { ok: true };
  }

  // ----- Customer payments -----
  @Get('customers/:customerId/payments') customerPayments(@Req() req: any, @Param('customerId') customerId: string) { return this.payments.list(customerId); }
  @Get('customers/:customerId/payments/summary') customerPaymentsSummary(@Req() req: any, @Param('customerId') customerId: string) { return this.payments.summary(customerId); }
  @Post('customers/:customerId/payments') createCustomerPayment(@Req() req: any, @Param('customerId') customerId: string, @Body() body: any) { return this.payments.create(customerId, body, req.user.sub); }
  @Get('payments/:paymentId') paymentDetail(@Req() req: any, @Param('paymentId') paymentId: string) { return this.payments.get(paymentId); }
  @Post('payments/:paymentId/apply') applyCredit(@Req() req: any, @Param('paymentId') paymentId: string, @Body() body: any) { return this.payments.applyCredit(paymentId, body, req.user.sub); }
  @Post('payments/:paymentId/reverse') reversePayment(@Req() req: any, @Param('paymentId') paymentId: string) { return this.payments.reverse(paymentId, req.user.sub); }


  // ----- Reports -----
  @Get('statements/:customerId') async statement(@Req() req: any, @Param('customerId') customerId: string) {
    const companyId = companyIdOf(req.user);
    const [customer, invoices, receipts, creditNotes] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: customerId, companyId } }),
      this.prisma.salesInvoice.findMany({ where: { companyId, customerId, status: { not: 'VOID' } }, orderBy: { invoiceDate: 'asc' } }),
      this.prisma.receipt.findMany({ where: { companyId, invoice: { customerId } }, orderBy: { receiptDate: 'asc' } }),
      this.prisma.creditNote.findMany({ where: { companyId, customerId, status: 'POSTED' }, orderBy: { creditNoteDate: 'asc' } }),
    ]);
    const txns: any[] = [];
    for (const inv of invoices) txns.push({ date: inv.invoiceDate, ref: inv.invoiceNo, type: 'INVOICE', amount: Number(inv.total) });
    for (const r of receipts) txns.push({ date: r.receiptDate, ref: r.receiptNo, type: 'RECEIPT', amount: -Number(r.amount) });
    for (const cn of creditNotes) txns.push({ date: cn.creditNoteDate, ref: cn.creditNoteNo, type: 'CREDIT_NOTE', amount: -Number(cn.total) });
    txns.sort((a, b) => a.date - b.date);
    let running = 0;
    for (const t of txns) { running += t.amount; t.balance = Number(running.toFixed(2)); }
    return { customer, transactions: txns, balance: Number(running.toFixed(2)) };
  }

  @Get('debtor-age') async debtorAge(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const invoices = await this.prisma.salesInvoice.findMany({ where: { companyId, status: { in: ['POSTED', 'PART_PAID', 'PAID'] } }, include: { customer: true, receipts: true, creditNotes: { where: { status: 'POSTED' } } } });
    const outstanding = (i: any) => { const paid = i.receipts.reduce((s: number, r: any) => s + Number(r.amount), 0); const credited = i.creditNotes.reduce((s: number, c: any) => s + Number(c.total), 0); return Math.max(0, Number(i.total) - paid - credited); };
    const buckets = (days: number) => {
      const d30 = invoices.filter((i) => { const age = Math.floor((Date.now() - i.invoiceDate.getTime()) / 86400000); return age >= days && age < days + 30; });
      return d30.reduce((s, i) => s + outstanding(i), 0);
    };
    const byCustomer: Record<string, any> = {};
    for (const i of invoices) {
      const key = i.customerId || 'none';
      if (!byCustomer[key]) byCustomer[key] = { customer: i.customer, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
      const age = Math.floor((Date.now() - i.invoiceDate.getTime()) / 86400000);
      const o = outstanding(i);
      if (age <= 30) byCustomer[key].current += o; else if (age <= 60) byCustomer[key].d30 += o; else if (age <= 90) byCustomer[key].d60 += o; else byCustomer[key].d90plus += o;
      byCustomer[key].total += o;
    }
    return { summary: { current: buckets(0), d30: buckets(30), d60: buckets(60), d90plus: invoices.reduce((s, i) => { const age = Math.floor((Date.now() - i.invoiceDate.getTime()) / 86400000); return s + (age >= 90 ? outstanding(i) : 0); }, 0) }, byCustomer: Object.values(byCustomer) };
  }

  // Authoritative Accounts Receivable Aging & Collections report (due-date based,
  // 5 buckets, invoice drill-down, GL control reconciliation).
  @Get('ar-aging') async arAging(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const round = (n: any) => Number(Number(n).toFixed(2));
    const asOf = q.asOf ? new Date(String(q.asOf).concat('T23:59:59')) : new Date();
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { companyId, invoiceStatus: 'POSTED', invoiceDate: { lte: asOf } },
      include: { customer: true, receipts: true, creditNotes: { where: { status: 'POSTED' } } },
      orderBy: { invoiceDate: 'desc' },
    });
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
    const byCust: Record<string, any> = {};
    for (const inv of invoices) {
      const receipts = inv.receipts.filter((r) => r.status !== 'REVERSED' && new Date(r.receiptDate) <= asOf).reduce((s, r) => s + Number(r.amount), 0);
      const credits = inv.creditNotes.filter((c) => new Date(c.creditNoteDate) <= asOf).reduce((s, c) => s + Number(c.total), 0);
      const outstanding = Math.max(0, Number(inv.total || 0) - receipts - credits);
      if (outstanding <= 0.005) continue;
      let due = inv.dueDate ? new Date(inv.dueDate) : null;
      let missingDue = false;
      if (!due) { const td = termsDays(inv.terms); if (td) due = new Date(inv.invoiceDate.getTime() + td * 86400000); else missingDue = true; }
      const b = bucketOf(due);
      const key = inv.customerId || 'unknown';
      if (!byCust[key]) {
        const c = inv.customer;
        byCust[key] = {
          customerId: inv.customerId || 'unknown', customerCode: c?.code || '', customerName: c?.name || (inv.customerId ? 'Unknown Customer' : 'Archived Customer'),
          email: c?.email || null, phone: c?.phone || null, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0, missingDue: false, invoices: [],
        };
      }
      const row = byCust[key];
      row[b.key] += outstanding;
      row.total += outstanding;
      if (missingDue) row.missingDue = true;
      row.invoices.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNo, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate || null, effectiveDue: due, daysOverdue: b.daysOverdue, missingDue, originalAmount: round(Number(inv.total || 0)), appliedAmount: round(Number(inv.total || 0) - outstanding), remainingAmount: round(outstanding), bucket: b.key, paymentStatus: inv.paymentStatus });
    }
    const customers = Object.values(byCust).sort((a: any, b: any) => b.total - a.total);
    let totalReceivables = 0, overdueAmount = 0, over90 = 0, customersWithBalance = 0, current = 0, d1_30 = 0, d31_60 = 0, d61_90 = 0;
    for (const c of customers) { totalReceivables += c.total; overdueAmount += c.d1_30 + c.d31_60 + c.d61_90 + c.d90plus; over90 += c.d90plus; if (c.total > 0) customersWithBalance++; current += c.current; d1_30 += c.d1_30; d31_60 += c.d31_60; d61_90 += c.d61_90; }
    const arAcct = await this.prisma.ledgerAccount.findFirst({ where: { companyId, name: { contains: 'Accounts Receivable' } } });
    let control: number | null = null;
    if (arAcct) { const agg = await this.prisma.journalLine.aggregate({ where: { accountId: arAcct.id, journal: { companyId, status: 'POSTED', date: { lte: asOf } } }, _sum: { debit: true, credit: true } }); control = round(Number(agg._sum.debit || 0) - Number(agg._sum.credit || 0)); }
    return {
      asOf: q.asOf || null,
      summary: { totalReceivables: round(totalReceivables), overdueAmount: round(overdueAmount), customersWithBalance, over90: round(over90), current: round(current), d1_30: round(d1_30), d31_60: round(d31_60), d61_90: round(d61_90) },
      customers,
      reconciliation: { subledger: round(totalReceivables), control, difference: control == null ? null : round(totalReceivables - control) },
      totalCustomers: customers.length,
    };
  }

  @Get('sales-report') async salesReport(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const invoices = await this.prisma.salesInvoice.findMany({ where: { companyId, status: { in: ['POSTED', 'PART_PAID', 'PAID'] } } });
    const byMonth: Record<string, { month: string; sales: number; tax: number }> = {};
    for (const i of invoices) {
      const key = `${i.invoiceDate.getFullYear()}-${String(i.invoiceDate.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = { month: key, sales: 0, tax: 0 };
      byMonth[key].sales += Number(i.total); byMonth[key].tax += Number(i.taxTotal);
    }
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }

  // Advanced Sales Report: single canonical filter set drives KPIs, every tab's
  // parent groups AND the drill-down children — so totals and tree rows always
  // reconcile. Uses the authoritative stored balances (amountPaid / balanceDue)
  // so Outstanding is never negative.
  @Get('reports/sales-report') async advancedSalesReport(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId, status: { not: 'VOID' } };
    if (q.documentStatus) where.invoiceStatus = q.documentStatus; // default to POSTED scope
    else if (q.includeDrafts !== 'true') where.invoiceStatus = 'POSTED';
    else where.invoiceStatus = { in: ['DRAFT', 'POSTED'] };
    if (q.paymentStatus) where.paymentStatus = q.paymentStatus;
    if (q.fiscalStatus) where.fiscalStatus = q.fiscalStatus;
    if (q.customerId) where.customerId = q.customerId;
    const dateQ: any = {};
    if (q.startDate) dateQ.gte = new Date(String(q.startDate));
    if (q.endDate) dateQ.lte = new Date(String(q.endDate).concat('T23:59:59'));
    if (Object.keys(dateQ).length) where.invoiceDate = dateQ;
    const invoices = await this.prisma.salesInvoice.findMany({ where, include: { customer: true, lines: true, receipts: { where: { status: { not: 'REVERSED' } } }, creditNotes: { where: { status: 'POSTED' } } }, orderBy: { invoiceDate: 'desc' } });

    const round = (n: number) => Number(n.toFixed(2));
    const kpis = { totalSales: 0, collected: 0, outstanding: 0, count: invoices.length };
    invoices.forEach((i: any) => { kpis.totalSales += Number(i.total); kpis.collected += Number(i.amountPaid || 0); kpis.outstanding += Number(i.balanceDue || 0); });
    kpis.totalSales = round(kpis.totalSales); kpis.collected = round(kpis.collected); kpis.outstanding = round(kpis.outstanding);

    const invDetail = invoices.map((i: any) => ({ ...i, collected: Number(i.amountPaid || 0), balance: Number(i.balanceDue || 0) }));

    // By customer — invoice-level aggregation, children = filtered invoices.
    const cm: Record<string, any> = {};
    invoices.forEach((i: any) => { const cid = i.customerId || 'none'; if (!cm[cid]) cm[cid] = { customerId: cid, name: i.customer?.name || 'Unknown', invoices: 0, totalSales: 0, collected: 0, outstanding: 0, children: [] }; const c = cm[cid]; c.invoices++; c.totalSales += Number(i.total); c.collected += Number(i.amountPaid || 0); c.outstanding += Number(i.balanceDue || 0); c.children.push({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, dueDate: i.dueDate, total: Number(i.total), collected: Number(i.amountPaid || 0), balance: Number(i.balanceDue || 0), paymentStatus: i.paymentStatus }); });
    const byCustomer = Object.values(cm).map((c: any) => ({ customerId: c.customerId, name: c.name, invoices: c.invoices, totalSales: round(c.totalSales), collected: round(c.collected), outstanding: round(c.outstanding), children: c.children.sort((a: any, b: any) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime()) })).sort((a: any, b: any) => (b.totalSales as number) - (a.totalSales as number));

    // By product — LINE amounts (never invoice totals), children = line->invoice rows.
    const pm: Record<string, any> = {};
    invoices.forEach((i: any) => (i.lines || []).forEach((l: any) => {
      const key = l.itemId ? `item::${l.itemId}` : (l.description ? `manual::${l.description}` : 'unlinked');
      if (!pm[key]) pm[key] = { productId: l.itemId || null, product: l.itemId ? (i.lines.find((x: any) => x.id === l.id)?.description || l.description) : (l.description || 'Unlinked / Manual Lines'), qty: 0, invoices: new Set<string>(), net: 0, tax: 0, gross: 0, children: [] };
      const p = pm[key];
      p.invoices.add(i.id); p.qty += Number(l.quantity || 0); p.net += Number(l.quantity) * Number(l.unitPrice); p.tax += Number(l.taxAmount || 0); p.gross += Number(l.lineTotal || 0);
      p.children.push({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, customer: i.customer?.name || '', description: l.description, qty: Number(l.quantity), rate: Number(l.unitPrice), discount: Number((l as any).discount || 0), tax: Number(l.taxAmount || 0), lineTotal: Number(l.lineTotal || 0) });
    }));
    const byProduct = Object.values(pm).map((p: any) => ({ productId: p.productId, product: p.product, qty: p.qty, invoices: p.invoices.size, net: round(p.net), tax: round(p.tax), gross: round(p.gross), children: p.children.sort((a: any, b: any) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime()) })).sort((a: any, b: any) => (b.gross as number) - (a.gross as number));

    // By income account — lines carry no account relation, so aggregate into the
    // revenue bucket (first REVENUE COA account) so it reconciles to invoice totals.
    const revAcc = await this.prisma.ledgerAccount.findFirst({ where: { companyId, type: 'REVENUE' }, orderBy: { code: 'asc' } });
    const acc: any = { code: revAcc?.code || 'UNMAPPED', name: revAcc?.name || 'Unmapped Income', invoices: new Set<string>(), net: 0, tax: 0, gross: 0, children: [] };
    invoices.forEach((i: any) => (i.lines || []).forEach((l: any) => { acc.invoices.add(i.id); acc.net += Number(l.quantity) * Number(l.unitPrice); acc.tax += Number(l.taxAmount || 0); acc.gross += Number(l.lineTotal || 0); acc.children.push({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, customer: i.customer?.name || '', description: l.description, net: Number(l.quantity) * Number(l.unitPrice), tax: Number(l.taxAmount || 0), gross: Number(l.lineTotal || 0) }); }));
    let byIncomeAccount: any[] = [];
    if (acc.invoices.size) byIncomeAccount = [{ code: acc.code, name: acc.name, invoices: 0, net: round(acc.net), tax: round(acc.tax), gross: round(acc.gross), children: acc.children.sort((a: any, b: any) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime()) }];
    byIncomeAccount[0] && (byIncomeAccount[0].invoices = acc.invoices.size);

    return { kpis, invoices: invDetail, byCustomer, byProduct, byIncomeAccount };
  }


  @Get('register') async register(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const { page = 1, pageSize = 25, search = '', type = '', dateFrom = '', dateTo = '' } = q;
    const [quotations, salesOrders, invoices, receipts, creditNotes] = await Promise.all([
      this.prisma.quotation.findMany({ where: { companyId }, include: { customer: true } }),
      this.prisma.salesOrder.findMany({ where: { companyId }, include: { customer: true } }),
      this.prisma.salesInvoice.findMany({ where: { companyId }, include: { customer: true } }),
      this.prisma.receipt.findMany({ where: { companyId }, include: { invoice: { include: { customer: true } } } }),
      this.prisma.creditNote.findMany({ where: { companyId }, include: { customer: true } }),
    ]);

    const rows: any[] = [];
    quotations.forEach((x: any) => rows.push({ date: x.quotationDate, type: 'Quote', number: x.quotationNo, customer: x.customer?.name || '', memo: x.notes || '', amount: Number(x.total), status: x.status, sourceType: 'quotation', sourceId: x.id }));
    salesOrders.forEach((x: any) => rows.push({ date: x.orderDate, type: 'Order', number: x.orderNo, customer: x.customer?.name || '', memo: x.notes || '', amount: Number(x.total), status: x.status, sourceType: 'sales-order', sourceId: x.id }));
    invoices.forEach((x: any) => rows.push({ date: x.invoiceDate, type: 'Invoice', number: x.invoiceNo, customer: x.customer?.name || '', memo: '', amount: x.status === 'VOID' ? 0 : Number(x.total), status: x.status, sourceType: 'invoice', sourceId: x.id }));
    receipts.forEach((x: any) => rows.push({ date: x.receiptDate, type: 'Payment', number: x.receiptNo, customer: x.invoice?.customer?.name || '', memo: x.note || '', amount: Number(x.amount), status: 'Posted', sourceType: 'receipt', sourceId: x.id }));
    creditNotes.forEach((x: any) => rows.push({ date: x.creditNoteDate, type: 'Credit Note', number: x.creditNoteNo, customer: x.customer?.name || '', memo: x.reason || '', amount: -Number(x.total), status: x.status, sourceType: 'credit-note', sourceId: x.id }));

    let list = rows;
    if (type && type.trim()) list = list.filter((r) => r.type === type.trim());
    if (dateFrom) { const f = new Date(dateFrom); list = list.filter((r) => r.date >= f); }
    if (dateTo) { const t = new Date(dateTo); list = list.filter((r) => r.date <= t); }
    const s = (search || '').trim().toLowerCase();
    if (s) list = list.filter((r) => [r.number, r.customer, r.memo, r.type, r.status].some((v) => String(v || '').toLowerCase().includes(s)));
    list.sort((a, b) => (new Date(b.date) as any) - (new Date(a.date) as any));

    const sum = (t: string) => Number(list.filter((r) => r.type === t).reduce((acc, r) => acc + r.amount, 0).toFixed(2));
    const summary = {
      quotesAmount: sum('Quote'),
      ordersAmount: sum('Order'),
      invoicesAmount: sum('Invoice'),
      paymentsAmount: sum('Payment'),
      creditNotesAmount: sum('Credit Note'),
      count: list.length,
    };

    const total = list.length;
    const pageN = Math.max(1, Number(page) || 1);
    const limit = Math.min(500, Math.max(1, Number(pageSize) || 25));
    const data = list.slice((pageN - 1) * limit, pageN * limit);
    return { data, total, summary };
  }

  // ----- Delivery / fulfilment + COGS -----
  private async ensureCogsAccount(companyId: string) {
    return this.prisma.ledgerAccount.findFirst({ where: { companyId, code: '5000' } })
      .then(async (existing) => existing || this.prisma.ledgerAccount.findFirst({ where: { companyId, code: '6100' } }))
      .then(async (existing) => existing || this.prisma.ledgerAccount.create({ data: { companyId, code: '5000', name: 'Cost of Sales', type: 'EXPENSE' } }));
  }

  private async allowInvoiceOversell(companyId: string): Promise<boolean> {
    if (await this.stock.allowNegativeStock(companyId)) return true;
    const cfg = await this.prisma.systemConfig.findFirst({ where: { companyId, key: 'cfg.sales.allowOversell' } });
    const v = (cfg?.value as any)?.value ?? cfg?.value;
    return v === true || v === 'true';
  }

  private fmtStockQty(n: number) {
    const x = Number(n || 0);
    return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, '');
  }

  /**
   * Resolve warehouse + stock-tracked lines for a direct invoice (no prior delivery dispatch).
   * Returns null when stock issue does not apply.
   */
  private async directInvoiceStockPlan(companyId: string, invoiceId: string) {
    const inv = await this.prisma.salesInvoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { lines: true, deliveryNotes: true, sourceSalesOrder: { include: { deliveryNotes: true } } },
    });
    if (!inv || inv.stockIssuedAt) return null;
    const fromDelivery = (inv.deliveryNotes || []).some((d) => ['DISPATCHED', 'DELIVERED'].includes(d.status))
      || (inv.sourceSalesOrder?.deliveryNotes || []).some((d) => ['DISPATCHED', 'DELIVERED'].includes(d.status));
    if (fromDelivery) return null;
    const warehouse = await this.prisma.warehouse.findFirst({ where: { companyId } });
    if (!warehouse) return null;
    const itemIds = inv.lines.map((l) => l.itemId).filter(Boolean) as string[];
    if (!itemIds.length) return null;
    const items = await this.prisma.inventoryItem.findMany({ where: { id: { in: itemIds }, companyId } });
    const needed = new Map<string, { item: any; qty: number }>();
    for (const line of inv.lines) {
      if (!line.itemId) continue;
      const item = items.find((i) => i.id === line.itemId);
      if (!item || !isStockTracked(item.type)) continue;
      const prev = needed.get(line.itemId);
      const qty = Number(line.quantity || 0) + (prev?.qty || 0);
      needed.set(line.itemId, { item, qty });
    }
    if (!needed.size) return null;
    return { inv, warehouse, needed };
  }

  /** Fail before AR post when inventory would go negative (unless oversell/negative stock is enabled). */
  private async assertDirectInvoiceStock(companyId: string, invoiceId: string) {
    if (await this.allowInvoiceOversell(companyId)) return;
    const plan = await this.directInvoiceStockPlan(companyId, invoiceId);
    if (!plan) return;
    const shortages: { name: string; onHand: number; needed: number }[] = [];
    for (const { item, qty } of plan.needed.values()) {
      const bal = await this.stock.balance(companyId, item.id, plan.warehouse.id);
      if (bal.onHand - qty < -0.0001) {
        shortages.push({ name: String(item.name || item.sku || 'Item'), onHand: bal.onHand, needed: qty });
      }
    }
    if (!shortages.length) return;
    // Xero/QB-style copy: plain language, product names, what to do next — no settings jargon.
    if (shortages.length === 1) {
      const s = shortages[0];
      throw new BadRequestException(
        `Not enough stock — You only have ${this.fmtStockQty(s.onHand)} of “${s.name}” available, but this invoice needs ${this.fmtStockQty(s.needed)}. Add stock or reduce the quantity, then try again.`,
      );
    }
    const preview = shortages.slice(0, 3).map((s) => `“${s.name}” (need ${this.fmtStockQty(s.needed)}, have ${this.fmtStockQty(s.onHand)})`).join('; ');
    const more = shortages.length > 3 ? ` and ${shortages.length - 3} more` : '';
    throw new BadRequestException(
      `Not enough stock — ${shortages.length} items don’t have enough quantity: ${preview}${more}. Add stock or change the lines, then try again.`,
    );
  }

  /** If stock issue fails after AR posted, roll invoice back to DRAFT and remove the AR journal so books stay consistent. */
  private async revertInvoicePostAfterStockFailure(companyId: string, invoiceId: string, userId: string, cause: any) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const inv = await tx.salesInvoice.findFirst({ where: { id: invoiceId, companyId } });
        if (!inv || String(inv.invoiceStatus || inv.status || '').toUpperCase() !== 'POSTED') return;
        const je = await tx.journalEntry.findFirst({ where: { companyId, sourceType: 'SALES_INVOICE', sourceId: invoiceId } });
        if (je) {
          await tx.journalLine.deleteMany({ where: { journalId: je.id } });
          await tx.journalEntry.delete({ where: { id: je.id } });
        }
        await tx.salesInvoice.update({
          where: { id: invoiceId },
          data: { status: 'DRAFT', invoiceStatus: 'DRAFT', stockIssuedAt: null, paymentStatus: 'UNPAID' },
        });
      });
      await this.invoiceStatus.recalc(companyId, invoiceId).catch(() => {});
      await this.audit.log(companyId, userId, 'INVOICE_POST_REVERTED', 'SalesInvoice', invoiceId, {
        module: 'sales',
        result: 'FAILURE',
        metadata: { reason: 'stock_issue_failed', error: cause?.message || String(cause) },
      });
    } catch (revertErr: any) {
      await this.audit.log(companyId, userId, 'INVOICE_POST_REVERT_FAILED', 'SalesInvoice', invoiceId, {
        module: 'sales',
        result: 'FAILURE',
        metadata: { stockError: cause?.message, revertError: revertErr?.message },
      }).catch(() => {});
    }
  }

  /** Direct invoices (no prior dispatched delivery) issue stock exactly once on post. */
  private async issueDirectInvoiceStock(companyId: string, invoiceId: string, userId: string) {
    const plan = await this.directInvoiceStockPlan(companyId, invoiceId);
    if (!plan) return;
    const { inv, warehouse, needed } = plan;
    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.salesInvoice.findFirst({ where: { id: invoiceId, stockIssuedAt: null } });
      if (!fresh) return;
      for (const line of inv.lines) {
        if (!line.itemId) continue;
        const row = needed.get(line.itemId);
        if (!row) continue;
        await this.stock.create(companyId, {
          warehouseId: warehouse.id,
          itemId: line.itemId,
          type: 'ISSUE',
          quantity: Number(line.quantity),
          unitCost: Number(row.item.purchaseCost || 0),
          reference: inv.invoiceNo,
          occurredAt: inv.invoiceDate,
        }, userId, tx);
      }
      await tx.salesInvoice.update({ where: { id: invoiceId }, data: { stockIssuedAt: new Date() } });
    });
  }

  private async deliveryTrail(companyId: string, id: string, eventType: string, title: string, description: string, userId: string, metadata?: any) {
    return this.trail.create(companyId, { documentType: 'DELIVERY', documentId: id, eventType, title, description, userId, metadata }).catch(() => {});
  }
  private async deliveryTo(id: string, companyId: string, to: string, userId: string) {
    const dn = await this.prisma.deliveryNote.findFirst({ where: { id, companyId } });
    if (!dn) throw new BadRequestException('Delivery not found');
    const allowedMap: Record<string, string[]> = { PICKED: ['DRAFT'], READY_TO_DISPATCH: ['DRAFT', 'PICKED'], DELIVERED: ['DISPATCHED', 'READY_TO_DISPATCH'] };
    const fromAllowed = allowedMap[to];
    if (fromAllowed && !fromAllowed.includes(dn.status)) throw new BadRequestException(`Cannot transition ${dn.status} → ${to}`);
    await this.prisma.deliveryNote.update({ where: { id }, data: { status: to } });
    const titles: Record<string, string> = { PICKED: 'Delivery Picked', READY_TO_DISPATCH: 'Ready to Dispatch', DELIVERED: 'Delivery Delivered' };
    await this.deliveryTrail(companyId, id, `DELIVERY_${to}`, titles[to] || to.replace(/_/g, ' '), `Delivery ${dn.deliveryNo} ${to.replace(/_/g, ' ').toLowerCase()}.`, userId);
    return this.prisma.deliveryNote.findUnique({ where: { id }, include: { lines: true, salesOrder: { include: { quotation: true } }, invoice: true, customer: true } });
  }

  @Get('deliveries') async deliveries(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const list = await this.prisma.deliveryNote.findMany({ where: { companyId }, include: { customer: true, salesOrder: { include: { quotation: true } }, invoice: true, lines: true }, orderBy: { createdAt: 'desc' } });
    return list.map((d) => ({ ...d, orderNo: d.salesOrder?.orderNo || null, quoteNo: d.salesOrder?.quotation?.quotationNo || null, invoiceNo: d.invoice?.invoiceNo || null, totalQty: d.lines.reduce((s, l) => s + Number(l.quantity), 0) }));
  }
  @Get('deliveries/:id') async getDelivery(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const d = await this.prisma.deliveryNote.findFirst({ where: { id, companyId }, include: { customer: true, salesOrder: { include: { lines: true, quotation: true } }, invoice: true, lines: true } });
    if (!d) throw new BadRequestException('Delivery not found');
    return d;
  }
  @Post('deliveries') @RequirePermissions('sales.deliveries.create', 'sales.delivery.manage') async createDelivery(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const order = await this.prisma.salesOrder.findFirst({ where: { id: body.salesOrderId, companyId }, include: { lines: true, customer: true, quotation: { include: { lines: true } } } });
    if (!order) throw new BadRequestException('Sales order not found');
    if (!['OPEN', 'CONFIRMED'].includes(order.status)) throw new BadRequestException('Only open/confirmed orders can be delivered');
    await this.integrity.assertWarehouse(companyId, body.warehouseId);
    const warehouseId = body.warehouseId || (await this.prisma.warehouse.findFirst({ where: { companyId } }))?.id;
    if (!warehouseId) throw new BadRequestException('Create a warehouse first');
    const requested = body.lines || [];
    const deliveryLines: any[] = [];
    for (const l of order.lines) {
      const remaining = Number(l.quantity) - Number(l.deliveredQty || 0);
      if (remaining <= 0.001) continue;
      const reqLine = requested.find((x: any) => x.salesOrderLineId === l.id);
      const qty = Math.min(Number(reqLine?.quantity ?? remaining), remaining);
      if (qty <= 0.001) continue;
      const quoteLine = order.quotation?.lines?.find((ql: any) => ql.itemId && ql.itemId === l.itemId) || null;
      const taxRate = await this.integrity.resolveTaxRate(companyId, { taxRate: Number(l.taxRate), salesOrderLine: l, quoteLine, itemId: l.itemId, customerId: order.customerId });
      const net = qty * Number(l.unitPrice) - Number(l.discount || 0) * (qty / Math.max(Number(l.quantity) || 1, 1));
      const taxAmount = Number((net * (taxRate / 100)).toFixed(2));
      deliveryLines.push({ salesOrderLineId: l.id, itemId: l.itemId, description: l.description, quantity: qty, unitPrice: Number(l.unitPrice), unit: l.unit, discount: Number(l.discount || 0), taxRate, taxAmount });
    }
    if (!deliveryLines.length) throw new BadRequestException('Nothing left to deliver');
    const deliveryNo = await this.numbering.next(companyId, 'DEL');
    const delivery = await this.prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.create({ data: {
        companyId, deliveryNo, salesOrderId: order.id, customerId: order.customerId, warehouseId,
        date: body.date ? new Date(body.date) : new Date(), status: body.status || 'DRAFT',
        shippingAddress: body.shippingAddress, contactPerson: body.contactPerson, phone: body.phone, driver: body.driver, vehicle: body.vehicle, trackingNo: body.trackingNo, carrier: body.carrier, reference: body.reference, notes: body.notes, projectId: body.projectId || order.projectId || undefined, branchId: body.branchId || undefined,
        lines: { create: deliveryLines },
      }, include: { lines: true } });
      await tx.documentTrailEvent.create({ data: { companyId, documentType: 'DELIVERY', documentId: dn.id, eventType: 'DELIVERY_CREATED', title: 'Delivery Created', description: `Delivery ${deliveryNo} created for sales order ${order.orderNo}.`, userId: req.user.sub } });
      return dn;
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'DeliveryNote', delivery.id, { deliveryNo });
    return delivery;
  }
  @Patch('deliveries/:id') async updateDelivery(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const dn = await this.prisma.deliveryNote.findFirst({ where: { id, companyId } });
    if (!dn) throw new BadRequestException('Delivery not found');
    if (!['DRAFT', 'PICKED'].includes(dn.status)) throw new BadRequestException('Only draft/picked deliveries can be edited');
    await this.prisma.deliveryNote.update({ where: { id }, data: { shippingAddress: body.shippingAddress ?? dn.shippingAddress, contactPerson: body.contactPerson ?? dn.contactPerson, phone: body.phone ?? dn.phone, driver: body.driver ?? dn.driver, vehicle: body.vehicle ?? dn.vehicle, trackingNo: body.trackingNo ?? dn.trackingNo, carrier: body.carrier ?? dn.carrier, reference: body.reference ?? dn.reference, notes: body.notes ?? dn.notes, warehouseId: body.warehouseId ?? dn.warehouseId, date: body.date ? new Date(body.date) : dn.date } });
    await this.deliveryTrail(companyId, id, 'DELIVERY_UPDATED', 'Delivery Updated', `Delivery ${dn.deliveryNo} updated.`, req.user.sub);
    return this.prisma.deliveryNote.findUnique({ where: { id }, include: { lines: true, salesOrder: true } });
  }
  @Post('deliveries/:id/pick') async pick(@Req() req: any, @Param('id') id: string) { return this.deliveryTo(id, companyIdOf(req.user), 'PICKED', req.user.sub); }
  @Post('deliveries/:id/ready') async ready(@Req() req: any, @Param('id') id: string) { return this.deliveryTo(id, companyIdOf(req.user), 'READY_TO_DISPATCH', req.user.sub); }
  @Post('deliveries/:id/deliver') async markDelivered(@Req() req: any, @Param('id') id: string) { return this.deliveryTo(id, companyIdOf(req.user), 'DELIVERED', req.user.sub); }
  @Post('deliveries/:id/dispatch') @RequirePermissions('sales.deliveries.dispatch', 'sales.delivery.manage') async dispatch(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const dn = await this.prisma.deliveryNote.findFirst({ where: { id, companyId }, include: { lines: true, salesOrder: { include: { lines: true } } } });
    if (!dn) throw new BadRequestException('Delivery note not found');
    if (['DISPATCHED', 'DELIVERED'].includes(dn.status)) return dn;
    if (!['DRAFT', 'PICKED', 'READY_TO_DISPATCH'].includes(dn.status)) return dn;
    if (!dn.warehouseId) throw new BadRequestException('Delivery requires a warehouse');
    const cogs = await this.ensureCogsAccount(companyId);
    const byItem = await this.prisma.inventoryItem.findMany({ where: { companyId, id: { in: dn.lines.filter((l) => l.itemId).map((l) => l.itemId) as string[] } }, include: { movements: true } });
    const avgCostFor = (itemId?: string) => {
      const item = byItem.find((i: any) => i.id === itemId);
      if (!item) return 0;
      const receipts = item.movements.filter((m: any) => ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'].includes(m.type));
      const qty = receipts.reduce((s, m) => s + Number(m.quantity), 0);
      return qty ? receipts.reduce((s, m) => s + Number(m.unitCost) * Number(m.quantity), 0) / qty : 0;
    };
    await this.prisma.$transaction(async (tx) => {
      let cogsTotal = 0;
      for (const line of dn.lines) {
        if (!line.itemId) continue;
        const item = byItem.find((i: any) => i.id === line.itemId);
        if (!item || !isStockTracked(item.type)) continue;
        const unitCost = avgCostFor(line.itemId);
        const cost = unitCost * Number(line.quantity);
        cogsTotal += cost;
        await this.stock.create(companyId, {
          warehouseId: dn.warehouseId!,
          itemId: line.itemId,
          type: 'ISSUE',
          quantity: Number(line.quantity),
          unitCost,
          reference: dn.deliveryNo,
          occurredAt: dn.date,
        }, req.user.sub, tx);
        if (dn.salesOrderId && line.itemId) {
          await this.stock.consumeReservation(companyId, dn.salesOrderId, line.itemId, Number(line.quantity), tx);
        }
        const sol = dn.salesOrder?.lines.find((l: any) => l.id === line.salesOrderLineId || l.itemId === line.itemId);
        if (sol) await tx.salesOrderLine.update({ where: { id: sol.id }, data: { deliveredQty: Number(sol.deliveredQty || 0) + Number(line.quantity) } });
      }
      if (cogsTotal > 0.005) {
        await this.posting.postJournal(companyId, {
          date: dn.date,
          description: `COGS ${dn.deliveryNo}`,
          reference: dn.deliveryNo,
          sourceType: 'COGS',
          sourceId: dn.id,
          lines: [
            { code: cogs.code, debit: Number(cogsTotal.toFixed(2)), credit: 0, description: 'Cost of sales' },
            { code: '1200', debit: 0, credit: Number(cogsTotal.toFixed(2)), description: 'Inventory reduction' },
          ],
          userId: req.user.sub,
        }, tx);
      }
      await tx.deliveryNote.update({ where: { id }, data: { status: 'DISPATCHED' } });
    });
    await this.deliveryTrail(companyId, id, 'DELIVERY_DISPATCHED', 'Delivery Dispatched', `Delivery ${dn.deliveryNo} dispatched — stock issued.`, req.user.sub);
    await this.audit.log(companyId, req.user.sub, 'DISPATCH', 'DeliveryNote', dn.id, { module: 'sales', result: 'SUCCESS', metadata: { deliveryNo: dn.deliveryNo } });
    return this.prisma.deliveryNote.findUnique({ where: { id }, include: { lines: true, salesOrder: { include: { lines: true } } } });
  }
  @Post('deliveries/:id/cancel') async cancelDelivery(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const dn = await this.prisma.deliveryNote.findFirst({ where: { id, companyId } });
    if (!dn) throw new BadRequestException('Delivery not found');
    if (['DISPATCHED', 'DELIVERED'].includes(dn.status)) throw new BadRequestException('Dispatched deliveries cannot be cancelled');
    await this.prisma.deliveryNote.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.deliveryTrail(companyId, id, 'DELIVERY_CANCELLED', 'Delivery Cancelled', `Delivery ${dn.deliveryNo} cancelled.`, req.user.sub);
    await this.audit.log(companyId, req.user.sub, 'CANCEL', 'DeliveryNote', dn.id, { deliveryNo: dn.deliveryNo });
    return { ok: true };
  }
  @Delete('deliveries/:id') async deleteDelivery(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const dn = await this.prisma.deliveryNote.findFirst({ where: { id, companyId } });
    if (!dn) throw new BadRequestException('Delivery not found');
    if (dn.status !== 'DRAFT') throw new BadRequestException('Only draft deliveries can be deleted');
    await this.prisma.$transaction([
      this.prisma.deliveryLine.deleteMany({ where: { deliveryNoteId: id } }),
      this.prisma.documentTrailEvent.deleteMany({ where: { documentType: 'DELIVERY', documentId: id } }),
      this.prisma.deliveryNote.deleteMany({ where: { id, companyId } }),
    ]);
    return { ok: true };
  }
  // Invoice the delivered (undelivered-invoiced) quantities of this delivery.
  @Post('deliveries/:id/invoice') @RequirePermissions('sales.invoices.create') async deliveryToInvoice(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const dn = await this.prisma.deliveryNote.findFirst({ where: { id, companyId }, include: { lines: true, customer: true, salesOrder: { include: { lines: true, quotation: { include: { lines: true } } } } } });
    if (!dn) throw new BadRequestException('Delivery not found');
    if (!['DISPATCHED', 'DELIVERED'].includes(dn.status)) throw new BadRequestException('Delivery must be dispatched before invoicing');
    if (dn.invoiceId) throw new BadRequestException('An invoice already exists for this delivery');
    await this.ensureCustomerActive(companyId, dn.customerId);
    const branchId = (await this.prisma.branch.findFirst({ where: { companyId } }))?.id;
    if (!branchId) throw new BadRequestException('Create a branch first');
    const invoiceNo = await this.numbering.next(companyId, 'INV');
    const requested = body?.lines || [];
    const invoiceLines: any[] = [];
    let sub = 0, disc = 0, tax = 0, qty = 0;
    for (const l of dn.lines) {
      const reqLine = requested.find((x: any) => x.deliveryLineId === l.id);
      const q = Math.min(Number(reqLine?.quantity ?? l.quantity), Number(l.quantity));
      if (q <= 0.001) continue;
      const sol = dn.salesOrder?.lines.find((x: any) => x.id === l.salesOrderLineId);
      const quoteLine = dn.salesOrder?.quotation?.lines?.find((ql: any) => ql.itemId && ql.itemId === l.itemId) || null;
      const taxRate = await this.integrity.resolveTaxRate(companyId, {
        taxRate: l.taxRate != null ? Number(l.taxRate) : undefined,
        salesOrderLine: sol,
        quoteLine,
        itemId: l.itemId,
        customerId: dn.customerId,
      });
      const lineDisc = Number((l as any).discount || sol?.discount || 0) * (q / Math.max(Number(l.quantity) || 1, 1));
      const net = q * Number(l.unitPrice) - lineDisc;
      const t = net * (taxRate / 100);
      sub += q * Number(l.unitPrice); disc += lineDisc; tax += t; qty += q;
      invoiceLines.push({
        salesOrderLineId: l.salesOrderLineId || undefined,
        description: l.description,
        itemId: l.itemId,
        quantity: q,
        unitPrice: Number(l.unitPrice),
        taxRate,
        taxAmount: Number(t.toFixed(2)),
        lineTotal: Number((net + t).toFixed(2)),
      });
    }
    if (!invoiceLines.length) throw new BadRequestException('Nothing to invoice');
    const invoice = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.create({ data: { companyId, branchId, customerId: dn.customerId, invoiceNo, currency: 'USD', exchangeRate: Number(dn.salesOrder?.exchangeRate || 1), invoiceDate: new Date(), dueDate: dn.salesOrder?.expectedDate ? new Date(dn.salesOrder.expectedDate) : undefined, sourceSalesOrderId: dn.salesOrderId, sourceQuoteId: dn.salesOrder?.quotationId || undefined, subtotal: Number(sub.toFixed(2)), taxTotal: Number(tax.toFixed(2)), total: Number((sub - disc + tax).toFixed(2)), fiscalRequired: true, fiscalStatus: 'READY', status: 'DRAFT', invoiceStatus: 'DRAFT', lines: { create: invoiceLines } }, include: { lines: true } });
      await tx.deliveryNote.update({ where: { id }, data: { invoiceId: inv.id } });
      await tx.documentTrailEvent.create({ data: { companyId, documentType: 'DELIVERY', documentId: id, eventType: 'INVOICE_CREATED', title: 'Invoice Created', description: `Invoice ${invoiceNo} created from delivery ${dn.deliveryNo}.`, metadata: { invoiceId: inv.id, invoiceNo }, userId: req.user.sub } });
      return inv;
    });
    await this.trail.create(companyId, { documentType: 'INVOICE', documentId: invoice.id, eventType: 'CREATED', title: 'Invoice Created', description: `Created from Delivery ${dn.deliveryNo}${dn.salesOrder?.quotation ? `. Source Quote: ${dn.salesOrder.quotation.quotationNo}.` : ''}`, userId: req.user.sub }).catch(() => {});
    await this.audit.log(companyId, req.user.sub, 'CONVERT', 'DeliveryNote', dn.id, { invoiceNo });
    return invoice;
  }
}
