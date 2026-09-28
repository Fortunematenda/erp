'use client';
import { useQuery } from '@tanstack/react-query';
import { Button, Drawer, Empty, Result, Skeleton, Tabs, Tag } from 'antd';
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { StatusTag } from '@/components/crud-page';
import { fmtDate, fmtMoney } from '@/lib/format';

function money(v: any, currency?: string) {
  if (v == null) return '—';
  const s = fmtMoney(v);
  return currency && currency !== 'USD' ? `${s} ${currency}` : s;
}

function DocCell({ v }: { v: any }) {
  if (!v?.docNo) return <span className="text-[#a1a6c0]">—</span>;
  const inner = <span className="font-mono text-[12px] text-[#003366] font-semibold hover:underline">{v.docNo}</span>;
  return v.route ? <Link href={v.route}>{inner}</Link> : inner;
}

function OpenCell({ route, label = 'Open' }: { route?: string; label?: string }) {
  if (!route) return '—';
  return <Link href={route}><span className="text-[12px] font-medium text-[#003366] hover:underline">{label}</span></Link>;
}

const COLUMN_TAG: Record<string, any> = {
  CHARGE: { color: 'blue' }, FEE: { color: 'amber' }, INTEREST: { color: 'amber' },
  REFUND: { color: 'orange' }, CREDIT: { color: 'orange' }, ADJUSTMENT: { color: 'default' },
  PAYMENT: { color: 'green' }, UNPAID: { color: 'orange' }, PARTIALLY_PAID: { color: 'gold' },
  PAID: { color: 'green' }, OUTSTANDING: { color: 'orange' }, POSTED: { color: 'green' },
};

function entryColumns(entries: any[]) {
  const hasDrCr = entries.some((e) => e.debit !== undefined || e.credit !== undefined);
  const cols: any[] = [
    { title: 'Date', dataIndex: 'date', width: 100, render: fmtDate },
    { title: 'Document', dataIndex: 'docNo', render: (v: any, r: any) => <DocCell v={r} /> },
    { title: 'Source', dataIndex: 'typeLabel', width: 160, render: (v: any, r: any) => r.party && r.party !== '—' ? <span className="text-[12px] text-[#5a6080]">{v}<span className="text-[#a1a6c0]"> · {r.party}</span></span> : (v != null ? <span className="text-[12px] text-[#5a6080]">{v}</span> : '—') },
    ...(hasDrCr
      ? [({ title: 'Debit', dataIndex: 'debit', width: 90, align: 'right', render: (v: any) => v != null ? fmtMoney(v) : '—' }), ({ title: 'Credit', dataIndex: 'credit', width: 90, align: 'right', render: (v: any) => v != null ? fmtMoney(v) : '—' }), ({ title: 'Balance', dataIndex: 'balance', width: 100, align: 'right', render: (v: any) => <span className="font-semibold text-[13px] text-[#475467]">{fmtMoney(v)}</span> })]
      : [({ title: 'Amount', dataIndex: 'amount', width: 100, align: 'right', render: (v: any) => <span className="font-semibold text-[13px] text-[#171a2e]">{fmtMoney(v)}</span> }), ({ title: 'Outstanding', dataIndex: 'balance', width: 110, align: 'right', render: (v: any) => <span className="font-semibold text-[13px] text-[#475467]">{fmtMoney(v)}</span> })]),
    { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => (v && COLUMN_TAG[String(v)] ? <Tag color={COLUMN_TAG[String(v)].color}>{String(v).replace(/_/g, ' ')}</Tag> : <StatusTag value={v} />) },
  ];
  return cols;
}

