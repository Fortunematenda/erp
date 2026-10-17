'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Drawer, Form, Input, InputNumber, Modal, Select } from 'antd';
import { ArrowLeft, ChefHat, Clock, Plus, RefreshCw, Settings2, ShoppingBag, Users, UtensilsCrossed } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { PosDark } from '@/components/pos/pos-dark';

const STATE: Record<string, { color: string; label: string }> = {
  AVAILABLE: { color: '#22c55e', label: 'Available' },
  OCCUPIED: { color: '#3b82f6', label: 'Occupied' },
  PREPARING: { color: '#f59e0b', label: 'Preparing' },
  READY: { color: '#a855f7', label: 'Ready' },
  RESERVED: { color: '#eab308', label: 'Reserved' },
  NEEDS_CLEANING: { color: '#64748b', label: 'Cleaning' },
};
const ORDER_STATE: Record<string, string> = { OPEN: 'OCCUPIED', IN_PREPARATION: 'PREPARING', READY: 'READY' };
const ORDER_LABEL: Record<string, string> = { OPEN: 'Ordering', IN_PREPARATION: 'Preparing', READY: 'Ready' };

const minutesSince = (d: string | Date, now: number) => Math.max(0, Math.floor((now - new Date(d).getTime()) / 60000));
const clock = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
/** A table's floor state: the furthest-along open order wins, otherwise the stored status. */
function floorState(t: any) {
  const orders = t.openOrders || [];
  if (!orders.length) return t.status === 'OCCUPIED' ? 'AVAILABLE' : t.status;
  if (orders.some((o: any) => o.orderStatus === 'READY')) return 'READY';
  if (orders.some((o: any) => o.orderStatus === 'IN_PREPARATION')) return 'PREPARING';
  return 'OCCUPIED';
}

