'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page';
import { Alert, Button, Card, Form, Input, InputNumber, Input as AntInput, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tabs, message } from 'antd';
import { DatabaseOutlined, DownloadOutlined, PlayCircleOutlined, RedoOutlined, SettingOutlined, FileOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

function NumberingConfig() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['/system/numbering'], queryFn: () => api('/system/numbering') });
  const [edit, setEdit] = useState<any>(null);
  const [format, setFormat] = useState('');
  const [start, setStart] = useState(1);
  function open(row: any) { setEdit(row); setFormat(row.format); setStart(row.start); }
  async function save() {
    try { await api(`/system/numbering/${edit.key}`, { method: 'PUT', body: JSON.stringify({ format, start }) }); message.success('Numbering saved'); qc.invalidateQueries({ queryKey: ['/system/numbering'] }); setEdit(null); } catch (e: any) { message.error(e.message); }
  }
  async function reset(key: string) {
    try { await api(`/system/numbering/${key}`, { method: 'DELETE' }); message.success('Reset to default'); qc.invalidateQueries({ queryKey: ['/system/numbering'] }); } catch (e: any) { message.error(e.message); }
  }
  const cols: ColumnsType<any> = [
    { title: 'Type', dataIndex: 'key', width: 90, render: (v) => <Tag color="blue">{v}</Tag> },
    { title: 'Format', dataIndex: 'format', render: (v) => <code className="text-[12px] bg-slate-50 px-2 py-0.5 rounded">{v}</code> },
    { title: 'Start', dataIndex: 'start', width: 80 },
    { title: 'Next', dataIndex: 'next', width: 80, render: (v) => v ?? '—' },
    { title: 'Actions', width: 150, align: 'right', render: (_v, r) => <Space><Button size="small" onClick={() => open(r)}>Edit</Button><Popconfirm title="Reset to default?" onConfirm={() => reset(r.key)}><Button size="small" danger>Reset</Button></Popconfirm></Space> },
  ];
  return (
    <Card title="Document Numbering" className="nex-card" styles={{ body: { padding: 0 } }}>
      <Table rowKey="key" size="small" dataSource={data.data?.items || []} columns={cols} pagination={false} scroll={{ y: 420 }} />
      <Modal open={!!edit} onCancel={() => setEdit(null)} onOk={save} title={`Numbering — ${edit?.key}`}>
        <Space direction="vertical" className="w-full">
          <div className="text-[12px] text-slate-500">{'Supports {prefix}, {year}, {seq} and padding like {seq:0000}. Must contain {seq}.'}</div>
          <Input value={format} onChange={(e) => setFormat(e.target.value)} placeholder={'{prefix}-{seq:000000}'} />
          <InputNumber value={start} onChange={(v) => setStart(v as number)} min={1} addonBefore="Start" className="w-full" />
        </Space>
      </Modal>
    </Card>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['/system/preferences'], queryFn: () => api('/system/preferences') });
  const [form] = Form.useForm();
  async function save(v: any) { try { await api('/system/preferences', { method: 'POST', body: JSON.stringify(v) }); message.success('Preferences saved'); qc.invalidateQueries({ queryKey: ['/system/preferences'] }); } catch (e: any) { message.error(e.message); } }
  return (
    <Card title="Company Preferences" className="nex-card">
      <Form form={form} layout="vertical" initialValues={data.data || {}} className="max-w-xl" onFinish={save}>
        <Form.Item label="Base currency" name="currency"><Input /></Form.Item>
        <Form.Item label="Default VAT %" name="vatDefault"><InputNumber min={0} max={100} /></Form.Item>
        <Form.Item label="Invoice due days" name="invoiceDueDays"><InputNumber min={0} max={365} /></Form.Item>
        <Form.Item label="PDF footer" name="pdfFooter"><Input.TextArea rows={3} /></Form.Item>
        <Button type="primary" htmlType="submit">Save preferences</Button>
      </Form>
    </Card>
  );
}

