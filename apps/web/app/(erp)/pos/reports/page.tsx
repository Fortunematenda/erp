'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, DatePicker, Select, Table } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', CARD: 'Card', BANK: 'Bank', MOBILE: 'Mobile money', CREDIT: 'On account' };

function download(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

export default function Page() {
  const [boot, setBoot] = useState<any>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('day'), dayjs().endOf('day')]);
  const [mode, setMode] = useState('');
  const [method, setMethod] = useState('');
  const [registerId, setRegisterId] = useState('');
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api('/pos/bootstrap').then(setBoot).catch((e) => notify.error(e.message)); }, []);
  const load = useCallback(async () => {
    if (!boot) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ branchId: boot.branch.id, from: range[0].startOf('day').toISOString(), to: range[1].endOf('day').toISOString() });
      if (mode) q.set('mode', mode);
      if (method) q.set('method', method);
      if (registerId) q.set('registerId', registerId);
      setRow(await api(`/pos/reports/summary?${q}`));
    } catch (e: any) { notify.error(e.message); } finally { setLoading(false); }
  }, [boot, range, mode, method, registerId]);
  useEffect(() => { load(); }, [load]);

  const currency = boot?.currency || '';
  const m = (n: number) => `${currency} ${Number(n || 0).toFixed(2)}`;
  const cards: [string, string | number][] = row ? [
    ['Gross sales (incl. tax)', m(row.revenue)], ['Transactions', row.transactions], ['Average sale', m(row.average)],
    ['Net sales (after returns, excl. tax)', m(row.netSales)], ['Cost of goods', m(row.cogs)], ['Gross profit', `${m(row.grossProfit)} · ${row.margin}%`],
    ['Discounts given', m(row.discounts)], ['Tax collected', m(row.tax)], ['Returns', `${m(row.refunds)} (${row.refundCount})`],
    ['Cash refunded', m(row.refundsPaid)], ['Fiscal failures', row.fiscalFailed], ['Fiscal pending', row.fiscalPending],
  ] : [];

  function exportCsv() {
    if (!row) return;
    const period = `${range[0].format('YYYY-MM-DD')} to ${range[1].format('YYYY-MM-DD')}`;
    download(`pos-report-${range[0].format('YYYYMMDD')}-${range[1].format('YYYYMMDD')}.csv`, [
      ['POS report', boot?.branch?.name, period],
      [],
      ['Metric', 'Value'], ...cards,
      [],
      ['Payment method', 'Amount'], ...Object.entries(row.byMethod || {}).map(([k, v]) => [METHOD_LABEL[k] || k, Number(v).toFixed(2)]),
      [],
      ['Mode', 'Sales', 'Amount'], ...Object.entries(row.byMode || {}).map(([k, v]: any) => [k, v.count, v.total.toFixed(2)]),
      [],
      ['Cashier', 'Sales', 'Amount'], ...(row.byCashier || []).map((c: any) => [c.name, c.count, c.total.toFixed(2)]),
      [],
      ['Item', 'Quantity', 'Amount'], ...(row.topItems || []).map((i: any) => [i.description, i.quantity, i.total.toFixed(2)]),
      [],
      ['Hour', 'Amount'], ...Object.entries(row.byHour || {}).sort().map(([h, v]) => [`${h}:00`, Number(v).toFixed(2)]),
    ]);
  }

  const hours = Object.entries(row?.byHour || {}).sort();
  const peak = Math.max(1, ...hours.map(([, v]) => Number(v)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker.RangePicker value={range} allowClear={false} onChange={(v) => v?.[0] && v?.[1] && setRange([v[0], v[1]])}
          presets={[
            { label: 'Today', value: [dayjs().startOf('day'), dayjs().endOf('day')] },
            { label: 'Yesterday', value: [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').endOf('day')] },
            { label: 'This week', value: [dayjs().startOf('week'), dayjs().endOf('day')] },
            { label: 'This month', value: [dayjs().startOf('month'), dayjs().endOf('day')] },
          ]} />
        <Select className="min-w-[140px]" value={mode} onChange={setMode} options={[{ value: '', label: 'All modes' }, { value: 'RETAIL', label: 'Retail' }, { value: 'SERVICE', label: 'Services' }, { value: 'RESTAURANT', label: 'Restaurant' }]} />
        <Select className="min-w-[150px]" value={method} onChange={setMethod} options={[{ value: '', label: 'Any payment' }, ...Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))]} />
        <Select className="min-w-[150px]" value={registerId} onChange={setRegisterId} options={[{ value: '', label: 'All registers' }, ...(boot?.registers || []).map((r: any) => ({ value: r.id, label: r.name }))]} />
        <Button icon={<Download size={14} />} disabled={!row} onClick={exportCsv}>CSV</Button>
      </div>
      {loading && !row && <div className="text-[13px] text-[#64748b]">Loading POS figures…</div>}
      {row && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(([k, v]) => <div key={k} className="rounded-2xl border border-[#e6e9f0] bg-white p-4"><div className="text-[12px] text-[#64748b]">{k}</div><div className="mt-1 text-[18px] font-semibold">{v}</div></div>)}
          </div>
          <p className="text-[12px] text-[#64748b]">Figures come from completed POS sales and their posted journals. Returns count in the period they were approved. Cost of goods comes from the stock issue journals, net of goods returned to stock.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-[#e6e9f0] bg-white p-4">
              <h3 className="mb-2 text-[13px] font-semibold">Payments received</h3>
              {Object.entries(row.byMethod || {}).map(([k, v]) => <div key={k} className="flex justify-between py-1 text-[13px]"><span>{METHOD_LABEL[k] || k}</span><span>{m(Number(v))}</span></div>)}
              {!Object.keys(row.byMethod || {}).length && <div className="text-[13px] text-[#64748b]">No payments in this period.</div>}
              <h3 className="mb-2 mt-4 text-[13px] font-semibold">By mode</h3>
              {Object.entries(row.byMode || {}).map(([k, v]: any) => <div key={k} className="flex justify-between py-1 text-[13px]"><span>{k.charAt(0) + k.slice(1).toLowerCase()} · {v.count}</span><span>{m(v.total)}</span></div>)}
            </section>
            <section className="rounded-2xl border border-[#e6e9f0] bg-white p-4">
              <h3 className="mb-2 text-[13px] font-semibold">Sales by hour</h3>
              <div className="flex h-36 items-end gap-1">
                {hours.map(([h, v]) => (
                  <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${h}:00 · ${m(Number(v))}`}>
                    <div className="w-full rounded-t bg-[#003366]" style={{ height: `${(Number(v) / peak) * 110}px` }} />
                    <span className="text-[10px] text-[#64748b]">{h}</span>
                  </div>
                ))}
                {!hours.length && <div className="text-[13px] text-[#64748b]">No sales in this period.</div>}
              </div>
            </section>
            <section className="rounded-2xl border border-[#e6e9f0] bg-white p-4">
              <h3 className="mb-2 text-[13px] font-semibold">Cashiers</h3>
              <Table size="small" rowKey="id" pagination={false} dataSource={row.byCashier || []} columns={[
                { title: 'Cashier', dataIndex: 'name' }, { title: 'Sales', dataIndex: 'count', align: 'right' }, { title: 'Amount', align: 'right', render: (_, r: any) => r.total.toFixed(2) },
              ]} />
            </section>
            <section className="rounded-2xl border border-[#e6e9f0] bg-white p-4">
              <h3 className="mb-2 text-[13px] font-semibold">Top items</h3>
              <Table size="small" rowKey="description" pagination={false} dataSource={row.topItems || []} columns={[
                { title: 'Item', dataIndex: 'description', ellipsis: true }, { title: 'Qty', dataIndex: 'quantity', align: 'right' }, { title: 'Amount', align: 'right', render: (_, r: any) => r.total.toFixed(2) },
              ]} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
