'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, DatePicker, Divider, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import {
  AccountBookOutlined, AuditOutlined, BankOutlined, CheckCircleOutlined, DeleteOutlined, DollarCircleOutlined,
  FallOutlined, FundOutlined, PlusOutlined, RiseOutlined, SolutionOutlined, SwapOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '@/lib/api';
import { SoftBadge, StatusTag } from '@/components/crud-page';
import { StatCard } from '@/components/stat-card';
import { useMeta } from '@/lib/meta';
import { fmtDate, fmtMoney } from '@/lib/format';

export const ACCOUNT_TYPES: Record<string, { label: string; color: string; icon: React.ReactNode; normal: 'debit' | 'credit' }> = {
  ASSET: { label: 'Assets', color: '#10b981', icon: <BankOutlined />, normal: 'debit' },
  LIABILITY: { label: 'Liabilities', color: '#f59e0b', icon: <AuditOutlined />, normal: 'credit' },
  EQUITY: { label: 'Equity', color: '#8b5cf6', icon: <SolutionOutlined />, normal: 'credit' },
  REVENUE: { label: 'Revenue', color: '#0ea5e9', icon: <RiseOutlined />, normal: 'credit' },
  EXPENSE: { label: 'Expenses', color: '#ef4444', icon: <FallOutlined />, normal: 'debit' },
};

export const ACCOUNT_TYPE_TONES: Record<string, string> = { ASSET: 'green', LIABILITY: 'amber', EQUITY: 'purple', REVENUE: 'blue', EXPENSE: 'red' };

export function AccountTypeBadge({ type }: { type: string }) {
  const t = ACCOUNT_TYPES[type];
  return (
    <SoftBadge tone={ACCOUNT_TYPE_TONES[type] || 'grey'}>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[12px] leading-none">{t?.icon}</span>
        {t?.label || type}
      </span>
    </SoftBadge>
  );
}

export const SOURCE_COLORS: Record<string, string> = {
  MANUAL: 'blue', REVERSAL: 'red', SALES_ORDER: 'geekblue', SALES_INVOICE: 'green', SALES_RECEIPT: 'cyan',
  SALES_CREDIT_NOTE: 'lime', PURCHASE_ORDER: 'orange', GRN: 'gold', SUPPLIER_INVOICE: 'volcano', SUPPLIER_PAYMENT: 'magenta', PAYROLL: 'purple',
};

const SOURCE_TONES: Record<string, string> = { blue: 'blue', red: 'red', geekblue: 'indigo', green: 'green', cyan: 'cyan', lime: 'green', orange: 'amber', gold: 'amber', volcano: 'amber', magenta: 'pink', purple: 'purple' };

export function SourceBadge({ v }: { v?: string }) {
  return <SoftBadge tone={SOURCE_TONES[SOURCE_COLORS[v || ''] || ''] || 'grey'}>{v?.replace(/_/g, ' ')}</SoftBadge>;
}

export function ReportTable({ title, columns, data, footer, subtitle }: { title: string; columns: ColumnsType<any>; data: any[]; footer?: any; subtitle?: string }) {
  return (
    <Card className="nex-card mb-4" styles={{ body: { padding: 0 } }}>
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#f2f3f9]">
        <div>
          <Typography.Text strong className="!text-[15px]">{title}</Typography.Text>
          {subtitle && <div className="text-[11px] text-[#a1a6c0]">{subtitle}</div>}
        </div>
      </div>
      <Table size="small" rowKey={(_, i: any) => String(i)} dataSource={data} columns={columns} pagination={false} scroll={{ x: true }} footer={footer} />
    </Card>
  );
}

export function BalanceBadge({ v }: { v: number }) {
  const tone = v > 0 ? 'green' : v < 0 ? 'red' : 'grey';
  return <SoftBadge tone={tone} dotless>{fmtMoney(v)}</SoftBadge>;
}

