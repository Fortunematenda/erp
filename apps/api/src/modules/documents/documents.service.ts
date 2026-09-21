import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { DocumentTemplateService } from '../document-templates/document-template.service';
import { InvoiceStatusService } from '../finance/invoice-status.service';

function addr(p: any): string {
  if (!p) return '';
  return [p.address1, p.address2, p.city, p.state, p.zip, p.country].filter(Boolean).join(', ');
}
function money(n: any) { return Number(n || 0); }

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService, private tpl: DocumentTemplateService) {}

  async build(companyId: string, type: string, id: string): Promise<any> {
    const base = await this.switch(companyId, type, id);
    const docType = type === 'quote' || type === 'quotation' ? 'QUOTE' : 'INVOICE';
    const template = await this.tpl.getFor(companyId, docType);
    return this.enrich(companyId, type, base, template, id);
  }

  private async switch(companyId: string, type: string, id: string): Promise<any> {
    switch (type) {
      case 'invoice': return this.salesDoc(companyId, 'salesInvoice', id, 'Invoice', 'invoiceNo', 'invoiceDate', 'dueDate');
      case 'quote':
      case 'quotation': return this.salesDoc(companyId, 'quotation', id, 'Quotation', 'quotationNo', 'quotationDate', 'validUntil');
      case 'sales-order': return this.salesDoc(companyId, 'salesOrder', id, 'Sales Order', 'orderNo', 'orderDate', 'expectedDate');
      case 'delivery': return this.salesDoc(companyId, 'deliveryNote', id, 'Delivery Note', 'deliveryNo', 'date');
      case 'receipt': return this.receiptDoc(companyId, id);
      case 'credit-note': return this.salesDoc(companyId, 'creditNote', id, 'Credit Note', 'creditNoteNo', 'creditNoteDate');
      case 'debit-note': return this.salesDoc(companyId, 'debitNote', id, 'Debit Note', 'debitNoteNo', 'date');
      case 'supplier-invoice': return this.purchaseDoc(companyId, 'supplierInvoice', id, 'Supplier Invoice', 'invoiceNo', 'invoiceDate');
      case 'purchase-order': return this.purchaseDoc(companyId, 'purchaseOrder', id, 'Purchase Order', 'orderNo', 'orderDate');
      case 'payslip': return this.payslip(companyId, id);
      case 'statement': return this.statement(companyId, id);
      default: throw new BadRequestException('Unsupported document type ' + type);
    }
  }

  private async enrich(companyId: string, type: string, base: any, template: any, id: string) {
    const prefs = await this.loadPrefs(companyId);
    // Letterhead: template logo first, then company prefs logo. Always expose pdfHeader on template for PDF/preview.
    const mergedTpl = {
      ...template,
      logoUrl: template?.logoUrl || prefs.logo || null,
      pdfHeader: prefs.pdfHeader || template?.pdfHeader || null,
      pdfFooter: prefs.pdfFooter || template?.footerMessage || null,
    };
    const company = {
      ...(base.company || {}),
      name: base.company?.name || prefs.companyName || '',
      address: base.company?.address || prefs.address || '',
      phone: base.company?.phone || prefs.phone || '',
      email: base.company?.email || prefs.email || '',
      website: base.company?.website || '',
    };
    const out = { ...base, company, template: mergedTpl, discount: 0 };
    if (type === 'invoice') {
      const inv: any = await this.prisma.salesInvoice.findFirst({ where: { id, companyId }, include: { fiscalReceipt: true, project: true, branch: true } });
      if (inv) {
        // Prefer stored balances (updated by InvoiceStatusService.recalc from PaymentAllocation).
        // Do not sum Receipt.amount via invoiceId — modern receipts link through allocations only.
        const amountPaid = money(inv.amountPaid);
        const creditsApplied = money(inv.creditsApplied);
        const total = money(inv.total);
        const balanceDue = inv.balanceDue != null
          ? money(inv.balanceDue)
          : Math.max(0, total - amountPaid - creditsApplied);
        out.paid = amountPaid;
        out.balance = balanceDue;
        out.discount = 0;
        out.project = inv.project?.name; out.branch = inv.branch?.name;
        const livePay = InvoiceStatusService.resolvePaymentStatus({
          invoiceStatus: inv.invoiceStatus,
          dueDate: inv.dueDate,
          total,
          amountPaid,
          creditsApplied,
        });
        const stampPayStatus = livePay.status || inv.paymentStatus;
        const resolved = InvoiceStatusService.resolveDocumentStamp({ invoiceStatus: inv.invoiceStatus, paymentStatus: stampPayStatus });
        const STAMP_COLORS: Record<string, string> = {
          DRAFT: '#64748b',
          UNPAID: '#f59e0b',
          'PART PAID': '#0284c7',
          PAID: '#16a34a',
          OVERDUE: '#dc2626',
          VOID: '#b91c1c',
        };
        out.invoiceStatus = inv.invoiceStatus || 'DRAFT';
        out.paymentStatus = stampPayStatus;
        out.fiscalStatus = inv.fiscalStatus;
        out.displayStatus = resolved; out.displayStatusLabel = resolved; out.displayStatusColor = STAMP_COLORS[resolved] || '#f59e0b';
        out.fiscalInfo = inv.fiscalReceipt ? {
          receiptId: inv.fiscalReceipt.zimraReceiptId, receiptType: inv.fiscalReceipt.receiptType,
          dayNo: inv.fiscalReceipt.fiscalDayNo, deviceId: inv.fiscalReceipt.deviceId,
          date: inv.fiscalReceipt.submittedAt, status: inv.fiscalReceipt.status,
          globalReceiptNo: inv.fiscalReceipt.globalReceiptNo,
        } : null;
        out.isFiscalised = inv.fiscalReceipt?.status === 'FISCALISED';
      }
    }
    return out;
  }

  /** Company letterhead prefs (logo, pdfHeader, contact) for printed PDFs. */
  private async loadPrefs(companyId: string): Promise<Record<string, any>> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { companyId, key: { in: ['pref.logo', 'pref.pdfHeader', 'pref.pdfFooter', 'pref.companyName', 'pref.email', 'pref.phone', 'pref.address'] } },
    });
    const out: Record<string, any> = {};
    for (const r of rows) out[r.key.replace('pref.', '')] = (r.value as any)?.value ?? r.value;
    return out;
  }

  private async companyInfo(companyId: string) {
    const c = await this.prisma.company.findUnique({ where: { id: companyId } });
    const branch = await this.prisma.branch.findFirst({ where: { companyId }, orderBy: { name: 'asc' } });
    return {
      name: c?.tradingName || c?.legalName || '',
      code: c?.code,
      tin: c?.tin,
      vatNumber: c?.vatNumber,
      address: branch ? [branch.address, branch.city].filter(Boolean).join(', ') : '',
      phone: branch?.phone || '',
      email: branch?.email || '',
      website: '',
    };
  }

  private async salesDoc(companyId: string, model: string, id: string, title: string, noField: string, dateField: string, dueField?: string) {
    const full: any = await (this.prisma as any)[model].findFirst({
      where: { id, companyId },
      include: { lines: true, customer: true, ...(model === 'salesInvoice' ? { company: true, branch: true } : {}) },
    });
    if (!full) throw new NotFoundException('Document not found');
    const company = model === 'salesInvoice'
      ? {
          name: full.company?.tradingName || full.company?.legalName || '',
          tin: full.company?.tin,
          vatNumber: full.company?.vatNumber,
          address: full.branch?.address || [full.branch?.city].filter(Boolean).join(', '),
          phone: full.branch?.phone || '',
          email: full.branch?.email || '',
          website: '',
        }
      : await this.companyInfo(companyId);
    const party = full.customer ? { name: full.customer.name, address: addr(full.customer), email: full.customer.email, phone: full.customer.phone } : null;
    const itemIds = (full.lines || []).map((l: any) => l.itemId).filter(Boolean);
    const items = itemIds.length ? await this.prisma.inventoryItem.findMany({ where: { id: { in: itemIds }, companyId } }) : [];
    const skuOf = new Map(items.map((i) => [i.id, i.sku]));
    const lines = (full.lines || []).map((l: any) => {
      const sku = l.itemId ? skuOf.get(l.itemId) : undefined;
      const raw = String(l.description || '').trim();
      // Keep SKU and description separate — template preview / PDF columns render them independently.
      return {
        sku: sku || '',
        code: sku || '',
        desc: raw || (sku ? String(sku) : ''),
        qty: money(l.quantity),
        unit: money(l.unitPrice),
        rate: money(l.unitPrice),
        discount: money(l.discount),
        tax: money(l.taxRate),
        taxAmt: money(l.taxAmount),
        total: money(l.lineTotal),
        hsCode: l.hsCode,
      };
    });
    const validUntil = model === 'quotation' ? full.validUntil : (dueField ? full[dueField] : null);
    return {
      kind: model === 'quotation' ? 'quote' : model === 'salesOrder' ? 'order' : model === 'deliveryNote' ? 'delivery' : 'invoice',
      title, number: full[noField], date: full[dateField], dueDate: dueField ? full[dueField] : null, validUntil,
      currency: full.currency || 'USD', status: full.status, company, party, lines,
      paymentTerms: full.terms || full.customer?.paymentTerms || null,
      subtotal: money(full.subtotal), taxTotal: money(full.taxTotal), total: money(full.total),
      notes: full.notes || null, statementMemo: full.statementMemo || null,
    };
  }

  private async receiptDoc(companyId: string, id: string) {
    const full: any = await this.prisma.receipt.findFirst({ where: { id, companyId }, include: { customer: true, allocations: { include: { invoice: true } } } });
    if (!full) throw new NotFoundException('Document not found');
    const company = await this.companyInfo(full.companyId);
    const party = full.customer ? { name: full.customer.name, address: addr(full.customer), email: full.customer.email, phone: full.customer.phone } : null;
    const rows = (full.allocations || []).map((a: any) => ({ desc: a.invoice?.invoiceNo || 'Invoice', qty: 1, unit: Number(a.amountApplied), total: Number(a.amountApplied) }));
    if (Number(full.unapplied) > 0.001) rows.push({ desc: 'Unapplied credit', qty: 1, unit: Number(full.unapplied), total: Number(full.unapplied) });
    return { kind: 'receipt', title: 'Receipt', number: full.receiptNo, date: full.receiptDate, dueDate: null, currency: 'USD', status: full.status, company, party, lines: rows, subtotal: Number(full.amount), taxTotal: 0, total: Number(full.amount), notes: full.note || null };
  }

  private async purchaseDoc(companyId: string, model: string, id: string, title: string, noField: string, dateField: string) {
    const full: any = await (this.prisma as any)[model].findFirst({ where: { id, companyId }, include: { lines: true, supplier: true } });
    if (!full) throw new NotFoundException('Document not found');
    const company = await this.companyInfo(companyId);
    const party = full.supplier ? { name: full.supplier.name || full.supplier.companyName, address: addr(full.supplier), email: full.supplier.email, phone: full.supplier.phone } : null;
    const lines = (full.lines || []).map((l: any) => ({ desc: l.description, qty: money(l.quantity), unit: money(l.unitPrice), tax: money(l.taxRate), taxAmt: money(l.taxAmount), total: money(l.lineTotal) }));
    return { kind: 'purchase', title, number: full[noField], date: full[dateField], dueDate: full.dueDate || null, currency: full.currency || 'USD', status: full.status, company, party, lines, subtotal: money(full.subtotal), taxTotal: money(full.taxTotal), total: money(full.total), notes: full.notes || null };
  }

  private async payslip(companyId: string, id: string) {
    const p: any = await this.prisma.payslip.findFirst({ where: { id, employee: { companyId } }, include: { employee: true, payrollRun: true } });
    if (!p) throw new NotFoundException('Document not found');
    const company = await this.companyInfo(companyId);
    const allowances = (p.allowances as any) || {};
    const deductions = (p.deductions as any) || {};
    const lines = [
      ...Object.entries(allowances).map(([k, v]) => ({ desc: k, qty: 1, unit: 0, tax: 0, taxAmt: 0, total: money(v), group: 'earnings' })),
      { desc: 'Basic salary', qty: 1, unit: 0, tax: 0, taxAmt: 0, total: money(p.basicSalary), group: 'earnings' },
      { desc: 'Gross pay', qty: 1, unit: 0, tax: 0, taxAmt: 0, total: money(p.grossPay), group: 'gross' },
      ...Object.entries(deductions).map(([k, v]) => ({ desc: k, qty: 1, unit: 0, tax: 0, taxAmt: 0, total: money(v), group: 'deduction' })),
      { desc: 'PAYE tax', qty: 1, unit: 0, tax: 0, taxAmt: 0, total: money(p.payeTax), group: 'deduction' },
      { desc: 'NSSA (employee)', qty: 1, unit: 0, tax: 0, taxAmt: 0, total: money(p.employeeNssa), group: 'deduction' },
      { desc: 'Other deductions', qty: 1, unit: 0, tax: 0, taxAmt: 0, total: money(p.otherDeductions), group: 'deduction' },
    ];
    return {
      kind: 'payslip', title: 'Payslip', number: `PS-${p.id.slice(0, 8)}`, date: p.payrollRun?.period || p.createdAt || new Date(), dueDate: null,
      currency: 'USD', status: 'PAID', company,
      party: { name: p.employee ? `${p.employee.firstName || ''} ${p.employee.lastName || ''}`.trim() || p.employee.employeeNo : '' },
      lines, subtotal: money(p.grossPay), taxTotal: money(p.payeTax), total: money(p.netPay), netPay: money(p.netPay), notes: null,
    };
  }

  private async statement(companyId: string, customerId: string) {
    const customer: any = await this.prisma.customer.findFirst({ where: { id: customerId, companyId } });
    if (!customer) throw new NotFoundException('Document not found');
    const company = await this.companyInfo(companyId);
    const invoices = await this.prisma.salesInvoice.findMany({ where: { companyId, customerId, status: { in: ['POSTED', 'PART_PAID', 'PAID'] } }, include: { receipts: true }, orderBy: { invoiceDate: 'asc' } });
    const receipts = await this.prisma.receipt.findMany({ where: { companyId, invoice: { customerId } }, orderBy: { receiptDate: 'asc' } });
    const cns = await this.prisma.creditNote.findMany({ where: { companyId, customerId, status: 'POSTED' }, orderBy: { creditNoteDate: 'asc' } });
    const dns = await this.prisma.debitNote.findMany({ where: { companyId, customerId, status: 'POSTED' }, orderBy: { date: 'asc' } });
    const rows: any[] = [];
    let bal = 0;
    const push = (date: any, desc: string, ref: string, amt: number) => { bal += amt; rows.push({ date: new Date(date).toISOString(), desc, ref, amt, balance: bal }); };
    for (const i of invoices) push(i.invoiceDate, `Invoice ${i.invoiceNo}`, i.invoiceNo, money(i.total));
    for (const r of receipts) push(r.receiptDate, `Payment ${r.receiptNo}`, r.receiptNo, -money(r.amount));
    for (const c of cns) push(c.creditNoteDate, `Credit note ${c.creditNoteNo}`, c.creditNoteNo, -money(c.total));
    for (const d of dns) push(d.date, `Debit note ${d.debitNoteNo}`, d.debitNoteNo, money(d.total));
    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let rb = 0; for (const r of rows) { rb += r.amt; r.balance = rb; }
    return { kind: 'statement', title: 'Customer Statement', number: customer.code || customerId, date: new Date().toISOString(), dueDate: null, currency: 'USD', status: '', company, party: { name: customer.name, address: addr(customer), email: customer.email, phone: customer.phone }, lines: rows.map((r) => ({ desc: r.desc, ref: r.ref, date: r.date, total: r.amt, balance: r.balance })), subtotal: 0, taxTotal: 0, total: rb, notes: null };
  }
}