function Jobs() {
  const qc = useQueryClient();
  const [intervalEdit, setIntervalEdit] = useState<{ id: string; v: number } | null>(null);
  const data = useQuery({ queryKey: ['/system/jobs'], queryFn: () => api('/system/jobs') });
  async function toggle(row: any) { try { await api(`/system/jobs/${row.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !row.enabled }) }); message.success('Job updated'); qc.invalidateQueries({ queryKey: ['/system/jobs'] }); } catch (e: any) { message.error(e.message); } }
  async function run(id: string) { try { const r = await api(`/system/jobs/${id}/run`, { method: 'POST' }); r.status === 'OK' ? message.success('Job completed') : message.error(r.error || 'Job failed'); qc.invalidateQueries({ queryKey: ['/system/jobs'] }); } catch (e: any) { message.error(e.message); } }
  async function saveInterval() { try { await api(`/system/jobs/${intervalEdit!.id}`, { method: 'PUT', body: JSON.stringify({ intervalSeconds: intervalEdit!.v }) }); message.success('Interval saved'); setIntervalEdit(null); qc.invalidateQueries({ queryKey: ['/system/jobs'] }); } catch (e: any) { message.error(e.message); } }
  const cols: ColumnsType<any> = [
    { title: 'Job', dataIndex: 'name' },
    { title: 'Type', dataIndex: 'type', width: 160, render: (v) => <Tag>{v}</Tag> },
    { title: 'Interval', width: 110, render: (_v, r) => <span className="text-[12px]">{Math.round(r.intervalSeconds / 60)} min</span> },
    { title: 'Enabled', dataIndex: 'enabled', width: 90, render: (v, r) => <Switch checked={v} size="small" onChange={() => toggle(r)} /> },
    { title: 'Last run', dataIndex: 'lastStatus', width: 90, render: (v) => <Tag color={v === 'OK' ? 'green' : v === 'ERROR' ? 'red' : 'default'}>{v || 'NEVER'}</Tag> },
    { title: 'Runs', dataIndex: 'runCount', width: 70, align: 'right' },
    { title: 'Actions', width: 110, align: 'right', render: (_v, r) => <Space><Button size="small" icon={<PlayCircleOutlined />} onClick={() => run(r.id)}>Run</Button><Button size="small" onClick={() => setIntervalEdit({ id: r.id, v: r.intervalSeconds })}>Set</Button></Space> },
  ];
  return (
    <>
      <Card title="Scheduled Jobs" className="nex-card" styles={{ body: { padding: 0 } }}>
        <Table rowKey="id" size="small" dataSource={data.data || []} columns={cols} pagination={false} />
      </Card>
      <Modal open={!!intervalEdit} onCancel={() => setIntervalEdit(null)} onOk={saveInterval} title="Set interval">
        <InputNumber value={intervalEdit?.v} onChange={(v) => setIntervalEdit((p) => p && { ...p, v: v as number })} min={30} addonAfter="seconds" className="w-full" />
      </Modal>
    </>
  );
}

function Backups() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['/system/backups'], queryFn: () => api('/system/backups') });
  const [busy, setBusy] = useState(false);
  async function create() { setBusy(true); try { const b = await api('/system/backups', { method: 'POST' }); message.success(`Backup created (${b.filename})`); qc.invalidateQueries({ queryKey: ['/system/backups'] }); } catch (e: any) { message.error(e.message); } finally { setBusy(false); } }
  async function restore(id: string) { try { const r = await api(`/system/backups/${id}/restore`, { method: 'POST' }); message.success(r.message); qc.invalidateQueries(); } catch (e: any) { message.error(e.message); } }
  const cols: ColumnsType<any> = [
    { title: 'File', dataIndex: 'filename', render: (v) => <span className="font-mono text-[12px]">{v}</span> },
    { title: 'Size', dataIndex: 'size', width: 100, align: 'right', render: (v) => `${(v / 1024).toFixed(1)} KB` },
    { title: 'Encrypted', dataIndex: 'encrypted', width: 100, render: (v) => (v ? <Tag color="green">yes</Tag> : <Tag>no</Tag>) },
    { title: 'Status', dataIndex: 'status', width: 100, render: (v) => <Tag color={v === 'DONE' ? 'green' : v === 'FAILED' ? 'red' : 'default'}>{v}</Tag> },
    { title: 'Created', dataIndex: 'createdAt', width: 180, render: (v) => new Date(v).toLocaleString() },
    { title: 'Actions', width: 190, align: 'right', render: (_v, r) => <Space>
      <Button size="small" icon={<DownloadOutlined />} href={`${process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000/api'}/system/backups/${r.id}/download`}>Download</Button>
      <Popconfirm title="Restore will replace the database. Continue?" onConfirm={() => restore(r.id)}><Button size="small" danger icon={<RedoOutlined />}>Restore</Button></Popconfirm>
    </Space> },
  ];
  return (
    <Card title="Database Backups" className="nex-card" styles={{ body: { padding: 0 } }}
      extra={<Button type="primary" loading={busy} icon={<DatabaseOutlined />} onClick={create}>Create backup</Button>}>
      <Table rowKey="id" size="small" dataSource={data.data || []} columns={cols} pagination={false} />
      <Alert className="m-4" type="info" showIcon icon={<SettingOutlined />} message="Backups use pg_dump (custom format). Restore is guarded to platform admins only." />
    </Card>
  );
}

export default function DataJobs() {
  const items = [
    { key: 'jobs', label: 'Jobs', children: <Jobs /> },
    { key: 'backups', label: 'Backups', children: <Backups /> },
    { key: 'numbering', label: 'Numbering', children: <NumberingConfig /> },
    { key: 'preferences', label: 'Preferences', children: <Preferences /> },
  ];
  return (<> <PageHeader title="Data & Jobs" subtitle="Automated jobs, database backups, document numbering and company preferences" /> <Card className="nex-card"><Tabs items={items} /></Card> </>);
}

