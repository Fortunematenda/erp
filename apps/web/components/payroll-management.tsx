'use client';
import React, { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Button, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Skeleton, Space, Switch, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill, DetailItem, EmptyState } from '@/components/sales-ui';
import { RowActionsMenu, ACTIONS_COL } from '@/components/row-actions-menu';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (p: number) => (p >= 1 && p <= 12 ? MONTHS[p - 1] : `Period ${p}`);
const money = (v: any, c = 'USD') => `${c === 'USD' ? '$' : c + ' '}${fmtNumber(v, 2)}`;

export function PayrollManagement() {
  const [sub, setSub] = useState('runs');
  const [newOpen, setNewOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  return (
    <div className="py-3">
      <Tabs className="nexus-section-tabs" activeKey={sub} onChange={setSub} items={[
        { key: 'runs', label: 'Runs', children: <Runs onOpen={setRunId} onNew={() => setNewOpen(true)} /> },
        { key: 'inputs', label: 'Inputs', children: <Inputs onNew={() => setInputOpen(true)} /> },
        { key: 'payments', label: 'Payments', children: <Payments onOpen={setRunId} /> },
        { key: 'settings', label: 'Settings', children: <Settings /> },
      ]} />
      {newOpen && <NewRunDrawer onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); setRunId(id); }} />}
      {runId && <RunDrawer id={runId} onClose={() => setRunId(null)} />}
      {inputOpen && <ManualInputDrawer onClose={() => setInputOpen(false)} />}
    </div>
  );
}

function Card({ label, value, color, onClick }: any) {
  return <button onClick={onClick} className="nex-card border rounded-lg p-4 text-center hover:border-[#c7d2fe] transition"><div className="text-[12px] font-semibold text-[#64748b]">{label}</div><div className="text-[19px] font-bold" style={{ color: color || '#171a2e' }}>{value}</div></button>;
}

// ======================================================================
function Runs({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<any>({});
  const summary = useQuery({ queryKey: ['/hr/payroll-summary'], queryFn: () => api('/hr/payroll-summary'), placeholderData: keepPreviousData });
  const runs = useQuery({ queryKey: ['/hr/payroll-runs'], queryFn: () => api('/hr/payroll-runs'), placeholderData: keepPreviousData });
  const refresh = () => ['/hr/payroll-runs', '/hr/payroll-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const rows = (runs.data || []).filter((r: any) => (!f.year || r.year === Number(f.year)) && (!f.status || r.status === f.status) && (!f.payment || r.paymentStatus === f.payment));

  async function act(r: any, action: string) {
    try {
      if (action === 'process') await api(`/hr/payroll-runs/${r.id}/process`, { method: 'POST' });
      else if (action === 'lock') await api(`/hr/payroll-runs/${r.id}/lock`, { method: 'POST' });
      else if (action === 'pay') { const ref = window.prompt('Payment reference (optional)') || undefined; await api(`/hr/payroll-runs/${r.id}/payment`, { method: 'POST', body: JSON.stringify({ method: 'BANK', reference: ref }) }); }
      message.success('Payroll updated'); refresh();
    } catch (e: any) { message.error(e.message); }
  }

  const s = summary.data || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Current Payroll" value={s.current ? `${monthName(s.current.period)} ${s.current.year}` : '—'} onClick={() => setF({})} />
        <Card label="Gross Pay" value={money(s.totalGross)} onClick={() => setF({})} />
        <Card label="Net Pay" value={money(s.totalNet)} color="#16a34a" onClick={() => setF({})} />
        <Card label="Unpaid Payroll" value={money(s.unpaidNet)} color="#b45309" onClick={() => setF({ payment: 'UNPAID' })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select allowClear placeholder="Year" style={{ width: 100 }} value={f.year} onChange={(v) => setF({ ...f, year: v })} options={[2025, 2026, 2027].map((y) => ({ label: String(y), value: y }))} />
        <Select allowClear placeholder="Payroll status" style={{ width: 150 }} value={f.status} onChange={(v) => setF({ ...f, status: v })} options={['DRAFT', 'PROCESSED', 'LOCKED', 'FINALISED', 'REVERSED'].map((x) => ({ label: x, value: x }))} />
        <Select allowClear placeholder="Payment" style={{ width: 150 }} value={f.payment} onChange={(v) => setF({ ...f, payment: v })} options={['UNPAID', 'PARTIALLY_PAID', 'PAID', 'PAYMENT_PENDING', 'VOID'].map((x) => ({ label: x.replace(/_/g, ' '), value: x }))} />
        <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        <div className="ml-auto"><Can permission="payroll.create"><Button type="primary" icon={<PlusOutlined />} onClick={onNew}>New Payroll Run</Button></Can></div>
      </div>
      <Table rowKey="id" size="small" loading={runs.isLoading} dataSource={rows} pagination={{ pageSize: 12 }} scroll={{ x: 1300 }} columns={[
        { title: 'Period', render: (_v, r) => <a className="text-[13px] font-medium text-[#1d5fb5]" onClick={() => onOpen(r.id)}>{monthName(r.period)} {r.year}</a>, sorter: (a: any, b: any) => a.year * 12 + a.period - (b.year * 12 + b.period) },
        { title: 'Pay Date', dataIndex: 'payDate', width: 120, render: (v) => fmtDate(v) },
        { title: 'Employees', width: 100, align: 'right', render: (_v, r) => r.employeeCount ?? r._count?.payslips ?? 0 },
        { title: 'Gross', dataIndex: 'totalGross', width: 120, align: 'right', render: (v, r) => money(v, r.currency) },
        { title: 'Deductions', dataIndex: 'totalDeductions', width: 120, align: 'right', render: (v, r) => money(v, r.currency) },
        { title: 'Employer Cost', dataIndex: 'employerCost', width: 130, align: 'right', render: (v, r) => money(v, r.currency) },
        { title: 'Net Pay', dataIndex: 'totalNet', width: 120, align: 'right', render: (v, r) => <span className="font-semibold">{money(v, r.currency)}</span> },
        { title: 'Payroll Status', dataIndex: 'status', width: 120, render: (v) => <StatusPill status={v} /> },
        { title: 'Payment', dataIndex: 'paymentStatus', width: 130, render: (v) => <StatusPill status={v} /> },
        { ...ACTIONS_COL, width: 90, render: (_v, r) => <Space size={2}><Button size="small" onClick={() => onOpen(r.id)}>View</Button><RowActionsMenu items={[
          { key: 'process', label: 'Calculate / Process', hidden: r.status !== 'DRAFT', permission: 'payroll.process', onClick: () => act(r, 'process') },
          { key: 'lock', label: 'Lock / Finalise', hidden: r.status !== 'PROCESSED', permission: 'payroll.process', onClick: () => act(r, 'lock') },
          { key: 'pay', label: 'Record Payment', hidden: r.paymentStatus === 'PAID' || !['PROCESSED', 'LOCKED', 'FINALISED'].includes(r.status), permission: 'payroll.process', onClick: () => act(r, 'pay') },
          { key: 'view', label: 'View', onClick: () => onOpen(r.id) },
        ]} /></Space> },
      ] as ColumnsType<any>} locale={{ emptyText: <EmptyState title="No payroll runs found." action={<Can permission="payroll.create"><Button type="primary" onClick={onNew}>New Payroll Run</Button></Can>} /> }} />
    </div>
  );
}

// ======================================================================
function NewRunDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });
  const activeCount = (employees.data || []).filter((e: any) => e.active).length;
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try {
      const run = await api('/hr/payroll-runs', { method: 'POST', body: JSON.stringify({ period: v.period, year: v.year, payDate: v.payDate.format('YYYY-MM-DD'), payrollType: v.payrollType, currency: v.currency, notes: v.notes }) });
      message.success('Payroll run created'); qc.invalidateQueries({ queryKey: ['/hr/payroll-runs'] }); onCreated(run.id);
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={560} title="New Payroll Run"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Create Payroll Run</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ period: new Date().getMonth() + 1, year: new Date().getFullYear(), payDate: dayjs(), payrollType: 'REGULAR', currency: 'USD' }}>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="period" label="Payroll Period" rules={[{ required: true }]}><Select options={MONTHS.map((m, i) => ({ label: m, value: i + 1 }))} /></Form.Item></Col>
          <Col span={12}><Form.Item name="year" label="Year" rules={[{ required: true }]}><InputNumber min={2000} max={2100} className="w-full" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="payDate" label="Pay Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item name="payrollType" label="Payroll Type"><Select options={['REGULAR', 'OFF_CYCLE', 'BONUS', 'FINAL_PAY', 'CORRECTION'].map((x) => ({ label: x.replace(/_/g, ' '), value: x }))} /></Form.Item></Col>
        </Row>
        <Form.Item name="currency" label="Currency"><Select options={['USD', 'ZAR', 'GBP', 'EUR'].map((c) => ({ label: c, value: c }))} /></Form.Item>
        <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
        <div className="nex-card border rounded-lg p-3 text-[13px]"><div className="flex justify-between"><span className="text-[#64748b]">Active employees included</span><span className="font-semibold">{activeCount}</span></div><div className="text-[12px] text-[#94a3b8] mt-1">Employees are included at process time; salaries are loaded automatically from each employee's compensation record.</div></div>
      </Form>
    </Drawer>
  );
}

