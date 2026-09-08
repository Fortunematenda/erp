'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import { PlusOutlined, ReloadOutlined, SwapOutlined, LinkOutlined, EyeOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { FinanceSummaryCard } from '@/components/finance-ui';
import { JournalDetailDrawer } from '@/components/finance/journal-detail-drawer';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const TYPE_TONE: Record<string, string> = { BANK: 'blue', CASH: 'green', SAVINGS: 'cyan', PETTY_CASH: 'gold', MONEY_MARKET: 'purple' };
function typeTag(t: string) { return <Tag style={{ borderRadius: 6 }} color={TYPE_TONE[t] || 'default'}>{t.replace(/_/g, ' ')}</Tag>; }
function money(v: number) { return v ? <span className="font-semibold tabular-nums text-[13px]" style={{ color: '#334155' }}>{fmtMoney(v)}</span> : <span className="text-[#c3c7dc]">—</span>; }

function AccountDrawer({ open, bank, bookBalance, extAccount, onClose, onRefresh }: { open: boolean; bank: any; bookBalance: number; extAccount: any; onClose: () => void; onRefresh: () => void }) {
  const ledger = useQuery({ queryKey: ['finance', 'register', bank?.ledgerAccountId], queryFn: () => api(`/finance/ledger?accountId=${bank?.ledgerAccountId}&from=1000-01-01&to=9999-12-31&pageSize=200`), enabled: open && !!bank });
  const feed = useQuery({ queryKey: ['banking', 'feed'], queryFn: () => api('/banking/feed'), enabled: open });
  const [jId, setJId] = useState<string | null>(null);
  const rows = ledger.data?.rows || [];
  if (!bank) return <Drawer open={open} onClose={onClose} width={760} destroyOnHidden />;
  return (
    <Drawer open={open} onClose={onClose} width={760} title={<span>{bank.name}<span className="text-[#a1a6c0] font-normal"> · {bank.ledgerAccount?.code} {bank.ledgerAccount?.name}</span></span>} destroyOnHidden>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {typeTag(bank.type)} <Tag>{bank.currency}</Tag>
        <span className="text-[12px] text-[#98A2B3]">{bank.accountNumberMasked ? bank.accountNumberMasked.replace(/^(\d{4})$/, '•••• $1') : ''}{extAccount ? ' · Connected' : ' · Manual'}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MiniStat label="Book (GL) Balance" value={fmtMoney(bookBalance)} />
        <MiniStat label="Bank Balance" value={extAccount ? fmtMoney(Number(extAccount.currentBalance)) : '—'} />
        <MiniStat label="Available" value={extAccount ? fmtMoney(Number(extAccount.availableBalance)) : '—'} />
        <MiniStat label="Unreconciled" value={extAccount ? fmtMoney(Math.abs(bookBalance - Number(extAccount.currentBalance))) : '—'} />
      </div>
      <Tabs items={[
        { key: 'overview', label: 'Overview', children: (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            <Field k="Account Type" v={bank.type} /><Field k="Currency" v={bank.currency} />
            <Field k="Bank / Institution" v={bank.bankName || '—'} /><Field k="Account #" v={bank.accountNumberMasked || '—'} />
            <Field k="GL Account" v={`${bank.ledgerAccount?.code} · ${bank.ledgerAccount?.name}`} /><Field k="Opening Balance" v={fmtMoney(Number(bank.openingBalance) || 0)} />
            <Field k="Connection" v={extAccount ? 'CONNECTED' : 'Manual'} /><Field k="Status" v={bank.active ? 'Active' : 'Inactive'} />
          </div>
        ) },
        { key: 'transactions', label: 'Transactions', children: (
          <div>
            <div className="flex items-center justify-between mb-2 text-[13px] font-semibold text-[#5a6080]">Account Register</div>
            <Table size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 12 }} columns={[
              { title: 'Date', dataIndex: 'date', width: 100, render: (v) => dayjs(v).format('D MMM YY') },
              { title: 'Journal', dataIndex: 'journalNumber', width: 100, render: (v: any, r: any) => <button onClick={() => setJId(r.journalId)} className="font-mono text-[12px] text-[#003366] hover:underline">{v}</button> },
              { title: 'Description', dataIndex: 'description', ellipsis: true },
              { title: 'Reference', dataIndex: 'reference', width: 110, render: (v) => v || '—' },
              { title: 'In / Out', align: 'right', width: 100, render: (_v: any, r: any) => <span style={{ color: Number(r.debit) > 0 ? "#047857" : "#b42318" }}>{Number(r.debit) > 0 ? `+${fmtMoney(r.debit)}` : `-${fmtMoney(r.credit)}`}</span> },
              { title: 'Balance', dataIndex: 'runningBalance', align: 'right', width: 110, render: (v) => <span className="font-semibold tabular-nums">{fmtMoney(v)}</span> },
            ]} />
          </div>
        ) },
        { key: 'recon', label: 'Reconciliation', children: (
          <div>
            <div className="rounded-xl border border-[#e9edf2] p-4">
              <div className="text-[13px] font-semibold text-[#5a6080] mb-3">Reconciliation state</div>
              <Row l="Book (GL) Balance" v={fmtMoney(bookBalance)} />
              <Row l="Bank Balance" v={extAccount ? fmtMoney(Number(extAccount.currentBalance)) : '—'} />
              <Row l="Difference" v={extAccount ? fmtMoney(Math.abs(bookBalance - Number(extAccount.currentBalance))) : 'Not connected'} bold />
              <div className="mt-4"><Button type="primary" href="/finance/reconciliation">Open Bank Reconciliation</Button></div>
            </div>
          </div>
        ) },
        { key: 'feed', label: 'Bank Feed', children: extAccount ? (
          <div>
            <div className="flex items-center justify-between mb-2"><span className="text-[13px] font-semibold text-[#5a6080]">Synced transactions</span><Link href="/finance/bank-connections" className="text-[12px] text-[#175CD3]">Manage connection →</Link></div>
            <Table size="small" rowKey="id" dataSource={(feed.data || []).filter((f: any) => f.externalAccountId === extAccount.id)} pagination={{ pageSize: 12 }} columns={[
              { title: 'Date', dataIndex: 'bookingDate', width: 100, render: (v) => dayjs(v).format('D MMM YY') },
              { title: 'Description', dataIndex: 'description', ellipsis: true },
              { title: 'Reference', dataIndex: 'reference', width: 110, render: (v) => v || '—' },
              { title: 'Amount', align: 'right', width: 110, render: (v) => <span className="tabular-nums">{fmtMoney(Number(v))}</span> },
              { title: 'Status', dataIndex: 'matchStatus', width: 110, render: (v) => <Tag style={{ borderRadius: 6 }}>{String(v).replace(/_/g, ' ')}</Tag> },
            ]} />
          </div>
        ) : (
          <div className="px-2 py-10 text-center text-[13px] text-[#a1a6c0]">Not connected. Connect this account to import transactions automatically, or import a statement.</div>
        ) },
      ]} />
      <JournalDetailDrawer open={!!jId} journalId={jId} onClose={() => setJId(null)} />
    </Drawer>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) { return <div className="nex-card rounded-lg p-3.5" style={{ border: '1px solid #e9edf2' }}><div className="text-[12px] text-[#667085]">{label}</div><div className="text-[19px] font-semibold text-[#1f2937] mt-1 tabular-nums">{value}</div></div>; }