/* ------------------------------ Chart of Accounts ------------------------------ */
export function ChartOfAccounts() {
  const qc = useQueryClient();
  const meta = useMeta();
  const accounts = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => api('/finance/accounts') });
  const journals = useQuery({ queryKey: ['finance', 'journals'], queryFn: () => api('/finance/journals') });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [form] = Form.useForm();

  const balances = useMemo(() => {
    const map: Record<string, number> = {};
    (journals.data || []).forEach((j: any) => {
      if (j.status === 'REVERSED') return;
      (j.lines || []).forEach((l: any) => {
        if (!l.account) return;
        map[l.account.id] = (map[l.account.id] || 0) + Number(l.debit) - Number(l.credit);
      });
    });
    return map;
  }, [journals.data]);

  const rows = useMemo(() => {
    const list = accounts.data || [];
    const ids = new Set(list.map((a: any) => a.id));
    const byId: Record<string, any> = {};
    list.forEach((a: any) => { byId[a.id] = { ...a, children: [] }; });
    const roots: any[] = [];
    list.forEach((a: any) => {
      const node = byId[a.id];
      const net = balances[a.id] || 0;
      const normal = ACCOUNT_TYPES[a.type]?.normal || 'debit';
      node.balance = normal === 'debit' ? net : -net;
      node.absBalance = Math.abs(net);
      if (a.parentId && ids.has(a.parentId)) byId[a.parentId].children.push(node);
      else roots.push(node);
    });
    const filter = (nodes: any[]): any[] => nodes
      .filter((n) => (!typeFilter || n.type === typeFilter) && (!q || n.code.toLowerCase().includes(q.toLowerCase()) || n.name.toLowerCase().includes(q.toLowerCase())))
      .map((n) => ({ ...n, children: filter(n.children) }));
    return filter(roots);
  }, [accounts.data, balances, q, typeFilter]);

  const stats = useMemo(() => {
    const out: Record<string, { count: number; balance: number }> = {};
    (accounts.data || []).forEach((a: any) => {
      const t = ACCOUNT_TYPES[a.type];
      if (!t) return;
      out[a.type] = out[a.type] || { count: 0, balance: 0 };
      out[a.type].count++;
      out[a.type].balance += (t.normal === 'debit' ? 1 : -1) * (balances[a.id] || 0);
    });
    return out;
  }, [accounts.data, balances]);

  const assets = stats.ASSET?.balance || 0;
  const liabilities = stats.LIABILITY?.balance || 0;
  const equity = stats.EQUITY?.balance || 0;
  const balanced = Math.abs(assets - liabilities - equity) < 0.01;

  async function submit() {
    const v = await form.validateFields();
    try {
      setSaving(true);
      const payload = { code: v.code, name: v.name, type: v.type, parentId: v.parentId, active: v.active ?? true };
      if (editing) await api(`/finance/accounts/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/finance/accounts', { method: 'POST', body: JSON.stringify(payload) });
      message.success(editing ? 'Account updated' : 'Account created');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['finance', 'accounts'] });
      qc.invalidateQueries({ queryKey: ['meta'] });
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  function openCreate() { setEditing(null); form.resetFields(); setOpen(true); }
  function openEdit(rec: any) { setEditing(rec); form.setFieldsValue({ code: rec.code, name: rec.name, type: rec.type, parentId: rec.parentId, active: rec.active }); setOpen(true); }

  const columns: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 90, render: (v) => <span className="font-mono text-[12px] text-[#003366] font-semibold">{v}</span> },
    { title: 'Account', dataIndex: 'name', render: (v) => <span className="font-medium">{v}</span> },
    { title: 'Type', dataIndex: 'type', width: 130, render: (v: string) => <AccountTypeBadge type={v} /> },
    { title: 'Balance', dataIndex: 'balance', align: 'right', width: 150, render: (v) => <BalanceBadge v={v} /> },
    { title: 'Status', dataIndex: 'active', width: 90, render: (v) => <StatusTag value={v ? 'ACTIVE' : 'INACTIVE'} /> },
    { title: '', key: '_edit', width: 50, render: (_, r) => <Button type="link" size="small" onClick={() => openEdit(r)}>Edit</Button> },
  ];

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
        {Object.keys(ACCOUNT_TYPES).map((t) => {
          const cfg = ACCOUNT_TYPES[t];
          const s = stats[t];
          return (
            <div key={t} className="nex-stat nex-card-hover cursor-pointer" onClick={() => setTypeFilter(typeFilter === t ? undefined : t)} style={{ outline: typeFilter === t ? `2px solid ${cfg.color}40` : 'none' }}>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg" style={{ background: cfg.color, boxShadow: `0 6px 14px ${cfg.color}55` }}>{cfg.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-[#8a90ad]">{cfg.label} <span className="text-[#c3c7dc]">· {s?.count || 0}</span></div>
                  <div className="text-[18px] font-bold text-[#171a2e] truncate">{fmtMoney(s?.balance || 0)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="nex-card mb-4 flex items-center justify-between px-5 py-4" style={{ borderLeft: balanced ? '4px solid #10b981' : '4px solid #f59e0b' }}>
        <div>
          <Typography.Text strong>Accounting equation</Typography.Text>
          <div className="text-[13px] text-[#5a6080] mt-1">
            <span className="font-semibold text-[#171a2e]">{fmtMoney(assets)}</span> Assets = Liabilities <span className="font-semibold text-[#171a2e]">{fmtMoney(liabilities)}</span> + Equity <span className="font-semibold text-[#171a2e]">{fmtMoney(equity)}</span>
          </div>
        </div>
        <SoftBadge tone={balanced ? 'green' : 'amber'}>{balanced ? 'Balanced' : `Off by ${fmtMoney(Math.abs(assets - liabilities - equity))}`}</SoftBadge>
      </div>

      <Card className="nex-card mb-4" styles={{ body: { padding: 0 } }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <Space wrap>
            <Input allowClear prefix={<span className="text-[#a1a6c0] mr-1">🔍</span>} placeholder="Search accounts…" className="w-64 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
            {Object.keys(ACCOUNT_TYPES).map((t) => (
              <Tag key={t} color={typeFilter === t ? ACCOUNT_TYPES[t].color : undefined} style={{ borderRadius: 10, cursor: 'pointer', background: typeFilter === t ? undefined : '#f2f3f9', border: 'none', color: typeFilter === t ? undefined : '#5a6080' }} onClick={() => setTypeFilter(typeFilter === t ? undefined : t)}>
                {ACCOUNT_TYPES[t].label}
              </Tag>
            ))}
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New Account</Button>
        </div>
        <Table
          loading={accounts.isLoading || journals.isLoading}
          rowKey="id"
          dataSource={rows}
          columns={columns}
          pagination={false}
          scroll={{ x: true }}
          expandable={{ defaultExpandAllRows: true, indentSize: 18 }}
        />
      </Card>

      <Modal title={editing ? 'Edit account' : 'New account'} open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={saving} width={600} destroyOnHidden>
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-2 gap-x-4">
            <Form.Item label="Code" name="code" rules={[{ required: true }]}><Input placeholder="e.g. 1105" /></Form.Item>
            <Form.Item label="Name" name="name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="Type" name="type" rules={[{ required: true }]}>
              <Select options={Object.keys(ACCOUNT_TYPES).map((t) => ({ label: ACCOUNT_TYPES[t].label, value: t }))} />
            </Form.Item>
            <Form.Item label="Parent account" name="parentId">
              <Select allowClear showSearch optionFilterProp="label" placeholder="None (top level)" options={(meta.data?.accounts || []).map((a: any) => ({ label: `${a.code} — ${a.name}`, value: a.id }))} />
            </Form.Item>
            <Form.Item label="Active" name="active" initialValue={true}>
              <Select options={[{ label: 'Yes', value: true }, { label: 'No', value: false }]} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

/* ------------------------------ Journal Entries ------------------------------ */
export function JournalEntries() {
  const qc = useQueryClient();
  const meta = useMeta();
  const journals = useQuery({ queryKey: ['finance', 'journals'], queryFn: () => api('/finance/journals') });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [source, setSource] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<any>(undefined);
  const [form] = Form.useForm();

  const lines = Form.useWatch('lines', open ? form : undefined) || [];
  const totalDebit = lines.reduce((s: number, l: any) => s + Number(l?.debit || 0), 0);
  const totalCredit = lines.reduce((s: number, l: any) => s + Number(l?.credit || 0), 0);
  const diff = totalDebit - totalCredit;

  const data = useMemo(() => {
    let rows = journals.data || [];
    if (q) rows = rows.filter((r: any) => `${r.number} ${r.description} ${r.reference || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (source) rows = rows.filter((r: any) => r.sourceType === source);
    if (status) rows = rows.filter((r: any) => r.status === status);
    if (dateRange) {
      const [s, e] = dateRange;
      rows = rows.filter((r: any) => {
        const d = new Date(r.date);
        return d >= s.startOf('day').toDate() && d <= e.endOf('day').toDate();
      });
    }
    return rows;
  }, [journals.data, q, source, status, dateRange]);

  const sumDebit = data.reduce((s: number, r: any) => s + (r.lines || []).reduce((a: number, l: any) => a + Number(l.debit), 0), 0);
  const sumCredit = data.reduce((s: number, r: any) => s + (r.lines || []).reduce((a: number, l: any) => a + Number(l.credit), 0), 0);
  const sourceOptions = [...new Set((journals.data || []).map((r: any) => r.sourceType))];

  async function create(v: any) {
    try {
      setSaving(true);
      await api('/finance/journals', {
        method: 'POST',
        body: JSON.stringify({
          date: v.date?.format('YYYY-MM-DD'),
          description: v.description,
          reference: v.reference,
          lines: v.lines.map((l: any) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description })),
        }),
      });
      message.success('Journal posted');
      setOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['finance', 'journals'] });
      qc.invalidateQueries({ queryKey: ['finance', 'accounts'] });
      qc.invalidateQueries({ queryKey: ['finance', 'accounts-summary'] });
      qc.invalidateQueries({ queryKey: ['finance', 'ledger'] });
      qc.invalidateQueries({ queryKey: ['finance', 'dashboard'] });
      qc.invalidateQueries({ queryKey: ['finance', 'trial-balance'] });
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  async function reverse(id: string) {
    try { await api(`/finance/journals/${id}/reverse`, { method: 'POST' }); message.success('Journal reversed'); qc.invalidateQueries({ queryKey: ['finance', 'journals'] }); qc.invalidateQueries({ queryKey: ['finance', 'accounts'] }); qc.invalidateQueries({ queryKey: ['finance', 'accounts-summary'] }); qc.invalidateQueries({ queryKey: ['finance', 'ledger'] }); qc.invalidateQueries({ queryKey: ['finance', 'dashboard'] }); qc.invalidateQueries({ queryKey: ['finance', 'trial-balance'] }); }
    catch (e: any) { message.error(e.message); }
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard icon={<AccountBookOutlined />} label="Journal entries" value={journals.data?.length || 0} color="#003366" hint="Latest 200 records" />
        <StatCard icon={<DollarCircleOutlined />} label="Total debits" value={fmtMoney(sumDebit)} color="#10b981" />
        <StatCard icon={<FundOutlined />} label="Total credits" value={fmtMoney(sumCredit)} color="#f59e0b" />
      </div>

      <Card className="nex-card mb-4" styles={{ body: { padding: 0 } }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <Space wrap>
            <Input allowClear prefix={<span className="text-[#a1a6c0] mr-1">🔍</span>} placeholder="Search number / description…" className="w-60 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select allowClear placeholder="Source" className="!min-w-[150px]" value={source} onChange={setSource} options={sourceOptions.map((s) => ({ label: String(s).replace(/_/g, ' '), value: s }))} />
            <Select allowClear placeholder="Status" className="!min-w-[130px]" value={status} onChange={setStatus} options={['POSTED', 'REVERSED', 'DRAFT'].map((s) => ({ label: s, value: s }))} />
            <DatePicker.RangePicker className="!rounded-xl" value={dateRange} onChange={setDateRange} />
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ lines: [{ debit: 0, credit: 0 }] }); setOpen(true); }}>Manual Journal</Button>
        </div>
        <Table
          loading={journals.isLoading}
          rowKey="id"
          dataSource={data}
          scroll={{ x: true }}
          expandable={{
            expandedRowRender: (r: any) => (
              <Table size="small" rowKey="id" dataSource={r.lines} pagination={false}
                columns={[
                  { title: 'Account', render: (_, l: any) => <span className="font-medium">{l.account?.code} — {l.account?.name || l.accountId}</span> },
                  { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v: any) => <span className="text-[#10b981] font-semibold">{fmtMoney(v)}</span> },
                  { title: 'Credit', dataIndex: 'credit', align: 'right', render: (v: any) => <span className="text-[#ef4444] font-semibold">{fmtMoney(v)}</span> },
                  { title: 'Description', dataIndex: 'description' },
                ]} />
            ),
          }}
          footer={() => (
            <Space split={<Divider type="vertical" />} className="!text-[13px]">
              <Typography.Text strong>Debit {fmtMoney(sumDebit)}</Typography.Text>
              <Typography.Text strong>Credit {fmtMoney(sumCredit)}</Typography.Text>
              <Typography.Text strong type={Math.abs(sumDebit - sumCredit) < 0.01 ? 'success' : 'danger'}>Balanced: {Math.abs(sumDebit - sumCredit) < 0.01 ? 'Yes' : 'No'}</Typography.Text>
            </Space>
          )}
          columns={[
            { title: 'Number', dataIndex: 'number', width: 110, render: (v) => <span className="font-mono font-semibold text-[12px] text-[#003366]">{v}</span> },
            { title: 'Date', dataIndex: 'date', width: 110, render: fmtDate },
            { title: 'Description', dataIndex: 'description', render: (v) => <span className="font-medium">{v}</span> },
            { title: 'Reference', dataIndex: 'reference', width: 120, render: (v) => v || <span className="text-[#c3c7dc]">—</span> },
            { title: 'Source', dataIndex: 'sourceType', width: 140, render: (v: any) => <SourceBadge v={v} /> },
            { title: 'Status', dataIndex: 'status', width: 100, render: (v: any) => <StatusTag value={v} /> },
            { title: 'Lines', width: 80, align: 'center', render: (_, r: any) => <Tag style={{ borderRadius: 8, border: 'none', background: '#f2f3f9', color: '#5a6080' }}>{r.lines?.length || 0}</Tag> },
            { title: 'Actions', width: 110, render: (_, r: any) => r.status !== 'REVERSED' && <Button size="small" icon={<SwapOutlined />} onClick={() => reverse(r.id)}>Reverse</Button> },
          ]}
        />
      </Card>

      <Modal title="New journal entry" open={open} onCancel={() => setOpen(false)} onOk={create} confirmLoading={saving} width={820} destroyOnHidden>
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-3 gap-3">
            <Form.Item label="Date" name="date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Description" name="description" rules={[{ required: true }]} className="col-span-2"><Input /></Form.Item>
          </div>
          <Form.Item label="Reference" name="reference"><Input placeholder="Optional reference / document no." /></Form.Item>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-semibold text-[#8a90ad] w-64">Account</span>
                  <span className="text-[12px] font-semibold text-[#8a90ad] w-36 text-right">Debit</span>
                  <span className="text-[12px] font-semibold text-[#8a90ad] w-36 text-right">Credit</span>
                  <span className="text-[12px] font-semibold text-[#8a90ad] flex-1">Line note</span>
                </div>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} align="baseline" className="w-full mb-2" wrap>
                    <Form.Item name={[name, 'accountId']} {...rest} rules={[{ required: true, message: 'Account' }]} className="!mb-0 w-64">
                      <Select showSearch optionFilterProp="label" placeholder="Account" options={(meta.data?.accounts || []).map((a: any) => ({ label: `${a.code} — ${a.name}`, value: a.id }))} />
                    </Form.Item>
                    <Form.Item name={[name, 'debit']} {...rest} className="!mb-0 w-36"><InputNumber placeholder="0.00" min={0} prefix="$" className="w-full" /></Form.Item>
                    <Form.Item name={[name, 'credit']} {...rest} className="!mb-0 w-36"><InputNumber placeholder="0.00" min={0} prefix="$" className="w-full" /></Form.Item>
                    <Form.Item name={[name, 'description']} {...rest} className="!mb-0 flex-1 min-w-[140px]"><Input placeholder="Line note" /></Form.Item>
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ debit: 0, credit: 0 })}>Add line</Button>
              </>
            )}
          </Form.List>
          <div className="mt-3 rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: Math.abs(diff) < 0.01 ? '#f0fdf9' : '#fffbeb', border: `1px solid ${Math.abs(diff) < 0.01 ? '#a7f3d0' : '#fde68a'}` }}>
            <Typography.Text strong>Running balance</Typography.Text>
            <Typography.Text strong style={{ color: Math.abs(diff) < 0.01 ? '#10b981' : '#f59e0b' }}>
              Debit {fmtMoney(totalDebit)} − Credit {fmtMoney(totalCredit)} = {Math.abs(diff) < 0.01 ? 'Balanced ✓' : `Diff ${fmtMoney(diff)}`}
            </Typography.Text>
          </div>
        </Form>
      </Modal>
    </>
  );
}