// ======================================================================
function RunDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['/hr/payroll-runs', id, 'detail'], queryFn: () => api(`/hr/payroll-runs/${id}/detail`) });
  const [tab, setTab] = useState('summary');
  const run = data?.run;
  async function act(action: 'process' | 'lock' | 'pay') {
    try {
      if (action === 'process') await api(`/hr/payroll-runs/${id}/process`, { method: 'POST' });
      else if (action === 'lock') await api(`/hr/payroll-runs/${id}/lock`, { method: 'POST' });
      else await api(`/hr/payroll-runs/${id}/payment`, { method: 'POST', body: JSON.stringify({ method: 'BANK' }) });
      message.success('Payroll updated'); qc.invalidateQueries({ queryKey: ['/hr/payroll-runs', id, 'detail'] }); qc.invalidateQueries({ queryKey: ['/hr/payroll-runs'] });
    } catch (e: any) { message.error(e.message); }
  }
  return (
    <Drawer open onClose={onClose} width="min(1150px, 97vw)" destroyOnHidden title={run ? `${monthName(run.period)} ${run.year}` : 'Payroll Run'}
      extra={run && <Space size="small"><StatusPill status={run.status} /><StatusPill status={run.paymentStatus} />
        <Can permission="payroll.process">{run.status === 'DRAFT' && <Button size="small" type="primary" onClick={() => act('process')}>Calculate</Button>}{run.status === 'PROCESSED' && <Button size="small" onClick={() => act('lock')}>Lock / Finalise</Button>}{['PROCESSED', 'LOCKED', 'FINALISED'].includes(run.status) && run.paymentStatus !== 'PAID' && <Button size="small" type="primary" onClick={() => act('pay')}>Record Payment</Button>}</Can>
      </Space>}>
      {isLoading || !run ? <Skeleton active /> : (
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'summary', label: 'Summary', children: <SummaryTab run={run} /> },
          { key: 'employees', label: `Employees (${data.payslips.length})`, children: <EmployeesTab payslips={data.payslips} /> },
          { key: 'inputs', label: `Inputs (${data.inputs.length})`, children: <InputsTable rows={data.inputs} /> },
          { key: 'exceptions', label: `Exceptions (${data.validation.exceptions.length})`, children: <ExceptionsTab validation={data.validation} /> },
          { key: 'accounting', label: 'Accounting', children: <AccountingTab journal={data.journal} /> },
          { key: 'audit', label: 'Audit', children: <AuditTab audit={data.audit} /> },
        ]} />
      )}
    </Drawer>
  );
}

