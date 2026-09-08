'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Descriptions, Drawer, Dropdown, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Divider, Empty,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, ReloadOutlined, SearchOutlined, SafetyCertificateOutlined, HistoryOutlined,
  LinkOutlined, MailOutlined, LockOutlined, TeamOutlined, IdcardOutlined, ArrowUpOutlined, ArrowDownOutlined,
  EyeOutlined, StopOutlined,
} from '@ant-design/icons';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { UserStatusBadge, MembershipStatusBadge, RoleBadge, ScopeTag, UserAvatar, Field, HelpTooltip } from './shared';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const SCOPE_OPTIONS = [
  { label: 'Single Branch', value: 'SINGLE_BRANCH' },
  { label: 'Selected Branches', value: 'SELECTED_BRANCHES' },
  { label: 'Company Wide', value: 'COMPANY_WIDE' },
  { label: 'Platform Wide', value: 'PLATFORM_WIDE' },
];

export function UsersTab() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<any>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [detailUser, setDetailUser] = useState<any>(null);

  const users = useQuery({ queryKey: ['/admin/users'], queryFn: () => api('/admin/users') });
  const options = useQuery({ queryKey: ['/admin/users/options'], queryFn: () => api('/admin/users/options') });

  const data = useMemo(() => {
    let rows = users.data || [];
    if (filters.search) {
      const q = String(filters.search).toLowerCase();
      rows = rows.filter((u: any) => [u.name, u.email, u.employeeNo, u.department, u.role].some((v) => v && String(v).toLowerCase().includes(q)));
    }
    if (filters.role) rows = rows.filter((u: any) => u.role === filters.role);
    if (filters.status) rows = rows.filter((u: any) => u.status === filters.status);
    if (filters.department) rows = rows.filter((u: any) => u.departmentId === filters.department);
    if (filters.branch) rows = rows.filter((u: any) => u.primaryBranchId === filters.branch);
    return rows;
  }, [users.data, filters]);

  const roles = options.data?.roles || [];
  const branches = options.data?.branches || [];
  const departments = options.data?.departments || [];

  const columns: ColumnsType<any> = [
    {
      title: 'User', key: 'user', width: 260,
      render: (_, r) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar name={r.name} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-800 truncate">{r.name}</div>
            <div className="text-[11.5px] text-slate-400 truncate">{r.email || '—'}</div>
          </div>
        </div>
      ),
    },
    { title: 'Employee #', dataIndex: 'employeeNo', width: 110, render: (v: any, r: any) => v || (r.isPlatformAdmin ? <span className="text-[11px] font-semibold text-purple-600">PLATFORM</span> : '—') },
    { title: 'Department', dataIndex: 'department', width: 130, render: (v) => v || '—' },
    { title: 'Role', dataIndex: 'role', width: 160, render: (v, r) => <RoleBadge role={v} /> },
    { title: 'Access', key: 'access', width: 150, render: (_, r) => (
      <div>
        <ScopeTag scope={r.accessScope} />
        <div className="text-[11px] text-slate-400 mt-0.5 truncate">{r.primaryBranch || r.branchLabel || '—'}</div>
      </div>
    ) },
    { title: 'Last Login', dataIndex: 'lastLoginAt', width: 150, render: (v) => (v ? fmtDateTime(v) : '—') },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <UserStatusBadge status={v} /> },
    {
      ...ACTIONS_COL,
      render: (_, r) => (
        <RowActionsMenu items={userRowActions(r, () => setDetailUser(r.userId), qc, message)} />
      ),
    },
  ];

  return (
    <>
      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search name, email, employee #…" className="w-64 !rounded-xl" onChange={(e) => setFilters((f: any) => ({ ...f, search: e.target.value }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Role" className="!min-w-[170px]" options={roles.map((r: any) => ({ label: r.name, value: r.name }))} onChange={(v) => setFilters((f: any) => ({ ...f, role: v }))} />
        <Select allowClear placeholder="Status" className="!min-w-[130px]" options={['ACTIVE', 'INVITED', 'INACTIVE', 'SUSPENDED', 'LOCKED'].map((s) => ({ label: s, value: s }))} onChange={(v) => setFilters((f: any) => ({ ...f, status: v }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Department" className="!min-w-[150px]" options={departments.map((d: any) => ({ label: d.name, value: d.id }))} onChange={(v) => setFilters((f: any) => ({ ...f, department: v }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Branch" className="!min-w-[150px]" options={branches.map((b: any) => ({ label: `${b.name} · ${b.code}`, value: b.id }))} onChange={(v) => setFilters((f: any) => ({ ...f, branch: v }))} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-slate-400">{data.length} users</span>
          <Tooltip title="Refresh"><Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/admin/users'] })} /></Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Add User</Button>
        </div>
      </div>
      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <Table rowKey="membershipId" loading={users.isLoading} dataSource={data} columns={columns} scroll={{ x: 1100 }} pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} users` }} />
      </Card>
      {createOpen && <AddUserDrawer open={createOpen} onClose={() => setCreateOpen(false)} options={options.data} onCreated={(u) => { setCreateOpen(false); qc.invalidateQueries({ queryKey: ['/admin/users'] }); if (u?.userId) setDetailUser(u.userId); }} />}
      {detailUser && <UserDetailDrawer userId={detailUser} onClose={() => setDetailUser(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['/admin/users'] })} />}
    </>
  );
}

function userRowActions(record: any, view: () => void, qc: any, message: any) {
  return [
    { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: view },
    { key: 'memberships', label: 'View Memberships', icon: <TeamOutlined />, onClick: view },
    { key: 'permissions', label: 'View Permissions', icon: <SafetyCertificateOutlined />, onClick: view },
    { key: 'audit', label: 'View Audit History', icon: <HistoryOutlined />, onClick: view },
    ...(record.employeeId ? [{ key: 'employee', label: 'View Employee', icon: <IdcardOutlined />, onClick: () => window.open(`/hr/employees/${record.employeeId}`, '_blank') }] : []),
    ...(record.status === 'ACTIVE'
      ? [{ key: 'deactivate', label: 'Deactivate User', icon: <StopOutlined />, danger: true as const, onClick: () => confirmStatusChange(record, 'INACTIVE', qc, message) }]
      : [{ key: 'activate', label: 'Activate User', icon: <LinkOutlined />, onClick: () => confirmStatusChange(record, 'ACTIVE', qc, message) }]),
    ...(record.status === 'INVITED' ? [{ key: 'invite', label: 'Resend Invitation', icon: <MailOutlined />, onClick: async () => { try { const r = await api(`/admin/users/${record.userId}/invite`, { method: 'POST' }); message.success(r.inviteToken ? `Invitation token: ${r.inviteToken}` : 'Invitation sent'); qc.invalidateQueries({ queryKey: ['/admin/users'] }); } catch (e: any) { message.error(e.message); } } }] : []),
    { key: 'sessions', label: 'Revoke Sessions', icon: <LockOutlined />, onClick: () => revokeSessions(record, qc, message) },
  ];
}

function confirmStatusChange(record: any, status: string, qc: any, message: any) {
  let reason = '';
  Modal.confirm({
    title: status === 'INACTIVE' ? `Deactivate ${record.name}?` : `Activate ${record.name}?`,
    content: (
      <div>
        {status === 'INACTIVE' && <p className="text-[13px] text-slate-500 mb-2">{record.name} will no longer be able to sign in. Existing accounting, HR, sales and audit history will remain unchanged.</p>}
        <Input placeholder="Reason (optional)" onChange={(e) => { reason = e.target.value; }} />
      </div>
    ),
    okText: status === 'INACTIVE' ? 'Deactivate User' : 'Activate User',
    okButtonProps: { danger: status === 'INACTIVE' },
    onOk: async () => {
      try {
        await api(`/admin/users/${record.userId}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) });
        message.success(status === 'INACTIVE' ? 'User deactivated' : 'User activated');
        qc.invalidateQueries({ queryKey: ['/admin/users'] });
      } catch (e: any) { message.error(e.message); throw e; }
    },
  });
}

