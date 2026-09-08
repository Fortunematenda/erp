'use client';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Skeleton } from 'antd';
import { CloseOutlined, DownloadOutlined, PrinterOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { DocumentPreview, type PreviewVm } from './document-preview';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export function DocViewer({ open, onClose, type, id, autoPrint }: { open: boolean; onClose: () => void; type: 'invoice' | 'quotation' | 'sales-order' | 'delivery' | 'receipt'; id: string; autoPrint?: boolean }) {
  const q = useQuery({ queryKey: ['/documents', type, id], queryFn: () => api(`/documents/${type}/${id}`), enabled: open && !!id });
  const token = useAuth.getState().token;

  useEffect(() => {
    if (open && autoPrint && q.data) { const t = setTimeout(() => window.print(), 500); return () => clearTimeout(t); }
  }, [open, autoPrint, q.data]);

  if (!open) return null;

  async function download() {
    try {
      const res = await fetch(`${BASE}/documents/${type}/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${type === 'quotation' ? 'Quote' : 'Invoice'}_${(q.data as any)?.number || id}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) { /* silent */ }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-200/95 overflow-auto">
      <div className="no-print sticky top-0 z-10 flex items-center gap-2 bg-white p-3 border-b border-slate-200">
        <Button icon={<CloseOutlined />} onClick={onClose}>Close</Button>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
        <Button icon={<DownloadOutlined />} onClick={download}>Download PDF</Button>
        <span className="text-[12px] text-slate-500 self-center">Status shown below reflects the live invoice.</span>
      </div>
      <div className="print-root max-w-3xl mx-auto p-4 print:p-0">
        {q.isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : q.error ? <Alert type="error" message={(q.error as Error).message} /> : <DocumentPreview vm={q.data as PreviewVm} />}
      </div>
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .print-root, .print-root * { visibility: visible !important; }
          .print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .invoice-status-stamp { display: block !important; opacity: 0.72 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