/* ------------------------------ Trial Balance ------------------------------ */
export function TrialBalanceSection() {
  const report = useQuery({ queryKey: ['finance', 'trial-balance'], queryFn: () => api('/finance/trial-balance') });
  const tbRows = report.data || [];
  const totalDebit = tbRows.reduce((s: number, r: any) => s + Number(r.debit), 0);
  const totalCredit = tbRows.reduce((s: number, r: any) => s + Number(r.credit), 0);
  const tbBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
  if (report.error) return <Alert type="error" message={(report.error as Error).message} />;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard icon={<DollarCircleOutlined />} label="Total debit" value={fmtMoney(totalDebit)} color="#10b981" />
        <StatCard icon={<FundOutlined />} label="Total credit" value={fmtMoney(totalCredit)} color="#f59e0b" />
        <StatCard icon={<AuditOutlined />} label="Status" value={tbBalanced ? 'Balanced ✓' : 'Out of balance'} color={tbBalanced ? '#10b981' : '#ef4444'} gradient={tbBalanced ? 'linear-gradient(135deg,#f0fdf9,#ecfdf5)' : 'linear-gradient(135deg,#fef2f2,#fff7ed)'} />
      </div>
      <ReportTable title="Trial Balance" subtitle="All posted journal activity" data={tbRows}
        footer={() => (
          <Space split={<Divider type="vertical" />}>
            <Typography.Text strong>Debit {fmtMoney(totalDebit)}</Typography.Text>
            <Typography.Text strong>Credit {fmtMoney(totalCredit)}</Typography.Text>
            <Typography.Text strong type={tbBalanced ? 'success' : 'danger'}>Balanced: {tbBalanced ? 'Yes' : 'No'}</Typography.Text>
          </Space>
        )}
        columns={[
          { title: 'Code', dataIndex: 'code', width: 100, render: (v) => <span className="font-mono font-semibold text-[12px] text-[#003366]">{v}</span> },
          { title: 'Account', dataIndex: 'name' },
          { title: 'Type', dataIndex: 'type', width: 130, render: (v: string) => <AccountTypeBadge type={v} /> },
          { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => fmtMoney(v) },
          { title: 'Credit', dataIndex: 'credit', align: 'right', render: (v) => fmtMoney(v) },
        ]} />
    </>
  );
}

