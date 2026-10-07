'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { App, Button, Col, Drawer, Form, Input, InputNumber, Modal, Progress, Row, Select, Space, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill, DetailItem, EmptyState } from '@/components/sales-ui';
import { RowActionsMenu, ACTIONS_COL } from '@/components/row-actions-menu';

const OWNERS = ['HR', 'MANAGER', 'PAYROLL', 'IT', 'EMPLOYEE'];
const CATEGORIES = ['DOCUMENTS', 'EQUIPMENT', 'ACCESS', 'PAYROLL', 'GENERAL'];
const OWNER_TONE: Record<string, string> = { HR: 'blue', MANAGER: 'purple', PAYROLL: 'green', IT: 'cyan', EMPLOYEE: 'orange' };
const lbl = (s: string) => (s || '').replace(/_/g, ' ');

export default function OnboardingPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees'), placeholderData: keepPreviousData });
  const templates = useQuery({ queryKey: ['/hr/onboarding-templates'], queryFn: () => api('/hr/onboarding-templates'), placeholderData: keepPreviousData });
  const onboardings = useQuery({ queryKey: ['/hr/employee-onboardings'], queryFn: () => api('/hr/employee-onboardings'), placeholderData: keepPreviousData });
  const [tplDrawer, setTplDrawer] = useState<{ open: boolean; mode: 'CREATE' | 'VIEW' | 'EDIT'; template?: any } | null>(null);
  const [obDrawer, setObDrawer] = useState<any | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startForm] = Form.useForm();

  const refresh = () => { qc.invalidateQueries({ queryKey: ['/hr/onboarding-templates'] }); qc.invalidateQueries({ queryKey: ['/hr/employee-onboardings'] }); };

  async function start() {
    const v = await startForm.validateFields().catch(() => null);
    if (!v) return;
    try { await api(`/hr/employees/${v.employeeId}/onboarding`, { method: 'POST', body: JSON.stringify({ templateId: v.templateId }) }); message.success('Onboarding started'); setStartOpen(false); startForm.resetFields(); refresh(); }
    catch (e: any) { message.error(e.message); }
  }

  const tplCols: ColumnsType<any> = [
    { title: 'Template', dataIndex: 'name', render: (v, r) => <a className="text-[13px] font-medium text-[#171a2e]" onClick={() => setTplDrawer({ open: true, mode: 'VIEW', template: r })}>{v}</a> },
    { title: 'Tasks', width: 90, align: 'right', render: (_v, r) => r.tasks?.length || 0 },
    { title: 'Owners', render: (_v, r) => Array.from(new Set((r.tasks || []).map((t: any) => t.owner))).map((o: any) => <Tag key={o} color={OWNER_TONE[o] || 'default'}>{o}</Tag>) },
    { ...ACTIONS_COL, render: (_v, r) => <RowActionsMenu items={[
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setTplDrawer({ open: true, mode: 'VIEW', template: r }) },
      { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: 'hr.employees.manage', onClick: () => setTplDrawer({ open: true, mode: 'EDIT', template: r }) },
    ]} /> },
  ];

  const obCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => <a className="text-[13px] text-[#171a2e]" onClick={() => setObDrawer(r)}>{r.employee?.firstName} {r.employee?.lastName}<div className="text-[11px] text-[#94a3b8]">{r.employee?.employeeNo}</div></a> },
    { title: 'Template', render: (_v, r) => <span className="text-[12px] text-[#64748b]">{r.template?.name || '—'}</span> },
    { title: 'Status', dataIndex: 'status', width: 130, render: (v) => <StatusPill status={(v || '').replace(/_/g, ' ')} /> },
    { title: 'Progress', width: 140, render: (_, r) => { const tasks = r.template?.tasks || []; const done = tasks.filter((t: any) => taskDone(r, t)).length; return <Progress percent={tasks.length ? Math.round((done / tasks.length) * 100) : 0} size="small" />; } },
    { ...ACTIONS_COL, render: (_v, r) => <RowActionsMenu items={[
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setObDrawer(r) },
      { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: 'hr.employees.manage', onClick: () => setObDrawer(r) },
    ]} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Onboarding</h1><p className="text-[13px] text-[#64748b] mt-1">Templates and task checklists for new employees</p></div>
        <Can permission="hr.employees.manage"><Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button></Can>
      </div>
      <Tabs defaultActiveKey="templates" items={[
        { key: 'templates', label: `Templates (${templates.data?.length || 0})`, children: (
          <div className="nex-card">
            <div className="flex justify-end px-4 pt-3"><Can permission="hr.employees.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => setTplDrawer({ open: true, mode: 'CREATE' })}>New Template</Button></Can></div>
            <Table rowKey="id" loading={templates.isLoading} dataSource={templates.data || []} columns={tplCols} pagination={false} locale={{ emptyText: <EmptyState title="No onboarding templates." /> }} />
          </div>
        ) },
        { key: 'outcomes', label: `Employee Onboarding (${onboardings.data?.length || 0})`, children: (
          <div className="nex-card">
            <div className="flex justify-end px-4 pt-3"><Can permission="hr.employees.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => setStartOpen(true)}>Start Onboarding</Button></Can></div>
            <Table rowKey="id" loading={onboardings.isLoading} dataSource={onboardings.data || []} columns={obCols} pagination={false} locale={{ emptyText: <EmptyState title="No employees in onboarding." /> }} />
          </div>
        ) },
      ]} />

      {tplDrawer?.open && <TemplateDrawer mode={tplDrawer.mode} template={tplDrawer.template} onClose={() => setTplDrawer(null)} onSaved={() => { setTplDrawer(null); refresh(); }} />}
      {obDrawer && <OnboardingDrawer ob={obDrawer} templates={templates.data || []} onClose={() => setObDrawer(null)} onSaved={() => { setObDrawer(null); refresh(); }} />}

      <Modal open={startOpen} onCancel={() => setStartOpen(false)} onOk={start} title="Start Onboarding" okText="Start" width={440}>
        <Form form={startForm} layout="vertical" className="mt-2">
          <Form.Item label="Employee" name="employeeId" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(employees.data || []).map((e: any) => ({ label: `${e.firstName} ${e.lastName} (${e.employeeNo})`, value: e.id }))} /></Form.Item>
          <Form.Item label="Template" name="templateId" rules={[{ required: true }]}><Select options={(templates.data || []).map((t: any) => ({ label: t.name, value: t.id }))} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function taskDone(ob: any, t: any) {
  const ts = ob.taskStatus || {};
  const entry = ts[t.id];
  if (entry && typeof entry === 'object') return !!entry.done;
  return ts[t.title] === true;
}

