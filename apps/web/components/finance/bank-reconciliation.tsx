'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, InputNumber, Select, Table, Tabs, Tooltip } from 'antd';
import { ReloadOutlined, CheckCircleOutlined, AuditOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { FinanceSummaryCard } from '@/components/finance-ui';
import { JournalDetailDrawer } from '@/components/finance/journal-detail-drawer';

function Money({ v, tone }: { v: number; tone?: 'in' | 'out' }) {
  return <span className="tabular-nums font-medium text-[13px]" style={{ color: tone === 'in' ? '#047857' : tone === 'out' ? '#b42318' : '#334155' }}>{fmtMoney(Math.abs(v))}</span>;
}

export function BankReconciliation() {
  const qc = useQueryClient();
  const banks = useQuery({ queryKey: ['finance', 'bank-accounts'], queryFn: () => api('/finance/bank-accounts') });
  const bankList = banks.data || [];
  const [bankId, setBankId] = useState<string | undefined>(bankList[0]?.id);
  const bank = bankList.find((b: any) => b.id === bankId) || bankList[0];
  const [stmtDate, setStmtDate] = useState<any>(dayjs());
  const [stmtBalance, setStmtBalance] = useState<number | null>(null);
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [openJournal, setOpenJournal] = useState<string | null>(null);
  const [tab, setTab] = useState('review');
  const storageKey = bank ? `nex-recon-${bank.id}` : null;

  useEffect(() => { setBankId(bankList[0]?.id); }, [bankList.length]);
  useEffect(() => {
    if (!storageKey) return;
    try { const raw = localStorage.getItem(storageKey); if (raw) { const p = JSON.parse(raw); setCleared(p.cleared || {}); setStmtBalance(p.stmtBalance ?? null); } } catch { /* ignore */ }
  }, [storageKey]);
  useEffect(() => { if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ cleared, stmtBalance })); }, [cleared, stmtBalance, storageKey]);

  const ledger = useQuery({
    queryKey: ['finance', 'ledger', bank?.ledgerAccountId, stmtDate?.format('YYYY-MM-DD')],
    queryFn: () => api(`/finance/ledger?accountId=${bank.ledgerAccountId}&from=1000-01-01&to=${stmtDate.format('YYYY-MM-DD')}&pageSize=300`),
    enabled: !!bank?.ledgerAccountId,
  });
  const feed = useQuery({ queryKey: ['banking', 'feed'], queryFn: () => api('/banking/feed') });
  const d = ledger.data;
  const bookBalance = d?.closing ?? 0;
  const rows = (d?.rows || []).map((r: any) => ({ ...r, moneyIn: Number(r.debit) > 0, amount: Number(r.debit) - Number(r.credit) }));

  const clearedRows = rows.filter((r: any) => cleared[r.id]);
  const uncleared = rows.filter((r: any) => !cleared[r.id]);
  const depositsInTransit = uncleared.filter((r: any) => r.moneyIn).reduce((s: number, r: any) => s + Math.abs(r.amount), 0);
  const outstandingChecks = uncleared.filter((r: any) => !r.moneyIn).reduce((s: number, r: any) => s + Math.abs(r.amount), 0);
  const outstandingItems = depositsInTransit + outstandingChecks;
  const adjustedBank = (stmtBalance ?? 0) + depositsInTransit - outstandingChecks;
  const adjustedBook = bookBalance;
  const difference = Number((adjustedBank - adjustedBook).toFixed(2));
  const isBalanced = Math.abs(difference) <= 0.01;

  const cols: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'date', width: 100, render: fmtDateSafe },
    { title: 'Journal', dataIndex: 'journalNumber', width: 100, render: (v, r) => <button onClick={() => setOpenJournal(r.journalId)} className="font-mono text-[12px] text-[#003366] font-semibold hover:underline">{v}</button> },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    { title: 'Reference', dataIndex: 'reference', width: 110, render: (v, r) => v ? <Link href={r.sourceRoute}><span className="font-mono text-[12px] text-[#5a6080] hover:underline">{v}</span></Link> : '—' },
    { title: 'In / Out', dataIndex: 'amount', width: 120, align: 'right', render: (v, r) => <Money v={v} tone={r.moneyIn ? 'in' : 'out'} /> },
    { title: 'Cleared', width: 90, render: (_v, r) => <input type="checkbox" checked={!!cleared[r.id]} onChange={(e) => setCleared({ ...cleared, [r.id]: e.target.checked })} /> },
  ];

  const tabRows = tab === 'cleared' ? clearedRows : rows;
  const emptyMsg = tab === 'cleared' ? 'No cleared transactions yet for this period.' : 'No transactions available for this reconciliation period.';

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">Bank Reconciliation</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Match bank activity with NexusERP and reconcile cash accounts</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['finance', 'ledger'] })}>Refresh</Button>
      </div>

      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[12px] text-[#5a6080]">Bank Account</div>
        <Select showSearch optionFilterProp="label" className="!min-w-[260px]" value={bankId} onChange={setBankId} options={bankList.map((b: any) => ({ label: `${b.ledgerAccount?.code || ''} · ${b.name} [${b.ledgerAccount?.type || 'BANK'}]`, value: b.id }))} />
        <div className="flex items-center gap-2 text-[12px] text-[#5a6080]">Statement End Date</div>
        <DatePicker value={stmtDate} onChange={setStmtDate} allowClear={false} />
        <div className="flex items-center gap-2 text-[12px] text-[#5a6080]">Statement Ending Balance</div>
        <InputNumber prefix="$" className="!w-44" value={stmtBalance} onChange={(v) => setStmtBalance(v == null ? null : Number(v))} placeholder="0.00" />
        <Button className="ml-auto" icon={<PlusOutlined />} onClick={() => { setCleared({}); setStmtBalance(null); }}>Reset</Button>
        <Button type="primary" icon={<CheckCircleOutlined />} disabled={!isBalanced || stmtBalance == null} onClick={() => window.print()}>Complete Reconciliation</Button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 mb-5">
        <FinanceSummaryCard label="Book Balance" value={fmtMoney(bookBalance)} valueColor="#2563eb" subtitle={`As of ${stmtDate.format('D MMM YYYY')} · GL`} />
        <FinanceSummaryCard label="Statement Balance" value={stmtBalance != null ? fmtMoney(stmtBalance) : '—'} valueColor="#7c3aed" subtitle={stmtBalance != null ? 'Entered / Imported' : 'Enter statement balance'} />
        <FinanceSummaryCard label="Outstanding Items" value={fmtMoney(outstandingItems)} valueColor="#f59e0b" subtitle={`${uncleared.length} outstanding`} />
        <FinanceSummaryCard label="Difference" value={fmtMoney(difference)} valueColor={Math.abs(difference) > 0.01 ? '#d64545' : '#047857'} subtitle={Math.abs(difference) > 0.01 ? 'Click for analysis' : 'Balanced'} />
      </div>

      {isBalanced && stmtBalance != null ? (
        <div className="rounded-lg px-4 py-2.5 mb-4 text-[13px] flex items-center gap-2" style={{ background: '#f6fdfa', color: '#047857' }}><CheckCircleOutlined /> Ready to Reconcile — Adjusted Bank {fmtMoney(adjustedBank)} = Adjusted Book {fmtMoney(adjustedBook)}.</div>
      ) : (
        <div className="rounded-lg px-4 py-2.5 mb-4 text-[13px]" style={{ background: '#fff5f5', color: '#b42318' }}>Reconciliation is not balanced · Difference: {fmtMoney(difference)}. {stmtBalance == null ? 'Enter the statement ending balance to begin.' : 'Review uncleared items to resolve.'}</div>
      )}

      <Card className="nex-card mb-4" styles={{ body: { padding: '0 18px 14px' } }}>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[#5a6080] py-3">Reconciliation Summary</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Bank side</div>
            <Row label="Statement Ending Balance" v={stmtBalance ?? 0} />
            <Row label="+ Deposits in Transit" v={depositsInTransit} />
            <Row label="− Outstanding Payments / Checks" v={-outstandingChecks} />
            <Divider />
            <Row label="Adjusted Bank Balance" v={adjustedBank} bold />
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-1">Book side</div>
            <Row label="Book / GL Balance" v={bookBalance} />
            <Divider />
            <Row label="Adjusted Book Balance" v={adjustedBook} bold />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-[#f2f3f9] pt-3">
          <span className="text-[13px] font-semibold text-[#5a6080]">Difference</span>
          <span className="text-[16px] font-bold tabular-nums" style={{ color: isBalanced ? '#047857' : '#b42318' }}>{fmtMoney(difference)}</span>
        </div>
      </Card>

      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <Tabs activeKey={tab} onChange={setTab} tabBarStyle={{ paddingLeft: 20, paddingTop: 4 }} items={[
          { key: 'review', label: `For Review (${uncleared.length})`, children: <Table rowKey="id" size="middle" loading={ledger.isFetching} dataSource={tab === 'review' ? uncleared : rows} columns={cols} pagination={{ pageSize: 15 }} scroll={{ x: 800 }} sticky /> },
          { key: 'cleared', label: `Matched (${clearedRows.length})`, children: <Table rowKey="id" size="middle" loading={ledger.isFetching} dataSource={clearedRows} columns={cols} pagination={{ pageSize: 15 }} scroll={{ x: 800 }} sticky /> },
          { key: 'feed', label: `Bank Feed (${(feed.data || []).length})`, children: (
            <Table rowKey="id" size="middle" loading={feed.isFetching} dataSource={feed.data || []} pagination={{ pageSize: 15 }} scroll={{ x: 800 }} sticky columns={[
              { title: 'Date', dataIndex: 'bookingDate', width: 110, render: fmtDateSafe },
              { title: 'Description', dataIndex: 'description', ellipsis: true },
              { title: 'Reference', dataIndex: 'reference', width: 130, render: (v) => v || '—' },
              { title: 'In / Out', align: 'right', width: 120, render: (_v: any, r: any) => <Money v={r.direction === 'MONEY_IN' ? r.amount : -r.amount} tone={r.direction === 'MONEY_IN' ? 'in' : 'out'} /> },
              { title: 'Status', dataIndex: 'matchStatus', width: 120, render: (v) => <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: v === 'MATCHED' ? '#ecfdf5' : '#fffbeb', color: v === 'MATCHED' ? '#047857' : '#92400e' }}>{String(v).replace(/_/g, ' ')}</span> },
            ]} />
          ) },
          { key: 'rules', label: 'Bank Rules', children: <EmptyNote text="Bank rules are not yet enabled. Automate transaction categorisation here once rules are configured." /> },
          { key: 'history', label: 'Reconciliation History', children: <EmptyNote text="No reconciliations completed yet. Completed reconciliations will appear here." /> },
          { key: 'connections', label: 'Bank Connections', children: <EmptyNote text="Manage external bank connections and sync transactions." /> },
        ]} />
      </Card>

      <JournalDetailDrawer open={!!openJournal} journalId={openJournal} onClose={() => setOpenJournal(null)} />
    </div>
  );
}

function Row({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return <div className="flex items-center justify-between py-1.5"><span className="text-[13px]" style={{ color: bold ? '#171a2e' : '#475467' }}>{label}</span><span className={`tabular-nums ${bold ? 'font-bold text-[#1f2937] text-[14px]' : 'text-[#334155]'}`}>{fmtMoney(v)}</span></div>;
}
function Divider() { return <div className="border-t border-[#f2f3f9] my-1.5" />; }
function EmptyNote({ text }: { text: string }) { return <div className="px-5 py-12 text-center text-[13px] text-[#a1a6c0]">{text}</div>; }
function fmtDateSafe(v: any) { return v ? dayjs(v).format('D MMM YY') : '—'; }
