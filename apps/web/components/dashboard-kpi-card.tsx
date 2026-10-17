'use client';

export function DashboardKpiCard({ title, value, trend, subtitle, icon }: {
  title: string;
  value: React.ReactNode;
  trend: number | null;
  subtitle?: string;
  icon: React.ReactNode;
  color?: string;
  spark?: number[];
}) {
  const up = (trend ?? 0) > 0;
  const down = (trend ?? 0) < 0;
  const trendTone = !trend ? '#94a3b8' : up ? '#16a34a' : '#dc2626';
  const tr = trend == null ? null : `${up ? '+' : down ? '−' : ''}${Math.abs(trend).toFixed(0)}%`;

  return (
    <div className="nex-stat nex-card-hover flex flex-col min-h-[132px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-[#64748b] truncate">{title}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="text-[22px] font-semibold leading-none tracking-[-0.02em] text-[#171a2e] tabular-nums truncate">{value}</div>
            {tr && <span className="text-[12px] font-medium shrink-0" style={{ color: trendTone }}>{tr}</span>}
          </div>
          {subtitle && <div className="text-[12px] text-[#94a3b8] mt-1.5 truncate">{subtitle}</div>}
        </div>
        <div className="nex-stat-icon shrink-0">{icon}</div>
      </div>
    </div>
  );
}