async function revokeSessions(record: any, qc: any, message: any) {
  Modal.confirm({
    title: `Revoke all sessions for ${record.name}?`,
    content: 'They will be signed out of every device.',
    okText: 'Revoke Sessions',
    okButtonProps: { danger: true },
    onOk: async () => {
      try { await api(`/admin/users/${record.userId}/revoke-sessions`, { method: 'POST', body: JSON.stringify({}) }); message.success('Sessions revoked'); qc.invalidateQueries({ queryKey: ['/admin/users'] }); }
      catch (e: any) { message.error(e.message); throw e; }
    },
  });
}

// ---------------- Add User drawer ----------------
function AddUserDrawer({ open, onClose, options, onCreated }: { open: boolean; onClose: () => void; options: any; onCreated?: (u: any) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const [scope, setScope] = useState<string>('SINGLE_BRANCH');
  const [role, setRole] = useState<string>();
  const [platformMode, setPlatformMode] = useState(false);

  const employees = options?.employees || [];
  const branches = options?.branches || [];
  const roles = options?.roles || [];
  const watchEmp = Form.useWatch('employeeId', open ? form : undefined);

  useEffect(() => {
    const emp = employees.find((e: any) => e.id === watchEmp) || null;
    setSelectedEmp(emp);
    if (emp) {
      form.setFieldsValue({ email: emp.email || '', primaryBranchId: emp.branchId || undefined });
    }
  }, [watchEmp, employees]); // eslint-disable-line react-hooks/exhaustive-deps

  const roleDef = roles.find((r: any) => r.name === role);
  const isPlatformRole = platformMode || String(role || '').toUpperCase().startsWith('PLATFORM');
  const adminTier = roleLevel(role);
  const branchRequired = !platformMode && adminTier < 80 && scope !== 'COMPANY_WIDE';

  async function submit() {
    const values = await form.validateFields();
    try {
      setSaving(true);
      const payload: any = {
        employeeId: platformMode ? undefined : values.employeeId,
        role: values.role,
        accessScope: platformMode ? 'PLATFORM_WIDE' : values.accessScope,
        primaryBranchId: platformMode ? undefined : values.primaryBranchId,
        additionalBranchIds: values.additionalBranchIds || [],
        status: values.sendInvitation ? 'INVITED' : 'ACTIVE',
        sendInvitation: !!values.sendInvitation,
        isPlatformAdmin: platformMode,
        reason: values.reason,
      };
      const res = await api('/admin/users', { method: 'POST', body: JSON.stringify(payload) });
      message.success('User created');
      qc.invalidateQueries({ queryKey: ['/admin/users'] });
      qc.invalidateQueries({ queryKey: ['/admin/users/options'] });
      onCreated?.(res.user || res);
    } catch (e: any) {
      message.error(e.message);
    } finally { setSaving(false); }
  }

  return (
    <Drawer
      open={open} onClose={onClose} title="Add User" width={820} destroyOnHidden
      styles={{ body: { padding: '12px 24px 24px' } }}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={submit}>Create User</Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" initialValues={{ accessScope: 'SINGLE_BRANCH', sendInvitation: true }}>
        {!platformMode && (
          <>
            <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-1">Employee</div>
            <Form.Item name="employeeId" rules={[{ required: true, message: 'Select an employee' }]}>
              <Select
                showSearch optionFilterProp="label" placeholder="Search by name, employee #, email, department…"
                options={employees.map((e: any) => ({
                  value: e.id,
                  label: e.name,
                  disabled: e.hasUser,
                  extra: e,
                }))}
                optionRender={(o: any) => {
                  const e = o.data?.extra || {};
                  return (
                    <div>
                      <div className="text-[13px] font-medium text-slate-800">{e.name}{e.hasUser && <Tag color="orange" style={{ marginLeft: 8, fontSize: 10 }}>Already has user ({e.userStatus})</Tag>}</div>
                      <div className="text-[11.5px] text-slate-400">{e.employeeNo} · {[e.department, e.jobTitle].filter(Boolean).join(' · ')}{e.email ? ` · ${e.email}` : ''}</div>
                    </div>
                  );
                }}
              />
            </Form.Item>
            {watchEmp && (
              selectedEmp?.hasUser ? (
                <Alert
                  type="warning" showIcon className="mb-4"
                  message={`This employee already has a user account (${selectedEmp.userStatus}).`}
                  description="View that user instead of creating a duplicate."
                />
              ) : !selectedEmp?.email ? (
                <Alert type="error" showIcon className="mb-4" message="This employee does not have a work email address." description="Add a work email on the employee record before creating a user." />
              ) : (
                <div className="nex-card mb-4 px-4 py-3 grid grid-cols-2 md:grid-cols-3 gap-2 bg-slate-50">
                  <Field label="Employee"><span className="font-semibold">{selectedEmp.name}</span></Field>
                  <Field label="Employee #"><span className="font-mono">{selectedEmp.employeeNo}</span></Field>
                  <Field label="Email"><span>{selectedEmp.email}</span></Field>
                  <Field label="Department">{selectedEmp.department || '—'}</Field>
                  <Field label="Job Title">{selectedEmp.jobTitle || '—'}</Field>
                  <Field label="Current Branch">{selectedEmp.branch || '—'}</Field>
                </div>
              )
            )}
          </>
        )}

        <div className="flex items-center justify-between">
          <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-1">Access</div>
          <Button size="small" type="link" onClick={() => setPlatformMode((v) => !v)}>{platformMode ? '← Create employee-linked user' : 'Create platform account'}</Button>
        </div>

        {platformMode && (
          <Alert type="info" showIcon className="mb-4" message="Platform Super Admin" description="Platform-level account. No employee, department or branch required. Only existing platform administrators can create these." />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Form.Item label="Login Email" name="email" rules={[{ required: true, message: 'Email is required' }]} extra={!platformMode ? 'Auto-populated from the employee work email.' : undefined}>
            <Input disabled={!platformMode && !!selectedEmp?.email} placeholder="user@company.com" />
          </Form.Item>
          <Form.Item label="Role" name="role" rules={[{ required: true, message: 'Role is required' }]}>
            <Select
              showSearch optionFilterProp="label" placeholder="Select role…" onChange={setRole}
              options={roles.map((r: any) => ({ value: r.name, label: r.name }))}
              optionRender={(o: any) => {
                const rd = roles.find((r: any) => r.name === o.data?.value);
                return (
                  <div>
                    <div className="text-[13px] font-medium">{o.data?.label}</div>
                    {rd?.description && <div className="text-[11.5px] text-slate-400">{rd.description}</div>}
                  </div>
                );
              }}
            />
          </Form.Item>
        </div>

        {role && !isPlatformRole && (
          <div className="nex-card mb-4 px-4 py-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500"><SafetyCertificateOutlined /> Role Permissions <HelpTooltip text="Read-only summary of what this role can do. Permission overrides are managed separately for advanced administrators." /></div>
            <PermissionSummary role={role} />
          </div>
        )}

        {!platformMode && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              <Form.Item label="Access Scope" name="accessScope">
                <Select options={SCOPE_OPTIONS.filter((s) => s.value !== 'PLATFORM_WIDE')} onChange={setScope} />
              </Form.Item>
              <Form.Item label="Primary Branch" name="primaryBranchId" rules={branchRequired ? [{ required: true, message: 'A primary branch is required for this role.' }] : []}>
                <Select showSearch optionFilterProp="label" allowClear placeholder="Select branch…" options={branches.map((b: any) => ({ value: b.id, label: `${b.name} · ${b.code}` }))} />
              </Form.Item>
            </div>
            <Form.Item label="Additional Branches" name="additionalBranchIds">
              <Select mode="multiple" allowClear placeholder="Optional additional branches" options={branches.map((b: any) => ({ value: b.id, label: `${b.name} · ${b.code}` }))} />
            </Form.Item>
          </>
        )}

        <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-1 mt-2">Account</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Form.Item label="Status" name="sendInvitation" valuePropName="checked" style={{ marginBottom: 8 }}>
            <div className="flex items-center gap-3">
              <Select disabled style={{ width: 180 }} value={form.getFieldValue('sendInvitation') ? 'INVITED' : 'ACTIVE'} options={[{ label: 'INVITED', value: 'INVITED' }, { label: 'ACTIVE', value: 'ACTIVE' }]} />
            </div>
          </Form.Item>
          <Form.Item label="Send invitation email" name="sendInvitation" valuePropName="checked" style={{ marginBottom: 8 }}>
            <div className="pt-1.5"><Tag.CheckableTag checked={!!form.getFieldValue('sendInvitation')} onChange={(c) => form.setFieldValue('sendInvitation', c)}>Invite by email</Tag.CheckableTag></div>
          </Form.Item>
        </div>
        <Form.Item label="Reason (optional)" name="reason" style={{ marginBottom: 8 }}><Input placeholder="Why is this access being granted?" /></Form.Item>
      </Form>
    </Drawer>
  );
}

function roleLevel(role?: string): number {
  if (!role) return 30;
  const up = String(role).toUpperCase();
  if (up.startsWith('PLATFORM')) return 100;
  if (up.includes('ADMIN') || up.includes('SUPER')) return 80;
  if (up.includes('MANAGER')) return 60;
  if (up.includes('VIEW') || up.includes('READ')) return 10;
  return 30;
}

// ---------------- Permission summary (read-only) ----------------
function PermissionSummary({ role }: { role: string }) {
  const perms = useQuery({ queryKey: ['/auth/permissions'], queryFn: () => api('/auth/permissions') });
  const grouped = useMemo(() => {
    const byModule: Record<string, string[]> = {};
    // Roles' permissions aren't exposed per-role on this endpoint; show a static capability hint per role tier instead.
    const tier = roleLevel(role);
    if (tier >= 80) byModule['Access'] = ['Full company administration', 'User & membership management', 'Branch management', 'Configuration'];
    if (tier >= 60) byModule['Management'] = ['Module management permissions', 'Approvals', 'Reporting'];
    byModule['Standard'] = tier >= 80 ? [] : ['Module views', 'Transaction entry per role', 'Own reports'];
    if (tier <= 10) byModule['Read Only'] = ['View-only access'];
    return byModule;
  }, [role]);
  void perms;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-1">
      {Object.entries(grouped).map(([mod, list]) => (
        <div key={mod}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{mod}</div>
          {list.length === 0 ? <div className="text-[11.5px] text-slate-300 italic">Tier default</div> : list.map((p) => <div key={p} className="text-[12px] text-slate-600 flex items-center gap-1"><ArrowUpOutlined className="text-green-500 text-[10px]" />{p}</div>)}
        </div>
      ))}
    </div>
  );
}

// ---------------- User detail drawer ----------------
function UserDetailDrawer({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged?: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const user = useQuery({ queryKey: ['/admin/users', userId], queryFn: () => api(`/admin/users/${userId}`) });
  const [accessOpen, setAccessOpen] = useState(false);

  const u = user.data;
  const mfa = u?.mfaEnabled;

  const tabs = [
    {
      key: 'overview', label: 'Overview',
      children: u && (
        <div className="space-y-1">
          <div className="flex items-center gap-3 mb-3">
            <UserAvatar name={u.name} size={44} />
            <div>
              <div className="text-[16px] font-semibold text-slate-800">{u.name}</div>
              <div className="text-[12.5px] text-slate-400">{u.email}</div>
            </div>
            <div className="ml-auto flex items-center gap-2"><UserStatusBadge status={u.status} /><RoleBadge role={u.role} /></div>
          </div>
          <Divider style={{ margin: '8px 0' }} />
          <Descriptions column={2} size="small" labelStyle={{ width: 140 }} contentStyle={{ fontSize: 13 }}>
            <Descriptions.Item label="Employee">{u.employee ? <LinkOutlined className="mr-1 text-blue-500" /> : null}{u.employee?.name || (u.isPlatformAdmin ? 'Not applicable — platform account' : '—')}</Descriptions.Item>
            <Descriptions.Item label="Employee #">{u.employeeNo || (u.isPlatformAdmin ? 'PLATFORM' : '—')}</Descriptions.Item>
            <Descriptions.Item label="Department">{u.department || '—'}</Descriptions.Item>
            <Descriptions.Item label="Job Title">{u.jobTitle || '—'}</Descriptions.Item>
            <Descriptions.Item label="Company">{u.companyName || '—'}</Descriptions.Item>
            <Descriptions.Item label="User Status"><UserStatusBadge status={u.status} /></Descriptions.Item>
            <Descriptions.Item label="Membership"><MembershipStatusBadge status={u.membershipStatus} /></Descriptions.Item>
            <Descriptions.Item label="Access Scope"><ScopeTag scope={u.accessScope} /></Descriptions.Item>
            <Descriptions.Item label="Primary Branch">{u.primaryBranch || '—'}</Descriptions.Item>
            <Descriptions.Item label="Additional Branches">{(u.additionalBranches || []).join(', ') || '—'}</Descriptions.Item>
            <Descriptions.Item label="MFA">{mfa ? <Tag color="green">Enabled</Tag> : <Tag>Not set up</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Last Login">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'Never'}</Descriptions.Item>
            <Descriptions.Item label="Created">{u.createdAt ? fmtDate(u.createdAt) : '—'}</Descriptions.Item>
          </Descriptions>
          {u.employee && <Button size="small" icon={<IdcardOutlined />} onClick={() => window.open(`/hr/employees/${u.employee.id}`, '_blank')}>Open Employee</Button>}
        </div>
      ),
    },
    {
      key: 'access', label: 'Access',
      children: u && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Field label="Role"><RoleBadge role={u.role} /></Field>
            <Field label="Access Scope"><ScopeTag scope={u.accessScope} /></Field>
            <Field label="Primary Branch">{u.primaryBranch || '—'}</Field>
            <Field label="Additional Branches">{(u.additionalBranches || []).join(', ') || '—'}</Field>
          </div>
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Permission Summary ({u.permissions?.length || 0})</div>
            <div className="flex flex-wrap gap-1.5">{u.permissions?.slice(0, 30).map((p: string) => <Tag key={p} style={{ fontSize: 11 }}>{p}</Tag>)}</div>
          </div>
          <Button type="primary" size="small" icon={<SafetyCertificateOutlined />} onClick={() => setAccessOpen(true)}>Edit Access</Button>
          {accessOpen && <EditAccessDrawer userId={userId} onClose={() => setAccessOpen(false)} onDone={() => { setAccessOpen(false); qc.invalidateQueries({ queryKey: ['/admin/users', userId] }); onChanged?.(); }} />}
        </div>
      ),
    },
    {
      key: 'memberships', label: 'Memberships',
      children: u && (
        <Card className="nex-card" styles={{ body: { padding: 0 } }}>
          <Table
            rowKey="membershipId" size="small" dataSource={[u]}
            pagination={false}
            columns={[
              { title: 'Company', dataIndex: 'companyName', render: (v) => v || '—' },
              { title: 'Role', dataIndex: 'role', render: (v) => <RoleBadge role={v} /> },
              { title: 'Scope', dataIndex: 'accessScope', render: (v) => <ScopeTag scope={v} /> },
              { title: 'Primary Branch', dataIndex: 'primaryBranch', render: (v) => v || '—' },
              { title: 'Branches', dataIndex: 'additionalBranches', render: (v) => v?.join(', ') || '—' },
              { title: 'Status', dataIndex: 'membershipStatus', render: (v) => <MembershipStatusBadge status={v} /> },
            ]}
          />
        </Card>
      ),
    },
    {
      key: 'sessions', label: 'Sessions',
      children: u && (u.sessions?.length ? (
        <div>
          <Table
            rowKey="id" size="small" pagination={false}
            dataSource={u.sessions}
            columns={[
              { title: 'Started', dataIndex: 'createdAt', render: (v: any) => fmtDateTime(v) },
              { title: 'Expires', dataIndex: 'expiresAt', render: (v: any) => fmtDateTime(v) },
              { title: 'Device / Agent', dataIndex: 'userAgent', ellipsis: true },
              {
                title: '', key: 'x', width: 60,
                render: (_: any, s: any) => <Button size="small" danger onClick={async () => { try { await api(`/admin/users/${userId}/revoke-sessions`, { method: 'POST', body: JSON.stringify({ sessionId: s.id }) }); message.success('Session revoked'); qc.invalidateQueries({ queryKey: ['/admin/users', userId] }); } catch (e: any) { message.error(e.message); } }}>Revoke</Button>,
              },
            ]}
          />
          <Button size="small" danger className="mt-3" onClick={() => revokeSessions(u, qc, message)}>Revoke All Sessions</Button>
        </div>
      ) : <Empty description="No active sessions" />),
    },
    {
      key: 'audit', label: 'Audit',
      children: u && (
        <Table
          rowKey="id" size="small" pagination={{ pageSize: 10 }}
          dataSource={u.audit || []}
          columns={[
            { title: 'When', dataIndex: 'createdAt', width: 160, render: (v: any) => fmtDateTime(v) },
            { title: 'Action', dataIndex: 'action', width: 180, render: (v: any) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
            { title: 'Module', dataIndex: 'module', width: 110, render: (v: any) => v || '—' },
            { title: 'Result', dataIndex: 'result', width: 90, render: (v: any) => v || '—' },
            { title: 'Details', render: (_: any, r: any) => <code className="text-[11px] text-slate-500">{JSON.stringify(r.metadata || r.details || {})}</code> },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <Drawer open onClose={onClose} title="User Details" width={840} destroyOnHidden styles={{ body: { padding: '12px 24px 24px' } }}>
        {user.isLoading ? <div className="py-10 text-center text-slate-400">Loading…</div> : user.error ? <Alert type="error" message={(user.error as Error).message} /> : (
          <Tabs items={tabs} defaultActiveKey="overview" />
        )}
      </Drawer>
    </>
  );
}

// ---------------- Edit access drawer ----------------
function EditAccessDrawer({ userId, onClose, onDone }: { userId: string; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const user = useQuery({ queryKey: ['/admin/users', userId], queryFn: () => api(`/admin/users/${userId}`) });
  const options = useQuery({ queryKey: ['/admin/users/options'], queryFn: () => api('/admin/users/options') });
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<string>();

  useEffect(() => {
    if (user.data) {
      form.setFieldsValue({
        role: user.data.role, accessScope: user.data.accessScope,
        primaryBranchId: user.data.primaryBranchId || undefined,
        additionalBranchIds: user.data.additionalBranches || [],
      });
      setScope(user.data.accessScope);
    }
  }, [user.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    const values = await form.validateFields();
    try {
      setSaving(true);
      await api(`/admin/users/${userId}/access`, { method: 'PATCH', body: JSON.stringify({ ...values, reason: values.reason }) });
      message.success('Access updated');
      qc.invalidateQueries({ queryKey: ['/admin/users'] });
      onDone();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  const branches = options.data?.branches || [];
  const roles = options.data?.roles || [];
  const branchRequired = roleLevel(form.getFieldValue('role')) < 80 && scope !== 'COMPANY_WIDE';

  return (
    <Drawer open onClose={onClose} title="Edit Access" width={620} destroyOnHidden
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save Changes</Button></div>}>
      <Form form={form} layout="vertical">
        <Form.Item label="Role" name="role" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" options={roles.map((r: any) => ({ value: r.name, label: r.name }))} />
        </Form.Item>
        <Form.Item label="Access Scope" name="accessScope">
          <Select options={SCOPE_OPTIONS.filter((s) => s.value !== 'PLATFORM_WIDE')} onChange={setScope} />
        </Form.Item>
        <Form.Item label="Primary Branch" name="primaryBranchId" rules={branchRequired ? [{ required: true, message: 'A primary branch is required for this role.' }] : []}>
          <Select showSearch optionFilterProp="label" allowClear placeholder="Select branch…" options={branches.map((b: any) => ({ value: b.id, label: `${b.name} · ${b.code}` }))} />
        </Form.Item>
        <Form.Item label="Additional Branches" name="additionalBranchIds">
          <Select mode="multiple" allowClear placeholder="Optional" options={branches.map((b: any) => ({ value: b.id, label: `${b.name} · ${b.code}` }))} />
        </Form.Item>
        <Form.Item label="Reason (optional)" name="reason"><Input placeholder="Why is this access changing?" /></Form.Item>
      </Form>
    </Drawer>
  );
}

export default UsersTab;