// ---- Template drawer (view / create / edit) ----
function TemplateDrawer({ mode, template, onClose, onSaved }: { mode: 'CREATE' | 'VIEW' | 'EDIT'; template?: any; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(mode !== 'VIEW');
  const detail = useQuery({ queryKey: ['/hr/onboarding-templates', template?.id], queryFn: () => api(`/hr/onboarding-templates/${template?.id}`), enabled: !!template?.id });
  const t = detail.data || template;

  useEffect(() => {
    if (!editMode) return;
    if (t) form.setFieldsValue({ name: t.name, tasks: (t.tasks || []).map((x: any) => ({ title: x.title, owner: x.owner || 'HR', category: x.category || 'GENERAL', dueInDays: x.dueInDays || 0 })) });
    else form.resetFields();
  }, [t, editMode]);

  async function submit() {
    const v = await form.validateFields();
    const tasks = (v.tasks || []).filter((x: any) => x && x.title);
    if (!tasks.length) { message.error('Add at least one task'); return; }
    setSaving(true);
    try {
      if (mode === 'EDIT' && template?.id) await api(`/hr/onboarding-templates/${template.id}`, { method: 'PATCH', body: JSON.stringify({ name: v.name, tasks }) });
      else await api('/hr/onboarding-templates', { method: 'POST', body: JSON.stringify({ name: v.name, tasks }) });
      message.success('Template saved'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Drawer open onClose={onClose} width="min(760px, 96vw)" destroyOnHidden title={mode === 'CREATE' ? 'New Onboarding Template' : t?.name || 'Template'}
      extra={!editMode && <Can permission="hr.employees.manage"><Button size="small" icon={<EditOutlined />} onClick={() => setEditMode(true)}>Edit</Button></Can>}
      footer={editMode ? <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save Template</Button></div> : null}>
      {editMode ? (
        <Form form={form} layout="vertical">
          <Form.Item label="Template name" name="name" rules={[{ required: true }]}><Input placeholder="Standard Onboarding" /></Form.Item>
          <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Tasks</div>
          <Form.List name="tasks">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Row gutter={8} key={key} className="mb-2">
                    <Col span={9}><Form.Item {...restField} name={[name, 'title']} label="Task" className="!mb-0"><Input /></Form.Item></Col>
                    <Col span={5}><Form.Item {...restField} name={[name, 'owner']} label="Owner" className="!mb-0"><Select options={OWNERS.map((o) => ({ label: o, value: o }))} /></Form.Item></Col>
                    <Col span={5}><Form.Item {...restField} name={[name, 'category']} label="Category" className="!mb-0"><Select options={CATEGORIES.map((c) => ({ label: lbl(c), value: c }))} /></Form.Item></Col>
                    <Col span={3}><Form.Item {...restField} name={[name, 'dueInDays']} label="Days" className="!mb-0"><InputNumber min={0} className="w-full" /></Form.Item></Col>
                    <Col span={2} className="flex items-end"><Button danger size="small" onClick={() => remove(name)}>×</Button></Col>
                  </Row>
                ))}
                <Button size="small" icon={<PlusOutlined />} onClick={() => add({ title: '', owner: 'HR', category: 'GENERAL', dueInDays: 0 })}>Add Task</Button>
              </>
            )}
          </Form.List>
        </Form>
      ) : detail.isLoading ? <Progress percent={0} showInfo={false} /> : (
        <div className="space-y-3">
          <div className="nex-card border rounded-lg p-3">
            <DetailItem label="Name" value={t?.name} />
            <DetailItem label="Tasks" value={(t?.tasks || []).length} />
          </div>
          <Table rowKey="id" size="small" dataSource={t?.tasks || []} pagination={false} columns={[
            { title: 'Task', dataIndex: 'title' },
            { title: 'Owner', dataIndex: 'owner', width: 110, render: (v) => <Tag color={OWNER_TONE[v] || 'default'}>{v}</Tag> },
            { title: 'Category', dataIndex: 'category', width: 130, render: (v) => lbl(v) },
            { title: 'Due (days)', dataIndex: 'dueInDays', width: 100, align: 'right' },
          ] as ColumnsType<any>} />
        </div>
      )}
    </Drawer>
  );
}

