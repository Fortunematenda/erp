'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, Progress, Select, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, DeleteOutlined, DollarOutlined, DownloadOutlined,
  EyeOutlined, FileDoneOutlined, MailOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, ShoppingCartOutlined, StopOutlined, SwapOutlined, TruckOutlined, CopyOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useMeta } from '@/lib/meta';
import { CurrencyValue, CustomerAvatar, EmptyState, FilterBar, StatusPill, SummaryCard, customerOptions } from '@/components/sales-ui';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

export function SalesOrdersWorkspace({ customerId, embedded }: { customerId?: string; embedded?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const meta = useMeta();
  const list = useQuery({ queryKey: ['/sales/sales-orders'], queryFn: () => api('/sales/sales-orders') });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [customer, setCustomer] = useState('');
  const [invStatus, setInvStatus] = useState('');
  const [range, setRange] = useState<any>(null);

  async function doApi(url: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST', body?: any) {
    try {
      await api(url, { method, body: body ? JSON.stringify(body) : undefined });
      message.success('Done');
      qc.invalidateQueries({ queryKey: ['/sales/sales-orders'] });
      qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
      qc.invalidateQueries({ queryKey: ['/sales/quotations'] });
    } catch (e: any) { message.error(e.message); }
  }

  const rows = useMemo(() => {
    let r = Array.isArray(list.data) ? list.data : [];
    if (customerId) r = r.filter((o: any) => o.customerId === customerId);
    if (q) r = r.filter((o: any) => `${o.orderNo} ${o.customer?.name || ''} ${o.customerReference || ''} ${o.quotation?.quotationNo || ''} ${(o.invoices || []).map((i: any) => i.invoiceNo).join(' ')} ${o.notes || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (status) r = r.filter((o: any) => o.status === status);
    if (customer) r = r.filter((o: any) => o.customerId === customer);
    if (invStatus) r = r.filter((o: any) => o.invoiceProgress === invStatus);
    if (range?.[0] && range?.[1]) r = r.filter((o: any) => dayjs(o.orderDate).isAfter(dayjs(range[0])) && dayjs(o.orderDate).isBefore(dayjs(range[1]).add(1, 'day')));
    return r;
  }, [list.data, customerId, q, status, customer, invStatus, range]);

  const kpis = useMemo(() => {
    const active = rows.filter((o: any) => !['CLOSED', 'CANCELLED'].includes(o.status));
    const confirmed = rows.filter((o: any) => o.status === 'CONFIRMED');
    const ready = rows.filter((o: any) => o.fulfilmentStatus === 'FULFILLED' && o.invoiceProgress !== 'INVOICED');
    const value = active.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
    return { open: active.length, confirmed: confirmed.length, ready: ready.length, value };
  }, [rows]);

  const statusOptions = ['DRAFT', 'OPEN', 'CONFIRMED', 'CLOSED', 'CANCELLED'];
  const fulfilOptions = ['NOT_FULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED'];
  const invPOptions = ['NOT_INVOICED', 'PARTIALLY_INVOICED', 'INVOICED'];
  const lay = {
    label: (v?: string) => String(v || '').replace(/_/g, ' '),
  };

  const columns: ColumnsType<any> = [
    { title: 'Order #', dataIndex: 'orderNo', width: 130, render: (v, r) => <Link href={`/sales/orders/${r.id}/edit`} className="font-mono text-[12px] font-semibold text-[#003366] hover:text-[#0b4a8f] hover:underline">{v}</Link> },
    ...(customerId ? [] : [{ title: 'Customer', dataIndex: 'customer', render: (_v: any, r: any) => (<span className="flex items-center gap-2.5"><CustomerAvatar name={r.customer?.name} size={28} /><span className="text-[13px] text-[#171a2e]">{r.customer?.name || '—'}</span></span>) } as any]),
    { title: 'Order Date', dataIndex: 'orderDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Expected', dataIndex: 'expectedDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{v ? dayjs(v).format('DD MMM YY') : '—'}</span> },
    { title: 'Total', dataIndex: 'total', width: 120, align: 'right', render: (v) => <CurrencyValue value={v} /> },
    { title: 'Fulfilment', dataIndex: 'fulfilmentStatus', width: 130, render: (_v, r) => <FulfilCell r={r} /> },
    { title: 'Invoicing', dataIndex: 'invoiceProgress', width: 130, render: (_v, r) => <InvoiceCell r={r} /> },
    { title: 'Status', dataIndex: 'status', width: 120, render: (v) => <StatusPill status={lay.label(v)} /> },
    { ...ACTIONS_COL, render: (_, r: any) => <OrderActions r={r} onAction={doApi} /> },
  ];

  return (
    <div className="nex-fade">
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Sales Orders</h1><p className="text-[13px] text-[#64748b] mt-1">Manage confirmed customer orders from acceptance through fulfilment and invoicing</p></div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/sales/orders/new')}>New Sales Order</Button>
        </div>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        <SummaryCard icon={<ShoppingCartOutlined />} label="Open Orders" value={kpis.open} tone="#003366" />
        <SummaryCard icon={<CheckCircleOutlined />} label="Confirmed" value={kpis.confirmed} tone="#0ea5e9" />
        <SummaryCard icon={<FileDoneOutlined />} label="Ready to Invoice" value={kpis.ready} tone="#10b981" />
        <SummaryCard icon={<DollarOutlined />} label="Order Value" value={fmtMoney(kpis.value)} tone="#2563eb" />
      </div>
      <FilterBar extra={<span className="text-[12px] text-[#94a3b8]">{rows.length} orders</span>}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search orders..." className="w-[420px] max-w-full !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="Status" className="!min-w-[130px] !rounded-xl" value={status || undefined} onChange={setStatus} options={statusOptions.map((s) => ({ label: lay.label(s), value: s }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Customer" className="!min-w-[170px] !rounded-xl" value={customer || undefined} onChange={setCustomer} options={customerOptions(meta.data?.customers)} />
        <Select allowClear placeholder="Invoice status" className="!min-w-[150px] !rounded-xl" value={invStatus || undefined} onChange={setInvStatus} options={invPOptions.map((s) => ({ label: lay.label(s), value: s }))} />
        <DatePicker.RangePicker className="!rounded-xl" value={range} onChange={setRange} />
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/sales/sales-orders'] })} />
      </FilterBar>
      <div className="nex-card">
        {rows.length === 0 ? (
          q || status || customer || invStatus || range
            ? <EmptyState title="No sales orders match the selected filters." description="Try adjusting your filters." />
            : <EmptyState title="No sales orders found" description="Sales orders help you track confirmed customer orders before invoicing." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/sales/orders/new')}>New Sales Order</Button>} />
        ) : (
          <Table rowKey="id" loading={list.isLoading} dataSource={rows} columns={columns} scroll={{ x: true }} pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} orders` }} />
        )}
      </div>
    </div>
  );
}

