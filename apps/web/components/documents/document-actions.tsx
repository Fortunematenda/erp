'use client';
import { Button, Space, message } from 'antd';
import { DownloadOutlined, MailOutlined, PrinterOutlined } from '@ant-design/icons';
import { useAuth } from '@/lib/auth-store';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function sanitize(name: string) { return name.replace(/[^a-zA-Z0-9_-]/g, '_'); }

export function DocumentActions({ type, id, vm }: { type: string; id: string; vm: any }) {
  const token = useAuth.getState().token;
  const isQuote = type === 'quotation' || type === 'quote';
  const number = vm?.number || id;
  const company = vm?.company?.name || 'NexusERP';
  const to = vm?.party?.email;
  const filename = `${isQuote ? 'Quote' : 'Invoice'}_${sanitize(number)}.pdf`;
  const subject = `${isQuote ? 'Quotation' : 'Invoice'} ${number} from ${company}`;
  const body = `Dear ${vm?.party?.name || 'Customer'},\n\nPlease find attached your ${isQuote ? 'quotation' : 'invoice'} ${number}.\n\nRegards,\n${company}`;

  async function fetchPdf(): Promise<Blob> {
    const res = await fetch(`${BASE}/documents/${type}/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('PDF could not be generated.');
    return res.blob();
  }
  function save(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function download() { try { save(await fetchPdf()); } catch (e: any) { message.error(e.message); } }
  async function email() {
    if (!to) { message.warning('No customer email address on file.'); return; }
    try { save(await fetchPdf()); message.success('PDF downloaded — attach it to the email in your mail client.'); } catch (e: any) { message.error(e.message); }
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <Space wrap>
      <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
      <Button icon={<DownloadOutlined />} onClick={download}>Download PDF</Button>
      <Button icon={<MailOutlined />} onClick={email}>Email</Button>
    </Space>
  );
}

