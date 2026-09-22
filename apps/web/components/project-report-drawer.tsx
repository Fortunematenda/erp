'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Descriptions, Drawer, Skeleton, Space, Table, Tabs, Tag, Timeline, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PrinterOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/sales-ui';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';

function Metric({ label, value, color, hint }: { label: string; value: any; color?: string; hint?: string }) {
  return (
    <div className="nex-card border rounded-lg p-3">
      <div className="text-[12px] font-semibold text-[#64748b]">{hint ? <Tooltip title={hint}>{label}</Tooltip> : label}</div>
      <div className="text-[18px] font-bold mt-0.5" style={{ color: color || '#171a2e' }}>{value}</div>
    </div>
  );
}

export function ProjectReportDrawer({ projectId, projectName, from, to, onClose }: { projectId: string; projectName?: string; from?: string; to?: string; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['/projects', projectId, 'report', qs.toString()], queryFn: () => api(`/projects/${projectId}/report${qs.toString() ? `?${qs.toString()}` : ''}`) });

  const s = data?.summary || {};
  const p = data?.project;
  const marginColor = (s.margin ?? 0) > 0 ? '#16a34a' : (s.margin ?? 0) < 0 ? '#dc2626' : '#475467';
  const money = (v: any) => fmtMoney(v, p?.currency);

  const tabItems = data ? [
    { key: 'overview', label: 'Overview', children: <Overview data={data} money={money} /> },
    { key: 'financials', label: 'Financials', children: <Financials data={data} money={money} marginColor={marginColor} /> },
    { key: 'billing', label: 'Billing', children: <Billing data={data} money={money} onOpen={(id: string) => router.push(`/sales/invoices/${id}`)} /> },
    { key: 'costs', label: 'Costs', children: <Costs data={data} money={money} /> },
    { key: 'tasks', label: `Tasks (${data.tasks?.total ?? 0})`, children: <Tasks data={data} /> },
    { key: 'transactions', label: 'Transactions', children: <Transactions data={data} money={money} /> },
    { key: 'documents', label: `Documents (${data.documents?.invoices?.length + data.documents?.quotations?.length + data.documents?.attachments?.length || 0})`, children: <Documents data={data} money={money} onOpen={(t: string, id: string) => router.push(t === 'INVOICE' ? `/sales/invoices/${id}` : `/sales/quotations/${id}`)} /> },
    { key: 'activity', label: 'Activity', children: <Activity data={data} /> },
  ] : [];

  return (
    <Drawer open onClose={onClose} width="min(1200px, 92vw)" destroyOnHidden
      title={data ? <div><div className="text-[16px] font-bold text-[#171a2e]">{p?.name} · Project Report</div><div className="text-[12px] text-[#64748b] font-normal">{p?.code} · {p?.status} · Customer: {p?.customer?.name || '—'} · {from || to ? `${from || '—'} → ${to || '—'}` : 'All time'}</div></div> : `${projectName || 'Project'} · Report`}
      extra={<Space size="small">
        <Button size="small" onClick={() => router.push(`/projects/${projectId}`)}>Open Project</Button>
        <Button size="small" icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
        <Button size="small" onClick={() => qc.invalidateQueries({ queryKey: ['/projects', projectId, 'report'] })}>Refresh</Button>
      </Space>}>
      {isLoading ? <Skeleton active paragraph={{ rows: 10 }} /> : isError ? (
        <div className="text-center py-12"><div className="text-[13px] text-[#64748b] mb-3">Could not load project report.</div><Button onClick={() => refetch()}>Retry</Button></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Revenue" value={money(s.revenue)} color="#16a34a" />
            <Metric label="Actual Cost" value={money(s.totalCost)} color="#dc2626" />
            <Metric label="Profit" value={money(s.profit)} color={s.profit >= 0 ? '#16a34a' : '#dc2626'} />
            <Metric label="Margin" value={s.margin != null ? `${fmtNumber(s.margin, 2)}%` : '—'} color={marginColor} />
            <Metric label="Budget" value={money(s.budget)} />
            <Metric label="Budget Remaining" value={money(s.budgetRemaining)} hint="Budget − Actual Cost" color={s.budgetRemaining >= 0 ? '#16a34a' : '#dc2626'} />
            <Metric label="Invoiced" value={money(s.invoiced)} />
            <Metric label="Outstanding" value={money(s.outstanding)} />
          </div>
          <Tabs activeKey={tab} onChange={setTab} items={tabItems} />
        </div>
      )}
    </Drawer>
  );
}