function FulfilCell({ r }: { r: any }) {
  const pct = Number(r.fulfilmentPct || 0);
  const f = Number(r.fulfilledQty || 0);
  return (
    <div className="min-w-[110px]">
      <div className="flex items-center justify-between text-[11px] text-[#64748b] mb-1"><span>{f} / {Number(r.totalQty || 0)}</span><span>{pct}%</span></div>
      <Progress percent={pct} size="small" strokeColor={pct >= 100 ? '#16a34a' : '#0ea5e9'} showInfo={false} />
    </div>
  );
}
function InvoiceCell({ r }: { r: any }) {
  const pct = Number(r.invoicePct || 0);
  const label = r.invoiceProgress === 'INVOICED' ? 'Invoiced' : r.invoiceProgress === 'PARTIALLY_INVOICED' ? 'Part Invoiced' : 'Not Invoiced';
  return (
    <div className="min-w-[110px]">
      <div className="flex items-center justify-between text-[11px] text-[#64748b] mb-1"><span>{label}</span><span>{fmtMoney(r.invoicedAmount || 0)}</span></div>
      <Progress percent={pct} size="small" strokeColor={pct >= 100 ? '#16a34a' : pct > 0 ? '#f59e0b' : '#94a3b8'} showInfo={false} />
    </div>
  );
}

function OrderActions({ r, onAction }: { r: any; onAction: (url: string, method?: 'POST' | 'PATCH' | 'DELETE', body?: any) => Promise<void> }) {
  const router = useRouter();
  const isDraft = r.status === 'DRAFT';
  const isOpen = r.status === 'OPEN' || r.status === 'CONFIRMED';
  const notClosed = !['CLOSED', 'CANCELLED'].includes(r.status);
  const readyInvoice = isOpen && r.invoiceProgress !== 'INVOICED';
  const hasInvoices = (r.invoices || []).length > 0;
  const base = `/sales/sales-orders/${r.id}`;
  return (
    <RowActionsMenu items={[
      { key: 'view', icon: <EyeOutlined />, label: 'View / Edit', onClick: () => router.push(`/sales/orders/${r.id}/edit`) },
      { key: 'confirm', icon: <CheckCircleOutlined />, label: 'Confirm Order', disabled: !isDraft, disabledReason: 'Only draft orders can be confirmed', onClick: () => onAction(`${base}/confirm`) },
      { key: 'delivery', icon: <TruckOutlined />, label: 'Create Delivery', disabled: !isOpen || r.fulfilmentStatus === 'FULFILLED', disabledReason: r.fulfilmentStatus === 'FULFILLED' ? 'Order is already fulfilled' : 'Confirm the order first', onClick: () => router.push(`/sales/deliveries`) },
      { key: 'convert', icon: <SwapOutlined />, label: 'Convert to Invoice', hidden: !readyInvoice, confirm: 'Create Invoice from this Sales Order?', onClick: () => onAction(`${base}/convert-invoice`) },
      { key: 'email', icon: <MailOutlined />, label: 'Email', onClick: () => message.info('Email Sales Order') },
      { key: 'print', icon: <PrinterOutlined />, label: 'Print', onClick: () => window.print() },
      { key: 'pdf', icon: <DownloadOutlined />, label: 'PDF', onClick: () => router.push(`/documents/sales-order/${r.id}`) },
      { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate', onClick: () => onAction(`${base}/duplicate`) },
      { key: 'close', icon: <StopOutlined />, label: 'Close Order', disabled: !notClosed || r.status === 'CLOSED', disabledReason: 'Order is already closed or cancelled', onClick: () => onAction(`${base}/close`) },
      { key: 'cancel', icon: <CloseOutlined />, danger: true, label: 'Cancel Order', disabled: !notClosed, disabledReason: 'Order is already closed or cancelled', onClick: () => onAction(`${base}/cancel`) },
      { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Delete', disabled: hasInvoices, disabledReason: 'Cannot delete an order that has invoices', confirm: 'Delete this sales order?', onClick: () => onAction(base, 'DELETE') },
    ]} />
  );
}
