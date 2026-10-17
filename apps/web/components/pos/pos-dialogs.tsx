'use client';

import { useEffect, useState } from 'react';
import { Button, Drawer, Input, InputNumber, Modal, Select } from 'antd';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { EXTERNAL, METHOD_LABEL, money, newKey, round, type Pos, type PosTender } from './use-pos';

export function PaymentDrawer({ pos, open, onClose }: { pos: Pos; open: boolean; onClose: () => void }) {
  const { due, currency, busy, online, walkIn, can, settings } = pos;
  const [tenders, setTenders] = useState<PosTender[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setTenders([{ key: newKey(), method: 'CASH', amount: due, reference: '' }]); setNote(''); } }, [open, due]);

  const tendered = round(tenders.reduce((s, t) => s + Number(t.amount || 0), 0));
  const nonCash = round(tenders.filter((t) => t.method !== 'CASH').reduce((s, t) => s + Number(t.amount || 0), 0));
  const cashIn = round(tenders.filter((t) => t.method === 'CASH').reduce((s, t) => s + Number(t.amount || 0), 0));
  const change = round(Math.max(0, cashIn - Math.max(0, due - nonCash)));
  const shortBy = round(Math.max(0, due - tendered));
  const problem = (() => {
    if (shortBy > 0.009) return `Still ${money(shortBy, currency)} to collect`;
    if (nonCash > due + 0.009) return 'Card, bank, mobile and account amounts cannot exceed the balance. Only cash gives change.';
    if (tenders.filter((t) => t.method === 'CASH').length > 1) return 'Use one cash line';
    const missing = tenders.find((t) => EXTERNAL.has(t.method) && !t.reference.trim());
    if (missing) return `Enter the ${METHOD_LABEL[missing.method].toLowerCase()} approval reference`;
    if (tenders.some((t) => t.method === 'CREDIT') && walkIn) return 'Choose a named customer to sell on account';
    return '';
  })();
  const methods = ['CASH', 'CARD', 'BANK', 'MOBILE', ...(can('pos.credit') && settings.allowCredit ? ['CREDIT'] : [])];
  const set = (key: string, patch: Partial<PosTender>) => setTenders((prev) => prev.map((x) => x.key === key ? { ...x, ...patch } : x));

  return (
    <Drawer open={open} onClose={() => !busy && onClose()} title={`Take payment · ${money(due, currency)}`} width={440}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {methods.map((m) => (
            <button key={m} type="button" className="h-12 rounded-xl border border-[#cbd5e1] text-[13px] font-medium hover:border-[#003366]"
              onClick={() => {
                const rest = round(Math.max(0, due - tenders.filter((t) => Number(t.amount) > 0 && t.method !== m).reduce((s, t) => s + Number(t.amount || 0), 0)));
                setTenders((prev) => {
                  const existing = prev.find((t) => t.method === m);
                  if (existing) return prev.map((t) => t.key === existing.key ? { ...t, amount: rest } : t);
                  const blank = prev.find((t) => !Number(t.amount));
                  if (blank) return prev.map((t) => t.key === blank.key ? { ...t, method: m, amount: rest } : t);
                  return [...prev, { key: newKey(), method: m, amount: shortBy || rest, reference: '' }];
                });
              }}>{METHOD_LABEL[m]}</button>
          ))}
        </div>
        {tenders.map((t) => (
          <div key={t.key} className="rounded-xl border border-[#e2e8f0] p-3">
            <div className="flex items-center gap-2">
              <Select className="flex-1" value={t.method} options={methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} onChange={(v) => set(t.key, { method: v })} />
              {tenders.length > 1 && <button type="button" aria-label="Remove payment" className="flex h-9 w-9 items-center justify-center opacity-60" onClick={() => setTenders((prev) => prev.filter((x) => x.key !== t.key))}><Trash2 size={15} /></button>}
            </div>
            <InputNumber className="!mt-2 !w-full" size="large" min={0} value={t.amount ?? undefined} prefix={currency} onChange={(v) => set(t.key, { amount: v == null ? null : Number(v) })} />
            {t.method === 'CASH' && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(() => {
                  const need = round(Math.max(0, due - (tendered - Number(t.amount || 0))));
                  return [need, ...[5, 10, 20, 50, 100].filter((n) => n > need)].slice(0, 5).map((n, i) => (
                    <Button key={`${n}-${i}`} size="small" onClick={() => set(t.key, { amount: n })}>{i === 0 ? 'Exact' : money(n, currency)}</Button>
                  ));
                })()}
              </div>
            )}
            {EXTERNAL.has(t.method) && <Input className="!mt-2" value={t.reference} placeholder="Approval reference from the terminal" onChange={(e) => set(t.key, { reference: e.target.value })} />}
          </div>
        ))}
        <Button block icon={<Plus size={14} />} onClick={() => setTenders((prev) => [...prev, { key: newKey(), method: prev.some((x) => x.method === 'CASH') ? 'CARD' : 'CASH', amount: shortBy || null, reference: '' }])}>Split payment</Button>
        {tenders.some((t) => EXTERNAL.has(t.method)) && <p className="text-[12px] opacity-70">NexusERP does not contact the card or mobile-money provider. Enter the reference only after the terminal approves the charge.</p>}
        <div className="rounded-xl bg-[rgba(100,116,139,0.1)] p-3 text-[13px]">
          <div className="flex justify-between"><span>Tendered</span><span>{money(tendered, currency)}</span></div>
          <div className="flex justify-between text-[15px] font-semibold"><span>Change</span><span>{money(change, currency)}</span></div>
        </div>
        {problem && <div className="text-[13px] text-[#d97706]">{problem}</div>}
        <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
        <Button type="primary" block size="large" loading={busy} disabled={!online || !!problem} className="!h-12" onClick={async () => { if (await pos.pay(tenders, note)) onClose(); }}>Complete sale</Button>
      </div>
    </Drawer>
  );
}