const moneyCol = (dataIndex: string) => ({ title: 'Amount', dataIndex, align: 'right' as const, render: (v: any) => fmtMoney(v) });
const sectionRows = (data: any, type: string) => Object.entries(data?.[type] || {}).map(([code, v]) => ({ code, name: data?.names?.[code], value: Number(v) }));
const accountCell = (v: any, r: any) => <span><span className="font-mono font-semibold text-[12px] text-[#003366]">{v}</span>{r?.name ? <span className="text-[#475467]"> · {r.name}</span> : null}</span>;

/* ------------------------------ Profit & Loss ------------------------------ */
export function PnlSection() {
  const pnl = useQuery({ queryKey: ['finance', 'pnl'], queryFn: () => api('/finance/profit-loss') });
  if (pnl.error) return <Alert type="error" message={(pnl.error as Error).message} />;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard icon={<RiseOutlined />} label="Total revenue" value={fmtMoney(pnl.data?.totals?.revenue)} color="#0ea5e9" />
        <StatCard icon={<FallOutlined />} label="Total expenses" value={fmtMoney(pnl.data?.totals?.expenses)} color="#ef4444" />
        <StatCard icon={<FundOutlined />} label="Net profit" value={fmtMoney(pnl.data?.netProfit)} color={(pnl.data?.netProfit || 0) >= 0 ? '#10b981' : '#ef4444'} gradient={(pnl.data?.netProfit || 0) >= 0 ? 'linear-gradient(135deg,#f0fdf9,#ecfdf5)' : 'linear-gradient(135deg,#fef2f2,#fff7ed)'} />
      </div>
      <ReportTable title="Revenue" data={sectionRows(pnl.data, 'revenue')}
        columns={[{ title: 'Account', dataIndex: 'code', render: accountCell }, moneyCol('amount')]} />
      <ReportTable title="Expenses" data={sectionRows(pnl.data, 'expenses')}
        columns={[{ title: 'Account', dataIndex: 'code', render: accountCell }, moneyCol('amount')]} />
      <Card className="nex-card" styles={{ body: { padding: 20 } }}>
        <div className="flex items-center justify-between">
          <Typography.Text strong className="!text-[15px]">Net profit for the period</Typography.Text>
          <Typography.Text strong className="!text-[20px]" style={{ color: (pnl.data?.netProfit || 0) >= 0 ? '#10b981' : '#ef4444' }}>{fmtMoney(pnl.data?.netProfit)}</Typography.Text>
        </div>
      </Card>
    </>
  );
}

