'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Skeleton, Tag, message } from 'antd';
import {
  CheckCircleOutlined, CommentOutlined, EditOutlined, FileTextOutlined, PlusOutlined, StopOutlined, UserOutlined,
} from '@ant-design/icons';
import { api } from '@/lib/api';

const ICONS: Record<string, any> = {
  CREATED: <UserOutlined />, UPDATED: <EditOutlined />,
  CUSTOMER_ACTIVATED: <CheckCircleOutlined />, CUSTOMER_DEACTIVATED: <StopOutlined />,
  NOTE_ADDED: <CommentOutlined />,
};
function Icon({ type }: { type: string }) { return <>{ICONS[type] || <FileTextOutlined />}</>; }
function tone(type: string) {
  if (type === 'CUSTOMER_ACTIVATED') return '#16A34A';
  if (type === 'CUSTOMER_DEACTIVATED') return '#dc2626';
  if (type === 'NOTE_ADDED') return '#f59e0b';
  if (type === 'CREATED') return '#0ea5e9';
  return '#64748b';
}

export function CustomerTrail({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['/sales/customers/trail', customerId], queryFn: () => api(`/sales/customers/${customerId}/trail`), enabled: !!customerId });

  const addNote = useMutation({
    mutationFn: (text: string) => api(`/sales/customers/${customerId}/notes`, { method: 'POST', body: JSON.stringify({ note: text }) }),
    onSuccess: () => { message.success('Note added'); setNoteOpen(false); setNote(''); qc.invalidateQueries({ queryKey: ['/sales/customers/trail', customerId] }); },
    onError: (e: any) => message.error(e.message),
  });

  const events = q.data?.events || [];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[12px] text-[#64748b]">{events.length} events</div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setNoteOpen(true)}>Add Note</Button>
      </div>
      {q.isLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : q.error ? <div className="text-[#dc2626]">{(q.error as Error).message}</div> : (
        <div className="relative">
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-[#eef0f6]" />
          {events.map((e: any) => (
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
          {!events.length && <div className="text-center text-[#94a3b8] text-[13px] py-6">No activity yet.</div>}
        </div>
      )}
      <Modal open={noteOpen} onCancel={() => setNoteOpen(false)} onOk={() => addNote.mutate(note)} confirmLoading={addNote.isPending} title="Add Note" okText="Add Note">
        <Input.TextArea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note about this customer…" />
      </Modal>
    </div>
  );
}
