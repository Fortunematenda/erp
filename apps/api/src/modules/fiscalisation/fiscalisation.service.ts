import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { FiscalProviderFactory } from './providers/provider.factory';
import { FiscalisationReadinessService } from './fiscalisation-readiness.service';
import { FiscalCertificateService } from './fiscal-certificate.service';
import { encryptSecret, decryptSecret, maskSecret, hasSecret } from './fiscal-crypto';
import { createHash } from 'crypto';

const round2 = (n: number) => Number(n.toFixed(2));

@Injectable()
export class FiscalisationService {
  constructor(
    private prisma: PrismaService,
    private factory: FiscalProviderFactory,
    private audit: AuditService,
    private readinessSvc: FiscalisationReadinessService,
    private certSvc: FiscalCertificateService,
  ) {}

  private _simulateNextFailure = false;
  simulateFailure(on: boolean) { this._simulateNextFailure = on; }

  private mode(): string { return (process.env.ZIMRA_MODE || 'mock').toLowerCase(); }
  private companyOf(req: any) { return req.user?.companyId; }

  async listDevices(companyId: string) {
    const devices = await this.prisma.fiscalDevice.findMany({ where: { branch: { companyId } }, include: { branch: true, fiscalDays: { orderBy: { dayNo: 'desc' }, take: 3 } } });
    return devices.map((d) => this.sanitizeDevice(d));
  }

  private sanitizeDevice(d: any) {
    const { activationKeyEnc, ...rest } = d;
    return { ...rest, activationKeyMasked: maskSecret(activationKeyEnc), hasActivationKey: hasSecret(activationKeyEnc) };
  }

