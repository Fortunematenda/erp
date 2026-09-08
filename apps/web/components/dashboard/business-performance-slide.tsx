'use client';
import { DatePicker, Empty, Select, Skeleton, Space } from 'antd';
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { SoftBadge } from '@/components/crud-page';

function Card({ title, subtitle, extra, children, className }: { title: string; subtitle?: string; extra?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`nex-card nex-card-hover flex flex-col overflow-hidden ${className || ''}`}>
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <div>
          <div className="font-semibold text-[16px] text-[#171a2e]">{title}</div>
          {subtitle && <div className="text-[12px] text-[#64748b] mt-0.5">{subtitle}</div>}
        </div>
        {extra}
      </div>
      <div className="flex-1 px-5 pb-5">{children}</div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[12px] text-[#64748b] font-medium">{label}</div>
      <div className="text-[18px] mt-1" style={{ color: accent || '#171a2e', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export function BusinessPerformanceSlide(props: any) {
  const { perf, perfTotals, devicesLoading, device, receiptsToday, vatToday, failedFiscal, certOk, connTone, connLabel, dayOpen, period, setPeriod, customRange, setCustomRange } = props;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <Card
        className="xl:col-span-2"
        title="Business Performance"
        subtitle="Revenue vs expenses over time"
        extra={
          <Space size="small">
            {period === 'custom' && <DatePicker.RangePicker className="!rounded-xl" value={customRange} onChange={setCustomRange} />}
            <Select className="!min-w-[140px] !rounded-xl" value={period} onChange={setPeriod} options={[
              { label: 'Today', value: 'today' },
              { label: 'This Week', value: 'week' },
              { label: 'This Month', value: 'month' },
              { label: 'Last Month', value: 'lastMonth' },
              { label: 'This Quarter', value: 'quarter' },
              { label: 'This Year', value: 'year' },
              { label: 'Last 30 Days', value: 'last30' },
              { label: 'Custom', value: 'custom' },
              { label: 'All Time', value: 'all' },
            ]} />
          </Space>
        }
      >
        {perf.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No posted transactions yet" />
        ) : (
          <>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={perf} margin={{ left: -12, right: 4, top: 4 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#003366" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#003366" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f6" vertical={false} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                  <RTooltip formatter={(v: any) => `$${Number(v).toLocaleString()}`} />
                  <Area type="monotone" dataKey="Revenue" stroke="#003366" strokeWidth={2.5} fill="url(#revGrad)" />
                  <Area type="monotone" dataKey="Expenses" stroke="#94a3b8" strokeWidth={2} fill="transparent" />
                  <Line type="monotone" dataKey="Net Profit" stroke="#16a34a" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[#eef0f6] border-t border-[#eef0f6] mt-2">
              <Metric label="Total Revenue" value={fmtMoney(perfTotals.revenue)} />
              <Metric label="Total Expenses" value={fmtMoney(perfTotals.expenses)} />
              <Metric label="Net Profit" value={fmtMoney(perfTotals.net)} accent={perfTotals.net >= 0 ? '#16a34a' : '#dc2626'} />
              <Metric label="Profit Margin" value={`${perfTotals.margin.toFixed(1)}%`} />
            </div>
          </>
        )}
      </Card>

      <Card title="Fiscalisation Status" subtitle="ZIMRA device & fiscal day">
        {devicesLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-[#64748b]">{device?.name || 'Device'}</div>
              <SoftBadge tone={connTone}>{connLabel}</SoftBadge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[#f8fafc] px-4 py-3">
                <div className="text-[11.5px] text-[#64748b]">Fiscal Day</div>
                <div className="text-[20px] font-bold text-[#171a2e]">#{device?.fiscalDayNo || 0}</div>
              </div>
              <div className="rounded-xl bg-[#f8fafc] px-4 py-3">
                <div className="text-[11.5px] text-[#64748b]">Day Status</div>
                <div className="mt-1"><SoftBadge tone={dayOpen ? 'green' : 'grey'}>{dayOpen ? 'Open' : 'Closed'}</SoftBadge></div>
              </div>
              <div className="rounded-xl bg-[#f8fafc] px-4 py-3">
                <div className="text-[11.5px] text-[#64748b]">Receipts Today</div>
                <div className="text-[20px] font-bold text-[#171a2e]">{fmtNumber(receiptsToday)}</div>
              </div>
              <div className="rounded-xl bg-[#f8fafc] px-4 py-3">
                <div className="text-[11.5px] text-[#64748b]">VAT Today</div>
                <div className="text-[20px] font-bold text-[#171a2e]">{fmtMoney(vatToday)}</div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-[#eef0f6] pt-3">
              <div className="text-[13px] text-[#64748b]">Failed / retry</div>
              <SoftBadge tone={failedFiscal > 0 ? 'red' : 'green'}>{fmtNumber(failedFiscal)}</SoftBadge>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-[#64748b]">Certificate</div>
              <SoftBadge tone={certOk === undefined ? 'grey' : certOk ? 'green' : 'red'}>{certOk === undefined ? '—' : certOk ? 'Valid' : 'Expired'}</SoftBadge>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
