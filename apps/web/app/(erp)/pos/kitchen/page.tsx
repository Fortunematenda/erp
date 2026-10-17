'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Select } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

const NEXT: Record<string, { status: string; label: string }> = {
  QUEUED: { status: 'PREPARING', label: 'Start' },
  PREPARING: { status: 'READY', label: 'Ready' },
};
const STATUS_TEXT: Record<string, string> = { QUEUED: 'New', PREPARING: 'Cooking', READY: 'Ready to serve' };

function modifierText(m: any): string {
  if (!m) return '';
  if (Array.isArray(m)) return m.map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean).join(', ');
  return '';
}

export default function Page() {
  const router = useRouter();
  const [boot, setBoot] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [station, setStation] = useState<string>('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const b = boot || await api('/pos/bootstrap');
      if (!boot) {
        setBoot(b);
        api(`/pos/kitchen/stations?branchId=${b.branch.id}`).then(setStations).catch(() => {});
      }
      setTickets(await api(`/pos/kitchen?branchId=${b.branch.id}`));
      setError('');
    } catch (e: any) { setError(e.message); }
  }, [boot]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 8000);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  async function setStatus(ticket: any, status: string) {
    if (status === 'CANCELLED' && !window.confirm(`Cancel this ticket for ${ticket.sale?.table?.name || ticket.sale?.saleNo}?`)) return;
    try { await api(`/pos/kitchen/${ticket.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); load(); }
    catch (e: any) { notify.error(e.message); load(); }
  }

  const canCancel = !!boot?.can?.['pos.cancel'];
  const shown = station ? tickets.filter((t) => t.stationId === station) : tickets;
  return (
    <div className="min-h-dvh bg-[#0f172a] p-3 text-white sm:p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className="flex h-11 items-center gap-2 rounded-lg px-2 text-[13px] text-[#cbd5e1]" onClick={() => router.push('/pos/restaurant')}><ArrowLeft size={16} /> Floor</button>
        <div className="text-[16px] font-semibold">Kitchen</div>
        {stations.length > 0 && (
          <Select className="min-w-[160px]" value={station} onChange={setStation} options={[{ value: '', label: 'All stations' }, ...stations.map((s) => ({ value: s.id, label: s.name }))]} />
        )}
        <div className="ml-auto text-[12px] text-[#94a3b8]">{shown.filter((t) => t.status !== 'READY').length} cooking · {shown.filter((t) => t.status === 'READY').length} ready</div>
      </div>
      {error && <div className="mb-3 rounded-lg bg-[#7f1d1d] px-3 py-2 text-[13px]">Cannot reach the server: {error}. Tickets on screen may be out of date.</div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {shown.map((ticket) => {
          const mins = Math.max(0, Math.round((now - new Date(ticket.createdAt).getTime()) / 60000));
          const late = ticket.status !== 'READY' && mins >= 25;
          const slow = ticket.status !== 'READY' && mins >= 15;
          return (
            <article key={ticket.id} className={`flex flex-col rounded-2xl border-2 bg-[#1e293b] p-4 ${ticket.status === 'READY' ? 'border-[#16a34a]' : late ? 'border-[#dc2626]' : slow ? 'border-[#d97706]' : 'border-transparent'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[18px] font-semibold">{ticket.sale?.table?.name ? `Table ${ticket.sale.table.name}` : ticket.sale?.orderType === 'TAKEAWAY' ? 'Takeaway' : ticket.sale?.saleNo}</div>
                  <div className="text-[12px] text-[#94a3b8]">{ticket.sale?.saleNo}{ticket.station ? ` · ${ticket.station.name}` : ''}</div>
                </div>
                <div className="text-right">
                  <div className={`text-[16px] font-semibold ${late ? 'text-[#f87171]' : slow ? 'text-[#fbbf24]' : ''}`}>{mins}m</div>
                  <div className="text-[12px] text-[#94a3b8]">{STATUS_TEXT[ticket.status] || ticket.status}</div>
                </div>
              </div>
              <ul className="my-3 flex-1 space-y-2 text-[16px]">
                {(ticket.lines || []).map((l: any) => (
                  <li key={l.id}>
                    <span className="font-semibold">{Number(l.quantity)} ×</span> {l.description}
                    {modifierText(l.modifiers) && <div className="text-[13px] text-[#fbbf24]">{modifierText(l.modifiers)}</div>}
                    {l.notes && <div className="text-[13px] text-[#93c5fd]">{l.notes}</div>}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                {NEXT[ticket.status] && <Button type="primary" size="large" className="!h-12 flex-1" onClick={() => setStatus(ticket, NEXT[ticket.status].status)}>{NEXT[ticket.status].label}</Button>}
                {ticket.status === 'READY' && <Button size="large" className="!h-12 flex-1" onClick={() => setStatus(ticket, 'COMPLETED')}>Served</Button>}
                {canCancel && ticket.status !== 'READY' && <Button size="large" danger className="!h-12" onClick={() => setStatus(ticket, 'CANCELLED')}>Cancel</Button>}
              </div>
            </article>
          );
        })}
        {!shown.length && <div className="text-[#94a3b8]">No tickets in the kitchen.</div>}
      </div>
    </div>
  );
}