function accountColumns(category: string) {
  switch (category) {
    case 'BANK':
      return [
        { title: 'Account', dataIndex: 'code', width: 90, render: (v: any) => <span className="font-mono text-[12px] text-[#003366] font-semibold">{v}</span> },
        { title: 'Bank / Account', dataIndex: 'name' },
        { title: 'Currency', dataIndex: 'currency', width: 90 },
        { title: 'Book Balance', dataIndex: 'balance', align: 'right', width: 120, render: (v: any) => <span className="font-semibold text-[13px] text-[#475467]">{fmtMoney(v)}</span> },
        { title: 'Actions', dataIndex: 'route', width: 90, render: (r: any, row: any) => <OpenCell route={row.route} label="Open" /> },
      ];
    case 'AR':
    case 'AP':
      return [
        { title: 'Name', dataIndex: 'name', render: (v: any, r: any) => r.route ? <Link href={r.route}><span className="font-medium text-[#171a2e] hover:text-[#003366] hover:underline">{v}</span></Link> : v },
        { title: category === 'AR' ? 'Open Invoices' : 'Open Bills', dataIndex: 'sub', width: 110, render: (v: any) => <span className="text-[#5a6080]">{v}</span> },
        { title: 'Outstanding', dataIndex: 'balance', width: 120, align: 'right', render: (v: any) => <span className="font-semibold text-[13px] text-[#475467]">{fmtMoney(v)}</span> },
        { title: 'Overdue', dataIndex: ['extra', 'overdue'], width: 110, align: 'right', render: (_: any, r: any) => <span className="font-semibold text-[13px]" style={{ color: Number(r.extra?.overdue || 0) > 0 ? '#d64545' : '#475467' }}>{fmtMoney(r.extra?.overdue || 0)}</span> },
      ];
    case 'CREDIT_CARD':
      return [
        { title: 'Card', dataIndex: 'name', render: (v: any, r: any) => r.route ? <Link href={r.route}><span className="font-medium text-[#171a2e] hover:text-[#003366] hover:underline">{v}</span></Link> : v },
        { title: 'Last 4', dataIndex: 'last4', width: 100, render: (v: any) => v ? `•••• ${v}` : '—' },
        { title: 'Current Balance', dataIndex: 'balance', width: 130, align: 'right', render: (v: any) => <span className="font-semibold text-[13px] text-[#475467]">{fmtMoney(v)}</span> },
        { title: 'Available Credit', dataIndex: ['extra', 'availableCredit'], width: 130, align: 'right', render: (_: any, r: any) => r.extra?.creditLimit ? <span className="font-semibold text-[13px] text-[#475467]">{fmtMoney(r.extra.availableCredit)}</span> : '—' },
        { title: 'Status', dataIndex: ['extra', 'status'], width: 90, render: (v: any) => <Tag color={({ ACTIVE: 'green', INACTIVE: 'default', CLOSED: 'red' } as any)[String(v)] || 'default'}>{v}</Tag> },
        { title: 'Actions', dataIndex: 'route', width: 90, render: (_: any, r: any) => <OpenCell route={r.route} /> },
      ];
    case 'LOAN':
    case 'EQUITY':
      return [
        { title: 'Account', dataIndex: 'code', width: 100, render: (v: any) => <span className="font-mono text-[12px] text-[#003366] font-semibold">{v}</span> },
        { title: 'Name', dataIndex: 'name', render: (v: any) => v },
        ...(category === 'EQUITY' ? [{ title: 'Type', dataIndex: 'sub', width: 160, render: (v: any) => <span className="text-[#5a6080]">{v}</span> }] : []),
        { title: 'Current Balance', dataIndex: 'balance', width: 130, align: 'right', render: (v: any) => <span className="font-semibold text-[13px]" style={{ color: Number(v) < 0 ? '#d64545' : '#475467' }}>{fmtMoney(v)}</span> },
        ...(category === 'LOAN' ? [{ title: 'Currency', dataIndex: 'currency', width: 90 }] : []),
      ];
    case 'REVENUE':
      return [
        { title: 'Account', dataIndex: 'code', width: 90, render: (v: any) => <span className="font-mono text-[12px] text-[#003366] font-semibold">{v}</span> },
        { title: 'Description', dataIndex: 'name' },
        { title: 'Balance', dataIndex: 'balance', width: 120, align: 'right', render: (v: any) => <span className="font-semibold text-[13px] text-[#475467]">{fmtMoney(v)}</span> },
        { title: '% of Revenue', dataIndex: 'pct', width: 110, align: 'right', render: (v: any) => <span className="text-[#5a6080]">{v != null ? `${Number(v).toFixed(1)}%` : '—'}</span> },
        { title: 'Actions', dataIndex: 'route', width: 90, render: (_: any, r: any) => <OpenCell route={r.route} /> },
      ];
    default:
      return [];
  }
}