function SummaryTab({ run }: any) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Employees" value={run.payslipCount} /><Card label="Gross" value={money(run.totalGross, run.currency)} />
        <Card label="Deductions" value={money(run.totalDeductions, run.currency)} /><Card label="Net Pay" value={money(run.totalNet, run.currency)} color="#16a34a" />
      </div>
      <div className="nex-card border rounded-lg p-4">
        <DetailItem label="Period" value={`${monthName(run.period)} ${run.year}`} />
        <DetailItem label="Payroll type" value={(run.payrollType || 'REGULAR').replace(/_/g, ' ')} />
        <DetailItem label="Pay date" value={fmtDate(run.payDate)} />
        <DetailItem label="Currency" value={run.currency} />
        <DetailItem label="Payroll status" value={run.status} />
        <DetailItem label="Payment status" value={run.paymentStatus} />
        <DetailItem label="Employer cost" value={money(run.employerCost, run.currency)} />
        <DetailItem label="Notes" value={run.notes} />
      </div>
    </div>
  );
}

function EmployeesTab({ payslips }: any) {
  return <Table rowKey="id" size="small" dataSource={payslips} pagination={{ pageSize: 12 }} scroll={{ x: 1200 }} columns={[
    { title: 'Employee', render: (_v, r) => <span className="text-[13px] font-medium">{r.employee?.firstName} {r.employee?.lastName}</span> },
    { title: 'Department', width: 150, render: (_v, r) => r.employee?.department?.name || '—' },
    { title: 'Basic', dataIndex: 'basicSalary', width: 100, align: 'right', render: (v) => money(v) },
    { title: 'Overtime', width: 100, align: 'right', render: (_v, r) => money((r.allowances || {})['Overtime'] || 0) },
    { title: 'Incentives', width: 100, align: 'right', render: (_v, r) => money(r.bonusAmount || 0) },
    { title: 'Gross', dataIndex: 'grossPay', width: 110, align: 'right', render: (v) => money(v) },
    { title: 'Tax', dataIndex: 'payeTax', width: 100, align: 'right', render: (v) => money(v) },
    { title: 'Deductions', dataIndex: 'otherDeductions', width: 110, align: 'right', render: (v, r) => money(Number(v) + Number(r.nssaDeduction)) },
    { title: 'Net', dataIndex: 'netPay', width: 110, align: 'right', render: (v) => <span className="font-semibold">{money(v)}</span> },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusPill status={v} /> },
  ] as ColumnsType<any>} />;
}

function ExceptionsTab({ validation }: any) {
  if (!validation.exceptions.length) return <EmptyState title="No payroll exceptions detected." />;
  return <Table rowKey={(r: any, i: any) => `${i}`} size="small" dataSource={validation.exceptions} pagination={false} columns={[
    { title: 'Severity', width: 110, render: (_v, r) => <Tag color={r.severity === 'BLOCKING' ? 'red' : 'orange'}>{r.severity}</Tag> },
    { title: 'Employee', width: 180, dataIndex: 'employee', render: (v) => v || '—' },
    { title: 'Exception', dataIndex: 'exception' },
    { title: 'Source', dataIndex: 'source', width: 120 },
    { title: 'Blocking', dataIndex: 'blocking', width: 90, render: (v) => v ? 'YES' : 'NO' },
  ] as ColumnsType<any>} />;
}

function AccountingTab({ journal }: any) {
  if (!journal) return <EmptyState title="Payroll has not been posted to the General Ledger yet." description="Processing the payroll creates a balanced journal." />;
  return (
    <div className="space-y-3">
      <div className="text-[13px]">Journal <span className="font-semibold">{journal.number}</span> · {fmtDate(journal.date)}</div>
      <Table rowKey={(r: any, i: any) => `${i}`} size="small" dataSource={journal.lines} pagination={false} columns={[
        { title: 'Account', dataIndex: 'accountId', render: (v) => v?.slice(0, 8) },
        { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => money(v) },
        { title: 'Credit', dataIndex: 'credit', align: 'right', render: (v) => money(v) },
        { title: 'Description', dataIndex: 'description' },
      ] as ColumnsType<any>} />
    </div>
  );
}

function AuditTab({ audit }: any) {
  if (!audit.length) return <EmptyState title="No audit entries yet." />;
  return <div>{audit.map((a: any, i: number) => <div key={i} className="flex justify-between py-2 border-b border-[#f0f1f6] last:border-0 text-[13px]"><span>{a.action.replace(/_/g, ' ')} · {a.user}{a.reason ? ` · ${a.reason}` : ''}</span><span className="text-[#94a3b8] text-[12px]">{fmtDateTime(a.at)}</span></div>)}</div>;
}