/* ------------------------------ Balance Sheet ------------------------------ */
export function BalanceSheetSection() {
  const bs = useQuery({ queryKey: ['finance', 'bs'], queryFn: () => api('/finance/balance-sheet') });
  if (bs.error) return <Alert type="error" message={(bs.error as Error).message} />;
  const balanced = bs.data?.totals?.balanced || Math.abs((bs.data?.totals?.ASSET || 0) - (bs.data?.totals?.totalEquityAndLiabilities || 0)) < 0.01;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard icon={<BankOutlined />} label="Total assets" value={fmtMoney(bs.data?.totals?.ASSET)} color="#10b981" />
        <StatCard icon={<AuditOutlined />} label="Total liabilities" value={fmtMoney(bs.data?.totals?.LIABILITY)} color="#f59e0b" />
        <StatCard icon={<SolutionOutlined />} label="Equity + retained" value={fmtMoney(bs.data?.totals?.EQUITY)} color="#8b5cf6" />
      </div>
      <ReportTable title="Assets" data={sectionRows(bs.data, 'ASSET')} columns={[{ title: 'Account', dataIndex: 'code', render: accountCell }, moneyCol('value')]} />
      <ReportTable title="Liabilities" data={sectionRows(bs.data, 'LIABILITY')} columns={[{ title: 'Account', dataIndex: 'code', render: accountCell }, moneyCol('value')]} />
      <ReportTable title="Equity" data={sectionRows(bs.data, 'EQUITY')} columns={[{ title: 'Account', dataIndex: 'code', render: accountCell }, moneyCol('value')]} />
      <Card className="nex-card" styles={{ body: { padding: 20 } }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Space split={<Divider type="vertical" />} wrap>
            <Typography.Text strong>Assets {fmtMoney(bs.data?.totals?.ASSET)}</Typography.Text>
            <Typography.Text strong>Liabilities {fmtMoney(bs.data?.totals?.LIABILITY)}</Typography.Text>
            <Typography.Text strong>Equity {fmtMoney(bs.data?.totals?.EQUITY)}</Typography.Text>
          </Space>
          <Typography.Text strong style={{ color: balanced ? '#10b981' : '#ef4444' }}>{balanced ? 'Balanced ✓' : 'Out of balance'}</Typography.Text>
        </div>
      </Card>
    </>
  );
}

