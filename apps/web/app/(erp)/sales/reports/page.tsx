'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Empty, Select, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  AccountBookOutlined, AppstoreOutlined, DownloadOutlined, FileTextOutlined, FilterOutlined,
  PrinterOutlined, ReloadOutlined, UserOutlined, ExpandOutlined, CompressOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { StatusPill } from '@/components/sales-ui';
import { ReportSummaryCard } from '@/components/sales-report-card';

const TABS = [
  { key: 'invoice', label: 'Invoice Detail', icon: <FileTextOutlined /> },
  { key: 'customer', label: 'By Customer', icon: <UserOutlined /> },
  { key: 'product', label: 'By Product', icon: <AppstoreOutlined /> },
  { key: 'account', label: 'By Income Account', icon: <AccountBookOutlined /> },
];
const fmtDate = (v: any) => (v ? dayjs(v).format('DD MMM YY') : '—');
const invLink = (id: string, no: string) => <Link href={`/sales/invoices/${id}/edit`} className="font-mono text-[12px] font-semibold text-[#003366] hover:text-[#0b4a8f] hover:underline">{no}</Link>;
const YEARS = 1;

export default function SalesReportPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const sp = useSearchParams();
  const customers = useQuery({ queryKey: ['/sales/customers'], queryFn: () => api('/sales/customers') });
  const [tab, setTab] = useState(sp.get('view') || 'invoice');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  // Draft filters (toolbar) vs Applied filters (URL) — the applied ones drive the query.
  const [dRange, setDRange] = useState<[any, any]>([dayjs().subtract(YEARS, 'year'), dayjs()]);
  const [dCustomer, setDCustomer] = useState('');
  const [dStatus, setDStatus] = useState('');
  const [filters, setFilters] = useState({ startDate: sp.get('startDate') || undefined, endDate: sp.get('endDate') || undefined, customerId: sp.get('customerId') || undefined, documentStatus: sp.get('documentStatus') || undefined, view: sp.get('view') || 'invoice' });

  useEffect(() => {
    if (filters.startDate) setDRange([dayjs(filters.startDate), dayjs(filters.endDate || filters.startDate)]);
    if (filters.customerId) setDCustomer(filters.customerId);
    if (filters.documentStatus) setDStatus(filters.documentStatus);
    if (filters.view) setTab(filters.view);
  }, []); // eslint-disable-line

  const qs = new URLSearchParams();
  if (filters.startDate) qs.set('startDate', filters.startDate);
  if (filters.endDate) qs.set('endDate', filters.endDate);
  if (filters.customerId) qs.set('customerId', filters.customerId);
  if (filters.documentStatus) qs.set('documentStatus', filters.documentStatus);
  if (filters.view) qs.set('view', filters.view);
  const queryString = qs.toString();

  const report = useQuery({ queryKey: ['sales-report', filters], queryFn: () => api(`/sales/reports/sales-report${queryString ? `?${queryString}` : ''}`) });

  function apply() {
    const next = { startDate: dRange?.[0] ? dayjs(dRange[0]).format('YYYY-MM-DD') : undefined, endDate: dRange?.[1] ? dayjs(dRange[1]).format('YYYY-MM-DD') : undefined, customerId: dCustomer || undefined, documentStatus: dStatus || undefined, view: tab };
    setFilters(next);
    setPage(1);
    const p = new URLSearchParams(); Object.entries(next).forEach(([k, v]) => { if (v) p.set(k, v); });
    router.replace(`/sales/reports?${p.toString()}`);
  }
  function reset() {
    setDRange([dayjs().subtract(YEARS, 'year'), dayjs()]); setDCustomer(''); setDStatus('');
    setFilters({ startDate: undefined, endDate: undefined, customerId: undefined, documentStatus: undefined, view: tab });
    setPage(1); router.replace(`/sales/reports?view=${tab}`);
  }
  function refresh() { qc.invalidateQueries({ queryKey: ['sales-report'] }); }
  function setView(v: string) { setTab(v); setPage(1); const p = new URLSearchParams(qs); p.set('view', v); router.replace(`/sales/reports?${p.toString()}`); }
  function toggleAll() { const keys = dataFor.map((r: any) => r.id).filter(Boolean); setExpandedKeys((prev) => prev.length ? [] : keys); }
  function toggleRow(key: string) { setExpandedKeys((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]); }

  const d = report.data || { kpis: { totalSales: 0, collected: 0, outstanding: 0, count: 0 }, invoices: [], byCustomer: [], byProduct: [], byIncomeAccount: [] };
  const dataFor = tab === 'invoice' ? d.invoices : tab === 'customer' ? d.byCustomer : tab === 'product' ? d.byProduct : d.byIncomeAccount;
  const pagedData = useMemo(() => dataFor.slice((page - 1) * pageSize, page * pageSize), [dataFor, page, pageSize]);
  const rangeText = filters.startDate ? `${dayjs(filters.startDate).format('MMM D, YYYY')} – ${dayjs(filters.endDate || filters.startDate).format('MMM D, YYYY')}` : 'All time';
  const statusOpts = ['POSTED', 'DRAFT'].map((s) => ({ label: s, value: s }));

  const invCols: ColumnsType<any> = [
    { title: 'Invoice #', dataIndex: 'invoiceNo', width: 130, render: (v, r) => invLink(r.id, v) },
    { title: 'Date', dataIndex: 'invoiceDate', width: 110, render: (v) => fmtDate(v) },
    { title: 'Customer', render: (_v, r) => r.customer?.name || '—' },
    { title: 'Due Date', dataIndex: 'dueDate', width: 110, render: (v) => fmtDate(v) },
    { title: 'Subtotal', dataIndex: 'subtotal', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Tax', dataIndex: 'taxTotal', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => <span className="font-semibold text-[#2563eb]">{fmtMoney(v)}</span> },
    { title: 'Collected', dataIndex: 'collected', align: 'right', render: (v) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Balance', dataIndex: 'balance', align: 'right', render: (v) => <span className={`font-semibold ${Number(v) > 0 ? 'text-[#F97316]' : 'text-[#16a34a]'}`}>{fmtMoney(v)}</span> },
    { title: 'Invoice Status', dataIndex: 'invoiceStatus', width: 110, render: (v) => <StatusPill status={v} /> },
    { title: 'Payment', dataIndex: 'paymentStatus', width: 120, render: (v) => <StatusPill status={String(v || '').replace(/_/g, ' ')} /> },
    { title: 'Fiscal', dataIndex: 'fiscalStatus', width: 110, render: (v) => <StatusPill status={String(v || '—').replace(/_/g, ' ')} /> },
  ];
  const custCols: ColumnsType<any> = [
    { title: 'Customer', dataIndex: 'name', render: (v, r) => (<Link href={`/sales/customers/${r.customerId}`} className="text-[13px] font-medium text-[#171a2e] hover:text-[#003366] hover:underline">{v}</Link>) },
    { title: 'Invoices', dataIndex: 'invoices', align: 'center', width: 90 },
    { title: 'Total Sales', dataIndex: 'totalSales', align: 'right', render: (v) => <span className="font-semibold text-[#2563eb]">{fmtMoney(v)}</span> },
    { title: 'Collected', dataIndex: 'collected', align: 'right', render: (v) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Outstanding', dataIndex: 'outstanding', align: 'right', render: (v) => <span className={`font-semibold ${Number(v) > 0 ? 'text-[#F97316]' : 'text-[#16a34a]'}`}>{fmtMoney(v)}</span> },
  ];
  const prodCols: ColumnsType<any> = [
    { title: 'Product', dataIndex: 'product', render: (v) => <span className="text-[13px] text-[#171a2e]">{v}</span> },
    { title: 'Qty', dataIndex: 'qty', align: 'right', width: 90 },
    { title: 'Invoices', dataIndex: 'invoices', align: 'center', width: 90 },
    { title: 'Net Sales', dataIndex: 'net', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Tax', dataIndex: 'tax', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Gross Sales', dataIndex: 'gross', align: 'right', render: (v) => <span className="font-semibold text-[#2563eb]">{fmtMoney(v)}</span> },
  ];
  const accCols: ColumnsType<any> = [
    { title: 'Income Account', dataIndex: 'name', render: (v) => <span className="text-[13px] text-[#171a2e]">{v}</span> },
    { title: 'Account Code', dataIndex: 'code', width: 120, render: (v) => <span className="font-mono text-[12px] text-[#475060]">{v}</span> },
    { title: 'Invoices', dataIndex: 'invoices', align: 'center', width: 90 },
    { title: 'Net Sales', dataIndex: 'net', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Tax', dataIndex: 'tax', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Gross Sales', dataIndex: 'gross', align: 'right', render: (v) => <span className="font-semibold text-[#2563eb]">{fmtMoney(v)}</span> },
  ];

  const custChildCols: ColumnsType<any> = [
    { title: 'Invoice #', dataIndex: 'invoiceNo', render: (v, r) => invLink(r.id, v) },
    { title: 'Date', dataIndex: 'invoiceDate', render: (v) => fmtDate(v) },
    { title: 'Due', dataIndex: 'dueDate', render: (v) => fmtDate(v) },
    { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Collected', dataIndex: 'collected', align: 'right', render: (v) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Balance', dataIndex: 'balance', align: 'right', render: (v) => <span className={Number(v) > 0 ? 'text-[#F97316]' : 'text-[#16a34a]'}>{fmtMoney(v)}</span> },
    { title: 'Payment', dataIndex: 'paymentStatus', render: (v) => <StatusPill status={String(v || '').replace(/_/g, ' ')} /> },
  ];
  const prodChildCols: ColumnsType<any> = [
    { title: 'Invoice #', dataIndex: 'invoiceNo', render: (v, r) => invLink(r.id, v) },
    { title: 'Date', dataIndex: 'invoiceDate', render: (v) => fmtDate(v) },
    { title: 'Customer', dataIndex: 'customer' },
    { title: 'Qty', dataIndex: 'qty', align: 'right', width: 70 },
    { title: 'Rate', dataIndex: 'rate', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Discount', dataIndex: 'discount', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Tax', dataIndex: 'tax', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Line Total', dataIndex: 'lineTotal', align: 'right', render: (v) => <span className="font-semibold">{fmtMoney(v)}</span> },
  ];
  const accChildCols: ColumnsType<any> = [
    { title: 'Invoice #', dataIndex: 'invoiceNo', render: (v, r) => invLink(r.id, v) },
    { title: 'Date', dataIndex: 'invoiceDate', render: (v) => fmtDate(v) },
    { title: 'Customer', dataIndex: 'customer' },
    { title: 'Description', dataIndex: 'description' },
    { title: 'Net', dataIndex: 'net', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Tax', dataIndex: 'tax', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Gross', dataIndex: 'gross', align: 'right', render: (v) => <span className="font-semibold">{fmtMoney(v)}</span> },
  ];
  const invChildCols: ColumnsType<any> = [
    { title: 'Product', dataIndex: 'description', render: (v) => <span className="font-medium">{v}</span> },
    { title: 'Qty', dataIndex: 'quantity', align: 'right', width: 70 },
    { title: 'Rate', dataIndex: 'unitPrice', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Tax', dataIndex: 'taxAmount', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Line Total', dataIndex: 'lineTotal', align: 'right', render: (v) => <span className="font-semibold">{fmtMoney(v)}</span> },
  ];

  const expandRender = (rec: any) => {
    if (tab === 'invoice') return <Table size="small" rowKey={(r: any) => r.id} dataSource={rec.lines || []} columns={invChildCols} pagination={false} />;
    if (tab === 'customer') return <Table size="small" rowKey={(r: any) => r.id} dataSource={rec.children || []} columns={custChildCols} pagination={false} />;
    if (tab === 'product') return <Table size="small" rowKey={(r: any) => `${r.id}-${r.description}`} dataSource={rec.children || []} columns={prodChildCols} pagination={false} />;
    return <Table size="small" rowKey={(r: any) => `${r.id}-${r.description}`} dataSource={rec.children || []} columns={accChildCols} pagination={false} />;
  };

  const columnsFor = tab === 'invoice' ? invCols : tab === 'customer' ? custCols : tab === 'product' ? prodCols : accCols;
  const emptyText = tab === 'invoice' ? 'No invoices match the selected filters.' : tab === 'customer' ? 'No customers have sales matching the selected filters.' : tab === 'product' ? 'No products have sales matching the selected filters.' : 'No income-account transactions match the selected filters.';

  function exportCsv() {
    let head: string[] = []; let rows: any[][] = [];
    if (tab === 'invoice') { head = ['Invoice #', 'Date', 'Customer', 'Due Date', 'Subtotal', 'Tax', 'Total', 'Collected', 'Balance', 'Invoice Status', 'Payment Status', 'Fiscal Status']; rows = d.invoices.map((i: any) => [i.invoiceNo, fmtDate(i.invoiceDate), i.customer?.name || '', fmtDate(i.dueDate), Number(i.subtotal), Number(i.taxTotal), Number(i.total), Number(i.collected), Number(i.balance), i.invoiceStatus, i.paymentStatus, i.fiscalStatus]); }
    else if (tab === 'customer') { head = ['Customer', 'Invoices', 'Total Sales', 'Collected', 'Outstanding']; rows = d.byCustomer.map((c: any) => [c.name, c.invoices, Number(c.totalSales), Number(c.collected), Number(c.outstanding)]); }
    else if (tab === 'product') { head = ['Product', 'Qty', 'Invoices', 'Net Sales', 'Tax', 'Gross Sales']; rows = d.byProduct.map((p: any) => [p.product, p.qty, p.invoices, Number(p.net), Number(p.tax), Number(p.gross)]); }
    else { head = ['Income Account', 'Code', 'Invoices', 'Net Sales', 'Tax', 'Gross Sales']; rows = d.byIncomeAccount.map((a: any) => [a.name, a.code, a.invoices, Number(a.net), Number(a.tax), Number(a.gross)]); }
    if (!rows.length) { message.info('Nothing to export'); return; }
    const csv = [head.join(','), ...rows.map((r: any) => r.map((c: any) => `"${c ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `sales-report-${tab}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const cards = [
    { label: 'Total Sales', value: fmtMoney(d.kpis.totalSales), tone: '#2563eb' },
    { label: 'Collected', value: fmtMoney(d.kpis.collected), tone: '#16a34a' },
    { label: 'Outstanding', value: fmtMoney(d.kpis.outstanding), tone: '#f59e0b' },
    { label: 'Invoices', value: d.kpis.count, tone: '#8b5cf6' },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Sales Report</h1><p className="text-[13px] text-[#64748b] mt-1">{d.kpis.count} invoices · {rangeText}{filters.customerId ? ' · filtered' : ''}</p></div>
        <div className="flex items-center gap-2">
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>Export CSV</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        </div>
      </div>
      {report.error && <Alert type="error" className="mb-4" message={(report.error as Error).message} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">{cards.map((c) => <ReportSummaryCard key={c.label} label={c.label} value={c.value} tone={c.tone} />)}</div>

      <div className="nex-card mb-5 px-4 py-3 flex flex-wrap items-center gap-3 !rounded-xl">
        <FilterOutlined className="text-[15px] text-[#64748b]" />
        <DatePicker.RangePicker className="!rounded-xl" value={dRange} onChange={(v: any) => setDRange(v)} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="All Customers" className="!min-w-[170px] !rounded-xl" value={dCustomer || undefined} onChange={setDCustomer} options={(customers.data || []).map((c: any) => ({ label: c.name, value: c.id }))} />
        <Select allowClear placeholder="All Statuses" className="!min-w-[140px] !rounded-xl" value={dStatus || undefined} onChange={setDStatus} options={statusOpts} />
        <div className="ml-auto flex items-center gap-2"><Button danger onClick={reset}>Reset</Button><Button type="primary" onClick={apply}>Apply</Button></div>
      </div>

      <div className="nex-card overflow-hidden !rounded-xl">
        <div className="border-b border-[#eef0f6] px-5 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6 overflow-x-auto">
              {TABS.map((t) => (<button key={t.key} onClick={() => setView(t.key)} className={`flex items-center gap-2 pb-3 text-[14px] font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.key ? 'text-[#003366] border-[#003366]' : 'text-[#344054] border-transparent hover:text-[#003366]'}`}><span className={tab === t.key ? 'text-[#003366]' : 'text-[#8a90ad]'}>{t.icon}</span>{t.label}</button>))}
            </div>
            {tab !== 'invoice' && (<div className="flex items-center gap-2 pb-2"><Button size="small" icon={<ExpandOutlined />} onClick={toggleAll}>Expand All</Button><Button size="small" icon={<CompressOutlined />} onClick={() => setExpandedKeys([])}>Collapse All</Button></div>)}
          </div>
        </div>
        <div className="px-5 py-4">
          {dataFor.length === 0 ? (<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-[13px] text-[#64748b]">{emptyText}</span>} />) : (
            <Table rowKey={(r: any) => String(r.id || r.code || r.product || r.name || 'x')} loading={report.isLoading} columns={columnsFor} dataSource={pagedData} pagination={false} scroll={{ x: true }} size="middle"
              expandable={tab === 'invoice' ? { expandedRowKeys: expandedKeys, onExpand: (exp, r) => toggleRow(String(r.id)) } : { expandedRowKeys: expandedKeys, onExpand: (exp, r) => toggleRow(String(r.id || r.code || r.product || r.name)), expandedRowRender: expandRender, rowExpandable: (r: any) => (r.children || r.lines || []).length > 0 }} />
          )}
        </div>
        <div className="flex items-center justify-between px-5 pb-4 pt-2">
          <span className="text-[12px] text-[#94a3b8]">{dataFor.length} records</span>
          <div className="flex items-center gap-3"><Select size="small" value={pageSize} onChange={(v) => { setPageSize(v); setPage(1); }} options={[{ label: '10 / page', value: 10 }, { label: '25 / page', value: 25 }, { label: '50 / page', value: 50 }]} className="!min-w-[100px]" /><Button size="small" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Button><span className="text-[13px] text-[#344054]">{page}</span><Button size="small" disabled={page * pageSize >= dataFor.length} onClick={() => setPage((p) => p + 1)}>›</Button></div>
        </div>
      </div>
    </div>
  );
}
