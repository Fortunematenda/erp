'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { App, Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill, DetailItem, EmptyState } from '@/components/sales-ui';
import { RowActionsMenu, ACTIONS_COL } from '@/components/row-actions-menu';
import { fmtMoney, fmtNumber } from '@/lib/format';

const PLAN_TYPES = ['MEDICAL', 'PENSION', 'HOUSING', 'TRANSPORT', 'LOAN', 'OTHER'];
const lbl = (s: string) => (s || '').replace(/_/g, ' ');

export default function LeaveBenefitsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ['/hr/leave-types'], queryFn: () => api('/hr/leave-types'), placeholderData: keepPreviousData });
  const balances = useQuery({ queryKey: ['/hr/leave-balances'], queryFn: () => api('/hr/leave-balances'), placeholderData: keepPreviousData });
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees'), placeholderData: keepPreviousData });
  const plans = useQuery({ queryKey: ['/hr/benefit-plans'], queryFn: () => api('/hr/benefit-plans'), placeholderData: keepPreviousData });
  const eb = useQuery({ queryKey: ['/hr/employee-benefits'], queryFn: () => api('/hr/employee-benefits'), placeholderData: keepPreviousData });
  const [ltDrawer, setLtDrawer] = useState<{ mode: 'CREATE' | 'VIEW' | 'EDIT'; row?: any } | null>(null);
  const [planDrawer, setPlanDrawer] = useState<{ mode: 'CREATE' | 'VIEW' | 'EDIT'; row?: any } | null>(null);
  const [ebDrawer, setEbDrawer] = useState<{ mode: 'CREATE' | 'VIEW' | 'EDIT'; row?: any } | null>(null);
  const [balDrawer, setBalDrawer] = useState<{ row?: any; mode: 'SET' | 'ACCRUE' } | null>(null);

  const refresh = () => ['/hr/leave-types', '/hr/leave-balances', '/hr/benefit-plans', '/hr/employee-benefits'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const typeCols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 110, render: (v, r) => <a className="font-mono text-[12px] font-semibold text-[#003366]" onClick={() => setLtDrawer({ mode: 'VIEW', row: r })}>{v}</a> },
    { title: 'Name', dataIndex: 'name' },
    { title: 'Days / Year', dataIndex: 'daysPerYear', width: 110, align: 'right' },
    { title: 'Accrual / Month', width: 130, align: 'right', render: (_v, r) => fmtNumber(r.policy?.accrualPerMonth || 0, 1) },
    { title: 'Max Carryover', width: 130, align: 'right', render: (_v, r) => fmtNumber(r.policy?.maxCarryOver || 0, 1) },
    { title: 'Status', dataIndex: 'active', width: 110, render: (v) => <StatusPill status={v ? 'ACTIVE' : 'INACTIVE'} /> },
    { ...ACTIONS_COL, render: (_v, r) => <RowActionsMenu items={[
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setLtDrawer({ mode: 'VIEW', row: r }) },
      { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: 'hr.employees.manage', onClick: () => setLtDrawer({ mode: 'EDIT', row: r }) },
    ]} /> },
  ];
  const balCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => <span className="text-[13px] text-[#171a2e]">{r.employee?.firstName} {r.employee?.lastName}</span> },
    { title: 'Leave Type', render: (_v, r) => <span className="text-[12px] text-[#64748b]">{r.leaveType?.name}</span> },
    { title: 'Balance', dataIndex: 'balance', width: 120, align: 'right', render: (v) => <span className="text-[13px] font-semibold text-[#003366]">{fmtNumber(v, 1)} days</span> },
    { ...ACTIONS_COL, render: (_v, r) => <RowActionsMenu items={[
      { key: 'set', label: 'Set balance', icon: <EditOutlined />, permission: 'hr.employees.manage', onClick: () => setBalDrawer({ row: r, mode: 'SET' }) },
      { key: 'accrue', label: 'Accrue', icon: <PlusOutlined />, permission: 'hr.employees.manage', onClick: () => setBalDrawer({ row: r, mode: 'ACCRUE' }) },
    ]} /> },
  ];
  const planCols: ColumnsType<any> = [
    { title: 'Plan', dataIndex: 'name', render: (v, r) => <a className="text-[13px] font-medium text-[#171a2e]" onClick={() => setPlanDrawer({ mode: 'VIEW', row: r })}>{v}</a> },
    { title: 'Type', dataIndex: 'type', width: 120, render: (v) => <Tag>{lbl(v)}</Tag> },
    { title: 'Taxable', dataIndex: 'taxable', width: 100, render: (v) => (v ? <Tag color="orange">Taxable</Tag> : <Tag>Non-taxable</Tag>) },
    { title: 'Employer Contribution', dataIndex: 'employerContribution', width: 170, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Status', dataIndex: 'active', width: 110, render: (v) => <StatusPill status={v ? 'ACTIVE' : 'INACTIVE'} /> },
    { ...ACTIONS_COL, render: (_v, r) => <RowActionsMenu items={[
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setPlanDrawer({ mode: 'VIEW', row: r }) },
      { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: 'hr.employees.manage', onClick: () => setPlanDrawer({ mode: 'EDIT', row: r }) },
    ]} /> },
  ];
  const ebCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => <span className="text-[13px] text-[#171a2e]">{r.employee?.firstName} {r.employee?.lastName}</span> },
    { title: 'Plan', render: (_v, r) => <span className="text-[12px] text-[#64748b]">{r.plan?.name}</span> },
    { title: 'Amount', dataIndex: 'amount', width: 130, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Status', dataIndex: 'active', width: 110, render: (v) => <StatusPill status={v ? 'ACTIVE' : 'INACTIVE'} /> },
    { ...ACTIONS_COL, render: (_v, r) => <RowActionsMenu items={[
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setEbDrawer({ mode: 'VIEW', row: r }) },
      { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: 'hr.employees.manage', onClick: () => setEbDrawer({ mode: 'EDIT', row: r }) },
    ]} /> },
  ];

  const totalBalance = (balances.data || []).reduce((s: number, b: any) => s + Number(b.balance || 0), 0);

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Leave & Benefits</h1><p className="text-[13px] text-[#64748b] mt-1">Leave types, employee entitlements and benefit plans</p></div>
        <Can permission="hr.employees.manage"><Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button></Can>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <MiniCard label="Leave Types" value={(types.data || []).length} hint="Configured" />
        <MiniCard label="Total Leave Balance" value={`${fmtNumber(totalBalance, 1)} d`} hint={`${(balances.data || []).length} balance record(s)`} />
        <MiniCard label="Benefit Plans" value={(plans.data || []).length} hint="Available plans" />
        <MiniCard label="Assigned Benefits" value={(eb.data || []).length} hint="Employee benefits" />
      </div>

      <Tabs defaultActiveKey="types" items={[
        { key: 'types', label: `Leave Types (${types.data?.length || 0})`, children: (
          <div className="nex-card">
            <div className="flex justify-end px-4 pt-3"><Can permission="hr.employees.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => setLtDrawer({ mode: 'CREATE' })}>Add Leave Type</Button></Can></div>
            <Table rowKey="id" loading={types.isLoading} dataSource={types.data || []} columns={typeCols} pagination={false} locale={{ emptyText: <EmptyState title="No leave types configured." /> }} />
          </div>
        ) },
        { key: 'balances', label: `Leave Balances (${balances.data?.length || 0})`, children: (
          <div className="nex-card">
            <div className="flex justify-end px-4 pt-3"><Can permission="hr.employees.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => setBalDrawer({ mode: 'SET' })}>Set Balance</Button></Can></div>
            <Table rowKey="id" loading={balances.isLoading} dataSource={balances.data || []} columns={balCols} pagination={false} locale={{ emptyText: <EmptyState title="No leave balances recorded." /> }} />
          </div>
        ) },
        { key: 'plans', label: `Benefit Plans (${plans.data?.length || 0})`, children: (
          <div className="nex-card">
            <div className="flex justify-end px-4 pt-3"><Can permission="hr.employees.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => setPlanDrawer({ mode: 'CREATE' })}>Add Plan</Button></Can></div>
            <Table rowKey="id" loading={plans.isLoading} dataSource={plans.data || []} columns={planCols} pagination={false} locale={{ emptyText: <EmptyState title="No benefit plans configured." /> }} />
          </div>
        ) },
        { key: 'benefits', label: `Employee Benefits (${eb.data?.length || 0})`, children: (
          <div className="nex-card">
            <div className="flex justify-end px-4 pt-3"><Can permission="hr.employees.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => setEbDrawer({ mode: 'CREATE' })}>Assign Benefit</Button></Can></div>
            <Table rowKey="id" loading={eb.isLoading} dataSource={eb.data || []} columns={ebCols} pagination={false} locale={{ emptyText: <EmptyState title="No employee benefits assigned." /> }} />
          </div>
        ) },
      ]} />

      {ltDrawer?.mode && <LeaveTypeDrawer mode={ltDrawer.mode} row={ltDrawer.row} onClose={() => setLtDrawer(null)} onSaved={() => { setLtDrawer(null); refresh(); }} />}
      {planDrawer?.mode && <BenefitPlanDrawer mode={planDrawer.mode} row={planDrawer.row} onClose={() => setPlanDrawer(null)} onSaved={() => { setPlanDrawer(null); refresh(); }} />}
      {ebDrawer?.mode && <EmployeeBenefitDrawer mode={ebDrawer.mode} row={ebDrawer.row} employees={employees.data || []} plans={plans.data || []} onClose={() => setEbDrawer(null)} onSaved={() => { setEbDrawer(null); refresh(); }} />}
      {balDrawer && <BalanceDrawer row={balDrawer.row} mode={balDrawer.mode} employees={employees.data || []} types={types.data || []} onClose={() => setBalDrawer(null)} onSaved={() => { setBalDrawer(null); refresh(); }} />}
    </div>
  );
}

