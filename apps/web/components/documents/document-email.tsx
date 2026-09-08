'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal, Space, Tag, message } from 'antd';
import { FilePdfOutlined, MailOutlined, PaperClipOutlined, SendOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { fmtMoney, fmtDate } from '@/lib/format';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function tokens(s: string, d: Record<string, any>): string {
  return String(s || '').replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (d[k] != null ? String(d[k]) : ''));
}
function fmtSize(bytes: number) { return bytes ? `${(bytes / 1024).toFixed(0)} KB` : ''; }

export type EmailDoc = { type: 'invoice' | 'quotation'; id: string };
export type DocumentEmailProvider = { sendDocumentEmail: (req: { type: string; id: string; to: string; subject: string; body: string; pdf: Blob }) => Promise<void> };

function useDocEmail(doc: EmailDoc) {
  const q = useQuery({ queryKey: ['/documents', doc.type, doc.id], queryFn: () => api(`/documents/${doc.type}/${doc.id}`), enabled: doc.id != null });
  const tplQ = useQuery({ queryKey: ['/delivery/templates', doc.type === 'quotation' ? 'quote' : 'invoice'], queryFn: () => api(`/delivery/templates/${doc.type === 'quotation' ? 'quote' : 'invoice'}`), enabled: doc.id != null });
  return { vm: q.data, tpl: tplQ.data, loading: q.isLoading, error: q.error as Error | null };
}