/* ------------------------------ Cash Flow ------------------------------ */
export function CashflowSection() {
  const cashflow = useQuery({ queryKey: ['finance', 'cashflow'], queryFn: () => api('/finance/cashflow') });
  if (cashflow.error) return <Alert type="error" message={(cashflow.error as Error).message} />;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard icon={<RiseOutlined />} label="Total inflow" value={fmtMoney((cashflow.data || []).reduce((s: number, r: any) => s + Number(r.inflow), 0))} color="#10b981" />
        <StatCard icon={<FallOutlined />} label="Total outflow" value={fmtMoney((cashflow.data || []).reduce((s: number, r: any) => s + Number(r.outflow), 0))} color="#ef4444" />
        <StatCard icon={<FundOutlined />} label="Net cash" value={fmtMoney((cashflow.data || []).reduce((s: number, r: any) => s + Number(r.net), 0))} color="#003366" />
      </div>
      <ReportTable title="Cash Flow" data={cashflow.data || []} columns={[
        { title: 'Month', dataIndex: 'month', render: (v) => <span className="font-semibold">{v}</span> },
        { title: 'Inflow', dataIndex: 'inflow', align: 'right', render: (v) => <span className="text-[#10b981] font-semibold">{fmtMoney(v)}</span> },
        { title: 'Outflow', dataIndex: 'outflow', align: 'right', render: (v) => <span className="text-[#ef4444] font-semibold">{fmtMoney(v)}</span> },
        { title: 'Net', dataIndex: 'net', align: 'right', render: (v) => <BalanceBadge v={v} /> },
      ]} />
    </>
  );
}

/* ------------------------------ Budget vs Actual ------------------------------ */
export function VarianceSection() {
  const variance = useQuery({ queryKey: ['finance', 'variance'], queryFn: () => api('/finance/budget-vs-actual') });
  if (variance.error) return <Alert type="error" message={(variance.error as Error).message} />;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard icon={<AccountBookOutlined />} label="Budget" value={fmtMoney(variance.data?.totals?.budget)} color="#003366" />
        <StatCard icon={<FundOutlined />} label="Actual" value={fmtMoney(variance.data?.totals?.actual)} color="#0ea5e9" />
        <StatCard icon={<RiseOutlined />} label="Variance" value={fmtMoney(variance.data?.totals?.variance)} color={(Number(variance.data?.totals?.variance) || 0) >= 0 ? '#10b981' : '#ef4444'} />
      </div>
      <ReportTable title="Budget vs Actual" data={variance.data?.rows || []}
        footer={() => (
          <Space split={<Divider type="vertical" />}>
            <Typography.Text strong>Budget {fmtMoney(variance.data?.totals?.budget)}</Typography.Text>
            <Typography.Text strong>Actual {fmtMoney(variance.data?.totals?.actual)}</Typography.Text>
            <Typography.Text strong>Variance {fmtMoney(variance.data?.totals?.variance)}</Typography.Text>
          </Space>
        )}
        columns={[
          { title: 'Account', render: (_, r: any) => r.account?.name || r.accountId },
          { title: 'Budget', dataIndex: 'budget', align: 'right', render: (v) => fmtMoney(v) },
          { title: 'Actual', dataIndex: 'actual', align: 'right', render: (v) => fmtMoney(v) },
          { title: 'Variance', dataIndex: 'variance', align: 'right', render: (v) => <BalanceBadge v={Number(v)} /> },
        ]} />
    </>
  );
}

