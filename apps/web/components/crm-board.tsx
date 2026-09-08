'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, closestCorners,
  DragOverlay, type DragStartEvent, type DragOverEvent, type DragEndEvent, useDroppable,
} from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarOutlined, DollarOutlined, EditOutlined, FireOutlined, FileTextOutlined, MailOutlined, MoreOutlined, PhoneOutlined, PlusOutlined, RightOutlined, TeamOutlined, UserOutlined, UpOutlined, DownOutlined, SendOutlined, CheckCircleOutlined, HomeOutlined, ShoppingOutlined, ProjectOutlined, AimOutlined } from '@ant-design/icons';
import { Button, DatePicker, Dropdown, Empty, Form, Input, InputNumber, message, Modal, Popconfirm, Select, Tag, Space } from 'antd';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { CRM_STAGES, LEAD_SOURCES, LEAD_PRIORITY, LOST_REASONS, stageDef } from '@/lib/crm';

const fmt = (v: string) => (v ? dayjs(v).format('DD MMM YY') : null);

function LeadCard({ lead, stage, onClick }: { lead: any; stage: string; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id, data: { type: 'card', stage } });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const sd = stageDef(stage);
  const nextStep = fmt(lead.expectedCloseDate) || fmt(lead.nextFollowUp);
  const stale = lead.lastActivityAt && dayjs().diff(dayjs(lead.lastActivityAt), 'day') >= 14;
  const hot = (lead.priority === 'URGENT' || lead.priority === 'HIGH') && stage !== 'WON' && stage !== 'LOST';

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`bg-white rounded-xl border border-[#eef0f6] p-3.5 mb-2.5 shadow-sm transition-shadow ${isDragging ? 'opacity-40 z-20' : 'hover:shadow-md'} cursor-grab active:cursor-grabbing`}
      onClick={(e) => { if ((e.target as HTMLElement).closest('[data-no-drag]')) return; onClick(); }}>
      <div className="flex items-start justify-between gap-2" data-no-drag>
        <div className="min-w-0">
          <div className="font-semibold text-[14px] text-[#171a2e] truncate flex items-center gap-1.5">
            {lead.name}
            {hot && <span className="text-[10px] font-bold text-[#ef4444] bg-[#ef44440f] px-1 rounded">HOT</span>}
            {stale && stage !== 'WON' && stage !== 'LOST' && <span className="text-[10px] font-bold text-[#6b7280] bg-[#6b72800f] px-1 rounded">STALE</span>}
          </div>
          <div className="text-[12px] text-[#8a90ad] truncate">{lead.companyName || '—'}</div>
        </div>
        <CardQuickMenu lead={lead} stage={stage} />
      </div>
      <div className="flex items-center justify-between mt-2.5">
        <span className="flex items-center gap-1 font-bold text-[13px] text-[#171a2e]"><DollarOutlined className="text-[#10b981]" />{fmtMoney(lead.estimatedValue)}</span>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${sd.color}18`, color: sd.color }}>{sd.label} · {lead.probability ?? sd.probability}%</span>
      </div>
      {nextStep && <div className="flex items-center gap-1.5 text-[11px] text-[#8a90ad] mt-1.5"><CalendarOutlined />{nextStep}</div>}
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[#f2f3f9]">
        <span className="flex items-center gap-1 text-[11px] text-[#8a90ad]"><UserOutlined />{lead.owner || 'Unassigned'}</span>
        <span className="text-[11px] text-[#8a90ad]">{lead._count?.opportunities || 0} opps</span>
      </div>
    </div>
  );
}

function CardQuickMenu({ lead, stage }: { lead: any; stage: string }) {
  const qc = useQueryClient();
  const items = [
    { key: 'open', label: 'Open', icon: <HomeOutlined /> },
    { key: 'edit', label: 'Edit', icon: <EditOutlined /> },
    { key: 'task', label: 'Add Task', icon: <CheckCircleOutlined /> },
    { key: 'call', label: 'Log Call', icon: <PhoneOutlined /> },
    { key: 'email', label: 'Send Email', icon: <MailOutlined /> },
    ...(lead.convertedCustomerId || stage === 'WON' ? [{ key: 'quote', label: 'Create Quote', icon: <FileTextOutlined /> }] : []),
    ...(['NEW', 'CONTACTED', 'QUALIFIED'].includes(stage) ? [{ key: 'convert', label: 'Convert', icon: <AimOutlined /> }] : []),
    ...(stage !== 'WON' && stage !== 'LOST' ? [{ key: 'won', label: 'Mark Won', icon: <CheckCircleOutlined /> }, { key: 'lost', label: 'Mark Lost', icon: <UpOutlined /> }] : []),
    { key: 'delete', label: 'Delete', icon: <DownOutlined />, danger: true },
  ];
  return (
    <Dropdown menu={{ items, onClick: ({ key }) => window.dispatchEvent(new CustomEvent('crm-card-action', { detail: { key, lead, stage } })) }} trigger={['click']}>
      <Button size="small" type="text" icon={<MoreOutlined />} className="!text-[#a1a6c0] hover:!text-[#003366]" data-no-drag />
    </Dropdown>
  );
}

const COL_DEFS = CRM_STAGES;

export function CrmBoard({ leads, loading, refresh, onOpenDetail, onEditLead, onNewLead }: {
  leads: any[]; loading: boolean; refresh: () => void;
  onOpenDetail: (id: string) => void; onEditLead: (lead: any) => void; onNewLead: () => void;
}) {
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ['/sales/customers'], queryFn: () => api('/sales/customers') });
  const [items, setItems] = useState<Record<string, any[]>>({});
  const [activeLead, setActiveLead] = useState<any>(null);
  const [wonLead, setWonLead] = useState<any>(null);
  const [lostLead, setLostLead] = useState<any>(null);
  const [convertLead, setConvertLead] = useState<any>(null);
  const [quoteLead, setQuoteLead] = useState<any>(null);
  const [wonForm] = Form.useForm();
  const [lostForm] = Form.useForm();
  const [convertForm] = Form.useForm();
  const convertMode = Form.useWatch('linkMode', convertLead ? convertForm : undefined);

  useEffect(() => {
    const map: Record<string, any[]> = {};
    COL_DEFS.forEach((s) => (map[s.code] = []));
    (leads || []).forEach((l: any) => { if (!map[l.stage]) map[l.stage] = []; map[l.stage].push(l); });
    Object.keys(map).forEach((k) => map[k]?.sort((a, b) => (a.position || 0) - (b.position || 0)));
    setItems(map);
  }, [leads]);

  const cardStage = useMemo(() => { const m: Record<string, string> = {}; Object.entries(items).forEach(([s, arr]) => arr.forEach((l) => (m[l.id] = s))); return m; }, [items]);

  function addActivity(lead: any, type: string) {
    Modal.confirm({ title: `Log ${type}`, content: <div className="text-[13px] text-[#64748b]">Quickly log a {type} against <b>{lead.name}</b>.</div>, okText: 'Log',
      onOk: () => api(`/crm/leads/${lead.id}/interactions`, { method: 'POST', body: JSON.stringify({ type, subject: `${type} logged`, summary: '', nextAction: '' }) }).then(() => { message.success(`${type} logged`); refresh(); }).catch((e: any) => message.error(e.message)) });
  }

  useEffect(() => {
    function handler(e: any) {
      const { key, lead } = e.detail;
      if (key === 'open') onOpenDetail(lead.id);
      else if (key === 'edit') onEditLead(lead);
      else if (key === 'task') addActivity(lead, 'TASK');
      else if (key === 'call') addActivity(lead, 'CALL');
      else if (key === 'email') addActivity(lead, 'EMAIL');
      else if (key === 'quote') setQuoteLead(lead);
      else if (key === 'convert') setConvertLead(lead);
      else if (key === 'won') setWonLead(lead);
      else if (key === 'lost') setLostLead(lead);
      else if (key === 'delete') confirmDelete(lead);
    }
    window.addEventListener('crm-card-action', handler);
    return () => window.removeEventListener('crm-card-action', handler);
  }, [onOpenDetail, onEditLead]);

  async function confirmDelete(lead: any) {
    try { await api(`/crm/leads/${lead.id}`, { method: 'DELETE' }); message.success('Lead deleted'); refresh(); } catch (e: any) { message.error(e.message); }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => setActiveLead(items[cardStage[String(e.active.id)] || 'NEW'].find((l) => l.id === e.active.id) || null);
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const activeId = String(active.id);
    const from = cardStage[activeId];
    const to = COL_DEFS.some((s) => s.code === overId) ? overId : cardStage[overId];
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const copy: Record<string, any[]> = { ...prev };
      const source = [...(copy[from] || [])];
      const target = [...(copy[to] || [])];
      const idx = source.findIndex((l) => l.id === activeId);
      if (idx < 0) return prev;
      const [moved] = source.splice(idx, 1);
      const targetIdx = target.findIndex((l) => l.id === overId);
      if (targetIdx >= 0) target.splice(targetIdx, 0, moved); else target.push(moved);
      copy[from] = source; copy[to] = target;
      return copy;
    });
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveLead(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = cardStage[activeId];
    const to = COL_DEFS.some((s) => s.code === overId) ? overId : cardStage[overId];
    if (!from || !to) return;
    const moved = items[from]?.find((l) => l.id === activeId);
    if (!moved) return;

    if (to === 'WON') { setWonLead(moved); return; }
    if (to === 'LOST') { setLostLead(moved); return; }

    const prev = items;
    if (from !== to) {
      setItems((c) => { const copy: Record<string, any[]> = { ...c }; const src = [...(copy[from] || [])]; const tgt = [...(copy[to] || [])]; const idx = src.findIndex((l) => l.id === activeId); if (idx >= 0) { const [m] = src.splice(idx, 1); const oi = tgt.findIndex((l) => l.id === overId); if (oi >= 0) tgt.splice(oi, 0, m); else tgt.push(m); } copy[from] = src; copy[to] = tgt; return copy; });
      try { await api(`/crm/leads/${activeId}/stage`, { method: 'POST', body: JSON.stringify({ stage: to }) }); refresh(); }
      catch (err: any) { setItems(prev); message.error(`Unable to move lead to ${stageDef(to).label}. ${err.message || ''}`); }
    } else {
      // same stage reorder
      const order = [...(items[to] || [])];
      const fromIdx = order.findIndex((l) => l.id === activeId);
      if (fromIdx < 0) return;
      const [movedCard] = order.splice(fromIdx, 1);
      const oi = order.findIndex((l) => l.id === overId);
      const insertAt = oi >= 0 ? oi : order.length;
      order.splice(insertAt, 0, movedCard);
      setItems((c) => ({ ...c, [to]: order }));
      const afterId = order[insertAt - 1]?.id;
      const beforeId = order[insertAt + 1]?.id;
      try { await api(`/crm/leads/${activeId}/position`, { method: 'POST', body: JSON.stringify({ stage: to, afterId, beforeId }) }); refresh(); }
      catch (err: any) { setItems(prev); message.error(`Unable to reorder. ${err.message || ''}`); }
    }
  };

  async function runConvert() {
    const v = await convertForm.validateFields().catch(() => null);
    if (!v) return;
    const customerId = v.linkMode === 'link' ? v.customerId : undefined;
    const forceCreate = v.linkMode === 'new';
    try {
      await api(`/crm/leads/${convertLead.id}/convert`, { method: 'POST', body: JSON.stringify({ customerId, forceCreate, createOpportunity: true }) });
      message.success('Lead converted to customer + opportunity'); setConvertLead(null); refresh();
      qc.invalidateQueries({ queryKey: ['/sales/customers'] });
    } catch (e: any) { message.error(e.message); }
  }

  async function runWon() {
    const v = await wonForm.validateFields().catch(() => null);
    if (!v) return;
    try { await api(`/crm/leads/${wonLead.id}/won`, { method: 'POST', body: JSON.stringify({ dealValue: v.dealValue, closeDate: v.closeDate?.format('YYYY-MM-DD'), customerId: v.customerId, nextStep: v.nextStep }) }); message.success('Marked as won'); setWonLead(null); refresh(); }
    catch (e: any) { message.error(e.message); }
  }
  async function runLost() {
    const v = await lostForm.validateFields().catch(() => null);
    if (!v) return;
    try { await api(`/crm/leads/${lostLead.id}/lost`, { method: 'POST', body: JSON.stringify({ lostReason: v.lostReason, lostCompetitor: v.lostCompetitor, notes: v.notes }) }); message.success('Marked as lost'); setLostLead(null); refresh(); }
    catch (e: any) { message.error(e.message); }
  }
  async function runQuote() {
    const target = quoteLead;
    try {
      const opp = target?.opportunities?.[0];
      if (opp) { await api(`/crm/opportunities/${opp.id}/quote`, { method: 'POST' }); message.success('Quote created'); setQuoteLead(null); refresh(); }
      else if (target?.convertedCustomerId) { window.dispatchEvent(new CustomEvent('crm-quote-customer', { detail: target.convertedCustomerId })); message.success('Quote drafting started'); setQuoteLead(null); }
      else message.info('Link this lead to a customer (Convert first) to create a quote.');
    } catch (e: any) { message.error(e.message); }
  }

  const colHeaders = useMemo(() => {
    const res: Record<string, { count: number; value: number }> = {};
    COL_DEFS.forEach((s) => {
      const arr = items[s.code] || [];
      res[s.code] = { count: arr.length, value: arr.reduce((sum: number, l: any) => sum + Number(l.estimatedValue || 0), 0) };
    });
    return res;
  }, [items]);

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4 items-start" style={{ minHeight: 480 }}>
          {COL_DEFS.map((col) => <BoardColumn key={col.code} stage={col.code} items={items[col.code] || []} onOpenDetail={onOpenDetail} onEditLead={onEditLead} header={colHeaders[col.code]} />)}
        </div>
        <DragOverlay>{activeLead && <div className="bg-white rounded-xl border border-[#c7d2fe] shadow-lg p-3.5 w-[260px] opacity-90"><div className="font-semibold text-[14px] text-[#171a2e]">{activeLead.name}</div><div className="text-[12px] text-[#8a90ad]">{activeLead.companyName}</div><div className="font-bold text-[13px] text-[#171a2e] mt-1">{fmtMoney(activeLead.estimatedValue)}</div></div>}</DragOverlay>
      </DndContext>

      {/* Won modal */}
      <Modal open={!!wonLead} onCancel={() => setWonLead(null)} onOk={runWon} okText="Mark Won" title={`Mark ${wonLead?.name || ''} as Won`} destroyOnHidden>
        <Form form={wonForm} layout="vertical" className="mt-2">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Deal Value" name="dealValue" initialValue={wonLead?.estimatedValue}><InputNumber prefix="$" className="w-full" /></Form.Item>
            <Form.Item label="Close Date" name="closeDate" initialValue={dayjs()}><DatePicker className="w-full" /></Form.Item>
          </div>
          <Form.Item label="Customer" name="customerId"><Select showSearch optionFilterProp="label" allowClear placeholder="Link/create customer" options={(customers.data || []).map((c: any) => ({ label: c.name, value: c.id }))} /></Form.Item>
          <Form.Item label="Next Step" name="nextStep"><Input placeholder="e.g. Create Sales Order" /></Form.Item>
        </Form>
      </Modal>

      {/* Lost modal */}
      <Modal open={!!lostLead} onCancel={() => setLostLead(null)} onOk={runLost} okText="Mark Lost" title={`Mark ${lostLead?.name || ''} as Lost`} destroyOnHidden>
        <Form form={lostForm} layout="vertical" className="mt-2">
          <Form.Item label="Lost Reason" name="lostReason" rules={[{ required: true }]}><Select options={LOST_REASONS.map((r) => ({ label: r, value: r }))} placeholder="Required" /></Form.Item>
          <Form.Item label="Competitor" name="lostCompetitor"><Input /></Form.Item>
          <Form.Item label="Notes" name="notes"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      {/* Convert modal */}
      <Modal open={!!convertLead} onCancel={() => setConvertLead(null)} onOk={runConvert} okText="Convert" title={`Convert ${convertLead?.name || ''} to Customer`} destroyOnHidden>
        <Form form={convertForm} layout="vertical" className="mt-2" initialValues={{ linkMode: 'new' }}>
          <Form.Item label="Resolution" name="linkMode"><Select options={[{ label: 'Create a new customer', value: 'new' }, { label: 'Link to an existing customer', value: 'link' }]} /></Form.Item>
          {convertMode === 'link' && <Form.Item label="Existing Customer" name="customerId" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers.data || []).map((c: any) => ({ label: c.name, value: c.id }))} /></Form.Item>}
        </Form>
      </Modal>
    </>
  );
}

function BoardColumn({ stage, items, onOpenDetail, onEditLead, header }: { stage: string; items: any[]; onOpenDetail: (id: string) => void; onEditLead: (l: any) => void; header?: any }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { type: 'column', stage } });
  const col = stageDef(stage);
  return (
    <div ref={setNodeRef} className={`rounded-2xl p-2.5 min-w-[264px] flex-1 transition-colors ${isOver ? 'bg-[#dbe7ff] ring-2 ring-[#0b4a8f]/30' : 'bg-[#f0f1f7]'}`}>
      <div className="flex items-center justify-between mb-3 px-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
          <span className="font-bold text-[13px] text-[#363a5c] uppercase tracking-wide">{col.label}</span>
          <span className="text-[11px] font-semibold text-[#8a90ad] bg-white rounded-full px-2 py-0.5">{header?.count || 0}</span>
        </div>
        <span className="text-[11px] font-bold text-[#8a90ad]">{header ? fmtMoney(header.value) : ''}</span>
      </div>
      <SortableContext items={items.map((l) => l.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2.5">
          {items.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-[11px] text-[#a1a6c0]">No leads in {col.label}</span>} />}
          {items.map((l: any) => <LeadCard key={l.id} lead={l} stage={stage} onClick={() => onOpenDetail(l.id)} />)}
        </div>
      </SortableContext>
    </div>
  );
}
