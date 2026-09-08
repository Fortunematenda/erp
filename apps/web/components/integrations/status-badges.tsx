'use client';
import { Tag, Tooltip } from 'antd';

// Provider state: MOCK | NOT_CONFIGURED | CONFIGURED | CONNECTED | DEGRADED | ERROR | DISABLED
const STATE_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  MOCK: { color: '#d97706', bg: '#fffbeb', label: 'Mock' },
  NOT_CONFIGURED: { color: '#64748b', bg: '#f1f5f9', label: 'Not Configured' },
  CONFIGURED: { color: '#1d4ed8', bg: '#eff6ff', label: 'Configured' },
  CONNECTED: { color: '#15803d', bg: '#f0fdf4', label: 'Connected' },
  DEGRADED: { color: '#c2410c', bg: '#fff7ed', label: 'Degraded' },
  ERROR: { color: '#b91c1c', bg: '#fef2f2', label: 'Error' },
  DISABLED: { color: '#475569', bg: '#e2e8f0', label: 'Disabled' },
};

export function StateTag({ state, withDot = true }: { state: string; withDot?: boolean }) {
  const s = STATE_COLORS[state?.toUpperCase()] || STATE_COLORS.NOT_CONFIGURED;
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: s.color, background: s.bg }}>
      {withDot && <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />}
      {s.label}
    </span>
  );
}

export function ConfigTag({ status }: { status: string }) {
  if (status === 'MOCK') return <Tag style={{ fontSize: 11, lineHeight: '18px' }} color="orange">Mock</Tag>;
  if (status === 'COMPLETE') return <Tag style={{ fontSize: 11, lineHeight: '18px' }} color="blue">Complete</Tag>;
  return <Tag style={{ fontSize: 11, lineHeight: '18px' }} color="default">Incomplete</Tag>;
}

// Environment: MOCK | TEST | LIVE — never mixed into the connection badge.
export function EnvTag({ env }: { env: string }) {
  const e = (env || 'MOCK').toUpperCase();
  const map: Record<string, { color: string; label: string }> = {
    MOCK: { color: 'orange', label: 'Mock' },
    TEST: { color: 'purple', label: 'Test' },
    SANDBOX: { color: 'purple', label: 'Sandbox' },
    LIVE: { color: 'red', label: 'Live' },
  };
  const m = map[e] || map.MOCK;
  return (
    <Tooltip title={e === 'MOCK' ? 'Mock never contacts an external provider.' : e === 'TEST' || e === 'SANDBOX' ? 'Test/Sandbox contacts the provider testing environment.' : 'Live sends real production requests.'}>
      <Tag style={{ fontSize: 11, lineHeight: '18px' }} color={m.color}>{m.label}</Tag>
    </Tooltip>
  );
}

export { STATE_COLORS };
