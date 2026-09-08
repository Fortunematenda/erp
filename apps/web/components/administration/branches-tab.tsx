'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Modal, Select, Table, Tabs, Tag, Tooltip, message, Alert, Space, Statistic } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ApartmentOutlined, BankOutlined, CarOutlined, EyeOutlined, GlobalOutlined, PlusOutlined, ReloadOutlined, StopOutlined, TeamOutlined, WarningOutlined, HddOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { RoleBadge, UserStatusBadge } from './shared';

export function BranchesTab() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['/admin/branches'], queryFn: () => api('/admin/branches') });
  const branches = list.data || [];
  const kpis = {
    active: branches.filter((b: any) => b.active).length,
    users: branches.reduce((n: number, b: any) => n + (b.users || 0), 0),
    fiscal: branches.reduce((n: number, b: any) => n + (b.fiscalDevices || 0), 0),
    warehouses: branches.reduce((n: number, b: any) => n + (b.warehouses || 0), 0),
  };

  const columns: ColumnsType<any> = [
    { title: 'Branch', dataIndex: 'name', width: 190, render: (v: any, r: any) => (
      <div className="flex items-center gap-2">
        <div className="nex-stat-icon" style={{ width: 30, height: 30, background: '#eff6ff' }}><ApartmentOutlined style={{ color: '#1d4ed8', fontSize: 14 }} /></div>
        <div><div className="text-[13px] font-semibold text-slate-800">{v}</div><div className="text-[11px] text-slate-400">{r.code}</div></div>
      </div>
    ) },
    { title: 'Code', dataIndex: 'code', width: 100, render: (v) => <span className="font-mono text-[12px] text-slate-500">{v}</span> },
    { title: 'Location', dataIndex: 'location', width: 160, ellipsis: true, render: (v) => v || '—' },
    { title: 'Manager', dataIndex: 'manager', width: 130, render: (v) => v || '—' },
    { title: 'Users', dataIndex: 'users', width: 80, align: 'right' },
    { title: 'Warehouses', dataIndex: 'warehouses', width: 100, align: 'right' },
    { title: 'Fiscal Devices', dataIndex: 'fiscalDevices', width: 110, align: 'right' },
    { title: 'Status', dataIndex: 'active', width: 90, render: (v) => v
      ? <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: '#15803d', background: '#f0fdf4' }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: '#15803d' }} />Active</span>
      : <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: '#64748b', background: '#f1f5f9' }}>Inactive</span> },
    { ...ACTIONS_COL, render: (_: any, r: any) => (
      <RowActionsMenu items={[
        { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setDetailId(r.id) },
        { key: 'deactivate', label: 'Deactivate', icon: <StopOutlined />, danger: true, hidden: !r.active, onClick: () => deactivateBranch(r, qc) },
      ]} />
    ) },
  ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Card className="nex-card" styles={{ body: { padding: '14px 18px' } }}>
          <div className="flex items-center gap-3">
            <div className="nex-stat-icon" style={{ background: '#eff6ff', color: '#1d4ed8' }}><ApartmentOutlined /></div>
            <div><div className="text-[12px] text-slate-500">Active Branches</div><div className="text-[22px] font-bold text-slate-800">{kpis.active} <span className="text-[12px] font-normal text-slate-400">of {branches.length}</span></div></div>
          </div>
        </Card>
        <Card className="nex-card" styles={{ body: { padding: '14px 18px' } }}>
          <div className="flex items-center gap-3">
            <div className="nex-stat-icon" style={{ background: '#f0fdf4', color: '#15803d' }}><TeamOutlined /></div>
            <div><div className="text-[12px] text-slate-500">Users Assigned</div><div className="text-[22px] font-bold text-slate-800">{kpis.users}</div></div>
          </div>
        </Card>
        <Card className="nex-card" styles={{ body: { padding: '14px 18px' } }}>
          <div className="flex items-center gap-3">
            <div className="nex-stat-icon" style={{ background: '#fffbeb', color: '#d97706' }}><HddOutlined /></div>
            <div><div className="text-[12px] text-slate-500">Fiscal Devices</div><div className="text-[22px] font-bold text-slate-800">{kpis.fiscal}</div></div>
          </div>
        </Card>
        <Card className="nex-card" styles={{ body: { padding: '14px 18px' } }}>
          <div className="flex items-center gap-3">
            <div className="nex-stat-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}><BankOutlined /></div>
            <div><div className="text-[12px] text-slate-500">Warehouses</div><div className="text-[22px] font-bold text-slate-800">{kpis.warehouses}</div></div>
          </div>
        </Card>
      </div>
      <div className="nex-card mb-4 px-4 py-3 flex items-center gap-3">
        <div className="text-[12px] text-slate-400">Branches define where users operate. A normal user must have a primary branch; administrators can be company-wide.</div>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip title="Refresh"><Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/admin/branches'] })} /></Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add Branch</Button>
        </div>
      </div>
      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <Table rowKey="id" loading={list.isLoading} dataSource={branches} columns={columns} scroll={{ x: 1000 }} pagination={{ pageSize: 10, showSizeChanger: false }} />
      </Card>
      {addOpen && <BranchFormDrawer open={addOpen} onClose={() => setAddOpen(false)} onDone={() => qc.invalidateQueries({ queryKey: ['/admin/branches'] })} />}
      {detailId && <BranchDetailDrawer branchId={detailId} onClose={() => setDetailId(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['/admin/branches'] })} />}
    </>
  );
}

