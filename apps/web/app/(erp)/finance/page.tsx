'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Table, Typography } from 'antd';
import {
  AccountBookOutlined, AppstoreOutlined, AuditOutlined, BankOutlined, BookOutlined, CalculatorOutlined,
  CreditCardOutlined, DashboardOutlined, FileDoneOutlined, FileTextOutlined, FundOutlined, PercentageOutlined,
  RiseOutlined, ShopOutlined, SolutionOutlined, SwapOutlined, TeamOutlined, UndoOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { api } from '@/lib/api';
import { StatusTag } from '@/components/crud-page';
import { FinanceAccountSummaryDrawer } from '@/components/finance/finance-account-summary-drawer';
import { fmtDate, fmtMoney } from '@/lib/format';

const quickLinks = [
  { href: '/finance', label: 'Dashboard', desc: 'Finance overview at a glance', icon: <DashboardOutlined />, color: '#003366' },
  { href: '/finance/accounts', label: 'Chart of Accounts', desc: 'Account tree with live balances', icon: <SolutionOutlined />, color: '#0b4a8f' },
  { href: '/finance/journals', label: 'Journal Entries', desc: 'Post and reverse manual journals', icon: <AccountBookOutlined />, color: '#0ea5e9' },
  { href: '/finance/ledger', label: 'General Ledger', desc: 'Per-account history & running balance', icon: <FileTextOutlined />, color: '#10b981' },
  { href: '/finance/trial-balance', label: 'Trial Balance', desc: 'Verify debits equal credits', icon: <AuditOutlined />, color: '#8b5cf6' },
  { href: '/finance/reports?report=profit-loss', label: 'Profit & Loss', desc: 'Revenue and expenses by period', icon: <RiseOutlined />, color: '#16a34a' },
  { href: '/finance/reports?report=balance-sheet', label: 'Balance Sheet', desc: 'Assets, liabilities and equity', icon: <BankOutlined />, color: '#0d9488' },
  { href: '/finance/reports?report=cash-flow', label: 'Cash Flow', desc: 'Cash in and out over time', icon: <SwapOutlined />, color: '#7c3aed' },
  { href: '/finance/ar-aging', label: 'A/R Aging', desc: 'Receivables outstanding by age', icon: <TeamOutlined />, color: '#f97316' },
  { href: '/finance/ap-aging', label: 'A/P Aging', desc: 'Payables outstanding by age', icon: <ShopOutlined />, color: '#f59e0b' },
  { href: '/finance/costing', label: 'Costing', desc: 'Inventory valuation and item costs', icon: <AppstoreOutlined />, color: '#0ea5e9' },
  { href: '/finance/reconciliation', label: 'Bank Reconciliation', desc: 'Match ledger to bank statement', icon: <UndoOutlined />, color: '#f43f5e' },
  { href: '/finance/budgets', label: 'Budgets', desc: 'Set account budgets by period', icon: <CalculatorOutlined />, color: '#0b4a8f' },
  { href: '/finance/tax-rates', label: 'Tax Rates', desc: 'Sales tax / VAT rates used on documents', icon: <PercentageOutlined />, color: '#14b8a6' },
];

const categoryCards = [
  { key: 'bankAccounts', category: 'BANK', label: 'Bank accounts', sub: 'Cash & cash equivalents', icon: <BankOutlined />, color: '#2563eb' },
  { key: 'accountsReceivable', category: 'AR', label: 'Accounts receivable', sub: 'Open customer balances', icon: <TeamOutlined />, color: '#0b4a8f' },
  { key: 'accountsPayable', category: 'AP', label: 'Accounts payable', sub: 'Open supplier bills', icon: <ShopOutlined />, color: '#f97316' },
  { key: 'creditCards', category: 'CREDIT_CARD', label: 'Credit cards', sub: 'Outstanding balances', icon: <CreditCardOutlined />, color: '#8b5cf6' },
  { key: 'loans', category: 'LOAN', label: 'Loans', sub: 'Borrowings & debt', icon: <FileDoneOutlined />, color: '#0d9488' },
  { key: 'revenue', category: 'REVENUE', label: 'Revenue', sub: 'Year-to-date income', icon: <RiseOutlined />, color: '#16a34a' },
  { key: 'equity', category: 'EQUITY', label: 'Equity', sub: 'Equity & retained earnings', icon: <FundOutlined />, color: '#4f46e5' },
];

function plural(n: number, word: string) { return n === 1 ? `1 ${word}` : `${n} ${word}s`; }

function supportText(key: string, item: any): string {
  const c = Number(item?.count || 0);
  const sub = item?.subLabel || '';
  switch (key) {
    case 'bankAccounts': return `${plural(c, 'account')} · ${sub || 'Banking'}`;
    case 'accountsReceivable': return `${plural(c, 'open receivable')}`;
    case 'accountsPayable': return `${plural(c, 'open payable')}`;
    case 'creditCards': return `${plural(c, 'account')} · ${sub || 'Cards'}`;
    case 'loans': return c ? plural(c, 'loan account') : 'No loan accounts';
    case 'revenue': return plural(c, 'revenue account') + ' · YTD';
    case 'equity': return 'Equity & retained earnings';
    default: return sub;
  }
}

function money(v: any) { return v == null ? '—' : fmtMoney(v); }

function AccountCard({ item, data, loading, onOpen }: { item: (typeof categoryCards)[number]; data: any; loading: boolean; onOpen: () => void }) {
  const d = data?.[item.key];
  const value = Number(d?.value ?? 0);
  const bgTone = `${item.color}1f`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Click to view underlying accounts and entries"
      className="nex-card text-left cursor-pointer transition-shadow hover:shadow-md hover:border-[#0b4a8f33] p-[14px_16px] min-h-[108px] h-auto rounded-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b4a8f40]"
      style={{ width: '100%' }}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: bgTone, color: item.color }}>{item.icon}</div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[#667085] leading-tight truncate">{item.label}</div>
          <div className="text-[12px] text-[#98A2B3] leading-tight truncate mt-0.5">{item.sub}</div>
        </div>
      </div>
      <div className="mt-3">
        {loading ? (
          <div className="h-[22px] w-24 rounded bg-[#f2f3f9] animate-pulse" />
        ) : (
          <div className={`text-[19px] font-semibold leading-[1.2] tracking-[-0.01em] ${value < 0 ? 'text-[#d64545]' : 'text-[#475467]'}`}>{money(d?.value)}</div>
        )}
        <div className="text-[11.5px] text-[#98A2B3] mt-1">{loading ? '...' : supportText(item.key, d)}</div>
      </div>
    </button>
  );
}

