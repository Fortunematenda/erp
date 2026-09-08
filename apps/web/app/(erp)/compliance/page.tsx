'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Table, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertOutlined, CalendarOutlined, CheckCircleOutlined, FireOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { CrudPage, StatusTag } from '@/components/crud-page';
import { StatCard } from '@/components/stat-card';
import { fmtDate } from '@/lib/format';
import { Can } from '@/components/Can';

const RISK_FIELDS = [
  { name: 'code', label: 'Code' }, { name: 'title', label: 'Title', required: true },
  { name: 'category', label: 'Category', required: true, type: 'select' as const, options: ['OPERATIONAL', 'FINANCIAL', 'LEGAL', 'REGULATORY', 'REPUTATIONAL', 'STRATEGIC', 'OTHER'].map((c) => ({ label: c, value: c })) },
  { name: 'description', label: 'Description', type: 'textarea' as const },
  { name: 'likelihood', label: 'Likelihood (1-5)', type: 'number' as const }, { name: 'impact', label: 'Impact (1-5)', type: 'number' as const },
  { name: 'residualLikelihood', label: 'Residual likelihood (1-5)', type: 'number' as const, defaultValue: 1 }, { name: 'residualImpact', label: 'Residual impact (1-5)', type: 'number' as const, defaultValue: 1 },
  { name: 'controls', label: 'Controls', type: 'textarea' as const },
  { name: 'owner', label: 'Owner' }, { name: 'status', label: 'Status', type: 'select' as const, options: ['OPEN', 'MITIGATING', 'MONITORING', 'CLOSED'].map((s) => ({ label: s, value: s })), defaultValue: 'OPEN' },
  { name: 'mitigation', label: 'Mitigation', type: 'textarea' as const },
  { name: 'dueDate', label: 'Due date', type: 'date' as const }, { name: 'reviewDate', label: 'Review date', type: 'date' as const },
];
const RISK_COLS = [
  { title: 'Code', dataIndex: 'code', width: 100 }, { title: 'Risk', dataIndex: 'title' },
  { title: 'Category', dataIndex: 'category', width: 120 },
  { title: 'Likelihood', dataIndex: 'likelihood', width: 90, align: 'right' as const },
  { title: 'Impact', dataIndex: 'impact', width: 90, align: 'right' as const },
  { title: 'Rating', align: 'right' as const, width: 90, render: (_: any, r: any) => <span className="text-[12px] font-semibold" style={{ color: (Number(r.likelihood || 1) * Number(r.impact || 1)) >= 12 ? '#EF4444' : (Number(r.likelihood || 1) * Number(r.impact || 1)) >= 6 ? '#F59E0B' : '#16A34A' }}>{Number(r.likelihood || 1) * Number(r.impact || 1)}</span> },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
];

function ControlsTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['/compliance/internal-controls'], queryFn: () => api('/compliance/internal-controls') });
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  async function save() { try { const v = await form.validateFields(); await api('/compliance/internal-controls', { method: 'POST', body: JSON.stringify(v) }); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['/compliance/internal-controls'] }); } catch (e: any) { message.error(e.message); } }
  async function test(id: string, result: string) { try { await api(`/compliance/internal-controls/${id}/test`, { method: 'POST', body: JSON.stringify({ result }) }); qc.invalidateQueries({ queryKey: ['/compliance/internal-controls'] }); } catch (e: any) { message.error(e.message); } }
  const cols: ColumnsType<any> = [
    { title: 'Control ID', dataIndex: 'controlId', width: 110, render: (v) => <span className="font-mono text-[12px] text-[#003366]">{v}</span> },
    { title: 'Process', dataIndex: 'process' },
    { title: 'Owner', dataIndex: 'owner', width: 120 },
    { title: 'Design Eff.', dataIndex: 'designEffectiveness', width: 110, render: (v) => <StatusTag value={v || 'Not rated'} /> },
    { title: 'Operating Eff.', dataIndex: 'operatingEffectiveness', width: 110, render: (v) => <StatusTag value={v || 'Not rated'} /> },
    { title: 'Next Test', dataIndex: 'nextTest', width: 120, render: (v) => (v ? fmtDate(v) : '—') },
    { title: 'Actions', width: 160, render: (_, r) => <div className="flex gap-1 justify-end"><Button size="small" onClick={() => test(r.id, 'EFFECTIVE')}>Effective</Button><Button size="small" onClick={() => test(r.id, 'INEFFECTIVE')}>Ineffective</Button></div> },
  ];
  return (
    <div>
      <div className="flex justify-end mb-4"><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Add Control</Button></div>
      <Table rowKey="id" loading={list.isLoading} dataSource={list.data || []} columns={cols} pagination={false} scroll={{ x: true }} />
      <Modal open={open} onCancel={() => setOpen(false)} onOk={save} title="Add Internal Control" okText="Save" width={520}>
        <Form form={form} layout="vertical" className="mt-2">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Control ID" name="controlId" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="Process" name="process" rules={[{ required: true }]}><Input /></Form.Item>
          </div>
          <Form.Item label="Owner" name="owner"><Input /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Frequency" name="frequency"><Select options={['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].map((f) => ({ label: f, value: f }))} /></Form.Item>
            <Form.Item label="Next Test" name="nextTest"><DatePicker className="w-full" /></Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

function AuditsTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['/compliance/audits'], queryFn: () => api('/compliance/audits') });
  const [open, setOpen] = useState(false);
  const [findingOpen, setFindingOpen] = useState(false);
  const [eng, setEng] = useState<any>(null);
  const [aForm] = Form.useForm();
  const [fForm] = Form.useForm();
  async function save() { try { const v = await aForm.validateFields(); await api('/compliance/audits', { method: 'POST', body: JSON.stringify(v) }); setOpen(false); aForm.resetFields(); qc.invalidateQueries({ queryKey: ['/compliance/audits'] }); } catch (e: any) { message.error(e.message); } }
  async function addFinding() { try { const v = await fForm.validateFields(); await api(`/compliance/audits/${eng.id}/findings`, { method: 'POST', body: JSON.stringify(v) }); setFindingOpen(false); fForm.resetFields(); qc.invalidateQueries({ queryKey: ['/compliance/audits'] }); } catch (e: any) { message.error(e.message); } }
  const cols: ColumnsType<any> = [
    { title: 'Engagement', dataIndex: 'name', render: (v) => <span className="text-[13px] font-medium text-[#171a2e]">{v}</span> },
    { title: 'Scope', dataIndex: 'scope' },
    { title: 'Status', dataIndex: 'status', width: 130, render: (v) => <StatusTag value={v.replace(/_/g, ' ')} /> },
    { title: 'Procedures', width: 110, render: (_, r) => r.procedures?.length || 0 },
    { title: 'Findings', width: 100, render: (_, r) => r.findings?.length || 0 },
    { title: 'Actions', width: 130, render: (_, r) => <Button size="small" onClick={() => { setEng(r); setFindingOpen(true); }}>Add Finding</Button> },
  ];
  return (
    <div>
      <div className="flex justify-end mb-4"><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>New Engagement</Button></div>
      <Table rowKey="id" loading={list.isLoading} dataSource={list.data || []} columns={cols} pagination={false} scroll={{ x: true }} expandable={{ expandedRowRender: (r) => <div className="space-y-1">{r.findings?.map((f: any) => <div key={f.id} className="text-[13px]">• {f.title} <StatusTag value={f.severity} /> <span className="text-[#94a3b8]">({f.status})</span></div>)}</div> }} />
      <Modal open={open} onCancel={() => setOpen(false)} onOk={save} title="New Audit Engagement" okText="Save" width={480}>
        <Form form={aForm} layout="vertical" className="mt-2">
          <Form.Item label="Name" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Scope" name="scope"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
      <Modal open={findingOpen} onCancel={() => setFindingOpen(false)} onOk={addFinding} title={`Add Finding — ${eng?.name}`} okText="Save" width={480}>
        <Form form={fForm} layout="vertical" className="mt-2">
          <Form.Item label="Title" name="title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Severity" name="severity" initialValue="LOW"><Select options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => ({ label: s, value: s }))} /></Form.Item>
          <Form.Item label="Management Response" name="managementResponse"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default function Compliance() {
  const qc = useQueryClient();
  const risks = useQuery({ queryKey: ['/compliance/risks'], queryFn: () => api('/compliance/risks') });
  const obligations = useQuery({ queryKey: ['/compliance/obligations'], queryFn: () => api('/compliance/obligations') });
  const excluded = useQuery({ queryKey: ['/compliance/exceptions'], queryFn: () => api('/compliance/exceptions') });
  const reg = useQuery({ queryKey: ['/compliance/regulatory-reports'], queryFn: () => api('/compliance/regulatory-reports') });
  const [regOpen, setRegOpen] = useState(false);
  const [regForm] = Form.useForm();

  const openRisks = (risks.data || []).filter((r: any) => r.status !== 'CLOSED');
  const highRisk = openRisks.filter((r: any) => Number(r.likelihood || 0) * Number(r.impact || 0) >= 12);
  const overdue = (obligations.data || []).filter((o: any) => o.status === 'OVERDUE');

  const excCols: ColumnsType<any> = [
    { title: 'Type', dataIndex: 'type', render: (v) => <span className="text-[13px] font-medium text-[#171a2e]">{v}</span> },
    { title: 'Value', dataIndex: 'value', width: 140, align: 'right', render: (v) => <span className="text-[13px] font-semibold text-[#EF4444]">{v}</span> },
  ];
  const regCols: ColumnsType<any> = [
    { title: 'Report', dataIndex: 'name', render: (v) => <span className="text-[13px] font-medium text-[#171a2e]">{v}</span> },
    { title: 'Authority', dataIndex: 'authority', width: 140 },
    { title: 'Period', dataIndex: 'period', width: 120 },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusTag value={v} /> },
    { title: 'Generated', width: 120, render: (_, r) => (r.generatedAt ? fmtDate(r.generatedAt) : '—') },
  ];
  async function saveReg() { try { const v = await regForm.validateFields(); await api('/compliance/regulatory-reports', { method: 'POST', body: JSON.stringify(v) }); setRegOpen(false); regForm.resetFields(); qc.invalidateQueries({ queryKey: ['/compliance/regulatory-reports'] }); } catch (e: any) { message.error(e.message); } }

  const items = [
    { key: 'risks', label: 'Risk Register', children: <CrudPage title="Risks" path="/compliance/risks" createLabel="Risk" canDelete columns={RISK_COLS} fields={RISK_FIELDS} /> },
    { key: 'obligations', label: 'Obligations', children: <CrudPage title="Compliance Obligations" path="/compliance/obligations" createLabel="Obligation" canDelete columns={[{ title: 'Authority', dataIndex: 'authority', width: 130 }, { title: 'Obligation', dataIndex: 'title' }, { title: 'Due', dataIndex: 'dueDate', width: 110, render: (v: any) => (v ? fmtDate(v) : '—') }, { title: 'Frequency', dataIndex: 'frequency', width: 110 }, { title: 'Reminder (days)', dataIndex: 'reminderDays', width: 130 }, { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> }]} fields={[{ name: 'authority', label: 'Authority', required: true }, { name: 'title', label: 'Title', required: true }, { name: 'dueDate', label: 'Due date', type: 'date' as const }, { name: 'reminderDays', label: 'Reminder (days)', type: 'number' as const, defaultValue: 0 }, { name: 'frequency', label: 'Frequency', type: 'select' as const, options: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_OFF'].map((f) => ({ label: f, value: f })), defaultValue: 'MONTHLY' }, { name: 'status', label: 'Status', type: 'select' as const, options: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'].map((s) => ({ label: s, value: s })), defaultValue: 'PENDING' }, { name: 'notes', label: 'Notes', type: 'textarea' as const }, { name: 'evidence', label: 'Evidence', type: 'textarea' as const }]} /> },
    { key: 'calendar', label: 'Compliance Calendar', children: <CrudPage title="Compliance Obligations" path="/compliance/calendar" hideCreate hideEdit canDelete columns={[{ title: 'Due', dataIndex: 'dueDate', width: 110, render: (v: any) => (v ? fmtDate(v) : '—') }, { title: 'Authority', dataIndex: 'authority', width: 120 }, { title: 'Obligation', dataIndex: 'title' }, { title: 'Reminder', dataIndex: 'reminderDays', width: 100 }, { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> }]} /> },
    { key: 'controls', label: 'Internal Controls', children: <ControlsTab /> },
    { key: 'audits', label: 'Audit Management', children: <AuditsTab /> },
    { key: 'exceptions', label: 'Exceptions', children: <div className="nex-card"><Table rowKey="type" loading={excluded.isLoading} dataSource={excluded.data || []} columns={excCols} pagination={false} /></div> },
    { key: 'regulatory', label: 'Regulatory Reports', children: <div className="nex-card"><div className="flex justify-end p-4"><Button type="primary" icon={<PlusOutlined />} onClick={() => setRegOpen(true)}>Add Report</Button></div><Table rowKey="id" loading={reg.isLoading} dataSource={reg.data || []} columns={regCols} pagination={false} /></div> },
  ];
  return (
    <div className="nex-fade">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<FireOutlined />} label="Open risks" value={openRisks.length} hint={`${highRisk.length} high (L×I ≥ 12)`} />
        <StatCard icon={<AlertOutlined />} label="High risks" value={highRisk.length} hint="Needs attention" />
        <StatCard icon={<CalendarOutlined />} label="Obligations" value={obligations.data?.length || 0} hint={`${overdue.length} overdue`} />
        <StatCard icon={<CheckCircleOutlined />} label="Exceptions" value={excluded.data?.length || 0} hint="Detected exceptions" />
      </div>
      <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}><Tabs items={items} defaultActiveKey="obligations" destroyOnHidden /></Card>
      <Modal open={regOpen} onCancel={() => setRegOpen(false)} onOk={saveReg} title="Add Regulatory Report" okText="Save" width={460}>
        <Form form={regForm} layout="vertical" className="mt-2">
          <Form.Item label="Report" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Authority" name="authority"><Input /></Form.Item>
          <Form.Item label="Period" name="period"><Input placeholder="e.g. 2026-Q3" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}