export function FinanceAccountSummaryDrawer({ open, category, onClose }: { open: boolean; category: string | null; onClose: () => void }) {
  const cat = category || '';
  const router = useRouter();
  const q = useQuery({ queryKey: ['finance', 'dashboard', 'drilldown', cat], queryFn: () => api(`/finance/dashboard/drilldown/${cat}`), enabled: open && !!cat, retry: false });

  const d = q.data;
  const context = (
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold leading-tight tracking-[-0.01em] text-[#1f2937] tabular-nums">{money(d?.balance, d?.currency)}</span>
        </div>
        <div className="text-[12px] text-[#98A2B3] mt-1">{d?.totalLabel}{d?.periodLabel ? ` · ${d.periodLabel}` : ''}</div>
      </div>
      {d?.fullViewRoute && <Button icon={<ArrowRightOutlined />} onClick={() => { onClose(); router.push(d.fullViewRoute); }}>{d.fullViewLabel}</Button>}
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={620}
      destroyOnHidden
      title={d?.title || (cat ? cat.replace(/_/g, ' ').toLowerCase().replace(/^./, (m) => m.toUpperCase()) : '')}
      extra={<Button type="text" onClick={onClose}><span className="text-[16px]">&times;</span></Button>}
    >
      {open && q.isFetching && !d ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : q.isError ? (
        <Result status="warning" title="Unable to load account details" subTitle={d?.message || q.error instanceof Error ? (q.error as Error).message : 'Something went wrong.'} extra={<Button type="primary" icon={<ReloadOutlined />} onClick={() => q.refetch()}>Retry</Button>} />
      ) : (
        <Tabs
          defaultActiveKey="overview"
          items={[
            { key: 'overview', label: 'Overview', children: (
              <div>
                {context}
                {!d || d.accounts.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={cat === 'LOAN' ? 'No loan accounts' : cat === 'CREDIT_CARD' ? 'No credit card accounts yet.' : 'No accounts to display'} />
                ) : (
                  <div className="nex-card overflow-hidden">
                    <div className="text-[12px] font-semibold text-[#98A2B3] uppercase tracking-wide px-4 pt-3 pb-1">{d.totalLabel} by account</div>
                    <div className="overflow-x-auto">
                      <DocumentTable columns={accountColumns(cat)} dataSource={d.accounts} />
                    </div>
                    <div className="flex items-center justify-between border-t border-[#f2f3f9] px-4 py-2.5">
                      <span className="text-[13px] font-medium text-[#5a6080]">Total</span>
                      <span className="text-[14px] font-bold text-[#171a2e]">{money(d.total, d.currency)}</span>
                    </div>
                  </div>
                )}
              </div>
            ) },
            { key: 'entries', label: 'Entries', children: (
              <div>
                {context}
                {q.isFetching && !d ? <Skeleton active paragraph={{ rows: 6 }} /> : (
                  <div className="nex-card overflow-hidden">
                    {d && d.entries.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No entries to display" />
                    ) : (
                      <div className="overflow-x-auto">
                        <DocumentTable columns={entryColumns(d?.entries || [])} dataSource={(d?.entries || []).slice(0, 15)} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) },
          ]}
        />
      )}
    </Drawer>
  );
}

function DocumentTable({ columns, dataSource }: { columns: any[]; dataSource: any[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="bg-[#f8f9ff]">
          {columns.map((c: any, i: number) => (
            <th key={i} className={`text-left text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide px-4 py-2.5 ${c.align === 'right' ? 'text-right' : ''}`} style={{ width: c.width }}>{c.title}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-[#f2f3f9]">
        {(dataSource || []).map((row: any, ri: number) => (
          <tr key={row.id || ri} className="hover:bg-[#f8faff]">
            {columns.map((c: any, ci: number) => (
              <td key={ci} className={`px-4 py-2.5 text-[#475467] ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.render ? c.render(c.dataIndex ? row[c.dataIndex as string] : undefined, row) : (c.dataIndex ? row[c.dataIndex as string] : '—')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
