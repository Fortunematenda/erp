'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined, AppstoreOutlined, CalendarOutlined, DollarOutlined, FileTextOutlined, FilterOutlined, FireOutlined,
  PlusOutlined, SearchOutlined, TableOutlined, TeamOutlined, UnorderedListOutlined, UserOutlined,
  CheckCircleOutlined, CloseCircleOutlined, RiseOutlined, MailOutlined, PhoneOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { Button, DatePicker, Drawer, Empty, Form, Input, InputNumber, message, Modal, Select, Space, Table, Tabs, Tag, Timeline, Card, Popconfirm } from 'antd';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { EmployeeSelector, useEmployees } from '@/components/employee-selector';
import { StatCard } from '@/components/stat-card';
import { fmtDate, fmtMoney } from '@/lib/format';
import { CrmBoard } from '@/components/crm-board';
import { CRM_STAGES, LEAD_PRIORITY, LEAD_SOURCES, LOST_REASONS, stageDef } from '@/lib/crm';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const T_BADGE: Record<string, { c: string; icon: any }> = {
  CALL: { c: '#0ea5e9', icon: <PhoneOutlined /> }, EMAIL: { c: '#1d5fb5', icon: <MailOutlined /> }, MEETING: { c: '#003366', icon: <TeamOutlined /> },
  NOTE: { c: '#64748b', icon: <FileTextOutlined /> }, TASK: { c: '#10b981', icon: <CheckCircleOutlined /> }, OTHER: { c: '#f59e0b', icon: <ClockCircleOutlined /> },
};
const ACT_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TASK', 'WHATSAPP', 'SMS', 'VISIT', 'OTHER'];

