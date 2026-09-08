'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page';
import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Tabs, Tag, message } from 'antd';
import { SaveOutlined, ExperimentOutlined } from '@ant-design/icons';

const MASK = '••••••••';

function GroupForm({ group, values }: { group: any; values: any }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const vals = values || {};

  const FieldEl = ({ f }: { f: any }) => {
    const isSecret = f.secret;
    const current = isSecret ? vals[f.key] : vals[f.key];
    if (f.type === 'select') return <Select options={(f.options || []).map((o: string) => ({ label: o, value: o }))} placeholder={f.hint} />;
    if (f.type === 'textarea') return <Input.TextArea rows={3} placeholder={isSecret ? MASK : f.hint} />;
    if (f.type === 'number') return <InputNumber className="w-full" placeholder={f.hint} />;
    return <Input.Password visibilityToggle={isSecret} placeholder={isSecret ? MASK : f.hint} />;
  };

  async function save(v: any) {
    // Convert secret fields left as the mask placeholder to blank so they are kept unchanged.
    const cleaned: any = {};
    for (const k of Object.keys(v)) {
      const f = group.fields.find((x: any) => x.key === k);
      if (f && f.secret && v[k] === MASK) cleaned[k] = '';
      else cleaned[k] = v[k];
    }
    try { await api(`/settings/groups/${group.id}`, { method: 'PUT', body: JSON.stringify(cleaned) }); message.success('Saved'); qc.invalidateQueries({ queryKey: ['/settings'] }); } catch (e: any) { message.error(e.message); }
  }
  async function test() {
    setTesting(true);
    try { const r = await api(`/settings/groups/${group.id}/test`, { method: 'POST' }); (r.warnings?.length ? message.warning : message.success)(r.message); r.warnings?.forEach((w: string) => message.warning(w)); } catch (e: any) { message.error(e.message); } finally { setTesting(false); }
  }

  return (
    <Card title={group.label} className="nex-card">
      <p className="text-[13px] text-slate-500 mb-4">{group.description}</p>
      <Form form={form} layout="vertical" className="max-w-2xl" onFinish={save}
        initialValues={Object.fromEntries(group.fields.map((f: any) => {
          const v = vals[f.key];
          const init = f.secret ? (v?.set ? MASK : '') : v ?? null;
          return [f.key, init];
        }))}>
        {group.fields.map((f: any) => (
          <Form.Item key={f.key} name={f.key} label={f.label} extra={f.hint} className={f.type === 'textarea' || (f.secret && f.type === 'textarea') ? '' : '!mb-3'}>
            <FieldEl f={f} />
          </Form.Item>
        ))}
        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>Save</Button>
          <Button icon={<ExperimentOutlined />} loading={testing} onClick={test}>Test</Button>
        </Space>
      </Form>
    </Card>
  );
}

export default function ConfigPage() {
  const q = useQuery({ queryKey: ['/settings'], queryFn: () => api('/settings') });
  const [active, setActive] = useState<string>('');
  const groups = q.data?.schema || [];
  const values = q.data?.values || {};
  useEffect(() => { if (!active && groups.length) setActive(groups[0].id); }, [active, groups]);
  if (!groups.length) return (<><PageHeader title="Integrations Configuration" /><Alert type="info" message="Loading configuration…" /></>);

  return (
    <>
      <PageHeader title="Integrations Configuration" subtitle="Configure provider modes and credentials for ZIMRA, payments, email/SMS, object storage, background queue and security. Secrets are encrypted at rest and never returned (masked)." />
      <Alert className="mb-4" type="info" showIcon message="Mock providers are safe; when a real provider (test/production/smtp/s3/paynow/bull) is selected, the system requires the matching credentials before it will transmit — it never fakes success." />
      <Card className="nex-card">
        <Tabs activeKey={active} onChange={setActive} items={groups.map((g: any) => ({ key: g.id, label: <Space>{g.label}<Tag>{g.id === 'zimra' && (values.zimra?.values?.mode || 'mock')}{g.id === 'payment' && (values.payment?.values?.provider || 'mock')}{g.id === 'messaging' && (values.messaging?.values?.provider || 'mock')}{g.id === 'storage' && (values.storage?.values?.provider || 'local')}{g.id === 'queue' && (values.queue?.values?.provider || 'inprocess')}</Tag></Space>, children: <GroupForm group={g} values={values[g.id]?.values || {}} /> }))} />
      </Card>
    </>
  );
}

