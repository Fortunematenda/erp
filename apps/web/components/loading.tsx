'use client';
import { Skeleton, Spin } from 'antd';

/** Skeleton rows that mirror a data table while it loads (avoids "No data" flashes). */
export function SkeletonTable({ rows = 6, columns = 6, className = '' }: { rows?: number; columns?: number; className?: string }) {
  const widths = [180, 120, 110, 100, 90, 110, 120, 90];
  return (
    <div className={`nex-card p-4 ${className}`}>
      <div className="flex gap-4 mb-4">
        {Array.from({ length: columns }).map((_, i) => <Skeleton.Input key={i} active size="small" style={{ width: widths[i % widths.length] }} />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-3 border-b border-[#f0f1f6] last:border-0">
          {Array.from({ length: columns }).map((_, c) => <Skeleton.Input key={c} active size="small" style={{ width: widths[c % widths.length] }} />)}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4, cols = 'lg:grid-cols-4' }: { count?: number; cols?: string }) {
  return (
    <div className={`grid grid-cols-2 ${cols} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="nex-card p-4"><Skeleton active title={{ width: '55%' }} paragraph={{ rows: 1, width: ['70%'] }} /></div>
      ))}
    </div>
  );
}

export function SectionLoading({ title, rows = 4 }: { title?: string; rows?: number }) {
  return <div className="nex-card p-6"><Skeleton active title={title ? { width: 200 } : false} paragraph={{ rows }} /></div>;
}

/** Full page fallback that resembles a header + summary cards + table. */
export function PageLoading({ cards = 4, rows = 6, columns = 6 }: { cards?: number; rows?: number; columns?: number }) {
  return (
    <div className="nex-fade space-y-5">
      <div className="flex items-center justify-between">
        <Skeleton active title={{ width: 260 }} paragraph={{ rows: 1, width: ['40%'] }} style={{ maxWidth: 420 }} />
        <Skeleton.Button active size="default" style={{ width: 120 }} />
      </div>
      <SkeletonCards count={cards} />
      <SkeletonTable rows={rows} columns={columns} />
    </div>
  );
}

/** Local overlay for genuinely blocking section operations (e.g. calculating payroll). */
export function LoadingOverlay({ visible, text = 'Processing…' }: { visible: boolean; text?: string }) {
  if (!visible) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-[1px] rounded-[inherit]">
      <div className="flex items-center gap-3 text-[13px] font-semibold text-[#003366]"><Spin size="small" /> {text}</div>
    </div>
  );
}

export function InlineLoading({ text = 'Loading…' }: { text?: string }) {
  return <span className="inline-flex items-center gap-2 text-[13px] text-[#64748b]"><Spin size="small" /> {text}</span>;
}
