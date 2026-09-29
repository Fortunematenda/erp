'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/sales-ui';
import { StatCard } from '@/components/stat-card';
import { SkeletonTable } from '@/components/loading';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';

const { RangePicker } = DatePicker;

const PRESETS: { key: string; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'thisYear', label: 'This Year' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom Range' },
];

function presetRange(key: string): [any, any] {
  const now = dayjs();
  switch (key) {
    case 'today': return [now.startOf('day'), now.endOf('day')];
    case 'yesterday': return [now.subtract(1, 'day').startOf('day'), now.subtract(1, 'day').endOf('day')];
    case 'last7': return [now.subtract(6, 'day').startOf('day'), now.endOf('day')];
    case 'last30': return [now.subtract(29, 'day').startOf('day'), now.endOf('day')];
    case 'lastMonth': return [now.subtract(1, 'month').startOf('month'), now.subtract(1, 'month').endOf('month')];
    case 'thisYear': return [now.startOf('year'), now.endOf('day')];
    case 'all': return [dayjs('2000-01-01'), now.endOf('day')];
    case 'thisMonth':
    default: return [now.startOf('month'), now.endOf('day')];
  }
}

const ENV_META: Record<string, { color: string; label: string }> = {
  MOCK: { color: 'default', label: 'MOCK' },
  SANDBOX: { color: 'blue', label: 'SANDBOX' },
  PRODUCTION: { color: 'red', label: 'PRODUCTION' },
};
const RECEIPT_TYPES = ['FiscalInvoice', 'FiscalCreditNote', 'FiscalDebitNote'];
const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK', 'MOBILE_MONEY', 'CREDIT', 'CHEQUE', 'OTHER'];
const CURRENCIES = ['USD', 'ZWG', 'ZAR', 'EUR', 'GBP'];