// ---- Onboarding drawer (view / edit) ----
function OnboardingDrawer({ ob, templates, onClose, onSaved }: { ob: any; templates: any[]; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [templateId, setTemplateId] = useState<string | undefined>(ob.templateId || undefined);
  const tasks = ob.template?.tasks || [];
  const done = tasks.filter((t: any) => taskDone(ob, t)).length;

  async function toggle(t: any) {
    const ts: any = { ...(ob.taskStatus || {}) };
    ts[t.id] = { done: !taskDone(ob, t), title: t.title, owner: t.owner, category: t.category, dueInDays: t.dueInDays };
    try { await api(`/hr/employee-onboardings/${ob.id}`, { method: 'PATCH', body: JSON.stringify({ taskStatus: ts }) }); message.success('Task updated'); qc.invalidateQueries({ queryKey: ['/hr/employee-onboardings'] }); onSaved(); }
    catch (e: any) { message.error(e.message); }
  }
  async function reassign() {
    setSaving(true);
    try { await api(`/hr/employees/${ob.employeeId}/onboarding`, { method: 'POST', body: JSON.stringify({ templateId }) }); message.success('Template reassigned'); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  async function complete() {
    setSaving(true);
    try { await api(`/hr/employee-onboardings/${ob.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }); message.success('Marked completed'); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  const byOwner = OWNERS.map((o) => ({ owner: o, items: tasks.filter((t: any) => (t.owner || 'HR') === o) })).filter((g) => g.items.length);

  return (
    <Drawer open onClose={onClose} width="min(760px, 96vw)" destroyOnHidden
      title={<div><div className="text-[16px] font-bold text-[#171a2e]">{ob.employee?.firstName} {ob.employee?.lastName}</div><div className="text-[12px] text-[#64748b] font-normal">{ob.employee?.employeeNo} · Onboarding</div></div>}
      extra={<Space size="small"><StatusPill status={(ob.status || '').replace(/_/g, ' ')} /><Can permission="hr.employees.manage"><Button size="small" icon={<EditOutlined />} onClick={reassign} loading={saving}>Save</Button></Can></Space>}>
      <div className="space-y-3">
        <div className="nex-card border rounded-lg p-3">
          <DetailItem label="Template" value={ob.template?.name || '—'} />
          <DetailItem label="Status" value={ob.status} />
          <DetailItem label="Started" value={ob.startedAt ? new Date(ob.startedAt).toLocaleDateString() : '—'} />
          <DetailItem label="Completed" value={ob.completedAt ? new Date(ob.completedAt).toLocaleDateString() : '—'} />
          <DetailItem label="Progress" value={`${done}/${tasks.length} tasks`} />
        </div>
        <Can permission="hr.employees.manage">
          <div className="nex-card border rounded-lg p-3">
            <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Reassign template</div>
            <div className="flex gap-2">
              <Select style={{ flex: 1 }} value={templateId} onChange={setTemplateId} options={templates.map((t: any) => ({ label: t.name, value: t.id }))} />
              <Button loading={saving} onClick={reassign}>Reassign</Button>
            </div>
          </div>
        </Can>
        {byOwner.length ? byOwner.map((g) => (
          <div key={g.owner} className="nex-card border rounded-lg p-3">
            <div className="text-[13px] font-semibold text-[#171a2e] mb-2 flex items-center gap-2"><Tag color={OWNER_TONE[g.owner] || 'default'} className="!m-0">{g.owner}</Tag> tasks</div>
            <div className="space-y-1.5">
              {g.items.map((t: any) => (
                <button key={t.id} onClick={() => toggle(t)} className={`w-full text-left flex items-center gap-2 text-[13px] px-2 py-1.5 rounded border ${taskDone(ob, t) ? 'bg-green-50 border-green-200 text-green-700' : 'border-[#eef0f6] text-[#344054]'}`}>
                  <span className="w-4">{taskDone(ob, t) ? '✓' : '○'}</span>
                  <span className="flex-1">{t.title}</span>
                  <span className="text-[11px] text-[#94a3b8]">{lbl(t.category)} · {t.dueInDays}d</span>
                </button>
              ))}
            </div>
          </div>
        )) : <div className="text-[13px] text-[#94a3b8]">No tasks assigned.</div>}
        <Can permission="hr.employees.manage">
          {ob.status !== 'COMPLETED' && <Button block loading={saving} onClick={complete}>Mark onboarding completed</Button>}
        </Can>
      </div>
    </Drawer>
  );
}