export function HeldDrawer({ pos, open, onClose }: { pos: Pos; open: boolean; onClose: () => void }) {
  useEffect(() => { if (open) pos.loadHeld(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Drawer open={open} onClose={onClose} title="Held carts" width={420}>
      {!pos.held.length && <div className="py-10 text-center text-[13px] opacity-60">No carts on hold.</div>}
      {pos.held.map((h) => (
        <button key={h.id} type="button" onClick={async () => { if (await pos.recall(h)) onClose(); }} className="mb-2 flex w-full items-center justify-between rounded-xl border border-[#e2e8f0] p-3 text-left">
          <div>
            <div className="text-[13px] font-semibold">{h.saleNo}</div>
            <div className="text-[12px] opacity-60">{h.lines?.length || 0} items · {new Date(h.createdAt).toLocaleTimeString()}{h.customer ? ` · ${h.customer.name}` : ''}</div>
          </div>
          <span className="text-[13px] font-semibold">{money(Number(h.total), pos.currency)}</span>
        </button>
      ))}
    </Drawer>
  );
}

export function ShiftModal({ pos, open, onClose }: { pos: Pos; open: boolean; onClose: () => void }) {
  const [float, setFloat] = useState<number | null>(0);
  return (
    <Modal open={open} title={`Open shift on ${pos.register?.name || 'register'}`} onCancel={onClose} okText="Open shift" confirmLoading={pos.busy}
      okButtonProps={{ disabled: !pos.can('pos.shifts.open') }} onOk={async () => { if (await pos.openShift(float || 0)) onClose(); }}>
      <div className="mb-2 text-[13px]">{pos.can('pos.shifts.open') ? 'Count the cash in the drawer before you start.' : 'Ask a supervisor to open a shift on this register.'}</div>
      <InputNumber className="!w-full" size="large" min={0} prefix={pos.currency} value={float ?? undefined} onChange={(v) => setFloat(v == null ? null : Number(v))} />
    </Modal>
  );
}

export function DepositModal({ pos, open, onClose }: { pos: Pos; open: boolean; onClose: () => void }) {
  const [d, setD] = useState<PosTender>({ key: 'dep', method: 'CASH', amount: null, reference: '' });
  useEffect(() => { if (open) setD({ key: 'dep', method: 'CASH', amount: null, reference: '' }); }, [open]);
  return (
    <Modal open={open} title="Take deposit" onCancel={onClose} okText="Record deposit" confirmLoading={pos.busy} onOk={async () => { if (await pos.takeDeposit(d)) onClose(); }}>
      <Select className="mb-2 w-full" value={d.method} options={['CASH', 'CARD', 'BANK', 'MOBILE'].map((m) => ({ value: m, label: METHOD_LABEL[m] }))} onChange={(v) => setD((x) => ({ ...x, method: v }))} />
      <InputNumber className="!mb-2 !w-full" size="large" min={0} max={pos.due || undefined} prefix={pos.currency} value={d.amount ?? undefined} onChange={(v) => setD((x) => ({ ...x, amount: v == null ? null : Number(v) }))} />
      {EXTERNAL.has(d.method) && <Input value={d.reference} placeholder="Approval reference" onChange={(e) => setD((x) => ({ ...x, reference: e.target.value }))} />}
      <p className="mt-2 text-[12px] opacity-70">The deposit posts as a customer receipt now and is applied to the invoice when the job is paid.</p>
    </Modal>
  );
}

export function ReceiptDrawer({ pos }: { pos: Pos }) {
  const sale = pos.receipt;
  return (
    <Drawer open={!!sale} onClose={() => pos.setReceipt(null)} title={sale ? `Receipt ${sale.saleNo}` : 'Receipt'} width={420}
      extra={<Button icon={<Printer size={14} />} onClick={() => window.print()}>Print</Button>}>
      {sale && <PosReceipt sale={sale} company={pos.boot?.company} branch={pos.boot?.branch} currency={pos.currency} />}
    </Drawer>
  );
}

export function PosReceipt({ sale, company, branch, currency }: { sale: any; company?: any; branch?: any; currency: string }) {
  const lines = (sale.lines || []).filter((l: any) => !l.voided);
  const change = (sale.tenders || []).reduce((s: number, t: any) => s + Number(t.changeAmount || 0), 0);
  return (
    <div id="pos-receipt" className="mx-auto max-w-[80mm] rounded bg-white p-3 font-mono text-[12px] leading-5 text-black">
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } body * { visibility: hidden !important; } #pos-receipt, #pos-receipt * { visibility: visible !important; } #pos-receipt { position: absolute; left: 0; top: 0; width: 74mm; max-width: 74mm; padding: 0; } }`}</style>
      <div className="text-center">
        <div className="text-[14px] font-bold">{company?.legalName || 'NexusERP'}</div>
        {branch?.name && <div>{branch.name}</div>}
        <div>{new Date(sale.completedAt || sale.createdAt).toLocaleString()}</div>
        <div>Sale {sale.saleNo}{sale.invoice?.invoiceNo ? ` · Inv ${sale.invoice.invoiceNo}` : ''}</div>
        {sale.customer?.name && <div>{sale.customer.name}</div>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      {lines.map((l: any) => (
        <div key={l.id}>
          <div className="truncate">{l.description}</div>
          <div className="flex justify-between"><span>{Number(l.quantity)} × {Number(l.unitPrice).toFixed(2)}{Number(l.discount) > 0 ? ` −${Number(l.discount).toFixed(2)}` : ''}</span><span>{Number(l.lineTotal).toFixed(2)}</span></div>
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-black" />
      {Number(sale.discountTotal) > 0 && <div className="flex justify-between"><span>Discount</span><span>{Number(sale.discountTotal).toFixed(2)}</span></div>}
      <div className="flex justify-between"><span>Tax</span><span>{Number(sale.taxTotal).toFixed(2)}</span></div>
      {Number(sale.tip) > 0 && <div className="flex justify-between"><span>Tip</span><span>{Number(sale.tip).toFixed(2)}</span></div>}
      <div className="flex justify-between text-[14px] font-bold"><span>TOTAL {currency}</span><span>{Number(sale.total).toFixed(2)}</span></div>
      {(sale.tenders || []).map((t: any) => (
        <div key={t.id} className="flex justify-between"><span>{t.kind === 'DEPOSIT' ? 'Deposit ' : ''}{METHOD_LABEL[t.method] || t.method}{t.reference ? ` ${t.reference}` : ''}</span><span>{Number(t.amount).toFixed(2)}</span></div>
      ))}
      {change > 0 && <div className="flex justify-between"><span>Change</span><span>{change.toFixed(2)}</span></div>}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">
        {sale.fiscalStatus === 'FISCALISED' && <div>Fiscalised{sale.invoice?.fiscalReceiptNo ? ` · ${sale.invoice.fiscalReceiptNo}` : ''}</div>}
        {sale.fiscalStatus === 'FAILED' && <div>Fiscal submission pending retry</div>}
        {sale.fiscalStatus === 'PENDING' && <div>Fiscal receipt to follow</div>}
        <div>Thank you</div>
      </div>
    </div>
  );
}

/** Product image or a coloured initial tile when the item has no picture. */
export function ItemArt({ name, imageUrl, className = '' }: { name: string; imageUrl?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hues = [24, 200, 150, 280, 340, 45, 175, 260];
  const hue = hues[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % hues.length];
  if (imageUrl && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} className={`h-full w-full object-cover ${className}`} />;
  }
  return (
    <div className={`flex h-full w-full items-center justify-center text-[26px] font-semibold ${className}`} style={{ background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 35%)` }}>
      {name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
    </div>
  );
}
