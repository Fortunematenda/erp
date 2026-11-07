import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SalesController } from '../sales/sales.controller';
import { ApiKeyContext, ApiKeyService } from './api-key.service';
import { UpsertCustomerDto, UpsertInvoiceDto, UpsertPaymentDto } from './external-api.dto';

type EntityType = 'CUSTOMER' | 'INVOICE' | 'RECEIPT';

const EXTERNAL_ID = /^[A-Za-z0-9._:-]{1,100}$/;
// A claim left without an entity (crashed request) can be retaken after this long.
const STALE_CLAIM_MS = 2 * 60_000;

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const num = (value: unknown) => (value == null ? null : Number(value));

/**
 * Stable, API-key-authenticated façade over the sales module. Records are addressed by the
 * calling system's own IDs (namespaced by the key's `source`), and writes go through the
 * same SalesController logic as the UI so validation, journals and audit stay identical.
 */
@Injectable()
export class ExternalApiService implements OnModuleInit {
  private sales!: SalesController;

  constructor(private prisma: PrismaService, private moduleRef: ModuleRef, private keys: ApiKeyService) {}

  onModuleInit() {
    this.sales = this.moduleRef.get(SalesController, { strict: false });
  }

  // ---------- Customers ----------

  async upsertCustomer(ctx: ApiKeyContext, externalId: string, dto: UpsertCustomerDto) {
    this.assertExternalId(externalId);
    const req = { user: ctx.user };
    const fields = {
      name: dto.name, email: dto.email, phone: dto.phone, mobile: dto.mobile, address1: dto.address1, address2: dto.address2,
      city: dto.city, country: dto.country, tin: dto.tin, vatNumber: dto.vatNumber, notes: dto.notes,
    };

    const existingId = await this.linkedEntity(ctx, 'CUSTOMER', externalId, (id) => this.prisma.customer.count({ where: { id, companyId: ctx.companyId } }));
    if (existingId) {
      await this.sales.updateCustomer(req, existingId, fields as any);
      return { created: false, customer: await this.customerSummary(ctx, externalId, existingId) };
    }

    const { entityId, created } = await this.createOnce(ctx, 'CUSTOMER', externalId, undefined, async () => {
      const customer = await this.sales.createCustomer(req, { ...fields, status: 'ACTIVE' } as any);
      return customer.id;
    });
    if (!created) await this.sales.updateCustomer(req, entityId, fields as any);
    return { created, customer: await this.customerSummary(ctx, externalId, entityId) };
  }

  async getCustomer(ctx: ApiKeyContext, externalId: string) {
    const id = await this.resolve(ctx, 'CUSTOMER', externalId, 'Customer');
    return this.customerSummary(ctx, externalId, id);
  }

  // ---------- Invoices ----------