function Field({ k, v }: { k: string; v: string }) { return <div><div className="text-[12px] text-[#98A2B3]">{k}</div><div className="font-medium text-[#334155]">{v}</div></div>; }
function Row({ l, v, bold }: { l: string; v: string; bold?: boolean }) { return <div className="flex items-center justify-between py-1.5 text-[13px]"><span style={{ color: '#475467' }}>{l}</span><span className={`tabular-nums ${bold ? 'font-bold text-[#1f2937]' : 'text-[#334155]'}`}>{v}</span></div>; }

export default function CashBankPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('accounts');
  const [viewAccount, setViewAccount] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [transferForm] = Form.useForm();

  const accounts = useQuery({ queryKey: ['/finance/bank-accounts'], queryFn: () => api('/finance/bank-accounts') });
  const gl = useQuery({ queryKey: ['/finance/accounts'], queryFn: () => api('/finance/accounts') });
  const feed = useQuery({ queryKey: ['banking', 'connections'], queryFn: () => api('/banking/connections') });
  const transfers = useQuery({ queryKey: ['/finance/bank-transfers'], queryFn: () => api('/finance/bank-transfers') });
  const checks = useQuery({ queryKey: ['/finance/checks'], queryFn: () => api('/finance/checks') });

  const accountList = accounts.data || [];
  const glByAcct = useMemo(() => { const m: Record<string, number> = {}; (gl.data || []).forEach((a: any) => { m[a.id] = Number(a.balance || 0); }); return m; }, [gl.data]);
  const extByNexus = useMemo(() => { const m: Record<string, any> = {}; ((feed.data || []).flatMap((c: any) => c.accounts || [])).forEach((a: any) => { if (a.nexusBankAccountId) m[a.nexusBankAccountId] = a; }); return m; }, [feed.data]);

  const glBalance = (b: any) => glByAcct[b.ledgerAccountId] ?? 0;
  const extFor = (b: any) => extByNexus[b.id];
  const totalBook = accountList.reduce((s: number, b: any) => s + glBalance(b), 0);
  const totalBank = accountList.reduce((s: number, b: any) => { const e = extFor(b); return s + (e ? Number(e.currentBalance || 0) : 0); }, 0);
  const unreconciled = accountList.reduce((s: number, b: any) => { const e = extFor(b); return s + (e ? Math.abs(glBalance(b) - Number(e.currentBalance)) : 0); }, 0);
  const connected = accountList.filter((b: any) => extFor(b)).length;

  const accountCols: ColumnsType<any> = [
    { title: 'Account', render: (_v, r) => (
      <button onClick={() => setViewAccount(r)} className="text-left group">
        <span className="font-medium text-[#171a2e] group-hover:text-[#003366]">{r.name}</span>
        <div className="text-[11px] text-[#98A2B3]">{r.ledgerAccount?.code} · {r.ledgerAccount?.name}{r.accountNumberMasked ? ` · ${r.accountNumberMasked}` : ''}</div>
      </button>
    ) },
    { title: 'Type', dataIndex: 'type', width: 100, render: typeTag },
    { title: 'Bank', dataIndex: 'bankName', width: 120, render: (v) => v || '—' },
    { title: 'Currency', dataIndex: 'currency', width: 90 },
    { title: 'Book Balance', align: 'right', width: 130, render: (_v, r) => money(glBalance(r)) },
    { title: 'Bank Balance', align: 'right', width: 120, render: (_v, r) => { const e = extFor(r); return e ? <span className="tabular-nums font-medium text-[#334155]">{fmtMoney(Number(e.currentBalance))}</span> : <span className="text-[#c3c7dc]">—</span>; } },
    { title: 'Reconciliation', width: 150, render: (_v, r) => { const e = extFor(r); const diff = e ? Math.abs(glBalance(r) - Number(e.currentBalance)) : 0; return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${!e ? 'bg-[#f2f4f7] text-[#475467]' : diff <= 0.01 ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fffbeb] text-[#92400e]'}`}>{!e ? 'Manual' : diff <= 0.01 ? 'Reconciled' : `${diff > 0 ? 'Needs review' : 'Reconciled'}`}</span>; } },
    { title: 'Status', dataIndex: 'active', width: 90, render: (v) => <Tag style={{ borderRadius: 6 }} color={v ? 'green' : 'default'}>{v ? 'Active' : 'Inactive'}</Tag> },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setViewAccount(r) },
        { key: 'reconcile', label: 'Reconcile', icon: <LinkOutlined />, onClick: () => { window.location.href = '/finance/reconciliation'; } },
      ]} />
    ) },
  ];

  async function createAccount() { try { const v = await createForm.validateFields(); await api('/finance/bank-accounts', { method: 'POST', body: JSON.stringify(v) }); message.success('Account created'); setCreateOpen(false); createForm.resetFields(); qc.invalidateQueries({ queryKey: ['/finance/bank-accounts'] }); qc.invalidateQueries({ queryKey: ['/finance/accounts'] }); } catch (e: any) { message.error(e.message || 'Could not create account'); } }
  async function transfer() { try { const v = await transferForm.validateFields(); await api('/finance/bank-transfers', { method: 'POST', body: JSON.stringify({ fromAccountId: v.from, toAccountId: v.to, date: v.date?.format('YYYY-MM-DD'), amount: Number(v.amount), reference: v.reference }) }); message.success('Transfer posted'); setTransferOpen(false); transferForm.resetFields(); qc.invalidateQueries({ queryKey: ['/finance/bank-transfers'] }); qc.invalidateQueries({ queryKey: ['/finance/accounts'] }); } catch (e: any) { message.error(e.message); } }

  const tc = feed.data?.[0]?.accounts || [];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">Cash &amp; Bank</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Bank accounts, cash balances, transfers and reconciliation</p>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => { qc.invalidateQueries({ queryKey: ['/finance/bank-accounts'] }); qc.invalidateQueries({ queryKey: ['/finance/accounts'] }); qc.invalidateQueries({ queryKey: ['banking', 'connections'] }); }}>Refresh</Button>
          <Button icon={<SwapOutlined />} onClick={() => setTransferOpen(true)}>Bank Transfer</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>New Account</Button>
        </Space>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 mb-4">
        <FinanceSummaryCard label="Total Book Balance" value={fmtMoney(totalBook)} valueColor="#2563eb" subtitle="Across bank & cash accounts" />
        <FinanceSummaryCard label="Available Bank Balance" value={fmtMoney(totalBank)} valueColor="#0d9488" subtitle={`${connected} connected account(s)`} />
        <FinanceSummaryCard label="Unreconciled Amount" value={fmtMoney(unreconciled)} valueColor="#f59e0b" subtitle="Book vs bank difference" />
        <FinanceSummaryCard label="Bank Accounts" value={accountList.length} valueColor="#7c3aed" subtitle={`${accountList.filter((b: any) => b.active).length} active`} />
      </div>

      {(feed.data || []).length ? null : (
        <div className="rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2 text-[13px]" style={{ background: '#f2f4f7', color: '#475467' }}><LinkOutlined /> Manage external bank connections in <Link href="/finance/bank-connections" className="text-[#175CD3] underline">Bank Connections</Link>.</div>
      )}

      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <Tabs activeKey={tab} onChange={setTab} tabBarStyle={{ paddingLeft: 20, paddingTop: 4 }} items={[
          { key: 'accounts', label: `Accounts (${accountList.length})`, children: <Table rowKey="id" loading={accounts.isLoading} dataSource={accountList} columns={accountCols} scroll={{ x: 1000 }} sticky size="middle" pagination={false} /> },
          { key: 'transfers', label: 'Transfers', children: <Table rowKey="id" size="middle" loading={transfers.isLoading} dataSource={transfers.data || []} pagination={{ pageSize: 10 }} columns={[
            { title: 'Date', dataIndex: 'date', width: 110, render: (v) => dayjs(v).format('D MMM YY') },
            { title: 'Journal', dataIndex: 'number', width: 110, render: (v) => <span className="font-mono text-[12px] text-[#003366]">{v}</span> },
            { title: 'Description', dataIndex: 'description', ellipsis: true },
            { title: 'Amount', align: 'right', width: 120, render: (_v: any, r: any) => money((r.lines || []).reduce((s: number, l: any) => s + Number(l.debit), 0)) },
          ]} /> },
          { key: 'checks', label: 'Checks', children: <Table rowKey="id" size="middle" loading={checks.isLoading} dataSource={checks.data || []} pagination={{ pageSize: 10 }} columns={[
            { title: 'Check #', dataIndex: 'checkNo', width: 110, render: (v) => <span className="font-mono text-[12px] text-[#003366]">{v}</span> },
            { title: 'Date', dataIndex: 'date', width: 110, render: (v) => dayjs(v).format('D MMM YY') },
            { title: 'Payee', dataIndex: 'payTo', ellipsis: true },
            { title: 'Bank Account', render: (_v: any, r: any) => r.bankAccount?.name || '—' },
            { title: 'Amount', dataIndex: 'amount', align: 'right', width: 120, render: (v) => money(Number(v)) },
            { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <Tag style={{ borderRadius: 6 }}>{v}</Tag> },
          ]} /> },
          { key: 'connections', label: 'Bank Connections', children: <div className="px-5 py-8 text-center text-[13px] text-[#a1a6c0]">Manage external bank connections, sync and mapping in <Link href="/finance/bank-connections" className="text-[#175CD3] underline">Bank Connections</Link>.</div> },
        ]} />
      </Card>

      <AccountDrawer open={!!viewAccount} bank={viewAccount} bookBalance={viewAccount ? glBalance(viewAccount) : 0} extAccount={viewAccount ? extFor(viewAccount) : undefined} onClose={() => setViewAccount(null)} onRefresh={() => {}} />

      <Modal open={createOpen} onCancel={() => setCreateOpen(false)} onOk={createAccount} title="New Bank / Cash Account" okText="Save" width={560} destroyOnHidden>
        <Form form={createForm} layout="vertical" className="mt-2">
          <Form.Item label="Account Name *" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Type" name="type" initialValue="BANK"><Select options={['BANK', 'CASH', 'SAVINGS', 'PETTY_CASH', 'MONEY_MARKET'].map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} /></Form.Item>
            <Form.Item label="Currency" name="currency" initialValue="USD"><Input /></Form.Item>
          </div>
          <Form.Item label="Bank / Institution" name="bankName"><Input /></Form.Item>
          <Form.Item label="Account No. (masked)" name="accountNumberMasked"><Input placeholder="•••• 1234" /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Opening Balance" name="openingBalance" initialValue={0}><InputNumber className="w-full" prefix="$" /></Form.Item>
            <Form.Item label="GL Account *" name="ledgerAccountId" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" placeholder="Select bank/cash GL" options={(gl.data || []).filter((a: any) => a.type === 'ASSET').map((a: any) => ({ label: a.code + ' ' + a.name, value: a.id }))} /></Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal open={transferOpen} onCancel={() => setTransferOpen(false)} onOk={transfer} title="Bank Transfer" okText="Post Transfer" width={560} destroyOnHidden>
        <Form form={transferForm} layout="vertical" className="mt-2">
          <Form.Item label="From Account" name="from" rules={[{ required: true }]}><Select options={accountList.map((a: any) => ({ label: a.name, value: a.id }))} /></Form.Item>
          <Form.Item label="To Account" name="to" rules={[{ required: true }]}><Select options={accountList.map((a: any) => ({ label: a.name, value: a.id }))} /></Form.Item>
          <Form.Item label="Date" name="date"><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Amount" name="amount" rules={[{ required: true }]}><InputNumber className="w-full" prefix="$" /></Form.Item>
          <Form.Item label="Reference" name="reference"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
