'use client';
import { fmtMoney, fmtDate } from '@/lib/format';

export type Tpl = Record<string, any>;
export type PreviewVm = {
  kind: string;
  title?: string;
  number?: string;
  date?: string;
  dueDate?: string | null;
  validUntil?: string | null;
  currency?: string;
  status?: string;
  displayStatus?: string;
  displayStatusLabel?: string;
  displayStatusColor?: string;
  isFiscalised?: boolean;
  company?: Record<string, any>;
  party?: Record<string, any> | null;
  lines?: any[];
  subtotal?: number;
  discount?: number;
  taxTotal?: number;
  total?: number;
  paid?: number;
  balance?: number;
  notes?: string | null;
  fiscalInfo?: Record<string, any> | null;
  statementMemo?: string | null;
  project?: string;
  branch?: string;
  template?: Tpl;
  sample?: boolean;
};

const FONTS: Record<string, string> = { Inter: "'Inter',system-ui,sans-serif", Georgia: 'Georgia,serif', 'Times New Roman': "'Times New Roman',serif", Arial: 'Arial,sans-serif', Roboto: 'Roboto,sans-serif' };

function applyTokens(s: string | undefined, data: Record<string, any>): string {
  if (!s) return '';
  return String(s).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (data[k] != null ? String(data[k]) : ''));
}

const STAMP_POS: Record<string, { top?: string; right?: string; left?: string; transformX?: string }> = {
  center: { top: '45%', left: '50%', transformX: '-50%' },
  'top-center': { top: '12%', left: '50%', transformX: '-50%' },
  'top-right': { top: '12%', right: '5%' },
};
function stampSizePx(s: string): number { return s === 'large' ? 42 : s === 'small' ? 22 : 30; }

function StatusStamp({ vm, t }: { vm: PreviewVm; t: Tpl }) {
  const label = (isQuoteVm(vm) || vm.kind === 'order' ? vm.status : (vm.displayStatusLabel || vm.displayStatus || vm.status)) || '';
  if (!label) return null;
  const color = isQuoteVm(vm) ? '#b45309' : vm.kind === 'order' ? '#b45309' : (vm.displayStatusColor || '#b45309');
  const angle = (Number(t.stampAngle) >= -20 && Number(t.stampAngle) <= 20) ? t.stampAngle : -12;
  const style = t.stampStyle || 'outlined';
  const pos = STAMP_POS[t.stampPosition as string] || STAMP_POS['center'];
  const size = stampSizePx(t.stampSize);
  const isVoid = label.toUpperCase() === 'VOID';
  const baseBox: React.CSSProperties = {
    position: 'absolute', fontSize: size, fontWeight: 800, letterSpacing: '0.14em',
    textTransform: 'uppercase', whiteSpace: 'nowrap', userSelect: 'none', pointerEvents: 'none', zIndex: 0,
    transform: `rotate(${angle}deg)${pos.transformX ? ' translateX(' + pos.transformX + ')' : ''}`,
    top: pos.top, left: pos.left, right: pos.right,
    ...(isVoid ? { opacity: 0.22, border: '5px double ' + color, color, padding: '12px 26px', borderRadius: 10 } : {}),
  };
  let box = baseBox;
  if (style === 'soft') box = { ...baseBox, color, border: `2px solid ${color}`, background: hexFade(color, 0.10), borderRadius: 10, padding: '8px 20px', opacity: 0.10 };
  else if (style === 'classic') box = { ...baseBox, color, border: `4px double ${color}`, borderRadius: 6, padding: '10px 24px', opacity: 0.10 };
  else box = { ...baseBox, color, border: `3px solid ${color}`, borderRadius: 8, padding: '8px 20px', opacity: 0.10 };
  return <span className="invoice-status-stamp" style={box}>{label}</span>;
}

function isQuoteVm(vm: PreviewVm): boolean { return vm.kind === 'quote' || vm.kind === 'quotation'; }
function hexFade(hex: string, alpha: number): string { try { const h = hex.replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return `rgba(${r}, ${g}, ${b}, ${alpha})`; } catch { return hex; } }