  async upsertInvoice(ctx: ApiKeyContext, externalId: string, dto: UpsertInvoiceDto) {
    this.assertExternalId(externalId);
    if (dto.post) await this.assertScope(ctx, 'invoices:post');
    const req = { user: ctx.user };
    const customerId = await this.resolve(ctx, 'CUSTOMER', dto.customerExternalId, 'Customer');

    const charge = {
      customerExternalId: dto.customerExternalId,
      currency: dto.currency ?? null,
      invoiceDate: dto.invoiceDate ?? null,
      dueDate: dto.dueDate ?? null,
      reference: dto.reference ?? null,
      notes: dto.notes ?? null,
      fiscalRequired: dto.fiscalRequired ?? null,
      lines: dto.lines.map((l) => [l.description, Number(l.quantity), Number(l.unitPrice), Number(l.taxRate)]),
    };

    const { entityId, created } = await this.createOnce(ctx, 'INVOICE', externalId, digest(charge), async () => {
      const invoice = await this.sales.create(req, {
        customerId,
        currency: dto.currency,
        invoiceDate: dto.invoiceDate,
        dueDate: dto.dueDate,
        customerReference: dto.reference,
        notes: dto.notes,
        fiscalRequired: dto.fiscalRequired,
        lines: dto.lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })),
      } as any);
      return invoice.id;
    });

    if (dto.post) await this.postIfDraft(ctx, entityId);
    return { created, invoice: await this.invoiceSummary(ctx, entityId, externalId) };
  }

  async postInvoice(ctx: ApiKeyContext, externalId: string) {
    const id = await this.resolve(ctx, 'INVOICE', externalId, 'Invoice');
    await this.postIfDraft(ctx, id);
    return this.invoiceSummary(ctx, id, externalId);
  }

  async getInvoice(ctx: ApiKeyContext, externalId: string) {
    const id = await this.resolve(ctx, 'INVOICE', externalId, 'Invoice');
    return this.invoiceSummary(ctx, id, externalId);
  }

  // ---------- Payments ----------

  async upsertPayment(ctx: ApiKeyContext, externalId: string, dto: UpsertPaymentDto) {
    this.assertExternalId(externalId);
    const req = { user: ctx.user };
    const customerId = await this.resolve(ctx, 'CUSTOMER', dto.customerExternalId, 'Customer');
    const allocations: { invoiceId: string; amount: number }[] = [];
    for (const a of dto.allocations ?? []) {
      const invoiceId = await this.resolve(ctx, 'INVOICE', a.invoiceExternalId, 'Invoice');
      const invoice = await this.prisma.salesInvoice.findFirst({ where: { id: invoiceId, companyId: ctx.companyId }, select: { customerId: true } });
      if (invoice?.customerId !== customerId) throw new BadRequestException(`Invoice ${a.invoiceExternalId} belongs to a different customer`);
      allocations.push({ invoiceId, amount: Number(a.amount) });
    }

    const request = {
      customerExternalId: dto.customerExternalId,
      amount: Number(dto.amount),
      method: dto.method ?? null,
      date: dto.date ?? null,
      reference: dto.reference ?? null,
      note: dto.note ?? null,
      allocations: (dto.allocations ?? []).map((a) => [a.invoiceExternalId, Number(a.amount)]),
    };

    const { entityId, created } = await this.createOnce(ctx, 'RECEIPT', externalId, digest(request), async () => {
      const receipt: any = await this.sales.createReceipt(req, {
        customerId,
        amount: Number(dto.amount),
        method: dto.method,
        receiptDate: dto.date,
        referenceNo: dto.reference,
        note: dto.note,
        idempotencyKey: `ext:${ctx.source}:${externalId}`,
        allocations,
      });
      return receipt.id;
    });
    return { created, payment: await this.paymentSummary(ctx, entityId, externalId) };
  }

  async getPayment(ctx: ApiKeyContext, externalId: string) {
    const id = await this.resolve(ctx, 'RECEIPT', externalId, 'Payment');
    return this.paymentSummary(ctx, id, externalId);
  }

  // ---------- Summaries ----------

  private async customerSummary(ctx: ApiKeyContext, externalId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!customer) throw new NotFoundException('Customer not found');
    const open = await this.prisma.salesInvoice.groupBy({
      by: ['currency'],
      where: { companyId: ctx.companyId, customerId: id, invoiceStatus: { notIn: ['DRAFT', 'VOID'] }, balanceDue: { gt: 0 } },
      _sum: { balanceDue: true },
      _count: { _all: true },
    });
    return {
      externalId,
      id: customer.id,
      code: customer.code,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      balances: open.map((g) => ({ currency: g.currency, balanceDue: num(g._sum.balanceDue), openInvoices: g._count._all })),
    };
  }

  private async invoiceSummary(ctx: ApiKeyContext, id: string, externalId: string) {
    const inv = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { lines: true, paymentAllocations: { include: { receipt: true } } },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    const status = String(inv.invoiceStatus || inv.status).toUpperCase();
    const settled = status !== 'DRAFT' && status !== 'VOID';
    const receiptLinks = await this.externalIdsFor(ctx, 'RECEIPT', inv.paymentAllocations.map((a) => a.receiptId));
    return {
      externalId,
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      status,
      paymentStatus: settled ? inv.paymentStatus : null,
      currency: inv.currency,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      reference: inv.customerReference,
      subtotal: num(inv.subtotal),
      taxTotal: num(inv.taxTotal),
      total: num(inv.total),
      amountPaid: settled ? num(inv.amountPaid) : null,
      creditsApplied: settled ? num(inv.creditsApplied) : null,
      balanceDue: settled ? num(inv.balanceDue) : null,
      lines: inv.lines.map((l) => ({ description: l.description, quantity: num(l.quantity), unitPrice: num(l.unitPrice), taxRate: num(l.taxRate), taxAmount: num(l.taxAmount), lineTotal: num(l.lineTotal) })),
      payments: inv.paymentAllocations
        .filter((a) => a.receipt.status === 'POSTED')
        .map((a) => ({ externalId: receiptLinks.get(a.receiptId) ?? null, receiptNo: a.receipt.receiptNo, date: a.receipt.receiptDate, amount: num(a.amountApplied) })),
    };
  }

  private async paymentSummary(ctx: ApiKeyContext, id: string, externalId: string) {
    const receipt = await this.prisma.receipt.findFirst({ where: { id, companyId: ctx.companyId }, include: { allocations: { include: { invoice: true } } } });
    if (!receipt) throw new NotFoundException('Payment not found');
    const invoiceLinks = await this.externalIdsFor(ctx, 'INVOICE', receipt.allocations.map((a) => a.invoiceId));
    return {
      externalId,
      id: receipt.id,
      receiptNo: receipt.receiptNo,
      status: receipt.status,
      date: receipt.receiptDate,
      amount: num(receipt.amount),
      applied: num(receipt.applied),
      unapplied: num(receipt.unapplied),
      method: receipt.method,
      reference: receipt.referenceNo,
      allocations: receipt.allocations.map((a) => ({ invoiceExternalId: invoiceLinks.get(a.invoiceId) ?? null, invoiceNo: a.invoice.invoiceNo, amount: num(a.amountApplied) })),
    };
  }

  // ---------- External ID links ----------

  private async postIfDraft(ctx: ApiKeyContext, invoiceId: string) {
    await this.assertScope(ctx, 'invoices:post');
    const inv = await this.prisma.salesInvoice.findFirst({ where: { id: invoiceId, companyId: ctx.companyId }, select: { invoiceStatus: true, status: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const status = String(inv.invoiceStatus || inv.status).toUpperCase();
    if (status === 'VOID') throw new ConflictException('Invoice has been voided');
    if (status === 'DRAFT') await this.sales.post({ user: ctx.user }, invoiceId);
  }

  private async assertScope(ctx: ApiKeyContext, scope: 'invoices:post') {
    if (!ctx.scopes.includes(scope)) throw new ForbiddenException(`API key is missing the ${scope} scope`);
    if (!(await this.keys.ownerStillHas(ctx, scope))) throw new ForbiddenException(`API key owner no longer has the permissions behind ${scope}`);
  }

  private assertExternalId(externalId: string) {
    if (!EXTERNAL_ID.test(externalId)) throw new BadRequestException('External IDs must be 1-100 characters: letters, digits, . _ : -');
  }

  private linkWhere(ctx: ApiKeyContext, entityType: EntityType, externalId: string) {
    return { companyId_source_entityType_externalId: { companyId: ctx.companyId, source: ctx.source, entityType, externalId } };
  }

  private async resolve(ctx: ApiKeyContext, entityType: EntityType, externalId: string, label: string) {
    this.assertExternalId(externalId);
    const link = await this.prisma.externalLink.findUnique({ where: this.linkWhere(ctx, entityType, externalId) });
    if (!link?.entityId) throw new NotFoundException(`${label} ${externalId} was not found`);
    return link.entityId;
  }

  /** Returns the linked entity ID, dropping the link if its entity has since been deleted. */
  private async linkedEntity(ctx: ApiKeyContext, entityType: EntityType, externalId: string, exists: (id: string) => Promise<number>) {
    const link = await this.prisma.externalLink.findUnique({ where: this.linkWhere(ctx, entityType, externalId) });
    if (!link?.entityId) return null;
    if (await exists(link.entityId)) return link.entityId;
    await this.prisma.externalLink.deleteMany({ where: { id: link.id, entityId: link.entityId } });
    return null;
  }

  private async externalIdsFor(ctx: ApiKeyContext, entityType: EntityType, entityIds: string[]) {
    if (!entityIds.length) return new Map<string, string>();
    const links = await this.prisma.externalLink.findMany({ where: { companyId: ctx.companyId, source: ctx.source, entityType, entityId: { in: entityIds } } });
    return new Map(links.map((l) => [l.entityId as string, l.externalId]));
  }

  /**
   * Creates the entity at most once per external ID. The unique link row is claimed before the
   * entity is created, so concurrent retries cannot create duplicates. A repeat request with a
   * different payload is rejected rather than silently ignored.
   */
  private async createOnce(ctx: ApiKeyContext, entityType: EntityType, externalId: string, requestHash: string | undefined, create: () => Promise<string>) {
    const where = this.linkWhere(ctx, entityType, externalId);
    let claimId: string | null = null;
    for (let attempt = 0; attempt < 2 && !claimId; attempt++) {
      const link = await this.prisma.externalLink.findUnique({ where });
      if (link?.entityId) {
        if (requestHash && link.requestHash && link.requestHash !== requestHash) {
          throw new ConflictException(`${externalId} already exists with different details`);
        }
        return { entityId: link.entityId, created: false };
      }
      if (link) {
        if (Date.now() - link.createdAt.getTime() < STALE_CLAIM_MS) throw new ConflictException(`${externalId} is still being created; retry shortly`);
        await this.prisma.externalLink.deleteMany({ where: { id: link.id, entityId: null } });
      }
      try {
        const claim = await this.prisma.externalLink.create({ data: { companyId: ctx.companyId, source: ctx.source, entityType, externalId, requestHash } });
        claimId = claim.id;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
    }
    if (!claimId) throw new ConflictException(`${externalId} is being created by another request; retry shortly`);

    try {
      const entityId = await create();
      await this.prisma.externalLink.update({ where: { id: claimId }, data: { entityId } });
      return { entityId, created: true };
    } catch (e) {
      await this.prisma.externalLink.delete({ where: { id: claimId } }).catch(() => {});
      throw e;
    }
  }
}
