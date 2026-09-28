'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Space } from 'antd';
import { ArrowLeftOutlined, DownloadOutlined, PrinterOutlined } from '@ant-design/icons';
import { useAuth } from '@/lib/auth-store';
import { documentPdfFilename, downloadBlob, fetchDocumentPdf, printDocumentPdf } from '@/lib/document-pdf';
import { DocumentPdfPane } from '@/components/documents/document-pdf-pane';

export default function DocumentPrint() {
  const params = useParams();
  const router = useRouter();
  const { message } = App.useApp();
  const token = useAuth((s) => s.token);
  const type = params?.type as string;
  const id = params?.id as string;
  const [busy, setBusy] = useState<'print' | 'download' | null>(null);

  async function onPrint() {
    setBusy('print');
    try {
      await printDocumentPdf(type, id, token);
    } catch (e: any) {
      message.error(e?.message || 'Could not print');
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    setBusy('download');
    try {
      downloadBlob(await fetchDocumentPdf(type, id, token), documentPdfFilename(type, id));
      message.success('PDF downloaded');
    } catch (e: any) {
      message.error(e?.message || 'Could not download PDF');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="sticky top-0 z-10 flex gap-2 items-center justify-between bg-white/95 p-3 border-b border-slate-200 flex-wrap">
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.back()}>Back</Button>
        <Space>
          <Button icon={<PrinterOutlined />} loading={busy === 'print'} onClick={onPrint}>Print</Button>
          <Button icon={<DownloadOutlined />} loading={busy === 'download'} onClick={onDownload}>Download PDF</Button>
        </Space>
      </div>
      <div className="max-w-[900px] mx-auto p-4">
        <DocumentPdfPane type={type} id={id} />
      </div>
    </>
  );
}
