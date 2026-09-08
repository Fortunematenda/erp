'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Table, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, CheckOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill } from '@/components/sales-ui';

export default function OnboardingPage() {
  const qc = useQueryClient();
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });
  const templates = useQuery({ queryKey: ['/hr/onboarding-templates'], queryFn: () => api('/hr/onboarding-templates') });
  const onboardings = useQuery({ queryKey: ['/hr/employee-onboardings'], queryFn: () => api('/hr/employee-onboardings') });
  const [tplOpen, setTplOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [tplForm] = Form.useForm();
  const [startForm] = Form.useForm();
  const [tplTasks, setTplTasks] = useState<string[]>(['Contract Signed', 'ID Received', 'Bank Details', 'System Account']);

  async function saveTpl() {
    try {
      const v = await tplForm.validateFields();
      await api('/hr/onboarding-templates', { method: 'POST', body: JSON.stringify({ name: v.name, tasks: tplTasks.map((t) => ({ title: t, dueInDays: 0 })) }) });
      setTplOpen(false); tplForm.resetFields(); setTplTasks([]); qc.invalidateQueries({ queryKey: ['/hr/onboarding-templates'] });
    } catch (e: any) { message.error(e.message || 'Could not save'); }
  }
  async function start() {
    try {
      const v = await startForm.validateFields();
      await api(`/hr/employees/${v.employeeId}/onboarding`, { method: 'POST', body: JSON.stringify({ templateId: v.templateId }) });
      setStartOpen(false); startForm.resetFields(); qc.invalidateQueries({ queryKey: ['/hr/employee-onboardings'] });
    } catch (e: any) { message.error(e.message); }
  }
  async function toggleTask(ob: any, taskTitle: string, done: boolean) {
    const taskStatus: Record<string, boolean> = ob.taskStatus || {};
    taskStatus[taskTitle] = done;
    await api(`/hr/employee-onboardings/${ob.id}`, { method: 'PATCH', body: JSON.stringify({ taskStatus }) }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['/hr/employee-onboardings'] });
  }

  const tplCols: ColumnsType<any> = [
    { title: 'Template', dataIndex: 'name', render: (v) => <span className="text-[13px] font-medium text-[#171a2e]">{v}</span> },
    { title: 'Tasks', width: 120, render: (_, r) => r.tasks?.length || 0 },
  ];
  const obCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => <span className="text-[13px] text-[#171a2e]">{r.employee?.firstName} {r.employee?.lastName}</span> },
    { title: 'Template', render: (_v, r) => <span className="text-[12px] text-[#64748b]">{r.template?.name}</span> },
    { title: 'Status', dataIndex: 'status', width: 130, render: (v) => <StatusPill status={v.replace(/_/g, ' ')} /> },
    {
      title: 'Checklist', render: (_, r) => (
        <div className="flex flex-wrap gap-2">
          {(r.template?.tasks || []).map((t: any) => (
            <button key={t.id} onClick={() => toggleTask(r, t.title, !(r.taskStatus?.[t.title] || false))} className={`text-[11px] px-2 py-1 rounded-full border ${r.taskStatus?.[t.title] ? 'bg-green-50 border-green-200 text-green-700' : 'border-[#e6e9f0] text-[#64748b]'}`}>{r.taskStatus?.[t.title] ? '✓ ' : ''}{t.title}</button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Onboarding</h1><p className="text-[13px] text-[#64748b] mt-1">Templates and task checklists for new employees</p></div>
        <Can permission="hr.employees.manage"><Button icon={<ReloadOutlined />} onClick={() => { templates.refetch(); onboardings.refetch(); }}>Refresh</Button></Can>
      </div>
      <Tabs defaultActiveKey="templates" items={[
        { key: 'templates', label: 'Templates', children: <div className="nex-card"><div className="flex justify-end px-4 pt-3"><Button type="primary" icon={<PlusOutlined />} onClick={() => setTplOpen(true)}>New Template</Button></div><Table rowKey="id" loading={templates.isLoading} dataSource={templates.data || []} columns={tplCols} pagination={false} /></div> },
        { key: 'outcomes', label: 'Employee Onboarding', children: <div className="nex-card"><div className="flex justify-end px-4 pt-3"><Button type="primary" icon={<PlusOutlined />} onClick={() => setStartOpen(true)}>Start Onboarding</Button></div><Table rowKey="id" loading={onboardings.isLoading} dataSource={onboardings.data || []} columns={obCols} pagination={false} /></div> },
      ]} />
      <Modal open={tplOpen} onCancel={() => setTplOpen(false)} onOk={saveTpl} title="New Onboarding Template" okText="Save" width={480}>
        <Form form={tplForm} layout="vertical" className="mt-2">
          <Form.Item label="Name" name="name" rules={[{ required: true }]}><Input placeholder="Standard Onboarding" /></Form.Item>
          <div className="text-[13px] font-semibold text-[#344054] mb-2">Tasks</div>
          <div className="space-y-2">
            {tplTasks.map((t, i) => (
              <div key={i} className="flex gap-2"><Input value={t} onChange={(e) => setTplTasks((p) => p.map((x, j) => (j === i ? e.target.value : x)))} /><Button onClick={() => setTplTasks((p) => p.filter((_, j) => j !== i))}>x</Button></div>
            ))}
          </div>
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setTplTasks((p) => [...p, ''])} className="mt-2">Add Task</Button>
        </Form>
      </Modal>
      <Modal open={startOpen} onCancel={() => setStartOpen(false)} onOk={start} title="Start Onboarding" okText="Start" width={440}>
        <Form form={startForm} layout="vertical" className="mt-2">
          <Form.Item label="Employee" name="employeeId" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={employees.data?.map((e: any) => ({ label: `${e.firstName} ${e.lastName}`, value: e.id }))} /></Form.Item>
          <Form.Item label="Template" name="templateId" rules={[{ required: true }]}><Select options={templates.data?.map((t: any) => ({ label: t.name, value: t.id }))} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