export function DocumentEmailModal({ doc, open, onClose }: { doc: EmailDoc | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const { vm, tpl, loading, error } = useDocEmail(doc || { type: 'invoice', id: '' });
  const [pdf, setPdf] = useState<{ blob: Blob; name: string; size: number } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const qc = useQueryClient();
  const token = useAuth.getState().token;

  const isQuote = doc?.type === 'quotation';
  const number = vm?.number || '';
  const company = vm?.company?.name || 'NexusERP';
  const customerName = vm?.party?.name || 'Customer';
  const customerEmail = vm?.party?.email || '';

  const prep = useMemo(() => {
    if (!vm) return null;
    const d: Record<string, any> = {
      customerName, companyName: company,
      invoiceNumber: number, quoteNumber: number,
      invoiceDate: vm.date ? fmtDate(vm.date) : '', quoteDate: vm.date ? fmtDate(vm.date) : '',
      dueDate: vm.dueDate ? fmtDate(vm.dueDate) : '', validUntil: vm.validUntil ? fmtDate(vm.validUntil) : '',
      total: fmtMoney(vm.total), balanceDue: fmtMoney(vm.balance ?? vm.total), status: vm.displayStatusLabel || vm.status || '',
    };
    const status = (vm.displayStatus || vm.status || '').toUpperCase();
    const defaultSubject = isQuote ? `Quotation ${number} from ${company}` : `Invoice ${number} from ${company}`;
    const subject = (tpl?.subject && tpl.subject !== `Invoice {{number}}` ? tokens(tpl.subject, d) : defaultSubject);
    let body = '';
    if (isQuote) {
      body = `Dear ${customerName},

Thank you for the opportunity to provide this quotation.

Please find attached Quotation ${number} from ${company}.

Quote Number: ${number}
Date: ${vm.date ? fmtDate(vm.date) : ''}
Valid Until: ${vm.validUntil ? fmtDate(vm.validUntil) : ''}
Quote Total: ${fmtMoney(vm.total)}

Please review the attached quotation and contact us if you have any questions.

We look forward to working with you.

Kind regards,
${company}`;
    } else if (status === 'PAID') {
      body = `Dear ${customerName},

Please find attached Invoice ${number} from ${company} for your records.

Invoice Number: ${number}
Invoice Date: ${vm.date ? fmtDate(vm.date) : ''}
Total: ${fmtMoney(vm.total)}
Status: PAID

Thank you for your payment and for your business.

Kind regards,
${company}`;
    } else if (status === 'OVERDUE') {
      body = `Dear ${customerName},

Please find attached Invoice ${number}.

Our records show an outstanding balance of ${fmtMoney(vm.balance ?? vm.total)}, which was due on ${vm.dueDate ? fmtDate(vm.dueDate) : ''}.

If payment has already been made, please disregard this reminder.

Kind regards,
${company}`;
    } else {
      body = `Dear ${customerName},

Please find attached Invoice ${number} from ${company}.

Invoice Number: ${number}
Invoice Date: ${vm.date ? fmtDate(vm.date) : ''}
${vm.dueDate ? `Due Date: ${fmtDate(vm.dueDate)}\n` : ''}Total: ${fmtMoney(vm.total)}
Balance Due: ${fmtMoney(vm.balance ?? vm.total)}

Please use ${number} as your payment reference.

Thank you for your business.

Kind regards,
${company}`;
    }
    const finalBody = tpl?.body && String(tpl.body).includes('\n') ? tokens(tpl.body, d) : body;
    return { subject: (tpl?.subject && String(tpl.subject).includes('{{') ? tokens(tpl.subject, d) : subject), body: finalBody, email: customerEmail };
  }, [vm, tpl, isQuote, number, company, customerName, customerEmail]);

  useEffect(() => {
    if (open && doc?.id && vm) {
      form.setFieldsValue({ to: prep?.email || '', subject: prep?.subject, message: prep?.body });
    }
  }, [open, doc?.id, vm, prep, form]);

  async function generatePdf() {
    if (!doc?.id) return;
    setPreparing(true);
    try {
      const res = await fetch(`${BASE}/documents/${doc.type}/${doc.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('PDF could not be generated');
      const blob = await res.blob();
      const name = `${isQuote ? 'Quote' : 'Invoice'}_${(vm?.number || doc.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      setPdf({ blob, name, size: blob.size });
    } catch (e: any) { message.error(e.message); } finally { setPreparing(false); }
  }
  useEffect(() => { if (open && doc?.id) generatePdf(); }, [open, doc?.id]);

  function saveAttachment(url: string) {
    const a = document.createElement('a'); a.href = url; a.download = pdf!.name; a.click();
  }

  async function openEmailApp() {
    const v = await form.validateFields().catch(() => null);
    if (!v || !v.to) { message.warning('Enter the recipient email address.'); return; }
    if (!pdf) { message.warning('PDF is still being prepared.'); return; }
    const subject = v.subject || prep?.subject;
    const body = v.message || prep?.body || '';
    const url = URL.createObjectURL(pdf.blob);
    // Native file sharing (mobile / some desktops)
    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.share) {
      const file = new File([pdf.blob], pdf.name, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: subject, text: body }); message.success('Shared.'); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
      }
    }
    // Desktop fallback: download PDF + open mailto (mailto cannot attach files)
    try {
      saveAttachment(url);
      window.location.href = `mailto:${encodeURIComponent(v.to)}${v.cc ? `?cc=${encodeURIComponent(v.cc)}` : ''}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      message.success('Email app opened. The PDF was downloaded for you to attach (browsers cannot attach via mailto).');
    } catch (e: any) {
      message.warning('Could not open your email app. The invoice PDF has been downloaded instead.');
    } finally { setTimeout(() => URL.revokeObjectURL(url), 3000); }
  }

  async function sendFromNexus() {
    const v = await form.validateFields().catch(() => null);
    if (!v || !v.to) { message.warning('Enter the recipient email address.'); return; }
    setSending(true);
    try {
      const r = await api(`/documents/${doc!.type}/${doc!.id}/email`, { method: 'POST', body: JSON.stringify({ to: [v.to], cc: v.cc ? [v.cc] : [], bcc: v.bcc ? [v.bcc] : [], subject: v.subject, message: v.message }) });
      message.success(`${isQuote ? 'Quotation' : 'Invoice'} emailed successfully to ${v.to}.`);
      qc.invalidateQueries({ queryKey: ['/documents/trail', doc!.type, doc!.id] });
      onClose();
    } catch (e: any) { message.error(e.message || 'Email could not be sent.'); }
    finally { setSending(false); }
  }

  const size = pdf?.size ? fmtSize(pdf.size) : '';
  return (
    <Modal open={open && !!doc} onCancel={onClose} footer={null} width={640} destroyOnHidden
      title={<span className="flex items-center gap-2"><MailOutlined style={{ color: '#003366' }} /> {isQuote ? 'Send Quote' : 'Send Invoice'}</span>}>
      {!doc?.id ? null : loading ? <Alert type="info" message="Loading document…" /> : error ? <Alert type="error" message={(error as Error).message} /> : (
        <Form form={form} layout="vertical" initialValues={{ to: prep?.email, subject: prep?.subject, message: prep?.body }}>
          <div className="grid grid-cols-3 gap-3">
            <Form.Item name="to" label="To" className="!mb-3 col-span-3" rules={[{ required: true, message: 'Enter the recipient email' }]}><Input placeholder="customer@example.com" /></Form.Item>
            <div className="col-span-3 grid grid-cols-2 gap-3">
              <Form.Item name="cc" label="CC" className="!mb-3"><Input placeholder="cc@example.com (optional)" /></Form.Item>
              <Form.Item name="bcc" label="BCC" className="!mb-3"><Input placeholder="bcc@example.com (optional)" /></Form.Item>
            </div>
            <Form.Item name="subject" label="Subject" className="!mb-3 col-span-3"><Input /></Form.Item>
            <Form.Item name="message" label="Message" className="!mb-3 col-span-3"><Input.TextArea rows={9} /></Form.Item>
          </div>
          <div className="flex items-center gap-2 mb-3 text-[13px] text-slate-600">
            <PaperClipOutlined /> <span className="font-semibold">{pdf ? pdf.name : 'Generating PDF…'}</span>{size ? <span className="text-slate-400">· {size}</span> : null}
            <span><FilePdfOutlined style={{ color: '#003366' }} /></span>
            {vm && <a href={`/documents/${doc.type}/${doc.id}`} target="_blank" rel="noreferrer" className="text-[13px]">Preview</a>}
          </div>
          <div className="flex justify-end">
            <Space>
              <Button onClick={onClose}>Cancel</Button>
              <Button icon={<MailOutlined />} loading={preparing} onClick={openEmailApp}>Open Email App</Button>
              <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={sendFromNexus}>Send from NexusERP</Button>
            </Space>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">Uses your device’s share sheet where supported; otherwise opens your email app and downloads the PDF for you to attach (mailto cannot attach files).</div>
        </Form>
      )}
    </Modal>
  );
}

export function DocumentEmailButton({ type, id, onClick }: { type: 'invoice' | 'quotation'; id?: string; onClick?: () => void }) {
  return <Button icon={<MailOutlined />} onClick={onClick} disabled={!id}>Send Email</Button>;
}

