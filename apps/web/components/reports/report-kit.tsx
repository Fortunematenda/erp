'use client';
import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dayjs from 'dayjs';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';
import { Button, DatePicker, Drawer, Select, Space, Tooltip } from 'antd';
import { FilterOutlined, RedoOutlined } from '@ant-design/icons';

dayjs.extend(quarterOfYear);

export type ReportFilters = {
  period: string; // today | yesterday | this_week | last_week | this_month | last_month | this_quarter | last_quarter | this_year | last_year | custom
  from: string | null;
  to: string | null;
  branchId: string | null;
  currency: string | null;
  compare: string; // none | previous_period | previous_month | previous_quarter | previous_year | same_period_last_year
};

export const PERIOD_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'last_quarter', label: 'Last Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'custom', label: 'Custom' },
];

export const COMPARE_OPTIONS = [
  { value: 'none', label: 'No comparison' },
  { value: 'previous_period', label: 'Previous Period' },
  { value: 'previous_month', label: 'Previous Month' },
  { value: 'previous_quarter', label: 'Previous Quarter' },
  { value: 'previous_year', label: 'Previous Year' },
  { value: 'same_period_last_year', label: 'Same Period Last Year' },
];

export function resolvePeriod(period: string, from?: string | null, to?: string | null): { from: string | null; to: string | null } {
  const d = dayjs();
  const fmt = (x: dayjs.Dayjs) => x.format('YYYY-MM-DD');
  const wk = (start: dayjs.Dayjs) => ({ from: fmt(start.startOf('week')), to: fmt(start.endOf('week')) });
  switch (period) {
    case 'today': return { from: fmt(d), to: fmt(d) };
    case 'yesterday': return { from: fmt(d.subtract(1, 'day')), to: fmt(d.subtract(1, 'day')) };
    case 'this_week': { const r = wk(d); return r; }
    case 'last_week': { const r = wk(d.subtract(1, 'week')); return r; }
    case 'this_month': return { from: fmt(d.startOf('month')), to: fmt(d.endOf('month')) };
    case 'last_month': return { from: fmt(d.subtract(1, 'month').startOf('month')), to: fmt(d.subtract(1, 'month').endOf('month')) };
    case 'this_quarter': return { from: fmt(d.startOf('quarter')), to: fmt(d.endOf('quarter')) };
    case 'last_quarter': return { from: fmt(d.subtract(1, 'quarter').startOf('quarter')), to: fmt(d.subtract(1, 'quarter').endOf('quarter')) };
    case 'this_year': return { from: fmt(d.startOf('year')), to: fmt(d.endOf('year')) };
    case 'last_year': return { from: fmt(d.subtract(1, 'year').startOf('year')), to: fmt(d.subtract(1, 'year').endOf('year')) };
    case 'custom': return { from: from || null, to: to || null };
    default: return { from: fmt(d.startOf('month')), to: fmt(d.endOf('month')) };
  }
}

/** Comparison window derived from the resolved primary window. */
export function resolveCompare(compare: string, win: { from: string | null; to: string | null }): { from: string | null; to: string | null } {
  if (!win.from || !win.to || compare === 'none') return { from: null, to: null };
  const f = dayjs(win.from), t = dayjs(win.to);
  const days = t.diff(f, 'day') + 1;
  const fmt = (x: dayjs.Dayjs) => x.format('YYYY-MM-DD');
  switch (compare) {
    case 'previous_period': return { from: fmt(f.subtract(days, 'day')), to: fmt(f.subtract(1, 'day')) };
    case 'previous_month': return { from: fmt(f.subtract(1, 'month')), to: fmt(t.subtract(1, 'month')) };
    case 'previous_quarter': return { from: fmt(f.subtract(1, 'quarter')), to: fmt(t.subtract(1, 'quarter')) };
    case 'previous_year': return { from: fmt(f.subtract(1, 'year')), to: fmt(t.subtract(1, 'year')) };
    case 'same_period_last_year': return { from: fmt(f.subtract(1, 'year')), to: fmt(t.subtract(1, 'year')) };
    default: return { from: null, to: null };
  }
}

