'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Skeleton, Tabs } from 'antd';
import { DollarOutlined, MinusCircleOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { InvoiceForm } from '@/components/sales/sales-doc-form';
import { DocumentTrail } from '@/components/documents/document-trail';
import { SalesDocumentFlow } from '@/components/sales/related-transactions';
import { ReceiveCustomerPaymentDrawer } from '@/components/receipts-workspace';

export default function EditInvoicePage() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const list = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices') });
  if (list.isLoading) return <div className="nex-fade pt-6"><Skeleton active paragraph={{ rows: 8 }} /></div>;
  if (list.error) return <div className="nex-fade pt-6"><Alert type="error" message={(list.error as Error).message} /></div>;
  const record = (list.data || []).find((i: any) => i.id === id);
  if (!record) return <div className="nex-fade pt-6"><Alert type="warning" message="Invoice not found" /></div>;

  const eligiblePay = record.invoiceStatus === 'POSTED' && ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(record.paymentStatus) && Number(record.balanceDue) > 0.001;
  const docId = id as string;

  const invalidateDocs = () => {
    qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
    qc.invalidateQueries({ queryKey: ['/documents', 'invoice', docId] });
    qc.invalidateQueries({ queryKey: ['/documents/invoice', docId] });
    qc.invalidateQueries({ queryKey: ['/documents', 'invoice', docId, 'pdf'] });
  };

  return (
    <div className="nex-fade">
      {eligiblePay && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <Button type="primary" icon={<DollarOutlined />} onClick={() => setPayOpen(true)}>Receive Payment</Button>
          <Button icon={<PlusCircleOutlined />} onClick={() => router.push(`/sales/credit-notes?invoice=${record.id}`)}>Create Credit Note</Button>
          <Button icon={<MinusCircleOutlined />} onClick={() => router.push(`/sales/debit-notes?invoice=${record.id}`)}>Create Debit Note</Button>
          <span className="text-[12px] text-[#94a3b8]">Balance due {`$${Number(record.balanceDue).toFixed(2)}`}</span>
        </div>
      )}
      <Tabs items={[
        { key: 'invoice', label: 'Invoice', children: <InvoiceForm record={record} onSaved={invalidateDocs} /> },
        { key: 'activity', label: 'Activity', children: <DocumentTrail type="invoice" id={docId} /> },
        { key: 'related', label: 'Related', children: <SalesDocumentFlow kind="invoice" record={record} /> },
      ]} />
      <ReceiveCustomerPaymentDrawer
        open={payOpen}
        initialCustomerId={record.customerId || record.customer?.id}
        initialInvoiceId={record.id}
        onClose={() => setPayOpen(false)}
        onCreated={() => {
          invalidateDocs();
          qc.invalidateQueries({ queryKey: ['/sales/receipts'] });
          setPayOpen(false);
        }}
      />
    </div>
  );
}
