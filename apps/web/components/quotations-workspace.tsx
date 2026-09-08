'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, Popconfirm, Select, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircleOutlined, EditOutlined, ExportOutlined, FileDoneOutlined, FileTextOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, SettingOutlined, ShoppingCartOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { CurrencyValue, CustomerAvatar, EmptyState, FilterBar, StatusPill, SummaryCard } from '@/components/sales-ui';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const STATUS_OPTIONS = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED', 'CANCELLED'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }));

export function QuotationsWorkspace({ customerId, embedded, hideCustomer }: { customerId?: string; embedded?: boolean; hideCustomer?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const list = useQuery({ queryKey: ['/sales/quotations'], queryFn: () => api('/sales/quotations') });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [range, setRange] = useState<any>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function bulkConvert(to: 'order' | 'invoice') { setBusy(true); try { for (const id of sel) await api(`/sales/quotations/${id}/convert${to === 'order' ? '' : '-invoice'}`, { method: 'POST' }); message.success(`Converted ${sel.length}`); qc.invalidateQueries({ queryKey: ['/sales/quotations'] }); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); qc.invalidateQueries({ queryKey: ['/sales/orders'] }); setSel([]); } catch (e: any) { message.error(e.message); } finally { setBusy(false); } }
  async function bulkDel() { setBusy(true); try { for (const id of sel) await api(`/sales/quotations/${id}`, { method: 'DELETE' }); message.success(`Deleted ${sel.length}`); qc.invalidateQueries({ queryKey: ['/sales/quotations'] }); setSel([]); } catch (e: any) { message.error(e.message); } finally { setBusy(false); } }

  const rows = useMemo(() => {
    const base = Array.isArray(list.data) ? list.data : [];
    let r = base;
    if (customerId) r = r.filter((i: any) => i.customerId === customerId);
    if (q) r = r.filter((i: any) => `${i.quotationNo} ${i.customer?.name || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (status) r = r.filter((i: any) => i.status === status);
    if (range?.[0] && range?.[1]) r = r.filter((i: any) => dayjs(i.quotationDate).isAfter(dayjs(range[0])) && dayjs(i.quotationDate).isBefore(dayjs(range[1]).add(1, 'day')));
    return r;
  }, [list.data, customerId, q, status, range]);
  const totals = useMemo(() => { const totalQuoted = rows.reduce((s: number, i: any) => s + Number(i.total || 0), 0); const open = rows.filter((i: any) => !['ACCEPTED', 'REJECTED', 'CONVERTED'].includes(i.status)).length; const accepted = rows.filter((i: any) => i.status === 'ACCEPTED').length; return { totalQuoted, count: rows.length, open, accepted }; }, [rows]);

  async function convert(r: any, to: 'order' | 'invoice') { try { await api(`/sales/quotations/${r.id}/convert${to === 'order' ? '' : '-invoice'}`, { method: 'POST' }); message.success(`Converted to ${to}`); qc.invalidateQueries({ queryKey: ['/sales/quotations'] }); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); qc.invalidateQueries({ queryKey: ['/sales/orders'] }); qc.invalidateQueries({ queryKey: ['sales-register'] }); } catch (e: any) { message.error(e.message); } }
  async function del(r: any) { try { await api(`/sales/quotations/${r.id}`, { method: 'DELETE' }); message.success('Quote deleted'); qc.invalidateQueries({ queryKey: ['/sales/quotations'] }); qc.invalidateQueries({ queryKey: ['sales-register'] }); } catch (e: any) { message.error(e.message); } }

  const columns: ColumnsType<any> = [
    { title: 'Quote #', dataIndex: 'quotationNo', width: 130, render: (v, r) => <Link href={`/sales/quotations/${r.id}/edit`} className="font-mono text-[12px] font-semibold text-[#003366] hover:text-[#0b4a8f] hover:underline">{v}</Link> },
    ...(hideCustomer ? [] : [{ title: 'Customer', dataIndex: 'customer', render: (_v: any, r: any) => (<span className="flex items-center gap-2.5"><CustomerAvatar name={r.customer?.name} size={28} /><span className="text-[13px] text-[#171a2e]">{r.customer?.name || '—'}</span></span>) } as any]),
    { title: 'Date', dataIndex: 'quotationDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Expiry', dataIndex: 'validUntil', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{v ? dayjs(v).format('DD MMM YY') : '—'}</span> },
    { title: 'Amount', dataIndex: 'total', width: 130, align: 'right', render: (v) => <CurrencyValue value={v} /> },
    { title: 'Status', dataIndex: 'status', width: 140, render: (_v, r) => <QuoteStatus r={r} /> },
    { title: 'Linked', key: 'linked', width: 150, render: (_v, r) => <QuoteLinks r={r} /> },
    { ...ACTIONS_COL, render: (_, r: any) => {
      const st = String(r.status || '').toUpperCase();
      const canConvert = ['DRAFT', 'OPEN', 'PENDING', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED', 'ACCEPTED'].includes(st) && r.conversionType == null;
      return (
        <RowActionsMenu items={[
          { key: 'edit', label: 'Edit', icon: <EditOutlined />, onClick: () => router.push(`/sales/quotations/${r.id}/edit`) },
          { key: 'invoice', label: 'Convert to Invoice', icon: <FileDoneOutlined />, hidden: !canConvert, confirm: 'Convert this quote to an Invoice?', onClick: () => convert(r, 'invoice') },
          { key: 'order', label: 'Convert to Order', icon: <ShoppingCartOutlined />, hidden: !canConvert, confirm: 'Convert this quote to a Sales Order?', onClick: () => convert(r, 'order') },
          { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, confirm: 'Delete quote?', onClick: () => del(r) },
        ]} />
      );
    } },
  ];
  const kpis = [{ label: 'Total Quoted', value: fmtMoney(totals.totalQuoted), icon: <FileTextOutlined />, tone: '#2563eb' }, { label: 'Total Quotes', value: totals.count, icon: <FileTextOutlined />, tone: '#7c3aed' }, { label: 'Open', value: totals.open, icon: <PlusOutlined />, tone: '#f59e0b', valueColor: '#F97316' }, { label: 'Accepted', value: totals.accepted, icon: <CheckCircleOutlined />, tone: '#16a34a', valueColor: '#16A34A' }];

  return (
    <div className="nex-fade">
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Quotes / Estimates</h1><p className="text-[13px] text-[#64748b] mt-1">Create, track and convert quotes into invoices</p></div>
          <Link href="/sales/quotations/template"><Button icon={<SettingOutlined />}>Customize Template</Button></Link>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/sales/quotations/new')}>New Quote</Button>
        </div>
      )}
      {!embedded && <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">{kpis.map((k) => <SummaryCard key={k.label} icon={k.icon} label={k.label} value={k.value} tone={k.tone} valueColor={k.valueColor} />)}</div>}
      <FilterBar extra={<span className="text-[12px] text-[#94a3b8]">{totals.count} quotes</span>}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search by customer or quote" className="w-72 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="Filter by status" className="!min-w-[150px] !rounded-xl" value={status || undefined} onChange={setStatus} options={STATUS_OPTIONS} />
        <DatePicker.RangePicker className="!rounded-xl" value={range} onChange={setRange} />
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/sales/quotations'] })} />
        <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
        <Button icon={<ExportOutlined />}>Export</Button>
      </FilterBar>
      <div className="nex-card">
        {rows.length === 0 ? <EmptyState title="No quotes yet" description="Create your first quote to start preparing customer estimates." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/sales/quotations/new')}>New Quote</Button>} /> : (<>
          {sel.length > 0 && (<div className="px-4 py-3 flex items-center gap-3 flex-wrap bg-[#f8faff] border-b border-[#eef0f6]"><span className="text-[13px] font-medium text-[#344054]">{sel.length} selected</span><Button type="primary" icon={<FileDoneOutlined />} loading={busy} onClick={() => bulkConvert('invoice')}>Convert to Invoice</Button><Button icon={<ShoppingCartOutlined />} loading={busy} onClick={() => bulkConvert('order')}>Convert to Order</Button><Popconfirm title={`Delete ${sel.length} selected quotes?`} onConfirm={bulkDel}><Button danger icon={<DeleteOutlined />} loading={busy}>Delete</Button></Popconfirm><div className="ml-auto"><Button size="small" onClick={() => setSel([])}>Clear</Button></div></div>)}
          <Table rowKey="id" loading={list.isLoading} dataSource={rows} columns={columns} scroll={{ x: true }} rowSelection={{ selectedRowKeys: sel, onChange: (keys) => setSel(keys as string[]) }} pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} quotes` }} />
        </>)}
      </div>
    </div>
  );
}

function QuoteStatus({ r }: { r: any }) {
  if (r.conversionType === 'SALES_ORDER') return <StatusPill status="Converted to Order" tone="green" />;
  if (r.conversionType === 'INVOICE') return <StatusPill status="Converted to Invoice" tone="green" />;
  return <StatusPill status={r.status} />;
}

function QuoteLinks({ r }: { r: any }) {
  const so = (r.salesOrders || [])[0];
  const inv = (r.invoices || [])[0];
  if (!so && !inv) return <span className="text-[12px] text-[#94a3b8]">—</span>;
  return (
    <div className="flex flex-col gap-1 text-[12px]">
      {so && <span>Order: <Link href={`/sales/orders/${so.id}/edit`} className="font-mono text-[#003366] hover:underline">{so.orderNo}</Link></span>}
      {inv && <span>Invoice: <Link href={`/sales/invoices/${inv.id}/edit`} className="font-mono text-[#003366] hover:underline">{inv.invoiceNo}</Link></span>}
    </div>
  );
}
