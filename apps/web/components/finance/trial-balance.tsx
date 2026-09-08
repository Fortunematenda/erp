'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Drawer, Input, Segmented, Select, Space, Switch, Table, Tag } from 'antd';
import { PrinterOutlined, DownloadOutlined, ReloadOutlined, SearchOutlined, AuditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { AccountDetailDrawer } from '@/components/finance/account-detail-drawer';
import { JournalDetailDrawer } from '@/components/finance/journal-detail-drawer';
import { TYPE_TONE } from '@/components/finance/account-meta';

const PERIODS: Record<string, () => [any, any]> = {
  today: () => [dayjs().startOf('day'), dayjs().endOf('day')],
  week: () => [dayjs().startOf('week'), dayjs().endOf('day')],
  month: () => [dayjs().startOf('month'), dayjs().endOf('day')],
  lastMonth: () => [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')],
  quarter: () => [dayjs().month(Math.floor(dayjs().month() / 3) * 3).startOf('month'), dayjs().endOf('day')],
  lastQuarter: () => { const q = Math.floor(dayjs().month() / 3) - 1; const m = q * 3; return [dayjs().month(m).startOf('month'), dayjs().month(m + 2).endOf('month')]; },
  ytd: () => [dayjs().startOf('year'), dayjs().endOf('day')],
  year: () => [dayjs().startOf('year'), dayjs().endOf('year')],
  lastYear: () => [dayjs().subtract(1, 'year').startOf('year'), dayjs().subtract(1, 'year').endOf('year')],
  all: () => [dayjs('1000-01-01'), dayjs('9999-12-31')],
  custom: () => [null, null],
};
const PERIOD_LABELS: Record<string, string> = { today: 'Today', week: 'This Week', month: 'This Month', lastMonth: 'Last Month', quarter: 'This Quarter', lastQuarter: 'Last Quarter', ytd: 'Year to Date', year: 'This Year', lastYear: 'Last Year', all: 'All Periods', custom: 'Custom' };
const TYPE_OPTS = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'BANK', 'CASH', 'CREDIT_CARD', 'LOAN', 'COGS', 'OTHER_INCOME', 'OTHER_EXPENSE'];

function moneyCell(v: number) { return v ? <span className="font-semibold text-[13px] tabular-nums" style={{ color: '#344054' }}>{fmtMoney(v)}</span> : <span className="text-[#c3c7dc]">—</span>; }

export function TrialBalance() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState('ytd');
  const [customRange, setCustomRange] = useState<any>(undefined);
  const [accountType, setAccountType] = useState<string | undefined>();
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [includeZero, setIncludeZero] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [view, setView] = useState<'standard' | 'working'>('standard');
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const [openJournalId, setOpenJournalId] = useState<string | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => { const id = setTimeout(() => setDebouncedQ(searchQ), 300); return () => clearTimeout(id); }, [searchQ]);

  const [from, to] = useMemo(() => {
    if (period === 'custom' && customRange) return [customRange[0], customRange[1]] as [any, any];
    if (period === 'custom') return [undefined, undefined] as [any, any];
    const [s, e] = (PERIODS[period] || PERIODS.all)();
    return [s, e] as [any, any];
  }, [period, customRange]);

  const fromStr = from ? dayjs(from).format('YYYY-MM-DD') : undefined;
  const toStr = to ? dayjs(to).format('YYYY-MM-DD') : undefined;

  const report = useQuery({
    queryKey: ['finance', 'tb-report', fromStr, toStr, accountType, debouncedQ, includeZero, includeInactive],
    queryFn: () => {
      const p = new URLSearchParams();
      if (fromStr) p.set('from', fromStr); else if (period !== 'all') p.set('from', dayjs().startOf('year').format('YYYY-MM-DD'));
      if (toStr) p.set('to', toStr);
      if (accountType) p.set('accountType', accountType);
      if (debouncedQ) p.set('search', debouncedQ);
      if (includeZero) p.set('includeZero', 'true');
      if (includeInactive) p.set('includeInactive', 'true');
      return api(`/finance/trial-balance/report?${p.toString()}`);
    },
    placeholderData: (prev: any) => prev,
  });

  const diagnostics = useQuery({ queryKey: ['finance', 'tb-diag'], queryFn: () => api('/finance/trial-balance/diagnostics'), enabled: diagOpen });

  const d = report.data;
  const rows = d?.rows || [];
  const totalDebit = d?.totalDebit ?? 0;
  const totalCredit = d?.totalCredit ?? 0;
  const difference = d?.difference ?? 0;
  const isBalanced = d?.isBalanced ?? false;
  const glParams = (fromStr && toStr) ? `&from=${fromStr}&to=${toStr}` : '';

  function refresh() { qc.invalidateQueries({ queryKey: ['finance', 'tb-report'] }); qc.invalidateQueries({ queryKey: ['finance', 'tb-diag'] }); }

  function exportCsv() {
    const header = view === 'standard' ? 'Code,Account,Type,Debit,Credit' : 'Code,Account,Type,OpeningDebit,OpeningCredit,MovementDebit,MovementCredit,ClosingDebit,ClosingCredit';
    const lines = rows.map((r: any) => view === 'standard'
      ? [r.code, `"${r.name}"`, r.type, r.debit, r.credit].join(',')
      : [r.code, `"${r.name}"`, r.type, r.openingDebit, r.openingCredit, r.movementDebit, r.movementCredit, r.debit, r.credit].join(','));
    const csv = [header, ...lines, `,TOTALS, ,${totalDebit},${totalCredit}`].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'trial-balance.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  const stdCols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 90, render: (v, r) => <button onClick={() => setOpenAccountId(r.accountId)} className="font-mono text-[12px] text-[#003366] font-semibold hover:underline">{v}</button> },
    { title: 'Account', dataIndex: 'name', render: (v, r) => <button onClick={() => setOpenAccountId(r.accountId)} className="font-medium text-left hover:text-[#003366] hover:underline">{v}</button> },
    { title: 'Type', dataIndex: 'type', width: 110, render: (v) => <Tag style={{ borderRadius: 6 }} color={TYPE_TONE[v] || 'default'}>{v}</Tag> },
    { title: 'Debit', dataIndex: 'debit', width: 120, align: 'right', render: moneyCell },
    { title: 'Credit', dataIndex: 'credit', width: 120, align: 'right', render: moneyCell },
  ];
  const workCols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 86, render: (v, r) => <button onClick={() => setOpenAccountId(r.accountId)} className="font-mono text-[12px] text-[#003366] font-semibold hover:underline">{v}</button> },
    { title: 'Account', dataIndex: 'name', render: (v, r) => <button onClick={() => setOpenAccountId(r.accountId)} className="font-medium text-left hover:text-[#003366] hover:underline">{v}</button> },
    { title: 'Opening Dr', dataIndex: 'openingDebit', width: 96, align: 'right', render: moneyCell },
    { title: 'Opening Cr', dataIndex: 'openingCredit', width: 96, align: 'right', render: moneyCell },
    { title: 'Movement Dr', dataIndex: 'movementDebit', width: 100, align: 'right', render: moneyCell },
    { title: 'Movement Cr', dataIndex: 'movementCredit', width: 100, align: 'right', render: moneyCell },
    { title: 'Closing Dr', dataIndex: 'debit', width: 100, align: 'right', render: moneyCell },
    { title: 'Closing Cr', dataIndex: 'credit', width: 100, align: 'right', render: moneyCell },
  ];
  const columns = view === 'standard' ? stdCols : workCols;

  const rangeLabel = fromStr && toStr ? `${dayjs(fromStr).format('D MMM YYYY')} – ${dayjs(toStr).format('D MMM YYYY')}` : (period === 'all' ? 'All periods' : PERIOD_LABELS[period]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">Working Trial Balance</h1>
          <p className="text-[13px] text-[#64748b] mt-1">{rangeLabel} · Adjusted · USD</p>
        </div>
        <Space wrap>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!rows.length}>CSV</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        </Space>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-5">
        <SumCard label="Total Debits" value={totalDebit} sub={isBalanced ? 'Balanced' : undefined} onClick={() => setIncludeZero(true)} />
        <SumCard label="Total Credits" value={totalCredit} onClick={() => setIncludeZero(true)} />
        <SumCard label="Difference" value={difference} tone={Math.abs(difference) > 0.01 ? 'red' : 'green'} sub={isBalanced ? 'Balanced' : 'Click to investigate'} onClick={() => { if (Math.abs(difference) > 0.01) setDiagOpen(true); }} clickable={Math.abs(difference) > 0.01} />
        <SumCard label="Accounts" value={d ? `${d.accountCount}` : '—'} sub={`${rows.filter((r: any) => r.debit || r.credit).length} with activity`} onClick={() => setIncludeZero(true)} />
      </div>

      <div className="nex-card mb-5 flex items-center justify-between px-5 py-3.5" style={{ borderLeft: `4px solid ${isBalanced ? '#10b981' : '#ef4444'}`, background: isBalanced ? '#f6fdfa' : '#fff5f5' }}>
        <div>
          <div className="text-[14px] font-semibold" style={{ color: isBalanced ? '#047857' : '#b42318' }}>{isBalanced ? 'Trial Balance is Balanced' : 'Trial Balance is NOT Balanced'}</div>
          <div className="text-[12px] mt-1" style={{ color: isBalanced ? '#047857' : '#b42318' }}>Total Debits {fmtMoney(totalDebit)} · Total Credits {fmtMoney(totalCredit)} {isBalanced ? '' : `· Difference ${fmtMoney(difference)}`}</div>
        </div>
        {!isBalanced && <Button size="small" icon={<AuditOutlined />} onClick={() => setDiagOpen(true)}>Investigate Difference</Button>}
      </div>

      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-[#f2f3f9]">
          <Input allowClear prefix={<SearchOutlined className="text-[#a1a6c0] mr-1" />} placeholder="Search code / account name…" className="!rounded-[9px]" style={{ flex: '0 1 320px', minWidth: 260, maxWidth: 380 }} value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
          <Select allowClear placeholder="All Types" className="!min-w-[150px]" value={accountType} onChange={setAccountType} options={TYPE_OPTS.map((t) => ({ label: t.replace(/_/g, ' ').toLowerCase().replace(/^./, (m) => m.toUpperCase()), value: t }))} />
          <Select value={period} onChange={(v) => { setPeriod(v); if (v !== 'custom') setCustomRange(undefined); }} className="!min-w-[140px]" options={Object.entries(PERIOD_LABELS).map(([k, l]) => ({ label: l, value: k }))} />
          <DatePicker.RangePicker disabled={period !== 'custom'} value={customRange} onChange={(v) => setCustomRange(v)} />
          <div className="flex items-center gap-2 text-[12px] text-[#5a6080]"><Switch size="small" checked={includeZero} onChange={(c) => setIncludeZero(c)} /> Zero balances</div>
          <div className="flex items-center gap-2 text-[12px] text-[#5a6080]"><Switch size="small" checked={includeInactive} onChange={(c) => setIncludeInactive(c)} /> Inactive</div>
          <div className="ml-auto"><Segmented value={view} onChange={(v) => setView(v as any)} options={[{ label: 'Standard', value: 'standard' }, { label: 'Working TB', value: 'working' }]} /></div>
        </div>
        <Table
          rowKey="accountId"
          loading={report.isFetching}
          dataSource={rows}
          columns={columns}
          pagination={false}
          scroll={{ x: view === 'working' ? 900 : 620, y: 520 }}
          sticky
          size="middle"
          footer={() => view === 'standard' ? (
            <div className="flex items-center justify-end gap-6 px-5 py-3 border-t border-[#e9edf2] text-[13px]">
              <span className="font-semibold" style={{ color: '#5a6080' }}>TOTALS</span>
              <span className="font-bold tabular-nums" style={{ color: '#1f2937' }}>Debit {fmtMoney(totalDebit)}</span>
              <span className="font-bold tabular-nums" style={{ color: '#1f2937' }}>Credit {fmtMoney(totalCredit)}</span>
              <span className="font-semibold" style={{ color: isBalanced ? '#047857' : '#b42318' }}>Difference {fmtMoney(difference)}</span>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-6 px-5 py-3 border-t border-[#e9edf2] text-[13px]">
              <span className="font-semibold" style={{ color: '#5a6080' }}>TOTALS</span>
              <span className="font-bold tabular-nums" style={{ color: '#1f2937' }}>{fmtMoney(totalDebit)}</span>
              <span className="font-bold tabular-nums" style={{ color: '#1f2937' }}>{fmtMoney(totalCredit)}</span>
            </div>
          )}
        />
        {!(report.isFetching || rows.length) && <div className="px-5 py-10 text-center text-[13px] text-[#a1a6c0]">No Trial Balance activity for this period.</div>}
      </Card>

      <AccountDetailDrawer open={!!openAccountId} accountId={openAccountId} onClose={() => setOpenAccountId(null)} onEdit={() => {}} onChanged={refresh} glParams={glParams} />
      <JournalDetailDrawer open={!!openJournalId} journalId={openJournalId} onClose={() => setOpenJournalId(null)} />

      <Drawer open={diagOpen} onClose={() => setDiagOpen(false)} title="Trial Balance Diagnostics" width={640}>
        <div className="mb-4 text-[13px]" style={{ color: '#5a6080' }}>
          Trial Balance Difference: <span className="font-bold" style={{ color: '#b42318' }}>{fmtMoney(difference)}</span>
        </div>
        {!diagnostics.data || !diagnostics.data.unBalancedCount ? (
          <div className="rounded-lg px-4 py-3 text-[13px]" style={{ background: '#ecfdf5', color: '#047857' }}>No unbalanced POSTED journals found — the ledger is internally balanced. The report difference (if any) may be a data-migration or pending-entry artifact.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-[#98A2B3] uppercase tracking-wide">Unbalanced Journals</div>
            {diagnostics.data.unbalanced.map((j: any) => (
              <div key={j.id} className="flex items-center justify-between rounded-lg border border-[#f2f3f9] px-4 py-2.5">
                <button onClick={() => { setOpenJournalId(j.id); setDiagOpen(false); }} className="font-mono text-[12px] text-[#003366] hover:underline">{j.number}</button>
                <span className="text-[12px] text-[#5a6080]">{j.description}</span>
                <span className="font-semibold text-[13px]" style={{ color: '#b42318' }}>{j.difference}</span>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function SumCard({ label, value, sub, tone, onClick, clickable }: { label: string; value: any; sub?: string; tone?: string; onClick?: () => void; clickable?: boolean }) {
  const color = tone === 'red' ? '#d64545' : tone === 'green' ? '#047857' : '#475467';
  return (
    <button onClick={onClick} disabled={!clickable} className={`nex-card text-left p-4 rounded-[12px] min-h-[92px] ${clickable ? 'cursor-pointer transition-shadow hover:shadow-md' : 'cursor-default'}`}>
      <div className="text-[13px] font-semibold text-[#667085]">{label}</div>
      <div className={`text-[21px] font-semibold leading-[1.2] tracking-[-0.01em] mt-1 tabular-nums`} style={{ color }}>{value == null ? '—' : (typeof value === 'number' ? fmtMoney(value) : value)}</div>
      {sub && <div className="text-[11.5px] text-[#98A2B3] mt-1">{sub}</div>}
    </button>
  );
}