  async register(companyId: string, deviceId: string) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } }, include: { branch: { include: { company: true } } } });
    if (!d) throw new BadRequestException('Device not found');
    if (!d.branch.company.tin) throw new BadRequestException('Company TIN is required before device registration.');
    const p = this.factory.get();
    const verified = await p.verifyTaxpayer({ tin: d.branch.company.tin, vatNumber: d.branch.company.vatNumber });
    const res = await p.registerDevice({ serialNumber: d.serialNumber, modelName: d.modelName, modelVersion: d.modelVersion, company: verified });
    await this.prisma.fiscalIntegrationLog.create({ data: { deviceId: d.id, operation: 'registerDevice', status: 'OK', environment: d.environment, request: { serialNumber: d.serialNumber }, response: res } });
    const updated = await this.prisma.fiscalDevice.update({ where: { id: d.id }, data: { status: 'ACTIVE', zimraDeviceId: res.zimraDeviceId, certificateRef: res.certificateRef, certificateThumbprint: res.certificateThumbprint, certificateExpiresAt: new Date(res.expiresAt), registeredAt: new Date(), activationKeyEnc: res.activationKey ? encryptSecret(res.activationKey) : d.activationKeyEnc } });
    await this.audit.log(companyId, undefined, 'fiscal.device.register', 'FiscalDevice', d.id, { module: 'fiscalisation', metadata: { environment: d.environment, serialNumber: d.serialNumber } });
    return updated;
  }

  async openDay(companyId: string, deviceId: string) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d) throw new BadRequestException('Device not found');
    if (d.status !== 'ACTIVE') throw new BadRequestException('Register device first');
    if (d.dayStatus === 'OPEN') throw new BadRequestException('Fiscal day already open');
    const dayNo = d.fiscalDayNo + 1;
    const res = await this.factory.getForEnvironment(d.environment).openDay({ dayNo });
    return this.prisma.$transaction(async (tx) => {
      await tx.fiscalIntegrationLog.create({ data: { deviceId: d.id, operation: 'openDay', status: 'OK', environment: d.environment, response: res } });
      await tx.fiscalDay.create({ data: { deviceId: d.id, dayNo, status: 'OPEN', openedAt: new Date() } });
      return tx.fiscalDevice.update({ where: { id: d.id }, data: { fiscalDayNo: dayNo, receiptCounter: 0, dayStatus: 'OPEN' } });
    });
  }

  private async allocate(deviceId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ fiscalDayNo: number; receiptCounter: number; globalReceiptNo: number }>>`UPDATE "FiscalDevice" SET "receiptCounter" = "receiptCounter" + 1, "globalReceiptNo" = "globalReceiptNo" + 1 WHERE id = ${deviceId} AND "dayStatus" = 'OPEN' RETURNING id, "fiscalDayNo", "receiptCounter", "globalReceiptNo"`;
    if (!rows[0]) throw new BadRequestException('Unable to allocate receipt sequence');
    return rows[0];
  }

  private async providerSubmit(payload: any, environment: string) {
    if (environment === 'MOCK' && this._simulateNextFailure) {
      this._simulateNextFailure = false;
      throw new Error('SIMULATED_PROVIDER_FAILURE: fiscal provider rejected the request (mock).');
    }
    return this.factory.getForEnvironment(environment).submitReceipt({ ...payload, receiptHash: payload.receiptHash });
  }

  private async submitAndLink(a: { deviceId: string; zimraDeviceId: string | null; environment: string; fiscalDayNo: number; receiptCounter: number; globalReceiptNo: number; receiptType: string; payload: any; receiptId: string; link: { invoiceId?: string; creditNoteId?: string; debitNoteId?: string } }) {
    try {
      const res = await this.providerSubmit(a.payload, a.environment);
      await this.prisma.$transaction(async (tx) => {
        await tx.fiscalReceipt.update({ where: { id: a.receiptId }, data: { status: 'FISCALISED', zimraReceiptId: res.receiptID, serverSignature: res.receiptServerSignature, rawResponse: res, submittedAt: new Date(), attemptCount: { increment: 1 }, lastAttemptAt: new Date() } });
        if (a.link.invoiceId) await tx.salesInvoice.update({ where: { id: a.link.invoiceId }, data: { fiscalStatus: 'FISCALISED' } });
        if (a.link.creditNoteId) await tx.creditNote.update({ where: { id: a.link.creditNoteId }, data: { fiscalStatus: 'FISCALISED' } });
        if (a.link.debitNoteId) await tx.debitNote.update({ where: { id: a.link.debitNoteId }, data: { fiscalStatus: 'FISCALISED' } });
        await tx.fiscalDay.update({ where: { deviceId_dayNo: { deviceId: a.deviceId, dayNo: a.fiscalDayNo } }, data: { receiptCount: { increment: 1 }, grossTotal: { increment: a.payload.total }, taxTotal: { increment: a.payload.tax } } });
        await tx.fiscalIntegrationLog.create({ data: { deviceId: a.deviceId, operation: 'submitReceipt', status: 'OK', environment: a.environment as any, request: a.payload, response: res } });
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
    await this.assertTaxMapped(companyId, deviceId, inv.lines);
    if (inv.fiscalReceipt) {
      // Authoritative: an accepted receipt means the document is FISCALISED, even if a
      // stale status field says READY. Reconcile rather than trusting the stale value.
      if (inv.fiscalReceipt.status === 'FISCALISED' && inv.fiscalStatus !== 'FISCALISED') {
        await this.prisma.salesInvoice.update({ where: { id: inv.id }, data: { fiscalStatus: 'FISCALISED' } });
      }
      return inv.fiscalReceipt;
    }
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d || d.dayStatus !== 'OPEN') throw new BadRequestException('Fiscal day is not open');
    const allocated = await this.allocate(deviceId);
    const payment = await this.derivePayment(companyId, inv);
    const payload = { deviceID: d.zimraDeviceId, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalInvoice', invoiceNo: inv.invoiceNo, currency: inv.currency, total: Number(inv.total), tax: Number(inv.taxTotal), paymentMethod: payment.method, payments: payment.payments, buyer: { name: inv.customer?.name, tin: inv.customer?.tin, vatNumber: inv.customer?.vatNumber, address: inv.billingAddress || inv.customer?.address1 }, lines: inv.lines.map((l) => ({ name: l.description, qty: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate), taxAmount: Number(l.taxAmount), total: Number(l.lineTotal), hsCode: l.hsCode })) };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const receipt = await this.prisma.fiscalReceipt.create({ data: { deviceId: d.id, environment: d.environment, invoiceId: inv.id, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptHash: hash, rawRequest: payload, status: 'PENDING', customerName: inv.customer?.name, paymentMethod: payment.method, total: Number(inv.total), tax: Number(inv.taxTotal), currency: inv.currency } });
    return this.submitAndLink({ deviceId: d.id, zimraDeviceId: d.zimraDeviceId, environment: d.environment, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalInvoice', payload: { ...payload, receiptHash: hash }, receiptId: receipt.id, link: { invoiceId: inv.id } });
  }

  async fiscaliseCreditNote(companyId: string, deviceId: string, creditNoteId: string) {
    const cn = await this.prisma.creditNote.findFirst({ where: { id: creditNoteId, companyId }, include: { lines: true, invoice: { include: { fiscalReceipt: true } }, fiscalReceipt: true, customer: true } });
    if (!cn) throw new BadRequestException('Credit note not found');
    if (cn.status === 'DRAFT') throw new BadRequestException('Post credit note before fiscalisation');
    if (cn.fiscalReceipt) {
      if (cn.fiscalReceipt.status === 'FISCALISED' && cn.fiscalStatus !== 'FISCALISED') {
        await this.prisma.creditNote.update({ where: { id: cn.id }, data: { fiscalStatus: 'FISCALISED' } });
      }
      return cn.fiscalReceipt;
    }
    await this.assertTaxMapped(companyId, deviceId, cn.lines);
    const original = cn.invoice?.fiscalReceipt;
    if (!cn.invoice || !original) throw new BadRequestException('Credit note must reference a fiscalised invoice');
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d || d.dayStatus !== 'OPEN') throw new BadRequestException('Fiscal day is not open');
    const allocated = await this.allocate(deviceId);
    const payload = { deviceID: d.zimraDeviceId, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalCreditNote', referenceReceipt: original.zimraReceiptId || original.globalReceiptNo, creditNoteNo: cn.creditNoteNo, currency: cn.invoice.currency, total: -Number(cn.total), tax: -Number(cn.taxTotal), buyer: { name: cn.customer?.name, tin: cn.customer?.tin, vatNumber: cn.customer?.vatNumber }, lines: cn.lines.map((l) => ({ name: l.description, qty: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate), taxAmount: -Number(l.taxAmount), total: -Number(l.lineTotal) })) };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const receipt = await this.prisma.fiscalReceipt.create({ data: { deviceId: d.id, environment: d.environment, creditNoteId: cn.id, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalCreditNote', receiptHash: hash, rawRequest: payload, status: 'PENDING', customerName: cn.customer?.name, paymentMethod: cn.invoice.currency ? 'CREDIT' : 'CASH', currency: cn.invoice.currency, total: -Number(cn.total), tax: -Number(cn.taxTotal) } });
    return this.submitAndLink({ deviceId: d.id, zimraDeviceId: d.zimraDeviceId, environment: d.environment, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalCreditNote', payload: { ...payload, receiptHash: hash }, receiptId: receipt.id, link: { creditNoteId: cn.id } });
  }

  async fiscaliseDebitNote(companyId: string, deviceId: string, debitNoteId: string) {
    const dn = await this.prisma.debitNote.findFirst({ where: { id: debitNoteId, companyId }, include: { lines: true, invoice: { include: { fiscalReceipt: true } }, fiscalReceipt: true, customer: true } });
    if (!dn) throw new BadRequestException('Debit note not found');
    if (dn.status === 'DRAFT') throw new BadRequestException('Post debit note before fiscalisation');
    if (dn.fiscalReceipt) {
      if (dn.fiscalReceipt.status === 'FISCALISED' && dn.fiscalStatus !== 'FISCALISED') {
        await this.prisma.debitNote.update({ where: { id: dn.id }, data: { fiscalStatus: 'FISCALISED' } });
      }
      return dn.fiscalReceipt;
    }
    await this.assertTaxMapped(companyId, deviceId, dn.lines);
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d || d.dayStatus !== 'OPEN') throw new BadRequestException('Fiscal day is not open');
    const allocated = await this.allocate(deviceId);
    const currency = dn.invoice?.currency || 'USD';
    const payload = { deviceID: d.zimraDeviceId, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalDebitNote', referenceReceipt: dn.invoice?.fiscalReceipt?.zimraReceiptId || dn.invoice?.fiscalReceipt?.globalReceiptNo, debitNoteNo: dn.debitNoteNo, currency, total: Number(dn.total), tax: Number(dn.taxTotal), buyer: { name: dn.customer?.name, tin: dn.customer?.tin, vatNumber: dn.customer?.vatNumber }, lines: dn.lines.map((l) => ({ name: l.description, qty: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate), taxAmount: Number(l.taxAmount), total: Number(l.lineTotal) })) };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const receipt = await this.prisma.fiscalReceipt.create({ data: { deviceId: d.id, environment: d.environment, debitNoteId: dn.id, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalDebitNote', receiptHash: hash, rawRequest: payload, status: 'PENDING', customerName: dn.customer?.name, paymentMethod: 'CREDIT', currency, total: Number(dn.total), tax: Number(dn.taxTotal) } });
    return this.submitAndLink({ deviceId: d.id, zimraDeviceId: d.zimraDeviceId, environment: d.environment, fiscalDayNo: allocated.fiscalDayNo, receiptCounter: allocated.receiptCounter, globalReceiptNo: allocated.globalReceiptNo, receiptType: 'FiscalDebitNote', payload: { ...payload, receiptHash: hash }, receiptId: receipt.id, link: { debitNoteId: dn.id } });
  }

  async retryFiscalReceipts(companyId: string) {
    const receipts = await this.prisma.fiscalReceipt.findMany({ where: { status: 'RETRY', OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] }, include: { device: true } });
    let done = 0;
    for (const r of receipts) {
      try {
        const res = await this.providerSubmit(r.rawRequest as any, r.device.environment);
        await this.prisma.$transaction(async (tx) => {
          await tx.fiscalReceipt.update({ where: { id: r.id }, data: { status: 'FISCALISED', zimraReceiptId: res.receiptID, serverSignature: res.receiptServerSignature, rawResponse: res, submittedAt: new Date(), lastError: null } });
          if (r.invoiceId) await tx.salesInvoice.update({ where: { id: r.invoiceId }, data: { fiscalStatus: 'FISCALISED' } });
          if (r.creditNoteId) await tx.creditNote.update({ where: { id: r.creditNoteId }, data: { fiscalStatus: 'FISCALISED' } });
          if (r.debitNoteId) await tx.debitNote.update({ where: { id: r.debitNoteId }, data: { fiscalStatus: 'FISCALISED' } });
          await tx.fiscalIntegrationLog.create({ data: { deviceId: r.deviceId, operation: 'retrySubmit', status: 'OK', environment: r.device.environment, request: r.rawRequest as any, response: res } });
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
    const res = await this.factory.getForEnvironment(d.environment).closeDay({ deviceId: d.zimraDeviceId, dayNo: d.fiscalDayNo, receiptCount: day?.receiptCount, grossTotal: Number(day?.grossTotal || 0), taxTotal: Number(day?.taxTotal || 0) });
    return this.prisma.$transaction(async (tx) => {
      await tx.fiscalDay.update({ where: { deviceId_dayNo: { deviceId: d.id, dayNo: d.fiscalDayNo } }, data: { status: 'CLOSED', closedAt: new Date() } });
      await tx.fiscalIntegrationLog.create({ data: { deviceId: d.id, operation: 'closeDay', status: 'OK', environment: d.environment, response: res } });
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

  // ---------- Tax mapping enforcement ----------
  private async assertTaxMapped(companyId: string, deviceId: string, lines: any[]) {
    const device = await this.prisma.fiscalDevice.findUnique({ where: { id: deviceId }, select: { environment: true } });
    if (!device || device.environment === 'MOCK') return; // mock mode does not require ZIMRA tax mappings
    const [rates, mappings] = await Promise.all([
      this.prisma.taxRate.findMany({ where: { companyId, active: true } }),
      this.prisma.fiscalTaxMapping.findMany({ where: { companyId, active: true } }),
    ]);
    const mappedCodes = new Set(mappings.filter((m) => m.fdmsTaxId).map((m) => m.erpTaxCode));
    const mappedRates = new Set(rates.filter((r) => mappedCodes.has(r.code)).map((r) => Number(r.rate)));
    const unmapped = [...new Set((lines || []).map((l) => Number(l.taxRate)))].filter((rate) => rate !== 0 && !mappedRates.has(rate));
    if (unmapped.length) {
      throw new BadRequestException(`Fiscalisation blocked: tax rate(s) ${unmapped.join('%, ')}% have no valid FDMS tax mapping. Configure tax mapping before submitting to ZIMRA.`);
    }
  }

  // ---------- Certificate lifecycle ----------
  async generateCsr(companyId: string, userId: string | undefined, deviceId: string) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } }, include: { branch: { include: { company: true } } } });
    if (!d) throw new BadRequestException('Device not found');
    const { privateKeyPem, csrPem } = this.certSvc.generateKeyAndCsr({
      commonName: d.serialNumber,
      organisation: d.branch.company.legalName,
      country: 'ZW',
      serialNumber: d.serialNumber,
    });
    const saved = await this.prisma.fiscalDevice.update({
      where: { id: d.id },
      data: { privateKeyEnc: encryptSecret(privateKeyPem), csrPem, certificatePem: null, certificateRef: null, certificateThumbprint: null, certificateExpiresAt: null, certificateIssuedAt: null, status: 'UNREGISTERED' },
    });
    await this.audit.log(companyId, userId, 'fiscal.certificate.csr', 'FiscalDevice', d.id, { module: 'fiscalisation' });
    return { deviceId: d.id, csrPem, hasPrivateKey: !!saved.privateKeyEnc };
  }

  async installCertificate(companyId: string, userId: string | undefined, deviceId: string, certificatePem: string) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d) throw new BadRequestException('Device not found');
    const privateKeyPem = decryptSecret(d.privateKeyEnc);
    if (!privateKeyPem) throw new BadRequestException('Generate a CSR and private key before installing a certificate.');
    const cert = this.certSvc.validateCertificate(certificatePem, privateKeyPem);
    const saved = await this.prisma.fiscalDevice.update({
      where: { id: d.id },
      data: { certificatePem: cert.certificatePem, certificateThumbprint: cert.certificateThumbprint, certificateExpiresAt: cert.certificateExpiresAt, certificateIssuedAt: cert.certificateIssuedAt, certificateRef: cert.certificateThumbprint.slice(0, 16), status: 'ACTIVE', registeredAt: d.registeredAt || new Date() },
    });
    await this.audit.log(companyId, userId, 'fiscal.certificate.install', 'FiscalDevice', d.id, { module: 'fiscalisation', metadata: { thumbprint: cert.certificateThumbprint } });
    return this.sanitizeDevice(saved);
  }

  async reissueCertificate(companyId: string, userId: string | undefined, deviceId: string) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d) throw new BadRequestException('Device not found');
    const [unresolved] = await Promise.all([
      this.prisma.fiscalReceipt.count({ where: { deviceId: d.id, status: { in: ['PENDING', 'RETRY'] } } }),
    ]);
    if (unresolved) throw new BadRequestException('Resolve pending fiscal receipts before reissuing the device certificate.');
    const saved = await this.prisma.fiscalDevice.update({ where: { id: d.id }, data: { certificateRenewedAt: new Date() } });
    await this.audit.log(companyId, userId, 'fiscal.certificate.reissue', 'FiscalDevice', d.id, { module: 'fiscalisation' });
    return this.generateCsr(companyId, userId, saved.id);
  }

  // ---------- Product / service classification ----------
  async classification(companyId: string) {
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId, active: true }, select: { id: true, sku: true, name: true, hsCode: true, salesTaxCode: true }, take: 1000 });
    const missingHs = items.filter((i) => !i.hsCode);
    const missingTax = items.filter((i) => !i.salesTaxCode);
    return {
      total: items.length,
      missingHsCode: missingHs.length,
      missingTaxCode: missingTax.length,
      compliant: items.length - missingHs.length,
      items: missingHs.slice(0, 100).map((i) => ({ id: i.id, sku: i.sku, name: i.name, hsCode: i.hsCode, salesTaxCode: i.salesTaxCode })),
    };
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
  async reports(companyId: string, q: { startDate?: string; endDate?: string; from?: string; to?: string; receiptType?: string; paymentMethod?: string; currency?: string; status?: string; fiscalDayNo?: string; deviceId?: string; branchId?: string; environment?: string }) {
    const now = new Date();
    const startRaw = q.startDate || q.from;
    const endRaw = q.endDate || q.to;
    const from = startRaw ? new Date(startRaw) : new Date(now.getFullYear(), now.getMonth(), 1);
    if (isNaN(from.getTime())) throw new BadRequestException('Invalid start date');
    const to = endRaw ? new Date(endRaw) : new Date(now);
    if (isNaN(to.getTime())) throw new BadRequestException('Invalid end date');
    if (!endRaw || !String(endRaw).includes('T')) to.setHours(23, 59, 59, 999); // inclusive end-of-day for date-only input
    if (to.getTime() < from.getTime()) throw new BadRequestException('End date cannot be before start date.');

    const profile = await this.prisma.fiscalisationProfile.findUnique({ where: { companyId } });
    const environment = String(q.environment || profile?.environment || 'MOCK').toUpperCase();

    const where: any = { ...this.receiptWhere(companyId), createdAt: { gte: from, lte: to }, environment };
    if (q.receiptType) where.receiptType = q.receiptType;
    if (q.currency) where.currency = q.currency;
    if (q.status) where.status = q.status;
    if (q.paymentMethod) where.paymentMethod = q.paymentMethod;
    if (q.fiscalDayNo) where.fiscalDayNo = Number(q.fiscalDayNo);
    if (q.deviceId) where.deviceId = q.deviceId;
    if (q.branchId) where.device = { branchId: q.branchId };

    const receipts = await this.prisma.fiscalReceipt.findMany({ where, include: { invoice: true, creditNote: true, debitNote: true, device: { include: { branch: true } } }, orderBy: { createdAt: 'desc' } });
    const totals = { receipts: receipts.length, gross: round2(receipts.reduce((s, r) => s + Number(r.total || 0), 0)), vat: round2(receipts.reduce((s, r) => s + Number(r.tax || 0), 0)) };
    const byType = this.distribute(receipts, (r) => r.receiptType);
    const byPayment = this.distribute(receipts, (r) => r.paymentMethod || 'CASH');
    const byDevice = this.distribute(receipts, (r) => r.device?.name || 'Unknown device');
    const byCurrency = receipts.reduce((acc, r) => { const c = r.currency || 'USD'; const e = acc[c] || (acc[c] = { currency: c, receipts: 0, gross: 0, vat: 0 }); e.receipts++; e.gross += Number(r.total || 0); e.vat += Number(r.tax || 0); return acc; }, {} as Record<string, any>);
    return {
      from, to, environment,
      totals, receipts, byType, byPayment, byDevice,
      byCurrency: Object.values(byCurrency).map((c) => ({ ...c, gross: round2(c.gross), vat: round2(c.vat) })),
    };
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

  // ================= Setup wizard, profile & credentials =================

  private async ensureProfile(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new BadRequestException('Company not found');
    return this.prisma.fiscalisationProfile.upsert({
      where: { companyId },
      update: {},
      create: {
        companyId,
        taxpayerName: company.legalName,
        softwareName: 'NexusERP',
        integratorName: process.env.FISCAL_INTEGRATOR_NAME || null,
        deviceModelName: process.env.FISCAL_DEVICE_MODEL || null,
        deviceModelVersion: process.env.FISCAL_DEVICE_MODEL_VERSION || null,
      },
    });
  }

  async profile(companyId: string) {
    const p = await this.ensureProfile(companyId);
    const devices = await this.prisma.fiscalDevice.findMany({ where: { branch: { companyId } } });
    const active = devices.find((d) => d.environment === p.environment) || devices[0] || null;
    return {
      ...p,
      activationKeyMasked: maskSecret(active?.activationKeyEnc),
      hasActivationKey: hasSecret(active?.activationKeyEnc),
      integrator: { name: p.integratorName, softwareName: p.softwareName, modelName: p.deviceModelName, modelVersion: p.deviceModelVersion },
    };
  }

  async saveProfile(companyId: string, userId: string | undefined, data: any) {
    await this.ensureProfile(companyId);
    const allowed = ['taxpayerName', 'vatRegistered', 'taxpayerEmail', 'integratorName', 'softwareName', 'deviceModelName', 'deviceModelVersion', 'technicalContactName', 'technicalContactEmail', 'technicalContactPhone', 'businessAddress', 'softwareDescription', 'integrationArchitecture', 'testRegistrationRef', 'productionApprovalRef', 'productionApprovalEvidence', 'setupStep', 'setupDraft'];
    const patch: any = {};
    for (const k of allowed) if (data[k] !== undefined) patch[k] = data[k];
    if (data.productionApprovalDate !== undefined) patch.productionApprovalDate = data.productionApprovalDate ? new Date(data.productionApprovalDate) : null;
    const saved = await this.prisma.fiscalisationProfile.update({ where: { companyId }, data: patch });
    await this.audit.log(companyId, userId, 'fiscal.profile.update', 'FiscalisationProfile', saved.id, { module: 'fiscalisation', metadata: { fields: Object.keys(patch) } });
    return this.profile(companyId);
  }

  async saveCompanyDetails(companyId: string, userId: string | undefined, data: any) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new BadRequestException('Company not found');
    const legalName = data.legalName != null ? String(data.legalName).trim() : company.legalName;
    if (!legalName) throw new BadRequestException('Registered name is required');
    const saved = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        legalName,
        tin: data.tin != null ? (String(data.tin).trim() || null) : company.tin,
        vatNumber: data.vatNumber != null ? (String(data.vatNumber).trim() || null) : company.vatNumber,
      },
    });
    await this.audit.log(companyId, userId, 'fiscal.company.update', 'Company', companyId, { module: 'fiscalisation', metadata: { fields: ['legalName', 'tin', 'vatNumber'] } });
    return { id: saved.id, name: saved.legalName, tin: saved.tin, vatNumber: saved.vatNumber, baseCurrency: saved.baseCurrency };
  }

  async createDevice(companyId: string, userId: string | undefined, data: any) {
    const branch = await this.prisma.branch.findFirst({ where: { id: data.branchId, companyId } });
    if (!branch) throw new BadRequestException('Branch not found');
    if (!data.serialNumber) throw new BadRequestException('Device serial number is required');
    const profile = await this.ensureProfile(companyId);
    const saved = await this.prisma.fiscalDevice.create({
      data: {
        branchId: branch.id,
        name: data.name || data.serialNumber,
        serialNumber: data.serialNumber,
        modelName: data.modelName ?? profile.deviceModelName,
        modelVersion: data.modelVersion ?? profile.deviceModelVersion,
        integratorName: data.integratorName ?? profile.integratorName,
        posLocation: data.posLocation,
        environment: (data.environment || 'MOCK') as any,
        activationKeyEnc: data.activationKey ? encryptSecret(data.activationKey) : null,
        zimraDeviceId: data.zimraDeviceId || null,
      },
    });
    await this.audit.log(companyId, userId, 'fiscal.device.create', 'FiscalDevice', saved.id, { module: 'fiscalisation', metadata: { serialNumber: saved.serialNumber, environment: saved.environment } });
    return this.sanitizeDevice(saved);
  }

  async saveDevice(companyId: string, userId: string | undefined, deviceId: string, data: any) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d) throw new BadRequestException('Device not found');
    const allowed = ['name', 'serialNumber', 'modelName', 'modelVersion', 'integratorName', 'posLocation', 'zimraDeviceId', 'certificateRef', 'certificateThumbprint', 'environment'];
    const patch: any = {};
    for (const k of allowed) if (data[k] !== undefined) patch[k] = data[k];
    if (data.certificateExpiresAt !== undefined) patch.certificateExpiresAt = data.certificateExpiresAt ? new Date(data.certificateExpiresAt) : null;
    if (data.activationKey) patch.activationKeyEnc = encryptSecret(data.activationKey);
    const saved = await this.prisma.fiscalDevice.update({ where: { id: deviceId }, data: patch });
    await this.audit.log(companyId, userId, 'fiscal.device.update', 'FiscalDevice', deviceId, { module: 'fiscalisation', metadata: { fields: Object.keys(patch), environment: saved.environment } });
    return this.sanitizeDevice(saved);
  }

  // ================= Branch registration (linked to Branch master) =================

  async branches(companyId: string) {
    return this.prisma.branch.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  async saveBranch(companyId: string, userId: string | undefined, branchId: string, data: any) {
    const b = await this.prisma.branch.findFirst({ where: { id: branchId, companyId } });
    if (!b) throw new BadRequestException('Branch not found');
    const allowed = ['name', 'phone', 'email', 'address', 'street', 'houseNumber', 'suburb', 'city', 'province', 'zimraRegion', 'zimraStation'];
    const patch: any = {};
    for (const k of allowed) if (data[k] !== undefined) patch[k] = data[k];
    const saved = await this.prisma.branch.update({ where: { id: branchId }, data: patch });
    await this.audit.log(companyId, userId, 'fiscal.branch.update', 'Branch', branchId, { module: 'fiscalisation', metadata: { fields: Object.keys(patch) } });
    return saved;
  }

  async verifyTaxpayer(companyId: string, userId: string | undefined, environment = 'MOCK') {    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new BadRequestException('Company not found');
    if (!company.tin) throw new BadRequestException('Company TIN is required before verification.');
    const res = await this.factory.getForEnvironment(environment).verifyTaxpayer({ tin: company.tin, vatNumber: company.vatNumber });
    const returnedName = res?.taxpayerName || null;
    const mismatch = !!returnedName && !!company.legalName && returnedName.trim().toLowerCase() !== company.legalName.trim().toLowerCase();
    await this.ensureProfile(companyId);
    const saved = await this.prisma.fiscalisationProfile.update({ where: { companyId }, data: { taxpayerVerified: !!res?.valid, verifiedTaxpayerName: returnedName, verifiedTin: res?.tin || company.tin, verifiedAt: new Date() } });
    await this.audit.log(companyId, userId, 'fiscal.taxpayer.verify', 'FiscalisationProfile', saved.id, { module: 'fiscalisation', result: mismatch ? 'MISMATCH' : 'OK', metadata: { environment, returnedName } });
    return { ...res, mismatch, companyName: company.legalName, verifiedAt: saved.verifiedAt };
  }

  // ================= Tax mapping =================

  async taxMappings(companyId: string) {
    const [rates, mappings] = await Promise.all([
      this.prisma.taxRate.findMany({ where: { companyId, active: true }, orderBy: { code: 'asc' } }),
      this.prisma.fiscalTaxMapping.findMany({ where: { companyId }, orderBy: { erpTaxCode: 'asc' } }),
    ]);
    const byCode = new Map(mappings.map((m) => [m.erpTaxCode, m]));
    return rates.map((r) => {
      const m = byCode.get(r.code);
      return {
        id: m?.id, erpTaxCode: r.code, erpTaxName: r.name, erpRate: Number(r.rate), erpTreatment: m?.erpTreatment ?? r.treatment,
        fdmsTaxId: m?.fdmsTaxId ?? null, fdmsTaxName: m?.fdmsTaxName ?? null, fdmsTaxRate: m?.fdmsTaxRate != null ? Number(m.fdmsTaxRate) : null,
        validFrom: m?.validFrom, validTo: m?.validTo, active: m?.active ?? true, mapped: !!m?.fdmsTaxId,
      };
    });
  }

  async saveTaxMapping(companyId: string, userId: string | undefined, data: any) {
    if (!data.erpTaxCode) throw new BadRequestException('ERP tax code is required');
    const rate = data.fdmsTaxRate != null && data.fdmsTaxRate !== '' ? Number(data.fdmsTaxRate) : null;
    const saved = await this.prisma.fiscalTaxMapping.upsert({
      where: { companyId_erpTaxCode: { companyId, erpTaxCode: data.erpTaxCode } },
      update: { erpTreatment: data.erpTreatment, fdmsTaxId: data.fdmsTaxId, fdmsTaxName: data.fdmsTaxName, fdmsTaxRate: rate, validFrom: data.validFrom ? new Date(data.validFrom) : null, validTo: data.validTo ? new Date(data.validTo) : null, active: data.active ?? true },
      create: { companyId, erpTaxCode: data.erpTaxCode, erpTreatment: data.erpTreatment, fdmsTaxId: data.fdmsTaxId, fdmsTaxName: data.fdmsTaxName, fdmsTaxRate: rate, validFrom: data.validFrom ? new Date(data.validFrom) : null, validTo: data.validTo ? new Date(data.validTo) : null, active: data.active ?? true },
    });
    await this.audit.log(companyId, userId, 'fiscal.taxmapping.save', 'FiscalTaxMapping', saved.id, { module: 'fiscalisation' });
    return saved;
  }

  // ================= ZIMRA registration assistance & evidence =================

  async requests(companyId: string) {
    return this.prisma.fiscalRegistrationRequest.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }

  async saveRequest(companyId: string, userId: string | undefined, id: string | undefined, data: any) {
    if (id) {
      const existing = await this.prisma.fiscalRegistrationRequest.findFirst({ where: { id, companyId } });
      if (!existing) throw new BadRequestException('Request not found');
    }
    const patch: any = {};
    for (const k of ['assistance', 'status', 'referenceNumber', 'requestedBy', 'zimraContact', 'responseNotes', 'approvalReference', 'subject', 'body', 'deviceId']) if (data[k] !== undefined) patch[k] = data[k];
    for (const k of ['requestDate', 'responseDate']) if (data[k] !== undefined) patch[k] = data[k] ? new Date(data[k]) : null;
    if (data.attachments !== undefined) patch.attachments = data.attachments;
    const saved = id
      ? await this.prisma.fiscalRegistrationRequest.update({ where: { id }, data: patch })
      : await this.prisma.fiscalRegistrationRequest.create({ data: { companyId, assistance: data.assistance || 'OTHER', ...patch } });
    await this.audit.log(companyId, userId, 'fiscal.request.save', 'FiscalRegistrationRequest', saved.id, { module: 'fiscalisation', metadata: { status: saved.status } });
    return saved;
  }

  async buildRequestEmail(companyId: string, input: { assistance?: string; deviceId?: string } = {}) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new BadRequestException('Company not found');
    const profile = await this.prisma.fiscalisationProfile.findUnique({ where: { companyId } });
    const devices = await this.prisma.fiscalDevice.findMany({ where: { branch: { companyId } }, include: { branch: true } });
    const device = devices.find((d) => d.id === input.deviceId) || devices[0] || null;
    const branch = device?.branch || null;
    const assistance = input.assistance || 'New fiscal-device registration';
    const v = (x: any) => (x === null || x === undefined || x === '' ? '[MISSING]' : x);
    const missing: string[] = [];
    const line = (label: string, value: any) => { if (value === null || value === undefined || value === '') missing.push(label); return `${label}: ${v(value)}`; };
    const subject = `ZIMRA FDMS Virtual Fiscalisation Registration — ${profile?.softwareName || 'NexusERP'} / ${company.legalName}`;
    const body = [
      'Dear ZIMRA FDMS Support,',
      '',
      "We are preparing the registration and integration of the following taxpayer's accounting system with the ZIMRA Fiscalisation Data Management System.",
      '',
      'Request Type: ' + assistance,
      '',
      'Taxpayer Details:',
      line('Registered Name', company.legalName),
      line('TIN', company.tin),
      line('VAT Number', company.vatNumber),
      line('Taxpayer Email', profile?.taxpayerEmail),
      '',
      'Branch Details:',
      line('Trade Name', branch?.name),
      line('Physical Address', branch ? [branch.address, branch.street, branch.city].filter(Boolean).join(', ') : null),
      line('Contact Number', branch?.phone),
      line('Branch Email', branch?.email),
      '',
      'Fiscal Device Details:',
      line('Device Serial Number', device?.serialNumber),
      line('Device Model', device?.modelName),
      line('Integrator', device?.integratorName || profile?.integratorName),
      '',
      'Software Details:',
      'Software Name: ' + (profile?.softwareName || 'NexusERP'),
      'Integration Type: Virtual Fiscal Device / Direct FDMS API',
      line('Technical Contact', profile?.technicalContactName),
      line('Technical Email', profile?.technicalContactEmail),
      '',
      'We would appreciate your assistance with the registration requirements and confirmation of the process for obtaining the device credentials and completing the required testing and production onboarding.',
      '',
      'Kind regards,',
      profile?.technicalContactName || '[Authorised Contact]',
    ].join('\n');
    return { subject, body, assistance, missing, deviceId: device?.id || null };
  }

  // ================= Environment management & readiness =================

  async readiness(companyId: string, target: 'MOCK' | 'SANDBOX' | 'PRODUCTION' = 'PRODUCTION') {
    return this.readinessSvc.evaluate(companyId, target);
  }

  async switchEnvironment(companyId: string, userId: string | undefined, target: string, reason: string) {
    const env = (target || '').toUpperCase();
    if (!['MOCK', 'SANDBOX', 'PRODUCTION'].includes(env)) throw new BadRequestException('Invalid fiscal environment');
    const profile = await this.ensureProfile(companyId);
    const current = profile.environment;
    if (env === current) return this.profile(companyId);

    const readiness = await this.readinessSvc.evaluate(companyId, env as any);
    if (env === 'PRODUCTION' && !readiness?.ready) {
      throw new BadRequestException({ statusCode: 400, error: 'PRODUCTION_SETUP_INCOMPLETE', message: 'Production setup incomplete. Resolve the blocking requirements before activating production.', blockers: readiness?.blockers || [], readiness });
    }
    if (current === 'PRODUCTION') {
      const [unresolved, openDays] = await Promise.all([
        this.prisma.fiscalReceipt.count({ where: { device: { branch: { companyId } }, environment: 'PRODUCTION', status: { in: ['RETRY', 'REJECTED', 'PENDING'] } } }),
        this.prisma.fiscalDay.count({ where: { device: { branch: { companyId }, environment: 'PRODUCTION' }, status: 'OPEN' } }),
      ]);
      if (unresolved || openDays) {
        throw new BadRequestException(`Cannot change environment: ${unresolved} unresolved production receipt(s) and ${openDays} open fiscal day(s). Close the fiscal day and reconcile receipts first.`);
      }
      if (!reason) throw new BadRequestException('A reason is required to change an active production connection.');
    }
    const saved = await this.prisma.fiscalisationProfile.update({ where: { companyId }, data: { environment: env as any } });
    await this.audit.log(companyId, userId, 'fiscal.environment.switch', 'FiscalisationProfile', saved.id, { module: 'fiscalisation', reason, metadata: { from: current, to: env } });
    return this.profile(companyId);
  }

  async activateProduction(companyId: string, userId: string | undefined, body: { confirm?: boolean; reason?: string }) {
    const profile = await this.ensureProfile(companyId);
    const { result, allowed, blockers } = await this.readinessSvc.assertProductionActivatable(companyId);
    if (!allowed) {
      throw new BadRequestException({ statusCode: 400, error: 'PRODUCTION_SETUP_INCOMPLETE', message: 'Production setup incomplete. Resolve the blocking requirements before activating production.', blockers, readiness: result });
    }
    if (!body?.confirm) throw new BadRequestException('Explicit administrator confirmation is required to activate production.');
    const previous = profile.environment;
    const saved = await this.prisma.fiscalisationProfile.update({ where: { companyId }, data: { environment: 'PRODUCTION' } });
    await this.audit.log(companyId, userId, 'fiscal.production.activate', 'FiscalisationProfile', saved.id, {
      module: 'fiscalisation', reason: body?.reason,
      metadata: { activatedBy: userId, activatedAt: new Date().toISOString(), previousEnvironment: previous, newEnvironment: 'PRODUCTION', approvalReference: profile.productionApprovalRef, readiness: result?.status },
    });
    return { ok: true, environment: 'PRODUCTION', readiness: result };
  }

  async syncConfig(companyId: string, userId: string | undefined, deviceId: string) {
    const d = await this.prisma.fiscalDevice.findFirst({ where: { id: deviceId, branch: { companyId } } });
    if (!d) throw new BadRequestException('Device not found');
    const res = await this.factory.getForEnvironment(d.environment).getConfig({ deviceId: d.zimraDeviceId });
    await this.prisma.fiscalIntegrationLog.create({ data: { deviceId: d.id, operation: 'getConfig', status: 'OK', environment: d.environment, response: res } });
    await this.audit.log(companyId, userId, 'fiscal.config.sync', 'FiscalDevice', d.id, { module: 'fiscalisation' });
    return res;
  }

  async integrationLogs(companyId: string, q: { environment?: string; operation?: string } = {}) {
    const where: any = { device: { branch: { companyId } } };
    if (q.environment) where.environment = q.environment;
    if (q.operation) where.operation = q.operation;
    return this.prisma.fiscalIntegrationLog.findMany({ where, include: { device: { include: { branch: true } } }, orderBy: { createdAt: 'desc' }, take: 300 });
  }

  /**
   * Safe reconciliation: any document with an ACCEPTED fiscal receipt must read FISCALISED.
   * Only touches documents with verifiable acceptance evidence; never marks unaccepted
   * receipts as fiscalised, and never creates receipts.
   */
  async reconcileFiscalStatuses(companyId: string) {
    const receipts = await this.prisma.fiscalReceipt.findMany({
      where: { status: 'FISCALISED', OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] },
      select: { invoiceId: true, creditNoteId: true, debitNoteId: true },
    });
    const invIds = receipts.map((r) => r.invoiceId).filter(Boolean) as string[];
    const cnIds = receipts.map((r) => r.creditNoteId).filter(Boolean) as string[];
    const dnIds = receipts.map((r) => r.debitNoteId).filter(Boolean) as string[];
    const [i, c, d] = await Promise.all([
      invIds.length ? this.prisma.salesInvoice.updateMany({ where: { id: { in: invIds }, companyId, fiscalStatus: { not: 'FISCALISED' } }, data: { fiscalStatus: 'FISCALISED' } }) : Promise.resolve({ count: 0 }),
      cnIds.length ? this.prisma.creditNote.updateMany({ where: { id: { in: cnIds }, companyId, fiscalStatus: { not: 'FISCALISED' } }, data: { fiscalStatus: 'FISCALISED' } }) : Promise.resolve({ count: 0 }),
      dnIds.length ? this.prisma.debitNote.updateMany({ where: { id: { in: dnIds }, companyId, fiscalStatus: { not: 'FISCALISED' } }, data: { fiscalStatus: 'FISCALISED' } }) : Promise.resolve({ count: 0 }),
    ]);
    await this.audit.log(companyId, undefined, 'fiscal.reconcile', 'FiscalReceipt', undefined, { module: 'fiscalisation', metadata: { invoices: i.count, creditNotes: c.count, debitNotes: d.count } });
    return { invoices: i.count, creditNotes: c.count, debitNotes: d.count };
  }
}