// ======================================================================
function Inputs({ onNew }: { onNew: () => void }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['/hr/payroll-inputs'], queryFn: () => api('/hr/payroll-inputs') });
  async function sync() {
    const period = new Date().getMonth() + 1; const year = new Date().getFullYear();
    try { const r = await api('/hr/payroll-inputs/sync', { method: 'POST', body: JSON.stringify({ period, year }) }); message.success(`Synced ${r.created} new input(s)`); qc.invalidateQueries({ queryKey: ['/hr/payroll-inputs'] }); }
    catch (e: any) { message.error(e.message); }
  }
  async function voidIt(r: any) { try { const reason = window.prompt('Reason?') || undefined; await api(`/hr/payroll-inputs/${r.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }); message.success('Input voided'); qc.invalidateQueries({ queryKey: ['/hr/payroll-inputs'] }); } catch (e: any) { message.error(e.message); } }
  return (
    <div>
      <div className="flex items-center gap-2 py-3">
        <Button icon={<SyncOutlined />} onClick={sync}>Sync from Attendance / Leave / Performance</Button>
        <div className="ml-auto"><Can permission={['payroll.process', 'payroll.create']}><Button type="primary" icon={<PlusOutlined />} onClick={onNew}>Payroll Input</Button></Can></div>
      </div>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 12 }} scroll={{ x: 1100 }} columns={[
        { title: 'Employee', render: (_v, r) => <span className="text-[13px] font-medium">{r.employee?.firstName} {r.employee?.lastName}</span> },
        { title: 'Input Type', dataIndex: 'category', width: 130, render: (v) => (v || '').replace(/_/g, ' ') },
        { title: 'Code', dataIndex: 'code', width: 150 },
        { title: 'Description', dataIndex: 'description' },
        { title: 'Period', width: 110, render: (_v, r) => `${monthName(r.period)} ${r.year}` },
        { title: 'Amount / Units', width: 140, align: 'right', render: (_v, r) => r.unit ? `${fmtNumber(r.quantity, 1)} ${r.unit}` : money(r.amount) },
        { title: 'Source', width: 130, render: (_v, r) => r.source === 'SYSTEM' ? (r.sourceType || 'System') : 'Manual' },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusPill status={v} /> },
        { ...ACTIONS_COL, render: (_v, r) => <RowActionsMenu items={[{ key: 'void', label: 'Void', danger: true, hidden: r.source === 'SYSTEM' || r.status === 'VOID', permission: ['payroll.process', 'payroll.create'], onClick: () => voidIt(r) }]} /> },
      ] as ColumnsType<any>} locale={{ emptyText: <EmptyState title="No payroll inputs yet." description="Sync approved overtime, unpaid leave and performance incentives." /> }} />
    </div>
  );
}

function InputsTable({ rows }: any) {
  return <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 10 }} columns={[
    { title: 'Code', dataIndex: 'code', width: 170 }, { title: 'Category', dataIndex: 'category', width: 130, render: (v) => (v || '').replace(/_/g, ' ') },
    { title: 'Description', dataIndex: 'description' }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v) => money(v) },
    { title: 'Source', width: 130, render: (_v, r) => r.sourceType || r.source }, { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusPill status={v} /> },
  ] as ColumnsType<any>} locale={{ emptyText: <EmptyState title="No inputs for this period." /> }} />;
}

function Payments({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['/hr/payroll-runs'], queryFn: () => api('/hr/payroll-runs') });
  async function pay(r: any) {
    try { const ref = window.prompt('Payment reference (optional)') || undefined; await api(`/hr/payroll-runs/${r.id}/payment`, { method: 'POST', body: JSON.stringify({ method: 'BANK', reference: ref }) }); message.success('Payment recorded'); qc.invalidateQueries({ queryKey: ['/hr/payroll-runs'] }); }
    catch (e: any) { message.error(e.message); }
  }
  return <Table rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 12 }} columns={[
    { title: 'Payroll Period', render: (_v, r) => `${monthName(r.period)} ${r.year}` },
    { title: 'Pay Date', dataIndex: 'payDate', render: (v) => fmtDate(v) },
    { title: 'Employees', dataIndex: 'employeeCount', align: 'right' },
    { title: 'Amount', dataIndex: 'totalNet', align: 'right', render: (v, r) => money(v, r.currency) },
    { title: 'Method', render: () => 'Bank transfer' },
    { title: 'Status', dataIndex: 'paymentStatus', width: 140, render: (v) => <StatusPill status={v} /> },
    { title: 'Actions', width: 190, render: (_v, r) => <Space size={4}><Button size="small" onClick={() => onOpen(r.id)}>View</Button>{r.paymentStatus !== 'PAID' && ['PROCESSED', 'LOCKED', 'FINALISED'].includes(r.status) && <Can permission="payroll.process"><Button size="small" type="primary" onClick={() => pay(r)}>Record Payment</Button></Can>}</Space> },
  ] as ColumnsType<any>} locale={{ emptyText: <EmptyState title="No payments recorded." /> }} />;
}

const AUTHORITIES = ['ZIMRA', 'NSSA', 'NEC', 'Pension Authority', 'Medical Aid', 'Other'];
const RULE_TYPES = ['INCOME_TAX', 'SOCIAL_SECURITY', 'PENSION', 'MEDICAL', 'LEVY', 'INSURANCE', 'OTHER_DEDUCTION', 'EMPLOYER_CONTRIBUTION'];
const METHODS = ['PERCENTAGE', 'FIXED', 'PROGRESSIVE', 'THRESHOLD_PERCENTAGE', 'FORMULA'];
const BASES = ['GROSS', 'BASIC', 'TAXABLE', 'PENSIONABLE', 'CUSTOM'];
const ROUNDING = ['NEAREST_CENT', 'NEAREST_UNIT', 'CURRENCY_PRECISION', 'CUSTOM'];
const FREQ = ['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'ANNUAL'];
const lbl = (s: string) => (s || '').replace(/_/g, ' ');

export function StatutoryRulesManager() {
  const qc = useQueryClient();
  const [f, setF] = useState<any>({});
  const [drawer, setDrawer] = useState<{ mode: 'CREATE' | 'EDIT' | 'VIEW'; rule?: any } | null>(null);
  const [usageId, setUsageId] = useState<string | null>(null);
  const [versionRule, setVersionRule] = useState<any>(null);
  const params = new URLSearchParams();
  if (f.search) params.set('search', f.search);
  if (f.authority) params.set('authority', f.authority);
  if (f.ruleType) params.set('ruleType', f.ruleType);
  if (f.status) params.set('status', f.status);
  const qs = params.toString();
  const rules = useQuery({ queryKey: ['/hr/payroll-settings/statutory-rules', qs], queryFn: () => api(`/hr/payroll-settings/statutory-rules${qs ? `?${qs}` : ''}`), placeholderData: keepPreviousData });
  const refresh = () => qc.invalidateQueries({ queryKey: ['/hr/payroll-settings/statutory-rules'] });
  async function act(r: any, action: string) {
    try {
      if (action === 'activate') await api(`/hr/payroll-settings/statutory-rules/${r.id}/activate`, { method: 'POST', body: '{}' });
      else if (action === 'deactivate') { const reason = window.prompt('Reason for deactivation?'); if (!reason) return; const end = window.prompt('Effective end date (YYYY-MM-DD, optional)') || undefined; await api(`/hr/payroll-settings/statutory-rules/${r.id}/deactivate`, { method: 'POST', body: JSON.stringify({ reason, effectiveEndDate: end }) }); }
      message.success('Statutory rule updated'); refresh();
    } catch (e: any) { message.error(e.message); }
  }
  const cols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 100, render: (v, r) => <a className="font-medium text-[#1d5fb5]" onClick={() => setDrawer({ mode: 'VIEW', rule: r })}>{v}</a> },
    { title: 'Name', dataIndex: 'name', render: (v, r) => <a onClick={() => setDrawer({ mode: 'VIEW', rule: r })}>{v}</a> },
    { title: 'Authority', dataIndex: 'authority', width: 120 },
    { title: 'Type', dataIndex: 'ruleType', width: 150, render: (v) => lbl(v) },
    { title: 'Valid From', dataIndex: 'validFrom', width: 120, render: (v) => fmtDate(v) },
    { title: 'Valid To', dataIndex: 'validTo', width: 120, render: (v) => v ? fmtDate(v) : '—' },
    { title: 'Version', dataIndex: 'version', width: 80, align: 'center', render: (v) => `v${v}` },
    { title: 'Status', dataIndex: 'computedStatus', width: 120, render: (v) => <StatusPill status={v} /> },
    { ...ACTIONS_COL, width: 90, render: (_v, r) => <Space size={2}><Button size="small" onClick={() => setDrawer({ mode: 'VIEW', rule: r })}>View</Button><RowActionsMenu items={[
      { key: 'edit', label: 'Edit', permission: ['payroll.settings.statutory.manage', 'payroll.process'], onClick: () => setDrawer({ mode: 'EDIT', rule: r }) },
      { key: 'ver', label: 'Create New Version', permission: ['payroll.settings.statutory.manage', 'payroll.process'], onClick: () => setVersionRule(r) },
      { key: 'act', label: 'Activate', hidden: !['DRAFT', 'INACTIVE', 'SCHEDULED'].includes(r.computedStatus), permission: ['payroll.settings.statutory.manage', 'payroll.process'], onClick: () => act(r, 'activate') },
      { key: 'deact', label: 'Deactivate', hidden: r.computedStatus !== 'ACTIVE', danger: true, permission: ['payroll.settings.statutory.manage', 'payroll.process'], onClick: () => act(r, 'deactivate') },
      { key: 'usage', label: 'View Usage', onClick: () => setUsageId(r.id) },
    ]} /></Space> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input allowClear placeholder="Search code / name..." style={{ width: 200 }} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <Select allowClear placeholder="Authority" style={{ width: 150 }} value={f.authority} onChange={(v) => setF({ ...f, authority: v })} options={AUTHORITIES.map((a) => ({ label: a, value: a }))} />
        <Select allowClear placeholder="Rule type" style={{ width: 180 }} value={f.ruleType} onChange={(v) => setF({ ...f, ruleType: v })} options={RULE_TYPES.map((t) => ({ label: lbl(t), value: t }))} />
        <Select allowClear placeholder="Status" style={{ width: 130 }} value={f.status} onChange={(v) => setF({ ...f, status: v })} options={['DRAFT', 'ACTIVE', 'SCHEDULED', 'EXPIRED', 'INACTIVE'].map((s) => ({ label: s, value: s }))} />
        <div className="ml-auto"><Can permission={['payroll.settings.statutory.manage', 'payroll.process']}><Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ mode: 'CREATE' })}>Statutory Rule</Button></Can></div>
      </div>
      <Table rowKey="id" size="small" loading={rules.isLoading} dataSource={rules.data || []} columns={cols} pagination={{ pageSize: 12 }} scroll={{ x: 1100 }} locale={{ emptyText: <EmptyState title="No statutory rules configured." /> }} />
      {drawer && <StatutoryRuleDrawer mode={drawer.mode} rule={drawer.rule} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); refresh(); }} />}
      {usageId && <UsageDrawer id={usageId} onClose={() => setUsageId(null)} />}
      {versionRule && <NewVersionDrawer rule={versionRule} onClose={() => setVersionRule(null)} onSaved={() => { setVersionRule(null); refresh(); }} />}
    </div>
  );
}

function Settings() {
  const qc = useQueryClient();
  const companyProfile = useQuery({ queryKey: ['/hr/payroll-settings/company'], queryFn: () => api('/hr/payroll-settings/company'), placeholderData: keepPreviousData });
  const [cp, setCp] = useState<any>({ payrollCountry: 'ZW', payrollCurrency: 'USD' });
  const [savingCp, setSavingCp] = useState(false);
  React.useEffect(() => { if (companyProfile.data) setCp({ payrollCountry: companyProfile.data.payrollCountry, payrollCurrency: companyProfile.data.payrollCurrency }); }, [companyProfile.data]);
  async function saveCompany() {
    setSavingCp(true);
    try { await api('/hr/payroll-settings/company', { method: 'PATCH', body: JSON.stringify(cp) }); message.success('Company payroll profile saved'); qc.invalidateQueries({ queryKey: ['/hr/payroll-settings/company'] }); }
    catch (e: any) { message.error(e.message); } finally { setSavingCp(false); }
  }
  return (
    <div className="space-y-4">
      <div className="nex-card border rounded-lg p-4">
        <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Company payroll profile</div>
        <div className="flex flex-wrap items-end gap-3">
          <div><div className="text-[12px] text-[#64748b] mb-1">Payroll country / jurisdiction</div>
            <Select style={{ width: 200 }} value={cp.payrollCountry} onChange={(v) => setCp({ ...cp, payrollCountry: v })} options={['ZW', 'ZA', 'ZM', 'MW', 'BW', 'US', 'GB'].map((c) => ({ label: c, value: c }))} /></div>
          <div><div className="text-[12px] text-[#64748b] mb-1">Payroll currency</div>
            <Select style={{ width: 160 }} value={cp.payrollCurrency} onChange={(v) => setCp({ ...cp, payrollCurrency: v })} options={['USD', 'ZAR', 'GBP', 'EUR', 'ZMW', 'BWP'].map((c) => ({ label: c, value: c }))} /></div>
          <Can permission={['payroll.settings.statutory.manage', 'payroll.process']}><Button type="primary" loading={savingCp} onClick={saveCompany}>Save</Button></Can>
        </div>
        <div className="text-[12px] text-[#94a3b8] mt-2">Statutory rules are resolved by this country; each employee's exemptions are applied on top.</div>
      </div>
      <StatutoryRulesManager />
    </div>
  );
}

function StatutoryRuleDrawer({ mode, rule, onClose, onSaved }: { mode: 'CREATE' | 'EDIT' | 'VIEW'; rule?: any; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(mode !== 'VIEW');
  const [tab, setTab] = useState('details');
  const detail = useQuery({ queryKey: ['/hr/payroll-settings/statutory-rules', rule?.id], queryFn: () => api(`/hr/payroll-settings/statutory-rules/${rule?.id}`), enabled: !!rule?.id });
  const meta = useQuery({ queryKey: ['/companies/meta'], queryFn: () => api('/companies/meta') });
  const accounts = meta.data?.accounts || [];
  const r = detail.data?.rule || rule;
  const method = Form.useWatch('calculationMethod', form);

  React.useEffect(() => {
    if (!editMode) return;
    if (r) form.setFieldsValue({ ...r, validFrom: r.validFrom ? dayjs(r.validFrom) : undefined, validTo: r.validTo ? dayjs(r.validTo) : undefined, bands: r.bands || [] });
  }, [r, editMode]);

  async function submit() {
    const v = await form.validateFields();
    if (v.validTo && v.validFrom && !v.validTo.isAfter(v.validFrom)) { message.error('Effective To must be on or after Effective From'); return; }
    if (v.calculationMethod === 'PROGRESSIVE') {
      const bands = (v.bands || []).filter((b: any) => b && (b.rate != null || b.from != null));
      if (!bands.length) { message.error('At least one tax band is required for a progressive rule'); return; }
      const sorted = [...bands].sort((a: any, b: any) => Number(a.from || 0) - Number(b.from || 0));
      for (let i = 0; i < sorted.length; i++) {
        const b: any = sorted[i];
        if (b.from == null) { message.error('Each tax band requires a From value'); return; }
        if (b.rate == null || Number(b.rate) < 0 || Number(b.rate) > 1) { message.error('Band rate must be between 0 and 1 (e.g. 0.2 = 20%)'); return; }
        if (b.to != null && Number(b.to) <= Number(b.from)) { message.error('Band "To" must be greater than "From"'); return; }
        if (i > 0 && Number(b.from) < Number(sorted[i - 1].to ?? Infinity)) { message.error('Tax bands cannot overlap'); return; }
      }
    }
    if (v.employeeEnabled && v.employerEnabled && v.employeeMax != null && v.employeeMin != null && Number(v.employeeMax) < Number(v.employeeMin)) { message.error('Maximum contribution must be greater than the minimum'); return; }
    setSaving(true);
    const body = { ...v, validFrom: v.validFrom?.format('YYYY-MM-DD'), validTo: v.validTo ? v.validTo.format('YYYY-MM-DD') : null };
    try {
      if (rule?.id && mode === 'EDIT') await api(`/hr/payroll-settings/statutory-rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/hr/payroll-settings/statutory-rules', { method: 'POST', body: JSON.stringify(body) });
      message.success('Statutory rule saved'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  async function act(action: 'activate' | 'deactivate') {
    try {
      if (action === 'activate') await api(`/hr/payroll-settings/statutory-rules/${rule.id}/activate`, { method: 'POST', body: '{}' });
      else { const reason = window.prompt('Reason?'); if (!reason) return; await api(`/hr/payroll-settings/statutory-rules/${rule.id}/deactivate`, { method: 'POST', body: JSON.stringify({ reason }) }); }
      message.success('Updated'); qc.invalidateQueries({ queryKey: ['/hr/payroll-settings/statutory-rules'] }); onSaved();
    } catch (e: any) { message.error(e.message); }
  }

  const acctOptions = accounts.map((a: any) => ({ label: `${a.code} · ${a.name}`, value: a.id }));

  return (
    <Drawer open onClose={onClose} width="min(860px, 96vw)" destroyOnHidden
      title={mode === 'CREATE' ? 'New Statutory Rule' : `${r?.code} · ${r?.name}`}
      extra={!editMode && <Space size="small">{r && <StatusPill status={r.computedStatus || r.status} />}<Can permission={['payroll.settings.statutory.manage', 'payroll.process']}><Button size="small" icon={<PlusOutlined />} onClick={() => setEditMode(true)}>Edit</Button></Can></Space>}
      footer={editMode ? <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save</Button></div> : null}>
      {editMode ? (
        <Form form={form} layout="vertical" initialValues={{ country: 'ZW', ruleType: 'INCOME_TAX', calculationMethod: 'PERCENTAGE', calculationBase: 'GROSS', currency: 'USD', roundingRule: 'NEAREST_CENT', payrollFrequency: 'MONTHLY', employeeEnabled: true, employerEnabled: false, status: 'DRAFT', active: true }}>
          <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Basic Information</div>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="code" label="Code" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="authority" label="Authority" rules={[{ required: true }]}><Select showSearch options={AUTHORITIES.map((a) => ({ label: a, value: a }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="ruleType" label="Rule Type" rules={[{ required: true }]}><Select options={RULE_TYPES.map((t) => ({ label: lbl(t), value: t }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="country" label="Country / Jurisdiction"><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>

          <div className="text-[13px] font-semibold text-[#171a2e] mb-2 mt-2">Effective Period</div>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="validFrom" label="Valid From" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item></Col>
            <Col span={12}><Form.Item name="validTo" label="Valid To (blank = no expiry)"><DatePicker className="w-full" /></Form.Item></Col>
          </Row>

          <div className="text-[13px] font-semibold text-[#171a2e] mb-2 mt-2">Calculation</div>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="calculationMethod" label="Method"><Select options={METHODS.map((m) => ({ label: lbl(m), value: m }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="calculationBase" label="Calculation Base"><Select options={BASES.map((b) => ({ label: lbl(b), value: b }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="payrollFrequency" label="Payroll Frequency"><Select options={FREQ.map((x) => ({ label: lbl(x), value: x }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="currency" label="Currency"><Select options={['USD', 'ZAR', 'GBP', 'EUR'].map((c) => ({ label: c, value: c }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="roundingRule" label="Rounding Rule"><Select options={ROUNDING.map((x) => ({ label: lbl(x), value: x }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="maxInsurableEarnings" label="Max Insurable Earnings"><InputNumber className="w-full" /></Form.Item></Col>
          </Row>

          <div className="text-[13px] font-semibold text-[#171a2e] mb-2 mt-2">Employee Contribution</div>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="employeeEnabled" label="Enabled" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="employeeRate" label="Rate (e.g. 0.05 = 5%)"><InputNumber min={0} step={0.0001} className="w-full" /></Form.Item></Col>
            <Col span={6}><Form.Item name="employeeMin" label="Minimum"><InputNumber min={0} className="w-full" /></Form.Item></Col>
            <Col span={6}><Form.Item name="employeeMax" label="Maximum"><InputNumber min={0} className="w-full" /></Form.Item></Col>
          </Row>

          <div className="text-[13px] font-semibold text-[#171a2e] mb-2 mt-2">Employer Contribution</div>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="employerEnabled" label="Enabled" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="employerRate" label="Rate"><InputNumber min={0} step={0.0001} className="w-full" /></Form.Item></Col>
            <Col span={6}><Form.Item name="employerMin" label="Minimum"><InputNumber min={0} className="w-full" /></Form.Item></Col>
            <Col span={6}><Form.Item name="employerMax" label="Maximum"><InputNumber min={0} className="w-full" /></Form.Item></Col>
          </Row>

          {method === 'PROGRESSIVE' && (
            <>
              <div className="text-[13px] font-semibold text-[#171a2e] mb-2 mt-2">Tax Bands</div>
              <Form.List name="bands">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Row gutter={8} key={key} className="mb-2">
                        <Col span={6}><Form.Item {...restField} name={[name, 'from']} label="From" className="!mb-0"><InputNumber className="w-full" /></Form.Item></Col>
                        <Col span={6}><Form.Item {...restField} name={[name, 'to']} label="To (blank = open)" className="!mb-0"><InputNumber className="w-full" /></Form.Item></Col>
                        <Col span={5}><Form.Item {...restField} name={[name, 'rate']} label="Rate (0–1)" className="!mb-0"><InputNumber className="w-full" min={0} max={1} step={0.01} /></Form.Item></Col>
                        <Col span={4}><Form.Item {...restField} name={[name, 'fixed']} label="Fixed amt" className="!mb-0"><InputNumber className="w-full" /></Form.Item></Col>
                        <Col span={3} className="flex items-end"><Button danger size="small" onClick={() => remove(name)}>Remove</Button></Col>
                      </Row>
                    ))}
                    <Button size="small" icon={<PlusOutlined />} onClick={() => add({ from: 0, to: null, rate: 0 })}>Add Tax Band</Button>
                  </>
                )}
              </Form.List>
            </>
          )}

          <div className="text-[13px] font-semibold text-[#171a2e] mb-2 mt-4">Accounting</div>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="employeeGlAccount" label="Employee Liability Account"><Select showSearch optionFilterProp="label" options={acctOptions} /></Form.Item></Col>
            <Col span={8}><Form.Item name="employerLiabilityGlAccount" label="Employer Liability Account"><Select showSearch optionFilterProp="label" options={acctOptions} /></Form.Item></Col>
            <Col span={8}><Form.Item name="employerExpenseGlAccount" label="Employer Expense Account"><Select showSearch optionFilterProp="label" options={acctOptions} /></Form.Item></Col>
          </Row>

          <div className="text-[13px] font-semibold text-[#171a2e] mb-2 mt-2">Status & Notes</div>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="status" label="Status"><Select options={['DRAFT', 'ACTIVE', 'SCHEDULED', 'INACTIVE'].map((s) => ({ label: s, value: s }))} /></Form.Item></Col>
            <Col span={16}><Form.Item name="notes" label="Notes"><Input /></Form.Item></Col>
          </Row>
        </Form>
      ) : (
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'details', label: 'Details', children: (
            <div className="space-y-3">
              <div className="nex-card border rounded-lg p-3">
                <DetailItem label="Code" value={r?.code} /><DetailItem label="Name" value={r?.name} /><DetailItem label="Authority" value={r?.authority} />
                <DetailItem label="Rule type" value={lbl(r?.ruleType)} /><DetailItem label="Version" value={`v${r?.version}`} /><DetailItem label="Status" value={r?.computedStatus} />
                <DetailItem label="Valid from" value={fmtDate(r?.validFrom)} /><DetailItem label="Valid to" value={r?.validTo ? fmtDate(r.validTo) : 'No expiry'} />
              </div>
              <div className="nex-card border rounded-lg p-3">
                <DetailItem label="Calculation method" value={lbl(r?.calculationMethod)} /><DetailItem label="Calculation base" value={lbl(r?.calculationBase)} />
                <DetailItem label="Employee rate" value={r?.employeeRate != null ? `${Number(r.employeeRate) * 100}%` : '—'} />
                <DetailItem label="Employer rate" value={r?.employerRate != null ? `${Number(r.employerRate) * 100}%` : '—'} />
                <DetailItem label="Max insurable earnings" value={r?.maxInsurableEarnings} /><DetailItem label="Currency" value={r?.currency} />
                <DetailItem label="Rounding" value={lbl(r?.roundingRule)} /><DetailItem label="Frequency" value={lbl(r?.payrollFrequency)} />
              </div>
              {(r?.bands || []).length > 0 && (
                <div className="nex-card border rounded-lg p-3">
                  <div className="text-[13px] font-semibold mb-2">Progressive bands</div>
                  <Table rowKey={(x: any, i: any) => `${i}`} size="small" pagination={false} dataSource={r.bands} columns={[
                    { title: 'From', dataIndex: 'from', align: 'right' }, { title: 'To', dataIndex: 'to', align: 'right', render: (v) => v ?? '∞' }, { title: 'Rate', dataIndex: 'rate', align: 'right', render: (v) => `${Number(v) * 100}%` },
                  ] as ColumnsType<any>} />
                </div>
              )}
              <div className="nex-card border rounded-lg p-3">
                <DetailItem label="Employee GL" value={r?.employeeGlAccount} /><DetailItem label="Employer liability GL" value={r?.employerLiabilityGlAccount} /><DetailItem label="Employer expense GL" value={r?.employerExpenseGlAccount} />
                <DetailItem label="Notes" value={r?.notes} />
              </div>
              <Space>
                {r && ['DRAFT', 'INACTIVE', 'SCHEDULED'].includes(r.computedStatus) && <Can permission={['payroll.settings.statutory.manage', 'payroll.process']}><Button size="small" type="primary" onClick={() => act('activate')}>Activate</Button></Can>}
                {r && r.computedStatus === 'ACTIVE' && <Can permission={['payroll.settings.statutory.manage', 'payroll.process']}><Button size="small" danger onClick={() => act('deactivate')}>Deactivate</Button></Can>}
              </Space>
            </div>
          ) },
          { key: 'audit', label: 'Audit', children: (detail.data?.audit || []).length ? (detail.data.audit.map((a: any, i: number) => <div key={i} className="flex justify-between py-2 border-b border-[#f0f1f6] last:border-0 text-[13px]"><span>{a.action.replace(/_/g, ' ')} · {a.user}{a.reason ? ` · ${a.reason}` : ''}</span><span className="text-[#94a3b8] text-[12px]">{fmtDateTime(a.at)}</span></div>)) : <EmptyState title="No audit history." /> },
        ]} />
      )}
    </Drawer>
  );
}

function NewVersionDrawer({ rule, onClose, onSaved }: { rule: any; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try { await api(`/hr/payroll-settings/statutory-rules/${rule.id}/new-version`, { method: 'POST', body: JSON.stringify({ ...v, validFrom: v.validFrom.format('YYYY-MM-DD'), validTo: v.validTo ? v.validTo.format('YYYY-MM-DD') : null }) }); message.success('New version created'); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={480} title={`Create New Version — ${rule.code}`}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Create Version</Button></div>}>
      <div className="text-[13px] text-[#64748b] mb-3">The current version (v{rule.version}) will be closed the day before the new effective date. Historical payroll is unchanged.</div>
      <Form form={form} layout="vertical" initialValues={{ validFrom: dayjs(), employeeRate: rule.employeeRate, employerRate: rule.employerRate, maxInsurableEarnings: rule.maxInsurableEarnings }}>
        <Form.Item name="validFrom" label="New effective from" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
        <Form.Item name="validTo" label="Valid to (blank = no expiry)"><DatePicker className="w-full" /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="employeeRate" label="Employee rate"><InputNumber className="w-full" step={0.0001} /></Form.Item></Col>
          <Col span={12}><Form.Item name="employerRate" label="Employer rate"><InputNumber className="w-full" step={0.0001} /></Form.Item></Col>
        </Row>
        <Form.Item name="maxInsurableEarnings" label="Max insurable earnings"><InputNumber className="w-full" /></Form.Item>
      </Form>
    </Drawer>
  );
}

function UsageDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['/hr/payroll-settings/statutory-rules', id, 'usage'], queryFn: () => api(`/hr/payroll-settings/statutory-rules/${id}/usage`) });
  return (
    <Drawer open onClose={onClose} width={480} title={data ? `Usage — ${data.rule.code}` : 'Usage'}>
      {isLoading || !data ? <Skeleton active /> : (
        <div className="nex-card border rounded-lg p-4">
          <DetailItem label="Payroll runs" value={data.payrollRuns} />
          <DetailItem label="Last used" value={data.lastUsed ? `${monthName(data.lastUsed.period)} ${data.lastUsed.year}` : 'Never'} />
          <DetailItem label="Employees affected" value={data.employees} />
          <DetailItem label="Total employee deduction" value={money(data.totalEmployeeDeduction)} />
          <DetailItem label="Total employer contribution" value={money(data.totalEmployerContribution)} />
          <div className="text-[12px] text-[#94a3b8] mt-2">Historical payroll is never recalculated using the current rule.</div>
        </div>
      )}
    </Drawer>
  );
}


// ======================================================================
function ManualInputDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try { await api('/hr/payroll-inputs', { method: 'POST', body: JSON.stringify(v) }); message.success('Payroll input created'); qc.invalidateQueries({ queryKey: ['/hr/payroll-inputs'] }); onClose(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={520} title="Add Payroll Input"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ period: new Date().getMonth() + 1, year: new Date().getFullYear(), category: 'EARNING' }}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(employees.data || []).map((e: any) => ({ label: `${e.firstName} ${e.lastName} · ${e.employeeNo}`, value: e.id }))} /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="period" label="Period" rules={[{ required: true }]}><Select options={MONTHS.map((m, i) => ({ label: m, value: i + 1 }))} /></Form.Item></Col>
          <Col span={12}><Form.Item name="year" label="Year" rules={[{ required: true }]}><InputNumber min={2000} max={2100} className="w-full" /></Form.Item></Col>
        </Row>
        <Form.Item name="category" label="Input Type" rules={[{ required: true }]}><Select options={['EARNING', 'ALLOWANCE', 'BONUS', 'COMMISSION', 'OVERTIME', 'REIMBURSEMENT', 'DEDUCTION', 'LOAN', 'BENEFIT', 'ADJUSTMENT'].map((x) => ({ label: x.replace(/_/g, ' '), value: x }))} /></Form.Item>
        <Form.Item name="code" label="Earning / Deduction Code" rules={[{ required: true }]}><Input placeholder="e.g. ADJUSTMENT" /></Form.Item>
        <Form.Item name="amount" label="Amount (negative for deductions)" rules={[{ required: true }]}><InputNumber className="w-full" /></Form.Item>
        <Form.Item name="description" label="Description"><Input /></Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Drawer>
  );
}