/** URL-synced global filter state shared across all report tabs. */
export function useReportFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [draft, setDraft] = useState<Partial<ReportFilters>>({});

  const applied: ReportFilters = useMemo(() => ({
    period: params.get('period') || 'this_month',
    from: params.get('from'),
    to: params.get('to'),
    branchId: params.get('branch'),
    currency: params.get('currency'),
    compare: params.get('compare') || 'none',
  }), [params]);

  const win = useMemo(() => resolvePeriod(applied.period, applied.from, applied.to), [applied.period, applied.from, applied.to]);
  const compareWin = useMemo(() => resolveCompare(applied.compare, win), [applied.compare, win]);
  const isDirty = useMemo(() => Object.keys(draft).some((k) => (draft as any)[k] !== (applied as any)[k]), [draft, applied]);

  function setFilter(patch: Partial<ReportFilters>) { setDraft((s) => ({ ...s, ...patch })); }

  function apply() {
    const q = new URLSearchParams();
    const next = { ...applied, ...draft } as ReportFilters;
    q.set('period', next.period);
    if (next.period === 'custom') { if (next.from) q.set('from', next.from); if (next.to) q.set('to', next.to); }
    if (next.branchId) q.set('branch', next.branchId);
    if (next.currency) q.set('currency', next.currency);
    if (next.compare && next.compare !== 'none') q.set('compare', next.compare);
    setDraft({});
    router.replace(`/reports?${q.toString()}`, { scroll: false });
  }

  function reset() {
    setDraft({});
    router.replace('/reports', { scroll: false });
  }

  /** Draft values shown in controls (fall back to applied). */
  const draftState: ReportFilters = { ...applied, ...draft };
  return { applied, draftState, win, compareWin, setFilter, apply, reset, isDirty };
}

export function GlobalFilterBar({ filters, branches, currencies, onReset }: { filters: ReturnType<typeof useReportFilters>; branches: any[]; currencies: string[]; onReset?: () => void }) {
  const { draftState, setFilter, apply, reset, isDirty } = filters;
  const [mobileOpen, setMobileOpen] = useState(false);
  const showRange = draftState.period === 'custom';
  const rangeValue = draftState.from && draftState.to ? [dayjs(draftState.from), dayjs(draftState.to)] as any : null;

  const controls = (
    <>
      <Select size="small" style={{ width: 140 }} value={draftState.period} onChange={(v) => setFilter({ period: v })} options={PERIOD_OPTIONS} />
      {showRange && (
        <DatePicker.RangePicker size="small" value={rangeValue} onChange={(v: any) => setFilter({ from: v?.[0]?.format('YYYY-MM-DD') || null, to: v?.[1]?.format('YYYY-MM-DD') || null })} allowClear={false} />
      )}
      {!showRange && <span className="text-[12px] text-[#64748b] whitespace-nowrap">{draftState.from ? `${dayjs(draftState.from).format('DD MMM')} → ${dayjs(draftState.to).format('DD MMM, YYYY')}` : ''}</span>}
      <Select size="small" style={{ width: 150 }} allowClear placeholder="All Branches" value={draftState.branchId || undefined} onChange={(v) => setFilter({ branchId: v || null })} options={(branches || []).map((b: any) => ({ label: b.name, value: b.id }))} />
      <Select size="small" style={{ width: 105 }} allowClear placeholder="All Currencies" value={draftState.currency || undefined} onChange={(v) => setFilter({ currency: v || null })} options={(currencies || []).map((c: string) => ({ label: c, value: c }))} />
      <Select size="small" style={{ width: 175 }} value={draftState.compare} onChange={(v) => setFilter({ compare: v })} options={COMPARE_OPTIONS} />
      <Space size={4}>
        <Button size="small" onClick={() => { reset(); onReset?.(); }}>Reset</Button>
        <Button size="small" type="primary" disabled={!isDirty} onClick={apply}>Apply</Button>
      </Space>
    </>
  );

  return (
    <>
      <div className="hidden md:flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-[#eef0f6]">{controls}</div>
      <div className="md:hidden flex items-center justify-between px-4 py-2 border-t border-[#eef0f6]">
        <Button size="small" icon={<FilterOutlined />} onClick={() => setMobileOpen(true)}>Filters</Button>
        <Button size="small" type="primary" disabled={!isDirty} onClick={apply}>Apply</Button>
      </div>
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} title="Report Filters" width={320} extra={<Button size="small" type="primary" onClick={() => { apply(); setMobileOpen(false); }}>Apply</Button>}>
        <div className="flex flex-col gap-3">{controls}</div>
      </Drawer>
    </>
  );
}

export function CompareHint({ compare, pct }: { compare: string; pct: number | null }) {
  if (compare === 'none' || pct == null) return null;
  const up = pct >= 0;
  return (
    <Tooltip title="vs comparison period">
      <span className={`text-[11px] font-semibold ${up ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>{up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%</span>
    </Tooltip>
  );
}
