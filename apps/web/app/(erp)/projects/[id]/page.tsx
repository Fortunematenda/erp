'use client';
import { useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Table, Tabs, Timeline, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { ArrowLeftOutlined, DeleteOutlined, FileDoneOutlined, FileTextOutlined, PaperClipOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { CurrencyValue, StatusPill } from '@/components/sales-ui';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskForm] = Form.useForm();
  const [noteText, setNoteText] = useState('');
  const [tsForm, setTsForm] = useState(false);
  const tsEmployees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });
  const fileRef = useRef<HTMLInputElement>(null);

  const q = useQuery({ queryKey: ['/projects', id], queryFn: () => api(`/projects/${id}`) });
  const p = q.data;

  const progress = useMemo(() => {
    const tasks = p?.tasks || [];
    if (!tasks.length) return p?.status === 'Completed' ? 100 : 0;
    return Math.round(tasks.reduce((s: number, t: any) => s + Number(t.progress || 0), 0) / tasks.length);
  }, [p]);

  function invalidateDetail() { qc.invalidateQueries({ queryKey: ['/projects', id] }); }

  const timelineEvents = useMemo(() => {
    if (!p) return [] as any[];
    const ev: any[] = [];
    ev.push({ at: p.createdAt, text: 'Project created', color: 'blue' });
    (p.notes || []).forEach((n: any) => ev.push({ at: n.createdAt, text: `Note added: ${String(n.body).slice(0, 60)}`, color: 'gray' }));
    (p.tasks || []).forEach((t: any) => { ev.push({ at: t.createdAt, text: `Task added: ${t.title}`, color: 'blue' }); if (t.status === 'Done' && t.updatedAt) ev.push({ at: t.updatedAt, text: `Task completed: ${t.title}`, color: 'green' }); });
    (p.invoices || []).forEach((i: any) => ev.push({ at: i.createdAt, text: `Invoice ${i.invoiceNo} created`, color: 'blue' }));
    (p.quotations || []).forEach((q: any) => ev.push({ at: q.createdAt, text: `Quote ${q.quotationNo} created`, color: 'purple' }));
    (p.attachments || []).forEach((a: any) => ev.push({ at: a.createdAt, text: `Picture uploaded: ${a.name}`, color: 'green' }));
    return ev.sort((a, b) => dayjs(b.at).valueOf() - dayjs(a.at).valueOf());
  }, [p]);

  async function setStatus(status: string) {
    try { await api(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); message.success(status === 'Completed' ? 'Project closed' : status === 'Active' ? 'Project opened' : 'Project updated'); invalidateDetail(); }
    catch (e: any) { message.error(e.message); }
  }
  async function doDoc(kind: 'quote' | 'invoice') {
    const qs = new URLSearchParams();
    if (p?.customerId) qs.set('customer', p.customerId);
    qs.set('project', String(id));
    router.push(kind === 'quote' ? `/sales/quotations/new?${qs.toString()}` : `/sales/invoices/new?${qs.toString()}`);
  }
  async function addTask() {
    try {
      const v = await taskForm.validateFields();
      await api(`/projects/${id}/tasks`, { method: 'POST', body: JSON.stringify({ title: v.title, description: v.description, status: v.status || 'Todo', progress: Number(v.progress || 0), dueDate: v.dueDate?.format('YYYY-MM-DD') }) });
      message.success('Task added'); setTaskOpen(false); taskForm.resetFields(); invalidateDetail();
    } catch (e: any) { message.error(e.message || 'Could not add task'); }
  }
  async function updateTaskStatus(t: any, status: string) {
    try { await api(`/projects/${id}/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); invalidateDetail(); } catch (e: any) { message.error(e.message); }
  }
  async function updateTaskProgress(t: any, progress: number) {
    try { await api(`/projects/${id}/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ progress }) }); invalidateDetail(); } catch (e: any) { message.error(e.message); }
  }
  async function deleteTask(t: any) { try { await api(`/projects/${id}/tasks/${t.id}`, { method: 'DELETE' }); invalidateDetail(); } catch (e: any) { message.error(e.message); } }
  async function addNote() {
    if (!noteText.trim()) return;
    try { await api(`/projects/${id}/notes`, { method: 'POST', body: JSON.stringify({ body: noteText }) }); setNoteText(''); invalidateDetail(); } catch (e: any) { message.error(e.message); }
  }
  async function deleteNote(n: any) { try { await api(`/projects/${id}/notes/${n.id}`, { method: 'DELETE' }); invalidateDetail(); } catch (e: any) { message.error(e.message); } }
  async function onFile(e: any) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try { await api(`/projects/${id}/attachments`, { method: 'POST', body: JSON.stringify({ name: file.name, mime: file.type, size: file.size, dataUrl: reader.result }) }); message.success('Picture uploaded'); invalidateDetail(); }
      catch (err: any) { message.error(err.message); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }
  async function deleteAtt(a: any) { try { await api(`/projects/${id}/attachments/${a.id}`, { method: 'DELETE' }); invalidateDetail(); } catch (e: any) { message.error(e.message); } }

  const invCols: ColumnsType<any> = [
    { title: 'Invoice #', dataIndex: 'invoiceNo', render: (v, r) => <Link href={`/sales/invoices/${r.id}/edit`} className="font-mono text-[12px] font-semibold text-[#003366]">{v}</Link> },
    { title: 'Customer', dataIndex: 'customer', render: (_v, r) => <span className="text-[13px] text-[#171a2e]">{r.customer?.name || '—'}</span> },
    { title: 'Date', dataIndex: 'invoiceDate', width: 120, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Amount', dataIndex: 'total', width: 130, align: 'right', render: (v) => <CurrencyValue value={v} /> },
    { title: 'Status', dataIndex: 'status', width: 120, render: (v) => <StatusPill status={v} /> },
  ];

  const quoteCols: ColumnsType<any> = [
    { title: 'Quote #', dataIndex: 'quotationNo', render: (v, r) => <Link href={`/sales/quotations/${r.id}/edit`} className="font-mono text-[12px] font-semibold text-[#003366]">{v}</Link> },
    { title: 'Date', dataIndex: 'quotationDate', width: 120, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Amount', dataIndex: 'total', width: 130, align: 'right', render: (v) => <CurrencyValue value={v} /> },
    { title: 'Status', dataIndex: 'status', width: 120, render: (v) => <StatusPill status={v} /> },
  ];

  const closed = p?.status === 'Completed';
  const isBusy = q.isLoading || !p;

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/projects" className="inline-flex items-center gap-2 rounded-lg border border-[#e6e9f0] px-3 py-1.5 text-[13px] text-[#475060] hover:border-[#cbd5e8]"><ArrowLeftOutlined /> Back</Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] font-bold text-[#171a2e] m-0">{p?.name || 'Project'}</h1>
              {p && <StatusPill status={p.status} />}
            </div>
            <div className="text-[12px] text-[#64748b] mt-1">{p?.projectCode} · {p?.customer?.name || 'No customer'} · Budget {fmtMoney(p?.budget || 0)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={<FileTextOutlined />} onClick={() => doDoc('quote')}>Quote Project</Button>
          <Button type="primary" icon={<FileDoneOutlined />} onClick={() => doDoc('invoice')}>Invoice Project</Button>
          {closed
            ? <Button icon={<ArrowLeftOutlined />} onClick={() => setStatus('Active')}>Reopen</Button>
            : <Button danger icon={<DeleteOutlined />} onClick={() => setStatus('Completed')}>Close Project</Button>}
        </div>
      </div>

      {isBusy ? null : (
        <>
          <div className="nex-card mb-5 p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-medium text-[#344054]">Project Progress</span>
              <span className="text-[13px] font-semibold text-[#003366]">{progress}%</span>
            </div>
            <Progress percent={progress} strokeColor="#003366" showInfo={false} />
            {p?.description && <div className="text-[13px] text-[#64748b] mt-4">{p.description}</div>}
          </div>

          <div className="nex-card">
            <Tabs defaultActiveKey="notes" items={[
              {
                key: 'notes', label: 'Notes', children: (
                  <div className="p-5">
                    <div className="flex gap-2 mb-4">
                      <Input.TextArea rows={2} placeholder="Add a note..." value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                      <Button type="primary" onClick={addNote}>Add Note</Button>
                    </div>
                    <div className="space-y-3">
                      {(p?.notes || []).map((n: any) => (
                        <div key={n.id} className="rounded-lg border border-[#eef0f6] p-4 flex gap-3">
                          <div className="flex-1"><div className="text-[13px] text-[#171a2e] whitespace-pre-wrap">{n.body}</div><div className="text-[11px] text-[#94a3b8] mt-1">{dayjs(n.createdAt).format('DD MMM YY HH:mm')}</div></div>
                          <Popconfirm title="Delete note?" onConfirm={() => deleteNote(n)}><Button size="small" type="text" danger icon={<DeleteOutlined />} /></Popconfirm>
                        </div>
                      ))}
                      {!p?.notes?.length && <div className="text-[13px] text-[#94a3b8]">No notes yet.</div>}
                    </div>
                  </div>
                ),
              },
              {
                key: 'tasks', label: `Tasks (${p?.tasks?.length || 0})`, children: (
                  <div className="p-5">
                    <div className="flex justify-end mb-3"><Button type="primary" icon={<PlusOutlined />} onClick={() => setTaskOpen(true)}>Add Task</Button></div>
                    <div className="space-y-3">
                      {(p?.tasks || []).map((t: any) => (
                        <div key={t.id} className="rounded-lg border border-[#eef0f6] p-4">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0 flex-1"><div className="text-[14px] font-medium text-[#171a2e]">{t.title}</div>{t.description && <div className="text-[12px] text-[#64748b] mt-0.5">{t.description}</div>}</div>
                            <Select size="small" value={t.status} onChange={(v) => updateTaskStatus(t, v)} options={['Todo', 'In Progress', 'Done'].map((s) => ({ label: s, value: s }))} className="!min-w-[130px]" />
                            <Popconfirm title="Delete task?" onConfirm={() => deleteTask(t)}><Button size="small" type="text" danger icon={<DeleteOutlined />} /></Popconfirm>
                          </div>
                          <div className="flex items-center gap-3 mt-3"><span className="text-[12px] text-[#64748b] w-20">Progress</span><InputNumber size="small" min={0} max={100} value={Number(t.progress || 0)} onChange={(v) => updateTaskProgress(t, Number(v || 0))} className="!w-24" /><span className="text-[12px] text-[#94a3b8]">%</span></div>
                        </div>
                      ))}
                      {!p?.tasks?.length && <div className="text-[13px] text-[#94a3b8]">No tasks yet.</div>}
                    </div>
                  </div>
                ),
              },
              {
                key: 'invoices', label: `Invoices (${p?.invoices?.length || 0})`, children: (
                  <div className="p-5"><Table rowKey="id" dataSource={p?.invoices || []} columns={invCols} pagination={false} scroll={{ x: true }} /></div>
                ),
              },
              {
                key: 'quotes', label: `Quotes (${p?.quotations?.length || 0})`, children: (
                  <div className="p-5"><Table rowKey="id" dataSource={p?.quotations || []} columns={quoteCols} pagination={false} scroll={{ x: true }} /></div>
                ),
              },
              {
                key: 'timesheets', label: `Labour (${p?.timesheets?.length || 0})`, children: (
                  <div className="p-5">
                    <div className="flex justify-end mb-3"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setTsForm(true); }}>Add Timesheet</Button></div>
                    <Table rowKey="id" dataSource={p?.timesheets || []} pagination={false} scroll={{ x: true }} columns={[
                      { title: 'Date', dataIndex: 'date', width: 120, render: (v: any) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
                      { title: 'Employee', width: 160, render: (_v: any, r: any) => <span className="text-[13px] text-[#171a2e]">{r.employee?.firstName} {r.employee?.lastName}</span> },
                      { title: 'Hours', dataIndex: 'hours', width: 80, align: 'right', render: (v: any) => <span className="text-[13px] text-[#171a2e]">{v}</span> },
                      { title: 'Cost Rate', dataIndex: 'costRate', width: 100, align: 'right', render: (v: any) => <span className="text-[13px] text-[#64748b]">${Number(v)}</span> },
                      { title: 'Cost', width: 110, align: 'right', render: (_v: any, r: any) => <span className="text-[13px] font-semibold text-[#003366]">{fmtMoney(Number(r.hours) * Number(r.costRate))}</span> },
                      { title: 'Billable', dataIndex: 'billable', width: 90, render: (v: any) => (v ? 'Yes' : 'No') },
                    ] as ColumnsType<any>} />
                    {tsForm && <TimesheetModal open={tsForm} onClose={() => setTsForm(false)} onDone={() => { setTsForm(false); invalidateDetail(); }} projectId={String(id)} />}
                  </div>
                ),
              },
              {
                key: 'timeline', label: 'Timeline', children: (
                  <div className="p-5">
                    <Timeline items={timelineEvents.map((e) => ({ color: e.color, children: (<div><div className="text-[13px] text-[#171a2e]">{e.text}</div><div className="text-[11px] text-[#94a3b8] mt-0.5">{dayjs(e.at).format('DD MMM YYYY, HH:mm')}</div></div>) }))} />
                    {!timelineEvents.length && <div className="text-[13px] text-[#94a3b8]">No activity yet.</div>}
                  </div>
                ),
              },
              {
                key: 'attachments', label: `Pictures (${p?.attachments?.length || 0})`, children: (
                  <div className="p-5">
                    <div className="flex justify-end mb-4">
                      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
                      <Button type="primary" icon={<PaperClipOutlined />} onClick={() => fileRef.current?.click()}>Upload Picture</Button>
                    </div>
                    {p?.attachments?.length ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {p.attachments.map((a: any) => (
                          <div key={a.id} className="rounded-lg border border-[#eef0f6] overflow-hidden group relative">
                            {a.dataUrl ? <img src={a.dataUrl} alt={a.name} className="w-full h-32 object-cover" /> : <div className="h-32 flex items-center justify-center text-[#c7ccdd]"><PaperClipOutlined className="text-3xl" /></div>}
                            <div className="text-[11px] truncate px-2 py-1 text-[#64748b]">{a.name}</div>
                            <Popconfirm title="Remove?" onConfirm={() => deleteAtt(a)}><button className="absolute top-1 right-1 hidden group-hover:flex w-6 h-6 items-center justify-center rounded bg-red-500 text-white text-xs"><DeleteOutlined /></button></Popconfirm>
                          </div>
                        ))}
                      </div>
                    ) : <div className="text-[13px] text-[#94a3b8]">No pictures uploaded yet.</div>}
                  </div>
                ),
              },
            ]} />
          </div>
        </>
      )}

      <Modal open={taskOpen} onCancel={() => setTaskOpen(false)} onOk={addTask} title="Add Task" okText="Add" width={520}>
        <Form form={taskForm} layout="vertical" className="mt-2">
          <Form.Item label="Title" name="title" rules={[{ required: true, message: 'Title required' }]}><Input placeholder="Task title" /></Form.Item>
          <Form.Item label="Description" name="description"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item label="Status" name="status" initialValue="Todo"><Select options={['Todo', 'In Progress', 'Done'].map((s) => ({ label: s, value: s }))} /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Progress (%)" name="progress" initialValue={0}><InputNumber className="w-full" min={0} max={100} /></Form.Item>
            <Form.Item label="Due Date" name="dueDate"><DatePicker className="w-full" /></Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

function TimesheetModal({ open, onClose, onDone, projectId }: { open: boolean; onClose: () => void; onDone: () => void; projectId: string }) {
  const qc = useQueryClient();
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function save() {
    try {
      const v = await form.validateFields();
      setSaving(true);
      await api(`/projects/${projectId}/timesheets`, { method: 'POST', body: JSON.stringify({ employeeId: v.employeeId, date: v.date?.format('YYYY-MM-DD'), hours: Number(v.hours), costRate: Number(v.costRate || 0), billable: v.billable ?? true, description: v.description }) });
      message.success('Timesheet added'); qc.invalidateQueries({ queryKey: ['/projects', projectId] }); onDone();
    } catch (e: any) { message.error(e.message || 'Could not add'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open={open} onCancel={onClose} onOk={save} confirmLoading={saving} title="Add Timesheet" okText="Add" width={460}>
      <Form form={form} layout="vertical" className="mt-2">
        <Form.Item label="Employee" name="employeeId" rules={[{ required: true, message: 'Select employee' }]}><Select showSearch optionFilterProp="label" options={employees.data?.map((e: any) => ({ label: `${e.firstName} ${e.lastName}`, value: e.id }))} /></Form.Item>
        <Form.Item label="Date" name="date"><DatePicker className="w-full" /></Form.Item>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Hours" name="hours" initialValue={8} rules={[{ required: true, message: 'Hours required' }]}><InputNumber className="w-full" min={0} /></Form.Item>
          <Form.Item label="Cost Rate" name="costRate" initialValue={0}><InputNumber className="w-full" prefix="$" min={0} /></Form.Item>
        </div>
        <Form.Item label="Description" name="description"><Input placeholder="What was worked on?" /></Form.Item>
      </Form>
    </Modal>
  );
}