export default function Page() {
  const router = useRouter();
  const [boot, setBoot] = useState<any>(null);
  const [areas, setAreas] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [today, setToday] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'dine' | 'takeaway'>('dine');
  const [areaId, setAreaId] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [action, setAction] = useState<null | { kind: 'move' | 'merge' | 'split'; table: any; order: any }>(null);
  const [target, setTarget] = useState<string>();
  const [splitLines, setSplitLines] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await api('/pos/bootstrap');
      setBoot(b);
      const branch = b.branch.id;
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const [a, o, k, s, r] = await Promise.all([
        api(`/pos/restaurant/areas?branchId=${branch}`),
        api(`/pos/orders?mode=RESTAURANT&cart=ACTIVE&branchId=${branch}`),
        api(`/pos/kitchen?branchId=${branch}`).catch(() => []),
        api(`/pos/kitchen/stations?branchId=${branch}`).catch(() => []),
        b.can?.['pos.reports'] ? api(`/pos/reports/summary?branchId=${branch}&mode=RESTAURANT&from=${start.toISOString()}`).catch(() => null) : null,
      ]);
      setAreas(a); setOrders(o); setTickets(k); setStations(s); setToday(r);
    } catch (e: any) { notify.error(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const can = (c: string) => !!boot?.can?.[c];
  const branchId = boot?.branch?.id;
  const currency = boot?.currency || 'USD';
  const tables = useMemo(() => areas.flatMap((a) => (a.tables || []).map((t: any) => ({ ...t, areaName: a.name, floor: floorState(t) }))), [areas]);
  const shownTables = areaId ? tables.filter((t) => t.areaId === areaId) : tables;
  const table = tables.find((t) => t.id === selected) || null;
  const takeaway = orders.filter((o) => !o.tableId);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tables) c[t.floor] = (c[t.floor] || 0) + 1;
    return c;
  }, [tables]);
  const routing = useMemo(() => {
    const rows = [...stations.map((s) => ({ id: s.id, name: s.name })), ...(tickets.some((t) => !t.stationId) ? [{ id: '', name: 'Kitchen' }] : [])];
    return rows.map((s) => {
      const mine = tickets.filter((t) => (t.stationId || '') === s.id);
      return { ...s, queued: mine.filter((t) => t.status === 'QUEUED').length, preparing: mine.filter((t) => t.status === 'PREPARING').length, ready: mine.filter((t) => t.status === 'READY').length, oldest: mine.length ? Math.max(...mine.map((t) => minutesSince(t.createdAt, now))) : 0 };
    });
  }, [stations, tickets, now]);

  async function post(path: string, body: any) {
    try { return await api(path, { method: 'POST', body: JSON.stringify(body) }); } catch (e: any) { notify.error(e.message); return null; }
  }
  async function seat(t: any) {
    if (t.status === 'RESERVED' && !window.confirm(`${t.name} is reserved. Seat guests anyway?`)) return;
    const order = await post('/pos/orders', { branchId, mode: 'RESTAURANT', tableId: t.id, orderType: 'DINE_IN' });
    if (order) router.push(`/pos/terminal/restaurant?order=${order.id}`);
  }
  async function setStatus(t: any, status: string) {
    if (await post(`/pos/restaurant/tables/${t.id}/status`, { status })) load();
  }
  function startAction(kind: 'move' | 'merge' | 'split', t: any, order: any) {
    setTarget(undefined); setSplitLines([]);
    setAction({ kind, table: t, order: orders.find((o) => o.id === order.id) || order });
  }
  async function runAction() {
    if (!action) return;
    const { kind, order } = action;
    const res = kind === 'move' ? await post(`/pos/orders/${order.id}/move`, { tableId: target })
      : kind === 'merge' ? await post(`/pos/orders/${order.id}/merge`, { sourceId: target })
      : await post(`/pos/orders/${order.id}/split`, { lineIds: splitLines });
    if (res) { notify.success(kind === 'move' ? 'Order moved' : kind === 'merge' ? 'Orders combined' : 'Bill split'); setAction(null); setSelected(null); load(); }
  }

  const panel = 'rounded-2xl border border-[#1f2430] bg-[#14171f]';
  return (
    <PosDark accent="#f97316">
      <div className="flex min-h-dvh flex-col bg-[#0b0d12] text-[#e5e7eb]">
        <header className="flex flex-wrap items-center gap-3 border-b border-[#1f2430] px-4 py-3 sm:px-6">
          <button type="button" aria-label="Back to POS" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#14171f] text-[#9ca3af] hover:text-white" onClick={() => router.push('/pos')}><ArrowLeft size={18} /></button>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f97316]"><UtensilsCrossed size={18} className="text-white" /></span>
            <div>
              <div className="text-[16px] font-semibold text-white">{boot?.branch?.name || 'Restaurant'}</div>
              <div className="text-[12px] text-[#9ca3af]">Floor and service console</div>
            </div>
          </div>
          <div className="ml-0 flex rounded-xl bg-[#14171f] p-1 sm:ml-4">
            {([['dine', 'Dine in'], ['takeaway', 'Takeaway']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 rounded-lg px-4 text-[13px] font-medium ${tab === k ? 'bg-[#f97316] text-white' : 'text-[#9ca3af] hover:text-white'}`}>
                {label}{k === 'takeaway' && takeaway.length ? ` · ${takeaway.length}` : ''}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[13px] text-[#9ca3af] md:flex"><Clock size={14} />{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <Button icon={<ChefHat size={15} />} onClick={() => router.push('/pos/kitchen')}>Kitchen</Button>
            {can('pos.settings') && <Button icon={<Settings2 size={15} />} onClick={() => setSetupOpen(true)}>Floor setup</Button>}
            <Button icon={<RefreshCw size={15} />} loading={loading} onClick={load} aria-label="Refresh" />
          </div>
        </header>

        {boot && !boot.settings?.restaurantEnabled && <div className="mx-4 mt-3 rounded-xl bg-[#431407] px-4 py-3 text-[13px] text-[#fed7aa] sm:mx-6">Restaurant POS is switched off for this branch. Turn it on in POS settings before seating guests.</div>}

        <div className="grid flex-1 gap-4 p-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {Object.entries(STATE).map(([k, v]) => (
                <div key={k} className={`${panel} px-3 py-2.5`}>
                  <div className="flex items-center gap-1.5 text-[12px] text-[#9ca3af]"><span className="h-2 w-2 rounded-full" style={{ background: v.color }} />{v.label}</div>
                  <div className="text-[22px] font-semibold text-white">{counts[k] || 0}</div>
                </div>
              ))}
            </div>

            {tab === 'dine' ? (
              <section className={`${panel} flex-1 p-4`}>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <div className="text-[15px] font-semibold text-white">Floor map</div>
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {[{ id: '', name: 'All areas' }, ...areas].map((a) => (
                      <button key={a.id || 'all'} type="button" onClick={() => setAreaId(a.id)} className={`h-8 rounded-full px-3 text-[12px] ${areaId === a.id ? 'bg-white text-[#0b0d12]' : 'bg-[#1c2029] text-[#d1d5db]'}`}>{a.name}</button>
                    ))}
                  </div>
                </div>
                {!tables.length && !loading && <div className="rounded-xl border border-dashed border-[#2a3040] p-10 text-center text-[13px] text-[#9ca3af]">No tables yet. {can('pos.settings') ? 'Open Floor setup to add dining areas and tables.' : 'Ask a manager to set up the floor.'}</div>}
                {areas.filter((a) => !areaId || a.id === areaId).map((area) => {
                  const ts = shownTables.filter((t) => t.areaId === area.id);
                  if (!ts.length) return null;
                  return (
                    <div key={area.id} className="mb-5 last:mb-0">
                      {!areaId && <div className="mb-2 text-[12px] uppercase tracking-wide text-[#6b7280]">{area.name}</div>}
                      <div className="flex flex-wrap gap-4 rounded-xl bg-[radial-gradient(#1f2430_1px,transparent_1px)] p-3 [background-size:18px_18px]">
                        {ts.map((t) => {
                          const st = STATE[t.floor] || STATE.AVAILABLE;
                          const first = t.openOrders?.[0];
                          const total = (t.openOrders || []).reduce((s: number, o: any) => s + Number(o.total), 0);
                          const round = t.capacity <= 4;
                          return (
                            <button key={t.id} type="button" onClick={() => setSelected(t.id)}
                              className={`flex flex-col items-center justify-center border-2 text-center transition hover:brightness-125 ${round ? 'h-[104px] w-[104px] rounded-full' : 'h-[104px] w-[164px] rounded-2xl'} ${selected === t.id ? 'ring-2 ring-white ring-offset-2 ring-offset-[#14171f]' : ''}`}
                              style={{ borderColor: st.color, background: `${st.color}1f` }}>
                              <span className="text-[16px] font-bold text-white">{t.code}</span>
                              <span className="flex items-center gap-1 text-[11px] text-[#9ca3af]"><Users size={11} />{t.capacity}</span>
                              {first ? (
                                <>
                                  <span className="text-[11px] font-semibold" style={{ color: st.color }}>{clock(minutesSince(first.createdAt, now))}</span>
                                  <span className="text-[11px] text-[#d1d5db]">{currency} {total.toFixed(0)}</span>
                                </>
                              ) : <span className="text-[11px]" style={{ color: st.color }}>{st.label}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {tables.some((t) => !t.areaId) && (
                  <div className="text-[12px] text-[#6b7280]">Some tables have no dining area and are hidden here.</div>
                )}
              </section>
            ) : (
              <section className={`${panel} flex-1 p-4`}>
                <div className="mb-4 flex items-center gap-2">
                  <div className="text-[15px] font-semibold text-white">Takeaway orders</div>
                  <Button className="ml-auto" type="primary" icon={<Plus size={15} />} onClick={() => router.push('/pos/terminal/restaurant')}>New takeaway</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {takeaway.map((o) => <OrderCard key={o.id} o={o} now={now} currency={currency} onOpen={() => router.push(`/pos/terminal/restaurant?order=${o.id}`)} />)}
                  {!takeaway.length && <div className="text-[13px] text-[#9ca3af]">No open takeaway orders. Ring one up and choose Takeaway order to send it to the kitchen before payment.</div>}
                </div>
              </section>
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <section className={`${panel} p-4`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[15px] font-semibold text-white">Live order queue <span className="text-[#6b7280]">· {orders.length}</span></div>
                <Button type="primary" size="small" icon={<Plus size={14} />} onClick={() => router.push('/pos/terminal/restaurant')}>New order</Button>
              </div>
              <div className="max-h-[340px] space-y-2 overflow-y-auto">
                {orders.map((o) => <OrderCard key={o.id} o={o} now={now} currency={currency} compact onOpen={() => router.push(`/pos/terminal/restaurant?order=${o.id}`)} />)}
                {!orders.length && <div className="text-[13px] text-[#9ca3af]">No open orders.</div>}
              </div>
            </section>

            <section className={`${panel} p-4`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[15px] font-semibold text-white">Kitchen routing</div>
                <button type="button" className="text-[12px] text-[#fdba74]" onClick={() => router.push('/pos/kitchen')}>Open display</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {routing.map((s) => (
                  <div key={s.id || 'none'} className="rounded-xl bg-[#1c2029] p-3">
                    <div className="flex items-center justify-between text-[13px] font-medium text-white"><span className="truncate">{s.name}</span><span className="rounded-full bg-[#f97316] px-2 text-[11px]">{s.queued + s.preparing}</span></div>
                    <div className="mt-1 text-[11px] text-[#9ca3af]">{s.queued} queued · {s.preparing} cooking · {s.ready} ready</div>
                    {s.oldest > 0 && <div className={`mt-1 text-[11px] ${s.oldest >= 25 ? 'text-[#f87171]' : s.oldest >= 15 ? 'text-[#fbbf24]' : 'text-[#6b7280]'}`}>Oldest {clock(s.oldest)}</div>}
                  </div>
                ))}
                {!routing.length && <div className="col-span-2 text-[13px] text-[#9ca3af]">No tickets in the kitchen. Add stations in POS settings to route by Grill, Prep or Bar.</div>}
              </div>
            </section>

            {today && (
              <section className={`${panel} p-4`}>
                <div className="mb-3 text-[15px] font-semibold text-white">Today</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-[#1c2029] p-2"><div className="text-[11px] text-[#9ca3af]">Sales</div><div className="text-[15px] font-semibold text-white">{Number(today.revenue).toFixed(0)}</div></div>
                  <div className="rounded-xl bg-[#1c2029] p-2"><div className="text-[11px] text-[#9ca3af]">Checks</div><div className="text-[15px] font-semibold text-white">{today.transactions}</div></div>
                  <div className="rounded-xl bg-[#1c2029] p-2"><div className="text-[11px] text-[#9ca3af]">Average</div><div className="text-[15px] font-semibold text-white">{Number(today.average).toFixed(2)}</div></div>
                </div>
                <div className="mt-2 text-[11px] text-[#6b7280]">Restaurant sales posted today, in {currency}.</div>
              </section>
            )}
          </aside>
        </div>

        <Drawer open={!!table} onClose={() => setSelected(null)} width={360} title={table ? `${table.name} · ${table.areaName}` : ''}>
          {table && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE[table.floor]?.color }} />{STATE[table.floor]?.label}
                <span className="ml-auto flex items-center gap-1 text-[#9ca3af]"><Users size={13} />{table.capacity} seats</span>
              </div>
              {(table.openOrders || []).map((o: any) => (
                <div key={o.id} className="rounded-xl bg-[#1c2029] p-3">
                  <div className="flex justify-between text-[14px] font-semibold"><span>{o.saleNo}</span><span>{currency} {Number(o.total).toFixed(2)}</span></div>
                  <div className="text-[12px] text-[#9ca3af]">{ORDER_LABEL[o.orderStatus] || o.orderStatus} · {clock(minutesSince(o.createdAt, now))}{o.assignedEmployee ? ` · ${o.assignedEmployee.firstName}` : ''}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="small" type="primary" onClick={() => router.push(`/pos/terminal/restaurant?order=${o.id}`)}>Open</Button>
                    <Button size="small" onClick={() => startAction('move', table, o)}>Move</Button>
                    <Button size="small" onClick={() => startAction('split', table, o)}>Split</Button>
                    {orders.length > 1 && <Button size="small" onClick={() => startAction('merge', table, o)}>Combine</Button>}
                  </div>
                </div>
              ))}
              {!table.openOrders?.length && (
                <div className="flex flex-wrap gap-2">
                  <Button type="primary" disabled={table.status === 'NEEDS_CLEANING'} onClick={() => seat(table)}>Seat guests</Button>
                  {table.status === 'NEEDS_CLEANING' && <Button onClick={() => setStatus(table, 'AVAILABLE')}>Mark clean</Button>}
                  {table.status === 'AVAILABLE' && <Button onClick={() => setStatus(table, 'RESERVED')}>Reserve</Button>}
                  {table.status === 'RESERVED' && <Button onClick={() => setStatus(table, 'AVAILABLE')}>Release</Button>}
                </div>
              )}
              {table.openOrders?.length > 0 && <Button block icon={<Plus size={14} />} onClick={async () => {
                const order = await post('/pos/orders', { branchId, mode: 'RESTAURANT', tableId: table.id, orderType: 'DINE_IN', allowSecondOrder: true });
                if (order) router.push(`/pos/terminal/restaurant?order=${order.id}`);
              }}>Separate bill for this table</Button>}
            </div>
          )}
        </Drawer>

        <Drawer open={setupOpen} onClose={() => setSetupOpen(false)} width={400} title="Floor setup">
          {branchId && (
            <div className="space-y-6">
              <Form layout="vertical" onFinish={async (v) => { if (await post('/pos/restaurant/areas', { ...v, branchId })) load(); }}>
                <Form.Item name="name" label="New dining area" rules={[{ required: true, message: 'Name the area' }]}><Input placeholder="e.g. Patio" /></Form.Item>
                <Button htmlType="submit">Add area</Button>
              </Form>
              {areas.length > 0 && (
                <Form layout="vertical" onFinish={async (v) => { if (await post('/pos/restaurant/tables', { ...v, branchId, name: v.name || v.code, capacity: Number(v.capacity || 2) })) load(); }}>
                  <Form.Item name="areaId" label="Area" rules={[{ required: true, message: 'Choose an area' }]}><Select options={areas.map((a) => ({ value: a.id, label: a.name }))} /></Form.Item>
                  <Form.Item name="code" label="Table code" rules={[{ required: true, message: 'Enter a code' }]}><Input placeholder="e.g. T1" /></Form.Item>
                  <Form.Item name="name" label="Display name"><Input placeholder="Defaults to the code" /></Form.Item>
                  <Form.Item name="capacity" label="Seats" extra="Tables with more than four seats show as rectangles on the floor map."><InputNumber min={1} className="!w-full" /></Form.Item>
                  <Button htmlType="submit">Add table</Button>
                </Form>
              )}
            </div>
          )}
        </Drawer>

        <Modal open={!!action} onCancel={() => setAction(null)} onOk={runAction} okButtonProps={{ disabled: action?.kind === 'split' ? !splitLines.length : !target }}
          title={action ? `${action.kind === 'move' ? 'Move' : action.kind === 'merge' ? 'Combine into' : 'Split'} ${action.order.saleNo}` : ''}>
          {action?.kind === 'move' && (
            <Select className="w-full" placeholder="Move to table" value={target} onChange={setTarget}
              options={tables.filter((t) => t.id !== action.table.id && !t.openOrders?.length).map((t) => ({ value: t.id, label: `${t.areaName} · ${t.name}` }))} />
          )}
          {action?.kind === 'merge' && (
            <>
              <div className="mb-2 text-[13px] text-[#9ca3af]">Items from the chosen bill move onto {action.order.saleNo}. The other bill closes.</div>
              <Select className="w-full" placeholder="Bill to bring in" value={target} onChange={setTarget}
                options={orders.filter((o) => o.id !== action.order.id).map((o) => ({ value: o.id, label: `${o.saleNo} · ${o.table?.name || 'Takeaway'} · ${Number(o.total).toFixed(2)}` }))} />
            </>
          )}
          {action?.kind === 'split' && (
            <>
              <div className="mb-2 text-[13px] text-[#9ca3af]">Tick the items that go onto a separate bill for the same table.</div>
              <Checkbox.Group className="flex flex-col gap-2" value={splitLines} onChange={(v) => setSplitLines(v as string[])}
                options={(action.order.lines || []).map((l: any) => ({ value: l.id, label: `${Number(l.quantity)} × ${l.description} · ${Number(l.lineTotal).toFixed(2)}` }))} />
            </>
          )}
        </Modal>
      </div>
    </PosDark>
  );
}

function OrderCard({ o, now, currency, compact, onOpen }: { o: any; now: number; currency: string; compact?: boolean; onOpen: () => void }) {
  const st = STATE[ORDER_STATE[o.orderStatus] || 'OCCUPIED'];
  const mins = minutesSince(o.createdAt, now);
  const items = (o.lines || []).reduce((s: number, l: any) => s + Number(l.quantity), 0);
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl bg-[#1c2029] p-3 text-left hover:bg-[#232836]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white" style={{ background: `${st.color}33`, color: st.color }}>
        {o.table ? o.table.code : <ShoppingBag size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white"><span className="truncate">{o.saleNo}</span><span className="rounded px-1.5 text-[10px] font-medium" style={{ background: `${st.color}26`, color: st.color }}>{ORDER_LABEL[o.orderStatus] || o.orderStatus}</span></div>
        <div className="truncate text-[12px] text-[#9ca3af]">{o.table ? o.table.name : 'Takeaway'} · {items} items{compact ? '' : ` · ${(o.lines || []).map((l: any) => l.description).join(', ')}`}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[13px] font-semibold text-white">{currency} {Number(o.total).toFixed(2)}</div>
        <div className={`text-[11px] ${mins >= 30 ? 'text-[#f87171]' : 'text-[#6b7280]'}`}>{clock(mins)}</div>
      </div>
    </button>
  );
}
