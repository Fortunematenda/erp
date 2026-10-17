'use client';

import { useEffect, useMemo, useState } from 'react';
import { InputNumber, Modal, Select } from 'antd';
import { Check, ClipboardList, Search, Wallet, Wifi, WifiOff, X } from 'lucide-react';
import { api } from '@/lib/api';
import { DepositModal, HeldDrawer, PaymentDrawer, ReceiptDrawer, ShiftModal } from './pos-dialogs';
import { PosDark } from './pos-dark';
import { money, round, usePos, type PosLine } from './use-pos';
import { notify } from '@/lib/notify';

type Tab = 'pros' | 'services' | 'products' | 'jobs';
const TIP_STEPS = [0, 10, 15, 20];
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const hue = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

export function ServiceTerminal() {
  const pos = usePos('SERVICE');
  const { currency, lines, items, staff, staffId, setStaffId, search, setSearch, category, setCategory, categories, qtyInCart, order } = pos;
  const [tab, setTab] = useState<Tab>('services');
  const [tipPct, setTipPct] = useState<number | 'custom'>(0);
  const [customTip, setCustomTip] = useState<number | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);

  useEffect(() => { if (order && staff.length && !staffId) setTab('services'); }, [order, staff.length, staffId]);
  useEffect(() => {
    if (tab !== 'jobs' || !pos.boot) return;
    api(`/pos/orders?mode=SERVICE&cart=ACTIVE&branchId=${pos.boot.branch.id}`).then(setJobs).catch((e) => notify.error(e.message));
  }, [tab, pos.boot]);

  useEffect(() => {
    const t = tipPct === 'custom' ? Number(customTip || 0) : round(pos.goods * tipPct / 100);
    pos.setTip(t);
  }, [tipPct, customTip, pos.goods]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!lines.length) { setTipPct(0); setCustomTip(null); } }, [lines.length]);

  const services = items.filter((i) => i.type === 'SERVICE' && (!category || i.category === category));
  const products = items.filter((i) => i.type !== 'SERVICE' && (!category || i.category === category));
  const proName = (id?: string | null) => staff.find((s) => s.id === id)?.name || 'Unassigned';
  const groups = useMemo(() => {
    const map = new Map<string, PosLine[]>();
    for (const l of lines) map.set(l.staffId || '', [...(map.get(l.staffId || '') || []), l]);
    return [...map.entries()];
  }, [lines]);

  function startPayment() {
    const blocker = pos.paymentBlocker();
    if (blocker === 'SHIFT') { setShiftOpen(true); return; }
    if (blocker) { notify.warning(blocker); return; }
    setPayOpen(true);
  }

  const tile = (item: any) => {
    const inCart = qtyInCart.get(item.id);
    return (
      <button key={item.id} type="button" onClick={() => pos.add(item)} disabled={pos.busy}
        className={`flex min-h-[96px] flex-col justify-between rounded-xl border p-3 text-left transition active:scale-[0.98] ${inCart ? 'border-[#3b82f6] bg-[#2563eb] text-white' : 'border-[#2a2f3a] bg-[#1c1f26] text-[#e5e7eb] hover:border-[#3f4654]'}`}>
        <div className="line-clamp-2 text-[14px] font-semibold leading-snug">{item.name}</div>
        <div className="mt-2 flex items-end justify-between text-[12px]">
          <span className={inCart ? 'text-[#dbeafe]' : 'text-[#9ca3af]'}>{inCart ? `${inCart} in order` : item.category || (item.type === 'SERVICE' ? 'Service' : item.unit || 'Product')}</span>
          <span className="text-[15px] font-semibold">{money(item.price, currency)}</span>
        </div>
      </button>
    );
  };

  return (
    <PosDark accent="#3b82f6">
      <div className="flex h-dvh flex-col bg-[#111318] text-[#e5e7eb]">
        <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-4 pb-2 pt-4 sm:px-6">
          <button type="button" aria-label="Back to ERP" className="flex h-10 w-10 items-center justify-center rounded-full text-[#9ca3af] hover:bg-[#1c1f26]" onClick={() => pos.router.push('/pos')}><X size={20} /></button>
          <nav className="flex gap-5 overflow-x-auto text-[18px] font-semibold sm:text-[22px]">
            {([['pros', 'Professionals'], ['services', 'Services'], ['products', 'Products'], ['jobs', 'Jobs']] as [Tab, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`shrink-0 ${tab === k ? 'text-white' : 'text-[#6b7280] hover:text-[#9ca3af]'}`}>{label}</button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Select className="w-[150px]" placeholder="Register" value={pos.registerId} allowClear onChange={pos.setRegisterId}
              options={(pos.boot?.registers || []).map((r: any) => ({ value: r.id, label: `${r.name}${r.shifts?.[0] ? '' : ' · closed'}` }))} />
            {pos.online ? <Wifi size={18} className="text-[#22c55e]" /> : <WifiOff size={18} className="text-[#ef4444]" />}
          </div>
        </header>
        {!pos.online && <div className="mx-4 rounded-lg bg-[#451a03] px-3 py-2 text-[13px] text-[#fed7aa] sm:mx-6">Connection lost. Charging is unavailable until you are back online.</div>}
        {pos.needsShift && pos.online && <div className="mx-4 rounded-lg bg-[#172554] px-3 py-2 text-[13px] text-[#bfdbfe] sm:mx-6">{pos.register?.name} has no open shift. <button type="button" className="font-semibold underline" onClick={() => setShiftOpen(true)}>Open shift</button></div>}

        <div className="grid min-h-0 flex-1 gap-4 p-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <main className="flex min-h-0 flex-col">
            {tab !== 'pros' && tab !== 'jobs' && (
              <div className="mb-3 flex gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code" className="h-11 w-full rounded-xl border border-[#2a2f3a] bg-[#1c1f26] pl-9 pr-3 text-[14px] text-white outline-none placeholder:text-[#6b7280] focus:border-[#3b82f6]" />
                </div>
                <Select className="w-[170px]" size="large" value={category} onChange={setCategory} options={[{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]} />
              </div>
            )}
            {staffId && tab !== 'pros' && (
              <div className="mb-3 flex items-center gap-2 text-[13px] text-[#9ca3af]">
                Adding for <span className="rounded-full bg-[#1e293b] px-2.5 py-1 font-medium text-white">{proName(staffId)}</span>
                <button type="button" className="text-[#60a5fa]" onClick={() => setTab('pros')}>Change</button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-0">
              {tab === 'pros' && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {[{ id: '', name: 'No professional' }, ...staff].map((s) => (
                    <button key={s.id || 'none'} type="button" onClick={() => { setStaffId(s.id || undefined); setTab('services'); }}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left ${(staffId || '') === s.id ? 'border-[#3b82f6] bg-[#172554]' : 'border-[#2a2f3a] bg-[#1c1f26]'}`}>
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white" style={{ background: s.id ? `hsl(${hue(s.name)} 45% 40%)` : '#374151' }}>{s.id ? initials(s.name) : '—'}</span>
                      <span className="min-w-0 truncate text-[14px] font-medium">{s.name}</span>
                      {(staffId || '') === s.id && <Check size={16} className="ml-auto shrink-0 text-[#60a5fa]" />}
                    </button>
                  ))}
                  {!staff.length && <div className="col-span-full text-[13px] text-[#9ca3af]">No staff found. Add employees in HR to assign services to them.</div>}
                </div>
              )}
              {tab === 'services' && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{services.map(tile)}{!services.length && <div className="col-span-full text-[13px] text-[#9ca3af]">No services match. Service items are inventory items of type Service.</div>}</div>}
              {tab === 'products' && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{products.map(tile)}{!products.length && <div className="col-span-full text-[13px] text-[#9ca3af]">No products match.</div>}</div>}
              {tab === 'jobs' && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {jobs.map((j) => (
                    <button key={j.id} type="button" onClick={() => pos.router.replace(`/pos/terminal/services?order=${j.id}`)} className="rounded-xl border border-[#2a2f3a] bg-[#1c1f26] p-3 text-left hover:border-[#3f4654]">
                      <div className="flex justify-between text-[14px] font-semibold"><span>{j.saleNo}</span><span>{money(Number(j.total), currency)}</span></div>
                      <div className="text-[12px] text-[#9ca3af]">{j.customer?.name || 'No customer'} · {String(j.orderStatus).replace('_', ' ').toLowerCase()}</div>
                      <div className="mt-1 line-clamp-2 text-[12px] text-[#d1d5db]">{(j.lines || []).map((l: any) => l.description).join(', ')}</div>
                    </button>
                  ))}
                  {!jobs.length && <div className="text-[13px] text-[#9ca3af]">No open jobs. Build an order and choose Save job.</div>}
                </div>
              )}
            </div>
          </main>

          <aside className="hidden min-h-0 flex-col lg:flex">
            <OrderPanel pos={pos} groups={groups} proName={proName} tipPct={tipPct} setTipPct={setTipPct} customTip={customTip} setCustomTip={setCustomTip}
              onCharge={startPayment} onDeposit={() => setDepositOpen(true)} onHeld={() => setHeldOpen(true)} />
          </aside>
        </div>

        <MobileOrder pos={pos}>
          <OrderPanel pos={pos} groups={groups} proName={proName} tipPct={tipPct} setTipPct={setTipPct} customTip={customTip} setCustomTip={setCustomTip}
            onCharge={startPayment} onDeposit={() => setDepositOpen(true)} onHeld={() => setHeldOpen(true)} />
        </MobileOrder>
        <PaymentDrawer pos={pos} open={payOpen} onClose={() => setPayOpen(false)} />
        <HeldDrawer pos={pos} open={heldOpen} onClose={() => setHeldOpen(false)} />
        <ShiftModal pos={pos} open={shiftOpen} onClose={() => setShiftOpen(false)} />
        <DepositModal pos={pos} open={depositOpen} onClose={() => setDepositOpen(false)} />
        <ReceiptDrawer pos={pos} />
      </div>
    </PosDark>
  );
}

function OrderPanel({ pos, groups, proName, tipPct, setTipPct, customTip, setCustomTip, onCharge, onDeposit, onHeld }: {
  pos: ReturnType<typeof usePos>; groups: [string, PosLine[]][]; proName: (id?: string | null) => string;
  tipPct: number | 'custom'; setTipPct: (v: number | 'custom') => void; customTip: number | null; setCustomTip: (v: number | null) => void;
  onCharge: () => void; onDeposit: () => void; onHeld: () => void;
}) {
  const { currency, order, lines } = pos;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[16px] font-semibold text-white">{order ? `Job ${order.saleNo}` : 'Your order'}</div>
        {order && <button type="button" className="text-[13px] text-[#60a5fa]" onClick={pos.closeOrder}>Close job</button>}
      </div>
      <Select className="mb-3 w-full" showSearch optionFilterProp="label" placeholder="Customer" value={pos.customerId} disabled={pos.deposits > 0}
        options={pos.customers.map((c) => ({ value: c.id, label: c.id === pos.settings.walkInCustomerId ? `${c.name} (walk-in)` : c.name }))} onChange={pos.setCustomerId} />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {!lines.length && <div className="rounded-xl border border-dashed border-[#2a2f3a] p-6 text-center text-[13px] text-[#6b7280]">Pick a professional, then tap services and products.</div>}
        {groups.map(([id, ls]) => {
          const sum = ls.reduce((s, l) => s + l.price * l.qty - l.discount, 0);
          const name = proName(id);
          return (
            <div key={id || 'none'} className="rounded-xl border border-[#2a2f3a] bg-[#1c1f26] p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold text-white" style={{ background: id ? `hsl(${hue(name)} 45% 40%)` : '#374151' }}>{id ? initials(name) : '—'}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-white">{name}</div>
                  <div className="truncate text-[12px] text-[#9ca3af]">{ls.map((l) => l.name).join(', ')}</div>
                </div>
                <span className="text-[14px] font-semibold text-white">{money(sum, currency)}</span>
              </div>
              <div className="mt-2 space-y-1 border-t border-[#2a2f3a] pt-2">
                {ls.map((l) => (
                  <div key={l.key} className="flex items-center justify-between gap-2 text-[12px] text-[#9ca3af]">
                    <span className="truncate">{l.qty > 1 ? `${l.qty} × ` : ''}{l.name}{l.sent ? ' · sent' : ''}</span>
                    <span className="flex shrink-0 items-center gap-2">{money(l.price * l.qty - l.discount, currency)}
                      <button type="button" aria-label={`Remove ${l.name}`} className="flex h-7 w-7 items-center justify-center rounded text-[#6b7280] hover:bg-[#2a2f3a] hover:text-white" onClick={() => pos.remove(l)}><X size={13} /></button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 rounded-xl border border-[#2a2f3a] bg-[#1c1f26] p-3">
        <div className="mb-2 text-[12px] text-[#9ca3af]">Tip</div>
        <div className="grid grid-cols-5 gap-1.5">
          {TIP_STEPS.map((p) => (
            <button key={p} type="button" disabled={!lines.length} onClick={() => setTipPct(p)}
              className={`h-9 rounded-lg text-[13px] font-medium ${tipPct === p ? 'bg-white text-[#111318]' : 'bg-[#2a2f3a] text-[#d1d5db]'}`}>{p ? `${p}%` : 'None'}</button>
          ))}
          <button type="button" disabled={!lines.length} onClick={() => setTipPct('custom')} className={`h-9 rounded-lg text-[13px] font-medium ${tipPct === 'custom' ? 'bg-white text-[#111318]' : 'bg-[#2a2f3a] text-[#d1d5db]'}`}>Custom</button>
        </div>
        {tipPct === 'custom' && <InputNumber className="!mt-2 !w-full" min={0} prefix={currency} value={customTip ?? undefined} onChange={(v) => setCustomTip(v == null ? null : Number(v))} />}
        <div className="mt-3 space-y-0.5 text-[13px] text-[#9ca3af]">
          <div className="flex justify-between"><span>Tax</span><span>{money(pos.taxTotal, currency)}</span></div>
          {pos.tip > 0 && <div className="flex justify-between"><span>Tip</span><span>{money(pos.tip, currency)}</span></div>}
          {pos.deposits > 0 && <div className="flex justify-between"><span>Deposits paid</span><span>−{money(pos.deposits, currency)}</span></div>}
        </div>
        <div className="mt-1 flex items-end justify-between">
          <div><div className="text-[13px] text-[#d1d5db]">Total price</div><div className="text-[11px] text-[#6b7280]">Including taxes{pos.tip > 0 ? ' and tip' : ''}</div></div>
          <div className="text-[24px] font-semibold text-white">{money(pos.total, currency)}</div>
        </div>
        {pos.quoteError && <div className="mt-2 text-[12px] text-[#f87171]">{pos.quoteError}</div>}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {!order && <button type="button" disabled={!lines.length || pos.busy} onClick={() => pos.saveAsOrder()} className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-[#2a2f3a] text-[12px] text-[#d1d5db] disabled:opacity-40"><ClipboardList size={16} />Save job</button>}
          {order && <button type="button" disabled={pos.busy} onClick={onDeposit} className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-[#2a2f3a] text-[12px] text-[#d1d5db]"><Wallet size={16} />Deposit</button>}
          {!order && <button type="button" disabled={!lines.length || pos.busy || !pos.can('pos.hold')} onClick={pos.hold} className="h-14 rounded-xl border border-[#2a2f3a] text-[12px] text-[#d1d5db] disabled:opacity-40">Hold</button>}
          {!order && <button type="button" disabled={!pos.can('pos.hold')} onClick={onHeld} className="h-14 rounded-xl border border-[#2a2f3a] text-[12px] text-[#d1d5db] disabled:opacity-40">Held</button>}
        </div>
        <button type="button" disabled={!lines.length || !pos.online || pos.busy} onClick={onCharge}
          className="mt-2 h-12 w-full rounded-xl bg-white text-[15px] font-semibold text-[#111318] disabled:opacity-40">
          {pos.needsShift ? 'Open shift to charge' : `Charge ${money(pos.due, currency)}`}
        </button>
      </div>
    </div>
  );
}

function MobileOrder({ pos, children }: { pos: ReturnType<typeof usePos>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fixed inset-x-3 bottom-3 z-10 flex h-14 items-center justify-between rounded-2xl bg-white px-4 text-[#111318] shadow-lg lg:hidden" onClick={() => setOpen(true)}>
        <span>{pos.lines.length} in order</span><span className="font-semibold">{money(pos.due, pos.currency)}</span>
      </button>
      <Modal open={open} onCancel={() => setOpen(false)} footer={null} width="100%" style={{ top: 8, maxWidth: 480 }} styles={{ body: { height: '84dvh' } }} className="lg:hidden">{children}</Modal>
    </>
  );
}
