'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, InputNumber, Select, Table, Tag } from 'antd';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

const REASONS = ['Faulty or damaged', 'Wrong item', 'Customer changed mind', 'Overcharged', 'Service not delivered'];
const REFUND_METHODS = [
  { value: 'CASH', label: 'Cash from drawer' },
  { value: 'CARD', label: 'Card reversal' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'MOBILE', label: 'Mobile money' },
  { value: 'ACCOUNT', label: 'Credit to customer account' },
];
const STATUS_COLOR: Record<string, string> = { POSTED: 'green', PENDING_APPROVAL: 'gold', REJECTED: 'default', RECONCILIATION_REQUIRED: 'red', POSTING: 'blue' };

export default function Page() {
  const [boot, setBoot] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState<any[]>([]);
  const [sale, setSale] = useState<any>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<string>();
  const [detail, setDetail] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [returns, setReturns] = useState<any[]>([]);
  const [reload, setReload] = useState(0);

  const loadReturns = useCallback(() => api('/pos/returns').then(setReturns).catch((e) => notify.error(e.message)), []);
  useEffect(() => { api('/pos/bootstrap').then(setBoot).catch((e) => notify.error(e.message)); loadReturns(); }, [loadReturns]);
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams({ status: 'POSTED', take: '50' });
      if (search.trim()) q.set('search', search.trim());
      api(`/pos/sales?${q}`).then(setSales).catch((e) => notify.error(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [search, reload]);

  const canApprove = !!boot?.can?.['pos.refund.approve'];
  const currency = boot?.currency || 'USD';
  const returned = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of sale?.returns || []) if (r.status !== 'REJECTED') for (const l of r.lines) if (l.saleLineId) map.set(l.saleLineId, (map.get(l.saleLineId) || 0) + Number(l.quantity));
    return map;
  }, [sale]);
  const saleLines = (sale?.lines || []).filter((l: any) => !l.voided);
  const refundTotal = saleLines.reduce((s: number, l: any) => s + (qty[l.id] || 0) / Number(l.quantity) * Number(l.lineTotal), 0);

  function choose(s: any) { setSale(s); setQty({}); setReason(undefined); setDetail(''); setMethod('CASH'); setReference(''); }

  async function submit() {
    const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([saleLineId, quantity]) => ({ saleLineId, quantity }));
    if (!lines.length) { notify.warning('Choose how many of each item are coming back'); return; }
    if (!reason) { notify.warning('Choose a reason'); return; }
    if (['CARD', 'BANK', 'MOBILE'].includes(method) && !reference.trim()) { notify.warning('Enter the reversal reference from the payment provider'); return; }
    setBusy(true);
    try {
      const res = await api(`/pos/sales/${sale.id}/return`, { method: 'POST', body: JSON.stringify({ lines, reason: detail.trim() ? `${reason}: ${detail.trim()}` : reason, refundMethod: method, refundReference: reference.trim() || undefined }) });
      notify.success(res.status === 'POSTED' ? `Return ${res.returnNo} posted. Refund ${currency} ${Number(res.refundAmount).toFixed(2)}.` : `Return ${res.returnNo} sent for manager approval. Do not refund yet.`);
      setSale(null);
      setReload((n) => n + 1);
      loadReturns();
    } catch (e: any) { notify.error(e.message); } finally { setBusy(false); }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && !window.confirm('Reject this return? Nothing will be refunded.')) return;
    try {
      const res = await api(`/pos/returns/${id}/${action}`, { method: 'POST' });
      notify.success(action === 'approve' ? `Approved. Refund ${currency} ${Number(res.refundAmount).toFixed(2)}.` : 'Return rejected');
      loadReturns();
    } catch (e: any) { notify.error(e.message); loadReturns(); }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="rounded-2xl border border-[#e6e9f0] bg-white p-4">
        <h2 className="mb-3 text-[15px] font-semibold">New return</h2>
        <Input prefix={<Search size={15} />} allowClear placeholder="Sale number, invoice number or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!sale && (
          <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
            {sales.map((s) => (
              <button key={s.id} type="button" onClick={() => choose(s)} className="flex w-full items-center justify-between rounded-xl border border-[#e6e9f0] p-3 text-left hover:border-[#003366]">
                <div>
                  <div className="text-[13px] font-semibold">{s.saleNo} <span className="font-normal text-[#64748b]">· {s.invoice?.invoiceNo}</span></div>
                  <div className="text-[12px] text-[#64748b]">{s.customer?.name} · {new Date(s.completedAt || s.createdAt).toLocaleString()}</div>
                </div>
                <span className="text-[13px] font-semibold">{currency} {Number(s.total).toFixed(2)}</span>
              </button>
            ))}
            {!sales.length && <div className="py-6 text-center text-[13px] text-[#64748b]">No completed sales match.</div>}
          </div>
        )}
        {sale && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[13px]"><b>{sale.saleNo}</b> · {sale.customer?.name}</div>
              <Button size="small" onClick={() => setSale(null)}>Change sale</Button>
            </div>
            {saleLines.map((l: any) => {
              const left = Math.max(0, Number(l.quantity) - (returned.get(l.id) || 0));
              return (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl border border-[#e6e9f0] p-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{l.description}</div>
                    <div className="text-[12px] text-[#64748b]">Sold {Number(l.quantity)} · {left} returnable · {currency} {Number(l.lineTotal).toFixed(2)}</div>
                  </div>
                  <InputNumber min={0} max={left} disabled={!left} value={qty[l.id] || null} placeholder="0" className="!w-20" onChange={(v) => setQty((q) => ({ ...q, [l.id]: Number(v || 0) }))} />
                </div>
              );
            })}
            <Select className="w-full" placeholder="Reason" value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: r }))} />
            <Input.TextArea rows={2} placeholder="Details (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
            <Select className="w-full" value={method} onChange={setMethod} options={REFUND_METHODS} />
            {['CARD', 'BANK', 'MOBILE'].includes(method) && <Input placeholder="Reversal reference" value={reference} onChange={(e) => setReference(e.target.value)} />}
            <div className="flex items-center justify-between rounded-xl bg-[#f8fafc] p-3 text-[13px]">
              <span>Credit value</span><b>{currency} {refundTotal.toFixed(2)}</b>
            </div>
            <p className="text-[12px] text-[#64748b]">
              {canApprove ? 'You can approve refunds, so this posts a credit note and restocks immediately.' : 'A manager must approve this return before anything is refunded or restocked.'}
              {' '}Cash refunded never exceeds what the customer paid.
            </p>
            <Button type="primary" block size="large" loading={busy} onClick={submit}>{canApprove ? 'Post return' : 'Request return'}</Button>
          </div>
        )}
      </section>

      <section className="min-w-0 rounded-2xl border border-[#e6e9f0] bg-white p-4">
        <h2 className="mb-3 text-[15px] font-semibold">Returns</h2>
        <Table size="small" rowKey="id" dataSource={returns} pagination={{ pageSize: 10 }} scroll={{ x: 640 }}
          columns={[
            { title: 'Return', dataIndex: 'returnNo' },
            { title: 'Sale', render: (_, r: any) => r.sale?.saleNo },
            { title: 'Reason', dataIndex: 'reason', ellipsis: true },
            { title: 'Value', align: 'right', render: (_, r: any) => Number(r.total).toFixed(2) },
            { title: 'Refunded', align: 'right', render: (_, r: any) => r.status === 'POSTED' ? `${Number(r.refundAmount).toFixed(2)} ${r.refundMethod || ''}` : '—' },
            { title: 'Status', render: (_, r: any) => <Tag color={STATUS_COLOR[r.status]}>{String(r.status).replace(/_/g, ' ').toLowerCase()}</Tag> },
            {
              title: '', render: (_, r: any) => canApprove && r.status === 'PENDING_APPROVAL' ? (
                <div className="flex gap-1"><Button size="small" type="primary" onClick={() => decide(r.id, 'approve')}>Approve</Button><Button size="small" onClick={() => decide(r.id, 'reject')}>Reject</Button></div>
              ) : null,
            },
          ]} />
        {returns.some((r) => r.status === 'RECONCILIATION_REQUIRED') && (
          <p className="mt-2 text-[12px] text-[#b91c1c]">A return marked reconciliation required has its credit note posted but the refund or restock did not finish. Finance must check it before any money changes hands.</p>
        )}
      </section>
    </div>
  );
}
