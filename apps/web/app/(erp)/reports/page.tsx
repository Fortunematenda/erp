'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Drawer, Empty, Input, Modal, Popconfirm, Select, Skeleton, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AreaChartOutlined, CaretRightOutlined, DeleteOutlined, DollarOutlined, ExportOutlined, HeartOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, ShoppingCartOutlined, StarFilled, StarOutlined, TeamOutlined } from '@ant-design/icons';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { StatCard } from '@/components/stat-card';
import { Can } from '@/components/Can';
import { SoftBadge } from '@/components/crud-page';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { GlobalFilterBar, useReportFilters, CompareHint } from '@/components/reports/report-kit';
import { NAVY2, FinancialTab, SalesTab, LoadOrError, Money, exportReportCsv, DrillDrawer, invoiceLink, tableRowKey } from '@/components/reports/report-renderers';
import { PurchasingTab, CustomersTab, InventoryTab, HrTab, OperationsTab } from '@/components/reports/report-renderers-2';

const NAVY = '#003366';

/* Compact clickable KPI card (105–120px, 19-21px value) */
function KpiCard({ icon, label, value, hint, compare, comparePct, onClick, iconBg }: { icon: React.ReactNode; label: string; value: any; hint?: string; compare?: string; comparePct?: number | null; onClick: () => void; iconBg: string }) {
  return (
    <div className="nex-card nex-card-hover border rounded-xl px-4 cursor-pointer transition-shadow hover:shadow-md" style={{ height: 112 }} onClick={onClick} role="button" tabIndex={0}>
      <div className="flex items-center gap-3.5 h-full">
        <div className="flex items-center justify-center rounded-lg text-white text-[17px]" style={{ width: 40, height: 40, background: iconBg }}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-[#64748b] truncate">{label}</div>
          <div className="text-[13px] font-semibold text-[#171a2e] leading-tight truncate tabular-nums">{value}</div>
          <div className="text-[12px] text-[#94a3b8] truncate flex items-center gap-1.5">
            <span className="truncate">{hint}</span>
            <CompareHint compare={compare || 'none'} pct={comparePct ?? null} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportLibraryCard({ title, description, onClick, favorite, onToggleFavorite }: { title: string; description: string; onClick: () => void; favorite?: boolean; onToggleFavorite?: () => void }) {
  return (
    <div className="nex-card border rounded-lg px-4 py-3 cursor-pointer hover:shadow-sm hover:border-[#1d5fb5] transition-all flex items-start justify-between group" onClick={onClick}>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-[#171a2e]">{title}</div>
        <div className="text-[12px] text-[#64748b] mt-0.5">{description}</div>
      </div>
      {onToggleFavorite && (
        <button className="no-print text-[14px] ml-2 shrink-0" onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }} title={favorite ? 'Remove from favorites' : 'Add to favorites'}>
          {favorite ? <StarFilled style={{ color: '#f59e0b' }} /> : <StarOutlined className="text-[#c3c9d6] group-hover:text-[#f59e0b]" />}
        </button>
      )}
    </div>
  );
}

function PrintHeader({ title, subtitle, ctx }: { title: string; subtitle: string; ctx: any }) {
  return (
    <div id="report-print" className="hidden print:block mb-4 border-b pb-3">
      <div className="text-[18px] font-bold text-[#171a2e]">{title}</div>
      <div className="text-[12px] text-[#344054] mt-1">{subtitle} · {ctx.companyName} · {ctx.branchLabel} · {ctx.currencyLabel}</div>
      <div className="text-[11px] text-[#64748b]">Generated {new Date().toLocaleString()}</div>
    </div>
  );
}

export default function ReportsBi() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const meta = useMeta();
  const filters = useReportFilters();
  const { win, compareWin, applied } = filters;
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState(params.get('tab') || 'overview');

  // URL tab sync
  useEffect(() => { const t = params.get('tab'); if (t && t !== tab) setTab(t); }, [params]);
  useEffect(() => { const q = new URLSearchParams(params.toString()); if (q.get('tab') !== tab) { q.set('tab', tab); router.replace(`/reports?${q.toString()}`, { scroll: false }); } }, [tab]);

  const branches = useQuery({ queryKey: ['reports-branches'], queryFn: () => api('/reports/branches') });
  const currencies = useQuery({ queryKey: ['reports-currencies'], queryFn: () => api('/reports/currencies') });
  const state = useQuery({ queryKey: ['reports-state'], queryFn: () => api('/reports/state') });
  const datasets = useQuery({ queryKey: ['reports-datasets'], queryFn: () => api('/reports/datasets') });

  const periodLabel = `${win.from ? fmtDate(win.from) : '…'} – ${win.to ? fmtDate(win.to) : '…'}`;
  const branchLabel = applied.branchId ? (branches.data || []).find((b: any) => b.id === applied.branchId)?.name || 'Branch' : 'All Branches';
  const currencyLabel = applied.currency || 'All Currencies';
  const ctx = { win, compareWin, compare: applied.compare, branchId: applied.branchId, currency: applied.currency, branches: branches.data || [], companyName: 'NexusERP', periodLabel, branchLabel, currencyLabel };

  const overview = useQuery({
    queryKey: ['reports-overview', win.from, win.to, applied.branchId, applied.currency, compareWin.from, compareWin.to],
    queryFn: () => api(`/reports/overview?${new URLSearchParams({ ...(win.from ? { from: win.from } : {}), ...(win.to ? { to: win.to } : {}), ...(applied.branchId ? { branchId: applied.branchId } : {}), ...(applied.currency ? { currency: applied.currency } : {}), ...(compareWin.from ? { compareFrom: compareWin.from } : {}), ...(compareWin.to ? { compareTo: compareWin.to } : {}) }).toString()}`),
  });

  // favorites / recents helpers
  const fav = state.data?.favorites || [];
  const recents = state.data?.recents || [];
  const favMut = useMutation({ mutationFn: (reportId: string) => api('/reports/state/favorite', { method: 'POST', body: JSON.stringify({ reportId }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['reports-state'] }) });
  const recentMut = useMutation({ mutationFn: (reportId: string) => api('/reports/state/recent', { method: 'POST', body: JSON.stringify({ reportId }) }) });

  // Track the currently open report for favorites/recents
  const currentReport = tab === 'overview' ? 'overview' : `${tab}`;
  useEffect(() => { if (tab !== 'overview') recentMut.mutate(tab); }, [tab]);

  function goToTab(t: string) { setTab(t); }

  const o = overview.data;
  const cmp = o?.kpis?.compare;

  const trend = (o?.trend || []).map((t: any) => ({ ...t, label: t.month?.slice(2) }));
  const hasTrend = trend.some((t: any) => t.revenue > 0 || t.purchases > 0);
  const arBuckets = o?.arBuckets || {};
  const inv = o?.inventoryPosition;

  const printable = () => { document.body.classList.add('report-print'); window.print(); setTimeout(() => document.body.classList.remove('report-print'), 400); };

  const searchLower = search.toLowerCase();

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Reports & Business Intelligence</h1>
          <p className="text-[13px] text-[#64748b] mt-0.5">Enterprise reporting across all NexusERP modules — drill from any number to its source document</p>
        </div>
        <div className="no-print flex gap-2">
          <Button icon={<PrinterOutlined />} onClick={printable}>Print</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { overview.refetch(); qc.invalidateQueries({ queryKey: ['dataset'] }); }}>Refresh</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <KpiCard icon={<DollarOutlined />} label="Revenue" iconBg={NAVY} value={o ? fmtMoney(o.kpis.revenue) : '…'} hint={`${fmtNumber(o?.kpis?.invoiceCount || 0)} posted invoices`} compare={applied.compare} comparePct={cmp?.revenuePct} onClick={() => goToTab('sales')} />
        <KpiCard icon={<ShoppingCartOutlined />} label="Purchases" iconBg="#b45309" value={o ? fmtMoney(o.kpis.purchases) : '…'} hint={`${fmtNumber(o?.kpis?.billCount || 0)} posted bills`} compare={applied.compare} comparePct={cmp?.purchasesPct} onClick={() => goToTab('purchasing')} />
        <KpiCard icon={<TeamOutlined />} label="Receivables" iconBg="#0e7490" value={o ? fmtMoney(o.kpis.receivables) : '…'} hint="Outstanding customer balances" onClick={() => goToTab('customers')} />
        <KpiCard icon={<AreaChartOutlined />} label="Inventory Value" iconBg="#16a34a" value={o ? fmtMoney(o.kpis.inventoryValue) : '…'} hint={`${fmtNumber(inv?.itemsInStock || 0)} items in stock · ${fmtNumber(inv?.reorderAlerts || 0)} reorder alerts`} onClick={() => goToTab('inventory')} />
      </div>

      {/* Global filter bar */}
      <div className="nex-card rounded-xl mb-4 overflow-hidden">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wide">Reporting period & context</span>
          <span className="text-[12px] text-[#94a3b8]">{periodLabel} · {branchLabel} · {currencyLabel}</span>
        </div>
        <GlobalFilterBar filters={filters} branches={branches.data || []} currencies={currencies.data || []} onReset={() => overview.refetch()} />
      </div>

      {/* Main category navigation */}
      <div className="nex-card rounded-xl" style={{ minHeight: 480 }}>
        <Tabs
          className="px-2 pt-1"
          activeKey={tab}
          onChange={setTab}
          items={[
            /* ------------------------------ OVERVIEW ------------------------------ */
            { key: 'overview', label: 'Overview', children: (
              <div className="p-4 space-y-5">
                {/* Favorites & recents */}
                {(fav.length > 0 || recents.length > 0) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {fav.length > 0 && (
                      <div>
                        <div className="text-[13px] font-bold text-[#171a2e] mb-2">My Reports</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {fav.slice(0, 6).map((f: string) => (
                            <ReportLibraryCard key={f} title={TAB_LABELS[f] || f} description="Favorite report" onClick={() => goToTab(f)} favorite onToggleFavorite={() => favMut.mutate(f)} />
                          ))}
                        </div>
                      </div>
                    )}
                    {recents.length > 0 && (
                      <div>
                        <div className="text-[13px] font-bold text-[#171a2e] mb-2">Recently Viewed</div>
                        <div className="flex flex-wrap gap-2">
                          {recents.slice(0, 5).map((r: string) => (
                            <button key={r} className="no-print text-[12px] px-3 py-1.5 rounded-full border border-[#e6e9f2] bg-white text-[#344054] hover:border-[#1d5fb5]" onClick={() => goToTab(r)}>{TAB_LABELS[r] || r}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Business performance chart */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[14px] font-bold text-[#171a2e]">Business Performance</span>
                    <span className="text-[12px] text-[#94a3b8]">Revenue vs Purchases · {periodLabel}</span>
                  </div>
                  {hasTrend ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f6" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
                        <RTooltip formatter={(v: any) => fmtMoney(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="revenue" name="Revenue" stroke={NAVY2} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="purchases" name="Purchases" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <EmptyState title="No data for the selected filters." hint="No posted transactions in the selected period." />}
                </div>

                {/* Receivables aging + inventory position */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="nex-card border rounded-lg p-4">
                    <div className="text-[13px] font-bold text-[#171a2e] mb-3">Receivables Aging</div>
                    {Object.keys(arBuckets).length ? (
                      <div className="space-y-2">
                        {Object.entries(arBuckets).map(([k, v]: any) => (
                          <a key={k} className="flex items-center justify-between py-1.5 border-b border-[#f0f1f6] last:border-0 cursor-pointer group" onClick={() => goToTab('customers')}>
                            <span className="text-[13px] text-[#64748b] group-hover:text-[#1d5fb5]">{k}</span>
                            <span className="text-[13px] font-semibold text-[#171a2e]">{fmtMoney(v)}</span>
                          </a>
                        ))}
                      </div>
                    ) : <EmptyState title="No receivables" hint="No outstanding invoices." />}
                  </div>
                  <div className="nex-card border rounded-lg p-4">
                    <div className="text-[13px] font-bold text-[#171a2e] mb-3">Inventory Position</div>
                    {inv ? (
                      <div className="space-y-2">
                        {[['Inventory Value', fmtMoney(inv.totalValue), 'inventory'], ['Items in Stock', fmtNumber(inv.itemsInStock), 'inventory'], ['Reorder Alerts', fmtNumber(inv.reorderAlerts), 'inventory']].map(([l, v, t]: any) => (
                          <a key={l} className="flex items-center justify-between py-1.5 border-b border-[#f0f1f6] last:border-0 cursor-pointer group" onClick={() => goToTab(t)}>
                            <span className="text-[13px] text-[#64748b] group-hover:text-[#1d5fb5]">{l}</span>
                            <span className="text-[13px] font-semibold text-[#171a2e]">{v}</span>
                          </a>
                        ))}
                      </div>
                    ) : <Skeleton active paragraph={{ rows: 2 }} />}
                  </div>
                </div>

                {/* Currency breakdown */}
                {o?.currencyBreakdown && Object.keys(o.currencyBreakdown).length > 1 && (
                  <div className="nex-card border rounded-lg p-4">
                    <div className="text-[13px] font-bold text-[#171a2e] mb-2">Currency Breakdown</div>
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(o.currencyBreakdown).map(([cur, v]: any) => (
                        <div key={cur} className="border rounded-lg px-4 py-2 bg-[#f8fafc]">
                          <div className="text-[12px] font-bold text-[#171a2e]">{cur}</div>
                          <div className="text-[12px] text-[#64748b]">Revenue {fmtMoney(v.revenue)}</div>
                          <div className="text-[12px] text-[#64748b]">Receivables {fmtMoney(v.receivables)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="text-[11px] text-[#94a3b8] mt-2">Currencies are never summed across exchange rates — switch the currency filter for consolidated values.</div>
                  </div>
                )}
              </div>
            ) },

            /* ------------------------------ FINANCIAL ------------------------------ */
            { key: 'financial', label: 'Financial', children: (
              <Can permission="finance.reports.view">
                <div className="p-4"><ReportHeader title="Financial Reports" ctx={ctx} /><FinancialTab ctx={ctx} /></div>
              </Can>
            ) },

            /* ------------------------------ SALES ------------------------------ */
            { key: 'sales', label: 'Sales', children: (
              <Can permission="sales.reports.view">
                <div className="p-4"><ReportHeader title="Sales Reports" ctx={ctx} /><SalesTab ctx={ctx} /></div>
              </Can>
            ) },

            /* ------------------------------ PURCHASING ------------------------------ */
            { key: 'purchasing', label: 'Purchasing', children: (
              <Can permission="procurement.bills.manage">
                <div className="p-4"><ReportHeader title="Purchasing Reports" ctx={ctx} /><PurchasingTab ctx={ctx} /></div>
              </Can>
            ) },

            /* ------------------------------ INVENTORY ------------------------------ */
            { key: 'inventory', label: 'Inventory', children: (
              <Can permission="inventory.view">
                <div className="p-4"><ReportHeader title="Inventory Reports" ctx={ctx} /><InventoryTab ctx={ctx} /></div>
              </Can>
            ) },

            /* ------------------------------ CUSTOMERS ------------------------------ */
            { key: 'customers', label: 'Customers', children: (
              <Can permission="sales.invoices.view">
                <div className="p-4"><ReportHeader title="Customer Reports" ctx={ctx} /><CustomersTab ctx={ctx} /></div>
              </Can>
            ) },

            /* ------------------------------ HR & PAYROLL ------------------------------ */
            { key: 'hr', label: 'HR & Payroll', children: (
              <div className="p-4"><ReportHeader title="HR & Payroll Reports" ctx={ctx} /><HrTab ctx={ctx} /></div>
            ) },

            /* ------------------------------ OPERATIONS ------------------------------ */
            { key: 'operations', label: 'Operations', children: (
              <div className="p-4"><ReportHeader title="Operations Reports" ctx={ctx} /><OperationsTab ctx={ctx} /></div>
            ) },

            /* ------------------------------ CUSTOM REPORTS ------------------------------ */
            { key: 'custom', label: 'Custom Reports', children: (
              <Can permission="reports.view">
                <CustomReportsTab search={search} setSearch={setSearch} ctx={ctx} />
              </Can>
            ) },
          ]}
        />
      </div>
    </div>
  );
}

const TAB_LABELS: Record<string, string> = { financial: 'Financial Reports', sales: 'Sales Reports', purchasing: 'Purchasing Reports', inventory: 'Inventory Reports', customers: 'Customer Reports', hr: 'HR & Payroll Reports', operations: 'Operations Reports', custom: 'Custom Reports' };

function ReportHeader({ title, ctx }: { title: string; ctx: any }) {
  return (
    <div className="mb-3 pb-3 border-b border-[#eef0f6]">
      <div className="text-[15px] font-bold text-[#171a2e]">{title}</div>
      <div className="text-[12px] text-[#64748b]">{ctx.periodLabel} · {ctx.companyName} · {ctx.branchLabel} · {ctx.currencyLabel}</div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-8 text-center">
      <div className="text-[13px] font-semibold text-[#344054]">{title}</div>
      {hint && <div className="text-[12px] text-[#94a3b8] mt-1">{hint}</div>}
    </div>
  );
}

/* ============================ CUSTOM REPORTS ============================ */
function CustomReportsTab({ search, setSearch, ctx }: { search: string; setSearch: (v: string) => void; ctx: any }) {
  const qc = useQueryClient();
  const [dsId, setDsId] = useState<string | null>(null);
  const [selCols, setSelCols] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const [aggregation, setAggregation] = useState('SUM');
  const [aggColumn, setAggColumn] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [preview, setPreview] = useState<any>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveForm, setSaveForm] = useState<{ name: string; description: string; visibility: string }>({ name: '', description: '', visibility: 'PRIVATE' });

  const datasets = useQuery({ queryKey: ['reports-datasets'], queryFn: () => api('/reports/datasets') });
  const saved = useQuery({ queryKey: ['saved-reports'], queryFn: () => api('/reports') });
  const ds = (datasets.data || []).find((d: any) => d.id === dsId);

  function resetBuilder(nextDs?: string) {
    setSelCols([]); setGroupBy(null); setAggColumn(null); setAggregation('SUM'); setSortBy(null); setPreview(null);
    if (nextDs !== undefined) setDsId(nextDs);
  }

  async function runPreview() {
    if (!dsId) { message.info('Select a data area first'); return; }
    try {
      const res = await api('/reports/run', { method: 'POST', body: JSON.stringify({ dataset: dsId, from: ctx.win.from, to: ctx.win.to, branchId: ctx.branchId || undefined, currency: ctx.currency || undefined, groupBy: groupBy || undefined, aggregation: aggColumn ? aggregation : undefined, aggColumn: aggColumn || undefined, sortBy, sortDir, pageSize: 100 }) });
      setPreview(res);
    } catch (e: any) { message.error(e.message); }
  }

  async function saveReport() {
    if (!dsId) return;
    if (!saveForm.name.trim()) { message.error('Report name is required'); return; }
    try {
      await api('/reports', { method: 'POST', body: JSON.stringify({ name: saveForm.name, description: saveForm.description, dataset: dsId, groupBy, filters: { from: ctx.win.from, to: ctx.win.to, branchId: ctx.branchId, currency: ctx.currency }, visibility: saveForm.visibility, sortBy, sortDir }) });
      message.success('Custom report saved'); setSaveOpen(false); setSaveForm({ name: '', description: '', visibility: 'PRIVATE' });
      qc.invalidateQueries({ queryKey: ['saved-reports'] });
    } catch (e: any) { message.error(e.message); }
  }

  async function runSaved(r: any) {
    try {
      const res = await api(`/reports/saved/${r.id}/run`, { method: 'POST', body: JSON.stringify({ pageSize: 100 }) });
      setDsId(r.dataset); setGroupBy(r.groupBy || null); setPreview(res);
    } catch (e: any) { message.error(e.message); }
  }

  const colDefs = ds?.columns || [];
  const visibleCols = (selCols.length ? colDefs.filter((c: any) => selCols.includes(c.key)) : colDefs);
  const filterSearch = search.toLowerCase();

  const previewCols: ColumnsType<any> = useMemo(() => visibleCols.map((c: any) => ({
    title: c.label, dataIndex: c.key, key: c.key,
    align: c.type === 'money' || c.type === 'number' || c.type === 'percent' ? 'right' : 'left',
    sorter: (a: any, b: any) => (typeof a[c.key] === 'number' ? a[c.key] - b[c.key] : String(a[c.key] || '').localeCompare(String(b[c.key] || ''))),
    render: (v: any) => c.type === 'money' ? fmtMoney(v) : c.type === 'percent' ? `${Number(v).toFixed(1)}%` : c.type === 'number' ? fmtNumber(v) : c.type === 'date' || c.type === 'datetime' ? (v ? new Date(v).toLocaleDateString() : '—') : String(v ?? '—'),
  })) as ColumnsType<any>, [visibleCols]);

  return (
    <div className="space-y-5">
      {/* Saved custom reports */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[14px] font-bold text-[#171a2e]">Saved Custom Reports</span>
          <Input allowClear prefix={<SearchOutlined />} placeholder="Search reports..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
        </div>
        {saved.isLoading ? <Skeleton active /> : (
          (saved.data || []).length === 0 ? <EmptyState title="No saved custom reports yet" hint="Use the builder below to create your first custom report — no SQL required." /> : (
            <Table rowKey="id" size="small" dataSource={(saved.data || []).filter((r: any) => !filterSearch || r.name.toLowerCase().includes(filterSearch) || (r.description || '').toLowerCase().includes(filterSearch))} pagination={{ pageSize: 10 }} columns={[
              { title: 'Report', render: (_v, r: any) => <div><div className="text-[13px] font-medium text-[#171a2e]">{r.name}</div><div className="text-[11px] text-[#94a3b8]">{r.description || ''}</div></div> },
              { title: 'Dataset', width: 170, render: (_v, r: any) => (datasets.data || []).find((d: any) => d.id === r.dataset)?.label || r.dataset },
              { title: 'Visibility', width: 130, render: (_v, r: any) => <SoftBadge tone={r.visibility === 'COMPANY' ? 'green' : r.visibility === 'ROLE' ? 'amber' : 'grey'} dotless>{r.visibility || 'PRIVATE'}</SoftBadge> },
              { title: 'Created', width: 110, render: (_v, r: any) => fmtDate(r.createdAt) },
              { ...ACTIONS_COL, render: (_v, r: any) => (
                <RowActionsMenu items={[
                  { key: 'run', label: 'Run', icon: <CaretRightOutlined />, onClick: () => runSaved(r) },
                  { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, permission: 'reports.custom.create', confirm: 'Delete this report?', onClick: async () => { await api(`/reports/${r.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['saved-reports'] }); } },
                ]} />
              ) },
            ] as ColumnsType<any>} />
          )
        )}
      </div>

      {/* Builder */}
      <div className="nex-card border rounded-lg p-4">
        <div className="text-[14px] font-bold text-[#171a2e] mb-1">Custom Report Builder</div>
        <div className="text-[12px] text-[#64748b] mb-3">Curated datasets only — every field and dataset is permission-checked on the server. No SQL required.</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="text-[12px] font-semibold text-[#64748b]">1 · Data Area</label>
            <Select className="w-full mt-1" placeholder="Select dataset" value={dsId || undefined} onChange={(v) => resetBuilder(v)} options={(datasets.data || []).map((d: any) => ({ label: `${d.label} (${d.area})`, value: d.id }))} />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-[#64748b]">2 · Columns</label>
            <Select className="w-full mt-1" mode="multiple" allowClear placeholder="All columns" value={selCols} onChange={setSelCols} disabled={!dsId} options={colDefs.map((c: any) => ({ label: c.label, value: c.key }))} />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-[#64748b]">3 · Grouping</label>
            <Select className="w-full mt-1" allowClear placeholder="No grouping" value={groupBy} onChange={(v) => { setGroupBy(v || null); if (!v) { setAggColumn(null); } }} disabled={!dsId} options={(ds?.groupable || []).map((g: string) => ({ label: colDefs.find((c: any) => c.key === g)?.label || g, value: g }))} />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-[#64748b]">4 · Aggregation</label>
            <Select className="w-full mt-1" allowClear placeholder="Column to aggregate" value={aggColumn} onChange={setAggColumn} disabled={!dsId || !groupBy} options={colDefs.filter((c: any) => c.aggregatable).map((c: any) => ({ label: c.label, value: c.key }))} />
          </div>
          {aggColumn && (
            <>
              <div>
                <label className="text-[12px] font-semibold text-[#64748b]">Aggregation Function</label>
                <Select className="w-full mt-1" value={aggregation} onChange={setAggregation} options={['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map((a) => ({ label: a, value: a }))} />
              </div>
              <div>
                <label className="text-[12px] font-semibold text-[#64748b]">5 · Sorting</label>
                <div className="flex gap-1 mt-1">
                  <Select className="flex-1" allowClear placeholder="Column" value={sortBy} onChange={setSortBy} options={colDefs.map((c: any) => ({ label: c.label, value: c.key }))} />
                  <Select style={{ width: 90 }} value={sortDir} onChange={setSortDir} options={[{ label: 'A→Z', value: 'asc' }, { label: 'Z→A', value: 'desc' }]} />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="primary" onClick={runPreview} disabled={!dsId}>Preview</Button>
          <Can permission="reports.custom.create"><Button onClick={() => setSaveOpen(true)} disabled={!dsId || !preview}>Save Report</Button></Can>
        </div>
        {ds && <div className="text-[11px] text-[#94a3b8] mt-2">Dataset permissions: {ds.permissions.join(', ')}{ds.sensitive ? ' · SENSITIVE — access is audited' : ''}</div>}
      </div>

      {/* Preview */}
      {preview && (
        <div className="nex-card border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-bold text-[#171a2e]">Preview · {ds?.label} {groupBy ? `grouped by ${groupBy}` : ''} · {preview.total} rows</span>
            <Button size="small" icon={<ExportOutlined />} onClick={() => exportReportCsv('custom-report', ctx, `Custom: ${ds?.label}`, visibleCols.map((c: any) => ({ key: c.key, label: c.label })), preview.rows, preview.totals)}>CSV</Button>
          </div>
          <Table rowKey={(r: any) => tableRowKey(r)} size="small" dataSource={preview.rows} columns={previewCols} pagination={{ pageSize: 15 }} scroll={{ x: true }} />
        </div>
      )}

      <Modal open={saveOpen} title="Save Custom Report" onCancel={() => setSaveOpen(false)} onOk={saveReport} okText="Save" destroyOnHidden>
        <div className="space-y-3">
          <div><label className="text-[13px] font-medium">Report Name *</label><Input value={saveForm.name} onChange={(e) => setSaveForm((s) => ({ ...s, name: e.target.value }))} /></div>
          <div><label className="text-[13px] font-medium">Description</label><Input value={saveForm.description} onChange={(e) => setSaveForm((s) => ({ ...s, description: e.target.value }))} /></div>
          <div>
            <label className="text-[13px] font-medium">Visibility</label>
            <Select className="w-full" value={saveForm.visibility} onChange={(v) => setSaveForm((s) => ({ ...s, visibility: v }))} options={[
              { value: 'PRIVATE', label: 'Private — only me' },
              { value: 'COMPANY', label: 'Shared with Company' },
              { value: 'ROLE', label: 'Shared with Role (requires share permission)' },
            ]} />
            <div className="text-[11px] text-[#94a3b8] mt-1">Sharing never bypasses dataset permissions — viewers still need access to the underlying data area.</div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
