'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Descriptions, Drawer, Form, Input, Modal, Select, Table, Tooltip, message, Tag, Alert, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { MembershipStatusBadge, RoleBadge, ScopeTag, UserAvatar, Field, HelpTooltip } from './shared';

const SCOPE_OPTIONS = [
  { label: 'Single Branch', value: 'SINGLE_BRANCH' },
  { label: 'Selected Branches', value: 'SELECTED_BRANCHES' },
  { label: 'Company Wide', value: 'COMPANY_WIDE' },
];

export function MembershipsTab() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const list = useQuery({ queryKey: ['/admin/memberships'], queryFn: () => api('/admin/memberships') });

  const columns: ColumnsType<any> = [
    {
      title: 'User', key: 'user', width: 240,
      render: (_, r) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar name={r.userName} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-800 truncate">{r.userName}</div>
            <div className="text-[11.5px] text-slate-400 truncate">{r.email}</div>
          </div>
        </div>
      ),
    },
    { title: 'Employee #', dataIndex: 'employeeNo', width: 110, render: (v) => v || '—' },
    { title: 'Company', dataIndex: 'company', width: 170, ellipsis: true },
    { title: 'Role', dataIndex: 'role', width: 160, render: (v) => <RoleBadge role={v} /> },
    { title: 'Scope', dataIndex: 'accessScope', width: 140, render: (v) => <ScopeTag scope={v} /> },
    { title: 'Primary Branch', dataIndex: 'primaryBranch', width: 140, render: (v) => v || '—' },
    { title: 'Branches', dataIndex: 'branches', ellipsis: true, render: (v) => v?.join(', ') || '—' },
    { title: 'Status', dataIndex: 'status', width: 100, render: (v) => <MembershipStatusBadge status={v} /> },
    {
      ...ACTIONS_COL,
      render: (_, r) => (
        <RowActionsMenu items={[
          { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setDetail(r) },
          { key: 'deactivate', label: 'Deactivate', icon: <StopOutlined />, danger: true, hidden: r.status !== 'ACTIVE', onClick: () => {
            Modal.confirm({
              title: 'Deactivate membership?',
              content: `${r.userName} will keep the account but lose access to ${r.company} until reactivated.`,
              okText: 'Deactivate Membership', okButtonProps: { danger: true },
              onOk: async () => {
                try { await api(`/admin/memberships/${r.id}/deactivate`, { method: 'POST', body: JSON.stringify({ reason: 'Membership deactivated by administrator' }) }); message.success('Membership deactivated'); qc.invalidateQueries({ queryKey: ['/admin/memberships'] }); }
                catch (e: any) { message.error(e.message); throw e; }
              },
            });
          } },
        ]} />
      ),
    },
  ];

  return (
    <>
      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="text-[12px] text-slate-400">Memberships tie a user to a company, a role and a data scope. One user can hold memberships in several companies without duplicate accounts.</div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-slate-400">{list.data?.length || 0} memberships</span>
          <Tooltip title="Refresh"><Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/admin/memberships'] })} /></Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add Membership</Button>
        </div>
      </div>
      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <Table rowKey="id" loading={list.isLoading} dataSource={list.data || []} columns={columns} scroll={{ x: 1100 }} pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} memberships` }} />
      </Card>
      {addOpen && <AddMembershipDrawer open={addOpen} onClose={() => setAddOpen(false)} onDone={() => qc.invalidateQueries({ queryKey: ['/admin/memberships'] })} />}
      {detail && (
        <Drawer open onClose={() => setDetail(null)} title="Membership Details" width={640} destroyOnHidden styles={{ body: { padding: '12px 24px 24px' } }}>
          <Descriptions column={1} size="small" labelStyle={{ width: 150 }} contentStyle={{ fontSize: 13 }}>
            <Descriptions.Item label="Employee / User"><div className="flex items-center gap-2"><UserAvatar name={detail.userName} size={22} />{detail.userName} <span className="text-slate-400">{detail.email}</span></div></Descriptions.Item>
            <Descriptions.Item label="Employee #">{detail.employeeNo || '—'}</Descriptions.Item>
            <Descriptions.Item label="Company">{detail.company}</Descriptions.Item>
            <Descriptions.Item label="Role"><RoleBadge role={detail.role} /></Descriptions.Item>
            <Descriptions.Item label="Access Scope"><ScopeTag scope={detail.accessScope} /></Descriptions.Item>
            <Descriptions.Item label="Primary Branch">{detail.primaryBranch || '—'}</Descriptions.Item>
            <Descriptions.Item label="Branches">{detail.branches?.join(', ') || '—'}</Descriptions.Item>
            <Descriptions.Item label="Effective From">{detail.effectiveFrom ? fmtDate(detail.effectiveFrom) : '—'}</Descriptions.Item>
            <Descriptions.Item label="Status"><MembershipStatusBadge status={detail.status} /></Descriptions.Item>
          </Descriptions>
        </Drawer>
      )}
    </>
  );
}

function AddMembershipDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState('SINGLE_BRANCH');
  const options = useQuery({ queryKey: ['/admin/users/options'], queryFn: () => api('/admin/users/options') });
  const branches = options.data?.branches || [];
  const roles = options.data?.roles || [];

  async function submit() {
    const values = await form.validateFields();
    try {
      setSaving(true);
      await api('/admin/memberships', { method: 'POST', body: JSON.stringify({ ...values, accessScope: scope, reason: values.reason }) });
      message.success('Membership added');
      qc.invalidateQueries({ queryKey: ['/admin/memberships'] });
      qc.invalidateQueries({ queryKey: ['/admin/users'] });
      onDone(); onClose();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Add Membership" width={620} destroyOnHidden
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Add Membership</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ accessScope: 'SINGLE_BRANCH' }}>
        <Alert type="info" showIcon className="mb-4" message="Grant an existing user access to this company, or create the account by email." />
        <Form.Item label="User (existing account)" name="userId" extra="Pick an existing user OR enter an email to create a new account.">
          <Select allowClear showSearch optionFilterProp="label" placeholder="Search existing users…" options={(options.data?.employees || []).filter((e: any) => e.hasUser).map((e: any) => ({ value: e.userId, label: `${e.name} · ${e.email || ''}` }))} />
        </Form.Item>
        <Form.Item label="Or new user email" name="email" rules={[{ type: 'email', message: 'Valid email required' }]}>
          <Input placeholder="user@company.com" />
        </Form.Item>
        <Form.Item label="Role" name="role" rules={[{ required: true, message: 'Role is required' }]}>
          <Select showSearch optionFilterProp="label" placeholder="Select role…" options={roles.map((r: any) => ({ value: r.name, label: r.name }))} />
        </Form.Item>
        <Form.Item label="Access Scope" name="accessScope">
          <Select options={SCOPE_OPTIONS} onChange={setScope} />
        </Form.Item>
        <Form.Item label="Primary Branch" name="primaryBranchId" rules={scope !== 'COMPANY_WIDE' ? [{ required: true, message: 'Primary branch required for branch-scoped access' }] : []}>
          <Select showSearch optionFilterProp="label" allowClear placeholder="Select branch…" options={branches.map((b: any) => ({ value: b.id, label: `${b.name} · ${b.code}` }))} />
        </Form.Item>
        <Form.Item label="Additional Branches" name="additionalBranchIds">
          <Select mode="multiple" allowClear placeholder="Optional" options={branches.map((b: any) => ({ value: b.id, label: `${b.name} · ${b.code}` }))} />
        </Form.Item>
        <Form.Item label="Reason (optional)" name="reason"><Input placeholder="Why is this access being granted?" /></Form.Item>
      </Form>
    </Drawer>
  );
}

export default MembershipsTab;
