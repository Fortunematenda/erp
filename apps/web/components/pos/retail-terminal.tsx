'use client';

import { useEffect, useRef, useState } from 'react';
import { Dropdown, Modal, Select } from 'antd';
import { ArrowLeft, Barcode, Delete, Plus, Search, ShoppingBag, UserRound, Wifi, WifiOff } from 'lucide-react';
import { ItemArt, HeldDrawer, PaymentDrawer, ReceiptDrawer, ShiftModal } from './pos-dialogs';
import { money, round, usePos, type PosLine } from './use-pos';
import { notify } from '@/lib/notify';

type NumMode = 'qty' | 'disc' | 'price';
const TILE_COLORS = ['#fde2c8', '#fbd5d5', '#d9f2e3', '#dbeafe', '#ede9fe', '#fef3c7', '#cffafe', '#fce7f3'];

export function RetailTerminal() {
  const pos = usePos('RETAIL');
  const { boot, currency, lines, shown, categories, category, setCategory, search, setSearch, qtyInCart, online, can } = pos;
  const [selected, setSelected] = useState<string | null>(null);
  const [numMode, setNumMode] = useState<NumMode>('qty');
  const [buffer, setBuffer] = useState('');
  const [pcts, setPcts] = useState<Record<string, number>>({});
  const [payOpen, setPayOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const line = lines.find((l) => l.key === selected) || null;
  useEffect(() => { if (selected && !lines.some((l) => l.key === selected)) setSelected(lines.at(-1)?.key || null); }, [lines, selected]);
  useEffect(() => { setBuffer(''); }, [selected, numMode]);

  function tap(item: any) {
    const key = pos.add(item);
    if (key) setSelected(key);
  }

  function applyValue(l: PosLine, raw: string) {
    const v = Number(raw);
    if (raw === '' || Number.isNaN(v)) return;
    if (numMode === 'qty') {
      if (v <= 0) return;
      const pct = pcts[l.key];
      pos.patchLine(l.key, { qty: v, ...(pct ? { discount: round(l.price * v * pct / 100) } : {}) });
    } else if (numMode === 'disc') {
      const pct = Math.min(100, v);
      setPcts((p) => ({ ...p, [l.key]: pct }));
      pos.patchLine(l.key, { discount: round(l.price * l.qty * pct / 100) });
    } else {
      pos.patchLine(l.key, { price: v, discount: pcts[l.key] ? round(v * l.qty * pcts[l.key] / 100) : l.discount });
    }
  }

  function press(key: string) {
    if (!line) { notify.info('Tap a product first'); return; }
    if (key === 'back') {
      if (!buffer) { pos.remove(line); return; }
      const next = buffer.slice(0, -1);
      setBuffer(next);
      applyValue(line, next);
      return;
    }
    if (key === 'clear') {
      setBuffer('');
      if (numMode === 'disc') { setPcts((p) => { const n = { ...p }; delete n[line.key]; return n; }); pos.patchLine(line.key, { discount: 0 }); }
      return;
    }
    if (key === '.' && buffer.includes('.')) return;
    const next = buffer + key;
    setBuffer(next);
    applyValue(line, next);
  }

  function chooseMode(m: NumMode) {
    if (m === 'disc' && !can('pos.discount')) { notify.warning('You do not have permission to give discounts'); return; }
    if (m === 'price' && !can('pos.price.override')) { notify.warning('You do not have permission to change prices'); return; }
    setNumMode(m);
  }

  function startPayment() {
    const blocker = pos.paymentBlocker();
    if (blocker === 'SHIFT') { setShiftOpen(true); return; }
    if (blocker) { notify.warning(blocker); return; }
    setPayOpen(true);
    setCartOpen(false);
  }

  const customerName = pos.customers.find((c) => c.id === pos.customerId)?.name;
  const padKey = 'flex h-12 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[17px] text-[#1e293b] active:bg-[#f1f5f9]';
  const modeKey = (m: NumMode) => `flex h-12 items-center justify-center rounded-lg border text-[14px] ${numMode === m ? 'border-[#0f766e] bg-[#ecfdf5] text-[#0f766e] font-semibold' : 'border-[#e2e8f0] bg-white text-[#1e293b]'}`;

  const orderPanel = (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!lines.length && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[#94a3b8]">
            <ShoppingBag size={36} />
            <div className="text-[13px]">Scan a barcode or tap a product to start the order.</div>
          </div>
        )}
        {lines.map((l) => (
          <button key={l.key} type="button" onClick={() => setSelected(l.key)}
            className={`block w-full border-b border-[#f1f5f9] px-4 py-2.5 text-left ${selected === l.key ? 'bg-[#ecfdf5]' : 'hover:bg-[#f8fafc]'}`}>
            <div className="flex items-start justify-between gap-3">
              <span className="text-[14px] font-medium text-[#0f172a]">{l.name}</span>
              <span className="shrink-0 text-[14px] font-semibold text-[#0f172a]">{money(l.price * l.qty - l.discount, currency)}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#64748b]">
              <span className="rounded border border-[#cbd5e1] px-1.5 font-semibold text-[#0f172a]">{l.qty}</span>
              <span>× {money(l.price, currency)}{l.unit ? ` / ${l.unit}` : ''}</span>
            </div>
            {l.notes && <div className="text-[12px] italic text-[#64748b]">{l.notes}</div>}
            {l.discount > 0 && <div className="text-[12px] text-[#0f766e]">−{money(l.discount, currency)}{pcts[l.key] ? ` · ${pcts[l.key]}% discount` : ' discount'}</div>}
          </button>
        ))}
      </div>
      <div className="border-t border-[#e2e8f0] px-4 py-3">
        {pos.quoteError && <div className="mb-2 rounded bg-[#fef2f2] px-2 py-1 text-[12px] text-[#b91c1c]">{pos.quoteError}</div>}
        <div className="flex justify-between text-[13px] text-[#64748b]"><span>Taxes</span><span>{money(pos.taxTotal, currency)}</span></div>
        <div className="flex justify-between text-[22px] font-semibold text-[#0f172a]"><span>Total</span><span>{money(pos.due, currency)}</span></div>
      </div>
      <div className="space-y-2 border-t border-[#e2e8f0] bg-[#f8fafc] p-3">
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => setCustomerOpen(true)} className={`flex h-11 items-center justify-center gap-1 truncate rounded-lg border bg-white px-2 text-[13px] ${pos.noCustomer ? 'border-[#f59e0b] text-[#b45309]' : 'border-[#e2e8f0] text-[#0f766e]'}`}>
            <UserRound size={14} className="shrink-0" /><span className="truncate">{customerName || 'Customer'}</span>
          </button>
          <button type="button" onClick={() => setNoteOpen(true)} className="h-11 rounded-lg border border-[#e2e8f0] bg-white text-[13px]">Note</button>
          <Dropdown trigger={['click']} menu={{
            items: [
              { key: 'hold', label: 'Hold cart', disabled: !lines.length || !can('pos.hold') },
              { key: 'held', label: 'Held carts', disabled: !can('pos.hold') },
              { key: 'clear', label: 'Clear cart', danger: true, disabled: !lines.length },
            ],
            onClick: ({ key }) => {
              if (key === 'hold') pos.hold();
              if (key === 'held') setHeldOpen(true);
              if (key === 'clear' && window.confirm('Remove every item from this cart?')) pos.setLines([]);
            },
          }}><button type="button" className="h-11 rounded-lg border border-[#e2e8f0] bg-white text-[13px]">Actions</button></Dropdown>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {['1', '2', '3'].map((k) => <button key={k} type="button" className={padKey} onClick={() => press(k)}>{k}</button>)}
          <button type="button" className={modeKey('qty')} onClick={() => chooseMode('qty')}>Qty</button>
          {['4', '5', '6'].map((k) => <button key={k} type="button" className={padKey} onClick={() => press(k)}>{k}</button>)}
          <button type="button" className={modeKey('disc')} onClick={() => chooseMode('disc')}>%</button>
          {['7', '8', '9'].map((k) => <button key={k} type="button" className={padKey} onClick={() => press(k)}>{k}</button>)}
          <button type="button" className={modeKey('price')} onClick={() => chooseMode('price')}>Price</button>
          <button type="button" className="flex h-12 items-center justify-center rounded-lg border border-[#fde68a] bg-[#fef3c7] text-[15px]" onClick={() => press('clear')}>C</button>
          <button type="button" className={padKey} onClick={() => press('0')}>0</button>
          <button type="button" className={padKey} onClick={() => press('.')}>.</button>
          <button type="button" aria-label="Backspace" className="flex h-12 items-center justify-center rounded-lg border border-[#fecaca] bg-[#fee2e2] text-[#b91c1c]" onClick={() => press('back')}><Delete size={18} /></button>
        </div>
        <button type="button" disabled={!lines.length || !online || pos.busy} onClick={startPayment}
          className="h-16 w-full rounded-xl bg-[#0f766e] text-[18px] font-semibold text-white disabled:opacity-40">
          {pos.needsShift ? 'Open shift to sell' : `Payment · ${money(pos.due, currency)}`}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col bg-[#eef1f5]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[#e2e8f0] bg-white px-3">
        <button type="button" aria-label="Back to ERP" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f1f5f9] text-[#334155]" onClick={() => pos.router.push('/pos')}><ArrowLeft size={18} /></button>
        <button type="button" aria-label="New order" title="New order" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f1f5f9] text-[#334155]"
          onClick={() => { if (!lines.length || window.confirm('Start a new order? The current cart will be cleared.')) pos.setLines([]); }}><Plus size={18} /></button>
        <Select className="w-[150px]" placeholder="Register" value={pos.registerId} allowClear onChange={pos.setRegisterId}
          options={(boot?.registers || []).map((r: any) => ({ value: r.id, label: `${r.name}${r.shifts?.[0] ? '' : ' · closed'}` }))} />
        <div className="mx-auto hidden text-[18px] font-semibold tracking-tight text-[#0f766e] md:block">{boot?.company?.legalName || 'NexusERP'} <span className="font-normal text-[#94a3b8]">POS</span></div>
        <div className="relative ml-auto w-full max-w-[320px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="h-10 w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] pl-9 pr-3 text-[14px] outline-none focus:border-[#0f766e]" />
        </div>
        <div className="relative">
          <button type="button" aria-label="Scan barcode" className="flex h-10 w-10 items-center justify-center rounded-lg text-[#334155] hover:bg-[#f1f5f9]" onClick={() => scanRef.current?.focus()}><Barcode size={20} /></button>
          <input ref={scanRef} aria-label="Barcode" className="absolute h-0 w-0 opacity-0" onKeyDown={(e) => { if (e.key === 'Enter') { const el = e.currentTarget; pos.scan(el.value); el.value = ''; } }} />
        </div>
        <span title={online ? 'Online' : 'Offline'}>{online ? <Wifi size={18} className="text-[#16a34a]" /> : <WifiOff size={18} className="text-[#dc2626]" />}</span>
      </header>
      {!online && <div className="bg-[#fff7ed] px-4 py-2 text-[13px] text-[#9a3412]">Connection lost. You can keep building the cart, but payment is unavailable until you are back online.</div>}
      {pos.needsShift && online && <div className="bg-[#eff6ff] px-4 py-2 text-[13px] text-[#1e3a8a]">{pos.register?.name} has no open shift. <button type="button" className="font-semibold underline" onClick={() => setShiftOpen(true)}>Open shift</button></div>}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-[#e2e8f0] lg:block">{orderPanel}</aside>
        <main className="min-h-0 overflow-y-auto p-3 pb-24 lg:pb-3">
          {categories.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] sm:overflow-visible">
              <button type="button" onClick={() => setCategory('')} className={`h-14 min-w-[110px] rounded-lg px-3 text-[14px] font-medium ${!category ? 'bg-[#0f766e] text-white' : 'bg-white text-[#334155]'}`}>All</button>
              {categories.map((c, i) => (
                <button key={c} type="button" onClick={() => setCategory(c === category ? '' : c)}
                  className={`h-14 min-w-[110px] truncate rounded-lg px-3 text-[14px] font-medium ${category === c ? 'ring-2 ring-[#0f766e]' : ''}`} style={{ background: TILE_COLORS[i % TILE_COLORS.length], color: '#1e293b' }}>{c}</button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {shown.map((item) => {
              const inCart = qtyInCart.get(item.id);
              const out = item.tracked && Number(item.onHand) <= 0;
              return (
                <button key={item.id} type="button" onClick={() => tap(item)} disabled={pos.busy}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-[#e2e8f0] bg-white text-left shadow-sm transition active:scale-[0.98]">
                  <div className="aspect-[4/3] w-full overflow-hidden bg-[#f8fafc]"><ItemArt name={item.name} imageUrl={item.imageUrl} className="transition group-hover:scale-105" /></div>
                  <div className="flex min-h-[56px] items-end justify-between gap-1 bg-[#fdf2e9] px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-[13px] font-medium leading-tight text-[#1e293b]">{item.name}</div>
                      <div className="text-[12px] text-[#64748b]">{money(item.price, currency)}{item.tracked ? ` · ${out ? 'out' : `${Number(item.onHand || 0)} left`}` : ''}</div>
                    </div>
                    {inCart ? <span className="text-[26px] font-bold leading-none text-[#334155]">{inCart}</span> : null}
                  </div>
                  {out && <span className="absolute left-2 top-2 rounded bg-[#dc2626] px-1.5 py-0.5 text-[11px] font-semibold text-white">Out of stock</span>}
                </button>
              );
            })}
          </div>
          {!shown.length && <div className="py-16 text-center text-[13px] text-[#64748b]">No products match this search.</div>}
        </main>
      </div>

      <button type="button" className="fixed inset-x-3 bottom-3 z-10 flex h-14 items-center justify-between rounded-2xl bg-[#0f766e] px-4 text-white shadow-lg lg:hidden" onClick={() => setCartOpen(true)}>
        <span className="flex items-center gap-2"><ShoppingBag size={18} /> {lines.length} {lines.length === 1 ? 'item' : 'items'}</span>
        <span className="font-semibold">{money(pos.due, currency)}</span>
      </button>
      <Modal open={cartOpen} onCancel={() => setCartOpen(false)} footer={null} title="Order" width="100%" style={{ top: 8, maxWidth: 520 }} styles={{ body: { padding: 0, height: '82dvh' } }} className="lg:hidden">{orderPanel}</Modal>

      <Modal open={customerOpen} title="Customer" onCancel={() => setCustomerOpen(false)} footer={null}>
        <Select className="w-full" size="large" showSearch optionFilterProp="label" placeholder="Search customers" value={pos.customerId} autoFocus
          options={pos.customers.map((c) => ({ value: c.id, label: c.id === pos.settings.walkInCustomerId ? `${c.name} (walk-in)` : c.name }))}
          onChange={(v) => { pos.setCustomerId(v); setCustomerOpen(false); }} />
        {!pos.settings.walkInCustomerId && <p className="mt-2 text-[12px] text-[#64748b]">A manager can set a walk-in customer in POS settings so quick sales skip this step.</p>}
      </Modal>
      <NoteModal open={noteOpen} onClose={() => setNoteOpen(false)} line={line} onSave={(note) => line && pos.patchLine(line.key, { notes: note || null })} />
      <PaymentDrawer pos={pos} open={payOpen} onClose={() => setPayOpen(false)} />
      <HeldDrawer pos={pos} open={heldOpen} onClose={() => setHeldOpen(false)} />
      <ShiftModal pos={pos} open={shiftOpen} onClose={() => setShiftOpen(false)} />
      <ReceiptDrawer pos={pos} />
    </div>
  );
}

function NoteModal({ open, onClose, line, onSave }: { open: boolean; onClose: () => void; line: PosLine | null; onSave: (note: string) => void }) {
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(line?.notes || ''); }, [open, line]);
  return (
    <Modal open={open} title={line ? `Note for ${line.name}` : 'Note'} onCancel={onClose} okButtonProps={{ disabled: !line }} onOk={() => { onSave(text.trim()); onClose(); }}>
      {line ? <textarea className="w-full rounded-lg border border-[#e2e8f0] p-2 text-[14px]" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. gift wrap, serial number" /> : <div className="text-[13px] text-[#64748b]">Select a line first.</div>}
    </Modal>
  );
}