function MiniCard({ label, value, hint }: { label: string; value: any; hint?: string }) {
  return <div className="nex-card p-4"><div className="text-[12px] font-semibold text-[#64748b]">{label}</div><div className="text-[20px] font-bold text-[#171a2e]">{value}</div>{hint && <div className="text-[11px] text-[#94a3b8]">{hint}</div>}</div>;
}

function LeaveTypeDrawer({ mode, row, onClose, onSaved }: { mode: 'CREATE' | 'VIEW' | 'EDIT'; row?: any; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(mode !== 'VIEW');
  useEffect(() => { if (row) form.setFieldsValue({ code: row.code, name: row.name, daysPerYear: row.daysPerYear, active: row.active, accrualPerMonth: Number(row.policy?.accrualPerMonth || 0), maxCarryOver: Number(row.policy?.maxCarryOver || 0) }); }, [row]);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    const body = { code: v.code, name: v.name, daysPerYear: Number(v.daysPerYear || 0), active: v.active ?? true, policy: { accrualPerMonth: Number(v.accrualPerMonth || 0), maxCarryOver: Number(v.maxCarryOver || 0) } };
    try {
      if (mode === 'EDIT' && row?.id) await api(`/hr/leave-types/${row.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/hr/leave-types', { method: 'POST', body: JSON.stringify(body) });
      message.success('Leave type saved'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={520} destroyOnHidden title={mode === 'CREATE' ? 'Add Leave Type' : `${row?.name || ''}`}
      extra={!editMode && <Can permission="hr.employees.manage"><Button size="small" icon={<EditOutlined />} onClick={() => setEditMode(true)}>Edit</Button></Can>}
      footer={editMode ? <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save</Button></div> : null}>
      {editMode ? (
        <Form form={form} layout="vertical" initialValues={{ daysPerYear: 20, accrualPerMonth: 0, maxCarryOver: 0, active: true }}>
          <Row gutter={12}>
            <Col span={10}><Form.Item name="code" label="Code" rules={[{ required: true }]}><Input placeholder="ANNUAL" /></Form.Item></Col>
            <Col span={14}><Form.Item name="name" label="Name" rules={[{ required: true }]}><Input placeholder="Annual Leave" /></Form.Item></Col>
          </Row>
          <Form.Item name="daysPerYear" label="Days per year"><InputNumber min={0} className="w-full" /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="accrualPerMonth" label="Accrual per month"><InputNumber min={0} className="w-full" /></Form.Item></Col>
            <Col span={12}><Form.Item name="maxCarryOver" label="Max carryover"><InputNumber min={0} className="w-full" /></Form.Item></Col>
          </Row>
          <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      ) : (
        <div className="nex-card border rounded-lg p-3">
          <DetailItem label="Code" value={row?.code} />
          <DetailItem label="Name" value={row?.name} />
          <DetailItem label="Days per year" value={row?.daysPerYear} />
          <DetailItem label="Accrual per month" value={fmtNumber(row?.policy?.accrualPerMonth || 0, 1)} />
          <DetailItem label="Max carryover" value={fmtNumber(row?.policy?.maxCarryOver || 0, 1)} />
          <DetailItem label="Status" value={row?.active ? 'Active' : 'Inactive'} />
        </div>
      )}
    </Drawer>
  );
}

function BenefitPlanDrawer({ mode, row, onClose, onSaved }: { mode: 'CREATE' | 'VIEW' | 'EDIT'; row?: any; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(mode !== 'VIEW');
  useEffect(() => { if (row) form.setFieldsValue({ name: row.name, type: row.type, taxable: !!row.taxable, employerContribution: Number(row.employerContribution || 0), active: row.active }); }, [row]);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try {
      if (mode === 'EDIT' && row?.id) await api(`/hr/benefit-plans/${row.id}`, { method: 'PATCH', body: JSON.stringify(v) });
      else await api('/hr/benefit-plans', { method: 'POST', body: JSON.stringify(v) });
      message.success('Benefit plan saved'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={480} destroyOnHidden title={mode === 'CREATE' ? 'Add Benefit Plan' : `${row?.name || ''}`}
      extra={!editMode && <Can permission="hr.employees.manage"><Button size="small" icon={<EditOutlined />} onClick={() => setEditMode(true)}>Edit</Button></Can>}
      footer={editMode ? <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save</Button></div> : null}>
      {editMode ? (
        <Form form={form} layout="vertical" initialValues={{ type: 'MEDICAL', taxable: false, employerContribution: 0, active: true }}>
          <Form.Item name="name" label="Plan name" rules={[{ required: true }]}><Input placeholder="Medical Aid" /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="type" label="Type"><Select options={PLAN_TYPES.map((t) => ({ label: lbl(t), value: t }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="employerContribution" label="Employer contribution"><InputNumber min={0} prefix="$" className="w-full" /></Form.Item></Col>
          </Row>
          <Form.Item name="taxable" label="Taxable" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      ) : (
        <div className="nex-card border rounded-lg p-3">
          <DetailItem label="Name" value={row?.name} />
          <DetailItem label="Type" value={lbl(row?.type)} />
          <DetailItem label="Taxable" value={row?.taxable ? 'Yes' : 'No'} />
          <DetailItem label="Employer contribution" value={fmtMoney(row?.employerContribution)} />
          <DetailItem label="Status" value={row?.active ? 'Active' : 'Inactive'} />
        </div>
      )}
    </Drawer>
  );
}

function EmployeeBenefitDrawer({ mode, row, employees, plans, onClose, onSaved }: { mode: 'CREATE' | 'VIEW' | 'EDIT'; row?: any; employees: any[]; plans: any[]; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(mode !== 'VIEW');
  useEffect(() => { if (row) form.setFieldsValue({ employeeId: row.employeeId, planId: row.planId, amount: Number(row.amount || 0), active: row.active }); }, [row]);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try {
      if (mode === 'EDIT' && row?.id) await api(`/hr/employee-benefits/${row.id}`, { method: 'PATCH', body: JSON.stringify(v) });
      else await api('/hr/employee-benefits', { method: 'POST', body: JSON.stringify(v) });
      message.success('Benefit saved'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={480} destroyOnHidden title={mode === 'CREATE' ? 'Assign Benefit' : 'Employee Benefit'}
      extra={!editMode && <Can permission="hr.employees.manage"><Button size="small" icon={<EditOutlined />} onClick={() => setEditMode(true)}>Edit</Button></Can>}
      footer={editMode ? <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save</Button></div> : null}>
      {editMode ? (
        <Form form={form} layout="vertical" initialValues={{ amount: 0, active: true }}>
          <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" disabled={mode === 'EDIT'} options={employees.map((e: any) => ({ label: `${e.firstName} ${e.lastName} (${e.employeeNo})`, value: e.id }))} /></Form.Item>
          <Form.Item name="planId" label="Plan" rules={[{ required: true }]}><Select options={plans.map((p: any) => ({ label: p.name, value: p.id }))} /></Form.Item>
          <Form.Item name="amount" label="Amount"><InputNumber min={0} prefix="$" className="w-full" /></Form.Item>
          <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      ) : (
        <div className="nex-card border rounded-lg p-3">
          <DetailItem label="Employee" value={`${row?.employee?.firstName || ''} ${row?.employee?.lastName || ''}`} />
          <DetailItem label="Plan" value={row?.plan?.name} />
          <DetailItem label="Amount" value={fmtMoney(row?.amount)} />
          <DetailItem label="Status" value={row?.active ? 'Active' : 'Inactive'} />
        </div>
      )}
    </Drawer>
  );
}

function BalanceDrawer({ row, mode, employees, types, onClose, onSaved }: { row?: any; mode: 'SET' | 'ACCRUE'; employees: any[]; types: any[]; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try {
      if (mode === 'ACCRUE') await api('/hr/leave-balances/accrue', { method: 'POST', body: JSON.stringify({ employeeId: v.employeeId, leaveTypeId: v.leaveTypeId, days: Number(v.value || 0) }) });
      else await api('/hr/leave-balances', { method: 'POST', body: JSON.stringify({ employeeId: v.employeeId, leaveTypeId: v.leaveTypeId, balance: Number(v.value || 0) }) });
      message.success('Leave balance updated'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={460} destroyOnHidden title={mode === 'ACCRUE' ? 'Accrue Leave' : 'Set Leave Balance'}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>{mode === 'ACCRUE' ? 'Accrue' : 'Set balance'}</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ employeeId: row?.employeeId, leaveTypeId: row?.leaveTypeId, value: mode === 'ACCRUE' ? 1 : Number(row?.balance || 0) }}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" disabled={!!row} options={employees.map((e: any) => ({ label: `${e.firstName} ${e.lastName} (${e.employeeNo})`, value: e.id }))} /></Form.Item>
        <Form.Item name="leaveTypeId" label="Leave type" rules={[{ required: true }]}><Select disabled={!!row} options={types.map((t: any) => ({ label: t.name, value: t.id }))} /></Form.Item>
        <Form.Item name="value" label={mode === 'ACCRUE' ? 'Days to add' : 'New balance (days)'} rules={[{ required: true }]}><InputNumber className="w-full" /></Form.Item>
      </Form>
    </Drawer>
  );
}
