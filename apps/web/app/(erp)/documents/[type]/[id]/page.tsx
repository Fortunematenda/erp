'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Alert, Button, Skeleton } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { DocumentActions } from '@/components/documents/document-actions';
import { DocumentPreview, type PreviewVm } from '@/components/documents/document-preview';

export default function DocumentPrint() {
  const params = useParams();
  const router = useRouter();
  const type = params?.type as string;
  const id = params?.id as string;
  const q = useQuery({ queryKey: ['/documents', type, id], queryFn: () => api(`/documents/${type}/${id}`) });

  if (q.isLoading) return <Skeleton active className="max-w-3xl mx-auto mt-10" />;
  if (q.error) return <div className="max-w-3xl mx-auto mt-10"><Alert type="error" message="Could not load document" description={(q.error as Error).message} /></div>;
  if (!q.data) return null;

  return (
    <>
      <div className="no-print sticky top-0 z-10 flex gap-2 items-center bg-white/95 p-3 border-b border-slate-200 flex-wrap">
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.back()}>Back</Button>
        <DocumentActions type={type} id={id} vm={q.data as PreviewVm} />
        <span className="text-[12px] text-slate-500 self-center">Print uses your browser; Email downloads the PDF then opens your mail client. Status is shown on the document.</span>
      </div>
      <div className="max-w-3xl mx-auto p-4 print:p-0">
        <DocumentPreview vm={q.data as PreviewVm} />
      </div>
      <style jsx global>{`@media print { .no-print { display:none!important; } .invoice-status-stamp { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; } }`}</style>
    </>
  );
}
