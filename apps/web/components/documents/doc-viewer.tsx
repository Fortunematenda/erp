'use client';
import { useEffect, useState } from 'react';
import { App, Button, Space } from 'antd';
import { CloseOutlined, DownloadOutlined, PrinterOutlined } from '@ant-design/icons';
import { useAuth } from '@/lib/auth-store';
import { documentPdfFilename, downloadBlob, fetchDocumentPdf, printDocumentPdf } from '@/lib/document-pdf';
import { DocumentPdfPane } from './document-pdf-pane';

export function DocViewer({
  open,
  onClose,
  type,
  id,
  number,
  autoPrint,
  autoDownload,
}: {
  open: boolean;
  onClose: () => void;
  type: 'invoice' | 'quotation' | 'sales-order' | 'delivery' | 'receipt';
  id: string;
  number?: string;
  autoPrint?: boolean;
  autoDownload?: boolean;
}) {
  const { message } = App.useApp();
  const token = useAuth((s) => s.token);
  const [busy, setBusy] = useState<'print' | 'download' | null>(null);

  useEffect(() => {
    if (!open || !id) return;
    (async () => {
      try {
        if (autoPrint) await printDocumentPdf(type, id, token);
        else if (autoDownload) {
          downloadBlob(await fetchDocumentPdf(type, id, token), documentPdfFilename(type, number || id));
          message.success('PDF downloaded');
        }
      } catch (e: any) {
        message.error(e?.message || 'Could not open document');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, autoPrint, autoDownload]);

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
      downloadBlob(await fetchDocumentPdf(type, id, token), documentPdfFilename(type, number || id));
      message.success('PDF downloaded');
    } catch (e: any) {
      message.error(e?.message || 'Could not download PDF');
    } finally {
      setBusy(null);
    }
  }

  if (!open || !id) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-200/95 overflow-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-4 py-3 border-b border-slate-200">
        <span className="text-[15px] font-medium text-[#171a2e]">
          {number ? `Preview · ${number}` : 'Document preview'}
        </span>
        <Space>
          <Button icon={<PrinterOutlined />} loading={busy === 'print'} onClick={onPrint}>
            Print
          </Button>
          <Button icon={<DownloadOutlined />} loading={busy === 'download'} onClick={onDownload}>
            Download PDF
          </Button>
          <Button icon={<CloseOutlined />} onClick={onClose}>Close</Button>
        </Space>
      </div>
      <div className="max-w-[900px] mx-auto p-4 pb-10">
        <DocumentPdfPane type={type} id={id} number={number} />
      </div>
    </div>
  );
}
