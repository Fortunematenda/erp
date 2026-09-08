'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Skeleton, Tabs } from 'antd';
import { DollarOutlined, MinusCircleOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { InvoiceForm } from '@/components/sales/sales-doc-form';
import { DocumentActions } from '@/components/documents/document-actions';
import { DocumentPreview, type PreviewVm } from '@/components/documents/document-preview';
import { DocumentTrail } from '@/components/documents/document-trail';
import { SalesDocumentFlow } from '@/components/sales/related-transactions';
import { ReceiveCustomerPaymentDrawer } from '@/components/receipts-workspace';

export default function EditInvoicePage() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const list = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices') });
  const preview = useQuery({ queryKey: ['/documents/invoice', id], queryFn: () => api(`/documents/invoice/${id}`), enabled: !!id });
  if (list.isLoading) return <div className="nex-fade max-w-[1024px] mx-auto pt-6"><Skeleton active paragraph={{ rows: 8 }} /></div>;
  if (list.error) return <div className="nex-fade max-w-[1024px] mx-auto pt-6"><Alert type="error" message={(list.error as Error).message} /></div>;
  const record = (list.data || []).find((i: any) => i.id === id);
  if (!record) return <div className="nex-fade max-w-[1024px] mx-auto pt-6"><Alert type="warning" message="Invoice not found" /></div>;

  const eligiblePay = record.invoiceStatus === 'POSTED' && ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(record.paymentStatus) && Number(record.balanceDue) > 0.001;

  return (
    <div className="nex-fade max-w-[1024px] mx-auto">
      {eligiblePay && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <Button type="primary" icon={<DollarOutlined />} onClick={() => setPayOpen(true)}>Receive Payment</Button>
          <Button icon={<PlusCircleOutlined />} onClick={() => router.push(`/sales/credit-notes?invoice=${record.id}`)}>Create Credit Note</Button>
          <Button icon={<MinusCircleOutlined />} onClick={() => router.push(`/sales/debit-notes?invoice=${record.id}`)}>Create Debit Note</Button>
          <span className="text-[12px] text-[#94a3b8]">Balance due {`$${Number(record.balanceDue).toFixed(2)}`}</span>
        </div>
      )}
      <Tabs items={[
        { key: 'edit', label: 'Edit Invoice', children: <InvoiceForm record={record} onSaved={() => {}} /> },
        {
          key: 'preview', label: 'Document Preview',
          children: preview.isLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : preview.error ? <Alert type="error" message={(preview.error as Error).message} /> : <DocumentPreview vm={preview.data as PreviewVm} />,
        },
        { key: 'trail', label: 'Invoice Trail', children: <DocumentTrail type="invoice" id={id as string} /> },
        { key: 'flow', label: 'Document Flow', children: <SalesDocumentFlow kind="invoice" record={record} /> },
      ]} />
      <ReceiveCustomerPaymentDrawer
        open={payOpen}
        initialCustomerId={record.customerId}
        initialInvoiceId={record.id}
        onClose={() => setPayOpen(false)}
        onCreated={() => { qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); qc.invalidateQueries({ queryKey: ['/sales/receipts'] }); setPayOpen(false); }}
      />
    </div>
  );
}
