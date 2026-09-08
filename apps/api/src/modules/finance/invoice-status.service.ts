import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

// Central, authoritative invoice status logic.
// Two independent axes (do not merge — they mean different things):
//   invoiceStatus / status  : DRAFT | POSTED | VOID   (financial lifecycle)
//   paymentStatus           : UNPAID | PARTIALLY_PAID | PAID | OVERDUE
//   fiscalStatus            : READY | FISCALISED | ...
// A posted invoice stays POSTED when a partial payment is recorded; the UI must
// show Payment Status prominently rather than implying POSTED means unpaid.

@Injectable()
export class InvoiceStatusService {
  constructor(private prisma: PrismaService) {}

  static resolvePaymentStatus(input: { invoiceStatus?: string; dueDate?: Date | null; total: number; amountPaid: number; creditsApplied: number }): { status: string; balanceDue: number } {
    const { invoiceStatus, dueDate, total, amountPaid, creditsApplied } = input;
    const balanceDue = Math.max(0, Number(total) - Number(amountPaid) - Number(creditsApplied));
    const paid = Math.max(0, Number(amountPaid) + Number(creditsApplied));
    let status: string;
    if (balanceDue <= 0.005) status = 'PAID';
    else if (paid > 0.005) status = 'PARTIALLY_PAID';
    else if (invoiceStatus === 'POSTED' && dueDate && new Date(dueDate) < startOfToday()) status = 'OVERDUE';
    else status = 'UNPAID';
    return { status, balanceDue: Number(balanceDue.toFixed(2)) };
  }

  static resolveDocumentStamp(invoice: { invoiceStatus?: string; paymentStatus?: string }): string {
    if (String(invoice.invoiceStatus || '').toUpperCase() === 'VOID') return 'VOID';
    const p = String(invoice.paymentStatus || '').toUpperCase();
    if (p === 'PAID') return 'PAID';
    if (p === 'PARTIALLY_PAID') return 'PART PAID';
    if (p === 'OVERDUE') return 'OVERDUE';
    return 'UNPAID';
  }

  async recalc(companyId: string, invoiceId: string) {
    const inv: any = await this.prisma.salesInvoice.findFirst({ where: { id: invoiceId, companyId }, include: { receipts: true, creditNotes: true } });
    if (!inv) throw new BadRequestException('Invoice not found');
    // Multi-invoice allocations are authoritative; legacy single-invoice receipts (no allocations) are added too.
    const allocs = await this.prisma.paymentAllocation.findMany({ where: { invoiceId, receipt: { status: { not: 'REVERSED' } } }, select: { amountApplied: true, receiptId: true } });
    const allocPaid = allocs.reduce((s: number, a: any) => s + Number(a.amountApplied), 0);
    const allocReceiptIds = new Set(allocs.map((a: any) => a.receiptId));
    const legacyPaid = (inv.receipts || []).filter((r: any) => r.status !== 'REVERSED' && !allocReceiptIds.has(r.id)).reduce((s: number, r: any) => s + Number(r.amount), 0);
    const amountPaid = allocPaid + legacyPaid;
    const creditsApplied = (inv.creditNotes || []).filter((c: any) => c.status === 'POSTED').reduce((s: number, c: any) => s + Number(c.total), 0);
    const { status, balanceDue } = InvoiceStatusService.resolvePaymentStatus({ invoiceStatus: inv.invoiceStatus, dueDate: inv.dueDate, total: Number(inv.total), amountPaid, creditsApplied });
    const updated = await this.prisma.salesInvoice.update({
      where: { id: inv.id },
      data: { amountPaid, creditsApplied, balanceDue, paymentStatus: status as any, invoiceStatus: String(inv.invoiceStatus || 'DRAFT').toUpperCase() },
    });
    return updated;
  }

  invoiceLabel(s: string) { return (s || '').replace(/_/g, ' ').toUpperCase(); }
  paymentLabel(s: string) { return (s || '').replace(/_/g, ' ').toUpperCase(); }
}

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