function deactivateBranch(record: any, qc: any) {
  Modal.confirm({
    title: `Deactivate ${record.name}?`,
    content: 'The branch will stop appearing in new transactions. Existing history is preserved.',
    okText: 'Deactivate Branch', okButtonProps: { danger: true },
    onOk: async () => {
      try { await api(`/admin/branches/${record.id}/status`, { method: 'POST', body: JSON.stringify({ active: false, reason: 'Branch deactivated by administrator' }) }); message.success('Branch deactivated'); qc.invalidateQueries({ queryKey: ['/admin/branches'] }); }
      catch (e: any) { message.error(e.message); throw e; }
    },
  });
}

function BranchFormDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const options = useQuery({ queryKey: ['/admin/users/options'], queryFn: () => api('/admin/users/options') });
  const managers = (options.data?.employees || []).filter((e: any) => e.hasUser);

  async function submit() {
    const values = await form.validateFields();
    try {
      setSaving(true);
      const manager = managers.find((m: any) => m.userId === values.managerUserId);
      await api('/admin/branches', { method: 'POST', body: JSON.stringify({ ...values, managerName: manager?.name || null }) });
      message.success('Branch created');
      qc.invalidateQueries({ queryKey: ['/admin/branches'] });
      onDone(); onClose();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Add Branch" width={720} destroyOnHidden
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Create Branch</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ defaultCurrency: 'USD', active: true }}>
        <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-1">Branch</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Form.Item label="Branch Name" name="name" rules={[{ required: true, message: 'Branch name is required' }]}><Input /></Form.Item>
          <Form.Item label="Branch Code" name="code" extra="Leave blank to auto-generate (BR-…)."><Input /></Form.Item>
          <Form.Item label="Manager (user)" name="managerUserId"><Select allowClear showSearch optionFilterProp="label" placeholder="Select a user…" options={managers.map((m: any) => ({ value: m.userId, label: `${m.name} · ${m.email || ''}` }))} /></Form.Item>
          <Form.Item label="Phone" name="phone"><Input /></Form.Item>
          <Form.Item label="Email" name="email"><Input /></Form.Item>
          <Form.Item label="Default Currency" name="defaultCurrency"><Select options={['USD', 'ZWL', 'ZAR', 'EUR', 'GBP'].map((c) => ({ value: c, label: c }))} /></Form.Item>
          <Form.Item label="Timezone" name="timezone"><Input placeholder="Africa/Harare" /></Form.Item>
        </div>
        <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-1 mt-2">Address</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Form.Item label="Street" name="street"><Input /></Form.Item>
          <Form.Item label="City" name="city"><Input /></Form.Item>
          <Form.Item label="Province / State" name="province"><Input /></Form.Item>
          <Form.Item label="Postal Code" name="postalCode"><Input /></Form.Item>
          <Form.Item label="Country" name="country"><Input /></Form.Item>
        </div>
        <Form.Item label="Status" name="active"><Select options={[{ value: true, label: 'Active' }, { value: false, label: 'Inactive' }]} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function BranchDetailDrawer({ branchId, onClose, onChanged }: { branchId: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/admin/branches', branchId], queryFn: () => api(`/admin/branches/${branchId}`) });
  const [editOpen, setEditOpen] = useState(false);
  const b = q.data;

  const tabs = [
    {
      key: 'overview', label: 'Overview',
      children: b && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[16px] font-semibold text-slate-800">{b.name}</div>
            <Tag color={b.active ? 'green' : 'default'}>{b.active ? 'Active' : 'Inactive'}</Tag>
            <Button size="small" className="ml-auto" onClick={() => setEditOpen(true)}>Edit Branch</Button>
          </div>
          <Descriptions column={2} size="small" labelStyle={{ width: 130 }} contentStyle={{ fontSize: 13 }}>
            <Descriptions.Item label="Code">{b.code}</Descriptions.Item>
            <Descriptions.Item label="Manager">{b.managerName || '—'}</Descriptions.Item>
            <Descriptions.Item label="Address">{[b.street, b.city, b.province, b.postalCode, b.country].filter(Boolean).join(', ') || '—'}</Descriptions.Item>
            <Descriptions.Item label="Phone">{b.phone || '—'}</Descriptions.Item>
            <Descriptions.Item label="Email">{b.email || '—'}</Descriptions.Item>
            <Descriptions.Item label="Default Currency">{b.defaultCurrency || 'USD'}</Descriptions.Item>
            <Descriptions.Item label="Timezone">{b.timezone || '—'}</Descriptions.Item>
            <Descriptions.Item label="Warehouses">{b.warehouses?.length || 0}</Descriptions.Item>
            <Descriptions.Item label="Fiscal Devices">{b.fiscalDevices?.length || 0}</Descriptions.Item>
            <Descriptions.Item label="Departments">{b.departments?.length || 0}</Descriptions.Item>
          </Descriptions>
        </div>
      ),
    },
    {
      key: 'users', label: `Users (${b?.users?.length || 0})`,
      children: b && (
        <Table
          rowKey="membershipId" size="small" pagination={false}
          dataSource={b.users || []}
          columns={[
            { title: 'User', render: (_: any, r: any) => <span className="text-[13px] font-medium">{r.name}</span> },
            { title: 'Role', dataIndex: 'role', render: (v: any) => <RoleBadge role={v} /> },
            { title: 'Primary / Additional', key: 'p', render: (_: any, r: any) => r.isPrimary ? <Tag color="blue">Primary</Tag> : <Tag>Additional</Tag> },
            { title: 'Status', dataIndex: 'status', render: (v: any) => <UserStatusBadge status={v} /> },
          ]}
        />
      ),
    },
    { key: 'warehouses', label: `Warehouses (${b?.warehouses?.length || 0})`, children: b?.warehouses?.length ? (
      <Table rowKey="id" size="small" pagination={false} dataSource={b.warehouses} columns={[
        { title: 'Code', dataIndex: 'code' }, { title: 'Name', dataIndex: 'name' },
      ]} />) : <Alert type="info" message="No warehouses linked to this branch." /> },
    { key: 'fiscal', label: `Fiscal Devices (${b?.fiscalDevices?.length || 0})`, children: b?.fiscalDevices?.length ? (
      <Table rowKey="id" size="small" pagination={false} dataSource={b.fiscalDevices} columns={[
        { title: 'Device', dataIndex: 'name' }, { title: 'Serial', dataIndex: 'serialNumber' }, { title: 'Status', dataIndex: 'status' },
      ]} />) : <Alert type="info" message="No fiscal devices linked to this branch." /> },
    {
      key: 'audit', label: `Audit (${b?.audit?.length || 0})`,
      children: b?.audit?.length ? (
        <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} dataSource={b.audit} columns={[
          { title: 'When', dataIndex: 'createdAt', width: 160, render: (v) => fmtDateTime(v) },
          { title: 'Action', dataIndex: 'action', width: 180, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
          { title: 'Result', dataIndex: 'result', width: 90, render: (v) => v || '—' },
        ]} />
      ) : <Alert type="info" message="No audit events for this branch yet." />,
    },
  ];

  return (
    <>
      <Drawer open onClose={onClose} title="Branch Details" width={840} destroyOnHidden styles={{ body: { padding: '12px 24px 24px' } }}>
        {q.isLoading ? <div className="py-10 text-center text-slate-400">Loading…</div> : q.error ? <Alert type="error" message={(q.error as Error).message} /> : <Tabs items={tabs} defaultActiveKey="overview" />}
      </Drawer>
      {editOpen && b && <EditBranchDrawer branch={b} open={editOpen} onClose={() => setEditOpen(false)} onDone={() => { setEditOpen(false); qc.invalidateQueries({ queryKey: ['/admin/branches', branchId] }); onChanged(); }} />}
    </>
  );
}

