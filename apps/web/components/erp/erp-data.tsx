'use client';

import type { ReactNode } from 'react';
import { Button, DatePicker, Input, Skeleton, Table, Tabs } from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { SoftBadge, statusTone } from '@/components/crud-page';
import { ERPEmptyState } from './erp-feedback';

const { RangePicker } = DatePicker;

export function ERPToolbar({ children, extra }: { children?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {children}
      {extra ? <div className="ml-auto flex items-center gap-2">{extra}</div> : null}
    </div>
  );
}

export function ERPFilterBar({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="nex-card nex-filter-bar mb-4 px-4 py-3 flex flex-wrap items-center gap-2">
      {children}
      {extra ? <div className="ml-auto text-[12px] font-medium text-[var(--text-muted)]">{extra}</div> : null}
    </div>
  );
}

export function ERPSearchInput({ value, onChange, placeholder = 'Search', className }: { value?: string; onChange?: (value: string) => void; placeholder?: string; className?: string }) {
  return (
    <Input
      allowClear
      prefix={<SearchOutlined className="text-[var(--text-faint)]" />}
      placeholder={placeholder}
      className={className || '!w-64 shrink-0'}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

export function ERPDateRangePicker({ value, onChange }: { value?: any; onChange?: (value: any) => void }) {
  return <RangePicker value={value} onChange={onChange} />;
}

export function ERPStatusBadge({ status, tone, children }: { status?: string; tone?: string; children?: ReactNode }) {
  const label = children ?? String(status || 'Draft').replace(/_/g, ' ');
  return <SoftBadge tone={tone || statusTone(String(status || label))}>{label}</SoftBadge>;
}

export function ERPStatCard({
  label,
  value,
  trend,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  trend?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="nex-card px-4 py-3.5">
      <div className="text-[12px] font-medium text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-[22px] font-semibold leading-none tracking-[-0.02em] text-[var(--foreground)] tabular-nums">{value}</div>
        {trend ? <div className="text-[12px] font-medium text-[var(--text-muted)]">{trend}</div> : null}
      </div>
      {hint ? <div className="mt-1.5 text-[12px] text-[var(--text-faint)]">{hint}</div> : null}
    </div>
  );
}

export function ERPMetricCard({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-[var(--text-muted)]">{label}</div>
      <div className="text-[15px] font-semibold text-[var(--foreground)] tabular-nums">{value}</div>
    </div>
  );
}

export function ERPDataTable<T extends object>(props: TableProps<T>) {
  const { locale, pagination, ...rest } = props;
  return (
    <div className="nex-card overflow-hidden">
      <Table<T>
        size="middle"
        pagination={pagination === undefined ? { pageSize: 20, showSizeChanger: false, hideOnSinglePage: false } : pagination}
        {...rest}
        locale={{ emptyText: <ERPEmptyState title="Nothing to show" />, ...locale }}
      />
    </div>
  );
}

export function ERPTabs({ className, ...props }: React.ComponentProps<typeof Tabs>) {
  return <Tabs className={`nexus-page-tabs ${className || ''}`} {...props} />;
}

export function ERPSkeleton({ rows = 6 }: { rows?: number }) {
  return <Skeleton active paragraph={{ rows }} />;
}
