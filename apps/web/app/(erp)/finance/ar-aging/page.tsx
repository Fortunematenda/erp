'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined, WarningOutlined, PayCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { FinanceSummaryCard } from '@/components/finance-ui';
import { CustomerAvatar } from '@/components/sales-ui';

const BUCKET_COLS = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1–30' },
  { key: 'd31_60', label: '31–60' },
  { key: 'd61_90', label: '61–90' },
  { key: 'd90plus', label: '90+' },
];
function bucketColor(key: string, v: number) { if (!v) return '#c3c7dc'; return ({ current: '#344054', d1_30: '#475467', d31_60: '#b45309', d61_90: '#c2410c', d90plus: '#b42318' } as Record<string, string>)[key] || '#475467'; }
function cell(v: number, key: string) { return v ? <span className="font-semibold tabular-nums text-[14px]" style={{ color: bucketColor(key, v) }}>{fmtMoney(v)}</span> : <span className="text-[#c3c7dc]">—</span>; }

export default function ArAgingPage() {
  const qc = useQueryClient();
  const [asOf, setAsOf] = useState<any>(dayjs());
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [bucketFilter, setBucketFilter] = useState<string | null>(null);

  useEffect(() => { const id = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(id); }, [q]);

  const aging = useQuery({ queryKey: ['ar-aging', asOf?.format('YYYY-MM-DD')], queryFn: () => api(`/sales/ar-aging${asOf ? `?asOf=${asOf.format('YYYY-MM-DD')}` : ''}`) });
  const d = aging.data;

  const rows = useMemo(() => {
    let r = d?.customers || [];
    if (debouncedQ) r = r.filter((x: any) => `${x.customerCode} ${x.customerName} ${x.email || ''}`.toLowerCase().includes(debouncedQ.toLowerCase()));
    if (bucketFilter === 'overdue') r = r.filter((x: any) => (x.d1_30 + x.d31_60 + x.d61_90 + x.d90plus) > 0);
    if (bucketFilter === 'd90plus') r = r.filter((x: any) => x.d90plus > 0);
    if (bucketFilter && ['d1_30', 'd31_60', 'd61_90'].includes(bucketFilter)) r = r.filter((x: any) => x[bucketFilter] > 0);
    return r;
  }, [d, debouncedQ, bucketFilter]);

  const totalReceivables = d?.summary?.totalReceivables ?? 0;
  const overdue = d?.summary?.overdueAmount ?? 0;
  const custCount = d?.summary?.customersWithBalance ?? 0;
  const over90 = d?.summary?.over90 ?? 0;
  const recon = d?.reconciliation;
  const reconDiff = recon ? Math.abs(Number(recon.difference || 0)) > 0.01 : false;

  const columns: ColumnsType<any> = [
    { title: 'Customer', render: (_v, r) => (
      <Link href={`/sales/customers/${r.customerId}`} className="flex items-center gap-2.5 group">
        <CustomerAvatar name={r.customerName} size={30} />
        <span className="text-[13px] font-medium text-[#171a2e] group-hover:text-[#003366]">{r.customerName}</span>
        {(r.customerId === 'unknown' || /unknown|archived/i.test(r.customerName)) && <Tooltip title={r.customerId === 'unknown' ? 'Receivable not linked to a valid customer record' : 'Historical/archived customer'}><WarningOutlined className="text-[#b45309]" /></Tooltip>}
        {r.missingDue && <Tooltip title="Missing due date (no payment terms)"><span className="text-[10px] px-1.5 py-0.5 rounded bg-[#fef3c7] text-[#92400e]">No due date</span></Tooltip>}
        {r.unappliedCredit > 0 && <Tooltip title={`Credit available: ${fmtMoney(r.unappliedCredit)}`}><span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ecfdf5] text-[#047857]">Credit {fmtMoney(r.unappliedCredit)}</span></Tooltip>}
      </Link>
    ) },
    ...BUCKET_COLS.map((b) => ({ title: b.label, align: 'right' as const, width: 120, render: (_v: any, r: any) => cell(Number(r[b.key]), b.key) })),
    { title: 'Total', align: 'right', width: 130, render: (_v: any, r: any) => <span className="font-bold tabular-nums text-[14px] text-[#1f2937]">{fmtMoney(r.total)}</span> },
    { title: 'Actions', width: 150, render: (_v: any, r: any) => (
      <div className="flex items-center gap-2">
        <Button size="small" type="primary" icon={<PayCircleOutlined />} href="/sales/receipts">Receive</Button>
        <Link href={`/sales/customers/${r.customerId}`}><Button size="small">View</Button></Link>
      </div>
    ) },
  ];

  const invoiceCols: ColumnsType<any> = [
    { title: 'Invoice', dataIndex: 'invoiceNumber', width: 120, render: (v) => <span className="font-mono text-[12px] text-[#003366] font-semibold">{v}</span> },
    { title: 'Due Date', dataIndex: 'effectiveDue', width: 120, render: (v: any) => (v ? dayjs(v).format('D MMM YYYY') : <span className="text-[#c3c7dc]">—</span>) },
    { title: 'Days Overdue', dataIndex: 'daysOverdue', width: 110, render: (v: any, r: any) => r.daysOverdue == null ? (r.missingDue ? <span className="text-[#b45309]">No due date</span> : <span className="text-[#98A2B3]">Current</span>) : (r.daysOverdue > 0 ? `${r.daysOverdue} days` : <span className="text-[#98A2B3]">Current</span>) },
    { title: 'Original', dataIndex: 'originalAmount', align: 'right', width: 110, render: (v) => fmtMoney(v) },
    { title: 'Applied', dataIndex: 'appliedAmount', align: 'right', width: 110, render: (v) => fmtMoney(v) },
    { title: 'Remaining', dataIndex: 'remainingAmount', align: 'right', width: 120, render: (v) => <span className="font-semibold">{fmtMoney(v)}</span> },
    { title: 'Status', dataIndex: 'paymentStatus', width: 140, render: (v) => <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: v === 'OVERDUE' ? '#fef2f2' : v === 'PARTIALLY_PAID' ? '#fffbeb' : '#f2f4f7', color: v === 'OVERDUE' ? '#b42318' : v === 'PARTIALLY_PAID' ? '#92400e' : '#475467' }}>{String(v).replace(/_/g, ' ')}</span> },
    { title: '', width: 90, render: (_v: any, r: any) => <Button size="small" icon={<PayCircleOutlined />} href="/sales/receipts">Receive</Button> },
  ];

  function refresh() { qc.invalidateQueries({ queryKey: ['ar-aging'] }); }

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">A/R Aging</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Receivables outstanding by age {asOf ? `· As of ${dayjs(asOf).format('D MMM YYYY')}` : ''}</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <button type="button" onClick={() => setBucketFilter(null)} className="text-left w-full"><FinanceSummaryCard label="Total Receivables" value={fmtMoney(totalReceivables)} valueColor="#2563eb" subtitle={`${custCount} customers with balances`} /></button>
        <button type="button" onClick={() => setBucketFilter(bucketFilter === 'overdue' ? null : 'overdue')} className="text-left w-full"><FinanceSummaryCard label="Overdue Amount" value={fmtMoney(overdue)} valueColor="#EF4444" subtitle="Excludes current" /></button>
        <div><FinanceSummaryCard label="Customers with Balance" value={custCount} valueColor="#7c3aed" subtitle="Outstanding > 0" /></div>
        <button type="button" onClick={() => setBucketFilter(bucketFilter === 'd90plus' ? null : 'd90plus')} className="text-left w-full"><FinanceSummaryCard label="90+ Days" value={fmtMoney(over90)} valueColor="#f97316" subtitle="High risk exposure" /></button>
      </div>

      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[12px] text-[#5a6080]">As of <DatePicker value={asOf} onChange={setAsOf} allowClear={false} /></div>
        <Input allowClear prefix={<SearchOutlined className="text-[#a1a6c0]" />} placeholder="Search customer / code / email…" className="w-80 !rounded-lg" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ml-auto flex items-center gap-2">
          {BUCKET_COLS.slice(1).map((b) => (
            <button key={b.key} onClick={() => setBucketFilter(bucketFilter === b.key ? null : b.key)} className={`px-2.5 py-1 rounded-full text-[12px] font-medium ${bucketFilter === b.key ? 'bg-[#003366] text-white' : 'bg-[#f2f3f9] text-[#5a6080] hover:bg-[#e8ebf4]'}`}>{b.label}</button>
          ))}
        </div>
      </div>

      {reconDiff && (
        <div className="rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2 text-[13px]" style={{ background: '#fff5f5', border: '1px solid #fed7d7', color: '#b42318' }}>
          <WarningOutlined /> A/R reconciliation difference detected — Subledger {fmtMoney(recon.subledger)} vs GL Control {fmtMoney(recon.control)} (Difference {fmtMoney(recon.difference)}).
        </div>
      )}
      {!reconDiff && recon?.control != null && (
        <div className="rounded-lg px-4 py-2.5 mb-4 text-[13px]" style={{ background: '#f6fdfa', color: '#047857' }}>A/R Subledger {fmtMoney(recon.subledger)} reconciles to GL Control {fmtMoney(recon.control)}.</div>
      )}

      <div className="nex-card">
        <Table
          rowKey="customerId"
          loading={aging.isLoading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 1000 }}
          sticky
          size="middle"
          expandable={{ rowExpandable: (r) => (r.invoices?.length || 0) > 0, expandedRowRender: (r) => <Table size="small" rowKey="invoiceId" dataSource={r.invoices} columns={invoiceCols} pagination={false} scroll={{ x: 900 }} /> }}
          pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '25', '50'], showTotal: (t) => `${t} customers` }}
        />
        <div className="flex items-center justify-end gap-6 px-5 py-3 border-t border-[#e9edf2] text-[13px]">
          <span className="font-semibold" style={{ color: '#5a6080' }}>TOTALS</span>
          {BUCKET_COLS.map((b) => <span key={b.key} className="tabular-nums font-semibold" style={{ color: bucketColor(b.key, Number(d?.summary?.[b.key] || 0)) }}>{fmtMoney(d?.summary?.[b.key] || 0)}</span>)}
          <span className="font-bold tabular-nums text-[#1f2937]">{fmtMoney(totalReceivables)}</span>
        </div>
      </div>
    </div>
  );
}