export function DocumentPreview({ vm }: { vm: PreviewVm }) {
  const t: Tpl = vm.template || {};
  const primary = t.primaryColor || '#003366';
  const secondary = t.secondaryColor || '#0b4a8f';
  const text = t.textColor || '#171a2e';
  const muted = t.mutedColor || '#6b7280';
  const thbg = t.tableHeaderColor || primary;
  const thtext = t.tableHeaderTextColor || '#ffffff';
  const font = FONTS[t.fontFamily] || FONTS.Inter;
  const base = (t.baseFontSize || 13);
  const isQuote = vm.kind === 'quote' || vm.kind === 'quotation';
  const isOrder = vm.kind === 'order';
  const title = isQuote ? (t.quoteTitle || 'QUOTATION') : isOrder ? 'SALES ORDER' : (t.invoiceTitle || 'INVOICE');
  const statusColor = (vm.status || '').toUpperCase() === 'FISCALISED' || (vm.status || '').toUpperCase() === 'PAID' ? '#16A34A' : (vm.status || '').toUpperCase() === 'VOID' ? '#9ca3af' : '#b45309';
  const dispLabel = (isQuote || isOrder ? vm.status : (vm.displayStatusLabel || vm.displayStatus || vm.status)) || '';
  const dispColor = isQuote ? statusColor : (vm.displayStatusColor || statusColor);
  const company = vm.company || {};
  const party = vm.party || {};
  const lines = vm.lines || [];
  const cols = (Array.isArray(t.columns) ? t.columns : []).map((c: any) => ({ key: c.key, label: c.label, visible: c.visible !== false }));
  const defaultCols = [{ key: 'sku', label: 'SKU', visible: t.showSku === true }, { key: 'description', label: 'Product / Description', visible: true }, { key: 'qty', label: 'Qty', visible: true }, { key: 'unit', label: 'Rate', visible: true }, { key: 'tax', label: 'Tax', visible: true }, { key: 'amount', label: 'Amount', visible: true }];
  let visible = cols.length ? cols.filter((c: any) => c.visible) : [];
  // Legacy/incomplete template config may hide every column (e.g. `[{key:'tax',visible:false}]`).
  // Never render a line table with only the row-number column — fall back to safe defaults.
  if (!visible.length) visible = defaultCols.filter((c: any) => c.visible);
  const balance = vm.balance ?? (vm.total == null ? 0 : (vm.paid == null ? vm.total : vm.total - vm.paid));
  const showCompany = (k: string) => (t.showCompanyFields ? (t.showCompanyFields as any)[k] !== false : true);
  const showCustomer = (k: string) => (t.showCustomerFields ? (t.showCustomerFields as any)[k] !== false : true);

  const tokData: Record<string, any> = { companyName: company.name, invoiceNumber: vm.number, quoteNumber: vm.number, dueDate: vm.dueDate ? fmtDate(vm.dueDate) : '', validUntil: vm.validUntil ? fmtDate(vm.validUntil) : '', validityDays: t.validityDays, customerName: party.name, balanceDue: fmtMoney(balance) };

  const renderLineCell = (row: any, key: string) => {
    if (key === 'description') return row.desc || row.name || row.productName || '—';
    if (key === 'qty') return Number(row.qty ?? 0);
    if (key === 'unit') return fmtMoney(row.unit ?? row.rate ?? 0);
    if (key === 'tax') return row.tax != null ? `${Number(row.tax) * 100}%` : '—';
    if (key === 'amount') return fmtMoney(row.total ?? row.amount ?? 0);
    if (key === 'sku') return row.sku || row.hsCode || '—';
    return '';
  };

  return (
    <div className="bg-white rounded-md shadow-sm overflow-hidden" style={{ fontFamily: font, color: text }}>
      {/* sample badge */}
      {vm.sample && <div className="text-center text-[10px] tracking-wide uppercase text-white py-1" style={{ background: secondary }}>Template preview — sample data only</div>}
      <div className="relative p-6" style={{ fontSize: base }}>
        {isQuote ? null : (t.showStatusStamp !== false) && (vm.displayStatus || vm.status || (isOrder && vm.status)) && (
          <StatusStamp vm={vm} t={t} />
        )}
        {/* HEADER */}
        <div className="flex justify-between gap-6 mb-5">
          <div className={`flex-1 ${t.logoPosition === 'center' ? 'text-center' : t.logoPosition === 'right' ? 'text-right' : ''}`} style={{ order: t.logoPosition === 'right' ? 1 : 0 }}>
            {t.logoUrl && <div className="mb-2"><img src={t.logoUrl} alt="logo" style={{ height: t.logoSize === 'large' ? 64 : t.logoSize === 'small' ? 32 : 48, objectFit: 'contain' }} /></div>}
            <div className="text-xl font-bold" style={{ color: primary }}>{company.name}</div>
            {showCompany('address') && company.address && <div className="text-[12px]" style={{ color: muted }}>{company.address}</div>}
            <div className="text-[12px] text-slate-500">{[company.phone, company.email].filter(Boolean).join(' • ')}</div>
            {showCompany('tax') && (company.tin || company.vatNumber) && <div className="text-[11px]" style={{ color: muted }}>TIN {company.tin}{company.vatNumber ? ` · VAT ${company.vatNumber}` : ''}</div>}
            {showCompany('website') && company.website && <div className="text-[11px]" style={{ color: muted }}>{company.website}</div>}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold" style={{ color: primary }}>{title}</div>
            {t.showStatusBadge !== false && dispLabel && <div className="inline-block mt-1 px-3 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide" style={{ color: '#fff', background: dispColor }}>{dispLabel}</div>}
            {!isQuote && !isOrder && vm.isFiscalised && <div className="inline-block mt-1 ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase" style={{ color: '#0369a1', border: '1px solid #7dd3fc', background: '#e0f2fe' }}>Fiscalised</div>}
            <div className="mt-3 text-[13px] leading-6">
              <div className="font-semibold">{vm.number}</div>
              <div className="text-slate-500">Date {vm.date ? fmtDate(vm.date) : '—'}</div>
              {isQuote ? (vm.validUntil && <div className="text-slate-500">Valid to {fmtDate(vm.validUntil)}</div>) : isOrder ? (vm.dueDate && <div className="text-slate-500">Expected {fmtDate(vm.dueDate)}</div>) : (vm.dueDate && <div className="text-slate-500">Due {fmtDate(vm.dueDate)}</div>)}
              {!isQuote && !isOrder && vm.template?.showPaymentStatus !== false && <div className="text-slate-500">{vm.paid == null ? '' : `Paid ${fmtMoney(vm.paid)}`}</div>}
            </div>
          </div>
        </div>

        <div style={{ height: 2, background: primary }} className="mb-5" />

        {/* CUSTOMER */}
        <div className={`grid gap-4 mb-5 ${t.customerBlockLayout === 'side-by-side' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: muted }}>{isQuote ? (t.preparedForLabel || 'PREPARED FOR') : isOrder ? 'SOLD TO' : 'BILL TO'}</div>
            <div className="font-semibold">{party.name || '—'}</div>
            {party.address && <div className="text-[12px]" style={{ color: muted }}>{party.address}</div>}
            <div className="text-[12px] text-slate-500">{[party.email, party.phone].filter(Boolean).join(' • ')}</div>
          </div>
          {!isQuote && !isOrder && t.showDeliveryAddress && party.address && !(t.hideDuplicateDeliveryAddress) ? (
            <div>
              <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: muted }}>DELIVERY / SERVICE ADDRESS</div>
              <div className="font-semibold">{party.name}</div>
              <div className="text-[12px]" style={{ color: muted }}>{party.address}</div>
            </div>
          ) : null}
        </div>

        {/* LINE ITEMS */}
        <table className="w-full text-[13px] mb-5" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: thbg, color: thtext }}>
              <th className="p-2 text-left" style={{ width: 24 }}>#</th>
              {visible.map((c: any) => <th key={c.key} className="p-2 text-left">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((row: any, i: number) => (
              <tr key={i} style={{ background: t.tableStyle === 'striped' && i % 2 ? '#f7f7f7' : undefined, borderBottom: (t.tableStyle === 'minimal' || t.tableStyle === 'modern') ? '1px solid #eee' : t.tableStyle === 'bordered' ? '1px solid #cfd4dc' : '' }}>
                <td className="p-2">{i + 1}</td>
                {visible.map((c: any) => <td key={c.key} className="p-2">{renderLineCell(row, c.key)}</td>)}
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={visible.length + 1} className="p-4 text-center" style={{ color: muted }}>No items</td></tr>}
          </tbody>
        </table>

        {/* TOTALS */}
        <div className="flex justify-end mb-5">
          <div className="w-64 space-y-1" style={{ fontSize: base - 1 }}>
            <div className="flex justify-between"><span style={{ color: muted }}>Subtotal</span><span className="font-medium">{fmtMoney(vm.subtotal ?? 0)}</span></div>
            {vm.discount ? <div className="flex justify-between"><span style={{ color: muted }}>Discount</span><span>− {fmtMoney(vm.discount)}</span></div> : null}
            {vm.taxTotal ? <div className="flex justify-between"><span style={{ color: muted }}>Tax</span><span>{fmtMoney(vm.taxTotal)}</span></div> : null}
            <div className="flex justify-between items-center pt-2 border-t" style={{ borderColor: '#e5e7eb' }}>
              <span className="font-bold" style={{ color: primary, fontSize: base + 4 }}>{isQuote ? 'QUOTE TOTAL' : 'TOTAL'}</span>
              <span className="font-bold" style={{ color: primary, fontSize: base + 4 }}>{fmtMoney(vm.total ?? 0)}</span>
            </div>
            {!isQuote && !isOrder && t.showBalanceDue !== false && (
              <>
                <div className="flex justify-between"><span style={{ color: muted }}>Paid</span><span>{fmtMoney(vm.paid ?? 0)}</span></div>
                <div className="flex justify-between pt-1"><span className="font-semibold" style={{ color: secondary }}>Balance Due</span><span className="font-semibold" style={{ color: secondary }}>{fmtMoney(balance)}</span></div>
              </>
            )}
          </div>
        </div>

        {/* NOTES / VALIDITY / TERMS / ACCEPTANCE */}
        {(isQuote ? t.showValidity !== false : t.showNotes !== false) && (isQuote ? applyTokens(t.validityMessage || '', tokData) : vm.notes) && (
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: muted }}>{isQuote ? 'QUOTE VALIDITY' : 'NOTES'}</div>
            <div className="whitespace-pre-line" style={{ fontSize: base - 1 }}>{isQuote ? applyTokens(t.validityMessage || '', tokData) : vm.notes}</div>
          </div>
        )}
        {!isQuote && t.showStatementMemo !== false && vm.statementMemo && (
          <div className="mb-3"><div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: muted }}>STATEMENT MEMO</div><div className="whitespace-pre-line" style={{ fontSize: base - 1 }}>{vm.statementMemo}</div></div>
        )}
        {(isQuote ? t.quoteTerms : t.invoiceTerms) && (
          <div className="mb-3"><div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: muted }}>TERMS & CONDITIONS</div><div className="whitespace-pre-line" style={{ fontSize: base - 1 }}>{isQuote ? applyTokens(t.quoteTerms, tokData) : applyTokens(t.invoiceTerms, tokData)}</div></div>
        )}
        {isQuote && t.showAcceptanceSection && (
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: muted }}>ACCEPTANCE</div>
            <div className="space-y-3 text-[12px]">
              <div>Customer Name: ______________________</div>
              <div>Signature: __________________________</div>
              <div>Date: ______________________________</div>
              {t.acceptanceNotesAllowed && <div>Purchase Order No: _______________________</div>}
            </div>
          </div>
        )}
        {/* FISCAL (invoice) */}
        {!isQuote && t.showFiscalInformation !== false && vm.fiscalInfo && (
          <div className="mb-3"><div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: muted }}>FISCAL INFORMATION {vm.sample ? '' : ''}</div>
            <div className="text-[12px]" style={{ color: muted }}>
              Receipt {vm.fiscalInfo.receiptId || '—'} · Day {vm.fiscalInfo.dayNo ?? '—'} · Device {vm.fiscalInfo.deviceId || '—'} · Status {vm.fiscalInfo.status || '—'}
            </div>
            {vm.sample && <div className="text-[10px] italic text-amber-600">Test/mock fiscalisation shown — not official ZIMRA production.</div>}
          </div>
        )}

        {/* FOOTER */}
        <div className="mt-6 pt-4 border-t" style={{ borderColor: '#e5e7eb' }}>
          <div className="text-[13px]" style={{ textAlign: t.footerAlignment || 'center', color: text }}>{applyTokens(isQuote ? t.quoteFooterMessage : t.footerMessage, tokData)}</div>
          {t.footerShowPageNumber && <div className="text-[11px] mt-1 text-right" style={{ color: muted }}>Page 1 of 1</div>}
        </div>
      </div>
    </div>
  );
}

