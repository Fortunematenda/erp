'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Input, InputNumber, Modal, Select, Table, Tag } from 'antd';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', CARD: 'Card', BANK: 'Bank', MOBILE: 'Mobile', CREDIT: 'Account' };

export default function Page() {
  const [boot, setBoot] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [cash, setCash] = useState<Record<string, any>>({});
  const [registerId, setRegisterId] = useState<string>();
  const [floatAmt, setFloatAmt] = useState<number | null>(0);
  const [move, setMove] = useState<null | { shift: any; kind: 'IN' | 'OUT' }>(null);
  const [moveAmt, setMoveAmt] = useState<number | null>(null);
  const [moveNote, setMoveNote] = useState('');
  const [closing, setClosing] = useState<any>(null);
  const [counted, setCounted] = useState<number | null>(null);
  const [closeNote, setCloseNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const b = await api('/pos/bootstrap');
    setBoot(b);
    const list = await api(`/pos/shifts?branchId=${b.branch.id}`);
    setRows(list);
    const active = list.filter((s: any) => s.status !== 'CLOSED');
    const figures = await Promise.all(active.map((s: any) => api(`/pos/shifts/${s.id}/cash`).catch(() => null)));
    setCash(Object.fromEntries(active.map((s: any, i: number) => [s.id, figures[i]])));
  }, []);
  useEffect(() => { load().catch((e) => notify.error(e.message)); }, [load]);

  const can = (c: string) => !!boot?.can?.[c];
  const currency = boot?.currency || 'USD';
  const fmt = (n: any) => `${currency} ${Number(n || 0).toFixed(2)}`;
  const freeRegisters = (boot?.registers || []).filter((r: any) => !rows.some((s) => s.registerId === r.id && s.status !== 'CLOSED'));

  async function call(path: string, body: any, ok: string) {
    setBusy(true);
    try { const res = await api(path, { method: 'POST', body: JSON.stringify(body) }); notify.success(ok); await load(); return res; }
    catch (e: any) { notify.error(e.message); return null; }
    finally { setBusy(false); }
  }

  const active = rows.filter((s) => s.status !== 'CLOSED');
  return (
    <div className="space-y-6">
      {can('pos.shifts.open') && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#e6e9f0] bg-white p-4">
          <span className="text-[13px] font-medium">Open a shift</span>
          <Select className="min-w-[200px]" placeholder="Register" value={registerId} options={freeRegisters.map((r: any) => ({ value: r.id, label: r.name }))} onChange={setRegisterId} />
          <InputNumber min={0} prefix={currency} placeholder="Counted float" value={floatAmt ?? undefined} onChange={(v) => setFloatAmt(v == null ? null : Number(v))} />
          <Button type="primary" disabled={!registerId} loading={busy} onClick={async () => { if (await call('/pos/shifts/open', { registerId, openingFloat: floatAmt || 0 }, 'Shift opened')) setRegisterId(undefined); }}>Open shift</Button>
          {!boot?.registers?.length && <span className="text-[12px] text-[#64748b]">Create a register first.</span>}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {active.map((s) => {
          const c = cash[s.id];
          return (
            <div key={s.id} className="rounded-2xl border border-[#e6e9f0] bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[14px] font-semibold">{s.register?.name}</div>
                  <div className="text-[12px] text-[#64748b]">{s.user?.firstName} {s.user?.lastName} · since {new Date(s.openedAt).toLocaleString()}</div>
                </div>
                <Tag color={s.status === 'OPEN' ? 'green' : 'gold'} className="!m-0">{s.status === 'OPEN' ? 'Open' : 'Awaiting approval'}</Tag>
              </div>
              <div className="mt-3 space-y-1 text-[13px]">
                <div className="flex justify-between"><span>Opening float</span><span>{fmt(s.openingFloat)}</span></div>
                {c?.expected != null ? (
                  <>
                    <div className="flex justify-between"><span>Cash sales (net of change)</span><span>{fmt(c.cashSales)}</span></div>
                    <div className="flex justify-between"><span>Cash in / out, deposits, refunds</span><span>{fmt(c.movements)}</span></div>
                    {s.status === 'OPEN' && <div className="flex justify-between font-semibold"><span>Expected in drawer</span><span>{fmt(c.expected)}</span></div>}
                  </>
                ) : s.status === 'OPEN' && <div className="text-[12px] text-[#64748b]">Drawer totals are hidden until the cash is counted.</div>}
                {s.status === 'CLOSING' && (
                  <>
                    <div className="flex justify-between"><span>Expected</span><span>{fmt(s.expectedCash)}</span></div>
                    <div className="flex justify-between"><span>Counted</span><span>{fmt(s.actualCash)}</span></div>
                    <div className={`flex justify-between font-semibold ${Number(s.variance) < 0 ? 'text-[#b91c1c]' : 'text-[#b45309]'}`}><span>{Number(s.variance) < 0 ? 'Short' : 'Over'}</span><span>{fmt(Math.abs(Number(s.variance)))}</span></div>
                  </>
                )}
                {c?.byTender && Object.keys(c.byTender).length > 0 && (
                  <div className="pt-1 text-[12px] text-[#64748b]">{Object.entries(c.byTender).map(([m, v]) => `${METHOD_LABEL[m] || m} ${Number(v).toFixed(2)}`).join(' · ')}</div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {s.status === 'OPEN' && (
                  <>
                    <Button size="small" onClick={() => { setMove({ shift: s, kind: 'IN' }); setMoveAmt(null); setMoveNote(''); }}>Cash in</Button>
                    <Button size="small" onClick={() => { setMove({ shift: s, kind: 'OUT' }); setMoveAmt(null); setMoveNote(''); }}>Cash out</Button>
                    {can('pos.shifts.close') && <Button size="small" type="primary" onClick={() => { setClosing(s); setCounted(null); setCloseNote(''); }}>Count & close</Button>}
                  </>
                )}
                {s.status === 'CLOSING' && can('pos.shifts.approve') && <Button size="small" type="primary" loading={busy} onClick={() => { const note = window.prompt('Approval note (optional)') ?? undefined; call(`/pos/shifts/${s.id}/approve`, { note }, 'Variance approved and shift closed'); }}>Approve variance</Button>}
                {s.status === 'CLOSING' && can('pos.shifts.close') && <Button size="small" loading={busy} onClick={() => call(`/pos/shifts/${s.id}/recount`, {}, 'Shift reopened for a recount')}>Recount</Button>}
              </div>
            </div>
          );
        })}
        {!active.length && <div className="text-[13px] text-[#64748b]">No open shifts.</div>}
      </div>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Closed shifts</h2>
        <Table size="small" rowKey="id" scroll={{ x: 720 }} dataSource={rows.filter((s) => s.status === 'CLOSED')} columns={[
          { title: 'Register', render: (_, r: any) => r.register?.name },
          { title: 'Cashier', render: (_, r: any) => `${r.user?.firstName || ''} ${r.user?.lastName || ''}` },
          { title: 'Opened', render: (_, r: any) => new Date(r.openedAt).toLocaleString() },
          { title: 'Closed', render: (_, r: any) => r.closedAt ? new Date(r.closedAt).toLocaleString() : '—' },
          { title: 'Expected', align: 'right', render: (_, r: any) => Number(r.expectedCash).toFixed(2) },
          { title: 'Counted', align: 'right', render: (_, r: any) => r.actualCash == null ? '—' : Number(r.actualCash).toFixed(2) },
          { title: 'Variance', align: 'right', render: (_, r: any) => r.variance == null ? '—' : <span className={Number(r.variance) < 0 ? 'text-[#b91c1c]' : ''}>{Number(r.variance).toFixed(2)}</span> },
          { title: 'Note', dataIndex: 'note', ellipsis: true },
        ]} />
      </section>

      <Modal open={!!move} title={move?.kind === 'IN' ? 'Cash into drawer' : 'Cash out of drawer'} onCancel={() => setMove(null)} confirmLoading={busy}
        okButtonProps={{ disabled: !(Number(moveAmt) > 0) || !moveNote.trim() }}
        onOk={async () => { if (move && await call(`/pos/shifts/${move.shift.id}/cash`, { kind: move.kind, amount: moveAmt, note: moveNote }, 'Cash movement recorded')) setMove(null); }}>
        <InputNumber className="!mb-2 !w-full" size="large" min={0} prefix={currency} value={moveAmt ?? undefined} onChange={(v) => setMoveAmt(v == null ? null : Number(v))} />
        <Input placeholder={move?.kind === 'IN' ? 'Reason, e.g. extra change' : 'Reason, e.g. supplier paid in cash, banking drop'} value={moveNote} onChange={(e) => setMoveNote(e.target.value)} />
      </Modal>

      <Modal open={!!closing} title={`Count & close ${closing?.register?.name || ''}`} onCancel={() => setClosing(null)} confirmLoading={busy} okText="Submit count"
        okButtonProps={{ disabled: counted == null }}
        onOk={async () => {
          const res = await call(`/pos/shifts/${closing.id}/close`, { actualCash: counted, note: closeNote || undefined }, 'Count submitted');
          if (res) {
            setClosing(null);
            if (res.status === 'CLOSING') notify.warning(`The count is ${Number(res.variance) < 0 ? 'short' : 'over'} by ${fmt(Math.abs(Number(res.variance)))}. A manager must approve it.`);
          }
        }}>
        <div className="mb-2 text-[13px]">Count every note and coin in the drawer and enter the total.</div>
        <InputNumber className="!mb-2 !w-full" size="large" min={0} prefix={currency} value={counted ?? undefined} onChange={(v) => setCounted(v == null ? null : Number(v))} />
        <Input.TextArea rows={2} placeholder="Note (optional)" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
      </Modal>
    </div>
  );
}
