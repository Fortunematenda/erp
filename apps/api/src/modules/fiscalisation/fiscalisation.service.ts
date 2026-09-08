import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FiscalProviderFactory } from './providers/provider.factory';
import { createHash } from 'crypto';

const round2 = (n: number) => Number(n.toFixed(2));

@Injectable()
export class FiscalisationService {
  constructor(private prisma: PrismaService, private factory: FiscalProviderFactory) {}

  private _simulateNextFailure = false;
  simulateFailure(on: boolean) { this._simulateNextFailure = on; }

  private mode(): string { return (process.env.ZIMRA_MODE || 'mock').toLowerCase(); }
  private companyOf(req: any) { return req.user?.companyId; }

  async listDevices(companyId: string) {
    return this.prisma.fiscalDevice.findMany({ where: { branch: { companyId } }, include: { branch: true, fiscalDays: { orderBy: { dayNo: 'desc' }, take: 3 } } });
  }

  async register(companyId: string, deviceId: string) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } }, include: { branch: { include: { company: true } } } });
    if (!d) throw new BadRequestException('Device not found');
    const p = this.factory.get();
    const verified = await p.verifyTaxpayer({ tin: d.branch.company.tin, vatNumber: d.branch.company.vatNumber });
    const res = await p.registerDevice({ serialNumber: d.serialNumber, company: verified });
    await this.prisma.fiscalIntegrationLog.create({ data: { deviceId: d.id, operation: 'registerDevice', status: 'OK', request: { serialNumber: d.serialNumber }, response: res } });
    return this.prisma.fiscalDevice.update({ where: { id: d.id }, data: { status: 'ACTIVE', zimraDeviceId: res.zimraDeviceId, certificateRef: res.certificateRef, certificateExpiresAt: new Date(res.expiresAt) } });
  }

  async openDay(companyId: string, deviceId: string) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d) throw new BadRequestException('Device not found');
    if (d.status !== 'ACTIVE') throw new BadRequestException('Register device first');
    if (d.dayStatus === 'OPEN') throw new BadRequestException('Fiscal day already open');
    const dayNo = d.fiscalDayNo + 1;
    const res = await this.factory.get().openDay({ dayNo });
    return this.prisma.$transaction(async (tx) => {
      await tx.fiscalIntegrationLog.create({ data: { deviceId: d.id, operation: 'openDay', status: 'OK', response: res } });
      await tx.fiscalDay.create({ data: { deviceId: d.id, dayNo, status: 'OPEN', openedAt: new Date() } });
      return tx.fiscalDevice.update({ where: { id: d.id }, data: { fiscalDayNo: dayNo, receiptCounter: 0, dayStatus: 'OPEN' } });
    });
  }

  private async allocate(deviceId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ fiscalDayNo: number; receiptCounter: number; globalReceiptNo: number }>>`UPDATE "FiscalDevice" SET "receiptCounter" = "receiptCounter" + 1, "globalReceiptNo" = "globalReceiptNo" + 1 WHERE id = ${deviceId} AND "dayStatus" = 'OPEN' RETURNING id, "fiscalDayNo", "receiptCounter", "globalReceiptNo"`;
    if (!rows[0]) throw new BadRequestException('Unable to allocate receipt sequence');
    return rows[0];
  }

  private async providerSubmit(payload: any) {
    if (this.mode() === 'mock' && this._simulateNextFailure) {
      this._simulateNextFailure = false;
      throw new Error('SIMULATED_PROVIDER_FAILURE: fiscal provider rejected the request (mock).');
    }
    return this.factory.get().submitReceipt({ ...payload, receiptHash: payload.receiptHash });
  }

  private async submitAndLink(a: { deviceId: string; zimraDeviceId: string | null; fiscalDayNo: number; receiptCounter: number; globalReceiptNo: number; receiptType: string; payload: any; receiptId: string; link: { invoiceId?: string; creditNoteId?: string; debitNoteId?: string } }) {
    try {
      const res = await this.providerSubmit(a.payload);
      await this.prisma.$transaction(async (tx) => {
        await tx.fiscalReceipt.update({ where: { id: a.receiptId }, data: { status: 'FISCALISED', zimraReceiptId: res.receiptID, serverSignature: res.receiptServerSignature, rawResponse: res, submittedAt: new Date(), attemptCount: { increment: 1 }, lastAttemptAt: new Date() } });
        const target: any = {};
        if (a.link.invoiceId) target.invoice = { update: { fiscalStatus: 'FISCALISED' } };
        if (a.link.creditNoteId) target.creditNote = { update: { fiscalStatus: 'FISCALISED' } };
        if (a.link.debitNoteId) target.debitNote = { update: { fiscalStatus: 'FISCALISED' } };
        await tx.fiscalDay.update({ where: { deviceId_dayNo: { deviceId: a.deviceId, dayNo: a.fiscalDayNo } }, data: { receiptCount: { increment: 1 }, grossTotal: { increment: a.payload.total }, taxTotal: { increment: a.payload.tax } } });
        await tx.fiscalIntegrationLog.create({ data: { deviceId: a.deviceId, operation: 'submitReceipt', status: 'OK', request: a.payload, response: res } });
      });
      return this.prisma.fiscalReceipt.findUnique({ where: { id: a.receiptId } });
    } catch (e: any) {
      await this.prisma.fiscalReceipt.update({ where: { id: a.receiptId }, data: { status: 'RETRY', rawResponse: { error: e.message }, attemptCount: { increment: 1 }, lastAttemptAt: new Date(), lastError: e.message } });
      throw e;
    }
  }

  async fiscalise(companyId: string, deviceId: string, invoiceId: string) {
    const inv = await this.prisma.salesInvoice.findFirst({ where: { id: invoiceId, companyId }, include: { lines: true, customer: true, fiscalReceipt: true, receipts: true } });
    if (!inv) throw new BadRequestException('Invoice not found');
    if (inv.status === 'DRAFT') throw new BadRequestException('Post invoice before fiscalisation');
    if (!inv.fiscalRequired) throw new BadRequestException('Invoice does not require fiscalisation');
    if (inv.fiscalReceipt) return inv.fiscalReceipt;
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d || d.dayStatus !== 'OPEN') throw new BadRequestException('Fiscal day is not open');
    const allocated = await this.allocate(deviceId);
    const payment = await this.derivePayment(companyId, inv);
    const payload = { deviceID: d.zimraDeviceId, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalInvoice', invoiceNo: inv.invoiceNo, currency: inv.currency, total: Number(inv.total), tax: Number(inv.taxTotal), paymentMethod: payment.method, payments: payment.payments, buyer: { name: inv.customer?.name, tin: inv.customer?.tin, vatNumber: inv.customer?.vatNumber, address: inv.billingAddress || inv.customer?.address1 }, lines: inv.lines.map((l) => ({ name: l.description, qty: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate), taxAmount: Number(l.taxAmount), total: Number(l.lineTotal), hsCode: l.hsCode })) };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const receipt = await this.prisma.fiscalReceipt.create({ data: { deviceId: d.id, invoiceId: inv.id, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptHash: hash, rawRequest: payload, status: 'PENDING', customerName: inv.customer?.name, paymentMethod: payment.method, total: Number(inv.total), tax: Number(inv.taxTotal), currency: inv.currency } });
    return this.submitAndLink({ deviceId: d.id, zimraDeviceId: d.zimraDeviceId, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalInvoice', payload: { ...payload, receiptHash: hash }, receiptId: receipt.id, link: { invoiceId: inv.id } });
  }

  async fiscaliseCreditNote(companyId: string, deviceId: string, creditNoteId: string) {
    const cn = await this.prisma.creditNote.findFirst({ where: { id: creditNoteId, companyId }, include: { lines: true, invoice: { include: { fiscalReceipt: true } }, fiscalReceipt: true, customer: true } });
    if (!cn) throw new BadRequestException('Credit note not found');
    if (cn.status === 'DRAFT') throw new BadRequestException('Post credit note before fiscalisation');
    if (cn.fiscalReceipt) throw new BadRequestException('Credit note already has fiscal receipt');
    const original = cn.invoice?.fiscalReceipt;
    if (!cn.invoice || !original) throw new BadRequestException('Credit note must reference a fiscalised invoice');
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d || d.dayStatus !== 'OPEN') throw new BadRequestException('Fiscal day is not open');
    const allocated = await this.allocate(deviceId);
    const payload = { deviceID: d.zimraDeviceId, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalCreditNote', referenceReceipt: original.zimraReceiptId || original.globalReceiptNo, creditNoteNo: cn.creditNoteNo, currency: cn.invoice.currency, total: -Number(cn.total), tax: -Number(cn.taxTotal), buyer: { name: cn.customer?.name, tin: cn.customer?.tin, vatNumber: cn.customer?.vatNumber }, lines: cn.lines.map((l) => ({ name: l.description, qty: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate), taxAmount: -Number(l.taxAmount), total: -Number(l.lineTotal) })) };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const receipt = await this.prisma.fiscalReceipt.create({ data: { deviceId: d.id, creditNoteId: cn.id, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalCreditNote', receiptHash: hash, rawRequest: payload, status: 'PENDING', customerName: cn.customer?.name, paymentMethod: cn.invoice.currency ? 'CREDIT' : 'CASH', currency: cn.invoice.currency, total: -Number(cn.total), tax: -Number(cn.taxTotal) } });
    return this.submitAndLink({ deviceId: d.id, zimraDeviceId: d.zimraDeviceId, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalCreditNote', payload: { ...payload, receiptHash: hash }, receiptId: receipt.id, link: { creditNoteId: cn.id } });
  }

  async fiscaliseDebitNote(companyId: string, deviceId: string, debitNoteId: string) {
    const dn = await this.prisma.debitNote.findFirst({ where: { id: debitNoteId, companyId }, include: { lines: true, invoice: { include: { fiscalReceipt: true } }, fiscalReceipt: true, customer: true } });
    if (!dn) throw new BadRequestException('Debit note not found');
    if (dn.status === 'DRAFT') throw new BadRequestException('Post debit note before fiscalisation');
    if (dn.fiscalReceipt) throw new BadRequestException('Debit note already has fiscal receipt');
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d || d.dayStatus !== 'OPEN') throw new BadRequestException('Fiscal day is not open');
    const allocated = await this.allocate(deviceId);
    const currency = dn.invoice?.currency || 'USD';
    const payload = { deviceID: d.zimraDeviceId, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalDebitNote', referenceReceipt: dn.invoice?.fiscalReceipt?.zimraReceiptId || dn.invoice?.fiscalReceipt?.globalReceiptNo, debitNoteNo: dn.debitNoteNo, currency, total: Number(dn.total), tax: Number(dn.taxTotal), buyer: { name: dn.customer?.name, tin: dn.customer?.tin, vatNumber: dn.customer?.vatNumber }, lines: dn.lines.map((l) => ({ name: l.description, qty: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate), taxAmount: Number(l.taxAmount), total: Number(l.lineTotal) })) };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const receipt = await this.prisma.fiscalReceipt.create({ data: { deviceId: d.id, debitNoteId: dn.id, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalDebitNote', receiptHash: hash, rawRequest: payload, status: 'PENDING', customerName: dn.customer?.name, paymentMethod: 'CREDIT', currency, total: Number(dn.total), tax: Number(dn.taxTotal) } });
    return this.submitAndLink({ deviceId: d.id, zimraDeviceId: d.zimraDeviceId, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalDebitNote', payload: { ...payload, receiptHash: hash }, receiptId: receipt.id, link: { debitNoteId: dn.id } });
  }

  async retryFiscalReceipts(companyId: string) {
    const receipts = await this.prisma.fiscalReceipt.findMany({ where: { status: 'RETRY', OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] }, include: { device: true } });
    let done = 0;
    for (const r of receipts) {
      try {
        const res = await this.providerSubmit(r.rawRequest as any);
        await this.prisma.$transaction(async (tx) => {
          await tx.fiscalReceipt.update({ where: { id: r.id }, data: { status: 'FISCALISED', zimraReceiptId: res.receiptID, serverSignature: res.receiptServerSignature, rawResponse: res, submittedAt: new Date(), lastError: null } });
          if (r.invoiceId) await tx.salesInvoice.update({ where: { id: r.invoiceId }, data: { fiscalStatus: 'FISCALISED' } });
          if (r.creditNoteId) await tx.creditNote.update({ where: { id: r.creditNoteId }, data: { fiscalStatus: 'FISCALISED' } });
          if (r.debitNoteId) await tx.debitNote.update({ where: { id: r.debitNoteId }, data: { fiscalStatus: 'FISCALISED' } });
          await tx.fiscalIntegrationLog.create({ data: { deviceId: r.deviceId, operation: 'retrySubmit', status: 'OK', request: r.rawRequest as any, response: res } });
        });
        done++;
      } catch (e: any) {
        await this.prisma.fiscalReceipt.update({ where: { id: r.id }, data: { lastAttemptAt: new Date(), lastError: e.message, nextRetryAt: new Date(Date.now() + 120000) } });
      }
    }
    return { retried: done, remaining: receipts.length - done };
  }

  async closeDay(companyId: string, deviceId: string) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d || d.dayStatus !== 'OPEN') throw new BadRequestException('No open fiscal day');
    const day = await this.prisma.fiscalDay.findUnique({ where: { deviceId_dayNo: { deviceId: d.id, dayNo: d.fiscalDayNo } } });
    const res = await this.factory.get().closeDay({ deviceId: d.zimraDeviceId, dayNo: d.fiscalDayNo, receiptCount: day?.receiptCount, grossTotal: Number(day?.grossTotal || 0), taxTotal: Number(day?.taxTotal || 0) });
    return this.prisma.$transaction(async (tx) => {
      await tx.fiscalDay.update({ where: { deviceId_dayNo: { deviceId: d.id, dayNo: d.fiscalDayNo } }, data: { status: 'CLOSED', closedAt: new Date() } });
      await tx.fiscalIntegrationLog.create({ data: { deviceId: d.id, operation: 'closeDay', status: 'OK', response: res } });
      return tx.fiscalDevice.update({ where: { id: d.id }, data: { dayStatus: 'CLOSED' } });
    });
  }

  async receipts(companyId: string) {
    return this.prisma.fiscalReceipt.findMany({ where: { OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] }, include: { invoice: true, creditNote: true, debitNote: true, device: { include: { branch: true } } }, orderBy: { createdAt: 'desc' } });
  }

  // ---------- Payment derivation (reuse real receipts; never invent) ----------
  private async derivePayment(companyId: string, inv: any) {
    const payments = await this.prisma.receipt.findMany({ where: { invoiceId: inv.id, status: 'POSTED' }, select: { method: true, amount: true, applied: true } });
    if (payments.length) {
      const byMethod = payments.reduce((acc, p) => { const m = p.method || 'CASH'; acc[m] = (acc[m] || 0) + Number(p.amount); return acc; }, {} as Record<string, number>);
      const method = Object.keys(byMethod).length === 1 ? Object.keys(byMethod)[0] : 'CASH';
      const total = Object.values(byMethod).reduce((s, v) => s + v, 0);
      return { method, payments: Object.entries(byMethod).map(([m, amt]) => ({ method: m, amount: round2(amt) })), paid: round2(total) };
    }
    // unpaid / credit-sale treatment (do not falsely report Cash)
    if (Number(inv.paymentStatus === 'PAID')) return { method: 'CASH', payments: [{ method: 'CASH', amount: Number(inv.total) }], paid: Number(inv.total) };
    return { method: 'CREDIT', payments: [{ method: 'CREDIT', amount: Number(inv.balanceDue ?? 0) }], paid: 0 };
  }

  // ---------- Ready / failed queues ----------
  async readyQueue(companyId: string) {
    const [invoices, creditNotes, debitNotes] = await Promise.all([
      this.prisma.salesInvoice.findMany({ where: { companyId, status: { not: 'DRAFT' }, fiscalRequired: true, fiscalStatus: 'READY' }, include: { customer: true, fiscalReceipt: true }, orderBy: { invoiceDate: 'desc' } }),
      this.prisma.creditNote.findMany({ where: { companyId, status: { not: 'DRAFT' }, fiscalStatus: { not: 'FISCALISED' } }, include: { customer: true, fiscalReceipt: true, invoice: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.debitNote.findMany({ where: { companyId, status: { not: 'DRAFT' }, fiscalStatus: { not: 'FISCALISED' } }, include: { customer: true, fiscalReceipt: true, invoice: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      invoices: invoices.filter((i) => !i.fiscalReceipt).map((i) => ({ id: i.id, documentType: 'INVOICE', docNo: i.invoiceNo, date: i.invoiceDate, customer: i.customer?.name, currency: i.currency, total: Number(i.total), tax: Number(i.taxTotal), fiscalStatus: i.fiscalStatus })),
      creditNotes: creditNotes.filter((c) => !c.fiscalReceipt).map((c) => ({ id: c.id, documentType: 'CREDIT_NOTE', docNo: c.creditNoteNo, date: c.creditNoteDate, customer: c.customer?.name, currency: c.invoice?.currency || 'USD', total: -Number(c.total), tax: -Number(c.taxTotal), fiscalStatus: c.fiscalStatus })),
      debitNotes: debitNotes.filter((u) => !u.fiscalReceipt).map((u) => ({ id: u.id, documentType: 'DEBIT_NOTE', docNo: u.debitNoteNo, date: u.createdAt, customer: u.customer?.name, currency: u.invoice?.currency || 'USD', total: Number(u.total), tax: Number(u.taxTotal), fiscalStatus: u.fiscalStatus })),
    };
  }

  // ---------- Aggregation ----------
  private receiptWhere(companyId: string) {
    return { OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] };
  }

  async dashboard(companyId: string) {
    const devices = await this.prisma.fiscalDevice.findMany({ where: { branch: { companyId } }, include: { branch: true, fiscalDays: { orderBy: { dayNo: 'desc' }, take: 1 } }, orderBy: { name: 'asc' } });
    const device = devices[0];
    const today = new Date(); const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()); const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const todayReceipts = await this.prisma.fiscalReceipt.findMany({ where: { ...this.receiptWhere(companyId), status: 'FISCALISED', createdAt: { gte: dayStart, lt: dayEnd } } });
    const lastReceipt = await this.prisma.fiscalReceipt.findFirst({ where: { ...this.receiptWhere(companyId), status: 'FISCALISED' }, include: { invoice: true, creditNote: true, debitNote: true, device: { include: { branch: true } } }, orderBy: { createdAt: 'desc' } });
    const lastClosedDay = await this.prisma.fiscalDay.findFirst({ where: { device: { branch: { companyId } }, status: 'CLOSED' }, include: { device: { include: { branch: true } } }, orderBy: { closedAt: 'desc' } });
    const failed = await this.prisma.fiscalReceipt.count({ where: { ...this.receiptWhere(companyId), status: { in: ['RETRY', 'REJECTED'] } } });
    const pendingFiscalise = await this.prisma.salesInvoice.count({ where: { companyId, status: { not: 'DRAFT' }, fiscalRequired: true, fiscalStatus: 'READY', fiscalReceipt: null } });
    const open = device?.dayStatus === 'OPEN';
    const cert = device?.certificateExpiresAt;
    const certificateDays = cert ? Math.ceil((cert.getTime() - Date.now()) / 86400000) : null;
    return {
      mode: this.mode(),
      device: device ? { id: device.id, name: device.name, branch: device.branch?.name, branchId: device.branchId, serialNumber: device.serialNumber, status: device.status, connection: this.mode() === 'mock' ? 'MOCK' : 'LIVE', dayStatus: device.dayStatus, fiscalDayNo: device.fiscalDayNo, receiptCounter: device.receiptCounter, globalReceiptNo: device.globalReceiptNo, zimraDeviceId: device.zimraDeviceId, certificateStatus: certificateDays == null ? 'UNKNOWN' : certificateDays < 0 ? 'EXPIRED' : 'VALID', certificateExpiresAt: cert, certificateDays } : null,
      fiscalDay: open && device ? { id: device.fiscalDays[0]?.id, dayNo: device.fiscalDayNo, status: device.dayStatus } : null,
      today: { receipts: todayReceipts.length, gross: round2(todayReceipts.reduce((s, r) => s + Number(r.total || 0), 0)), vat: round2(todayReceipts.reduce((s, r) => s + Number(r.tax || 0), 0)) },
      lastReceipt: lastReceipt ? { id: lastReceipt.id, receiptNo: `RCP-${String(lastReceipt.globalReceiptNo).padStart(6, '0')}`, globalReceiptNo: lastReceipt.globalReceiptNo, fiscalDayNo: lastReceipt.fiscalDayNo, documentType: lastReceipt.receiptType, docNo: lastReceipt.invoice?.invoiceNo || lastReceipt.creditNote?.creditNoteNo || lastReceipt.debitNote?.debitNoteNo || '—', customer: lastReceipt.customerName, amount: Number(lastReceipt.total), tax: Number(lastReceipt.tax), currency: lastReceipt.currency, status: lastReceipt.status, createdAt: lastReceipt.createdAt } : null,
      lastClosedDay: lastClosedDay || null,
      failed,
      pendingFiscalise,
      needsAttention: { failed, pendingFiscalise, certificateDays, dayOpenHours: open && device?.fiscalDays[0]?.openedAt ? round2((Date.now() - device.fiscalDays[0].openedAt.getTime()) / 3600000) : 0 },
    };
  }

  async fiscalDays(companyId: string) {
    const days = await this.prisma.fiscalDay.findMany({ where: { device: { branch: { companyId } } }, include: { device: { include: { branch: true } } }, orderBy: { dayNo: 'desc' } });
    const daysWithReceipts = await Promise.all(days.map(async (day) => {
      const receipts = await this.prisma.fiscalReceipt.findMany({ where: { deviceId: day.deviceId, fiscalDayNo: day.dayNo }, orderBy: { receiptCounter: 'asc' } });
      return { day, receipts };
    }));
    return daysWithReceipts.map(({ day, receipts }) => ({
      id: day.id, dayNo: day.dayNo, device: day.device?.name, branch: day.device?.branch?.name, status: day.status, openedAt: day.openedAt, closedAt: day.closedAt,
      receiptCount: receipts.length, gross: Number(receipts.reduce((s, r) => s + Number(r.total || 0), 0)), vat: Number(receipts.reduce((s, r) => s + Number(r.tax || 0), 0)),
      creditNotes: Number(receipts.filter((r) => r.receiptType === 'FiscalCreditNote').reduce((s, r) => s + Number(r.total || 0), 0)),
      debitNotes: Number(receipts.filter((r) => r.receiptType === 'FiscalDebitNote').reduce((s, r) => s + Number(r.total || 0), 0)),
      failed: receipts.filter((r) => ['RETRY', 'REJECTED'].includes(r.status)).length,
      firstReceipt: receipts[0] ? { id: receipts[0].id, receiptNo: `RCP-${String(receipts[0].globalReceiptNo).padStart(6, '0')}` } : null,
      lastReceipt: receipts[receipts.length - 1] ? { id: receipts[receipts.length - 1].id, receiptNo: `RCP-${String(receipts[receipts.length - 1].globalReceiptNo).padStart(6, '0')}` } : null,
    }));
  }

  async fiscalDayDetail(companyId: string, dayId: string) {
    const day = await this.prisma.fiscalDay.findFirst({ where: { id: dayId, device: { branch: { companyId } } }, include: { device: { include: { branch: true } } } });
    if (!day) throw new BadRequestException('Fiscal day not found');
    const receipts = await this.prisma.fiscalReceipt.findMany({ where: { deviceId: day.deviceId, fiscalDayNo: day.dayNo }, include: { invoice: true, creditNote: true, debitNote: true }, orderBy: { receiptCounter: 'asc' } });
    return { id: day.id, dayNo: day.dayNo, device: day.device?.name, branch: day.device?.branch?.name, status: day.status, openedAt: day.openedAt, closedAt: day.closedAt, receiptCount: receipts.length, gross: Number(receipts.reduce((s, r) => s + Number(r.total || 0), 0)), vat: Number(receipts.reduce((s, r) => s + Number(r.tax || 0), 0)), receipts };
  }

  async receiptDetail(companyId: string, receiptId: string) {
    const r = await this.prisma.fiscalReceipt.findFirst({ where: { id: receiptId, OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] }, include: { invoice: true, creditNote: true, debitNote: true, device: { include: { branch: true } } } });
    if (!r) throw new BadRequestException('Fiscal receipt not found');
    const logs = await this.prisma.fiscalIntegrationLog.findMany({ where: { deviceId: r.deviceId }, orderBy: { createdAt: 'asc' } });
    return { ...r, logs };
  }

  // ---------- Reports ----------
  async reports(companyId: string, q: { from?: string; to?: string; receiptType?: string; paymentMethod?: string; currency?: string; status?: string; fiscalDayNo?: string }) {
    const from = q.from ? new Date(q.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = q.to ? new Date(q.to) : new Date();
    const where: any = { ...this.receiptWhere(companyId), createdAt: { gte: from, lte: to } };
    if (q.receiptType) where.receiptType = q.receiptType;
    if (q.currency) where.currency = q.currency;
    if (q.status) where.status = q.status;
    if (q.paymentMethod) where.paymentMethod = q.paymentMethod;
    if (q.fiscalDayNo) where.fiscalDayNo = Number(q.fiscalDayNo);
    const receipts = await this.prisma.fiscalReceipt.findMany({ where, include: { invoice: true, creditNote: true, debitNote: true, device: { include: { branch: true } } }, orderBy: { createdAt: 'desc' } });
    const totals = { receipts: receipts.length, gross: round2(receipts.reduce((s, r) => s + Number(r.total || 0), 0)), vat: round2(receipts.reduce((s, r) => s + Number(r.tax || 0), 0)) };
    const byType = this.distribute(receipts, (r) => r.receiptType);
    const byPayment = this.distribute(receipts, (r) => r.paymentMethod || 'CASH');
    const byCurrency = receipts.reduce((acc, r) => { const c = r.currency || 'USD'; const e = acc[c] || (acc[c] = { currency: c, receipts: 0, gross: 0, vat: 0 }); e.receipts++; e.gross += Number(r.total || 0); e.vat += Number(r.tax || 0); return acc; }, {} as Record<string, any>);
    return { from, to, totals, receipts, byType, byPayment, byCurrency: Object.values(byCurrency).map((c) => ({ ...c, gross: round2(c.gross), vat: round2(c.vat) })) };
  }

  private distribute(rows: any[], keyFn: (r: any) => string) {
    const acc: Record<string, number> = {};
    for (const r of rows) { const k = keyFn(r) || 'UNKNOWN'; acc[k] = (acc[k] || 0) + 1; }
    return Object.entries(acc).map(([key, count]) => ({ key, count }));
  }

  // ---------- Reconciliation: posted sales vs fiscalised ----------
  async reconciliation(companyId: string) {
    const invoices = await this.prisma.salesInvoice.findMany({ where: { companyId, status: { not: 'DRAFT' }, fiscalRequired: true }, include: { fiscalReceipt: true }, orderBy: { invoiceDate: 'desc' } });
    return invoices.map((i) => {
      const fiscal = i.fiscalReceipt;
      return { id: i.id, docNo: i.invoiceNo, docType: 'INVOICE', customer: i.customerId, currency: i.currency, postedAmount: Number(i.total), fiscalAmount: Number(fiscal?.total || 0), difference: round2(Number(i.total) - Number(fiscal?.total || 0)), fiscalStatus: fiscal ? fiscal.status : 'NOT_FISCALISED', fiscalReceiptId: fiscal?.id };
    });
  }

  async retryHistory(companyId: string, receiptId: string) {
    const receipt = await this.prisma.fiscalReceipt.findFirst({ where: { id: receiptId, OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] } });
    if (!receipt) throw new BadRequestException('Fiscal receipt not found');
    return this.prisma.fiscalIntegrationLog.findMany({ where: { deviceId: receipt.deviceId }, orderBy: { createdAt: 'asc' } });
  }
}

