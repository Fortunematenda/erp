'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Alert, Button, Drawer, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tabs, Tag, Tooltip, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, CloudSyncOutlined, ExperimentOutlined, LinkOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { HelpTooltip } from './help-tooltip';
import { EnvTag, StateTag, ConfigTag } from './status-badges';
import { useAuthPermissions } from '../Can';

const MASK = '••••••••';

function ConfigForm({ type, onDirty }: { type: string; onDirty: (d: boolean) => void }) {
  const qc = useQueryClient();
  const { permissions } = useAuthPermissions();
  const canConfigure = permissions.includes('integrations.configure');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [enableLiveModal, setEnableLiveModal] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>('');

  const q = useQuery({
    queryKey: ['/integrations/config', type],
    queryFn: () => api(`/integrations/config/${type}`),
    staleTime: 30_000,
  });
  const schema = q.data;
  const selected = useMemo(() => schema?.providers?.find((p: any) => p.code === (provider || schema?.selectedProvider)), [schema, provider]);
  const isMock = (provider || schema?.selectedProvider) === 'mock';

  useEffect(() => {
    if (!schema) return;
    const vals: any = {};
    const sel = schema.providers.find((p: any) => p.code === schema.selectedProvider);
    for (const f of sel?.configFields || []) {
      const v = schema.values?.[f.key];
      vals[f.key] = f.secret ? (v?.set ? MASK : '') : v ?? undefined;
    }
    form.setFieldsValue(vals);
    setProvider(schema.selectedProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  if (!schema) return <Spin />;

  const selDef = selected || schema.providers[0];

  async function save(withTest = false) {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const body: any = {};
      for (const k of Object.keys(v)) {
        const f = selDef.configFields.find((x: any) => x.key === k);
        if (f?.secret && v[k] === MASK) continue; // keep existing secret
        body[k] = v[k];
      }
      body[schema.providerField] = provider || schema.selectedProvider;
      const res = await api(`/integrations/config/${type}`, { method: 'POST', body: JSON.stringify(body) });
      message.success('Configuration saved');
      onDirty(false);
      qc.invalidateQueries({ queryKey: ['/integrations/status'] });
      qc.invalidateQueries({ queryKey: ['/integrations/config', type] });
      if (withTest) {
        setTesting(true);
        try {
          const tr = await api(`/integrations/config/${type}/test`, { method: 'POST' });
          setTestResult(tr);
          qc.invalidateQueries({ queryKey: ['/integrations/status'] });
        } catch (e: any) { message.error(e.message); } finally { setTesting(false); }
      }
    } catch (e: any) {
      if (e?.errorFields) return; // form validation
      message.error(e.message);
    } finally { setSaving(false); }
  }

  async function testConnection() {
    setTesting(true); setTestResult(null);
    try {
      const r = await api(`/integrations/config/${type}/test`, { method: 'POST' });
      setTestResult(r);
      qc.invalidateQueries({ queryKey: ['/integrations/status'] });
      if (r.status === 'CONNECTED' || r.status === 'MOCK') message.success('Connection test passed');
      else message.warning(r.message || 'Connection test failed');
    } catch (e: any) { message.error(e.message); setTestResult({ status: 'ERROR', message: e.message }); }
    finally { setTesting(false); }
  }

  function changeProvider(code: string) {
    // Mock ↔ Live transitions need explicit confirmation.
    const prevMock = (provider || schema.selectedProvider) === 'mock';
    const nextMock = code === 'mock';
    if (prevMock && !nextMock) { setEnableLiveModal(true); setPendingProvider(code); return; }
    setProvider(code);
    const fields = schema.providers.find((p: any) => p.code === code)?.configFields || [];
    const vals: any = {};
    for (const f of fields) {
      const v = schema.values?.[f.key];
      vals[f.key] = f.secret ? (v?.set ? MASK : '') : v ?? undefined;
    }
    form.setFieldsValue(vals);
    onDirty(true);
  }

  const connOk = testResult?.status === 'CONNECTED' || testResult?.status === 'MOCK';

  return (
    <div>
      <Form form={form} layout="vertical" className="max-w-2xl" disabled={!canConfigure} onValuesChange={() => onDirty(true)}>
        <div className="mb-4 flex items-center gap-2 text-[12px] text-slate-400">
          Scope: <Tag>{schema.scope === 'platform' ? 'Platform' : 'Company'}</Tag>
        </div>
        <Form.Item
          label={<span>Provider <HelpTooltip text="Select the external service NexusERP should use for this integration. Changing providers does not migrate historical transactions." /></span>}
        >
          <Select
            value={provider || schema.selectedProvider}
            onChange={changeProvider}
            options={schema.providers.map((p: any) => ({ value: p.code, label: `${p.label} (${p.environment})` }))}
          />
        </Form.Item>
        <Form.Item
          label={<span>Environment <HelpTooltip text="Mock never contacts an external provider. Test/Sandbox contacts the provider's testing environment. Live sends real production requests." /></span>}
        >
          <EnvTag env={selDef.environment} />
          <span className="ml-2 text-[12px] text-slate-500">{selDef.environment}</span>
        </Form.Item>
        {selDef.configFields.map((f: any) => (
          <Form.Item
            key={f.key}
            name={f.key}
            label={<span>{f.label} {f.required && <span className="text-red-500">*</span>} {f.tooltip && <HelpTooltip text={f.tooltip} />}</span>}
            rules={f.required && !isMock ? [{ required: true, message: `${f.label} is required` }] : []}
          >
            {f.type === 'select' ? (
              <Select options={(f.options || []).map((o: string) => ({ value: o, label: o }))} placeholder={f.envVar ? `Defaults to env ${f.envVar}` : undefined} />
            ) : f.type === 'number' ? (
              <InputNumber className="w-full" placeholder={f.envVar ? `Defaults to env ${f.envVar}` : undefined} />
            ) : f.type === 'textarea' ? (
              <Input.TextArea rows={3} placeholder={f.secret ? MASK : undefined} />
            ) : f.secret ? (
              <Input.Password visibilityToggle={false} placeholder={MASK} autoComplete="new-password" />
            ) : (
              <Input placeholder={f.envVar ? `Defaults to env ${f.envVar}` : undefined} />
            )}
          </Form.Item>
        ))}
        {selDef.docsUrl && (
          <div className="mb-4">
            <a href={selDef.docsUrl} target="_blank" rel="noreferrer">Provider Documentation <LinkOutlined /></a>
          </div>
        )}
        {isMock && (
          <Alert className="mb-4" type="info" showIcon message="Mock provider active — safe simulation enabled. No external requests are sent." />
        )}
        <Space>
          <Button icon={<SaveOutlined />} loading={saving} onClick={() => save(false)} disabled={!canConfigure}>Save</Button>
          <Button type="primary" icon={<ThunderboltOutlined />} loading={saving || testing} onClick={() => save(true)} disabled={!canConfigure}>Save &amp; Test</Button>
          {!isMock && (
            <Button icon={<ExperimentOutlined />} loading={testing} onClick={testConnection} disabled={!canConfigure}>Test Connection</Button>
          )}
        </Space>
      </Form>

      {testResult && (
        <div className={`mt-5 rounded-lg border p-3.5 text-[13px] ${connOk ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-center gap-2 font-semibold" style={{ color: connOk ? '#15803d' : '#b91c1c' }}>
            {connOk ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            {connOk ? 'Connection successful' : 'Connection failed'}
          </div>
          {testResult.message && <div className="mt-1 text-slate-600">{testResult.message}</div>}
          {testResult.latencyMs != null && <div className="mt-1 text-[12px] text-slate-500">Latency: {testResult.latencyMs} ms</div>}
          {testResult.checkedAt && <div className="text-[12px] text-slate-500">Checked {new Date(testResult.checkedAt).toLocaleString()}</div>}
        </div>
      )}

      <Modal
        open={enableLiveModal}
        title="Enable Live Integration?"
        onOk={() => { setProvider(pendingProvider!); setEnableLiveModal(false); onDirty(true); }}
        onCancel={() => setEnableLiveModal(false)}
        okText="Enable Live"
        okButtonProps={{ danger: true }}
      >
        <p>Live mode sends real requests to the external provider.</p>
        <p className="mb-1 font-medium">Provider: {schema.providers.find((p: any) => p.code === pendingProvider)?.label}</p>
        <p className="text-[12px] text-slate-500">A health test must pass before live traffic is allowed. Mock providers never contact live systems.</p>
      </Modal>
    </div>
  );
}

function HealthTab({ type }: { type: string }) {
  const qc = useQueryClient();
  const { permissions } = useAuthPermissions();
  const canRun = permissions.includes('integrations.health.run');
  const q = useQuery({ queryKey: ['/integrations/health/history', type], queryFn: () => api(`/integrations/health/history?type=${type}&take=25`), staleTime: 20_000 });
  const [running, setRunning] = useState(false);
  async function run() {
    setRunning(true);
    try { await api(`/integrations/health/${type}`, { method: 'POST' }); qc.invalidateQueries({ queryKey: ['/integrations/health/history', type] }); qc.invalidateQueries({ queryKey: ['/integrations/status'] }); message.success('Health check completed'); }
    catch (e: any) { message.error(e.message); } finally { setRunning(false); }
  }
  const rows = q.data || [];
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Button icon={<CloudSyncOutlined />} loading={running} onClick={run} disabled={!canRun}>Run Health Check</Button>
        <span className="text-[12px] text-slate-400">Never executes charges, messages or fiscal receipts.</span>
      </div>
      <Table
        rowKey="id" size="small" dataSource={rows} pagination={false}
        columns={[
          { title: 'Time', dataIndex: 'checkedAt', render: (v: string) => new Date(v).toLocaleString() },
          { title: 'Status', dataIndex: 'status', render: (s: string) => <StateTag state={s} /> },
          { title: 'Provider', dataIndex: 'provider' },
          { title: 'Latency', dataIndex: 'latencyMs', render: (v: number) => v != null ? `${v} ms` : '—', align: 'right' },
          { title: 'Message', dataIndex: 'message', ellipsis: true },
        ]}
      />
    </div>
  );
}

function ActivityTab({ type }: { type: string }) {
  const q = useQuery({ queryKey: ['/integrations/activity', type], queryFn: () => api(`/integrations/activity?type=${type}&take=50`), staleTime: 20_000 });
  const rows = q.data || [];
  return (
    <Table
      rowKey="id" size="small" dataSource={rows} pagination={false}
      columns={[
        { title: 'Time', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
        { title: 'Action', dataIndex: 'action' },
        { title: 'Source', dataIndex: 'source' },
        { title: 'Status', dataIndex: 'status', render: (s: string) => s ? <Tag>{s}</Tag> : '—' },
        { title: 'Duration', dataIndex: 'durationMs', render: (v: number) => v != null ? `${v} ms` : '—', align: 'right' },
        { title: 'Correlation ID', dataIndex: 'correlationId', ellipsis: true, render: (v: string) => v ? <code className="text-[11px]">{v}</code> : '—' },
      ]}
    />
  );
}

function LogsTab({ type }: { type: string }) {
  const { permissions } = useAuthPermissions();
  const canLogs = permissions.includes('integrations.logs.view');
  const q = useQuery({ queryKey: ['/integrations/logs', type], queryFn: () => api(`/integrations/logs?type=${type}&take=50`), enabled: canLogs, staleTime: 20_000 });
  if (!canLogs) return <Alert type="warning" showIcon message="Technical logs require the integrations.logs.view permission." />;
  const rows = q.data || [];
  return (
    <div>
      <Alert className="mb-3" type="info" showIcon message="Sanitized technical logs — secrets are stripped before storage." />
      <Table
        rowKey="id" size="small" dataSource={rows} pagination={false}
        columns={[
          { title: 'At', dataIndex: 'at', render: (v: string) => new Date(v).toLocaleString() },
          { title: 'Kind', dataIndex: 'kind' },
          { title: 'Type', dataIndex: 'integrationType' },
          { title: 'Status', dataIndex: 'status', render: (s: string) => <StateTag state={s} /> },
          { title: 'Latency', dataIndex: 'latencyMs', render: (v: number) => v != null ? `${v} ms` : '—', align: 'right' },
          { title: 'Message', dataIndex: 'message', ellipsis: true },
        ]}
      />
    </div>
  );
}

function WebhooksTab({ type }: { type: string }) {
  const q = useQuery({ queryKey: ['/integrations/webhooks/events'], queryFn: () => api('/integrations/webhooks/events?take=50'), staleTime: 20_000 });
  const rows = q.data || [];
  return (
    <Table
      rowKey="id" size="small" dataSource={rows} pagination={false}
      columns={[
        { title: 'Event ID', dataIndex: 'eventId', ellipsis: true },
        { title: 'Provider', dataIndex: 'provider' },
        { title: 'Event Type', dataIndex: 'eventType', render: (v: string) => v || '—' },
        { title: 'Received', dataIndex: 'receivedAt', render: (v: string) => new Date(v).toLocaleString() },
        { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'PROCESSED' ? 'green' : s === 'FAILED' ? 'red' : 'default'}>{s}</Tag> },
        { title: 'Attempts', dataIndex: 'attempts', align: 'right' },
      ]}
    />
  );
}

// Large drawer (≈ 800px) with per-integration tabs.
export function IntegrationDrawer({ it, open, onClose }: { it: any; open: boolean; onClose: () => void }) {
  const [dirty, setDirty] = useState(false);
  const [confirmDirty, setConfirmDirty] = useState(false);
  const type = it?.type;

  useEffect(() => { if (open) setDirty(false); }, [open]);

  function close() {
    if (dirty) { setConfirmDirty(true); return; }
    onClose();
  }

  const overview = it && (
    <div className="space-y-4">
      <Alert type={it.connection === 'ERROR' ? 'error' : it.connection === 'DEGRADED' ? 'warning' : 'info'} showIcon message={it.lastError || it.description} />
      <div className="flex flex-wrap items-center gap-2">
        <EnvTag env={it.environment} />
        <StateTag state={it.connection} />
        <ConfigTag status={it.configStatus} />
        <span className="text-[12px] text-slate-400">Provider: {it.provider?.label}</span>
        {it.provider?.docsUrl && <a href={it.provider.docsUrl} target="_blank" rel="noreferrer" className="text-[12px]">Provider Documentation <LinkOutlined /></a>}
      </div>
      <div>
        <div className="mb-1.5 flex items-center text-[13px] font-semibold text-slate-600">
          Used by <HelpTooltip text="Shows NexusERP modules that depend on this integration. Disabling an integration may affect these workflows." />
        </div>
        <div className="space-y-1">
          {it.usedBy.map((m: string) => (
            <div key={m} className="flex items-center gap-2 text-[13px] text-slate-700"><span className="text-slate-400">↓</span>{m}</div>
          ))}
        </div>
      </div>
      {Object.keys(it.metrics || {}).length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(it.metrics).map(([k, v]: any) => (
            <div key={k} className="rounded border border-slate-200 p-2.5">
              <div className="text-[11px] uppercase text-slate-400">{k.replace(/([A-Z])/g, ' $1')}</div>
              <div className="text-[16px] font-semibold" style={{ color: '#003366' }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="text-[12px] text-slate-400">Last checked: {it.lastCheckedAt ? new Date(it.lastCheckedAt).toLocaleString() : 'Never'} · Latency {it.latencyMs ?? '—'} ms</div>
    </div>
  );

  const tabs = [
    { key: 'overview', label: 'Overview', children: overview },
    // ZIMRA / BANK configuration lives in their own modules (Fiscalisation,
    // Cash & Bank) — do not duplicate device/tax/account settings here.
    ...(it && (it.type === 'ZIMRA' || it.type === 'BANK')
      ? [{ key: 'config', label: 'Configuration', children: (
          <Alert type="info" showIcon message={it.type === 'ZIMRA'
            ? 'Fiscalisation device, tax and certificate configuration is managed in the Fiscalisation module.'
            : 'Bank account and sync configuration is managed in Cash & Bank → Bank Connections.'} />
        ) }]
      : [{ key: 'config', label: 'Configuration', children: <ConfigForm type={type} onDirty={setDirty} /> }]
    ),
    { key: 'health', label: 'Health', children: <HealthTab type={type} /> },
    { key: 'activity', label: 'Activity', children: <ActivityTab type={type} /> },
    { key: 'logs', label: 'Logs', children: <LogsTab type={type} /> },
  ];
  if (it && (it.type === 'PAYMENT' || it.type === 'WEBHOOK')) tabs.push({ key: 'webhooks', label: 'Webhooks', children: <WebhooksTab type={type} /> });

  return (
    <>
      <Drawer
        title={it ? `${it.label} — ${it.provider?.label || ''}` : ''}
        open={open}
        onClose={close}
        width={800}
        destroyOnHidden
      >
        {it && <Tabs items={tabs} defaultActiveKey="overview" />}
      </Drawer>
      <Modal
        open={confirmDirty}
        title="You have unsaved integration changes."
        okText="Discard changes"
        okButtonProps={{ danger: true }}
        onOk={() => { setConfirmDirty(false); setDirty(false); onClose(); }}
        onCancel={() => setConfirmDirty(false)}
      >
        <p>Closing now will discard changes made to the configuration.</p>
      </Modal>
    </>
  );
}
