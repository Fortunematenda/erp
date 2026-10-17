'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Drawer, Input, Select, Table, Tag } from 'antd';
import { Printer, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { PosReceipt } from '@/components/pos/terminal';

const SALE_COLOR: Record<string, string> = { POSTED: 'green', REVERSED: 'default', PENDING_PAYMENT: 'red', DRAFT: 'blue' };
const FISCAL_COLOR: Record<string, string> = { FISCALISED: 'green', SUBMITTED: 'blue', PENDING: 'gold', FAILED: 'red', NOT_REQUIRED: 'default' };
const label = (s: string) => String(s || '').replace(/_/g, ' ').toLowerCase();

function Transactions() {
  const router = useRouter();
  const params = useSearchParams();
  const [boot, setBoot] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') || 'POSTED,REVERSED,PENDING_PAYMENT');
  const [fiscal, setFiscal] = useState(params.get('fiscal') || '');
  const [mode, setMode] = useState('');
  const [open, setOpen] = useState<any>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => { api('/pos/bootstrap').then(setBoot).catch((e) => notify.error(e.message)); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ take: '200' });
      if (status) q.set('status', status);
      if (fiscal) q.set('fiscal', fiscal);
      if (mode) q.set('mode', mode);
      if (search.trim()) q.set('search', search.trim());
      setRows(await api(`/pos/sales?${q}`));
    } catch (e: any) { notify.error(e.message); } finally { setLoading(false); }
  }, [status, fiscal, mode, search]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function retryFiscal(sale: any) {
    setRetrying(true);
    try {
      const res = await api(`/pos/sales/${sale.id}/fiscalise`, { method: 'POST' });
      notify.success(`Fiscal status: ${label(res.fiscalStatus || res.status || 'updated')}`);
      setOpen(null);
      load();
    } catch (e: any) { notify.error(e.message); } finally { setRetrying(false); }
  }

  const currency = boot?.currency || 'USD';
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="!w-full sm:!w-72" prefix={<Search size={15} />} allowClear placeholder="Sale, invoice or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="min-w-[180px]" value={status} onChange={setStatus} options={[
          { value: 'POSTED,REVERSED,PENDING_PAYMENT', label: 'All completed' },
          { value: 'POSTED', label: 'Posted' },
          { value: 'REVERSED', label: 'Fully returned' },
          { value: 'PENDING_PAYMENT', label: 'Payment not recorded' },
        ]} />
        <Select className="min-w-[160px]" value={fiscal} onChange={setFiscal} options={[{ value: '', label: 'Any fiscal status' }, ...['FISCALISED', 'SUBMITTED', 'PENDING', 'FAILED', 'NOT_REQUIRED'].map((v) => ({ value: v, label: label(v) }))]} />
        <Select className="min-w-[140px]" value={mode} onChange={setMode} options={[{ value: '', label: 'All modes' }, { value: 'RETAIL', label: 'Retail' }, { value: 'SERVICE', label: 'Services' }, { value: 'RESTAURANT', label: 'Restaurant' }]} />
      </div>
      <Table rowKey="id" size="small" loading={loading} dataSource={rows} pagination={{ pageSize: 25 }} scroll={{ x: 820 }}
        onRow={(r) => ({ onClick: () => setOpen(r), className: 'cursor-pointer' })}
        columns={[
          { title: 'Sale', dataIndex: 'saleNo' },
          { title: 'When', render: (_, r: any) => new Date(r.completedAt || r.createdAt).toLocaleString() },
          { title: 'Customer', render: (_, r: any) => r.customer?.name || '—', ellipsis: true },
          { title: 'Mode', render: (_, r: any) => label(r.mode) },
          { title: 'Status', render: (_, r: any) => <Tag color={SALE_COLOR[r.saleStatus]}>{label(r.saleStatus)}</Tag> },
          { title: 'Fiscal', render: (_, r: any) => <Tag color={FISCAL_COLOR[r.fiscalStatus]}>{label(r.fiscalStatus)}</Tag> },
          { title: 'Paid by', render: (_, r: any) => [...new Set((r.tenders || []).map((t: any) => t.method))].join(', ') },
          { title: 'Total', align: 'right', render: (_, r: any) => `${Number(r.total).toFixed(2)}` },
          { title: 'Invoice', render: (_, r: any) => r.invoice?.invoiceNo || '—' },
        ]} />
      <Drawer open={!!open} onClose={() => setOpen(null)} width={440} title={open ? `Sale ${open.saleNo}` : ''}
        extra={<Button icon={<Printer size={14} />} onClick={() => window.print()}>Reprint</Button>}>
        {open && (
          <div className="space-y-4">
            <PosReceipt sale={open} company={boot?.company} branch={boot?.branch} currency={open.currency || currency} />
            <div className="flex flex-wrap gap-2">
              {['FAILED', 'PENDING', 'SUBMITTED'].includes(open.fiscalStatus) && <Button type="primary" loading={retrying} onClick={() => retryFiscal(open)}>Retry fiscalisation</Button>}
              {open.saleStatus === 'POSTED' && boot?.can?.['pos.refund'] && <Button onClick={() => router.push('/pos/returns')}>Start a return</Button>}
              {open.invoice?.id && <Button onClick={() => router.push(`/sales/invoices/${open.invoice.id}/edit`)}>Open invoice</Button>}
            </div>
            {(open.returns || []).length > 0 && (
              <div className="text-[12px] text-[#64748b]">Returns: {open.returns.map((r: any) => `${r.returnNo} (${label(r.status)})`).join(', ')}</div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default function Page() { return <Suspense><Transactions /></Suspense>; }
