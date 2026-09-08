import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { promises as fs } from 'fs';
import { isAbsolute } from 'path';

@Injectable()
export class DocumentPdfService {
  async generate(vm: any, opts: { format?: 'A4' | 'LETTER' } = {}): Promise<Buffer> {
    const size = opts.format === 'LETTER' ? 'LETTER' : 'A4';
    const doc = new PDFDocument({ size, margin: 40, bufferPages: true, info: { Title: `${vm.title} ${vm.number}`, Author: vm.company?.name || 'NexusERP' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

    const primary = vm.template?.primaryColor || '#003366';
    const dispLabel = vm.displayStatusLabel || vm.displayStatus || vm.status;
    const muted = vm.template?.mutedColor || '#6b7280';
    const font = this.fontName(vm.template?.fontFamily);
    const baseFontSize = vm.template?.baseFontSize || 13;
    doc.font(font).fontSize(baseFontSize);

    const pageW = size === 'A4' ? 595.28 : 612;
    const right = pageW - 40;
    const bottom = 841.89 - 50;
    const money = (v: any) => `$${Number(v || 0).toFixed(2)}`;

    const drawHeader = () => {      let x = 40;
      if (vm.template?.logoPosition === 'right') x = right - 120;
      else if (vm.template?.logoPosition === 'center') x = (right + 40) / 2 - 60;
      try {
        if (vm.template?.logoUrl && isAbsolute(vm.template.logoUrl)) { const w = vm.template.logoSize === 'large' ? 110 : vm.template.logoSize === 'small' ? 60 : 85; doc.image(vm.template.logoUrl, x, 40, { width: w }); }
      } catch {}
      // Company block (left)
      doc.fillColor(primary).font(font).fontSize(baseFontSize + 4);
      doc.text(vm.company?.name || '', 40, 40, { width: 200 });
      doc.fontSize(baseFontSize - 1).fillColor('#373a44');
      if (vm.company?.address) doc.text(vm.company.address, 40, undefined, { width: 200 });
      if (vm.company?.phone || vm.company?.email) doc.text([vm.company.phone, vm.company.email].filter(Boolean).join(' • '), 40, undefined, { width: 200 });
      // Document type + status (right)
      const titleWidth = 300;
      doc.fillColor(primary).font(font).fontSize(baseFontSize + 10).text(vm.title || (vm.kind === 'quote' ? 'QUOTATION' : vm.kind === 'order' ? 'SALES ORDER' : 'INVOICE'), 256, 40, { width: titleWidth, align: 'right' });
      if (dispLabel) {
        doc.fontSize(baseFontSize + 1).fillColor(vm.displayStatusColor || (this.isPaid(dispLabel) ? '#16A34A' : '#f59e0b'));
        doc.text(vm.displayStatusLabel || dispLabel, 256, undefined, { width: titleWidth, align: 'right' });
      }
      doc.fillColor('#373a44').font(font).fontSize(baseFontSize - 1);
      // meta lines (right, aligned)
      const meta: string[] = [];
      if (vm.number) meta.push(`# ${vm.number}`);
      if (vm.date) meta.push(`Date  ${this.fmt(vm.date)}`);
      if (vm.kind === 'quote') { if (vm.validUntil) meta.push(`Valid to  ${this.fmt(vm.validUntil)}`); }
      else if (vm.kind === 'order') { if (vm.dueDate) meta.push(`Expected  ${this.fmt(vm.dueDate)}`); }
      else if (vm.dueDate) meta.push(`Due  ${this.fmt(vm.dueDate)}`);
      // meta text block at right, below status
      let yy = 96;
      for (const line of meta) { doc.text(line, 256, yy, { width: titleWidth, align: 'right' }); yy += 14; }
      doc.fillColor(primary); doc.rect(40, 150, right - 40, 0.5).fill();
    };

    drawHeader();
    let y = 165;

    // Customer block
    const headerLabel = vm.kind === 'quote' ? (vm.template?.preparedForLabel || 'PREPARED FOR') : vm.kind === 'order' ? 'SOLD TO' : 'BILL TO';
    doc.fillColor(muted).font(font).fontSize(baseFontSize - 2).text(headerLabel, 40, y);
    y += 13;
    doc.fillColor('#171a2e').font(font).fontSize(baseFontSize).text(vm.party?.name || '', 40, y);
    y += 15;
    doc.fontSize(baseFontSize - 1).fillColor('#373a44');
    if (vm.party?.address) { doc.text(vm.party.address, 40, y, { width: 240 }); y += 16; }
    if (vm.party?.email) { doc.text(vm.party.email, 40, y, { width: 240 }); y += 13; }
    if (vm.party?.phone) { doc.text(vm.party.phone, 40, y, { width: 240 }); y += 13; }
    y += 12;

    // Lines table
    const lineData = vm.lines || [];
    const colX: Record<string, number> = { num: 40, desc: 58, qty: 300, rate: 345, disc: 400, tax: 445, amount: 495 };
    const drawTableHeader = (yy: number) => {
      doc.fillColor(vm.template?.tableHeaderColor || primary).rect(40, yy, right - 40, 22).fill();
      doc.fillColor(vm.template?.tableHeaderTextColor || '#ffffff').font(font).fontSize(baseFontSize - 1);
      doc.text('#', colX.num, yy + 6); doc.text('Item / Description', colX.desc, yy + 6, { width: 220 });
      doc.text('Qty', colX.qty, yy + 6, { width: 40, align: 'right' });
      doc.text('Rate', colX.rate, yy + 6, { width: 50, align: 'right' });
      doc.text('Disc', colX.disc, yy + 6, { width: 40, align: 'right' });
      doc.text('VAT', colX.tax, yy + 6, { width: 40, align: 'right' });
      doc.text('Amount', colX.amount, yy + 6, { width: right - colX.amount, align: 'right' });
      if (lineData.length && yy + 22 > bottom) { doc.addPage(); drawHeader(); return 40 + 22; }
      return yy + 22;
    };
    let ty = drawTableHeader(y);
    let i = 0;
    const rowH = 18;
    for (const row of lineData) {
      if (ty + rowH > bottom) { doc.addPage(); drawHeader(); ty = drawTableHeader(40); }
      doc.fillColor('#171a2e').font(font).fontSize(baseFontSize - 1);
      doc.text(String(++i), colX.num, ty + 1);
      doc.text(String(row.desc || row.name || row.productName || ''), colX.desc, ty + 1, { width: 230 });
      doc.text(String(Number(row.qty || 0)), colX.qty, ty + 1, { width: 40, align: 'right' });
      doc.text(money(row.unit ?? row.rate), colX.rate, ty + 1, { width: 50, align: 'right' });
      const discN = Number(row.discount || 0);
      doc.text(discN ? money(discN) : '—', colX.disc, ty + 1, { width: 40, align: 'right' });
      const taxN = Number(row.tax || 0);
      const taxPct = !taxN ? '—' : `${(taxN <= 1 && taxN > 0 && taxN < 1 ? taxN * 100 : taxN).toFixed(taxN % 1 ? 1 : 0)}%`;
      doc.text(taxPct, colX.tax, ty + 1, { width: 40, align: 'right' });
      doc.text(money(row.total ?? row.amount), colX.amount, ty + 1, { width: right - colX.amount, align: 'right' });
      ty += rowH;
    }
    doc.fillColor('#e5e7eb').rect(40, ty - 2, right - 40, 0.5).fill();
    ty += 8;

    // Totals
    doc.font(font).fillColor('#171a2e').fontSize(baseFontSize - 1);
    const totalLeft = 380, totalWidth = right - totalLeft;
    const line = (label: string, val: string, bold = false) => {
      if (ty + 16 > bottom) { doc.addPage(); drawHeader(); ty = 55; }
      doc.font(bold ? 'Helvetica-Bold' : font).fontSize(bold ? baseFontSize + 2 : baseFontSize - 1).fillColor(bold ? primary : '#171a2e');
      doc.text(label, totalLeft, ty, { width: totalWidth, align: 'right' });
      doc.text(val, totalLeft, ty, { width: totalWidth - 60, align: 'right' });
      ty += 16;
    };
    if (vm.kind !== 'quote') line('Subtotal', money(vm.subtotal));
    else line('Subtotal', money(vm.subtotal));
    if (vm.discount) line('Discount', `- ${money(vm.discount)}`);
    if (vm.taxTotal) line('Tax', money(vm.taxTotal));
    if (vm.kind !== 'quote') {
      line('TOTAL', money(vm.total), true);
      if (vm.kind !== 'order' && vm.template?.showBalanceDue !== false) {
        line('Paid', money(vm.paid));
        doc.fillColor(primary).font('Helvetica-Bold').fontSize(baseFontSize + 1);
        doc.text('Balance Due', totalLeft, ty, { width: totalWidth, align: 'right' });
        doc.text(money(vm.balance), totalLeft, ty, { width: totalWidth - 60, align: 'right' });
        ty += 16;
      }
    } else {
      line('QUOTE TOTAL', money(vm.total), true);
    }
    if (vm.total != null) {
      ty += 4;
      doc.font(font).fontSize(baseFontSize - 1).fillColor('#373a44');
      doc.text(`Amount in words: ${this.amountInWords(Number(vm.total || 0), vm.currency || 'USD')}`, 40, ty, { width: right - 40 });
      ty += 18;
    }
    ty += 10;

    // Notes / statement memo / validity / terms
    const section = (label: string, body?: string) => {
      if (!body) return;
      if (ty + 20 > bottom) { doc.addPage(); drawHeader(); ty = 55; }
      doc.fillColor(muted).font(font).fontSize(baseFontSize - 2).text(label.toUpperCase(), 40, ty, { width: 240 });
      ty += 13;
      doc.fillColor('#171a2e').font(font).fontSize(baseFontSize - 1).text(body, 40, ty, { width: right - 40 });
      ty = doc.y + 10;
    };
    if (vm.kind === 'quote' && vm.template?.showValidity !== false) { const v = this.applyTokens(vm.template?.validityMessage, vm); if (v) section('QUOTE VALIDITY', v); else if (vm.validUntil) section('QUOTE VALIDITY', `Valid until ${this.fmt(vm.validUntil)}`); }
    if (vm.template?.showNotes !== false) section('NOTES', vm.notes);
    if (vm.paymentTerms) section('PAYMENT TERMS', vm.paymentTerms);
    if (vm.kind !== 'quote' && vm.template?.showStatementMemo !== false) section('STATEMENT MEMO', vm.statementMemo);
    if (vm.kind === 'quote' ? vm.template?.quoteTerms : vm.template?.invoiceTerms) section('TERMS & CONDITIONS', vm.kind === 'quote' ? this.applyTokens(vm.template.quoteTerms, vm) : this.applyTokens(vm.template.invoiceTerms, vm));

    // Footer (page numbers)
    const totalPages = doc.bufferedPageRange().count;
    const shownRange = doc.bufferedPageRange(); // range starts at 0
    for (let p = shownRange.start; p < shownRange.start + shownRange.count; p++) {
      doc.switchToPage(p);
      const footer = vm.kind === 'quote' ? this.applyTokens(vm.template?.quoteFooterMessage || 'Thank you for the opportunity to quote.', vm) : this.applyTokens(vm.template?.footerMessage || 'Thank you for your business!', vm);
      doc.font(font).fontSize(baseFontSize - 1).fillColor('#9ca3af').text(footer, 40, 800, { width: right - 40, align: vm.template?.footerAlignment === 'left' ? 'left' : vm.template?.footerAlignment === 'right' ? 'right' : 'center' });
      if (vm.template?.footerShowPageNumber) doc.text(`Page ${p + 1} of ${totalPages}`, 40, 815, { width: right - 40, align: 'right' });
    }

    // Status stamp (diagonal, first page) — uses the resolved display status
    if (dispLabel && vm.template?.showStatusStamp !== false) {
      const stColor = vm.displayStatusColor || (this.isPaid(dispLabel) ? '#16A34A' : (String(dispLabel).toUpperCase() === 'VOID' ? '#b91c1c' : '#b45309'));
      const angle = (Number(vm.template?.stampAngle) >= -20 && Number(vm.template?.stampAngle) <= 20) ? vm.template.stampAngle : -12;
      const fsize = vm.template?.stampSize === 'large' ? 60 : vm.template?.stampSize === 'small' ? 36 : 48;
      const cw = (size === 'A4' ? 595.28 : 612);
      const pos = vm.template?.stampPosition || 'center';
      let x = cw / 2 - 90, y = 420;
      if (pos === 'top-right') { x = cw - 200; y = 175; }
      else if (pos === 'top-center') { x = cw / 2 - 90; y = 175; }
      doc.switchToPage(0);
      doc.save();
      doc.opacity(0.10);
      doc.fillColor(stColor).font('Helvetica-Bold').fontSize(fsize);
      doc.rotate(angle, { origin: [x + 90, y] });
      doc.text(String(dispLabel).toUpperCase(), x, y, { width: 180, align: 'center' });
      doc.restore();
    }

    doc.end();
    return done;
  }
  private fontName(f?: string): string {
    const map: Record<string, string> = { Arial: 'Helvetica', Helvetica: 'Helvetica', Inter: 'Helvetica', Roboto: 'Helvetica', Georgia: 'Times-Roman', 'Times New Roman': 'Times-Roman', 'System Default': 'Helvetica' };
    return map[f || ''] || 'Helvetica';
  }

  private applyTokens(s: string | undefined, vm: any): string {
    if (!s) return '';
    const money = (v: any) => `$${Number(v || 0).toFixed(2)}`;
    const fd = (d: any) => { try { return d ? new Date(d).toLocaleDateString() : ''; } catch { return ''; } };
    const t: Record<string, string> = {
      validityDays: String(vm.template?.validityDays ?? 30),
      validUntil: fd(vm.validUntil),
      date: fd(vm.date),
      companyName: vm.company?.name || '',
      quoteNumber: vm.number, invoiceNumber: vm.number,
      customerName: vm.party?.name || '',
      balanceDue: money(vm.balance),
    };
    return String(s).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (t[k] != null ? t[k] : ''));
  }

  private amountInWords(v: number, currency = 'USD'): string {
    const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const words = (n: number): string => {
      if (n < 20) return ONES[n];
      if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
      if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + words(n % 100) : ''}`;
      if (n < 1_000_000) { const thousands = Math.floor(n / 1000); const rest = n % 1000; return `${words(thousands)} Thousand${rest ? ' ' + words(rest) : ''}`; }
      const millions = Math.floor(n / 1_000_000); const rest = n % 1_000_000;
      return `${words(millions)} Million${rest ? ' ' + words(rest) : ''}`;
    };
    const whole = Math.floor(Math.abs(v));
    const cents = Math.round((Math.abs(v) - whole) * 100);
    const unit = currency === 'USD' ? 'Dollars' : currency;
    if (!whole && !cents) return `Zero and 00/100 ${unit}`;
    return `${words(whole) || 'Zero'} and ${String(cents).padStart(2, '0')}/100 ${unit}`;
  }

  private isPaid(status: string): boolean { const s = (status || '').toUpperCase(); return s === 'PAID' || s === 'FISCALISED'; }

  private fmt(d: any): string { try { return new Date(d).toLocaleDateString(); } catch { return String(d || ''); } }
}
