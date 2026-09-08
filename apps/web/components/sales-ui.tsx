'use client';
import React from 'react';
import { Avatar, Empty } from 'antd';
import { SoftBadge, statusTone } from '@/components/crud-page';
import { fmtMoney } from '@/lib/format';

export function StatusPill({ status, tone }: { status?: string; tone?: string }) {
  const s = String(status || 'Draft');
  return <SoftBadge tone={tone || statusTone(s)}>{s.replace(/_/g, ' ')}</SoftBadge>;
}

export function SummaryCard({ icon, label, value, tone = '#003366', hint, valueColor }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string; hint?: string; valueColor?: string }) {
  return (
    <div className="nex-card nex-card-hover p-5">
      <div className="flex items-center gap-3.5">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-lg shrink-0" style={{ background: tone, boxShadow: `0 6px 14px ${tone}40` }}>{icon}</div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[#344054] truncate">{label}</div>
          <div className="text-[19px] font-semibold leading-[1.2] tracking-[-0.01em] truncate" style={{ color: valueColor || '#475467' }}>{value}</div>
          {hint && <div className="text-[12px] text-[#98A2B3] mt-0.5 truncate">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

export function CustomerAvatar({ name, size = 36 }: { name?: string; size?: number }) {
  return <Avatar size={size} style={{ background: 'linear-gradient(135deg,#003366,#1d5fb5)', fontWeight: 600 }}>{String(name || '?').charAt(0).toUpperCase()}</Avatar>;
}

// Options for customer selection: deactivated customers are shown but disabled
// (with an "Inactive" label) so they cannot be used anywhere in the system.
export function customerOptions(customers: any[] | undefined) {
  return (customers || []).map((c: any) => ({
    label: c.status && c.status !== 'ACTIVE' ? `${c.name} (Inactive)` : c.name,
    value: c.id,
    disabled: c.status === 'INACTIVE',
  }));
}

export function CurrencyValue({ value, className = '' }: { value: any; className?: string }) {
  const n = Number(value || 0);
  return <span className={`font-bold ${n < 0 ? 'text-[#dc2626]' : 'text-[#171a2e]'} ${className}`}>{fmtMoney(value)}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-14">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null} />
      <div className="text-[15px] font-semibold text-[#171a2e] mt-2">{title}</div>
      {description && <div className="text-[13px] text-[#64748b] mt-1 max-w-sm mx-auto">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function FormSection({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="h-px flex-1 bg-[#eef0f6]" />
      <span className="text-[13px] font-semibold text-[#475060] tracking-wide">{title}</span>
      <div className="h-px flex-1 bg-[#eef0f6]" />
    </div>
  );
}

export function DetailItem({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex border-b border-[#f0f1f6] last:border-b-0">
      <div className="w-2/5 shrink-0 py-2.5 px-3 bg-[#f7f8fc] text-[12px] text-[#64748b]">{label}</div>
      <div className="flex-1 py-2.5 px-3 text-[13px] text-[#171a2e]">{value ?? '—'}</div>
    </div>
  );
}

export function DetailGrid({ items, cols = 1 }: { items: [string, React.ReactNode][]; cols?: number }) {
  return (
    <div className={`grid grid-cols-1 ${cols === 2 ? 'md:grid-cols-2' : ''} gap-x-4`}>
      {items.map(([label, value]) => (
        <div key={label} className="flex border-b border-[#f0f1f6]">
          <div className="w-2/5 shrink-0 py-2.5 px-3 bg-[#f7f8fc] text-[12px] text-[#64748b]">{label}</div>
          <div className="flex-1 py-2.5 px-3 text-[13px] text-[#171a2e]">{value ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}

export function FilterBar({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
      {children}
      <div className="ml-auto">{extra}</div>
    </div>
  );
}

