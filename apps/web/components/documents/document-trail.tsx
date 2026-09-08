'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Skeleton, Spin, Tag, message } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, CommentOutlined, DatabaseOutlined, EditOutlined,
  FileTextOutlined, MailOutlined, StopOutlined, SwapOutlined, WalletOutlined, WarningOutlined, PlusOutlined,
} from '@ant-design/icons';
import { api } from '@/lib/api';

const ICONS: Record<string, any> = {
  CREATED: <FileTextOutlined />, UPDATED: <EditOutlined />, STATUS_CHANGED: <EditOutlined />,
  SENT_EMAIL: <MailOutlined />, EMAIL_SENT: <MailOutlined />, EMAIL_FAILED: <WarningOutlined />,
  POSTED: <CheckCircleOutlined />, FISCALISED: <CheckCircleOutlined />, FISCAL_RETRY: <DatabaseOutlined />,
  PAYMENT_RECEIVED: <WalletOutlined />, PART_PAID: <WalletOutlined />, PAID: <CheckCircleOutlined />, OVERDUE: <ClockCircleOutlined />,
  CREDIT_NOTE_CREATED: <EditOutlined />, VOIDED: <StopOutlined />,
  QUOTE_ACCEPTED: <CheckCircleOutlined />, QUOTE_DECLINED: <StopOutlined />, QUOTE_EXPIRED: <ClockCircleOutlined />, QUOTE_CONVERTED: <SwapOutlined />,
  ORDER_CREATED: <EditOutlined />, ORDER_CONFIRMED: <CheckCircleOutlined />, ORDER_CLOSED: <StopOutlined />, ORDER_CANCELLED: <StopOutlined />,
  INVOICE_CREATED: <CheckCircleOutlined />, FULFILLED: <CheckCircleOutlined />, PARTIALLY_FULFILLED: <ClockCircleOutlined />,
  PARTIALLY_INVOICED: <ClockCircleOutlined />, INVOICED: <CheckCircleOutlined />,
  NOTE_ADDED: <CommentOutlined />,
};
function Icon({ type }: { type: string }) { return <>{ICONS[type] || <FileTextOutlined />}</>; }
function tone(type: string) {
  if (type === 'EMAIL_SENT' || type === 'SENT_EMAIL') return '#0284c7';
  if (type === 'PAID' || type === 'POSTED' || type === 'FISCALISED' || type === 'ORDER_CONFIRMED' || type === 'INVOICE_CREATED' || type === 'FULFILLED' || type === 'INVOICED') return '#16A34A';
  if (type === 'OVERDUE' || type === 'EMAIL_FAILED' || type === 'QUOTE_DECLINED' || type === 'ORDER_CANCELLED') return '#dc2626';
  if (type === 'NOTE_ADDED') return '#f59e0b';
  if (type === 'QUOTE_CONVERTED' || type === 'PARTIALLY_FULFILLED' || type === 'PARTIALLY_INVOICED') return '#0284c7';
  if (type === 'ORDER_CLOSED') return '#64748b';
  return '#64748b';
}
const FILTERS: Record<string, string[]> = {
  All: [], 'Status Changes': ['STATUS_CHANGED', 'POSTED', 'VOIDED', 'QUOTE_ACCEPTED', 'QUOTE_DECLINED', 'QUOTE_EXPIRED', 'QUOTE_CONVERTED'],
  Emails: ['EMAIL_SENT', 'SENT_EMAIL', 'EMAIL_FAILED'], Payments: ['PAYMENT_RECEIVED', 'PART_PAID', 'PAID', 'OVERDUE'],
  Fiscalisation: ['FISCALISED', 'FISCAL_RETRY'], Notes: ['NOTE_ADDED'], System: ['CREATED', 'UPDATED'],
};

export function DocumentTrail({ type, id }: { type: 'invoice' | 'quotation' | 'sales-order' | 'delivery' | 'receipt' | 'credit-note' | 'debit-note'; id: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('All');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const q = useQuery({ queryKey: ['/documents/trail', type, id], queryFn: () => api(`/documents/${type}/${id}/trail`), enabled: !!id });
  if (q.data && events.length === 0 && q.isSuccess) setEvents(q.data.events || []);

  const addNote = useMutation({
    mutationFn: (text: string) => api(`/documents/${type}/${id}/notes`, { method: 'POST', body: JSON.stringify({ note: text }) }),
    onSuccess: () => { message.success('Note added'); setNoteOpen(false); setNote(''); qc.invalidateQueries({ queryKey: ['/documents/trail', type, id] }); },
    onError: (e: any) => message.error(e.message),
  });

  const visible = q.data?.events
    ? q.data.events.filter((e: any) => (FILTERS[filter] || []).length ? FILTERS[filter].includes(e.eventType) : true)
    : [];

  return (
    <div className="nex-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[12px] text-[#64748b]">{q.data?.events?.length || 0} events</div>
        <div className="flex gap-2">
          <Select className="!w-40" value={filter} onChange={setFilter} options={Object.keys(FILTERS).map((k) => ({ label: k === 'All' ? 'All Events' : k, value: k }))} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNoteOpen(true)}>Add Note</Button>
        </div>
      </div>
      {q.isLoading ? <Skeleton active paragraph={{ rows: 5 }} /> : q.error ? <div className="text-[#dc2626]">{(q.error as Error).message}</div> : (
        <div className="relative">
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-[#eef0f6]" />
          {visible.map((e: any) => (
            <div key={e.id} className="relative pl-11 pb-5">
              <div className="absolute left-0 top-0 w-8 h-8 rounded-full grid place-items-center text-white" style={{ background: tone(e.eventType) }}><Icon type={e.eventType} /></div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-[#171a2e]">{e.title}</span>
                  <Tag className="!text-[10px]" color={tone(e.eventType)}>{e.eventType}</Tag>
                </div>
                {e.description && <div className="text-[13px] text-[#344054] mt-0.5 whitespace-pre-line">{e.description}</div>}
                <div className="text-[11px] text-[#94a3b8] mt-1">{e.user ? `${e.user.firstName || ''} ${e.user.lastName || ''}` : '—'} • {new Date(e.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
          {!visible.length && <div className="text-center text-[#94a3b8] text-[13px] py-6">No events yet.</div>}
        </div>
      )}
      <Modal open={noteOpen} onCancel={() => setNoteOpen(false)} onOk={() => addNote.mutate(note)} confirmLoading={addNote.isPending} title="Add Quick Note" okText="Add Note">
        <Input.TextArea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Add a note…`} />
      </Modal>
    </div>
  );
}

