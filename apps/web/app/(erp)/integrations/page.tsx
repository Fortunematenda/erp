'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page';
import { Alert, Button, Col, Row, Skeleton, Space, Table, Tooltip, message } from 'antd';
import { ReloadOutlined, SafetyCertificateOutlined, SettingOutlined } from '@ant-design/icons';
import { IntegrationCard } from '@/components/integrations/integration-card';
import { IntegrationDrawer } from '@/components/integrations/integration-drawer';
import { AttentionPanel } from '@/components/integrations/attention-panel';
import { Diagnostics } from '@/components/integrations/diagnostics';
import { EnvTag, StateTag, ConfigTag } from '@/components/integrations/status-badges';
import { HelpTooltip } from '@/components/integrations/help-tooltip';
import { useAuthPermissions } from '@/components/Can';

function StatCard({ label, value, tone, tooltip }: { label: string; value: number; tone: 'blue' | 'green' | 'red' | 'orange'; tooltip: string }) {
  const colors = { blue: '#2563eb', green: '#15803d', red: '#b91c1c', orange: '#d97706' };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-2xl font-bold" style={{ color: colors[tone] }}>{value}</div>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-slate-700">{label}</div>
        <div className="text-[11px] text-slate-400"><HelpTooltip text={tooltip} width={240} /></div>
      </div>
    </div>
  );
}

function Dashboard() {
  const qc = useQueryClient();
  const { permissions } = useAuthPermissions();
  const canRunHealth = permissions.includes('integrations.health.run');
  const canDiagnostics = permissions.includes('integrations.diagnostics');
  const [selected, setSelected] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const q = useQuery({ queryKey: ['/integrations/status'], queryFn: () => api('/integrations/status'), refetchInterval: 60_000, staleTime: 15_000 });
  const attn = useQuery({ queryKey: ['/integrations/attention'], queryFn: () => api('/integrations/attention'), staleTime: 30_000 });

  const data = q.data;

  async function refreshHealth() {
    setRefreshing(true);
    try {
      await api('/integrations/health', { method: 'POST' });
      message.success('Health checks completed');
      qc.invalidateQueries({ queryKey: ['/integrations/status'] });
      qc.invalidateQueries({ queryKey: ['/integrations/attention'] });
    } catch (e: any) { message.error(e.message); }
    finally { setRefreshing(false); }
  }

  const sections = useMemo(() => {
    if (!data) return [];
    const by = (s: string) => data.integrations.filter((i: any) => i.section === s);
    return [
      { key: 'core', title: 'Core Integrations', items: by('core') },
      { key: 'compliance', title: 'Compliance & Finance', items: by('compliance') },
      { key: 'platform', title: 'Platform Services', items: by('platform') },
    ].filter((s) => s.items.length > 0);
  }, [data]);

  if (!data) return <Skeleton active paragraph={{ rows: 8 }} />;

  const ov = data.overall;
  const queue = data.queue;

  function attentionItemAction(it: any) {
    // Jump to the linked screen or open the drawer.
    if (it.link) { window.location.href = it.link; return; }
    const target = data.integrations.find((i: any) => i.type === it.integration);
    if (target) setSelected(target);
  }

  const tableColumns = [
    { title: 'Integration', dataIndex: 'label', render: (_: any, r: any) => <span className="font-medium text-slate-700">{r.label}</span> },
    { title: 'Provider', dataIndex: ['provider', 'label'] },
    { title: 'Environment', dataIndex: 'environment', render: (v: string) => <EnvTag env={v} /> },
    { title: 'Configuration', dataIndex: 'configStatus', render: (v: string) => <ConfigTag status={v} /> },
    { title: 'Connection', dataIndex: 'connection', render: (v: string) => <StateTag state={v} /> },
    {
      title: 'Last Check', dataIndex: 'lastCheckedAt', render: (v: string) => v ? new Date(v).toLocaleString() : 'Never',
    },
    {
      title: 'Used By', dataIndex: 'usedBy', ellipsis: true,
      render: (v: string[]) => (
        <Tooltip title={v.join(', ')}>
          <span className="cursor-help">{v.length} module{v.length === 1 ? '' : 's'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Actions', key: 'actions', width: 90,
      render: (_: any, r: any) => <Button size="small" type="primary" ghost onClick={() => setSelected(r)}>Manage</Button>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {data.safeMode ? (
          <Alert
            type="warning" showIcon icon={<SafetyCertificateOutlined />} className="flex-1"
            message="Safe adapter mode is active. Mock providers never contact live systems."
          />
        ) : (
          <Alert
            type="info" showIcon className="flex-1"
            message="Live provider adapters are configured. Mock providers remain isolated from live traffic."
          />
        )}
        <Space>
          <Tooltip title="Checks all integrations that safely support health checks. Never executes charges, messages or fiscal receipts.">
            <Button icon={<ReloadOutlined />} loading={refreshing} onClick={refreshHealth} disabled={!canRunHealth}>Refresh Health</Button>
          </Tooltip>
          <Button icon={<SettingOutlined />} onClick={() => { window.location.href = '/administration/integrations-config'; }}>Legacy Config</Button>
        </Space>
      </div>

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><StatCard label="Configured Integrations" value={ov.configured} tone="blue" tooltip="Integrations with a selected provider and complete required configuration." /></Col>
        <Col xs={12} md={6}><StatCard label="Healthy" value={ov.healthy} tone="green" tooltip="Providers whose latest health check succeeded (CONNECTED) or safe mock mode." /></Col>
        <Col xs={12} md={6}><StatCard label="Attention Required" value={ov.attention} tone="red" tooltip="Integrations with errors, degraded connections or open attention items." /></Col>
        <Col xs={12} md={6}><StatCard label="Mock / Test" value={ov.mockTest} tone="orange" tooltip="Integrations running in safe mock or test/sandbox environments." /></Col>
      </Row>

      {sections.map((s) => (
        <div key={s.key}>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[15px] font-semibold" style={{ color: '#003366' }}>{s.title}</h2>
            <span className="text-[11px] text-slate-400">{s.items.length}</span>
          </div>
          <Row gutter={[12, 12]}>
            {s.items.map((it: any) => (
              <Col xs={24} sm={12} xl={8} key={it.type}>
                <IntegrationCard it={it} onManage={setSelected} />
              </Col>
            ))}
          </Row>
        </div>
      ))}

      <div>
        <h2 className="mb-2 text-[15px] font-semibold" style={{ color: '#003366' }}>
          Needs Attention
          <HelpTooltip text="Items requiring administrator action, derived from live adapter status. Click any item to act on it." />
        </h2>
        <AttentionPanel items={attn.data || []} onItem={attentionItemAction} />
      </div>

      {canDiagnostics && <Diagnostics />}

      <div>
        <h2 className="mb-2 text-[15px] font-semibold" style={{ color: '#003366' }}>Integration Status</h2>
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table rowKey="type" size="small" columns={tableColumns} dataSource={data.integrations} pagination={false} scroll={{ x: 900 }} />
        </div>
      </div>

      <IntegrationDrawer it={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export default function Page() {
  return (
    <>
      <PageHeader title="Integrations" subtitle="Connected services and APIs — payments, storage, messaging, queue, fiscalisation, banking, webhooks, usage and billing." />
      <Dashboard />
    </>
  );
}
