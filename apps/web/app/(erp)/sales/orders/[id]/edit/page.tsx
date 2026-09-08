'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Alert, Skeleton, Tabs } from 'antd';
import { api } from '@/lib/api';
import { SalesOrderForm } from '@/components/sales/sales-order-form';
import { DocumentPreview, type PreviewVm } from '@/components/documents/document-preview';
import { DocumentTrail } from '@/components/documents/document-trail';
import { SalesDocumentFlow } from '@/components/sales/related-transactions';

export default function EditSalesOrderPage() {
  const { id } = useParams();
  const list = useQuery({ queryKey: ['/sales/sales-orders'], queryFn: () => api('/sales/sales-orders') });
  const preview = useQuery({ queryKey: ['/documents/sales-order', id], queryFn: () => api(`/documents/sales-order/${id}`), enabled: !!id });
  if (list.isLoading) return <div className="nex-fade max-w-[1024px] mx-auto pt-6"><Skeleton active paragraph={{ rows: 8 }} /></div>;
  if (list.error) return <div className="nex-fade max-w-[1024px] mx-auto pt-6"><Alert type="error" message={(list.error as Error).message} /></div>;
  const record = (list.data || []).find((o: any) => o.id === id);
  if (!record) return <div className="nex-fade max-w-[1024px] mx-auto pt-6"><Alert type="warning" message="Sales order not found" /></div>;

  return (
    <div className="nex-fade max-w-[1024px] mx-auto">
      <Tabs items={[
        { key: 'edit', label: 'Edit Sales Order', children: <SalesOrderForm record={record} onSaved={() => {}} /> },
        {
          key: 'preview', label: 'Document Preview',
          children: preview.isLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : preview.error ? <Alert type="error" message={(preview.error as Error).message} /> : <DocumentPreview vm={preview.data as PreviewVm} />,
        },
        { key: 'trail', label: 'Order Trail', children: <DocumentTrail type="sales-order" id={id as string} /> },
        { key: 'flow', label: 'Document Flow', children: <SalesDocumentFlow kind="order" record={record} /> },
      ]} />
    </div>
  );
}