export default function FinanceDashboard() {
  const [acctCategory, setAcctCategory] = useState<string | null>(null);
  const dash = useQuery({
    queryKey: ['finance', 'dashboard'],
    queryFn: () => api('/finance/dashboard'),
    refetchOnWindowFocus: true,
    refetchInterval: 45000,
  });
  const data = dash.data;
  const loading = dash.isPending;
  const recent = (data?.recentJournals || []).slice(0, 5);
  const accountsByType = data?.accountsByType || [];
  const typeLabels: Record<string, string> = { ASSET: 'ASSET', LIABILITY: 'LIABILITY', EQUITY: 'EQUITY', REVENUE: 'REVENUE', EXPENSE: 'EXPENSE' };

  return (
    <div className="nex-fade">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 mb-6">
        {categoryCards.map((c) => (
          <AccountCard key={c.key} item={c} data={data?.accountSummary} loading={loading} onOpen={() => setAcctCategory(c.category)} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <Card className="nex-card xl:col-span-2" title="Recent journal activity" extra={<Link href="/finance/journals"><Button type="link" size="small">View all</Button></Link>} styles={{ body: { padding: 0 } }}>
          <Table size="small" rowKey="id" loading={loading} dataSource={recent} pagination={false} columns={[
            { title: 'Number', dataIndex: 'number', render: (v) => <Link href={`/finance/journals`}><span className="font-mono text-[12px] text-[#003366] font-semibold">{v}</span></Link> },
            { title: 'Date', dataIndex: 'date', width: 110, render: fmtDate },
            { title: 'Source', dataIndex: 'source', render: (s) => s?.number ? <span className="inline-flex items-center gap-2"><Link href={s.route}><span className="font-mono text-[12px] text-[#5a6080]">{s.number}</span></Link><span className="text-[11px] text-[#a1a6c0]">{s.label}</span></span> : <span className="text-[11px] text-[#a1a6c0]">{s?.label || '—'}</span> },
            { title: 'Description', dataIndex: 'description', ellipsis: true },
            { title: 'Status', dataIndex: 'status', width: 100, render: (v) => <StatusTag value={v} /> },
            { title: 'Amount', dataIndex: 'amount', width: 110, align: 'right', render: (v) => <span className="font-semibold text-[13px] text-[#171a2e]">{fmtMoney(v)}</span> },
          ]} />
        </Card>
        <Card className="nex-card" title="Accounts by type" styles={{ body: { padding: 0 } }}>
          <div className="divide-y divide-[#f2f3f9]">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="flex items-center justify-between px-5 py-3"><div className="h-4 w-44 rounded bg-[#f2f3f9] animate-pulse" /><div className="h-4 w-20 rounded bg-[#f2f3f9] animate-pulse" /></div>)
              : accountsByType.map((t: any) => (
                <Link key={t.type} href={`/finance/accounts?type=${t.type}`}>
                  <div className="flex items-center justify-between px-5 py-3 hover:bg-[#f8f9ff]">
                    <span className="text-[13px] font-medium text-[#5a6080]">{typeLabels[t.type] || t.type}</span>
                    <span className="text-[14px] font-bold text-[#171a2e]">{fmtMoney(t.value)}</span>
                  </div>
                </Link>
              ))}
          </div>
        </Card>
      </div>

      <div>
        <Typography.Text strong className="!text-[15px]">Finance & accounting modules</Typography.Text>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-3">
          {quickLinks.map((m) => (
            <Link key={m.href} href={m.href}>
              <div className="nex-card nex-card-hover h-full p-5">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg shrink-0" style={{ background: m.color, boxShadow: `0 6px 14px ${m.color}55` }}>{m.icon}</div>
                  <div className="min-w-0">
                    <div className="font-semibold text-[14px] text-[#171a2e] truncate">{m.label}</div>
                    <div className="text-[11.5px] text-[#a1a6c0] leading-tight mt-0.5">{m.desc}</div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <FinanceAccountSummaryDrawer open={!!acctCategory} category={acctCategory} onClose={() => setAcctCategory(null)} />
    </div>
  );
}