/* ------------------------------ General Ledger ------------------------------ */
export function GeneralLedger() {
  const accounts = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => api('/finance/accounts') });
  const journals = useQuery({ queryKey: ['finance', 'journals'], queryFn: () => api('/finance/journals') });
  const [accountId, setAccountId] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const [dateRange, setDateRange] = useState<any>(undefined);

  const ledger = useMemo(() => {
    const byAccount: Record<string, any> = {};
    (journals.data || []).forEach((j: any) => {
      (j.lines || []).forEach((l: any) => {
        if (!l.account) return;
        const key = l.account.id;
        if (!byAccount[key]) byAccount[key] = { account: l.account, entries: [] };
        byAccount[key].entries.push({ ...l, journal: j });
      });
    });
    return Object.values(byAccount);
  }, [journals.data]);

  const rows = useMemo(() => {
    const list = ledger.filter((r: any) => !accountId || r.account.id === accountId);
    const filtered = list.map((r: any) => {
      let entries = r.entries.filter((e: any) => !q || `${e.journal.number} ${e.journal.description} ${e.description || ''}`.toLowerCase().includes(q.toLowerCase()));
      if (dateRange) {
        const [s, e] = dateRange;
        entries = entries.filter((en: any) => {
          const d = new Date(en.journal.date);
          return d >= s.startOf('day').toDate() && d <= e.endOf('day').toDate();
        });
      }
      entries = [...entries].sort((a, b) => new Date(a.journal.date).getTime() - new Date(b.journal.date).getTime());
      const normal = ACCOUNT_TYPES[r.account.type]?.normal || 'debit';
      let running = 0;
      const rows = entries.map((en: any) => {
        const debit = Number(en.debit);
        const credit = Number(en.credit);
        running += normal === 'debit' ? debit - credit : credit - debit;
        return { ...en, running };
      });
      return {
        ...r,
        entries: rows,
        totalDebit: entries.reduce((s: number, en: any) => s + Number(en.debit), 0),
        totalCredit: entries.reduce((s: number, en: any) => s + Number(en.credit), 0),
        balance: running,
      };
    });
    return filtered;
  }, [ledger, accountId, q, dateRange]);

  const totalDebit = rows.reduce((s: number, r: any) => s + r.totalDebit, 0);
  const totalCredit = rows.reduce((s: number, r: any) => s + r.totalCredit, 0);
  const closing = rows.reduce((s: number, r: any) => s + r.balance, 0);

  const columns: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 90, render: (_, r: any) => <span className="font-mono font-semibold text-[12px] text-[#003366]">{r.account.code}</span> },
    { title: 'Account', render: (_, r: any) => <span className="font-medium">{r.account.name}</span> },
    { title: 'Type', dataIndex: 'type', width: 120, render: (_, r: any) => <AccountTypeBadge type={r.account.type} /> },
    { title: 'Debit', dataIndex: 'totalDebit', align: 'right', width: 130, render: (v) => fmtMoney(v) },
    { title: 'Credit', dataIndex: 'totalCredit', align: 'right', width: 130, render: (v) => fmtMoney(v) },
    { title: 'Balance', dataIndex: 'balance', align: 'right', width: 130, render: (v) => <BalanceBadge v={v} /> },
  ];

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <StatCard icon={<AccountBookOutlined />} label="Accounts" value={rows.length} color="#003366" />
        <StatCard icon={<DollarCircleOutlined />} label="Total debit" value={fmtMoney(totalDebit)} color="#10b981" />
        <StatCard icon={<FundOutlined />} label="Total credit" value={fmtMoney(totalCredit)} color="#f59e0b" />
        <StatCard icon={<RiseOutlined />} label="Closing balance" value={fmtMoney(closing)} color="#003366" />
      </div>
      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <Space wrap>
            <Select
              allowClear showSearch optionFilterProp="label"
              placeholder="Filter by account"
              className="!min-w-[260px]"
              value={accountId}
              onChange={setAccountId}
              options={(accounts.data || []).map((a: any) => ({ label: `${a.code} — ${a.name}`, value: a.id }))}
            />
            <Input allowClear prefix={<span className="text-[#a1a6c0] mr-1">🔍</span>} placeholder="Search entries…" className="w-60 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
            <DatePicker.RangePicker className="!rounded-xl" value={dateRange} onChange={setDateRange} />
          </Space>
        </div>
        <Table
          loading={journals.isLoading || accounts.isLoading}
          rowKey={(_, i: any) => String(i)}
          dataSource={rows}
          columns={columns}
          scroll={{ x: true }}
          pagination={false}
          expandable={{
            expandedRowRender: (r: any) => (
              <Table size="small" rowKey="id" dataSource={r.entries} pagination={false}
                columns={[
                  { title: 'Date', dataIndex: 'date', width: 110, render: (_, en: any) => fmtDate(en.journal.date) },
                  { title: 'Number', width: 110, render: (_, en: any) => <span className="font-mono text-[12px]">{en.journal.number}</span> },
                  { title: 'Description', render: (_, en: any) => en.description || en.journal.description },
                  { title: 'Source', width: 130, render: (_, en: any) => <SourceBadge v={en.journal.sourceType} /> },
                  { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => <span className="text-[#10b981] font-semibold">{fmtMoney(v)}</span> },
                  { title: 'Credit', dataIndex: 'credit', align: 'right', render: (v) => <span className="text-[#ef4444] font-semibold">{fmtMoney(v)}</span> },
                  { title: 'Balance', dataIndex: 'running', align: 'right', render: (v) => <BalanceBadge v={v} /> },
                ]} />
            ),
          }}
        />
      </Card>
    </>
  );
}

