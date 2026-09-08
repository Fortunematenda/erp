'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Select, Space, Switch, Table, Tabs } from 'antd';
import { PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { AccountDetailDrawer } from '@/components/finance/account-detail-drawer';
import { CashflowSection, VarianceSection } from '@/components/finance-sections';

const PERIODS: Record<string, () => [any, any]> = {
  month: () => [dayjs().startOf('month'), dayjs().endOf('day')],
  lastMonth: () => [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')],
  quarter: () => [dayjs().month(Math.floor(dayjs().month() / 3) * 3).startOf('month'), dayjs().endOf('day')],
  ytd: () => [dayjs().startOf('year'), dayjs().endOf('day')],
  year: () => [dayjs().startOf('year'), dayjs().endOf('year')],
  lastYear: () => [dayjs().subtract(1, 'year').startOf('year'), dayjs().subtract(1, 'year').endOf('year')],
  custom: () => [null, null],
};
const PERIOD_LABELS: Record<string, string> = { month: 'This Month', lastMonth: 'Last Month', quarter: 'This Quarter', ytd: 'Year to Date', year: 'This Year', lastYear: 'Last Year', custom: 'Custom' };

function amountCell(v: number) { return v ? <span className="font-semibold tabular-nums text-[13px]" style={{ color: '#344054' }}>{fmtMoney(v)}</span> : <span className="text-[#c3c7dc]">—</span>; }

function PnlReport({ from, to, showZero, showCodes, onAccount }: { from?: string; to?: string; showZero: boolean; showCodes: boolean; onAccount: (id: string) => void }) {
  const pnl = useQuery({ queryKey: ['finance', 'pnl', from, to], queryFn: () => api(`/finance/profit-loss${(from || to) ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ''}`) });
  const d = pnl.data; const names = d?.names || {};
  const rowsFor = (bucket: string) => Object.entries(d?.[bucket] || {}).map(([code, v]) => ({ code, name: names[code], amount: Number(v) })).filter((r) => showZero || Math.abs(r.amount) > 0.005).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const revenueRows = rowsFor('revenue'); const expenseRows = rowsFor('expenses');
  const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenseRows.reduce((s, r) => s + r.amount, 0);
  const net = Number((totalRevenue - totalExpenses).toFixed(2));
  const cols: ColumnsType<any> = [
    { title: 'Account', dataIndex: 'code', render: (v: string, r: any) => (
      <button onClick={() => onAccount(r.code)} className="font-medium text-left hover:text-[#003366] hover:underline">
        {showCodes ? <><span className="font-mono text-[12px] text-[#003366]">{v}</span><span className="text-[#a1a6c0]"> · </span></> : null}<span style={{ color: '#344054' }}>{r.name || v}</span>
      </button>
    ) },
    { title: 'Amount', dataIndex: 'amount', align: 'right', width: 140, render: amountCell },
  ];
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <MiniStat label="Total Revenue" value={fmtMoney(totalRevenue)} color="#0d9488" />
        <MiniStat label="Total Expenses" value={fmtMoney(totalExpenses)} color="#b45309" />
        <MiniStat label="Net Profit / Loss" value={fmtMoney(net)} color={net >= 0 ? '#047857' : '#b42318'} />
      </div>
      <SubtotalTable title="Revenue" data={revenueRows} cols={cols} total={totalRevenue} totalLabel="Total Revenue" />
      <SubtotalTable title="Expenses" data={expenseRows} cols={cols} total={totalExpenses} totalLabel="Total Expenses" />
      <Card className="nex-card" styles={{ body: { padding: '16px 20px' } }}>
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-semibold text-[#5a6080]">NET PROFIT / LOSS</span>
          <span className="text-[20px] font-bold" style={{ color: net >= 0 ? '#047857' : '#b42318' }}>{fmtMoney(net)}</span>
        </div>
      </Card>
    </div>
  );
}

function SubtotalTable({ title, data, cols, total, totalLabel }: { title: string; data: any[]; cols: ColumnsType<any>; total: number; totalLabel: string }) {
  return (
    <div className="nex-card overflow-hidden mb-4">
      <div className="px-5 pt-4 pb-2 border-b border-[#f2f3f9]"><span className="text-[14px] font-semibold text-[#171a2e]">{title}</span></div>
      <Table size="small" rowKey="code" dataSource={data} columns={cols} pagination={false} scroll={{ x: true }} />
      <div className="flex items-center justify-between border-t border-[#e9edf2] bg-[#f8f9ff] px-5 py-2.5">
        <span className="text-[13px] font-semibold text-[#5a6080]">{totalLabel}</span>
        <span className="text-[14px] font-bold tabular-nums text-[#1f2937]">{fmtMoney(total)}</span>
      </div>
    </div>
  );
}

function BsReport({ from, to, showZero, showCodes, onAccount }: { from?: string; to?: string; showZero: boolean; showCodes: boolean; onAccount: (id: string) => void }) {
  const bs = useQuery({ queryKey: ['finance', 'bs', from, to], queryFn: () => api(`/finance/balance-sheet${to ? `?to=${to}` : ''}`) });
  const d = bs.data; const names = d?.names || {};
  const rowsFor = (type: string) => Object.entries(d?.[type] || {}).map(([code, v]) => ({ code, name: names[code] || (code === 'retainedEarnings' ? 'Retained Earnings' : code), amount: Number(v), type })).filter((r) => showZero || Math.abs(r.amount) > 0.005).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const assets = rowsFor('ASSET'), liabs = rowsFor('LIABILITY'), eq = rowsFor('EQUITY');
  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabs = liabs.reduce((s, r) => s + r.amount, 0);
  const totalEq = eq.reduce((s, r) => s + r.amount, 0);
  const diff = Number((totalAssets - (totalLiabs + totalEq)).toFixed(2));
  const cols: ColumnsType<any> = [
    { title: 'Account', dataIndex: 'code', render: (v: string, r: any) => (
      <button onClick={() => onAccount(r.code)} className="font-medium text-left hover:text-[#003366] hover:underline">
        {showCodes ? <><span className="font-mono text-[12px] text-[#003366]">{v}</span><span className="text-[#a1a6c0]"> · </span></> : null}<span style={{ color: '#344054' }}>{r.name || v}</span>
      </button>
    ) },
    { title: 'Amount', dataIndex: 'amount', align: 'right', width: 140, render: amountCell },
  ];
  return (
    <div>
      <div className={`nex-card mb-4 flex items-center justify-between px-5 py-3.5`} style={{ borderLeft: `4px solid ${Math.abs(diff) < 0.01 ? '#10b981' : '#ef4444'}`, background: Math.abs(diff) < 0.01 ? '#f6fdfa' : '#fff5f5' }}>
        <div className="text-[14px] font-semibold" style={{ color: Math.abs(diff) < 0.01 ? '#047857' : '#b42318' }}>Balance Sheet <span className="font-normal text-[12px]">· As at {to ? dayjs(to).format('D MMM YYYY') : 'selected date'}</span></div>
        <div className="text-[12px]" style={{ color: Math.abs(diff) < 0.01 ? '#047857' : '#b42318' }}>Assets {fmtMoney(totalAssets)} = Liabilities {fmtMoney(totalLiabs)} + Equity {fmtMoney(totalEq)} {Math.abs(diff) < 0.01 ? '· Balanced' : `· Difference ${fmtMoney(diff)}`}</div>
      </div>
      <SubtotalTable title="Assets" data={assets} cols={cols} total={totalAssets} totalLabel="Total Assets" />
      <SubtotalTable title="Liabilities" data={liabs} cols={cols} total={totalLiabs} totalLabel="Total Liabilities" />
      <SubtotalTable title="Equity" data={eq} cols={cols} total={totalEq} totalLabel="Total Equity" />
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="nex-card rounded-lg p-4" style={{ background: '#fff', border: '1px solid #e9edf2' }}>
      <div className="text-[12px] font-medium text-[#667085]">{label}</div>
      <div className="text-[20px] font-semibold leading-[1.2] mt-1" style={{ color }}>{value}</div>
    </div>
  );
}

export function FinancialReports({ active: activeProp, onActiveChange }: { active?: string; onActiveChange?: (k: string) => void }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState('ytd');
  const [customRange, setCustomRange] = useState<any>(undefined);
  const [showZero, setShowZero] = useState(false);
  const [showCodes, setShowCodes] = useState(true);
  const [activeState, setActiveState] = useState('pnl');
  const active = activeProp ?? activeState;
  const setActive = (k: string) => { if (onActiveChange) onActiveChange(k); else setActiveState(k); };
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const accounts = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => api('/finance/accounts') });
  const openAccount = (code: string) => { const a = (accounts.data || []).find((x: any) => x.code === code); if (a) setOpenAccountId(a.id); };

  const [from, to] = useMemo(() => {
    if (period === 'custom') return customRange ? [customRange[0], customRange[1]] : [undefined, undefined];
    const [s, e] = (PERIODS[period] || PERIODS.ytd)();
    return [s, e];
  }, [period, customRange]);
  const fromStr = from ? dayjs(from).format('YYYY-MM-DD') : undefined;
  const toStr = to ? dayjs(to).format('YYYY-MM-DD') : undefined;
  const rangeLabel = fromStr && toStr ? `${dayjs(fromStr).format('D MMM YYYY')} – ${dayjs(toStr).format('D MMM YYYY')}` : PERIOD_LABELS[period];

  const glParams = (fromStr && toStr) ? `&from=${fromStr}&to=${toStr}` : '';

  function refresh() { qc.invalidateQueries({ queryKey: ['finance', 'pnl'] }); qc.invalidateQueries({ queryKey: ['finance', 'bs'] }); qc.invalidateQueries({ queryKey: ['finance', 'cashflow'] }); qc.invalidateQueries({ queryKey: ['finance', 'variance'] }); }

  const items = [
    { key: 'pnl', label: 'Profit & Loss', children: <PnlReport from={fromStr} to={toStr} showZero={showZero} showCodes={showCodes} onAccount={openAccount} /> },
    { key: 'bs', label: 'Balance Sheet', children: <BsReport from={fromStr} to={toStr} showZero={showZero} showCodes={showCodes} onAccount={openAccount} /> },
    { key: 'cashflow', label: 'Cash Flow', children: <CashflowSection /> },
    { key: 'variance', label: 'Budget vs Actual', children: <VarianceSection /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">Financial Reports</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Profit &amp; loss, balance sheet, cash flow and performance analysis</p>
        </div>
        <Space wrap>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        </Space>
      </div>

      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <Select value={period} onChange={(v) => { setPeriod(v); if (v !== 'custom') setCustomRange(undefined); }} className="!min-w-[140px]" options={Object.entries(PERIOD_LABELS).map(([k, l]) => ({ label: l, value: k }))} />
        <DatePicker.RangePicker disabled={period !== 'custom'} value={customRange} onChange={(v) => setCustomRange(v)} />
        <span className="text-[12px] text-[#98A2B3]">{rangeLabel}</span>
        <div className="ml-auto flex items-center gap-4 text-[12px] text-[#5a6080]">
          <label className="flex items-center gap-2"><Switch size="small" checked={showZero} onChange={setShowZero} /> Show zero balances</label>
          <label className="flex items-center gap-2"><Switch size="small" checked={showCodes} onChange={setShowCodes} /> Show account codes</label>
        </div>
      </div>

      <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
        <Tabs activeKey={active} onChange={setActive} items={items} />
      </Card>

      <AccountDetailDrawer open={!!openAccountId} accountId={openAccountId} onClose={() => setOpenAccountId(null)} onEdit={() => {}} onChanged={refresh} glParams={glParams} />
    </div>
  );
}
