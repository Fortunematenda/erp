'use client';
import { Button, Space, Tooltip } from 'antd';
import { CreditCardOutlined, DatabaseOutlined, MailOutlined, MobileOutlined, SyncOutlined, CloudServerOutlined, BankOutlined, ApiOutlined, BarChartOutlined, DollarOutlined } from '@ant-design/icons';
import { EnvTag, StateTag, ConfigTag } from './status-badges';
import { HelpTooltip } from './help-tooltip';

export const TYPE_ICONS: Record<string, any> = {
  PAYMENT: <CreditCardOutlined />,
  STORAGE: <DatabaseOutlined />,
  EMAIL: <MailOutlined />,
  SMS: <MobileOutlined />,
  QUEUE: <SyncOutlined />,
  ZIMRA: <CloudServerOutlined />,
  BANK: <BankOutlined />,
  USAGE: <BarChartOutlined />,
  BILLING: <DollarOutlined />,
  WEBHOOK: <ApiOutlined />,
};

function lastCheckedLabel(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return new Date(iso).toLocaleString();
}

// Compact integration card (140-170px content, 3 per row on desktop).
export function IntegrationCard({ it, onManage }: { it: any; onManage: (it: any) => void }) {
  const metric = it.metrics || {};
  // ZIMRA Manage redirects to Fiscalisation configuration; BANK to Bank Connections.
  const isZimra = it.type === 'ZIMRA';
  const isBank = it.type === 'BANK';
  const primaryAction = isZimra ? 'Open Fiscalisation' : isBank ? 'Bank Connections' : 'Manage';
  const primaryLink = isZimra ? '/fiscalisation' : isBank ? '/finance/bank-connections' : null;

  function act() {
    if (primaryLink) { window.location.href = primaryLink; return; }
    onManage(it);
  }
  const metricLine = (() => {
    if (it.type === 'PAYMENT') return `Payments today ${metric.eventsToday ?? '—'}`;
    if (it.type === 'EMAIL') return `Sent today ${metric.sentToday ?? '—'}`;
    if (it.type === 'SMS') return `Sent today ${metric.sentToday ?? '—'}`;
    if (it.type === 'QUEUE') return `${metric.waiting ?? 0} waiting · ${metric.failedJobs ?? 0} failed`;
    if (it.type === 'ZIMRA') {
      const d = metric.device;
      if (!d) return 'No device registered';
      return `Day #${d.dayNo} ${d.dayStatus === 'OPEN' ? 'OPEN' : 'CLOSED'}`;
    }
    if (it.type === 'BANK') return `${metric.connected ?? 0} connected`;
    if (it.type === 'WEBHOOK') return `${metric.events ?? 0} events`;
    if (it.type === 'USAGE') return `Events today ${metric.eventsToday ?? '—'}`;
    if (it.type === 'BILLING') return `${metric.plan || 'No plan'}`;
    return null;
  })();

  return (
    <div className="nex-card flex h-full flex-col rounded-lg border border-slate-200 bg-white p-3.5 transition-shadow hover:shadow-md" style={{ minHeight: 148 }}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">{TYPE_ICONS[it.type] || <ApiOutlined />} {it.label}</span>
        <EnvTag env={it.environment} />
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <StateTag state={it.connection} />
        {it.configStatus !== it.connection && it.configStatus !== 'MOCK' && <ConfigTag status={it.configStatus} />}
      </div>

      <div className="mt-1 text-[12px] text-slate-500">{it.provider?.label}</div>
      {metricLine && <div className="mt-1 text-[12px] font-medium" style={{ color: '#334155' }}>{metricLine}</div>}
      {it.type === 'ZIMRA' && metric.device && (
        <div className="mt-0.5 text-[11px] text-slate-400">
          Cert: {metric.device.certificateStatus || 'UNKNOWN'}
          {it.lastError ? ' · ' + String(it.lastError).slice(0, 28) : ''}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between pt-2.5">
        <Tooltip title="The last time NexusERP verified the connection to this provider.">
          <span className="cursor-help text-[11px] text-slate-400">Last checked {lastCheckedLabel(it.lastCheckedAt)}</span>
        </Tooltip>
        <Space size={4}>
          {(isZimra || isBank) && (
            <Button size="small" onClick={() => onManage(it)}>Manage</Button>
          )}
          <Button size="small" type="primary" ghost onClick={act}>{primaryAction}</Button>
        </Space>
      </div>

      <div className="mt-1 flex items-center text-[11px] text-slate-400">
        Used by {it.usedBy.length} module{it.usedBy.length === 1 ? '' : 's'}
        <HelpTooltip text={`Shows NexusERP modules that depend on this integration: ${it.usedBy.join(', ')}. Disabling an integration may affect these workflows.`} />
      </div>
    </div>
  );
}
