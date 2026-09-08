'use client';
import { Avatar, Tag, Tooltip } from 'antd';
import { HelpTooltip } from '@/components/integrations/help-tooltip';

// Soft status pills for user lifecycle statuses.
export const USER_STATUS: Record<string, { color: string; bg: string; label: string }> = {
  ACTIVE: { color: '#15803d', bg: '#f0fdf4', label: 'Active' },
  INVITED: { color: '#1d4ed8', bg: '#eff6ff', label: 'Invited' },
  INACTIVE: { color: '#b91c1c', bg: '#fef2f2', label: 'Inactive' },
  SUSPENDED: { color: '#c2410c', bg: '#fff7ed', label: 'Suspended' },
  LOCKED: { color: '#64748b', bg: '#f1f5f9', label: 'Locked' },
};

export function UserStatusBadge({ status }: { status?: string }) {
  const s = USER_STATUS[String(status || '').toUpperCase()] || { color: '#64748b', bg: '#f1f5f9', label: String(status || '—') };
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ color: s.color, background: s.bg }}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

export function MembershipStatusBadge({ status }: { status?: string }) {
  const ok = String(status || '').toUpperCase() === 'ACTIVE';
  return ok
    ? <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: '#15803d', background: '#f0fdf4' }}><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#15803d' }} />Active</span>
    : <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: '#64748b', background: '#f1f5f9' }}>Inactive</span>;
}

// Subtle role badge — roles are not brightly colored.
const ROLE_HUES: Record<string, string> = {
  ADMIN: '#7c3aed',
  SUPER_ADMIN: '#7c3aed',
  MANAGER: '#0e7490',
  ACCOUNTANT: '#1d4ed8',
  HR: '#be185d',
  SALES: '#15803d',
  PURCHASER: '#b45309',
  VIEWER: '#475569',
};
export function RoleBadge({ role }: { role?: string | null }) {
  if (!role) return <span className="text-slate-400">—</span>;
  const up = String(role).toUpperCase();
  let color = '#475569';
  for (const [k, v] of Object.entries(ROLE_HUES)) if (up.includes(k)) { color = v; break; }
  return (
    <Tag style={{ fontSize: 11, lineHeight: '18px', color, background: `${color}12`, borderColor: `${color}30`, borderRadius: 6, fontWeight: 600 }}>
      {role}
    </Tag>
  );
}

export function ScopeTag({ scope }: { scope?: string | null }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    PLATFORM_WIDE: { label: 'Platform Wide', color: '#7c3aed', bg: '#f5f3ff' },
    COMPANY_WIDE: { label: 'Company Wide', color: '#0e7490', bg: '#ecfeff' },
    SELECTED_BRANCHES: { label: 'Selected Branches', color: '#1d4ed8', bg: '#eff6ff' },
    SINGLE_BRANCH: { label: 'Single Branch', color: '#b45309', bg: '#fffbeb' },
  };
  const s = map[String(scope || '')] || { label: scope || '—', color: '#64748b', bg: '#f1f5f9' };
  return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ color: s.color, background: s.bg }}>{s.label}</span>;
}

export function UserAvatar({ name, size = 28 }: { name?: string; size?: number }) {
  const initials = (name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return <Avatar size={size} style={{ background: '#1e3a8a', fontSize: size * 0.4, fontWeight: 600 }}>{initials || '?'}</Avatar>;
}

export function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <span className="text-[11px] uppercase tracking-wide text-slate-400 flex items-center">{label}{help && <HelpTooltip text={help} />}</span>
      <div className="text-[13px] text-slate-800">{children}</div>
    </div>
  );
}

export { HelpTooltip };
