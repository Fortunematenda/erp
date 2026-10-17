'use client';

import { useState } from 'react';
import { Modal, Select } from 'antd';
import { ArrowLeft, ChefHat, Minus, Plus, Search, ShoppingBag, Wifi, WifiOff, X } from 'lucide-react';
import { HeldDrawer, ItemArt, PaymentDrawer, ReceiptDrawer, ShiftModal } from './pos-dialogs';
import { PosDark } from './pos-dark';
import { money, usePos, type Pos } from './use-pos';
import { notify } from '@/lib/notify';

export function RestaurantTerminal() {
  const pos = usePos('RESTAURANT');
  const { currency, order, shown, categories, category, setCategory, search, setSearch, qtyInCart } = pos;
  const [payOpen, setPayOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);

  function startPayment() {
    const blocker = pos.paymentBlocker();
    if (blocker === 'SHIFT') { setShiftOpen(true); return; }
    if (blocker) { notify.warning(blocker); return; }
    setPayOpen(true);
  }

  const title = order ? (order.table ? `${order.table.name} · ${order.saleNo}` : `Takeaway · ${order.saleNo}`) : 'Quick order';
  const panel = <OrderPanel pos={pos} onPay={startPayment} onHeld={() => setHeldOpen(true)} />;

  return (
    <PosDark accent="#f97316">
      <div className="flex h-dvh flex-col bg-[#0f1115] text-[#e5e7eb]">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#1f232c] px-4 py-3">
          <button type="button" aria-label="Back to floor" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#181b22] text-[#9ca3af] hover:text-white" onClick={() => pos.router.push('/pos/restaurant')}><ArrowLeft size={18} /></button>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold text-white">{title}</div>
            <div className="text-[12px] text-[#9ca3af]">{order ? String(order.orderStatus).replace('_', ' ').toLowerCase() : 'Pay now or save as a takeaway order'}</div>
          </div>
          <div className="relative ml-auto w-full sm:w-[280px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search menu" className="h-10 w-full rounded-lg border border-[#262b35] bg-[#181b22] pl-9 pr-3 text-[14px] text-white outline-none placeholder:text-[#6b7280] focus:border-[#f97316]" />
          </div>
          <Select className="w-[150px]" placeholder="Register" value={pos.registerId} allowClear onChange={pos.setRegisterId}
            options={(pos.boot?.registers || []).map((r: any) => ({ value: r.id, label: `${r.name}${r.shifts?.[0] ? '' : ' · closed'}` }))} />
          {pos.online ? <Wifi size={18} className="text-[#22c55e]" /> : <WifiOff size={18} className="text-[#ef4444]" />}
        </header>
        {!pos.online && <div className="bg-[#451a03] px-4 py-2 text-[13px] text-[#fed7aa]">Connection lost. Orders and payments resume when you are back online.</div>}
        {pos.needsShift && pos.online && <div className="bg-[#172554] px-4 py-2 text-[13px] text-[#bfdbfe]">{pos.register?.name} has no open shift. <button type="button" className="font-semibold underline" onClick={() => setShiftOpen(true)}>Open shift</button></div>}

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
          <main className="flex min-h-0 flex-col p-4">
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {['', ...categories].map((c) => (
                <button key={c || 'all'} type="button" onClick={() => setCategory(c)}
                  className={`h-9 shrink-0 rounded-full px-4 text-[13px] font-medium ${category === c ? 'bg-[#f97316] text-white' : 'bg-[#181b22] text-[#d1d5db] hover:bg-[#222631]'}`}>{c || 'All'}</button>
              ))}
            </div>
            <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-3 overflow-y-auto pb-24 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 lg:pb-0">
              {shown.map((item) => {
                const inCart = qtyInCart.get(item.id);
                const out = item.tracked && item.onHand !== null && item.onHand <= 0;
                return (
                  <button key={item.id} type="button" disabled={pos.busy} onClick={() => pos.add(item)}
                    className={`relative overflow-hidden rounded-xl border text-left transition active:scale-[0.98] ${inCart ? 'border-[#f97316]' : 'border-[#262b35]'} bg-[#181b22]`}>
                    <ItemArt name={item.name} imageUrl={item.imageUrl} className="h-24 w-full" />
                    {inCart && <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#f97316] px-1.5 text-[12px] font-semibold text-white">{inCart}</span>}
                    <div className="p-2.5">
                      <div className="line-clamp-2 text-[13px] font-medium leading-snug text-white">{item.name}</div>
                      <div className="mt-1 flex items-center justify-between text-[12px]">
                        <span className="font-semibold text-[#fdba74]">{money(item.price, currency)}</span>
                        {out && <span className="text-[#f87171]">Out</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
              {!shown.length && <div className="col-span-full text-[13px] text-[#9ca3af]">No menu items match.</div>}
            </div>
          </main>
          <aside className="hidden min-h-0 border-l border-[#1f232c] bg-[#13161c] p-4 lg:flex lg:flex-col">{panel}</aside>
        </div>

        <MobileBar pos={pos}>{panel}</MobileBar>
        <PaymentDrawer pos={pos} open={payOpen} onClose={() => setPayOpen(false)} />
        <HeldDrawer pos={pos} open={heldOpen} onClose={() => setHeldOpen(false)} />
        <ShiftModal pos={pos} open={shiftOpen} onClose={() => setShiftOpen(false)} />
        <ReceiptDrawer pos={pos} />
      </div>
    </PosDark>
  );
}

function OrderPanel({ pos, onPay, onHeld }: { pos: Pos; onPay: () => void; onHeld: () => void }) {
  const { currency, order, lines } = pos;
  const unsent = order ? lines.filter((l) => !l.sent).length : 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[15px] font-semibold text-white">{order ? 'Order' : 'Current order'}</div>
        {order && <button type="button" className="text-[13px] text-[#fdba74]" onClick={() => pos.router.push('/pos/restaurant')}>Back to floor</button>}
      </div>
      <Select className="mb-3 w-full" showSearch optionFilterProp="label" placeholder="Customer" value={pos.customerId}
        options={pos.customers.map((c) => ({ value: c.id, label: c.id === pos.settings.walkInCustomerId ? `${c.name} (walk-in)` : c.name }))} onChange={pos.setCustomerId} />
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {!lines.length && <div className="rounded-xl border border-dashed border-[#262b35] p-6 text-center text-[13px] text-[#6b7280]">Tap menu items to add them.</div>}
        {lines.map((l) => (
          <div key={l.key} className="flex items-center gap-2 rounded-lg bg-[#181b22] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] text-white">{l.name}</div>
              <div className="text-[12px] text-[#9ca3af]">{l.qty} × {money(l.price, currency)}{l.sent ? <span className="ml-2 rounded bg-[#14532d] px-1.5 py-0.5 text-[11px] text-[#86efac]">Sent</span> : order ? <span className="ml-2 rounded bg-[#422006] px-1.5 py-0.5 text-[11px] text-[#fdba74]">New</span> : null}</div>
            </div>
            {!order && (
              <div className="flex items-center gap-1">
                <button type="button" aria-label="One less" className="flex h-8 w-8 items-center justify-center rounded bg-[#222631]" onClick={() => l.qty > 1 ? pos.patchLine(l.key, { qty: l.qty - 1 }) : pos.remove(l)}><Minus size={14} /></button>
                <button type="button" aria-label="One more" className="flex h-8 w-8 items-center justify-center rounded bg-[#222631]" onClick={() => pos.patchLine(l.key, { qty: l.qty + 1 })}><Plus size={14} /></button>
              </div>
            )}
            {order && <button type="button" aria-label={`Remove ${l.name}`} className="flex h-8 w-8 items-center justify-center rounded text-[#9ca3af] hover:bg-[#222631]" onClick={() => pos.remove(l)}><X size={14} /></button>}
            <div className="w-[76px] text-right text-[13px] font-semibold text-white">{money(l.price * l.qty - l.discount, currency)}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-1 border-t border-[#262b35] pt-3 text-[13px]">
        <div className="flex justify-between text-[#9ca3af]"><span>Tax</span><span>{money(pos.taxTotal, currency)}</span></div>
        {pos.deposits > 0 && <div className="flex justify-between text-[#9ca3af]"><span>Deposits paid</span><span>−{money(pos.deposits, currency)}</span></div>}
        <div className="flex items-end justify-between"><span className="text-[#d1d5db]">Total</span><span className="text-[24px] font-semibold text-white">{money(pos.total, currency)}</span></div>
        {pos.quoteError && <div className="text-[12px] text-[#f87171]">{pos.quoteError}</div>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {order ? (
          <button type="button" disabled={!unsent || pos.busy} onClick={pos.sendKitchen} className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-[#1e293b] text-[14px] font-semibold text-white disabled:opacity-40">
            <ChefHat size={17} />{unsent ? `Send ${unsent} to kitchen` : 'All items sent'}
          </button>
        ) : (
          <>
            <button type="button" disabled={!lines.length || pos.busy} onClick={() => pos.saveAsOrder({ orderType: 'TAKEAWAY' })} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#1e293b] text-[13px] font-medium text-white disabled:opacity-40"><ShoppingBag size={16} />Takeaway order</button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={!lines.length || pos.busy || !pos.can('pos.hold')} onClick={pos.hold} className="h-12 rounded-xl bg-[#1e293b] text-[13px] text-white disabled:opacity-40">Hold</button>
              <button type="button" disabled={!pos.can('pos.hold')} onClick={onHeld} className="h-12 rounded-xl bg-[#1e293b] text-[13px] text-white disabled:opacity-40">Held</button>
            </div>
          </>
        )}
        <button type="button" disabled={!lines.length || !pos.online || pos.busy} onClick={onPay}
          className="col-span-2 h-14 rounded-xl bg-[#f97316] text-[16px] font-semibold text-white disabled:opacity-40">
          {pos.needsShift ? 'Open shift to take payment' : `Pay ${money(pos.due, currency)}`}
        </button>
      </div>
    </div>
  );
}

function MobileBar({ pos, children }: { pos: Pos; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fixed inset-x-3 bottom-3 z-10 flex h-14 items-center justify-between rounded-2xl bg-[#f97316] px-4 font-medium text-white shadow-lg lg:hidden" onClick={() => setOpen(true)}>
        <span>{pos.lines.length} items</span><span className="font-semibold">{money(pos.due, pos.currency)}</span>
      </button>
      <Modal open={open} onCancel={() => setOpen(false)} footer={null} width="100%" style={{ top: 8, maxWidth: 480 }} styles={{ body: { height: '84dvh' } }} className="lg:hidden">{children}</Modal>
    </>
  );
}