export function FiscalisationReports() {
  const [preset, setPreset] = useState('thisMonth');
  const [range, setRange] = useState<[any, any]>(presetRange('thisMonth'));
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [branchId, setBranchId] = useState<string | undefined>();
  const [receiptType, setReceiptType] = useState<string | undefined>();
  const [currency, setCurrency] = useState<string | undefined>();
  const [paymentMethod, setPaymentMethod] = useState<string | undefined>();

  const devices = useQuery({ queryKey: ['fiscal-devices'], queryFn: () => api('/fiscalisation/devices') });
  const branches = useQuery({ queryKey: ['fiscal-branches'], queryFn: () => api('/fiscalisation/branches') });

  function applyPreset(key: string) {
    setPreset(key);
    if (key !== 'custom') setRange(presetRange(key));
  }

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (range?.[0]) p.set('startDate', range[0].startOf('day').toISOString());
    if (range?.[1]) p.set('endDate', range[1].endOf('day').toISOString());
    if (deviceId) p.set('deviceId', deviceId);
    if (branchId) p.set('branchId', branchId);
    if (receiptType) p.set('receiptType', receiptType);
    if (currency) p.set('currency', currency);
    if (paymentMethod) p.set('paymentMethod', paymentMethod);
    return p.toString();
  }, [range, deviceId, branchId, receiptType, currency, paymentMethod]);

  const report = useQuery({ queryKey: ['fiscal-reports', params], queryFn: () => api(`/fiscalisation/reports?${params}`), placeholderData: (prev: any) => prev });
  const d = report.data;
  const env = String(d?.environment || 'MOCK').toUpperCase();
  const envMeta = ENV_META[env] || ENV_META.MOCK;

  const reset = () => { setDeviceId(undefined); setBranchId(undefined); setReceiptType(undefined); setCurrency(undefined); setPaymentMethod(undefined); applyPreset('thisMonth'); };

  function exportCsv() {
    const rows = d?.receipts || [];
    const meta = [
      `# NexusERP Fiscalisation Report`,
      `# Environment: ${env}`,
      `# Period: ${range?.[0] ? range[0].format('YYYY-MM-DD') : 'start'} to ${range?.[1] ? range[1].format('YYYY-MM-DD') : 'now'}`,
      `# Receipts: ${rows.length} | Gross: ${Number(d?.totals?.gross || 0).toFixed(2)} | VAT: ${Number(d?.totals?.vat || 0).toFixed(2)}`,
    ];
    const body = [
      ['Receipt #', 'Global #', 'Day', 'Document', 'Type', 'Environment', 'Currency', 'Payment', 'Total', 'VAT', 'Status'],
      ...rows.map((r: any) => ['RCP-' + String(r.globalReceiptNo).padStart(6, '0'), r.globalReceiptNo, r.fiscalDayNo, r.invoice?.invoiceNo || r.creditNote?.creditNoteNo || r.debitNote?.debitNoteNo || '', r.receiptType, r.environment || env, r.currency || 'USD', r.paymentMethod || '', Number(r.total || 0), Number(r.tax || 0), r.status]),
    ].map((row: any[]) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const csv = [...meta, ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fiscal-receipts-${env.toLowerCase()}-${range?.[0] ? range[0].format('YYYYMMDD') : 'start'}-${range?.[1] ? range[1].format('YYYYMMDD') : 'now'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const cols: ColumnsType<any> = [
    { title: 'Receipt #', width: 110, render: (_v, r: any) => <span className="font-mono text-[12px]">RCP-{String(r.globalReceiptNo).padStart(6, '0')}</span> },
    { title: 'Day', width: 60, render: (_v, r: any) => `#${r.fiscalDayNo}` },
    { title: 'Document', width: 130, render: (_v, r: any) => r.invoice?.invoiceNo || r.creditNote?.creditNoteNo || r.debitNote?.debitNoteNo || '—' },
    { title: 'Type', dataIndex: 'receiptType', width: 130, render: (v) => <Tag color="blue">{String(v).replace('Fiscal', '')}</Tag> },
    { title: 'Customer', width: 150, render: (_v, r: any) => r.customerName || '—' },
    { title: 'Date', dataIndex: 'createdAt', width: 150, render: (v) => <span className="text-[12px]">{fmtDateTime(v)}</span> },
    { title: 'Currency', dataIndex: 'currency', width: 80 },
    { title: 'Payment', dataIndex: 'paymentMethod', width: 100 },
    { title: 'Total', dataIndex: 'total', width: 110, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'VAT', dataIndex: 'tax', width: 100, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusPill status={v} /> },
  ];

  const loading = report.isLoading;
  const periodLabel = `${range?.[0] ? range[0].format('DD MMM') : '—'} – ${range?.[1] ? range[1].format('DD MMM YYYY') : '—'}`;

  return (
    <div className="p-4">
      {/* Filter bar */}
      <div className="nex-card px-4 py-3 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Date Range</div>
            <RangePicker
              value={range}
              allowClear={false}
              onChange={(v) => { setRange(v as any); setPreset('custom'); }}
            />
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Quick Range</div>
            <Select value={preset} style={{ minWidth: 160 }} onChange={applyPreset} options={PRESETS.map((p) => ({ label: p.label, value: p.key }))} />
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Device</div>
            <Select allowClear placeholder="All devices" style={{ minWidth: 160 }} value={deviceId} onChange={setDeviceId} options={(devices.data || []).map((x: any) => ({ label: x.name, value: x.id }))} />
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Branch</div>
            <Select allowClear placeholder="All branches" style={{ minWidth: 160 }} value={branchId} onChange={setBranchId} options={(branches.data || []).map((x: any) => ({ label: x.name, value: x.id }))} />
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Receipt Type</div>
            <Select allowClear placeholder="All types" style={{ minWidth: 150 }} value={receiptType} onChange={setReceiptType} options={RECEIPT_TYPES.map((t) => ({ label: t.replace('Fiscal', ''), value: t }))} />
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Currency</div>
            <Select allowClear placeholder="All" style={{ minWidth: 110 }} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ label: c, value: c }))} />
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Payment</div>
            <Select allowClear placeholder="All" style={{ minWidth: 130 }} value={paymentMethod} onChange={setPaymentMethod} options={PAYMENT_METHODS.map((p) => ({ label: p, value: p }))} />
          </div>
          <div className="ml-auto flex items-end gap-2">
            <Button icon={<ReloadOutlined />} onClick={() => report.refetch()} loading={report.isFetching}>Refresh</Button>
            <Button onClick={reset}>Reset</Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={exportCsv} disabled={!d?.receipts?.length}>Export CSV</Button>
          </div>
        </div>
      </div>

      {report.isError && (
        <Alert className="mb-4" type="error" showIcon message="Could not load the fiscalisation report" description={(report.error as Error)?.message} action={<Button size="small" onClick={() => report.refetch()}>Retry</Button>} />
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard icon={<span />} label="Total Receipts" value={loading ? '…' : (d?.totals?.receipts ?? 0)} color="#1d5fb5" />
        <StatCard icon={<span />} label="Total Amount" value={loading ? '…' : fmtMoney(d?.totals?.gross)} color="#16a34a" />
        <StatCard icon={<span />} label="Total VAT" value={loading ? '…' : fmtMoney(d?.totals?.vat)} color="#f59e0b" />
        <StatCard icon={<span />} label="Date Range" value={loading ? '…' : periodLabel} color="#64748b" hint={envMeta.label} />
      </div>

      {/* Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <div className="nex-card p-4">
          <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Receipt Types Distribution</div>
          {loading ? <div className="text-[13px] text-[#94a3b8]">Loading…</div> : (d?.byType || []).length ? <div className="space-y-2">{(d?.byType || []).map((b: any) => <div key={b.key} className="flex items-center justify-between text-[13px]"><span className="text-[#344054]">{String(b.key).replace('Fiscal', '')}</span><span className="font-medium text-[#171a2e]">{b.count}</span></div>)}</div> : <div className="text-[13px] text-[#94a3b8]">No fiscal receipts in the selected period.</div>}
        </div>
        <div className="nex-card p-4">
          <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Payment Method Distribution</div>
          {loading ? <div className="text-[13px] text-[#94a3b8]">Loading…</div> : (d?.byPayment || []).length ? <div className="space-y-2">{(d?.byPayment || []).map((b: any) => <div key={b.key} className="flex items-center justify-between text-[13px]"><span className="text-[#344054]">{b.key}</span><span className="font-medium text-[#171a2e]">{b.count}</span></div>)}</div> : <div className="text-[13px] text-[#94a3b8]">No fiscal payments recorded.</div>}
        </div>
      </div>

      {(d?.byCurrency || []).length > 1 && (
        <div className="nex-card p-4 mb-5">
          <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Currency Distribution</div>
          <Table rowKey="currency" size="small" dataSource={d?.byCurrency || []} pagination={false} columns={[{ title: 'Currency', dataIndex: 'currency' }, { title: 'Receipts', dataIndex: 'receipts', align: 'right' }, { title: 'Gross', dataIndex: 'gross', align: 'right', render: (v) => fmtMoney(v) }, { title: 'VAT', dataIndex: 'vat', align: 'right', render: (v) => fmtMoney(v) }]} />
        </div>
      )}

      {/* Receipts table */}
      <div className="nex-card p-4">
        <div className="text-[13px] font-semibold text-[#171a2e] mb-3 flex items-center justify-between">
          <span>Fiscal Receipts <span className="text-[#94a3b8] font-normal">· {periodLabel} · {envMeta.label}</span></span>
          <Button size="small" icon={<DownloadOutlined />} onClick={exportCsv} disabled={!d?.receipts?.length}>Export CSV</Button>
        </div>
        {loading && !d ? <SkeletonTable rows={6} columns={7} /> : (
          <>
            <Table rowKey="id" size="small" loading={report.isFetching} dataSource={d?.receipts || []} columns={cols} pagination={{ pageSize: 12 }} />
            {!report.isFetching && !(d?.receipts || []).length && <div className="text-center text-[#64748b] py-6">No fiscal receipts found for the selected period.</div>}
          </>
        )}
      </div>
    </div>
  );
}
