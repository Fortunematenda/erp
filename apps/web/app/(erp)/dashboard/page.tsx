'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, DatePicker, Empty, Select, Skeleton, Space, Tooltip } from 'antd';
import {
  AuditOutlined, ClockCircleOutlined, DollarOutlined, FallOutlined, FileProtectOutlined, FireOutlined,
  FundOutlined, ReloadOutlined, RiseOutlined, UserOutlined, WarningOutlined,
} from '@ant-design/icons';
import {
  Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { DashboardKpiCard } from '@/components/dashboard-kpi-card';
import { SoftBadge } from '@/components/crud-page';
import { DashboardFeatureSlider } from '@/components/dashboard/dashboard-feature-slider';
import { BusinessPerformanceSlide } from '@/components/dashboard/business-performance-slide';
import { ERPProcessMapSlide } from '@/components/dashboard/erp-process-map-slide';

const POSTED = ['POSTED', 'PART_PAID', 'PAID'];
const DAY = 86400000;

function areaTotal(rows: any[] | undefined) {
  const d = (rows || []).filter((i: any) => POSTED.includes(i.status));
  return { revenue: d.reduce((s: number, i: any) => s + Number(i.total), 0), tax: d.reduce((s: number, i: any) => s + Number(i.taxTotal), 0) };
}

function perfSeries(invoices: any[], supplierInvoices: any[], gran: string) {
  const map = new Map<string, any>();
  const bucket = (date: any) => {
    const d = dayjs(date);
    if (gran === 'Daily') return d.format('YYYY-MM-DD');
    if (gran === 'Weekly') return d.startOf('week').format('YYYY-MM-DD');
    return d.format('YYYY-MM');
  };
  const ensure = (k: string) => { if (!map.has(k)) map.set(k, { key: k, revenue: 0, expenses: 0, net: 0 }); return map.get(k); };
  for (const i of invoices) { ensure(bucket(i.invoiceDate)).revenue += Number(i.total); }
  for (const s of supplierInvoices) { ensure(bucket(s.invoiceDate || s.createdAt)).expenses += Number(s.total); }
  const list = [...map.values()].sort((a: any, b: any) => (a.key < b.key ? -1 : 1)).map((b: any) => ({ ...b, net: b.revenue - b.expenses }));
  return list.slice(-12).map((b: any) => ({
    label: gran === 'Monthly' ? dayjs(b.key).format('MMM YY') : gran === 'Weekly' ? dayjs(b.key).format('D MMM') : dayjs(b.key).format('D MMM'),
    Revenue: Number(b.revenue.toFixed(0)),
    Expenses: Number(b.expenses.toFixed(0)),
    'Net Profit': Number(b.net.toFixed(0)),
  }));
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[12px] text-[#64748b] font-medium">{label}</div>
      <div className="text-[18px] mt-1" style={{ color: accent || '#171a2e', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Card({ title, subtitle, extra, children, className }: { title: string; subtitle?: string; extra?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`nex-card nex-card-hover flex flex-col overflow-hidden ${className || ''}`}>
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <div>
          <div className="font-semibold text-[16px] text-[#171a2e]">{title}</div>
          {subtitle && <div className="text-[12px] text-[#64748b] mt-0.5">{subtitle}</div>}
        </div>
        {extra}
      </div>
      <div className="flex-1 px-5 pb-5">{children}</div>
    </div>
  );
}

function MiniRow({ icon, title, value, tone, tint }: { icon: React.ReactNode; title: string; value: string; tone: string; tint: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-[#f8faff] transition-colors">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm shrink-0" style={{ background: tone, boxShadow: `0 4px 12px ${tone}55` }}>{icon}</div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="text-[13px] text-[#64748b] truncate">{title}</div>
        <div className="text-[15px] font-bold text-[#171a2e] leading-tight">{value}</div>
      </div>
      {/* subtle tint chip */}
      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tint }} />
    </div>
  );
}

const AGING = (label: string, value: number, color: string) => ({ label, value: Number(value.toFixed(2)), color });

export default function Dashboard() {
  const summary = useQuery({ queryKey: ['dashboard-summary'], queryFn: () => api('/dashboard/summary') });
  const invoices = useQuery({ queryKey: ['sales-invoices'], queryFn: () => api('/sales/invoices') });
  const supplierInvoices = useQuery({ queryKey: ['ap-invoices'], queryFn: () => api('/procurement/supplier-invoices') });
  const supplierPayments = useQuery({ queryKey: ['ap-payments'], queryFn: () => api('/procurement/supplier-payments') });
  const pos = useQuery({ queryKey: ['procurement-pos'], queryFn: () => api('/procurement/purchase-orders') });
  const aging = useQuery({ queryKey: ['debtor-age'], queryFn: () => api('/sales/debtor-age') });
  const valuation = useQuery({ queryKey: ['inv-valuation'], queryFn: () => api('/inventory/valuation') });
  const reorder = useQuery({ queryKey: ['inv-reorder'], queryFn: () => api('/inventory/reorder') });
  const warehouses = useQuery({ queryKey: ['inv-warehouses'], queryFn: () => api('/inventory/warehouses') });
  const devices = useQuery({ queryKey: ['fiscal-devices'], queryFn: () => api('/fiscalisation/devices') });
  const fiscalReceipts = useQuery({ queryKey: ['fiscal-receipts'], queryFn: () => api('/fiscalisation/receipts') });
  const cashflow = useQuery({ queryKey: ['finance-cashflow'], queryFn: () => api('/finance/cashflow') });
  const creditNotes = useQuery({ queryKey: ['sales-credit-notes'], queryFn: () => api('/sales/credit-notes') });
  const risks = useQuery({ queryKey: ['compliance-risks'], queryFn: () => api('/compliance/risks') });

  const [period, setPeriod] = useState('month');
  const [customRange, setCustomRange] = useState<any>(null);
  const gran = 'Monthly' as const;

  const inv = useMemo(() => (invoices.data || []).filter((i: any) => POSTED.includes(i.status)), [invoices.data]);
  const { revenue, tax } = useMemo(() => areaTotal(invoices.data), [invoices.data]);
  const netRevenue = revenue - tax;
  const margin = revenue ? (netRevenue / revenue) * 100 : 0;

  const series = useMemo(() => {
    const keys: string[] = [];
    for (let k = 5; k >= 0; k--) keys.push(dayjs().subtract(k, 'month').format('YYYY-MM'));
    const map = new Map(keys.map((k) => [k, { gross: 0, net: 0 }]));
    inv.forEach((i: any) => { const k = dayjs(i.invoiceDate).format('YYYY-MM'); if (map.has(k)) { map.get(k)!.gross += Number(i.total); map.get(k)!.net += Number(i.total) - Number(i.taxTotal); } });
    return keys.map((k) => ({ k, gross: map.get(k)!.gross, net: map.get(k)!.net }));
  }, [inv]);
  const salesSpark = series.map((s) => Number(s.gross.toFixed(0)));
  const netSpark = series.map((s) => Number(s.net.toFixed(0)));
  const pct = (arr: number[]) => { if (arr.length < 2) return null; const last = arr[arr.length - 1], prev = arr[arr.length - 2]; return prev ? ((last - prev) / Math.abs(prev)) * 100 : null; };
  const salesTrend = pct(salesSpark);
  const netTrend = pct(netSpark);

  const perfRange = useMemo(() => {
    const now = dayjs();
    switch (period) {
      case 'today': return [now.startOf('day'), now.endOf('day')];
      case 'week': return [now.startOf('week'), now.endOf('day')];
      case 'month': return [now.startOf('month'), now.endOf('day')];
      case 'lastMonth': { const lm = now.subtract(1, 'month'); return [lm.startOf('month'), lm.endOf('month')]; }
      case 'quarter': return [now.month(Math.floor(now.month() / 3) * 3).startOf('month'), now.endOf('day')];
      case 'year': return [now.startOf('year'), now.endOf('day')];
      case 'last30': return [now.subtract(30, 'day'), now.endOf('day')];
      case 'custom': return customRange ? [dayjs(customRange[0]).startOf('day'), dayjs(customRange[1]).endOf('day')] : null;
      default: return null;
    }
  }, [period, customRange]);

  const { perfInv, perfSup } = useMemo(() => {
    const inRange = (arr: any[], get: (x: any) => any) => perfRange ? arr.filter((x) => { const d = dayjs(get(x)); return d.isAfter(perfRange[0]) && d.isBefore(perfRange[1]); }) : arr;
    return {
      perfInv: inRange(inv, (x: any) => x.invoiceDate),
      perfSup: inRange(supplierInvoices.data || [], (x: any) => x.invoiceDate || x.createdAt),
    };
  }, [inv, supplierInvoices.data, perfRange]);

  const perf = useMemo(() => perfSeries(perfInv, perfSup, gran), [perfInv, perfSup, gran]);
  const perfTotals = useMemo(() => {
    const r = perfInv.reduce((s: number, i: any) => s + Number(i.total), 0);
    const e = perfSup.reduce((s: number, i: any) => s + Number(i.total), 0);
    return { revenue: r, expenses: e, net: r - e, margin: r ? ((r - e) / r) * 100 : 0 };
  }, [perfInv, perfSup]);

  const device = (devices.data || [])[0];
  const openDay = device?.fiscalDays?.find((d: any) => d.status === 'OPEN');
  const connTone = device?.status === 'ACTIVE' ? 'green' : device?.status === 'UNREGISTERED' ? 'amber' : 'red';
  const connLabel = device ? (device.status === 'ACTIVE' ? 'Connected' : device.status === 'UNREGISTERED' ? 'Not registered' : device.status === 'SUSPENDED' ? 'Suspended' : 'Offline') : 'No device';
  const dayOpen = device?.dayStatus === 'OPEN';
  const receiptsToday = openDay?.receiptCount ?? device?.receiptCounter ?? 0;
  const vatToday = Number(openDay?.taxTotal || 0);
  const failedFiscal = (fiscalReceipts.data || []).filter((r: any) => ['RETRY', 'REJECTED'].includes(r.status)).length;
  const certOk = device?.certificateExpiresAt ? new Date(device.certificateExpiresAt) > new Date() : undefined;

  const val = valuation.data;
  const reorderRows = reorder.data || [];
  const invValue = Number(val?.totalValue || 0);
  const itemCount = val?.rows?.length || 0;
  const lowStock = reorderRows.filter((r: any) => Number(r.onHand) > 0 && Number(r.onHand) <= Number(r.reorderLevel)).length;
  const outOfStock = reorderRows.filter((r: any) => Number(r.onHand) <= 0).length;
  const warehouseCount = warehouses.data?.length || 0;

  const orders = pos.data || [];
  const openOrders = orders.filter((o: any) => ['APPROVED', 'PART_RECEIVED'].includes(o.status));
  const openPos = openOrders.length;
  const poValue = openOrders.reduce((s: number, o: any) => s + Number(o.total), 0);
  const awaiting = orders.filter((o: any) => o.status === 'APPROVED').length;
  const overduePos = openOrders.filter((o: any) => dayjs(o.orderDate).isBefore(dayjs().subtract(14, 'day'))).length;
  const pendingApprovals = orders.filter((o: any) => o.status === 'DRAFT').length;

  const age = aging.data?.summary;
  const agingTotal = age ? age.current + age.d30 + age.d60 + age.d90plus : 0;
  const agingData = age ? [
    AGING('0–30 days', age.current, '#16a34a'),
    AGING('31–60 days', age.d30, '#f59e0b'),
    AGING('61–90 days', age.d60, '#f97316'),
    AGING('90+ days', age.d90plus, '#dc2626'),
  ] : [];

  const supInv = supplierInvoices.data || [];
  const supPay = supplierPayments.data || [];
  const apOutstanding = supInv.reduce((s: number, i: any) => s + Number(i.total), 0) - supPay.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const todayStart = dayjs().startOf('day');
  const overdueAP = supInv.filter((i: any) => i.dueDate && dayjs(i.dueDate).isBefore(todayStart)).reduce((s: number, i: any) => s + (Number(i.total) - (supPay.filter((p: any) => p.supplierInvoiceId === i.id).reduce((x: number, p: any) => x + Number(p.amount), 0))), 0);
  const dueThisWeek = supInv.filter((i: any) => i.dueDate && dayjs(i.dueDate).isBefore(todayStart.add(7, 'day')) && dayjs(i.dueDate).isAfter(todayStart.subtract(1, 'day'))).length;
  const cashBank = (cashflow.data || []).reduce((s: number, m: any) => s + Number(m.net), 0);

  const today = dayjs();
  const salesToday = inv.filter((i: any) => dayjs(i.invoiceDate).isSame(today, 'day')).reduce((s: number, i: any) => s + Number(i.total), 0);
  const salesMonth = inv.filter((i: any) => dayjs(i.invoiceDate).isSame(today, 'month')).reduce((s: number, i: any) => s + Number(i.total), 0);
  const invoiceCount = inv.length;
  const creditNoteCount = (creditNotes.data || []).filter((c: any) => c.status === 'POSTED').length;
  const avgInvoice = invoiceCount ? salesMonth / invoiceCount : 0;
  const outstandingCount = inv.filter((i: any) => ['POSTED', 'PART_PAID'].includes(i.status)).length;

  const openRisks = summary.data?.openRisks ?? 0;
  const alerts = [
    { title: 'Outstanding Receivables', value: fmtMoney(summary.data?.outstandingReceivables || 0), show: (Number(summary.data?.outstandingReceivables) > 0), tone: '#ef4444', tint: '#ef4444', icon: <DollarOutlined /> },
    { title: 'Low Stock Items', value: fmtNumber(summary.data?.lowStockCount || 0), show: Number(summary.data?.lowStockCount) > 0, tone: '#f59e0b', tint: '#f59e0b', icon: <FallOutlined /> },
    { title: 'Pending Approvals', value: fmtNumber(pendingApprovals), show: pendingApprovals > 0, tone: '#2563eb', tint: '#2563eb', icon: <AuditOutlined /> },
    { title: 'Failed Fiscal Transactions', value: fmtNumber(failedFiscal), show: failedFiscal > 0, tone: '#dc2626', tint: '#dc2626', icon: <WarningOutlined /> },
    { title: 'Open Risks', value: fmtNumber(openRisks), show: openRisks > 0, tone: '#f97316', tint: '#f97316', icon: <FireOutlined /> },
    { title: 'Receivables Past Due', value: `$${Number(age?.d90plus || 0).toFixed(2)}`, show: Number(age?.d90plus) > 0, tone: '#db2777', tint: '#db2777', icon: <ClockCircleOutlined /> },
  ].filter((a) => a.show);

  const anyLoading = summary.isLoading; // core
  const ready = !anyLoading && !summary.error;

  return (
    <div className="nex-fade">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Dashboard</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Business overview at a glance</p>
        </div>
        <div className="flex items-center gap-3">
          <Tooltip title="Refresh all data">
            <Button icon={<ReloadOutlined />} onClick={() => { Object.values({ summary, invoices, supplierInvoices, supplierPayments, pos, aging, valuation, reorder, warehouses, devices, fiscalReceipts, cashflow, creditNotes, risks }).forEach((q) => q.refetch()); }} />
          </Tooltip>
          <span className="text-[12px] text-[#94a3b8] hidden md:inline">Updated {dayjs().format('D MMM YYYY')}</span>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-5 mb-6">
        {ready ? (
          <>
            <DashboardKpiCard title="Posted Sales" value={fmtMoney(revenue)} trend={salesTrend} subtitle={`${fmtMoney(tax)} collected as tax`} icon={<RiseOutlined />} color="#2563eb" spark={salesSpark} />
            <DashboardKpiCard title="Net Revenue" value={fmtMoney(netRevenue)} trend={netTrend} subtitle="After tax" icon={<FundOutlined />} color="#4f46e5" spark={netSpark} />
            <DashboardKpiCard title="Gross Profit" value={fmtMoney(netRevenue)} trend={netTrend} subtitle={`Margin ${margin.toFixed(1)}%`} icon={<AuditOutlined />} color="#0d9488" spark={netSpark} />
            <DashboardKpiCard title="Customers" value={fmtNumber(summary.data?.customers)} trend={null} subtitle="Active customers" icon={<UserOutlined />} color="#2563eb" spark={[0, 0, 0, 0, 0, 0]} />
            <DashboardKpiCard title="Fiscal Receipts" value={fmtNumber(summary.data?.fiscalReceipts)} trend={null} subtitle="ZIMRA fiscalised" icon={<FileProtectOutlined />} color="#3b5b7e" spark={[0, 0, 0, 0, 0, 0]} />
          </>
        ) : (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="nex-stat h-[152px] flex items-center">
              <Skeleton active title={{ width: '70%' }} paragraph={{ rows: 2 }} />
            </div>
          ))
        )}
      </div>

      {/* Business Performance + Fiscalisation (two-slide carousel) */}
      <div className="mb-8">
        <DashboardFeatureSlider>
          <BusinessPerformanceSlide
            perf={perf}
            perfTotals={perfTotals}
            devicesLoading={devices.isLoading}
            device={device}
            receiptsToday={receiptsToday}
            vatToday={vatToday}
            failedFiscal={failedFiscal}
            certOk={certOk}
            connTone={connTone}
            connLabel={connLabel}
            dayOpen={dayOpen}
            period={period}
            setPeriod={setPeriod}
            customRange={customRange}
            setCustomRange={setCustomRange}
          />
          <ERPProcessMapSlide />
        </DashboardFeatureSlider>
      </div>

      {/* Receivables aging + Payables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        <Card title="Receivables Aging" subtitle="Outstanding by age">
          {aging.isLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : agingTotal === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No receivables outstanding" />
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="relative w-[180px] h-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={agingData} dataKey="value" nameKey="label" innerRadius={58} outerRadius={84} paddingAngle={2} stroke="none">
                      {agingData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <RTooltip formatter={(v: any) => `$${Number(v).toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-[11px] text-[#64748b]">Total</div>
                  <div className="text-[20px] font-bold text-[#171a2e]">{fmtMoney(agingTotal)}</div>
                </div>
              </div>
              <div className="flex-1 w-full space-y-3">
                {agingData.map((b) => (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.color }} />
                    <span className="text-[13px] text-[#64748b] flex-1">{b.label}</span>
                    <span className="text-[14px] font-semibold text-[#171a2e]">{fmtMoney(b.value)}</span>
                    <span className="text-[12px] text-[#94a3b8] w-12 text-right">{agingTotal ? ((b.value / agingTotal) * 100).toFixed(0) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title="Payables & Cash Position" subtitle="Liquidity & vendor balances">
          {supplierInvoices.isLoading || cashflow.isLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <MiniStat label="Accounts Payable" value={fmtMoney(apOutstanding)} />
              <MiniStat label="Cash & Bank" value={fmtMoney(cashBank)} accent="#16a34a" />
              <MiniStat label="Overdue Payables" value={fmtMoney(overdueAP)} accent="#dc2626" />
              <MiniStat label="Due This Week" value={fmtNumber(dueThisWeek)} accent="#f59e0b" />
            </div>
          )}
        </Card>
      </div>

      {/* Sales overview + Attention */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
        <Card title="Sales Overview" subtitle="Sales activity & invoicing">
          {invoices.isLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-6">
              <MiniStat label="Sales Today" value={fmtMoney(salesToday)} />
              <MiniStat label="Sales This Month" value={fmtMoney(salesMonth)} accent="#003366" />
              <MiniStat label="Avg Invoice" value={fmtMoney(avgInvoice)} />
              <MiniStat label="Invoices" value={fmtNumber(invoiceCount)} />
              <MiniStat label="Credit Notes" value={fmtNumber(creditNoteCount)} />
              <MiniStat label="Outstanding" value={fmtNumber(outstandingCount)} accent="#f59e0b" />
            </div>
          )}
        </Card>

        <Card title="Attention Needed" subtitle="Items that need action">
          {ready && alerts.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing currently requires your attention" />
          ) : ready ? (
            <div className="space-y-1">
              {alerts.map((a) => <MiniRow key={a.title} icon={a.icon} title={a.title} value={a.value} tone={a.tone} tint={a.tint} />)}
            </div>
          ) : (
            <Skeleton active paragraph={{ rows: 6 }} />
          )}
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[12px] text-[#64748b] font-medium truncate">{label}</div>
      <div className="text-[18px] mt-0.5" style={{ color: accent || '#171a2e', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