/* ------------------------------ Bank Reconciliation ------------------------------ */
export function Reconciliation() {
  const meta = useMeta();
  const journals = useQuery({ queryKey: ['finance', 'journals'], queryFn: () => api('/finance/journals') });
  const accounts = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => api('/finance/accounts') });
  const defaultAccount = (accounts.data || []).find((a: any) => a.code === '1000') || (accounts.data || [])[0];
  const [accountId, setAccountId] = useState<string | undefined>(defaultAccount?.id);
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [statement, setStatement] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const account = (accounts.data || []).find((a: any) => a.id === accountId) || defaultAccount;

  const movements = useMemo(() => {
    const out: any[] = [];
    (journals.data || []).forEach((j: any) => {
      (j.lines || []).forEach((l: any) => {
        if (l.accountId !== accountId && l.account?.id !== accountId) return;
        out.push({ id: l.id, date: j.date, journal: j, debit: Number(l.debit), credit: Number(l.credit), description: l.description || j.description });
      });
    });
    return out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [journals.data, accountId]);

  const storageKey = accountId ? `nex-recon-${accountId}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setCleared(parsed.cleared || {});
        setStatement(parsed.statement ?? null);
      }
    } catch { /* ignore */ }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !loaded) return;
    localStorage.setItem(storageKey, JSON.stringify({ cleared, statement }));
  }, [cleared, statement, storageKey, loaded]);

  const bookBalance = movements.reduce((s: number, m: any) => s + m.debit - m.credit, 0);
  const clearedDebits = movements.filter((m) => cleared[m.id]).reduce((s: number, m: any) => s + m.debit, 0);
  const clearedCredits = movements.filter((m) => cleared[m.id]).reduce((s: number, m: any) => s + m.credit, 0);
  const unclearedDebits = movements.filter((m) => !cleared[m.id]).reduce((s: number, m: any) => s + m.debit, 0);
  const unclearedCredits = movements.filter((m) => !cleared[m.id]).reduce((s: number, m: any) => s + m.credit, 0);
  const adjustedBook = bookBalance + unclearedDebits - unclearedCredits;
  const diff = statement == null ? null : adjustedBook - statement;
  const isReconciled = diff != null && Math.abs(diff) < 0.01;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard icon={<BankOutlined />} label="Book balance" value={fmtMoney(bookBalance)} color="#003366" hint="Ledger postings" />
        <StatCard icon={<CheckCircleOutlined />} label="Cleared" value={fmtMoney(clearedDebits - clearedCredits)} color="#10b981" />
        <StatCard icon={<RiseOutlined />} label="Adjusted book" value={fmtMoney(adjustedBook)} color="#0ea5e9" hint="Incl. outstanding items" />
        <StatCard icon={isReconciled ? <CheckCircleOutlined /> : <AuditOutlined />} label={diff == null ? 'Statement balance' : (isReconciled ? 'Reconciled ✓' : `Difference ${fmtMoney(diff)}`)} value={diff == null ? 'Enter statement' : fmtMoney(statement)} color={isReconciled ? '#10b981' : diff == null ? '#f59e0b' : '#ef4444'} gradient={isReconciled ? 'linear-gradient(135deg,#f0fdf9,#ecfdf5)' : undefined} />
      </div>

      <Card className="nex-card mb-4" styles={{ body: { padding: 0 } }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <Space wrap>
            <Select
              showSearch optionFilterProp="label"
              placeholder="Bank / cash account"
              className="!min-w-[280px]"
              value={accountId}
              onChange={(v) => { setAccountId(v); setCleared({}); setStatement(null); setLoaded(false); }}
              options={(accounts.data || []).map((a: any) => ({ label: `${a.code} — ${a.name} (${a.type})`, value: a.id }))}
            />
            <span className="text-[12px] text-[#8a90ad]">{movements.length} postings</span>
          </Space>
          <Space>
            <span className="text-[13px] text-[#5a6080]">Statement ending balance</span>
            <InputNumber
              prefix="$"
              className="!w-44"
              value={statement}
              onChange={(v) => setStatement(v == null ? null : Number(v))}
              placeholder="0.00"
            />
            <Button
              size="small"
              onClick={() => { setCleared({}); setStatement(null); localStorage.removeItem(storageKey || ''); }}
            >
              Clear marks
            </Button>
          </Space>
        </div>
      </Card>

      <Card className="nex-card" styles={{ body: { padding: 0 } }} title={undefined}>
        <div className="px-5 pt-4 pb-3 border-b border-[#f2f3f9] flex items-center justify-between">
          <div>
            <Typography.Text strong className="!text-[15px]">Bank statement items — {account?.code} {account?.name}</Typography.Text>
            <div className="text-[11px] text-[#a1a6c0]">Mark items as cleared to match the bank statement. Deposits in transit (uncleared debits) and outstanding checks (uncleared credits) adjust the book balance.</div>
          </div>
        </div>
        <Table
          loading={journals.isLoading}
          rowKey="id"
          dataSource={movements}
          pagination={false}
          scroll={{ x: true }}
          footer={() => (
            <Space split={<Divider type="vertical" />}>
              <Typography.Text strong>Uncleared debits {fmtMoney(unclearedDebits)}</Typography.Text>
              <Typography.Text strong>Uncleared credits {fmtMoney(unclearedCredits)}</Typography.Text>
              {diff != null && (
                <Typography.Text strong type={isReconciled ? 'success' : 'danger'}>
                  {isReconciled ? 'Reconciled — statement matches ✓' : `Statement differs by ${fmtMoney(diff)}`}
                </Typography.Text>
              )}
            </Space>
          )}
          columns={[
            { title: 'Cleared', width: 90, render: (_, r: any) => <input type="checkbox" checked={!!cleared[r.id]} onChange={(e) => setCleared({ ...cleared, [r.id]: e.target.checked })} /> },
            { title: 'Date', dataIndex: 'date', width: 110, render: (v) => fmtDate(v) },
            { title: 'Number', width: 110, render: (_, r: any) => <span className="font-mono text-[12px]">{r.journal.number}</span> },
            { title: 'Description', render: (_, r: any) => r.description },
            { title: 'Source', width: 130, render: (_, r: any) => <SourceBadge v={r.journal.sourceType} /> },
            { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => <span className="text-[#10b981] font-semibold">{fmtMoney(v)}</span> },
            { title: 'Credit', dataIndex: 'credit', align: 'right', render: (v) => <span className="text-[#ef4444] font-semibold">{fmtMoney(v)}</span> },
            {
              title: 'Status', width: 110, render: (_, r: any) => (
                <SoftBadge tone={cleared[r.id] ? 'green' : 'amber'}>{cleared[r.id] ? 'Cleared' : 'Outstanding'}</SoftBadge>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
