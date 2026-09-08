'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Popconfirm, Skeleton, Spin, Tabs, message } from 'antd';
import { FileDoneOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { QuoteForm } from '@/components/sales/sales-doc-form';
import { DocumentPreview, type PreviewVm } from '@/components/documents/document-preview';
import { DocumentTrail } from '@/components/documents/document-trail';
import { SalesDocumentFlow } from '@/components/sales/related-transactions';

export default function EditQuotePage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ['/sales/quotations'], queryFn: () => api('/sales/quotations') });
  const preview = useQuery({ queryKey: ['/documents/quotation', id], queryFn: () => api(`/documents/quotation/${id}`), enabled: !!id });
  if (list.isLoading) return <div className="nex-fade max-w-3xl mx-auto p-8 text-center text-slate-400"><Spin /></div>;
  const record = (list.data || []).find((x: any) => x.id === id);
  if (!record) return <div className="nex-fade max-w-3xl mx-auto p-8 text-center text-slate-400">Quotation not found</div>;
  const canConvert = ['OPEN', 'PENDING', 'SENT', 'ACCEPTED'].includes(String(record.status || '').toUpperCase()) && record.conversionType == null;

  async function convert(to: 'order' | 'invoice') {
    setBusy(true);
    try {
      const res: any = await api(`/sales/quotations/${record.id}/convert${to === 'order' ? '' : '-invoice'}`, { method: 'POST' });
      message.success(`Converted to ${to === 'order' ? 'Sales Order' : 'Invoice'}`);
      qc.invalidateQueries({ queryKey: ['/sales/quotations'] });
      qc.invalidateQueries({ queryKey: ['/sales/sales-orders'] });
      qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
      router.push(to === 'order' ? `/sales/orders/${(res as any).id}/edit` : `/sales/invoices/${(res as any).id}/edit`);
    } catch (e: any) { message.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="nex-fade max-w-[1024px] mx-auto">
      {canConvert && (
        <div className="mb-4 flex items-center gap-2 flex-wrap rounded-xl border border-[#eef0f6] bg-white px-4 py-3">
          <span className="text-[13px] font-medium text-[#344054]">This quote is accepted. Convert it to:</span>
          <Popconfirm title="Convert this quote to a Sales Order?" onConfirm={() => convert('order')}><Button type="primary" icon={<ShoppingCartOutlined />} loading={busy}>Convert to Sales Order</Button></Popconfirm>
          <Popconfirm title="Convert this quote directly to an Invoice?" onConfirm={() => convert('invoice')}><Button icon={<FileDoneOutlined />} loading={busy}>Convert to Invoice</Button></Popconfirm>
        </div>
      )}
      <Tabs items={[
        { key: 'edit', label: 'Edit Quote', children: <QuoteForm record={record} onSaved={() => {}} /> },
        {
          key: 'preview', label: 'Document Preview',
          children: preview.isLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : preview.error ? <Alert type="error" message={(preview.error as Error).message} /> : <DocumentPreview vm={preview.data as PreviewVm} />,
        },
        { key: 'trail', label: 'Quote Trail', children: <DocumentTrail type="quotation" id={id} /> },
        { key: 'flow', label: 'Document Flow', children: <SalesDocumentFlow kind="quote" record={record} /> },
      ]} />
    </div>
  );
}
