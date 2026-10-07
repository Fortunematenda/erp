'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, Skeleton, Tabs } from 'antd';
import { DollarOutlined, MinusCircleOutlined, PlusCircleOutlined, RobotOutlined } from '@ant-design/icons';
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
  const devices = useQuery({ queryKey: ['fiscal-devices'], queryFn: () => api('/fiscalisation/devices') });
  if (list.isLoading) return <div className="nex-fade pt-6"><Skeleton active paragraph={{ rows: 8 }} /></div>;
  if (list.error) return <div className="nex-fade pt-6"><Alert type="error" message={(list.error as Error).message} /></div>;
  const record = (list.data || []).find((i: any) => i.id === id);
  if (!record) return <div className="nex-fade pt-6"><Alert type="warning" message="Invoice not found" /></div>;

  const eligiblePay = record.invoiceStatus === 'POSTED' && ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(record.paymentStatus) && Number(record.balanceDue) > 0.001;
  const docId = id as string;

  const received = (record.receipts || []).reduce((s: number, x: any) => s + Number(x.amount), 0);
  const isPaid = received >= Number(record.total) - 0.001;
  const canFiscal = isPaid && record.fiscalRequired !== false && !['FISCALISED', 'PENDING', 'SUBMITTED'].includes(record.fiscalStatus);

  function doFiscal() {
    const devs = devices.data || [];
    const dev = devs.find((d: any) => d.status === 'ACTIVE' && d.branchId === record.branchId) || devs.find((d: any) => d.status === 'ACTIVE');
    if (!dev) { Modal.error({ title: 'No fiscal device', content: 'No active fiscal device is configured. Configure one under Fiscalisation → ZIMRA FDMS.' }); return; }
    Modal.confirm({
      title: `Fiscalise invoice ${record.invoiceNo}?`,
      content: "This submits the invoice to the ZIMRA FDMS using the branch's fiscal device (opening a fiscal day if needed) and stores the fiscal receipt. This cannot be undone.",
      okText: 'Fiscalise',
      onOk: async () => {
        try {
          if (dev.dayStatus !== 'OPEN') await api(`/fiscalisation/devices/${dev.id}/open-day`, { method: 'POST' });
          const res = await api(`/fiscalisation/devices/${dev.id}/fiscalise`, { method: 'POST', body: JSON.stringify({ invoiceId: record.id }) });
          invalidateDocs();
          qc.invalidateQueries({ queryKey: ['fiscal-receipts'] });
          qc.invalidateQueries({ queryKey: ['fiscal-devices'] });
          Modal.success({ title: 'Fiscalised', content: res?.zimraReceiptId ? `Fiscal receipt ${res.zimraReceiptId}` : 'Fiscal receipt stored.' });
        } catch (e: any) { Modal.error({ title: 'Fiscalisation failed', content: e.message }); }
      },
    });
  }

  const invalidateDocs = () => {
    qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
    qc.invalidateQueries({ queryKey: ['/documents', 'invoice', docId] });
    qc.invalidateQueries({ queryKey: ['/documents/invoice', docId] });
    qc.invalidateQueries({ queryKey: ['/documents', 'invoice', docId, 'pdf'] });
  };

  return (
    <div className="nex-fade">
      {(eligiblePay || canFiscal) && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          {eligiblePay && <Button type="primary" icon={<DollarOutlined />} onClick={() => setPayOpen(true)}>Receive Payment</Button>}
          {eligiblePay && <Button icon={<PlusCircleOutlined />} onClick={() => router.push(`/sales/credit-notes?invoice=${record.id}`)}>Create Credit Note</Button>}
          {eligiblePay && <Button icon={<MinusCircleOutlined />} onClick={() => router.push(`/sales/debit-notes?invoice=${record.id}`)}>Create Debit Note</Button>}
          {canFiscal && <Button type="primary" icon={<RobotOutlined />} onClick={doFiscal}>Fiscalise</Button>}
          {eligiblePay && <span className="text-[12px] text-[#94a3b8]">Balance due {`$${Number(record.balanceDue).toFixed(2)}`}</span>}
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