function Overview({ data, money }: any) {
  const s = data.summary; const p = data.project;
  const health = [
    { label: 'Budget', value: s.budgetRemaining >= 0 ? 'On Track' : 'Over Budget', tone: s.budgetRemaining >= 0 ? 'green' : 'red' },
    { label: 'Billing', value: s.outstanding > 0 ? 'Unbilled / Outstanding' : 'Up to Date', tone: s.outstanding > 0 ? 'orange' : 'green' },
    { label: 'Collections', value: s.outstanding > 0 ? 'Outstanding' : 'Current', tone: s.outstanding > 0 ? 'orange' : 'green' },
    { label: 'Tasks', value: `${data.tasks.overdue} overdue`, tone: data.tasks.overdue > 0 ? 'red' : 'green' },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {health.map((h) => <div key={h.label} className="nex-card border rounded-lg p-3"><div className="text-[12px] text-[#64748b]">{h.label}</div><Tag color={h.tone} className="!mt-1">{h.value}</Tag></div>)}
      </div>
      <div className="nex-card border rounded-lg p-4">
        <Descriptions size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="Project">{p.name} ({p.code})</Descriptions.Item>
          <Descriptions.Item label="Status"><StatusPill status={p.status} /></Descriptions.Item>
          <Descriptions.Item label="Customer">{p.customer?.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Manager">{p.manager || '—'}</Descriptions.Item>
          <Descriptions.Item label="Start date">{fmtDate(p.startDate)}</Descriptions.Item>
          <Descriptions.Item label="Period">{data.period.from ? `${fmtDate(data.period.from)} → ${fmtDate(data.period.to)}` : 'All time'}</Descriptions.Item>
        </Descriptions>
      </div>
      {s.revenue === 0 && s.totalCost === 0 && <div className="rounded-lg border border-[#e6e9f2] bg-[#f8fafc] px-4 py-3 text-[13px] text-[#64748b]">No project revenue or cost has been recorded yet. Budget: {money(s.budget)}.</div>}
      <div className="nex-card border rounded-lg p-4">
        <div className="text-[13px] font-semibold mb-2">Project team</div>
        <Table rowKey="id" size="small" dataSource={data.team || []} pagination={false} columns={[
          { title: 'Member', render: (_v, r) => `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}` },
          { title: 'Role', dataIndex: 'role' }, { title: 'Hours logged', dataIndex: 'hours', align: 'right', render: (v) => fmtNumber(v, 1) },
          { title: 'Labour cost', dataIndex: 'labourCost', align: 'right', render: (v) => money(v) },
        ] as ColumnsType<any>} locale={{ emptyText: 'No team members.' }} />
      </div>
    </div>
  );
}

function Financials({ data, money, marginColor }: any) {
  const s = data.summary;
  const line = (label: string, value: any, bold = false, color?: string) => (
    <div className={`flex justify-between py-2 border-b border-[#f0f1f6] last:border-0 ${bold ? 'font-bold' : ''}`}><span className="text-[13px] text-[#344054]">{label}</span><span className="text-[13px]" style={{ color: color || '#171a2e' }}>{value}</span></div>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="nex-card border rounded-lg p-4">
        <div className="text-[13px] font-semibold mb-2">Profitability</div>
        {line('Revenue', money(s.revenue))}
        {line('Materials', money(s.materialCost))}
        {line('Labour', money(s.labourCost))}
        {line('Other / Expenses', money(s.otherCost))}
        {line('Total Cost', money(s.totalCost), true)}
        {line('Project Profit', money(s.profit), true, s.profit >= 0 ? '#16a34a' : '#dc2626')}
        {line('Margin', s.margin != null ? `${fmtNumber(s.margin, 2)}%` : '—', true, marginColor)}
      </div>
      <div className="nex-card border rounded-lg p-4">
        <div className="text-[13px] font-semibold mb-2">Budget</div>
        {line('Budget', money(s.budget))}
        {line('Actual cost', money(s.totalCost))}
        {line('Budget remaining', money(s.budgetRemaining), true, s.budgetRemaining >= 0 ? '#16a34a' : '#dc2626')}
        {line('Budget used', s.budgetUsedPct != null ? `${fmtNumber(s.budgetUsedPct, 1)}%` : '—')}
        {line('Forecast cost', money(s.forecastCost))}
        {line('Forecast profit', money(s.forecastProfit), true)}
      </div>
    </div>
  );
}

function Billing({ data, money, onOpen }: any) {
  const b = data.billing;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Metric label="Quoted" value={money(b.quoted)} /><Metric label="Ordered" value={money(b.ordered)} /><Metric label="Invoiced" value={money(b.invoiced)} />
        <Metric label="Unbilled" value={money(b.unbilled)} /><Metric label="Paid" value={money(b.paid)} color="#16a34a" /><Metric label="Outstanding" value={money(b.outstanding)} color={b.outstanding > 0 ? '#dc2626' : undefined} />
      </div>
      <Table rowKey="id" size="small" dataSource={data.revenueDocs || []} pagination={false} columns={[
        { title: 'Invoice', dataIndex: 'number', render: (v, r) => <a className="text-[#1d5fb5]" onClick={() => onOpen(r.id)}>{v}</a> },
        { title: 'Date', dataIndex: 'date', render: (v) => fmtDate(v) },
        { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => money(v) },
        { title: 'Balance', dataIndex: 'balance', align: 'right', render: (v) => money(v) },
        { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
      ] as ColumnsType<any>} locale={{ emptyText: 'No project invoices.' }} />
    </div>
  );
}

function Costs({ data, money }: any) {
  const c = data.costs || {};
  return (
    <Tabs items={[
      { key: 'labour', label: `Labour (${c.labour?.length || 0})`, children: <Table rowKey="id" size="small" dataSource={c.labour || []} pagination={{ pageSize: 10 }} columns={[
        { title: 'Date', dataIndex: 'date', render: (v) => fmtDate(v) }, { title: 'Employee', dataIndex: 'employee' }, { title: 'Hours', dataIndex: 'hours', align: 'right', render: (v) => fmtNumber(v, 1) },
        { title: 'Cost rate', dataIndex: 'costRate', align: 'right', render: (v) => money(v) }, { title: 'Cost', dataIndex: 'cost', align: 'right', render: (v) => money(v) }, { title: 'Billable', dataIndex: 'billable', render: (v) => (v ? 'Yes' : 'No') },
      ] as ColumnsType<any>} locale={{ emptyText: 'No labour timesheets.' }} /> },
      { key: 'materials', label: `Materials (${c.materials?.length || 0})`, children: <Table rowKey="id" size="small" dataSource={c.materials || []} pagination={{ pageSize: 10 }} columns={[
        { title: 'Date', dataIndex: 'date', render: (v) => fmtDate(v) }, { title: 'Item', dataIndex: 'item' }, { title: 'Qty', dataIndex: 'quantity', align: 'right' },
        { title: 'Unit cost', dataIndex: 'unitCost', align: 'right', render: (v) => money(v) }, { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => money(v) },
      ] as ColumnsType<any>} locale={{ emptyText: 'No material issues.' }} /> },
      { key: 'expenses', label: `Expenses (${c.expenses?.length || 0})`, children: <Table rowKey="id" size="small" dataSource={c.expenses || []} pagination={{ pageSize: 10 }} columns={[
        { title: 'Date', dataIndex: 'date', render: (v) => fmtDate(v) }, { title: 'Document', dataIndex: 'number' }, { title: 'Supplier', dataIndex: 'supplier' },
        { title: 'Amount', dataIndex: 'total', align: 'right', render: (v) => money(v) }, { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
      ] as ColumnsType<any>} locale={{ emptyText: 'No supplier expenses.' }} /> },
    ]} />
  );
}

function Tasks({ data }: any) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Total" value={data.tasks.total} /><Metric label="Completed" value={data.tasks.completed} color="#16a34a" />
        <Metric label="Open" value={data.tasks.open} /><Metric label="Overdue" value={data.tasks.overdue} color={data.tasks.overdue ? '#dc2626' : undefined} />
      </div>
      <Table rowKey="id" size="small" dataSource={data.tasks.items || []} pagination={false} columns={[
        { title: 'Task', dataIndex: 'title' }, { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
        { title: 'Progress', dataIndex: 'progress', align: 'right', render: (v) => `${v || 0}%` }, { title: 'Due', dataIndex: 'dueDate', render: (v) => fmtDate(v) },
      ] as ColumnsType<any>} locale={{ emptyText: 'No project tasks.' }} />
    </div>
  );
}

function Transactions({ data, money }: any) {
  const rows = [
    ...(data.revenueDocs || []).map((i: any) => ({ id: `inv-${i.id}`, date: i.date, type: 'Invoice', document: i.number, description: 'Project invoice', debit: null, credit: i.total, status: i.status })),
    ...(data.costs?.labour || []).map((t: any) => ({ id: `ts-${t.id}`, date: t.date, type: 'Timesheet', document: t.employeeNo || '', description: `${t.employee} · ${fmtNumber(t.hours, 1)}h`, debit: t.cost, credit: null, status: 'POSTED' })),
    ...(data.costs?.materials || []).map((m: any) => ({ id: `mat-${m.id}`, date: m.date, type: 'Inventory Issue', document: m.sku || '', description: m.item, debit: m.total, credit: null, status: 'POSTED' })),
    ...(data.costs?.expenses || []).map((b: any) => ({ id: `bill-${b.id}`, date: b.date, type: 'Supplier Bill', document: b.number, description: b.supplier, debit: b.total, credit: null, status: b.status })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 15 }} columns={[
    { title: 'Date', dataIndex: 'date', render: (v) => fmtDate(v) }, { title: 'Type', dataIndex: 'type' }, { title: 'Document', dataIndex: 'document' },
    { title: 'Description', dataIndex: 'description' }, { title: 'Cost', dataIndex: 'debit', align: 'right', render: (v) => (v != null ? money(v) : '—') },
    { title: 'Revenue', dataIndex: 'credit', align: 'right', render: (v) => (v != null ? money(v) : '—') }, { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
  ] as ColumnsType<any>} locale={{ emptyText: 'No project transactions.' }} />;
}

function Documents({ data, money, onOpen }: any) {
  const rows = [
    ...(data.documents?.invoices || []).map((x: any) => ({ ...x, label: x.number, kind: 'Invoice' })),
    ...(data.documents?.quotations || []).map((x: any) => ({ ...x, label: x.number, kind: 'Quote' })),
    ...(data.documents?.attachments || []).map((x: any) => ({ id: `att-${x.id}`, type: 'ATTACHMENT', label: x.name, date: x.createdAt, total: null, kind: 'Attachment', dataUrl: x.dataUrl })),
  ];
  return <Table rowKey="id" size="small" dataSource={rows} pagination={false} columns={[
    { title: 'Type', dataIndex: 'kind' }, { title: 'Document', dataIndex: 'label', render: (v, r: any) => (r.type === 'ATTACHMENT' ? v : <a className="text-[#1d5fb5]" onClick={() => onOpen(r.type, r.id)}>{v}</a>) },
    { title: 'Date', dataIndex: 'date', render: (v) => fmtDate(v) }, { title: 'Amount', dataIndex: 'total', align: 'right', render: (v) => (v != null ? money(v) : '—') },
  ] as ColumnsType<any>} locale={{ emptyText: 'No project documents.' }} />;
}

function Activity({ data }: any) {
  if (!data.activity?.length) return <div className="text-[13px] text-[#94a3b8] py-6 text-center">No project activity recorded.</div>;
  return <Timeline items={data.activity.map((a: any) => ({ children: (<div><div className="text-[12px] text-[#94a3b8]">{fmtDate(a.date)}</div><div className="text-[13px] text-[#344054]">{a.text}</div></div>) }))} />;
}
