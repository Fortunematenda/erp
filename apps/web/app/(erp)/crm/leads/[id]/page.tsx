'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, Checkbox, DatePicker, Descriptions, Dropdown, Empty, Form, Input, InputNumber, message, Modal, Select, Space, Table, Tabs, Tag, Timeline, Popconfirm } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined, CalendarOutlined, CheckCircleOutlined, CloseCircleOutlined, DollarOutlined, DownOutlined, EditOutlined, FileTextOutlined, MailOutlined, PhoneOutlined, PlusOutlined, ProjectOutlined, RightOutlined, TeamOutlined, UserOutlined, AimOutlined, HomeOutlined, ShoppingOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { CRM_STAGES, LEAD_PRIORITY, LEAD_SOURCES, LOST_REASONS, stageDef } from '@/lib/crm';
import { EmployeeSelector } from '@/components/employee-selector';

const d = (v: any) => (v ? dayjs(v) : null);

export default function LeadDetail() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: lead, isLoading } = useQuery({ queryKey: ['crm', 'lead', id], queryFn: () => api(`/crm/leads/${id}`) });
  const customers = useQuery({ queryKey: ['/sales/customers'], queryFn: () => api('/sales/customers') });
  const [edit, setEdit] = useState(false);
  const [content, setContent] = useState('Overview');
  const [taskModal, setTaskModal] = useState(false);
  const [actModal, setActModal] = useState(false);
  const [lostModal, setLostModal] = useState(false);
  const [wonModal, setWonModal] = useState(false);
  const [convertModal, setConvertModal] = useState(false);
  const [editForm] = Form.useForm();
  const [taskForm] = Form.useForm();
  const [actForm] = Form.useForm();
  const [lostReason, setLostReason] = useState('');
  const [wizard, setWizard] = useState(false);
  const [wizChoices, setWizChoices] = useState<Record<string, boolean>>({ salesOrder: false, project: false, invoice: false, service: false });
  const [serviceModal, setServiceModal] = useState(false);
  const [svcForm] = Form.useForm();

  if (isLoading) return <div className="p-8 text-[#8a90ad]">Loading lead…</div>;
  if (!lead) return <Empty description="Lead not found" />;
  const sd = stageDef(lead.stage);
  const fin = lead.related?.financial;
  const activities = lead.interactions || [];
  const events = lead.crmEvents || [];
  const tasks = lead.related?.tasks || [];
  const quotes = lead.quotations || [];
  const oppQuotes = (lead.opportunities || []).flatMap((o: any) => o.quotations || []);
  const allQuotes = [...quotes, ...oppQuotes].filter((q, i, a) => a.findIndex((x) => x.id === q.id) === i);

  function refresh() { qc.invalidateQueries({ queryKey: ['crm', 'lead', id] }); qc.invalidateQueries({ queryKey: ['crm', 'leads'] }); qc.invalidateQueries({ queryKey: ['/sales/customers'] }); }
  const opp = lead?.opportunities?.[0];
  const acceptedQuote = opp?.quotations?.find((q: any) => String(q.status).toUpperCase() === 'ACCEPTED');
  const existingOrder = lead.related?.salesOrders?.[0];
  const existingProject = lead.related?.projects?.[0];
  const customerReady = !!lead.convertedCustomerId || !!opp?.customerId;

  async function setOwner(v: string) {
    try {
      const emps = await api('/crm/employees');
      const e = emps.find((x: any) => x.id === v);
      await api(`/crm/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ owner: e?.name, ownerId: v }) }); message.success('Owner updated'); refresh();
    } catch (err: any) { message.error(err.message); }
  }
  async function setAssignee(v: string) {
    try {
      const emps = await api('/crm/employees');
      const e = emps.find((x: any) => x.id === v);
      await api(`/crm/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ assignee: e?.name, assigneeId: v }) }); message.success('Assignee updated'); refresh();
    } catch (err: any) { message.error(err.message); }
  }

  async function createQuote() {
    try {
      let q;
      if (opp) { q = await api(`/crm/opportunities/${opp.id}/quote`, { method: 'POST', body: '{}' }); }
      else { q = await api(`/crm/leads/${lead.id}/quote`, { method: 'POST', body: JSON.stringify({ customerId: lead.convertedCustomerId, opportunityId: undefined }) }); }
      if (q?.needsCustomer) { message.warning('This opportunity is not linked to a customer. Convert/link a customer first.'); return; }
      if (q?.pending) { message.info('A possible duplicate customer was found — link/create a customer first.'); return; }
      message.success(`Quote ${q.quotationNo || ''} created`); router.push(`/sales/quotations/${q.id}/edit`); refresh();
    } catch (e: any) { message.error(e.message); }
  }
  async function convertAcceptedQuote(kind: 'SO' | 'INVOICE') {
    if (!acceptedQuote) { message.info('Create and accept a quote first (use Create Quote).'); return; }
    try {
      const res = await api(`/sales/quotations/${acceptedQuote.id}/${kind === 'SO' ? 'convert' : 'convert-invoice'}`, { method: 'POST', body: '{}' });
      message.success(kind === 'SO' ? `Sales order ${res.orderNo || ''} created` : `Invoice ${res.invoiceNo || ''} created`);
      refresh(); router.push(kind === 'SO' ? `/sales/orders/${res.id}/edit` : `/sales/invoices/${res.id}/edit`);
    } catch (e: any) { message.error(e.message); }
  }
  async function createProject() {
    if (!opp) { message.info('Convert this lead to an opportunity first to create a project.'); return; }
    if (existingProject) { router.push(`/projects/${existingProject.id}`); return; }
    try {
      const p = await api(`/crm/opportunities/${opp.id}/project`, { method: 'POST', body: JSON.stringify({ name: `${lead.companyName || lead.name} — Project`, currency: opp.currency || 'USD', projectManager: lead.owner }) });
      if (p?.needsCustomer) { message.warning('Link/create a customer first.'); return; }
      message.success(`Project ${p.projectCode} created`); router.push(`/projects/${p.id}`); refresh();
    } catch (e: any) { message.error(e.message); }
  }
  async function runWizard() {
    let created = 0;
    try {
      if (wizChoices.salesOrder && acceptedQuote) { await api(`/sales/quotations/${acceptedQuote.id}/convert`, { method: 'POST', body: '{}' }); created++; }
      if (wizChoices.invoice && acceptedQuote) { await api(`/sales/quotations/${acceptedQuote.id}/convert-invoice`, { method: 'POST', body: '{}' }); created++; }
      if (wizChoices.project && opp) { await api(`/crm/opportunities/${opp.id}/project`, { method: 'POST', body: JSON.stringify({ name: `${lead.companyName || lead.name} — Project`, currency: opp.currency || 'USD' }) }); created++; }
      if (wizChoices.service && opp) { await api(`/crm/opportunities/${opp.id}/service-ticket`, { method: 'POST', body: JSON.stringify({ subject: `Post-sale support — ${lead.name}`, priority: 'NORMAL' }) }); created++; }
      message.success(created ? `${created} downstream record(s) created.` : 'Opportunity won. Nothing created.'); setWizard(false); refresh();
    } catch (e: any) { message.error(e.message); }
  }
  async function createService() {
    const v = await svcForm.validateFields().catch(() => null);
    if (!v) return;
    try {
      const payload = { ...v, subject: v.subject, priority: v.priority || 'NORMAL', description: v.description, assignedTo: (await api('/crm/employees')).find((x: any) => x.id === v.assignedToId)?.name };
      if (opp) await api(`/crm/opportunities/${opp.id}/service-ticket`, { method: 'POST', body: JSON.stringify(payload) });
      else await api('/crm/tickets', { method: 'POST', body: JSON.stringify({ customerId: lead.convertedCustomerId, subject: v.subject, priority: v.priority || 'NORMAL' }) });
      message.success('Service ticket created'); setServiceModal(false); refresh();
    } catch (e: any) { message.error(e.message); }
  }
  const nextActionItems = [
    ...(['QUALIFIED', 'OPPORTUNITY', 'PROPOSAL', 'NEGOTIATION', 'WON'].includes(lead.stage) ? [{ key: 'quote', label: 'Create Quote', icon: <FileTextOutlined /> }] : []),
    ...(lead.stage === 'WON' ? [
      existingOrder ? { key: 'salesOrder', label: 'Open Sales Order', icon: <ShoppingOutlined /> } : { key: 'salesOrder', label: 'Create Sales Order', icon: <ShoppingOutlined /> },
      existingProject ? { key: 'project', label: 'Open Project', icon: <ProjectOutlined /> } : { key: 'project', label: 'Create Project', icon: <ProjectOutlined /> },
      { key: 'invoice', label: 'Create Invoice', icon: <FileTextOutlined /> },
      { key: 'service', label: 'Create Service Ticket', icon: <TeamOutlined /> },
    ] : []),
    ...(['NEW', 'CONTACTED', 'QUALIFIED', 'OPPORTUNITY', 'PROPOSAL', 'NEGOTIATION'].includes(lead.stage) ? [{ key: 'won', label: 'Mark Won', icon: <CheckCircleOutlined /> }, { key: 'lost', label: 'Mark Lost', icon: <CloseCircleOutlined /> }] : []),
    { key: 'task', label: 'Add Task', icon: <CheckCircleOutlined /> },
    { key: 'activity', label: 'Log Activity', icon: <TeamOutlined /> },
  ];
  async function nextAction(key: string) {
    if (key === 'quote') return createQuote();
    if (key === 'salesOrder') { if (existingOrder) router.push(`/sales/orders/${existingOrder.id}/edit`); else return convertAcceptedQuote('SO'); }
    if (key === 'project') return createProject();
    if (key === 'invoice') return convertAcceptedQuote('INVOICE');
    if (key === 'service') { svcForm.resetFields(); setServiceModal(true); return; }
    if (key === 'won') { setWonModal(true); return; }
    if (key === 'lost') { setLostReason(''); setLostModal(true); return; }
    if (key === 'task') { taskForm.resetFields(); setTaskModal(true); return; }
    if (key === 'activity') { actForm.resetFields(); setActModal(true); return; }
  }
  async function saveEdit() {
    const v = await editForm.validateFields().catch(() => null);
    if (!v) return;
    try { await api(`/crm/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ ...v, expectedCloseDate: v.expectedCloseDate?.format('YYYY-MM-DD') }) }); message.success('Saved'); setEdit(false); refresh(); } catch (e: any) { message.error(e.message); }
  }
  async function addTask() {
    const v = await taskForm.validateFields().catch(() => null);
    if (!v) return;
    try { await api('/crm/tasks', { method: 'POST', body: JSON.stringify({ ...v, dueDate: v.dueDate?.format('YYYY-MM-DD'), relatedType: 'LEAD', relatedId: lead.id }) }); message.success('Task created'); setTaskModal(false); refresh(); } catch (e: any) { message.error(e.message); }
  }
  async function addActivity() {
    const v = await actForm.validateFields().catch(() => null);
    if (!v) return;
    try { await api(`/crm/leads/${lead.id}/interactions`, { method: 'POST', body: JSON.stringify({ ...v, type: v.type || 'CALL' }) }); message.success('Activity logged'); setActModal(false); refresh(); } catch (e: any) { message.error(e.message); }
  }
  async function markWon() {
    try { await api(`/crm/leads/${lead.id}/won`, { method: 'POST' }); message.success('Marked won'); setWonModal(false); setWizChoices({ salesOrder: !!acceptedQuote, project: false, invoice: false, service: false }); setWizard(true); refresh(); } catch (e: any) { message.error(e.message); }
  }
  async function markLost() {
    if (!lostReason) { message.error('Lost reason required'); return; }
    try { await api(`/crm/leads/${lead.id}/lost`, { method: 'POST', body: JSON.stringify({ lostReason }) }); message.success('Marked lost'); setLostModal(false); refresh(); } catch (e: any) { message.error(e.message); }
  }
  async function convert() {
    try { const res = await api(`/crm/leads/${lead.id}/convert`, { method: 'POST', body: JSON.stringify({ createOpportunity: true, forceCreate: true }) }); message.success('Converted to customer + opportunity'); setConvertModal(false); refresh(); qc.invalidateQueries({ queryKey: ['/sales/customers'] }); } catch (e: any) { message.error(e.message); }
  }

  const salesCols: ColumnsType<any> = [
    { title: 'Document', dataIndex: 'docNo', render: (v: any, r) => <a onClick={() => r.link && router.push(r.link)} className="hover:underline cursor-pointer text-[#2563eb]">{v}</a> },
    { title: 'Type', dataIndex: 'docType', width: 90, render: (v: any) => <Tag style={{ borderRadius: 8 }}>{v}</Tag> },
    { title: 'Date', dataIndex: 'date', width: 100, render: (v: any) => fmtDate(v) },
    { title: 'Status', dataIndex: 'status', width: 130, render: (v: any, r) => <span className="text-[12px] text-[#64748b]">{r.statusLabel || v || '—'}</span> },
    { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) },
  ];
  const salesRows = [
    ...(lead.related?.salesOrders || []).map((o: any) => ({ key: `so-${o.id}`, docNo: o.orderNo || o.salesOrderNo, docType: 'Sales Order', date: o.createdAt, amount: o.total, statusLabel: o.status, link: `/sales/orders/${o.id}/edit` })),
    ...(lead.related?.invoices || []).map((i: any) => ({ key: `inv-${i.id}`, docNo: i.invoiceNo, docType: 'Invoice', date: i.invoiceDate, amount: i.total, status: i.invoiceStatus, statusLabel: `${i.invoiceStatus} · ${i.paymentStatus}`, link: `/sales/invoices/${i.id}/edit` })),
    ...(lead.related?.receipts || []).map((r: any) => ({ key: `rcp-${r.id}`, docNo: r.receiptNo, docType: 'Receipt', date: r.receiptDate, amount: r.amount, status: r.status, statusLabel: r.status, link: `/sales/receipts/${r.id}` })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const projCols: ColumnsType<any> = [
    { title: 'Project', dataIndex: 'name', render: (v: any, r) => <a onClick={() => r.id && router.push(`/projects/${r.id}`)} className="hover:underline cursor-pointer text-[#2563eb]">{v || r.code}</a> },
    { title: 'Status', dataIndex: 'status', width: 150, render: (v: any) => <span className="text-[12px] text-[#64748b]">{v}</span> },
    { title: 'Amount', dataIndex: 'budget', align: 'right', render: (v: any) => fmtMoney(v) },
  ];
  const ticketCols: ColumnsType<any> = [
    { title: 'Ticket', dataIndex: 'subject', render: (v: any) => <span className="font-medium text-[#171a2e]">{v}</span> },
    { title: 'Status', dataIndex: 'status', width: 140, render: (v: any) => <span className="text-[12px] text-[#64748b]">{v}</span> },
    { title: 'Priority', dataIndex: 'priority', width: 90 },
    { title: 'Created', dataIndex: 'createdAt', width: 110, render: (v: any) => fmtDate(v) },
  ];

  const timeline = [
    ...events.map((e: any) => ({ id: e.id, at: e.createdAt, type: e.type, label: e.type?.replace(/_/g, ' '), msg: e.message, actor: e.actorName, color: '#003366' })),
    ...activities.map((a: any) => ({ id: a.id, at: a.interactedAt, type: a.type, label: a.type, msg: a.summary || a.subject, actor: a.createdBy, color: '#0ea5e9' })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const tabs = [
    { key: 'Overview', label: 'Overview', children: <OverviewCard lead={lead} /> },
    { key: 'Timeline', label: 'Timeline', children: <TimelineView items={timeline} /> },
    { key: 'Activities', label: 'Activities', children: <ActivityList items={activities} /> },
    { key: 'Tasks', label: 'Tasks', children: <TaskList items={tasks} /> },
    { key: 'Quotes', label: 'Quotes', children: <QuoteList items={allQuotes} /> },
    { key: 'Sales', label: 'Sales', children: <Table rowKey="key" dataSource={salesRows} columns={salesCols} pagination={false} size="small" /> },
    { key: 'Projects', label: 'Projects', children: <Table rowKey="id" dataSource={lead.related?.projects || []} columns={projCols} pagination={false} size="small" /> },
    { key: 'Service', label: 'Service', children: <Table rowKey="id" dataSource={lead.related?.serviceTickets || []} columns={ticketCols} pagination={false} size="small" /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Button shape="circle" icon={<ArrowLeftOutlined />} onClick={() => router.back()} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[24px] font-bold text-[#171a2e]">{lead.name}</h1>
              <Tag style={{ borderRadius: 8, background: `${sd.color}15`, color: sd.color, border: 'none' }}>{sd.label} · {lead.probability || sd.probability}%</Tag>
              {lead.priority && lead.priority !== 'NORMAL' && <Tag style={{ borderRadius: 8 }} color={LEAD_PRIORITY[lead.priority]?.color}>{lead.priority}</Tag>}
            </div>
            <div className="text-[13px] text-[#64748b]">{lead.companyName}{lead.expectedCloseDate ? ` · close ${fmtDate(lead.expectedCloseDate)}` : ''}</div>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-2"><UserOutlined className="text-[#8a90ad] text-[12px]" /><span className="text-[12px] text-[#64748b]">Owner</span><div className="w-44"><EmployeeSelector value={lead.ownerId} onChange={setOwner} placeholder="Unassigned" /></div></div>
              <div className="flex items-center gap-2"><TeamOutlined className="text-[#8a90ad] text-[12px]" /><span className="text-[12px] text-[#64748b]">Assignee</span><div className="w-44"><EmployeeSelector value={lead.assigneeId} onChange={setAssignee} placeholder="Unassigned" /></div></div>
              {lead.expectedCloseDate && <span className="text-[12px] text-[#64748b] flex items-center gap-1"><CalendarOutlined className="text-[#8a90ad]" />{fmtDate(lead.expectedCloseDate)}</span>}
            </div>
          </div>
        </div>
        <Space wrap>
          <Dropdown menu={{ items: nextActionItems, onClick: ({ key }) => nextAction(key) }} trigger={['click']}>
            <Button icon={<AimOutlined />}>Next Actions <DownOutlined /></Button>
          </Dropdown>
          <Button icon={<PlusOutlined />} onClick={() => { taskForm.resetFields(); setTaskModal(true); }}>Add Task</Button>
          <Button onClick={() => { actForm.resetFields(); setActModal(true); }}>Log Activity</Button>
          <Button icon={<EditOutlined />} onClick={() => { editForm.setFieldsValue({ ...lead, expectedCloseDate: d(lead.expectedCloseDate) }); setEdit(true); }}>Edit</Button>
          {lead.stage !== 'WON' && <Button type="primary" ghost icon={<CheckCircleOutlined />} onClick={() => setWonModal(true)}>Mark Won</Button>}
          {lead.stage !== 'LOST' && lead.stage !== 'WON' && <Button danger icon={<CloseCircleOutlined />} onClick={() => { setLostReason(''); setLostModal(true); }}>Mark Lost</Button>}
          {!lead.convertedCustomerId && <Button type="primary" icon={<AimOutlined />} onClick={() => setConvertModal(true)}>Convert</Button>}
        </Space>
      </div>

      {fin && (
        <div className="nex-card mb-5 px-5 py-4 flex flex-wrap gap-6 !rounded-xl">
          {[{ l: 'Total Invoiced', v: fin.totalInvoiced }, { l: 'Total Paid', v: fin.totalPaid }, { l: 'Remaining', v: fin.remainingBalance }, { l: 'Unapplied Credit', v: fin.unappliedCredits }].map((k) => (<div key={k.l}><div className="text-[12px] text-[#64748b]">{k.l}</div><div className="text-[18px] font-bold text-[#171a2e]">{fmtMoney(k.v)}</div></div>))}
          <Button size="small" className="ml-auto self-center" icon={<RightOutlined />} onClick={() => lead.convertedCustomerId && router.push(`/sales/customers/${lead.convertedCustomerId}`)}>Customer 360</Button>
        </div>
      )}

      <Card className="nex-card" styles={{ body: { padding: '14px 20px' } }}>
        <Tabs items={tabs} activeKey={content} onChange={setContent} destroyOnHidden />
      </Card>

      <Modal open={edit} onCancel={() => setEdit(false)} onOk={saveEdit} okText="Save" title="Edit lead">
        <Form form={editForm} layout="vertical" className="mt-2">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Name" name="name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="Company" name="companyName"><Input /></Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Owner" name="owner"><Input /></Form.Item>
            <Form.Item label="Estimated value" name="estimatedValue"><InputNumber prefix="$" className="w-full" /></Form.Item>
            <Form.Item label="Expected close" name="expectedCloseDate"><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Stage" name="stage"><Select options={CRM_STAGES.map((s) => ({ label: s.label, value: s.code }))} /></Form.Item>
          </div>
          <Form.Item label="Notes" name="notes"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={taskModal} onCancel={() => setTaskModal(false)} onOk={addTask} okText="Create" title="Add task">
        <Form form={taskForm} layout="vertical" className="mt-2">
          <Form.Item label="Title" name="title" rules={[{ required: true }]}><Input /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Priority" name="priority" initialValue="NORMAL"><Select options={Object.entries(LEAD_PRIORITY).map(([k, v]) => ({ label: v.label, value: k }))} /></Form.Item>
            <Form.Item label="Due" name="dueDate"><DatePicker className="w-full" /></Form.Item>
          </div>
          <Form.Item label="Assignee" name="assignee"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal open={actModal} onCancel={() => setActModal(false)} onOk={addActivity} okText="Log" title="Log activity">
        <Form form={actForm} layout="vertical" className="mt-2">
          <Form.Item label="Type" name="type" initialValue="CALL"><Select options={['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TASK', 'WHATSAPP', 'SMS', 'VISIT', 'OTHER'].map((t) => ({ label: t, value: t }))} /></Form.Item>
          <Form.Item label="Subject" name="subject" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Summary" name="summary"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={wonModal} onCancel={() => setWonModal(false)} onOk={markWon} okText="Mark won" title="Mark as won">
        <p className="text-[13px] text-[#566]">Set this lead to Won (100%). Optionally record the deal value and close date.</p>
      </Modal>
      <Modal open={lostModal} onCancel={() => setLostModal(false)} onOk={markLost} okText="Mark lost" title="Mark as lost">
        <div className="mt-2"><label className="text-[12px] font-medium text-[#566]">Lost reason *</label><Select className="w-full mt-1" value={lostReason || undefined} placeholder="Select reason" options={LOST_REASONS.map((r) => ({ label: r, value: r }))} onChange={setLostReason} /></div>
      </Modal>
      <Modal open={convertModal} onCancel={() => setConvertModal(false)} onOk={convert} okText="Convert" title="Convert to customer">
        <p className="text-[13px] text-[#566]">Create a customer from this lead and an opportunity. Duplicate leads/customers will be checked.</p>
      </Modal>

      <Modal open={serviceModal} onCancel={() => setServiceModal(false)} onOk={createService} okText="Create" title="New Service Ticket">
        <Form form={svcForm} layout="vertical" className="mt-2">
          <Form.Item label="Subject" name="subject" rules={[{ required: true }]}><Input placeholder={opp ? `Service for ${opp.name}` : 'How can we help?'} /></Form.Item>
          <Form.Item label="Description" name="description"><Input.TextArea rows={3} /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Priority" name="priority" initialValue="NORMAL"><Select options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((t) => ({ label: t, value: t }))} /></Form.Item>
            <Form.Item label="Assigned To" name="assignedToId"><EmployeeSelector placeholder="Select technician" /></Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal open={wizard} onCancel={() => setWizard(false)} onOk={runWizard} okText="Create & Finish" width={560} title={<span>Opportunity Won — Next Actions</span>}>
        <div className="mb-3 p-3 rounded-xl bg-[#f8f9ff] border border-[#eef0f6]">
          <div className="flex items-center gap-2"><CheckCircleOutlined className="text-[#10b981]" /><span className="font-semibold text-[14px] text-[#171a2e]">{lead.name}</span></div>
          <div className="text-[12px] text-[#64748b] mt-0.5">{lead.companyName || '—'}{opp?.customerId ? ' · Linked to customer' : ''}{acceptedQuote ? ` · Accepted Quote ${acceptedQuote.quotationNo}` : ''}</div>
        </div>
        <div className="text-[12px] font-medium text-[#566] mb-2">What would you like to create next? (nothing is created unless selected)</div>
        <div className="space-y-2">
          <Checkbox checked={wizChoices.salesOrder} onChange={(e) => setWizChoices((c) => ({ ...c, salesOrder: e.target.checked }))} disabled={!acceptedQuote}>Create Sales Order{!acceptedQuote ? ' (accept a quote first)' : ''}</Checkbox>
          <Checkbox checked={wizChoices.project} onChange={(e) => setWizChoices((c) => ({ ...c, project: e.target.checked }))} disabled={!opp}>Create Project</Checkbox>
          <Checkbox checked={wizChoices.invoice} onChange={(e) => setWizChoices((c) => ({ ...c, invoice: e.target.checked }))} disabled={!acceptedQuote}>Create Invoice{!acceptedQuote ? ' (accept a quote first)' : ''}</Checkbox>
          <Checkbox checked={wizChoices.service} onChange={(e) => setWizChoices((c) => ({ ...c, service: e.target.checked }))} disabled={!opp}>Create Service Ticket</Checkbox>
        </div>
      </Modal>
    </div>
  );
}

function OverviewCard({ lead }: { lead: any }) {
  const items = [
    { label: 'Company', value: lead.companyName },
    { label: 'Contact', value: lead.contactName },
    { label: 'Email', value: lead.email },
    { label: 'Phone', value: lead.phone },
    { label: 'Owner', value: lead.owner },
    { label: 'Source', value: lead.source },
    { label: 'Industry', value: lead.industry },
    { label: 'Deal Value', value: fmtMoney(lead.estimatedValue) },
    { label: 'Expected Close', value: fmtDate(lead.expectedCloseDate) },
    { label: 'Last Contact', value: fmtDate(lead.lastActivityAt) },
    { label: 'Priority', value: lead.priority },
    { label: 'Score', value: lead.score ?? '—' },
    { label: 'Budget', value: lead.budget },
    { label: 'Authority', value: lead.authority },
    { label: 'Need', value: lead.need },
    { label: 'Timeline', value: lead.timeline },
  ].filter((i) => i.value != null && i.value !== '');
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
      <Descriptions column={1} size="small" items={items.slice(0, 8).map((i) => ({ key: i.label, label: i.label, children: <span className="text-[13px] text-[#334]">{i.value}</span> }))} />
      <Descriptions column={1} size="small" items={items.slice(8).map((i) => ({ key: i.label, label: i.label, children: <span className="text-[13px] text-[#334]">{i.value}</span> }))} />
    </div>
  );
}

function TimelineView({ items }: { items: any[] }) {
  if (!items.length) return <Empty description="No activity yet" />;
  return <Timeline items={items.map((i: any) => ({ color: i.color, children: (<div className="pb-2"><div className="flex items-center gap-2 text-[11px] text-[#8a90ad]"><CalendarOutlined />{fmtDate(i.at)}{i.actor ? ` · ${i.actor}` : ''}</div><div className="font-semibold text-[13px] text-[#171a2e] mt-0.5 uppercase tracking-wide text-[11px]">{i.label}</div><div className="text-[13px] text-[#5a6080]">{i.msg}</div></div>) }))} />;
}

function ActivityList({ items }: { items: any[] }) {
  if (!items.length) return <Empty description="No activities" />;
  return <div className="space-y-3">{(items as any[]).map((i: any) => (<div key={i.id} className="rounded-xl border border-[#eef0f6] p-3"><div className="flex items-center justify-between"><span className="font-semibold text-[13px] text-[#171a2e]">{i.subject}</span><span className="text-[11px] text-[#8a90ad]">{fmtDate(i.interactedAt)}</span></div><div className="text-[12px] text-[#8a90ad]">{i.type}</div>{i.summary && <p className="text-[13px] text-[#5a6080] mt-1">{i.summary}</p>}</div>))}</div>;
}

function TaskList({ items }: { items: any[] }) {
  if (!items.length) return <Empty description="No tasks" />;
  return <div className="space-y-2.5">{(items as any[]).map((t: any) => (<div key={t.id} className="flex items-center gap-3 rounded-xl border border-[#eef0f6] p-3"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: LEAD_PRIORITY[t.priority]?.color || '#94a3b8' }} /><div className="flex-1 min-w-0"><div className="font-semibold text-[13px] text-[#171a2e]">{t.title}</div><div className="text-[11px] text-[#8a90ad]">{t.assignee || 'Unassigned'}{t.dueDate ? ` · ${fmtDate(t.dueDate)}` : ''}</div></div><Tag style={{ borderRadius: 8 }} color={t.status === 'COMPLETED' ? 'green' : 'default'}>{t.status}</Tag></div>))}</div>;
}

function QuoteList({ items }: { items: any[] }) {
  if (!items.length) return <Empty description="No quotations" />;
  return <div className="space-y-2.5">{(items as any[]).map((q: any) => (<div key={q.id} className="rounded-xl border border-[#eef0f6] p-3 flex items-center justify-between"><div><div className="font-semibold text-[13px] text-[#171a2e]">{q.quotationNo}</div><div className="text-[11px] text-[#8a90ad]">{q.status}{q.currency ? ` · ${q.currency}` : ''}</div></div><div className="flex items-center gap-3"><span className="font-bold text-[13px]">{fmtMoney(q.total)}</span><Tag style={{ borderRadius: 8 }} color={q.status === 'ACCEPTED' ? 'green' : q.status === 'SENT' ? 'blue' : 'default'}>{q.status}</Tag></div></div>))}</div>;
}