function EditBranchDrawer({ branch, open, onClose, onDone }: { branch: any; open: boolean; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const options = useQuery({ queryKey: ['/admin/users/options'], queryFn: () => api('/admin/users/options') });
  const managers = (options.data?.employees || []).filter((e: any) => e.hasUser);

  async function submit() {
    const values = await form.validateFields();
    try {
      setSaving(true);
      const manager = managers.find((m: any) => m.userId === values.managerUserId);
      await api(`/admin/branches/${branch.id}`, { method: 'PATCH', body: JSON.stringify({ ...values, managerName: manager?.name ?? branch.managerName }) });
      message.success('Branch updated');
      qc.invalidateQueries({ queryKey: ['/admin/branches'] });
      onDone();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Edit Branch" width={720} destroyOnHidden
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save Changes</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ ...branch, managerUserId: branch.managerId || undefined }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Form.Item label="Branch Name" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Manager" name="managerUserId"><Select allowClear showSearch optionFilterProp="label" options={managers.map((m: any) => ({ value: m.userId, label: `${m.name} · ${m.email || ''}` }))} /></Form.Item>
          <Form.Item label="Phone" name="phone"><Input /></Form.Item>
          <Form.Item label="Email" name="email"><Input /></Form.Item>
          <Form.Item label="Default Currency" name="defaultCurrency"><Select options={['USD', 'ZWL', 'ZAR', 'EUR', 'GBP'].map((c) => ({ value: c, label: c }))} /></Form.Item>
          <Form.Item label="Timezone" name="timezone"><Input /></Form.Item>
          <Form.Item label="Street" name="street"><Input /></Form.Item>
          <Form.Item label="City" name="city"><Input /></Form.Item>
          <Form.Item label="Province / State" name="province"><Input /></Form.Item>
          <Form.Item label="Postal Code" name="postalCode"><Input /></Form.Item>
          <Form.Item label="Country" name="country"><Input /></Form.Item>
          <Form.Item label="Status" name="active"><Select options={[{ value: true, label: 'Active' }, { value: false, label: 'Inactive' }]} /></Form.Item>
        </div>
      </Form>
    </Drawer>
  );
}

export default BranchesTab;