function NewLeadModal({ open, onClose, editing, onSaved }: { open: boolean; onClose: () => void; editing: any | null; onSaved: () => void }) {
  const [form] = Form.useForm();
  const { employees } = useEmployees();
  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({ ...editing, estimatedValue: editing.estimatedValue ? Number(editing.estimatedValue) : undefined, expectedCloseDate: editing.expectedCloseDate ? dayjs(editing.expectedCloseDate) : undefined, stage: editing.stage || 'NEW' });
    } else form.resetFields();
  }, [open, editing]); // eslint-disable-line
  async function submit() {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    try {
      const ownerName = employees.find((e: any) => e.id === v.ownerId)?.name;
      const payload = { ...v, owner: ownerName || v.owner, estimatedValue: Number(v.estimatedValue || 0), expectedCloseDate: v.expectedCloseDate?.format('YYYY-MM-DD'), nextFollowUp: v.nextFollowUp?.format('YYYY-MM-DD'), stage: v.stage || 'NEW', probability: stageDef(v.stage || 'NEW').probability };
      if (editing) await api(`/crm/leads/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/crm/leads', { method: 'POST', body: JSON.stringify(payload) });
      message.success(editing ? 'Lead updated' : 'Lead created'); onClose(); onSaved();
    } catch (e: any) { message.error(e.message); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={640} title={editing ? 'Edit lead' : 'New lead'} destroyOnHidden
      extra={<Button onClick={onClose}>Cancel</Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit}>{editing ? 'Save' : 'Create'} Lead</Button></Space>}>
      <Form form={form} layout="vertical" className="mt-2">
        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item label="Lead name" name="name" rules={[{ required: true }]}><Input placeholder="e.g. Kudzai N" /></Form.Item>
          <Form.Item label="Company" name="companyName"><Input /></Form.Item>
          <Form.Item label="Contact name" name="contactName"><Input /></Form.Item>
          <Form.Item label="Email" name="email"><Input /></Form.Item>
          <Form.Item label="Phone" name="phone"><Input /></Form.Item>
          <Form.Item label="Lead source" name="source"><Select allowClear options={LEAD_SOURCES.map((s) => ({ label: s, value: s }))} /></Form.Item>
          <Form.Item label="Industry" name="industry"><Input /></Form.Item>
          <Form.Item label="Owner" name="ownerId"><EmployeeSelector placeholder="Assign owner" /></Form.Item>
          <Form.Item label="Estimated value" name="estimatedValue"><InputNumber prefix="$" className="w-full" /></Form.Item>
          <Form.Item label="Currency" name="currency" initialValue="USD"><Select options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item>
          <Form.Item label="Priority" name="priority" initialValue="NORMAL"><Select options={Object.entries(LEAD_PRIORITY).map(([k, v]) => ({ label: v.label, value: k }))} /></Form.Item>
          <Form.Item label="Expected close" name="expectedCloseDate"><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Stage" name="stage" initialValue="NEW"><Select options={CRM_STAGES.map((s) => ({ label: s.label, value: s.code }))} /></Form.Item>
          <Form.Item label="Interested product / service" name="interestedProducts" className="col-span-2"><Input /></Form.Item>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item label="Budget (BANT)" name="budget"><Input placeholder="e.g. Confirmed" /></Form.Item>
          <Form.Item label="Authority (BANT)" name="authority"><Input placeholder="e.g. Decision maker" /></Form.Item>
          <Form.Item label="Need (BANT)" name="need"><Input /></Form.Item>
          <Form.Item label="Timeline (BANT)" name="timeline"><Input /></Form.Item>
        </div>
        <Form.Item label="Notes" name="notes"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Drawer>
  );
}

export default function Crm() {
  const router = useRouter();
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ['crm', 'dashboard'], queryFn: () => api('/crm/dashboard') });
  const stages = useQuery({ queryKey: ['crm', 'stages'], queryFn: () => api('/crm/stages') });
  const [tab, setTab] = useState('board');
  const [leadModal, setLeadModal] = useState(false);
  const [editingLead, setEditingLead] = useState<any>(null);
  const [lostOpp, setLostOpp] = useState<any>(null);
  const [wonOpp, setWonOpp] = useState<any>(null);
  const [lostReason, setLostReason] = useState('');
  const [trash, setTrash] = useState('');

  const stageList = stages.data && stages.data.length ? stages.data : CRM_STAGES;

  // Board filters
  const [fq, setFq] = useState('');
  const [fOwner, setFOwner] = useState('');
  const [fSource, setFSource] = useState('');
  const [fStage, setFStage] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fClose, setFClose] = useState<any>(null);
  const [fMin, setFMin] = useState<number | null>(null);
  const [fMax, setFMax] = useState<number | null>(null);

  const leadsQ = useMemo(() => {
    const p = new URLSearchParams();
    if (fq) p.set('q', fq);
    if (fOwner) p.set('owner', fOwner);
    if (fSource) p.set('source', fSource);
    if (fStage) p.set('stage', fStage);
    if (fPriority) p.set('priority', fPriority);
    if (fClose) p.set('expectedCloseMonth', fClose);
    if (fMin != null) p.set('minValue', String(fMin));
    if (fMax != null) p.set('maxValue', String(fMax));
    p.set('limit', '500');
    return p.toString();
  }, [fq, fOwner, fSource, fStage, fPriority, fClose, fMin, fMax]);

  const leads = useQuery({ queryKey: ['crm', 'leads', leadsQ], queryFn: () => api(`/crm/leads?${leadsQ}`) });
  const opportunities = useQuery({ queryKey: ['crm', 'opportunities'], queryFn: () => api('/crm/opportunities') });
  const tasks = useQuery({ queryKey: ['crm', 'tasks'], queryFn: () => api('/crm/tasks') });
  const interactions = useQuery({ queryKey: ['crm', 'interactions'], queryFn: () => api('/crm/interactions') });

  function refresh() { qc.invalidateQueries({ queryKey: ['crm', 'leads'] }); qc.invalidateQueries({ queryKey: ['crm', 'opportunities'] }); qc.invalidateQueries({ queryKey: ['crm', 'dashboard'] }); }

  const owners = useMemo(() => Array.from(new Set([...(leads.data || []).map((l: any) => l.owner), ...(opportunities.data || []).map((o: any) => o.owner)].filter(Boolean))) as string[], [leads.data, opportunities.data]);

  async function moveOpp(o: any, stage: string) {
    if (stage === 'WON') { setWonOpp(o); return; }
    if (stage === 'LOST') { setLostOpp(o); setLostReason(''); return; }
    try { await api(`/crm/opportunities/${o.id}/stage`, { method: 'POST', body: JSON.stringify({ stage }) }); message.success(`Moved to ${stageDef(stage).label}`); refresh(); } catch (e: any) { message.error(e.message); }
  }
  async function confirmWonOpp() {
    try { await api(`/crm/opportunities/${wonOpp.id}/won`, { method: 'POST', body: JSON.stringify({}) }); message.success('Opportunity won'); setWonOpp(null); refresh(); } catch (e: any) { message.error(e.message); }
  }
  async function confirmLostOpp() {
    if (!lostReason) { message.error('Lost reason is required'); return; }
    try { await api(`/crm/opportunities/${lostOpp.id}/lost`, { method: 'POST', body: JSON.stringify({ lostReason }) }); message.success('Opportunity lost'); setLostOpp(null); refresh(); } catch (e: any) { message.error(e.message); }
  }
  async function createOppQuote(o: any) {
    try { await api(`/crm/opportunities/${o.id}/quote`, { method: 'POST' }); message.success('Quote created'); refresh(); qc.invalidateQueries({ queryKey: ['/sales/quotations'] }); } catch (e: any) { message.error(e.message); }
  }
  async function deleteOpp(id: string) {
    try { await api(`/crm/opportunities/${id}`, { method: 'DELETE' }); message.success('Deleted'); refresh(); } catch (e: any) { message.error(e.message); }
  }
  async function markTaskDone(id: string) {
    try { await api(`/crm/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }); message.success('Task completed'); qc.invalidateQueries({ queryKey: ['crm', 'tasks'] }); qc.invalidateQueries({ queryKey: ['crm', 'dashboard'] }); } catch (e: any) { message.error(e.message); }
  }

  const oppCols: ColumnsType<any> = [
    { title: 'Opportunity', dataIndex: 'name', render: (v: any, r) => <Link href={`/sales/quotes/${r.quotations?.[0]?.id || '#'}`} className="font-medium text-[#171a2e] hover:text-[#003366] hover:underline">{v}</Link> },
    { title: 'Customer', render: (_: any, r) => r.customer?.name || r.lead?.name || '—' },
    { title: 'Stage', dataIndex: 'stage', width: 190, render: (v: any, r) => <Select size="small" className="!w-44" value={v} options={CRM_STAGES.map((s) => ({ label: s.label, value: s.code }))} onChange={(s) => moveOpp(r, s)} /> },
    { title: 'Value', dataIndex: 'value', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Prob.', dataIndex: 'probability', align: 'center', width: 60, render: (v: any) => `${v || 0}%` },
    { title: 'Weighted', align: 'right', render: (_: any, r) => <span className="text-[#2563eb]">{fmtMoney(Number(r.value) * (r.probability || 0) / 100)}</span> },
    { title: 'Close', dataIndex: 'expectedClose', width: 100, render: (v: any) => (v ? fmtDate(v) : '—') },
    { title: 'Owner', dataIndex: 'owner', width: 90, render: (v: any) => v || '—' },
    { ...ACTIONS_COL, render: (_: any, r) => (
      <RowActionsMenu items={[
        { key: 'won', label: 'Won', icon: <CheckCircleOutlined />, onClick: () => setWonOpp(r) },
        { key: 'lost', label: 'Lost', icon: <CloseCircleOutlined />, onClick: () => { setLostOpp(r); setLostReason(''); } },
        { key: 'quote', label: 'Create quote', icon: <FileTextOutlined />, onClick: () => createOppQuote(r) },
        { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, confirm: 'Delete?', onClick: () => deleteOpp(r.id) },
      ]} />
    ) },
  ];

  const actCols: ColumnsType<any> = [] as any;

  const TABS_NAV = [
    { key: 'board', label: 'Leads Board', icon: <AppstoreOutlined /> },
    { key: 'opportunities', label: 'Opportunities', icon: <RiseOutlined /> },
    { key: 'tasks', label: 'Tasks', icon: <CheckCircleOutlined /> },
    { key: 'interactions', label: 'Interactions', icon: <TeamOutlined /> },
    { key: 'all', label: 'All Leads', icon: <UnorderedListOutlined /> },
  ];

  const tcards = [
    { icon: <UserOutlined />, label: 'Open Leads', value: dash.data?.openLeads ?? 0, hint: 'Not won/lost', color: '#003366' },
    { icon: <RiseOutlined />, label: 'Open Opportunities', value: dash.data?.openOpportunities ?? 0, hint: 'Active deals', color: '#6366f1' },
    { icon: <DollarOutlined />, label: 'Pipeline Value', value: fmtMoney(dash.data?.pipelineValue || 0), hint: dash.data?.currency || 'USD', color: '#2563eb' },
    { icon: <FireOutlined />, label: 'Weighted Pipeline', value: fmtMoney(dash.data?.weightedPipeline || 0), hint: 'Value × probability', color: '#f59e0b' },
    { icon: <CheckCircleOutlined />, label: 'Open Tasks', value: dash.data?.openTasks ?? 0, hint: 'Click to view', color: '#10b981', onClick: () => setTab('tasks') },
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e]">CRM &amp; Sales Pipeline</h1><p className="text-[13px] text-[#64748b] mt-0.5">Lead-to-cash relationship layer</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingLead(null); setLeadModal(true); }}>New Lead</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {tcards.map((c) => c.onClick ? <button key={c.label} onClick={c.onClick} className="text-left"><StatCard icon={c.icon} label={c.label} value={c.value} hint={c.hint} color={c.color} /></button> : <StatCard key={c.label} icon={c.icon} label={c.label} value={c.value} hint={c.hint} color={c.color} />)}
      </div>

      <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
        <div className="flex items-center gap-1 mb-4 border-b border-[#eef0f6] overflow-x-auto">
          {TABS_NAV.map((t) => (<button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-2 px-4 pb-3 pt-1 text-[14px] font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.key ? 'text-[#003366] border-[#003366]' : 'text-[#344054] border-transparent hover:text-[#003366]'}`}><span className={tab === t.key ? 'text-[#003366]' : 'text-[#8a90ad]'}>{t.icon}</span>{t.label}</button>))}
        </div>
        {tab === 'board' && (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search leads…" className="w-52 !rounded-xl" value={fq} onChange={(e) => setFq(e.target.value)} />
              <Select allowClear showSearch optionFilterProp="label" placeholder="Owner" className="!min-w-[140px] !rounded-xl" value={fOwner || undefined} onChange={setFOwner} options={owners.map((o) => ({ label: o, value: o }))} />
              <Select allowClear placeholder="Source" className="!min-w-[130px] !rounded-xl" value={fSource || undefined} onChange={setFSource} options={LEAD_SOURCES.map((s) => ({ label: s, value: s }))} />
              <Select allowClear placeholder="Stage" className="!min-w-[130px] !rounded-xl" value={fStage || undefined} onChange={setFStage} options={stageList.map((s: any) => ({ label: s.label, value: s.code }))} />
              <Select allowClear placeholder="Priority" className="!min-w-[120px] !rounded-xl" value={fPriority || undefined} onChange={setFPriority} options={Object.entries(LEAD_PRIORITY).map(([k, v]) => ({ label: v.label, value: k }))} />
              <DatePicker picker="month" placeholder="Close month" className="!w-40 !rounded-xl" value={fClose ? dayjs(fClose) : null} onChange={(d) => setFClose(d ? d.format('YYYY-MM') : null)} />
              <InputNumber prefix="$" placeholder="Min" className="!w-28" value={fMin ?? undefined} onChange={(v) => setFMin(v ?? null)} />
              <InputNumber prefix="$" placeholder="Max" className="!w-28" value={fMax ?? undefined} onChange={(v) => setFMax(v ?? null)} />
              <Button icon={<FilterOutlined />} onClick={() => { setFq(''); setFOwner(''); setFSource(''); setFStage(''); setFPriority(''); setFClose(null); setFMin(null); setFMax(null); }}>Clear</Button>
            </div>
            <CrmBoard leads={leads.data || []} loading={leads.isLoading} refresh={refresh} onOpenDetail={(id) => router.push(`/crm/leads/${id}`)} onEditLead={(l) => { setEditingLead(l); setLeadModal(true); }} onNewLead={() => { setEditingLead(null); setLeadModal(true); }} />
          </>
        )}

        {tab === 'opportunities' && (
          <div>
            <Table rowKey="id" loading={opportunities.isLoading} dataSource={opportunities.data || []} columns={oppCols} pagination={{ pageSize: 12, showSizeChanger: false }} />
          </div>
        )}

        {tab === 'tasks' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title={<span className="font-bold">Open tasks</span>} className="nex-card">
              <div className="space-y-2.5">
                {(tasks.data || []).filter((t: any) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').map((t: any) => {
                  const overdue = t.dueDate && dayjs(t.dueDate).isBefore(dayjs(), 'day');
                  return (
                    <div key={t.id} className="flex items-center gap-3 rounded-xl border border-[#eef0f6] p-3 hover:bg-[#f8f9ff]">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${overdue ? 'bg-[#ef4444]' : t.dueDate ? 'bg-[#f59e0b]' : 'bg-[#94a3b8]'}`} />
                      <div className="flex-1 min-w-0"><div className="font-semibold text-[13px] text-[#171a2e] truncate">{t.title}</div><div className="text-[11px] text-[#8a90ad]">{t.assignee || 'Unassigned'}{t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ''}{overdue ? ' · Overdue' : ''}</div></div>
                      <Tag style={{ borderRadius: 8 }} color={LEAD_PRIORITY[t.priority]?.color}>{t.priority || 'NORMAL'}</Tag>
                      <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />} onClick={() => markTaskDone(t.id)}>Done</Button>
                    </div>
                  );
                })}
                {(tasks.data || []).filter((t: any) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No open tasks" />}
              </div>
            </Card>
            <Card title={<span className="font-bold">Completed</span>} className="nex-card">
              <div className="space-y-2.5">
                {(tasks.data || []).filter((t: any) => t.status === 'COMPLETED' || t.status === 'CANCELLED').map((t: any) => (
                  <div key={t.id} className="flex items-center gap-3 rounded-xl border border-[#eef0f6] p-3 opacity-70"><span className="text-[15px] text-[#10b981]"><CheckCircleOutlined /></span><div className="flex-1 min-w-0"><div className="font-medium text-[13px] text-[#5a6080] line-through truncate">{t.title}</div><div className="text-[11px] text-[#a1a6c0]">{t.assignee || 'Unassigned'}</div></div></div>
                ))}
                {(tasks.data || []).filter((t: any) => t.status === 'COMPLETED' || t.status === 'CANCELLED').length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing completed yet" />}
              </div>
            </Card>
          </div>
        )}

        {tab === 'interactions' && (
          <Card className="nex-card" styles={{ body: { padding: '24px 28px' } }}>
            {(interactions.data || []).length === 0 && <Empty description="No interactions yet" />}
            <Timeline items={(interactions.data || []).map((i: any) => { const cfg = T_BADGE[i.type] || T_BADGE.OTHER; return { dot: <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm" style={{ background: cfg.c }}>{cfg.icon}</div>, children: (<div className="nex-card p-4 mb-1"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="font-bold text-[13px] text-[#171a2e]">{i.subject}</span><Tag style={{ borderRadius: 8, background: `${cfg.c}15`, color: cfg.c, border: 'none' }}>{i.type}</Tag></div><span className="text-[11px] text-[#8a90ad]"><CalendarOutlined className="mr-1" />{fmtDate(i.interactedAt)}</span></div><div className="text-[12px] text-[#8a90ad] mt-1">{i.customer?.name || i.lead?.name || 'General'}</div>{i.summary && <p className="text-[13px] text-[#5a6080] mt-2 mb-0">{i.summary}</p>}</div>) }; })} />
          </Card>
        )}

        {tab === 'all' && (
          <LeadsTable leads={leads.data || []} loading={leads.isLoading} onOpen={(id) => router.push(`/crm/leads/${id}`)} />
        )}
      </Card>

      <NewLeadModal open={leadModal} onClose={() => setLeadModal(false)} editing={editingLead} onSaved={refresh} />

      <Modal open={!!lostOpp} onCancel={() => setLostOpp(null)} onOk={confirmLostOpp} okText="Mark Lost" title={`Mark ${lostOpp?.name || ''} as Lost`}>
        <div className="mt-2"><label className="text-[12px] font-medium text-[#566]">Lost reason *</label><Select className="w-full mt-1" value={lostReason || undefined} placeholder="Select reason" options={LOST_REASONS.map((r) => ({ label: r, value: r }))} onChange={setLostReason} /></div>
      </Modal>
      <Modal open={!!wonOpp} onCancel={() => setWonOpp(null)} onOk={confirmWonOpp} okText="Mark Won" title={`Mark ${wonOpp?.name || ''} as Won`}>
        <p className="text-[13px] text-[#566]">Mark this opportunity as won and set the actual close date.</p>
      </Modal>
    </div>
  );
}

function LeadsTable({ leads, loading, onOpen }: { leads: any[]; loading: boolean; onOpen: (id: string) => void }) {
  const cols: ColumnsType<any> = [
    { title: 'Lead', dataIndex: 'name', render: (v: any, r) => <a onClick={() => onOpen(r.id)} className="font-medium text-[#171a2e] hover:text-[#003366] hover:underline cursor-pointer">{v}</a> },
    { title: 'Company', dataIndex: 'companyName' },
    { title: 'Stage', dataIndex: 'stage', width: 130, render: (v: any) => { const s = stageDef(v); return <Tag style={{ borderRadius: 8, background: `${s.color}15`, color: s.color, border: 'none' }}>{s.label}</Tag>; } },
    { title: 'Owner', dataIndex: 'owner', width: 100 },
    { title: 'Value', dataIndex: 'estimatedValue', align: 'right', width: 110, render: (v: any) => fmtMoney(v) },
    { title: 'Prob.', dataIndex: 'probability', align: 'center', width: 70, render: (v: any) => `${v || 0}%` },
    { title: 'Weighted', align: 'right', width: 110, render: (_: any, r) => <span className="text-[#2563eb]">{fmtMoney(Number(r.estimatedValue) * (r.probability || 0) / 100)}</span> },
    { title: 'Source', dataIndex: 'source', width: 100 },
    { title: 'Expected close', dataIndex: 'expectedCloseDate', width: 110, render: (v: any) => (v ? fmtDate(v) : '—') },
    { title: 'Priority', dataIndex: 'priority', width: 90 },
  ];
  return <Table rowKey="id" loading={loading} dataSource={leads} columns={cols} pagination={{ pageSize: 12, showSizeChanger: false, total: leads.length }} />;
}
