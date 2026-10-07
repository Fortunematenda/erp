'use client';
import Link from 'next/link';

export type AttentionItem = { key: string; label: string; count?: number; severity?: 'critical' | 'warning' | 'info'; href: string };

const TONE: Record<string, string> = { critical: '#dc2626', warning: '#f59e0b', info: '#0ea5e9' };

/** Reusable "Needs Attention" widget — exceptions with a count and a drilldown. */
export function NeedsAttention({ title = 'Needs Attention', items, emptyText = 'Nothing needs your attention.' }: { title?: string; items: AttentionItem[]; emptyText?: string }) {
  return (
    <div className="nex-card p-4">
      <div className="text-[13px] font-semibold text-[#171a2e] mb-3">{title}</div>
      {items.length ? (
        <div className="divide-y divide-[#f0f1f6]">
          {items.map((it) => (
            <Link key={it.key} href={it.href} className="flex items-center justify-between gap-3 py-2.5 group">
              <span className="flex items-center gap-2 text-[13px] text-[#344054] min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TONE[it.severity || 'info'] }} />
                <span className="truncate">{it.label}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {it.count != null && <span className="text-[13px] font-semibold text-[#171a2e] tabular-nums">{it.count}</span>}
                <span className="text-[12px] text-[#1d5fb5] opacity-0 group-hover:opacity-100 transition-opacity">View →</span>
              </span>
            </Link>
          ))}
        </div>
      ) : <div className="text-[13px] text-[#94a3b8]">{emptyText}</div>}
    </div>
  );
}
