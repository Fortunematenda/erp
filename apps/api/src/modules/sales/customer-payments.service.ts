import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { PostingService } from '../finance/posting.service';
import { InvoiceStatusService } from '../finance/invoice-status.service';
import { DocumentTrailService } from '../document-trail/document-trail.service';

@Injectable()
export class CustomerPaymentsService {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService, private posting: PostingService, private invoiceStatus: InvoiceStatusService, private trail: DocumentTrailService) {}

  private async depositCode(companyId: string, depositAccountId?: string) {
    if (!depositAccountId) return '1000';
    const ba: any = await this.prisma.bankAccount.findFirst({ where: { id: depositAccountId, companyId }, include: { ledgerAccount: true } });
    if (!ba) throw new BadRequestException('Deposit account not found');
    return ba.ledgerAccount?.code || '1000';
  }

  async list(customerId: string) {
    return this.prisma.receipt.findMany({ where: { customerId, status: { not: 'VOID' } }, include: { allocations: { include: { invoice: { select: { invoiceNo: true, total: true } } } }, customer: true }, orderBy: { receiptDate: 'desc' } });
  }

  async summary(customerId: string) {
    const [invoicedAgg, paidAgg, credits, unappliedAgg] = await Promise.all([
      this.prisma.salesInvoice.aggregate({ where: { customerId, invoiceStatus: 'POSTED' }, _sum: { total: true } }),
      this.prisma.receipt.aggregate({ where: { customerId, status: 'POSTED' }, _sum: { amount: true } }),
      this.prisma.creditNote.aggregate({ where: { customerId, status: 'POSTED' }, _sum: { total: true } }),
      this.prisma.receipt.aggregate({ where: { customerId, status: 'POSTED' }, _sum: { unapplied: true } }),
    ]);
    const invoiced = Number(invoicedAgg._sum.total || 0);
    const totalPaid = Number(paidAgg._sum.amount || 0);
    const creditsApplied = Number(credits._sum.total || 0);
    return { totalInvoiced: invoiced, totalPaid, creditsApplied, remainingBalance: Math.max(0, invoiced - creditsApplied - totalPaid), unappliedCredits: Number(unappliedAgg._sum.unapplied || 0) };
  }

  private async remaining(companyId: string, invoiceId: string) {
    const inv: any = await this.prisma.salesInvoice.findUnique({ where: { id: invoiceId }, include: { receipts: true, creditNotes: true } });
    if (!inv || inv.invoiceStatus !== 'POSTED') return -1;
    const paid = (inv.receipts || []).filter((r: any) => r.status === 'POSTED').reduce((s: number, r: any) => s + Number(r.amount), 0);
    const credits = (inv.creditNotes || []).filter((c: any) => c.status === 'POSTED').reduce((s: number, c: any) => s + Number(c.total), 0);
    return Math.max(0, Number(inv.total) - paid - credits);
  }

  private async applyAllocations(companyId: string, receipt: any, allocs: any[], userId: string) {
    for (const a of allocs) {
      await this.prisma.paymentAllocation.create({ data: { receiptId: receipt.id, invoiceId: a.invoiceId, amountApplied: Number(a.amount) } });
      await this.invoiceStatus.recalc(companyId, a.invoiceId);
      await this.trail.create(companyId, { documentType: 'INVOICE', documentId: a.invoiceId, eventType: 'PAYMENT_RECEIVED', title: 'Payment Received', description: `Payment ${receipt.receiptNo} of ${Number(a.amount).toFixed(2)} applied.`, metadata: { receiptNo: receipt.receiptNo, amount: Number(a.amount) }, userId }).catch(() => {});
    }
  }

  async create(customerId: string, dto: any, userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new BadRequestException('Customer not found');
    const companyId = customer.companyId;
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('Payment amount must be greater than 0');
    const allocs = (dto.allocations || []).filter((a: any) => Number(a.amount) > 0);
    const applied = allocs.reduce((s: number, a: any) => s + Number(a.amount), 0);
    if (applied > amount + 0.005) throw new BadRequestException('Total applied exceeds payment amount');
    for (const a of allocs) {
      const inv: any = await this.prisma.salesInvoice.findFirst({ where: { id: a.invoiceId, customerId, companyId } });
      if (!inv) throw new BadRequestException('Invoice not found or not for this customer');
      const rem = await this.remaining(companyId, a.invoiceId);
      if (rem < 0) throw new BadRequestException('Invoice is not postable');
      if (Number(a.amount) > rem + 0.005) throw new BadRequestException('Applied amount exceeds invoice balance');
    }
    const depositCode = await this.depositCode(companyId, dto.depositAccountId);
    const receipt = await this.prisma.receipt.create({
      data: { companyId, customerId, receiptNo: await this.numbering.next(companyId, 'PMT'), receiptDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(), amount, applied, unapplied: Math.max(0, amount - applied), method: dto.paymentMethod || 'CASH', referenceNo: dto.reference, depositAccountId: dto.depositAccountId, note: dto.memo, status: 'POSTED' },
    });
    await this.applyAllocations(companyId, receipt, allocs, userId);
    await this.posting.postCustomerPayment(companyId, { amount, depositAccountCode: depositCode, reference: receipt.receiptNo, date: receipt.receiptDate, sourceId: receipt.id });
    await this.audit.log(companyId, userId, 'PAYMENT_CREATED', 'Receipt', receipt.id, { receiptNo: receipt.receiptNo, amount, applied, unapplied: receipt.unapplied });
    return this.prisma.receipt.findUnique({ where: { id: receipt.id }, include: { allocations: { include: { invoice: true } } } });
  }

  async get(paymentId: string) {
    return this.prisma.receipt.findUnique({ where: { id: paymentId }, include: { allocations: { include: { invoice: true } }, customer: true } });
  }

  async applyCredit(paymentId: string, dto: any, userId: string) {
    const receipt: any = await this.prisma.receipt.findUnique({ where: { id: paymentId }, include: { customer: true } });
    if (!receipt) throw new BadRequestException('Payment not found');
    const companyId = receipt.companyId;
    const allocs = (dto.allocations || []).filter((a: any) => Number(a.amount) > 0);
    const applied = allocs.reduce((s: number, a: any) => s + Number(a.amount), 0);
    if (applied > Number(receipt.unapplied) + 0.005) throw new BadRequestException('Cannot apply more than available unapplied credit');
    for (const a of allocs) {
      const inv: any = await this.prisma.salesInvoice.findFirst({ where: { id: a.invoiceId, customerId: receipt.customerId, companyId } });
      if (!inv) throw new BadRequestException('Invoice not for this customer');
      const rem = await this.remaining(companyId, a.invoiceId);
      if (rem < 0 || Number(a.amount) > rem + 0.005) throw new BadRequestException('Exceeds invoice remaining balance');
    }
    await this.applyAllocations(companyId, receipt, allocs, userId);
    await this.prisma.receipt.update({ where: { id: receipt.id }, data: { applied: Number(receipt.applied) + applied, unapplied: Math.max(0, Number(receipt.unapplied) - applied) } });
    await this.audit.log(companyId, userId, 'UNAPPLIED_CREDIT_APPLIED', 'Receipt', receipt.id, { amount: applied });
    return this.prisma.receipt.findUnique({ where: { id: receipt.id }, include: { allocations: { include: { invoice: true } } } });
  }

  async reverse(paymentId: string, userId: string) {
    const receipt: any = await this.prisma.receipt.findUnique({ where: { id: paymentId }, include: { allocations: true, customer: true } });
    if (!receipt) throw new BadRequestException('Payment not found');
    if (receipt.status === 'REVERSED') throw new BadRequestException('Payment already reversed');
    const companyId = receipt.companyId;
    const amount = Number(receipt.amount);
    const depositCode = await this.depositCode(companyId, receipt.depositAccountId);
    await this.posting.postCustomerPayment(companyId, { amount: -amount, depositAccountCode: depositCode, reference: `${receipt.receiptNo}-REV`, date: new Date(), sourceId: receipt.id, sourceType: 'RECEIPT_REVERSAL' });
    for (const a of receipt.allocations) await this.invoiceStatus.recalc(companyId, a.invoiceId);
    await this.prisma.receipt.update({ where: { id: receipt.id }, data: { status: 'REVERSED', applied: 0, unapplied: 0 } });
    await this.audit.log(companyId, userId, 'PAYMENT_REVERSED', 'Receipt', receipt.id, { receiptNo: receipt.receiptNo, amount });
    return { ok: true };
  }
}
