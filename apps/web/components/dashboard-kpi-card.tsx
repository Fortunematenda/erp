'use client';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export function DashboardKpiCard({ title, value, trend, subtitle, icon, color, spark }: {
  title: string;
  value: React.ReactNode;
  trend: number | null;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  spark: number[];
}) {
  const data = (spark.length ? spark : [0, 0, 0, 0, 0]).map((v, i) => ({ i, v }));
  const up = (trend ?? 0) > 0;
  const down = (trend ?? 0) < 0;
  const trendTone = trend === null || trend === 0 ? '#98A2B3' : up ? '#16A34A' : '#EF4444';
  const tr = trend === null ? '—' : `${up ? '+' : ''}${Math.abs(trend).toFixed(0)}%`;
  const gid = `spark-${title.replace(/\s+/g, '')}`;

  return (
    <div className="nex-card nex-card-hover flex flex-col p-5 min-h-[152px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[20px] font-semibold leading-[1.2] tracking-[-0.01em] text-[#1f2937] truncate">{value}</span>
            <span className="text-[13px] font-semibold shrink-0" style={{ color: trendTone }}>{up ? '↑' : down ? '↓' : ''}{tr}</span>
          </div>
          <div className="text-[14px] font-medium text-[#667085] mt-1 truncate">{title}</div>
          {subtitle && <div className="text-[12px] text-[#98A2B3] mt-0.5 truncate">{subtitle}</div>}
        </div>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-[15px] shrink-0" style={{ background: `${color}1f`, color }}>{icon}</div>
      </div>
      <div className="flex-1" />
      <div className="h-[40px] mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gid})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

