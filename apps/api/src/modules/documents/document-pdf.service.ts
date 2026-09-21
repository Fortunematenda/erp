import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { existsSync, readFileSync } from 'fs';
import { isAbsolute } from 'path';

/**
 * Invoice / quote PDF layout mirrored from the web DocumentPreview (template designer).
 * Same sections, columns, colours and labels so Preview / Print / PDF stay in sync.
 */
@Injectable()
export class DocumentPdfService {
  async generate(vm: any, opts: { format?: 'A4' | 'LETTER' } = {}): Promise<Buffer> {
    const size = opts.format === 'LETTER' ? 'LETTER' : 'A4';
    const doc = new PDFDocument({
      size,
      margin: 0,
      bufferPages: true,
      autoFirstPage: true,
      info: { Title: `${vm.title || 'Document'} ${vm.number || ''}`, Author: vm.company?.name || 'NexusERP' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const t = vm.template || {};
    const logoBuf = await this.loadLogo(t.logoUrl);
    const primary = t.primaryColor || '#003366';
    const secondary = t.secondaryColor || '#0b4a8f';
    const muted = t.mutedColor || '#6b7280';
    const textColor = t.textColor || '#171a2e';
    const thBg = t.tableHeaderColor || primary;
    const thText = t.tableHeaderTextColor || '#ffffff';
    const font = this.fontName(t.fontFamily);
    const bold = this.boldFont(t.fontFamily);
    const base = Number(t.baseFontSize) || 13;
    const showCompany = (k: string) => (t.showCompanyFields ? (t.showCompanyFields as any)[k] !== false : true);

    const isQuote = vm.kind === 'quote' || vm.kind === 'quotation';
    const isOrder = vm.kind === 'order';
    const title = isQuote ? (t.quoteTitle || 'QUOTATION') : isOrder ? 'SALES ORDER' : (t.invoiceTitle || vm.title || 'INVOICE');
    const dispLabel = String((isQuote || isOrder ? vm.status : (vm.displayStatusLabel || vm.displayStatus || vm.status)) || '');
    const statusColor = this.isPaid(String(vm.status || '')) ? '#16A34A'
      : (String(vm.status || '').toUpperCase() === 'VOID' ? '#9ca3af' : '#b45309');
    const dispColor = isQuote
      ? statusColor
      : (vm.displayStatusColor
        || (this.isPaid(dispLabel) ? '#16A34A'
          : (String(dispLabel).toUpperCase() === 'VOID' ? '#b91c1c'
            : (String(dispLabel).toUpperCase() === 'DRAFT' ? '#64748b' : '#f59e0b'))));

    const pageW = size === 'A4' ? 595.28 : 612;
    const pageH = size === 'A4' ? 841.89 : 792;
    const left = 48;
    const right = pageW - 48;
    const contentW = right - left;
    const top = 48;
    const footerReserve = 64;
    const contentBottom = pageH - footerReserve;

    const money = (v: any) => {
      const n = Number(v || 0);
      const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return n < 0 ? `-$${abs}` : `$${abs}`;
    };

    const at = (str: any, x: number, y: number, o: Record<string, any> = {}) => {
      if (str == null || str === '') return;
      doc.text(String(str), x, y, { width: o.width, align: o.align || 'left', lineBreak: false, ellipsis: o.ellipsis !== false });
    };

    const measure = (text: string, width: number, sizePt: number) => {
      if (!text) return 0;
      doc.font(font).fontSize(sizePt);
      const lineH = sizePt + 3;
      let lines = 0;
      for (const para of String(text).split(/\r?\n/)) {
        const words = para.length ? para.split(/\s+/) : [''];
        let line = '';
        for (const w of words) {
          const next = line ? `${line} ${w}` : w;
          if (line && doc.widthOfString(next) > width) {
            lines++;
            line = w;
          } else line = next;
        }
        lines++;
      }
      return Math.max(lineH, lines * lineH);
    };

    const block = (str: any, x: number, y: number, width: number, sizePt = base - 1, allowPage = true): number => {
      const text = String(str ?? '');
      if (!text) return y;
      doc.font(font).fontSize(sizePt).fillColor(textColor);
      const lineH = sizePt + 3;
      let cy = y;
      for (const para of text.split(/\r?\n/)) {
        const words = para.length ? para.split(/\s+/) : [''];
        let line = '';
        const flush = () => {
          if (allowPage && cy + lineH > contentBottom) {
            doc.addPage();
            cy = drawContinuingHeader();
          }
          at(line, x, cy, { width });
          cy += lineH;
          line = '';
        };
        for (const w of words) {
          const next = line ? `${line} ${w}` : w;
          if (line && doc.widthOfString(next) > width) {
            flush();
            line = w;
            if (doc.widthOfString(line) > width) flush();
          } else line = next;
        }
        if (line || !para) flush();
      }
      return cy;
    };

    const need = (y: number, h: number) => {
      if (y + h <= contentBottom) return y;
      doc.addPage();
      return drawContinuingHeader();
    };

    const visibleCols = this.resolveColumns(t);
    const colLayout = this.layoutColumns(visibleCols, left, contentW);

    const taxLabel = (taxN: number) => {
      if (taxN == null || Number.isNaN(Number(taxN))) return '—';
      const n = Number(taxN);
      if (!n) return '0%';
      const pct = n > 0 && n <= 1 ? n * 100 : n;
      return `${pct % 1 ? pct.toFixed(1) : pct}%`;
    };

    const cellValue = (row: any, key: string) => {
      if (key === 'description') return String(row.desc || row.name || row.productName || '—');
      if (key === 'qty') return String(Number(row.qty ?? 0));
      if (key === 'unit') return money(row.unit ?? row.rate ?? 0);
      if (key === 'tax') return taxLabel(Number(row.tax));
      if (key === 'amount') return money(row.total ?? row.amount ?? 0);
      if (key === 'sku') return String(row.sku || row.hsCode || '—');
      return '';
    };

    const drawTableHeader = (yy: number) => {
      doc.fillColor(thBg).rect(left, yy, contentW, 26).fill();
      doc.fillColor(thText).font(bold).fontSize(base - 1);
      at('#', left + 6, yy + 8, { width: 18 });
      for (const c of colLayout) {
        at(c.label, c.x, yy + 8, { width: c.w, align: c.align });
      }
      return yy + 26;
    };

    const drawContinuingHeader = (): number => {
      doc.fillColor(primary).font(bold).fontSize(base);
      at(`${title} ${vm.number || ''}`.trim(), left, top, { width: contentW });
      doc.fillColor(primary).rect(left, top + base + 6, contentW, 0.6).fill();
      return top + base + 16;
    };

    // ——— Header (company + title) ———
    let logoH = 0;
    try {
      if (logoBuf) {
        const w = t.logoSize === 'large' ? 110 : t.logoSize === 'small' ? 55 : 80;
        let logoX = left;
        if (t.logoPosition === 'right') logoX = right - w;
        else if (t.logoPosition === 'center') logoX = (left + right) / 2 - w / 2;
        doc.image(logoBuf, logoX, top, { width: w });
        logoH = w * 0.45;
      }
    } catch { /* ignore bad logo */ }

    const companyTop = top + (logoH ? logoH + 8 : 0);
    doc.fillColor(primary).font(bold).fontSize(base + 4);
    at(vm.company?.name || '', left, companyTop, { width: 250 });
    let cy = companyTop + base + 8;
    if (t.pdfHeader) {
      doc.fillColor(muted).font(font).fontSize(base - 2);
      cy = block(t.pdfHeader, left, cy, 250, base - 2, false);
    }
    doc.fillColor(muted).font(font).fontSize(base - 1);
    if (showCompany('address') && vm.company?.address) cy = block(vm.company.address, left, cy, 250, base - 1, false);
    const contact = [vm.company?.phone, vm.company?.email].filter(Boolean).join(' • ');
    if (contact) {
      at(contact, left, cy, { width: 250 });
      cy += base + 2;
    }
    if (showCompany('tax') && (vm.company?.tin || vm.company?.vatNumber)) {
      const tinVat = `TIN ${vm.company?.tin || ''}${vm.company?.vatNumber ? ` · VAT ${vm.company.vatNumber}` : ''}`;
      at(tinVat, left, cy, { width: 250 });
      cy += base + 2;
    }
    if (showCompany('website') && vm.company?.website) {
      at(vm.company.website, left, cy, { width: 250 });
      cy += base + 2;
    }

    const titleW = 250;
    const titleX = right - titleW;
    doc.fillColor(primary).font(bold).fontSize(base + 10);
    at(title, titleX, top, { width: titleW, align: 'right' });
    let my = top + base + 16;

    // Status badge (pill) — matches preview header badge
    if (t.showStatusBadge !== false && dispLabel) {
      const label = String(dispLabel).toUpperCase();
      doc.font(bold).fontSize(9);
      const tw = Math.min(titleW - 8, doc.widthOfString(label) + 16);
      const bx = right - tw;
      doc.fillColor(dispColor).roundedRect(bx, my, tw, 16, 8).fill();
      doc.fillColor('#ffffff');
      at(label, bx, my + 4, { width: tw, align: 'center', ellipsis: false });
      my += 22;
    }
    if (!isQuote && !isOrder && vm.isFiscalised) {
      doc.font(bold).fontSize(8).fillColor('#0369a1');
      const fisc = 'FISCALISED';
      const fw = Math.min(titleW - 8, doc.widthOfString(fisc) + 14);
      const fx = right - fw;
      doc.fillColor('#e0f2fe').roundedRect(fx, my, fw, 14, 7).fill();
      doc.strokeColor('#7dd3fc').lineWidth(0.8).roundedRect(fx, my, fw, 14, 7).stroke();
      doc.fillColor('#0369a1');
      at(fisc, fx, my + 3, { width: fw, align: 'center', ellipsis: false });
      my += 18;
    }

    doc.fillColor(textColor).font(bold).fontSize(base);
    if (vm.number) {
      at(String(vm.number), titleX, my, { width: titleW, align: 'right' });
      my += base + 4;
    }
    doc.fillColor(muted).font(font).fontSize(base - 1);
    if (vm.date) {
      at(`Date ${this.fmt(vm.date)}`, titleX, my, { width: titleW, align: 'right' });
      my += 14;
    }
    if (isQuote && vm.validUntil) {
      at(`Valid to ${this.fmt(vm.validUntil)}`, titleX, my, { width: titleW, align: 'right' });
      my += 14;
    } else if (isOrder && vm.dueDate) {
      at(`Expected ${this.fmt(vm.dueDate)}`, titleX, my, { width: titleW, align: 'right' });
      my += 14;
    } else if (vm.dueDate) {
      at(`Due ${this.fmt(vm.dueDate)}`, titleX, my, { width: titleW, align: 'right' });
      my += 14;
    }
    if (!isQuote && !isOrder && t.showPaymentStatus !== false && vm.paid != null) {
      at(`Paid ${money(vm.paid)}`, titleX, my, { width: titleW, align: 'right' });
      my += 14;
    }

    const headerBottom = Math.max(cy, my, companyTop + 40) + 16;
    doc.fillColor(primary).rect(left, headerBottom, contentW, 2).fill();
    let y = headerBottom + 20;

    // ——— Bill to ———
    const billLabel = isQuote ? (t.preparedForLabel || 'PREPARED FOR') : isOrder ? 'SOLD TO' : 'BILL TO';
    const billStartY = y;
    const billColW = t.customerBlockLayout === 'side-by-side' ? contentW / 2 - 12 : 300;
    doc.fillColor(muted).font(font).fontSize(base - 2);
    at(billLabel, left, y);
    y += base + 2;
    doc.fillColor(textColor).font(bold).fontSize(base);
    at(vm.party?.name || '—', left, y, { width: billColW });
    y += base + 4;
    doc.fillColor(muted).font(font).fontSize(base - 1);
    if (vm.party?.address) y = block(vm.party.address, left, y, billColW, base - 1, false);
    const partyContact = [vm.party?.email, vm.party?.phone].filter(Boolean).join(' • ');
    if (partyContact) {
      at(partyContact, left, y, { width: billColW });
      y += base + 2;
    }

    if (!isQuote && !isOrder && t.showDeliveryAddress && vm.party?.address && !t.hideDuplicateDeliveryAddress) {
      const sideBySide = t.customerBlockLayout === 'side-by-side';
      const delX = sideBySide ? left + contentW / 2 + 8 : left;
      let dy = sideBySide ? billStartY : y + 8;
      doc.fillColor(muted).font(font).fontSize(base - 2);
      at('DELIVERY / SERVICE ADDRESS', delX, dy);
      dy += base + 2;
      doc.fillColor(textColor).font(bold).fontSize(base);
      at(vm.party?.name || '', delX, dy, { width: billColW });
      dy += base + 4;
      doc.fillColor(muted).font(font).fontSize(base - 1);
      dy = block(vm.party.address, delX, dy, billColW, base - 1, false);
      y = Math.max(y, dy);
    }
    y += 20;

    // ——— Line table ———
    y = need(y, 40);
    y = drawTableHeader(y);
    const lines = vm.lines || [];
    for (let i = 0; i < lines.length; i++) {
      const row = lines[i];
      const descCol = colLayout.find((c) => c.key === 'description');
      const descH = descCol ? Math.max(16, measure(cellValue(row, 'description'), descCol.w, base - 1)) : 16;
      const rowH = Math.max(28, descH + 12);
      y = need(y, rowH);
      if (t.tableStyle === 'striped' && i % 2) {
        doc.fillColor('#f7f7f7').rect(left, y, contentW, rowH).fill();
      }
      const rowY = y + 8;
      doc.fillColor(textColor).font(font).fontSize(base - 1);
      at(String(i + 1), left + 6, rowY, { width: 18 });
      for (const c of colLayout) {
        const val = cellValue(row, c.key);
        if (c.key === 'description') block(val, c.x, rowY, c.w, base - 1, false);
        else {
          doc.fillColor(textColor).font(font).fontSize(base - 1);
          at(val, c.x, rowY, { width: c.w, align: c.align });
        }
      }
      if (t.tableStyle === 'bordered' || t.tableStyle === 'minimal' || t.tableStyle === 'modern') {
        doc.fillColor('#e5e7eb').rect(left, y + rowH - 0.5, contentW, 0.5).fill();
      }
      y += rowH;
    }
    if (!lines.length) {
      y = need(y, 36);
      doc.fillColor(muted).font(font).fontSize(base - 1);
      at('No items', left, y + 12, { width: contentW, align: 'center' });
      y += 36;
    }
    doc.fillColor('#e5e7eb').rect(left, y, contentW, 0.5).fill();
    y += 20;

    // ——— Totals (right-aligned box like preview) ———
    const totalBoxW = 240;
    const totalLeft = right - totalBoxW;
    const labelW = 120;
    const valueX = totalLeft + labelW;
    const valueW = totalBoxW - labelW;
    const totalLine = (label: string, val: string, opts?: { bold?: boolean; color?: string; size?: number }) => {
      y = need(y, 22);
      const useBold = !!opts?.bold;
      doc.font(useBold ? bold : font).fontSize(opts?.size || (useBold ? base + 2 : base - 1)).fillColor(opts?.color || (useBold ? primary : textColor));
      at(label, totalLeft, y, { width: labelW });
      at(val, valueX, y, { width: valueW, align: 'right' });
      y += useBold ? 22 : 18;
    };
    totalLine('Subtotal', money(vm.subtotal));
    if (vm.discount) totalLine('Discount', `− ${money(vm.discount)}`);
    if (vm.taxTotal) totalLine('Tax', money(vm.taxTotal));
    doc.fillColor('#e5e7eb').rect(totalLeft, y, totalBoxW, 0.5).fill();
    y += 6;
    if (isQuote) totalLine('QUOTE TOTAL', money(vm.total), { bold: true, size: base + 3 });
    else {
      totalLine('TOTAL', money(vm.total), { bold: true, size: base + 3 });
      if (!isOrder && t.showBalanceDue !== false) {
        totalLine('Paid', money(vm.paid));
        totalLine('Balance Due', money(vm.balance), { bold: true, color: secondary });
      }
    }
    y += 16;

    const section = (label: string, body?: string | null) => {
      if (!body) return;
      const bodyH = measure(String(body), contentW, base - 1);
      y = need(y, base + bodyH + 20);
      doc.fillColor(muted).font(font).fontSize(base - 2);
      at(label.toUpperCase(), left, y, { width: contentW });
      y += base + 2;
      doc.fillColor(textColor);
      y = block(body, left, y, contentW, base - 1, true);
      y += 8;
    };

    if (isQuote && t.showValidity !== false) {
      const v = this.applyTokens(t.validityMessage, vm);
      if (v) section('QUOTE VALIDITY', v);
      else if (vm.validUntil) section('QUOTE VALIDITY', `Valid until ${this.fmt(vm.validUntil)}`);
    }
    if (t.showNotes !== false) section('NOTES', vm.notes);
    if (!isQuote && vm.paymentTerms) section('PAYMENT TERMS', vm.paymentTerms);
    const terms = isQuote ? t.quoteTerms : t.invoiceTerms;
    if (terms) section('TERMS & CONDITIONS', this.applyTokens(terms, vm));

    if (isQuote && t.showAcceptanceSection) {
      y = need(y, 90);
      doc.fillColor(muted).font(font).fontSize(base - 2);
      at('ACCEPTANCE', left, y, { width: contentW });
      y += base + 6;
      doc.fillColor(textColor).font(font).fontSize(base - 1);
      for (const line of ['Customer Name: ______________________', 'Signature: __________________________', 'Date: ______________________________', ...(t.acceptanceNotesAllowed ? ['Purchase Order No: _______________________'] : [])]) {
        at(line, left, y, { width: contentW });
        y += base + 6;
      }
      y += 4;
    }

    if (!isQuote && t.showFiscalInformation !== false && vm.fiscalInfo) {
      const fi = vm.fiscalInfo;
      section(
        'FISCAL INFORMATION',
        `Receipt ${fi.receiptId || '—'} · Day ${fi.dayNo ?? '—'} · Device ${fi.deviceId || '—'} · Status ${fi.status || '—'}`,
      );
    }

    // Status stamp overlay on first page
    if (!isQuote && dispLabel && t.showStatusStamp !== false) {
      const range0 = doc.bufferedPageRange();
      const angle = (Number(t.stampAngle) >= -20 && Number(t.stampAngle) <= 20) ? Number(t.stampAngle) : -12;
      const fsize = t.stampSize === 'large' ? 48 : t.stampSize === 'small' ? 28 : 40;
      const pos = t.stampPosition || 'center';
      let sx = pageW / 2 - 90;
      let sy = 320;
      if (pos === 'top-right') { sx = pageW - 200; sy = 160; }
      else if (pos === 'top-center') { sx = pageW / 2 - 90; sy = 160; }
      doc.switchToPage(range0.start);
      doc.save();
      doc.opacity(0.12);
      doc.fillColor(dispColor).font(bold).fontSize(fsize);
      doc.rotate(angle, { origin: [sx + 90, sy] });
      doc.text(String(dispLabel).toUpperCase(), sx, sy, { width: 180, align: 'center', lineBreak: false });
      doc.restore();
    }

    // Footers
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    const footerY = pageH - 44;
    const pageNoY = pageH - 28;
    const footerMsg = this.applyTokens(
      isQuote
        ? (t.quoteFooterMessage || t.pdfFooter || 'Thank you for the opportunity to quote.')
        : (t.footerMessage || t.pdfFooter || 'Thank you for your business!'),
      vm,
    );
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      doc.fillColor('#9ca3af').font(font).fontSize(base - 1);
      at(footerMsg, left, footerY, {
        width: contentW,
        align: t.footerAlignment === 'left' ? 'left' : t.footerAlignment === 'right' ? 'right' : 'center',
      });
      if (t.footerShowPageNumber) {
        at(`Page ${p - range.start + 1} of ${totalPages}`, left, pageNoY, { width: contentW, align: 'right' });
      }
    }

    doc.end();
    return done;
  }

  private async loadLogo(url?: string | null): Promise<Buffer | null> {
    if (!url) return null;
    const s = String(url).trim();
    if (!s) return null;
    try {
      if (s.startsWith('data:')) {
        const m = /^data:[^;]+;base64,(.+)$/i.exec(s);
        return m ? Buffer.from(m[1], 'base64') : null;
      }
      if (isAbsolute(s) && existsSync(s)) return readFileSync(s);
      if (/^https?:\/\//i.test(s)) {
        const res = await fetch(s);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Same column visibility rules as DocumentPreview. */
  private resolveColumns(t: any): { key: string; label: string }[] {
    const fromTpl = (Array.isArray(t.columns) ? t.columns : [])
      .filter((c: any) => c && c.visible !== false)
      .map((c: any) => ({ key: c.key, label: c.label || c.key }));
    if (fromTpl.length) return fromTpl;
    const defaults = [
      { key: 'sku', label: 'SKU', on: t.showSku === true },
      { key: 'description', label: 'Product / Description', on: t.showDescription !== false },
      { key: 'qty', label: 'Qty', on: t.showQty !== false },
      { key: 'unit', label: 'Rate', on: t.showUnit !== false },
      { key: 'tax', label: 'Tax', on: t.showTax !== false },
      { key: 'amount', label: 'Amount', on: t.showAmount !== false },
    ];
    const visible = defaults.filter((c) => c.on).map(({ key, label }) => ({ key, label }));
    return visible.length ? visible : defaults.filter((c) => c.key !== 'sku').map(({ key, label }) => ({ key, label }));
  }

  private layoutColumns(cols: { key: string; label: string }[], left: number, contentW: number) {
    // Match DocumentPreview: all columns left-aligned in the HTML table.
    const numW = 22;
    const start = left + numW;
    const avail = contentW - numW;
    const flex: Record<string, number> = { sku: 0.9, description: 2.4, qty: 0.55, unit: 0.9, tax: 0.55, amount: 1.0 };
    const totalFlex = cols.reduce((s, c) => s + (flex[c.key] || 1), 0) || 1;
    let x = start;
    return cols.map((c) => {
      const w = (avail * (flex[c.key] || 1)) / totalFlex;
      const col = { ...c, x: x + 2, w: w - 4, align: 'left' as 'left' | 'right' };
      x += w;
      return col;
    });
  }

  private fontName(f?: string): string {
    const map: Record<string, string> = {
      Arial: 'Helvetica', Helvetica: 'Helvetica', Inter: 'Helvetica', Roboto: 'Helvetica',
      Georgia: 'Times-Roman', 'Times New Roman': 'Times-Roman', 'System Default': 'Helvetica',
    };
    return map[f || ''] || 'Helvetica';
  }

  private boldFont(f?: string): string {
    const base = this.fontName(f);
    if (base.startsWith('Times')) return 'Times-Bold';
    return 'Helvetica-Bold';
  }

  private applyTokens(s: string | undefined, vm: any): string {
    if (!s) return '';
    const money = (v: any) => `$${Number(v || 0).toFixed(2)}`;
    const fd = (d: any) => { try { return d ? new Date(d).toLocaleDateString() : ''; } catch { return ''; } };
    const tokens: Record<string, string> = {
      validityDays: String(vm.template?.validityDays ?? 30),
      validUntil: fd(vm.validUntil),
      date: fd(vm.date),
      companyName: vm.company?.name || '',
      quoteNumber: vm.number, invoiceNumber: vm.number,
      customerName: vm.party?.name || '',
      balanceDue: money(vm.balance),
    };
    return String(s).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (tokens[k] != null ? tokens[k] : ''));
  }

  private isPaid(status: string): boolean {
    const s = (status || '').toUpperCase();
    return s === 'PAID' || s === 'FISCALISED';
  }

  private fmt(d: any): string {
    try { return new Date(d).toLocaleDateString(); } catch { return String(d || ''); }
  }
}
