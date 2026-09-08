'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import dayjs from 'dayjs';
import { Alert, Button, Drawer, Empty, Skeleton, Space, Table, Tabs, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AreaChartOutlined, DownloadOutlined, FileDoneOutlined, PrinterOutlined, ReloadOutlined, StarOutlined, StarFilled } from '@ant-design/icons';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { Can } from '@/components/Can';
import { CompareHint } from './report-kit';

export type ReportCtx = {
  win: { from: string | null; to: string | null };
  compareWin: { from: string | null; to: string | null };
  compare: string;
  branchId: string | null;
  currency: string | null;
  branches: any[];
  companyName: string;
  periodLabel: string;
};

const qs = (params: Record<string, any>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '' && v !== 'ALL') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const NAVY = '#003366';
export const NAVY2 = '#1d5fb5';
const CHART_COLORS = ['#003366', '#1d5fb5', '#0ea5e9', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed'];

export function exportReportCsv(filename: string, ctx: ReportCtx, title: string, columns: { key: string; label: string }[], rows: any[], totals?: Record<string, number>) {
  if (!rows.length) { message.info('Nothing to export'); return; }
  const meta = [
    ['NexusERP Report', title],
    ['Period', ctx.periodLabel],
    ['Company', ctx.companyName],
    ['Branch', ctx.branchId ? (ctx.branches.find((b) => b.id === ctx.branchId)?.name || ctx.branchId) : 'All Branches'],
    ['Currency', ctx.currency || 'All Currencies'],
    ['Generated At', new Date().toLocaleString()],
    [],
  ];
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ...meta.map((r) => r.join(',')),
    columns.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => esc(typeof r[c.key] === 'number' ? r[c.key] : r[c.key])).join(',')),
  ];
  if (totals && Object.keys(totals).length) lines.push(columns.map((c) => esc(c.key === columns[0].key ? 'GRAND TOTAL' : totals[c.key] != null ? totals[c.key] : '')).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${filename}-${dayjs().format('YYYYMMDD-HHmm')}.csv`; a.click(); URL.revokeObjectURL(url);
  message.success('Exported CSV with report metadata');
}

export function Money({ v, bold, color }: { v: any; bold?: boolean; color?: string }) {
  if (v == null) return <span className="text-[#c3c9d6]">—</span>;
  return <span className={`${bold ? 'font-semibold' : ''}`} style={color ? { color } : undefined}>{fmtMoney(v)}</span>;
}

export function EmptyState({ title, hint, onClear }: { title: string; hint: string; onClear?: () => void }) {
  return (
    <div className="py-10 text-center">
      <FileDoneOutlined className="text-[34px] text-[#c3c9d6]" />
      <div className="text-[14px] font-semibold text-[#344054] mt-2">{title}</div>
      <div className="text-[12px] text-[#94a3b8] mt-1 max-w-sm mx-auto">{hint}</div>
      {onClear && <Button size="small" className="mt-3" onClick={onClear}>Clear Filters</Button>}
    </div>
  );
}

export function LoadOrError({ q, children, label }: { q: any; children: (data: any) => React.ReactNode; label: string }) {
  if (q.isLoading) return <div className="p-6"><Skeleton active paragraph={{ rows: 5 }} /></div>;
  if (q.error) return (
    <div className="py-10 text-center">
      <div className="text-[14px] font-semibold text-[#344054]">Unable to load this report.</div>
      <div className="text-[12px] text-[#94a3b8] mt-1">The report data could not be retrieved.</div>
      <Button size="small" icon={<ReloadOutlined />} className="mt-3" onClick={() => q.refetch()}>Retry</Button>
    </div>
  );
  const d = q.data;
  const empty = Array.isArray(d) ? d.length === 0 : !d || (d.rows?.length === 0 && !d.kpis && !d.summary && !d.byCustomer);
  if (empty) return <EmptyState title={`No data for ${label}`} hint="No transactions match the selected period and filters. Adjust the filters and try again." />;
  return <>{children(d)}</>;
}

/** Ant Design Table rowKey — never use the deprecated index argument. */
export function tableRowKey(r: any, ...alts: unknown[]): string {
  for (const c of [r?.id, r?.code, r?.key, ...alts, r?.journalId, r?.sourceId, r?.invoiceId, r?.paymentNo, r?.number]) {
    if (c != null && String(c) !== '') return String(c);
  }
  try { return JSON.stringify(r); } catch { return 'row'; }
}

/** Curated dataset-backed report table: server-side filter/group/sort/page/totals. */
export function DatasetTable({ ctx, dataset, title, extraParams, drill }: { ctx: ReportCtx; dataset: string; title: string; extraParams?: Record<string, any>; drill?: (row: any) => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sorter, setSorter] = useState<{ field?: string; order?: string }>({});
  const q = useQuery({
    queryKey: ['dataset', dataset, ctx.win.from, ctx.win.to, ctx.branchId, ctx.currency, extraParams, page, pageSize, sorter],
    queryFn: () => api('/reports/run', { method: 'POST', body: JSON.stringify({ dataset, from: ctx.win.from, to: ctx.win.to, branchId: ctx.branchId || undefined, currency: ctx.currency || undefined, page, pageSize, sortBy: sorter.field, sortDir: sorter.order === 'ascend' ? 'asc' : 'desc', ...extraParams }) }),
  });
  const cols = useMemo<ColumnsType<any>>(() => (q.data?.dataset?.columns || []).map((c: any) => ({
    title: c.label,
    dataIndex: c.key,
    key: c.key,
    sorter: true,
    align: c.type === 'money' || c.type === 'number' || c.type === 'percent' ? ('right' as const) : ('left' as const),
    render: (v: any) => c.type === 'money' ? <Money v={v} /> : c.type === 'percent' ? (v != null ? `${Number(v).toFixed(1)}%` : '—') : c.type === 'date' ? fmtDate(v) : c.type === 'datetime' ? fmtDateTime(v) : (v ?? '—'),
    onHeaderCell: () => ({ onClick: () => setSorter((s) => ({ field: c.key, order: s.field === c.key && s.order === 'descend' ? 'ascend' : 'descend' })), style: { cursor: 'pointer' } }),
  })), [q.data]);
  const exportCols = (q.data?.dataset?.columns || []).map((c: any) => ({ key: c.key, label: c.label }));
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[12px] text-[#64748b]">{q.data ? `1–${Math.min(pageSize, q.data.total)} of ${q.data.total}` : ''}</span>
        <Space size={4}>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => exportReportCsv(dataset.toLowerCase(), ctx, title, exportCols, q.data?.rows || [], q.data?.totals)}>CSV</Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => q.refetch()} />
        </Space>
      </div>
      <LoadOrError q={q} label={title}>
        {(d) => (
          <>
            <Table rowKey={(r: any) => String(r.id ?? r[Object.keys(r)[0]])} size="small" dataSource={d.rows} columns={drill ? [...cols, { title: '', width: 60, render: (_v: any, r: any) => <Button size="small" type="link" onClick={() => drill(r)}>Open</Button> }] : cols}
              pagination={{ current: page, pageSize, total: d.total, showSizeChanger: true, pageSizeOptions: [25, 50, 100], onChange: (p, ps) => { setPage(p); setPageSize(ps); }, showTotal: (t, r) => `${r[0]}–${r[1]} of ${t}` }} scroll={{ x: true }}
              summary={() => (d.totals && Object.values(d.totals).some((v: any) => Number(v) !== 0) ? (
                <Table.Summary.Row className="report-total-row">
                  {d.dataset.columns.map((c: any, i: number) => (
                    <Table.Summary.Cell key={c.key} index={i} align={c.type === 'money' || c.type === 'number' ? 'right' : 'left'}>
                      {i === 0 ? <b>Grand Total</b> : d.totals[c.key] != null ? <b>{c.type === 'money' ? fmtMoney(d.totals[c.key]) : fmtNumber(d.totals[c.key])}</b> : ''}
                    </Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              ) : null)} />
          </>
        )}
      </LoadOrError>
    </div>
  );
}

/** Drill-down drawer with source-document links. */
export function DrillDrawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Drawer open={open} onClose={onClose} width="min(760px, 96vw)" title={<div><div className="text-[15px] font-bold text-[#171a2e]">{title}</div>{subtitle && <div className="text-[12px] text-[#64748b] font-normal">{subtitle}</div>}</div>} className="report-drill">
      {children}
    </Drawer>
  );
}

export function invoiceLink(no: string, id: string) {
  return <Link href={`/sales/invoices/${id}`} className="text-[#1d5fb5] font-medium hover:underline">{no}</Link>;
}
export function billLink(no: string, id: string) {
  return <Link href={`/procurement/bills/${id}`} className="text-[#1d5fb5] font-medium hover:underline">{no}</Link>;
}

/* ================================ FINANCIAL ================================ */
export function FinancialTab({ ctx }: { ctx: ReportCtx }) {
  const [ledgerAccount, setLedgerAccount] = useState<any>(null);
  const pnlQ = { from: ctx.win.from, to: ctx.win.to };
  const pnl = useQuery({ queryKey: ['pnl', pnlQ], queryFn: () => api(`/finance/profit-loss${qs(pnlQ)}`) });
  const tb = useQuery({ queryKey: ['tb', pnlQ], queryFn: () => api(`/finance/trial-balance${qs(pnlQ)}`) });
  const cf = useQuery({ queryKey: ['cf', pnlQ], queryFn: () => api('/finance/cashflow') });
  const bva = useQuery({ queryKey: ['bva'], queryFn: () => api('/finance/budget-vs-actual') });
  const [view, setView] = useState('pnl');
  const glQ = { from: ctx.win.from, to: ctx.win.to };
  const gl = useQuery({ queryKey: ['gl-ledger', glQ, ledgerAccount?.id], queryFn: () => api(`/finance/ledger${qs({ ...glQ, ...(ledgerAccount?.id ? { accountId: ledgerAccount.id } : {}) })}`), enabled: !!ledgerAccount });

  return (
    <div>
      <Tabs size="small" activeKey={view} onChange={setView} items={[
        { key: 'pnl', label: 'Profit & Loss', children: (
          <LoadOrError q={pnl} label="Profit & Loss">
            {(d) => (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div>
                  <div className="text-[13px] font-bold text-[#171a2e] mb-2">Revenue (click account for ledger)</div>
                  <Table rowKey="code" size="small" pagination={false} dataSource={Object.entries(d.revenue || {}).map(([code, v]) => ({ code, name: d.names?.[code] || code, amount: Number(v) }))} columns={[
                    { title: 'Account', render: (_v, r) => <a className="text-[13px] text-[#1d5fb5]" onClick={async () => { const acc = await api('/finance/accounts').then((accs: any) => accs.find((x: any) => x.code === r.code)); setLedgerAccount(acc || { code: r.code }); }}>{r.code} · {r.name}</a> },
                    { title: 'Amount', align: 'right', render: (_v, r) => <Money v={r.amount} bold color="#16a34a" /> },
                  ] as ColumnsType<any>} summary={() => <Table.Summary.Row className="report-total-row"><Table.Summary.Cell index={0}>Total Revenue</Table.Summary.Cell><Table.Summary.Cell index={1} align="right"><b>{fmtMoney(d.totals?.revenue)}</b></Table.Summary.Cell></Table.Summary.Row>} />
                </div>
                <div>
                  <div className="text-[13px] font-bold text-[#171a2e] mb-2">Expenses</div>
                  <Table rowKey="code" size="small" pagination={false} dataSource={Object.entries(d.expenses || {}).map(([code, v]) => ({ code, name: d.names?.[code] || code, amount: Number(v) }))} columns={[
                    { title: 'Account', render: (_v, r) => <a className="text-[13px] text-[#1d5fb5]" onClick={async () => { const acc = await api('/finance/accounts').then((accs: any) => accs.find((x: any) => x.code === r.code)); setLedgerAccount(acc || { code: r.code }); }}>{r.code} · {r.name}</a> },
                    { title: 'Amount', align: 'right', render: (_v, r) => <Money v={r.amount} bold color="#dc2626" /> },
                  ] as ColumnsType<any>} summary={() => <Table.Summary.Row className="report-total-row"><Table.Summary.Cell index={0}>Total Expenses</Table.Summary.Cell><Table.Summary.Cell index={1} align="right"><b>{fmtMoney(d.totals?.expenses)}</b></Table.Summary.Cell></Table.Summary.Row>} />
                </div>
                <div className="lg:col-span-2 rounded-lg bg-[#f0f6ff] border border-[#d7e6fa] px-4 py-3 flex justify-between items-center">
                  <span className="text-[13px] font-semibold text-[#171a2e]">Net Profit</span>
                  <span className="text-[18px] font-bold" style={{ color: Number(d.netProfit) >= 0 ? '#16a34a' : '#dc2626' }}>{fmtMoney(d.netProfit)}</span>
                </div>
              </div>
            )}
          </LoadOrError>
        ) },
        { key: 'tb', label: 'Trial Balance', children: (
          <LoadOrError q={tb} label="Trial Balance">
            {(d) => {
              const rows = Array.isArray(d) ? d : (d.rows || d.accounts || []);
              return <Table rowKey={(r: any) => tableRowKey(r, r.code)} size="small" pagination={false} dataSource={rows} columns={[
                { title: 'Code', dataIndex: 'code', width: 100 }, { title: 'Account', dataIndex: 'name' },
                { title: 'Debit', align: 'right', dataIndex: 'debit', render: (v: any) => <Money v={Number(v) || null} /> },
                { title: 'Credit', align: 'right', dataIndex: 'credit', render: (v: any) => <Money v={Number(v) || null} /> },
              ] as ColumnsType<any>} />;
            }}
          </LoadOrError>
        ) },
        { key: 'cf', label: 'Cash Flow', children: <LoadOrError q={cf} label="Cash Flow">{(d) => <SummaryTable data={d} moneyKeys />}</LoadOrError> },
        { key: 'bva', label: 'Budget vs Actual', children: <LoadOrError q={bva} label="Budget vs Actual">{(d) => <SummaryTable data={d} moneyKeys />}</LoadOrError> },
        { key: 'gl', label: 'General Ledger', children: (
          <div>
            <div className="text-[12px] text-[#64748b] mb-2">Posted journal lines for the selected period. Click revenue/expense accounts in the P&L for account-scoped drill-down.</div>
            <DatasetTable ctx={ctx} dataset="JOURNAL_LINES" title="General Ledger" extraParams={{}} />
          </div>
        ) },
      ]} />
      <DrillDrawer open={!!ledgerAccount} onClose={() => setLedgerAccount(null)} title={`Ledger — ${ledgerAccount?.code || ''} ${ledgerAccount?.name || ''}`} subtitle={ctx.periodLabel}>
        {ledgerAccount && <LoadOrError q={gl} label="General Ledger">
          {(d) => {
            const rows = (Array.isArray(d) ? d : d.rows || []).filter((l: any) => !ledgerAccount.id || l.accountCode === ledgerAccount.code);
            return <Table rowKey={(r: any) => tableRowKey(r, r.journalId, r.accountCode, r.date, r.debit, r.credit)} size="small" dataSource={rows} pagination={{ pageSize: 25 }} columns={[
              { title: 'Date', dataIndex: 'date', width: 100, render: (v: any) => fmtDate(v) },
              { title: 'Journal', dataIndex: 'journalNo', render: (v: any, r: any) => <Link href={`/finance/journals/${r.journalId}`} className="text-[#1d5fb5] hover:underline">{v}</Link> },
              { title: 'Account', render: (_v, r) => `${r.accountCode} · ${r.accountName}` },
              { title: 'Debit', align: 'right', dataIndex: 'debit', render: (v: any) => <Money v={Number(v) || null} /> },
              { title: 'Credit', align: 'right', dataIndex: 'credit', render: (v: any) => <Money v={Number(v) || null} /> },
            ] as ColumnsType<any>} />;
          }}
        </LoadOrError>}
      </DrillDrawer>
    </div>
  );
}

function SummaryTable({ data, moneyKeys }: { data: any; moneyKeys?: boolean }) {
  const flat: any[] = [];
  const walk = (obj: any, prefix?: string) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, prefix ? `${prefix} · ${k}` : k);
      else flat.push({ label: prefix ? `${prefix} · ${k}` : k, value: v });
    }
  };
  walk(data);
  return <Table rowKey="label" size="small" pagination={false} dataSource={flat.slice(0, 40)} columns={[
    { title: 'Item', dataIndex: 'label', render: (v: string) => <span className="text-[13px]">{v.replace(/_/g, ' ')}</span> },
    { title: 'Value', align: 'right', render: (_v, r) => typeof r.value === 'number' ? (moneyKeys ? fmtMoney(r.value) : fmtNumber(r.value)) : String(r.value ?? '—') },
  ] as ColumnsType<any>} />;
}

/* ================================ SALES ================================ */
export function SalesTab({ ctx }: { ctx: ReportCtx }) {
  const p = { startDate: ctx.win.from, endDate: ctx.win.to, branchId: ctx.branchId || undefined, currency: ctx.currency || undefined };
  const rep = useQuery({ queryKey: ['sales-rep', p], queryFn: () => api(`/sales/reports/sales-report${qs(p)}`) });
  const reg = useQuery({ queryKey: ['sales-reg'], queryFn: () => api('/sales/register') });
  const [drill, setDrill] = useState<{ title: string; subtitle: string; rows: any[]; kind: 'invoice' } | null>(null);

  const byMonth = useQuery({ queryKey: ['sales-month', ctx.win.from, ctx.win.to], queryFn: () => api(`/sales/sales-report${qs({ startDate: ctx.win.from, endDate: ctx.win.to })}`) });

  return (
    <div className="space-y-5">
      {/* KPI summary + comparison */}
      <LoadOrError q={rep} label="Sales Summary">
        {(d) => (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Total Sales', v: d.kpis?.totalSales, c: '#16a34a' },
                { label: 'Collected', v: d.kpis?.collected, c: NAVY2 },
                { label: 'Outstanding', v: d.kpis?.outstanding, c: '#f59e0b' },
                { label: 'Invoices', v: d.kpis?.count, plain: true },
              ].map((k) => (
                <div key={k.label} className="nex-card border rounded-lg px-4 py-3">
                  <div className="text-[12px] text-[#64748b]">{k.label}</div>
                  <div className="text-[19px] font-semibold text-[#171a2e] mt-0.5">{k.plain ? fmtNumber(k.v) : fmtMoney(k.v)}</div>
                </div>
              ))}
            </div>
            {Array.isArray(d.byMonth || byMonth.data) && (
              <div className="nex-card border rounded-lg p-4">
                <div className="text-[13px] font-bold text-[#171a2e] mb-3">Sales Trend</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={(d.byMonth || byMonth.data || []).slice(-12)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef0f6" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
                    <RTooltip formatter={(v: any) => fmtMoney(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="sales" name="Sales" fill={NAVY2} radius={[3, 3, 0, 0]} /><Bar dataKey="tax" name="Tax" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </LoadOrError>

      {/* By customer */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[14px] font-bold text-[#171a2e]">Sales by Customer</span>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => exportReportCsv('sales-by-customer', ctx, 'Sales by Customer', [
            { key: 'name', label: 'Customer' }, { key: 'invoices', label: 'Invoices' }, { key: 'totalSales', label: 'Sales' }, { key: 'collected', label: 'Collected' }, { key: 'outstanding', label: 'Outstanding' },
          ], rep.data?.byCustomer || [])}>CSV</Button>
        </div>
        <LoadOrError q={rep} label="Sales by Customer">
          {(d) => (
            <Table rowKey="customerId" size="small" dataSource={d.byCustomer} pagination={{ pageSize: 25, showTotal: (t, r) => `${r[0]}–${r[1]} of ${t}` }}
              expandable={{ expandedRowRender: (r: any) => <CustomerInvoices rows={r.children} /> }}
              columns={[
                { title: 'Customer', dataIndex: 'name', sorter: (a: any, b: any) => String(a.name).localeCompare(String(b.name)), render: (v: any, r: any) => <a className="text-[13px] font-medium text-[#1d5fb5]" onClick={() => setDrill({ title: r.name, subtitle: `${r.invoices} invoices · Sales ${fmtMoney(r.totalSales)}`, rows: r.children, kind: 'invoice' })}>{v}</a> },
                { title: 'Invoices', align: 'right', dataIndex: 'invoices', sorter: (a: any, b: any) => a.invoices - b.invoices },
                { title: 'Sales', align: 'right', dataIndex: 'totalSales', sorter: (a: any, b: any) => a.totalSales - b.totalSales, render: (v: any) => <Money v={v} bold /> },
                { title: 'Collected', align: 'right', dataIndex: 'collected', sorter: (a: any, b: any) => a.collected - b.collected, render: (v: any) => <Money v={v} /> },
                { title: 'Outstanding', align: 'right', dataIndex: 'outstanding', sorter: (a: any, b: any) => a.outstanding - b.outstanding, render: (v: any) => <Money v={v} color={Number(v) > 0 ? '#dc2626' : undefined} /> },
              ] as ColumnsType<any>}
              summary={() => (
                <Table.Summary.Row className="report-total-row">
                  <Table.Summary.Cell index={0}><b>Grand Total</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><b>{fmtNumber((d.byCustomer || []).reduce((s: number, r: any) => s + r.invoices, 0))}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><b>{fmtMoney((d.byCustomer || []).reduce((s: number, r: any) => s + r.totalSales, 0))}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><b>{fmtMoney((d.byCustomer || []).reduce((s: number, r: any) => s + r.collected, 0))}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><b>{fmtMoney((d.byCustomer || []).reduce((s: number, r: any) => s + r.outstanding, 0))}</b></Table.Summary.Cell>
                </Table.Summary.Row>
              )} />
          )}
        </LoadOrError>
      </div>

      {/* By product + by salesperson side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <div className="text-[14px] font-bold text-[#171a2e] mb-2">Sales by Product</div>
          <LoadOrError q={rep} label="Sales by Product">
            {(d) => (
              <Table rowKey="productId" size="small" dataSource={d.byProduct} pagination={{ pageSize: 10 }}
                expandable={{ expandedRowRender: (r: any) => <ProductLines rows={r.children} /> }}
                columns={[
                  { title: 'Item', dataIndex: 'product' }, { title: 'Units', align: 'right', dataIndex: 'qty', render: (v: any) => fmtNumber(v) },
                  { title: 'Gross', align: 'right', dataIndex: 'gross', render: (v: any) => <Money v={v} bold /> }, { title: 'Tax', align: 'right', dataIndex: 'tax', render: (v: any) => <Money v={v} /> },
                ] as ColumnsType<any>} />
            )}
          </LoadOrError>
        </div>
        <div>
          <div className="text-[14px] font-bold text-[#171a2e] mb-2">Sales by Salesperson</div>
          <DatasetTable ctx={ctx} dataset="SALES_BY_SALESPERSON" title="Sales by Salesperson" drill={(r: any) => setDrill({ title: r.salesperson, subtitle: `${r.invoices} invoices · ${fmtMoney(r.total)}`, rows: r._children || [], kind: 'invoice' })} />
        </div>
      </div>

      {/* Register */}
      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">Sales Register</div>
        <LoadOrError q={reg} label="Sales Register">
          {(d) => {
            const rows = Array.isArray(d) ? d : d.rows || [];
            const src = ctx.win.from && ctx.win.to ? rows.filter((r: any) => (!ctx.win.from || new Date(r.date) >= new Date(ctx.win.from)) && (!ctx.win.to || new Date(r.date) <= new Date(ctx.win.to + 'T23:59:59'))) : rows;
            return (
              <>
                <Table rowKey={(r: any) => tableRowKey(r, r.sourceType && r.sourceId ? `${r.sourceType}-${r.sourceId}` : undefined, r.number)} size="small" dataSource={src} pagination={{ pageSize: 25, showTotal: (t, r) => `${r[0]}–${r[1]} of ${t}` }} columns={[
                  { title: 'Date', dataIndex: 'date', width: 105, render: (v: any) => fmtDate(v) }, { title: 'Type', dataIndex: 'type', width: 100 },
                  { title: 'Document', dataIndex: 'number', render: (v: any, r: any) => r.sourceType === 'invoice' ? invoiceLink(v, r.sourceId) : <span className="font-medium">{v}</span> },
                  { title: 'Customer', dataIndex: 'customer' }, { title: 'Amount', align: 'right', dataIndex: 'amount', render: (v: any) => <Money v={v} bold={Number(v) < 0 ? false : true} color={Number(v) < 0 ? '#dc2626' : undefined} /> },
                  { title: 'Status', dataIndex: 'status', width: 100, render: (v: any) => <Tag>{String(v).replace(/_/g, ' ')}</Tag> },
                ] as ColumnsType<any>} />
              </>
            );
          }}
        </LoadOrError>
      </div>

      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} title={drill?.title || ''} subtitle={drill?.subtitle}>
        {drill && <Table rowKey="id" size="small" dataSource={drill.rows} pagination={{ pageSize: 15 }} columns={[
          { title: 'Invoice', render: (_v, x) => invoiceLink(x.invoiceNo, x.id) },
          { title: 'Date', dataIndex: 'invoiceDate', render: (v: any) => fmtDate(v) },
          ...(drill.rows[0]?.customer !== undefined ? [{ title: 'Customer', dataIndex: 'customer' }] : []),
          { title: 'Total', align: 'right', dataIndex: 'total', render: (v: any) => <Money v={v} bold /> },
          ...(drill.rows[0]?.outstanding !== undefined ? [{ title: 'Outstanding', align: 'right', dataIndex: 'outstanding', render: (v: any) => <Money v={v} color={Number(v) > 0 ? '#dc2626' : undefined} /> }] : []),
        ] as ColumnsType<any>} />}
      </DrillDrawer>
    </div>
  );
}

function CustomerInvoices({ rows }: { rows: any[] }) {
  return <Table rowKey="id" size="small" dataSource={rows} pagination={false} columns={[
    { title: 'Invoice', render: (_v, x) => invoiceLink(x.invoiceNo, x.id) },
    { title: 'Date', dataIndex: 'invoiceDate', render: (v: any) => fmtDate(v) },
    { title: 'Total', align: 'right', dataIndex: 'total', render: (v: any) => <Money v={v} /> },
    { title: 'Paid', align: 'right', dataIndex: 'collected', render: (v: any) => <Money v={v} /> },
    { title: 'Outstanding', align: 'right', dataIndex: 'balance', render: (v: any) => <Money v={v} color={Number(v) > 0 ? '#dc2626' : undefined} /> },
    { title: 'Status', dataIndex: 'paymentStatus', render: (v: any) => <Tag>{String(v).replace(/_/g, ' ')}</Tag> },
  ] as ColumnsType<any>} />;
}

function ProductLines({ rows }: { rows: any[] }) {
  return <Table rowKey="id" size="small" dataSource={rows} pagination={false} columns={[
    { title: 'Invoice', render: (_v, x) => invoiceLink(x.invoiceNo, x.id) }, { title: 'Customer', dataIndex: 'customer' }, { title: 'Qty', align: 'right', dataIndex: 'qty' }, { title: 'Amount', align: 'right', dataIndex: 'lineTotal', render: (v: any) => <Money v={v} /> },
  ] as ColumnsType<any>} />;
}
