'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, DatePicker, Input, Pagination, Select, Space, Table } from 'antd';
import { ReloadOutlined, PrinterOutlined, DownloadOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { AccountSelector } from '@/components/account-selector';
import { JournalDetailDrawer } from '@/components/finance/journal-detail-drawer';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';

const PERIODS: Record<string, () => [any, any]> = {
  today: () => [dayjs().startOf('day'), dayjs().endOf('day')],
  week: () => [dayjs().startOf('week'), dayjs().endOf('day')],
  month: () => [dayjs().startOf('month'), dayjs().endOf('day')],
  lastMonth: () => [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')],
  quarter: () => [dayjs().month(Math.floor(dayjs().month() / 3) * 3).startOf('month'), dayjs().endOf('day')],
  ytd: () => [dayjs().startOf('year'), dayjs().endOf('day')],
  year: () => [dayjs().startOf('year'), dayjs().endOf('year')],
  lastYear: () => [dayjs().subtract(1, 'year').startOf('year'), dayjs().subtract(1, 'year').endOf('year')],
  custom: () => [null, null],
};

const PERIOD_LABELS: Record<string, string> = {
  today: 'Today', week: 'This Week', month: 'This Month', lastMonth: 'Last Month', quarter: 'This Quarter',
  ytd: 'Year to Date', year: 'This Year', lastYear: 'Last Year', custom: 'Custom',
};

export function GeneralLedger() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => api('/finance/accounts') });
  const initialAccount = sp.get('accountId') || undefined;
  const initialFrom = sp.get('from'); const initialTo = sp.get('to');
  const [accountId, setAccountId] = useState<string | undefined>(initialAccount);
  const [period, setPeriod] = useState(initialFrom && initialTo ? 'custom' : 'year');
  const [customRange, setCustomRange] = useState<any>(initialFrom && initialTo ? [dayjs(initialFrom), dayjs(initialTo)] : undefined);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [journalId, setJournalId] = useState<string | null>(null);

  const [from, to] = useMemo(() => {
    if (!customRange && period === 'custom') return [undefined, undefined] as [any, any];
    if (customRange) return [customRange[0], customRange[1]] as [any, any];
    const [s, e] = (PERIODS[period] || PERIODS.month)();
    return [s, e] as [any, any];
  }, [period, customRange]);

  const toDate = useMemo(() => { if (!to) return undefined; const d = dayjs(to); return d.isSame(dayjs(to), 'day') ? d.format('YYYY-MM-DD') : to.format('YYYY-MM-DD'); }, [to]);
  const fromDate = from ? dayjs(from).format('YYYY-MM-DD') : undefined;

  const report = useQuery({
    queryKey: ['finance', 'ledger', accountId, fromDate, toDate, q, page, pageSize],
    queryFn: () => {
      const p = new URLSearchParams();
      if (accountId) p.set('accountId', accountId);
      if (fromDate) p.set('from', fromDate);
      if (toDate) p.set('to', toDate);
      if (q) p.set('search', q);
      p.set('page', String(page)); p.set('pageSize', String(pageSize));
      return api(`/finance/ledger?${p.toString()}`);
    },
    enabled: !!accountId,
  });

  useEffect(() => { setPage(1); }, [accountId, period, customRange, q]);

  const acc = accounts.data?.find((a: any) => a.id === accountId);
  const d = report.data;

  const sourceBadge = (l: any) => (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium text-[#5a6080] ${l.sourceType === 'MANUAL' ? 'bg-[#eef2ff]' : 'bg-[#f2f3f9]'}`}>{l.sourceLabel || l.sourceType?.replace(/_/g, ' ')}</span>
  );

  const columns: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'date', width: 105, render: fmtDate },
    { title: 'Journal', dataIndex: 'journalNumber', width: 110, render: (v, r) => <button onClick={() => setJournalId(r.journalId)} className="font-mono text-[12px] text-[#003366] font-semibold hover:underline">{v}</button> },
    { title: 'Description', dataIndex: 'description', render: (v) => <span className="text-[#475467]">{v}</span> },
    { title: 'Reference', dataIndex: 'reference', width: 120, render: (v, r) => v ? <Link href={r.sourceRoute}><span className="font-mono text-[12px] text-[#5a6080] hover:underline">{v}</span></Link> : <span className="text-[#dfe1ee]">—</span> },
    { title: 'Type', dataIndex: 'sourceLabel', width: 120, render: (v, r) => sourceBadge(r) },
    { title: 'Debit', dataIndex: 'debit', width: 100, align: 'right', render: (v) => v ? <span className="font-semibold text-[#10b981]">{fmtMoney(v)}</span> : '' },
    { title: 'Credit', dataIndex: 'credit', width: 100, align: 'right', render: (v) => v ? <span className="font-semibold text-[#ef4444]">{fmtMoney(v)}</span> : '' },
    { title: 'Balance', dataIndex: 'runningBalance', width: 110, align: 'right', render: (v) => <span className={`font-bold text-[13px] ${Number(v) < 0 ? 'text-[#d64545]' : 'text-[#475467]'}`}>{fmtMoney(v)}</span> },
  ];

  function refresh() { qc.invalidateQueries({ queryKey: ['finance', 'ledger'] }); }

  function exportCsv() {
    const rows = d?.rows || [];
    const csv = [['Date', 'Journal', 'Description', 'Reference', 'Type', 'Debit', 'Credit', 'Balance'].join(','), ...rows.map((r: any) => [r.date ? dayjs(r.date).format('YYYY-MM-DD') : '', r.journalNumber, `"${(r.description || '').replace(/"/g, '""')}"`, r.reference, r.sourceLabel, Number(r.debit).toFixed(2), Number(r.credit).toFixed(2), Number(r.runningBalance).toFixed(2)].join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ledger-${acc?.code || 'account'}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">General Ledger</h1>
          <p className="text-[13px] text-[#64748b] mt-1">{acc ? `${acc.code} – ${acc.name}` : 'Select an account to view its ledger'}</p>
        </div>
        <Space wrap>
          <Button onClick={() => router.push('/finance/journals')}>Journal Entries</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!d?.rows?.length}>Export</Button>
        </Space>
      </div>

      <Card className="nex-card mb-4" styles={{ body: { padding: '12px 16px' } }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px]">
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Account</div>
            <AccountSelector value={accountId} onChange={(v) => { setAccountId(v); }} allowClear placeholder="Select account" className="w-full" />
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Period</div>
            <Select value={period} onChange={(v) => { setPeriod(v); if (v !== 'custom') setCustomRange(undefined); }} className="!min-w-[150px]" options={Object.entries(PERIOD_LABELS).map(([k, l]) => ({ label: l, value: k }))} />
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Custom dates</div>
            <DatePicker.RangePicker disabled={period !== 'custom'} value={customRange} onChange={(v) => setCustomRange(v)} className="!rounded-xl" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Search</div>
            <Input allowClear prefix={<span className="text-[#a1a6c0] mr-1">🔍</span>} placeholder="Description / journal / reference…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <LedgerCard label="Account" value={acc ? `${acc.code}` : '—'} sub={acc ? `${acc.category || acc.type}` : 'No account'} />
        <LedgerCard label="Opening Balance" value={d ? fmtMoney(d.opening) : '—'} sub={`as of ${fromDate ? dayjs(fromDate).format('DD MMM YYYY') : 'start'}`} />
        <LedgerCard label="Net Movement" value={report.isPending ? '…' : d ? fmtMoney(d.netMovement) : '—'} sub={d ? `${d.transactionCount} transactions` : ''} />
        <LedgerCard label="Closing Balance" value={report.isPending ? '…' : d ? fmtMoney(d.closing) : '—'} sub={`as of ${toDate ? dayjs(toDate).format('DD MMM YYYY') : 'now'}`} tone={(d?.closing ?? 0) < 0 ? 'red' : undefined} />
      </div>

      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <div className="px-5 py-3 border-b border-[#f2f3f9] flex items-center justify-between">
          <span className="text-[13px] font-semibold text-[#5a6080]">{acc ? `${acc.code} – ${acc.name} ledger` : 'Ledger'}</span>
          {d && <span className="text-[12px] text-[#98A2B3]">{d.totalCount} entries · {d.totalPages} pages</span>}
        </div>
        {!accountId ? (
          <div className="px-5 py-16 text-center text-[#a1a6c0]">Select an account to view its ledger.</div>
        ) : accountId && report.isPending ? (
          <div className="px-5 py-12 text-center text-[#a1a6c0]">Loading ledger…</div>
        ) : !d || !d.rows?.length ? (
          <div className="px-5 py-12 text-center text-[#a1a6c0]">No entries in the selected period.</div>
        ) : (
          <>
            <Table rowKey="id" loading={report.isFetching} dataSource={d.rows} columns={columns} pagination={false} size="middle" scroll={{ x: 900 }} />
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-[#f2f3f9]">
              <Space split={<span className="text-[#dfe1ee]">|</span>} className="text-[13px]">
                <span className="text-[#98A2B3]">Page Totals</span>
                <span className="font-semibold text-[#10b981]">Debit {fmtMoney(d.pageTotals?.debit)}</span>
                <span className="font-semibold text-[#ef4444]">Credit {fmtMoney(d.pageTotals?.credit)}</span>
              </Space>
              <Space split={<span className="text-[#dfe1ee]">|</span>} className="text-[13px]">
                <span className="text-[#98A2B3]">Grand Totals</span>
                <span className="font-semibold text-[#10b981]">Debit {fmtMoney(d.grandTotals?.debit)}</span>
                <span className="font-semibold text-[#ef4444]">Credit {fmtMoney(d.grandTotals?.credit)}</span>
                <span className="font-bold text-[#475467]">Balance {fmtMoney(d.grandTotals?.closing)}</span>
              </Space>
            </div>
            <div className="flex justify-end items-center gap-3 px-5 py-3 border-t border-[#f2f3f9]">
              <Pagination current={page} pageSize={pageSize} total={d.totalCount} showSizeChanger pageSizeOptions={['25', '50', '100']} onChange={(p, ps) => { setPage(p); setPageSize(ps); }} showTotal={(t) => `${t} entries`} />
            </div>
          </>
        )}
      </Card>

      <JournalDetailDrawer open={!!journalId} journalId={journalId} onClose={() => setJournalId(null)} />
    </div>
  );
}

function LedgerCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="nex-card p-4 rounded-[12px] min-h-[92px]">
      <div className="text-[12px] font-semibold text-[#667085]">{label}</div>
      <div className={`text-[20px] font-semibold leading-[1.2] tracking-[-0.01em] mt-1 ${tone === 'red' ? 'text-[#d64545]' : 'text-[#475467]'}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-[#98A2B3] mt-1">{sub}</div>}
    </div>
  );
}
