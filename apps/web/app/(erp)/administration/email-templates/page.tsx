'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page';
import { Alert, Button, Card, Input, Space, Tabs, message } from 'antd';
import { SaveOutlined, SendOutlined } from '@ant-design/icons';

const PLACEHOLDERS = ['{{party}}', '{{number}}', '{{total}}', '{{due}}', '{{company}}', '{{signature}}'];

export default function EmailTemplates() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['/delivery/templates'], queryFn: () => api('/delivery/templates') });
  const tpls = data.data || {};
  const codes = Object.keys(tpls);
  const [active, setActive] = useState<string>(codes[0] || 'invoice');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  function select(code: string) { setActive(code); setSubject(tpls[code]?.subject || ''); setBody(tpls[code]?.body || ''); }
  async function save() {
    try { await api(`/delivery/templates/${active}`, { method: 'PUT', body: JSON.stringify({ subject, body }) }); message.success('Template saved'); qc.invalidateQueries({ queryKey: ['/delivery/templates'] }); } catch (e: any) { message.error(e.message); }
  }
  async function testSend() {
    try { const r = await api(`/delivery/templates/${active}/send`, { method: 'POST', body: JSON.stringify({ to: 'ops@demo.local', data: { party: 'ACME Ltd', number: 'INV-0001', total: '$ 1,000.00', due: '2026-09-30', company: 'Demo Supermarkets', signature: 'Finance' } }) }); message.success(`Test ${r.status} — ${r.id}`); } catch (e: any) { message.error(e.message); }
  }
  if (!codes.length) return (<><PageHeader title="Email Templates" /><Alert type="info" message="Loading templates…" /></>);

  return (
    <>
      <PageHeader title="Email Templates" subtitle="Configurable email templates for invoices, quotations, statements and payslips. Delivery uses the messaging adapter (safe mock by default)." />
      <Alert className="mb-4" type="info" showIcon message={'Available placeholders: ' + PLACEHOLDERS.join(', ')} />
      <Card className="nex-card">
        <Tabs activeKey={active} onChange={select} items={codes.map((c) => ({ key: c, label: c }))} />
        <div className="space-y-3 max-w-2xl">
          <div><div className="text-[12px] text-slate-500 mb-1">Subject</div><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div><div className="text-[12px] text-slate-500 mb-1">Body</div><Input.TextArea value={body} rows={8} onChange={(e) => setBody(e.target.value)} /></div>
          <Space><Button type="primary" icon={<SaveOutlined />} onClick={save}>Save</Button><Button icon={<SendOutlined />} onClick={testSend}>Send test</Button></Space>
        </div>
      </Card>
    </>
  );
}

