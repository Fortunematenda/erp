'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, Popconfirm, Select, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClockCircleOutlined, DollarOutlined, ExportOutlined, EyeOutlined, FileDoneOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, DeleteOutlined, SettingOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { CurrencyValue, CustomerAvatar, EmptyState, FilterBar, StatusPill, SummaryCard } from '@/components/sales-ui';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

export function InvoicesWorkspace({ customerId, embedded, hideCustomer }: { customerId?: string; embedded?: boolean; hideCustomer?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const list = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices') });
  const devices = useQuery({ queryKey: ['fiscal-devices'], queryFn: () => api('/fiscalisation/devices') });
  const [q, setQ] = useState('');
  const [invStatus, setInvStatus] = useState('');
  const [payStatus, setPayStatus] = useState('');
  const [fiscStatus, setFiscStatus] = useState('');
  const [range, setRange] = useState<any>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function bulkPost() { setBusy(true); try { for (const id of sel) await api(`/sales/invoices/${id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST' }) }).catch(() => {}); message.success(`Posted ${sel.length}`); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); setSel([]); } catch (e: any) { message.error(e.message); } finally { setBusy(false); } }
  async function bulkDel() { setBusy(true); try { for (const id of sel) await api(`/sales/invoices/${id}`, { method: 'DELETE' }); message.success(`Deleted ${sel.length}`); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); setSel([]); } catch (e: any) { message.error(e.message); } finally { setBusy(false); } }
  function exportSel() { const rowsSel = rows.filter((r: any) => sel.includes(r.id)); const csv = [['Invoice #', 'Customer', 'Date', 'Amount', 'Status'].join(','), ...rowsSel.map((i: any) => [i.invoiceNo, i.customer?.name || '', dayjs(i.invoiceDate).format('YYYY-MM-DD'), Number(i.total || 0), i.status].map((x) => `"${x ?? ''}"`).join(','))].join('\n'); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'invoices.csv'; a.click(); URL.revokeObjectURL(url); message.success('Exported'); }

  const rows = useMemo(() => {
    let r = (Array.isArray(list.data) ? list.data : []).filter((i: any) => i.invoiceStatus !== 'VOID');
    if (customerId) r = r.filter((i: any) => i.customerId === customerId);
    if (q) r = r.filter((i: any) => `${i.invoiceNo} ${i.customer?.name || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (invStatus) r = r.filter((i: any) => i.invoiceStatus === invStatus);
    if (payStatus) r = r.filter((i: any) => i.paymentStatus === payStatus);
    if (fiscStatus) r = r.filter((i: any) => i.fiscalStatus === fiscStatus);
    if (range?.[0] && range?.[1]) r = r.filter((i: any) => dayjs(i.invoiceDate).isAfter(dayjs(range[0])) && dayjs(i.invoiceDate).isBefore(dayjs(range[1]).add(1, 'day')));
    return r;
  }, [list.data, customerId, q, invStatus, payStatus, fiscStatus, range]);

  const totals = useMemo(() => { let total = 0, paid = 0, unpaid = 0, overdue = 0; for (const i of rows) { total += Number(i.total || 0); paid += Number(i.amountPaid || 0); const bal = Number(i.balanceDue != null ? i.balanceDue : (Number(i.total || 0) - Number(i.amountPaid || 0))); unpaid += bal; if (i.invoiceStatus === 'POSTED' && bal > 0 && i.dueDate && dayjs(i.dueDate).isBefore(dayjs(), 'day')) overdue += bal; } return { total, paid, unpaid, overdue, count: rows.length, paidCount: rows.filter((i: any) => i.paymentStatus === 'PAID').length }; }, [rows]);

  async function post(r: any) { try { await api(`/sales/invoices/${r.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST' }) }); message.success('Invoice posted — awaiting payment'); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); qc.invalidateQueries({ queryKey: ['sales-register'] }); } catch (e: any) { message.error(e.message); } }
  async function del(r: any) { try { await api(`/sales/invoices/${r.id}`, { method: 'DELETE' }); message.success('Invoice deleted'); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); qc.invalidateQueries({ queryKey: ['sales-register'] }); } catch (e: any) { message.error(e.message); } }
  async function fiscal(r: any) { const dev = (devices.data || []).find((d: any) => d.status === 'ACTIVE' && d.dayStatus === 'OPEN'); if (!dev) { message.warning('No open fiscal day on an active device'); return; } try { await api(`/fiscalisation/devices/${dev.id}/fiscalise`, { method: 'POST', body: JSON.stringify({ invoiceId: r.id }) }); message.success('Fiscalised'); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); } catch (e: any) { message.error(e.message); } }
  const canFiscal = (r: any) => { const recv = (r.receipts || []).reduce((s: number, x: any) => s + Number(x.amount), 0); return recv >= Number(r.total) - 0.001 && r.fiscalStatus !== 'FISCALISED'; };

  const columns: ColumnsType<any> = [
    { title: 'Invoice #', dataIndex: 'invoiceNo', width: 130, render: (v, r) => <Link href={`/sales/invoices/${r.id}/edit`} className="font-mono text-[12px] font-semibold text-[#003366] hover:text-[#0b4a8f] hover:underline">{v}</Link> },
    ...(hideCustomer ? [] : [{ title: 'Customer', dataIndex: 'customer', render: (_v: any, r: any) => (<span className="flex items-center gap-2.5"><CustomerAvatar name={r.customer?.name} size={28} /><span className="text-[13px] text-[#171a2e]">{r.customer?.name || '—'}</span></span>) } as any]),
    { title: 'Date', dataIndex: 'invoiceDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Due Date', dataIndex: 'dueDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{v ? dayjs(v).format('DD MMM YY') : '—'}</span> },
    { title: 'Amount', dataIndex: 'total', width: 130, align: 'right', render: (v) => <CurrencyValue value={v} /> },
    { title: 'Balance', dataIndex: 'balanceDue', width: 110, align: 'right', render: (v) => <span className={`text-[13px] font-semibold ${Number(v) > 0 ? 'text-[#F97316]' : 'text-[#16A34A]'}`}>{fmtMoney(Number(v || 0))}</span> },
    { title: 'Payment St.', dataIndex: 'paymentStatus', width: 130, render: (v) => <StatusPill status={v} /> },
    { ...ACTIONS_COL, render: (_, r: any) => (
      <RowActionsMenu items={[
        { key: 'view', label: r.invoiceStatus === 'DRAFT' ? 'Edit' : 'View', icon: <EyeOutlined />, onClick: () => router.push(`/sales/invoices/${r.id}/edit`) },
        { key: 'post', label: 'Save & Post', icon: <FileDoneOutlined />, hidden: r.invoiceStatus !== 'DRAFT', onClick: () => post(r) },
        { key: 'fiscal', label: 'Fiscalise', icon: <RobotOutlined />, hidden: !canFiscal(r), onClick: () => fiscal(r) },
        { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, hidden: r.invoiceStatus !== 'DRAFT', confirm: 'Delete invoice?', onClick: () => del(r) },
      ]} />
    ) },
  ];
  const kpis = [{ label: 'Total Invoiced', value: fmtMoney(totals.total), icon: <DollarOutlined />, tone: '#2563eb' }, { label: 'Unpaid', value: fmtMoney(totals.unpaid), icon: <ClockCircleOutlined />, tone: '#f59e0b', valueColor: '#F97316' }, { label: 'Paid', value: fmtMoney(totals.paid), icon: <FileDoneOutlined />, tone: '#16a34a', valueColor: '#16A34A' }, { label: 'Overdue', value: fmtMoney(totals.overdue), icon: <ClockCircleOutlined />, tone: '#dc2626', valueColor: '#EF4444' }];
  const invOpts = ['DRAFT', 'POSTED', 'VOID'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }));
  const payOpts = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }));
  const fiscOpts = ['NOT_REQUIRED', 'READY', 'PENDING', 'FISCALISED', 'RETRY', 'REJECTED'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }));

  return (
    <div className="nex-fade">
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Invoices</h1><p className="text-[13px] text-[#64748b] mt-1">Create, send and track customer invoices</p></div>
          <Link href="/sales/invoices/template"><Button icon={<SettingOutlined />}>Customize Template</Button></Link>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/sales/invoices/new')}>New Invoice</Button>
        </div>
      )}
      {!embedded && <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">{kpis.map((k) => <SummaryCard key={k.label} icon={k.icon} label={k.label} value={k.value} tone={k.tone} valueColor={k.valueColor} />)}</div>}
      <FilterBar extra={<span className="text-[12px] text-[#94a3b8]">{totals.count} invoices · {totals.paidCount} paid</span>}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search by customer or number" className="w-72 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="Inv status" className="!min-w-[120px] !rounded-xl" value={invStatus || undefined} onChange={setInvStatus} options={invOpts} />
        <Select allowClear placeholder="Payment status" className="!min-w-[150px] !rounded-xl" value={payStatus || undefined} onChange={setPayStatus} options={payOpts} />
        <Select allowClear placeholder="Fiscal status" className="!min-w-[140px] !rounded-xl" value={fiscStatus || undefined} onChange={setFiscStatus} options={fiscOpts} />
        <DatePicker.RangePicker className="!rounded-xl" value={range} onChange={setRange} />
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/sales/invoices'] })} />
        <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
        <Button icon={<ExportOutlined />}>Export</Button>
      </FilterBar>
      <div className="nex-card">
        {rows.length === 0 ? <EmptyState title="No invoices yet" description="Create your first invoice to start billing customers." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/sales/invoices/new')}>New Invoice</Button>} /> : (<>
          {sel.length > 0 && (<div className="px-4 py-3 flex items-center gap-3 flex-wrap bg-[#f8faff] border-b border-[#eef0f6]"><span className="text-[13px] font-medium text-[#344054]">{sel.length} selected</span><Button type="primary" icon={<FileDoneOutlined />} loading={busy} onClick={bulkPost}>Save & Post</Button><Button icon={<ExportOutlined />} onClick={exportSel}>Export</Button><Popconfirm title={`Delete ${sel.length} selected invoices?`} onConfirm={bulkDel}><Button danger icon={<DeleteOutlined />} loading={busy}>Delete</Button></Popconfirm><div className="ml-auto"><Button size="small" onClick={() => setSel([])}>Clear</Button></div></div>)}
          <Table rowKey="id" loading={list.isLoading} dataSource={rows} columns={columns} scroll={{ x: true }} rowSelection={{ selectedRowKeys: sel, onChange: (keys) => setSel(keys as string[]) }} pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} invoices` }} />
        </>)}
      </div>
    </div>
  );
}
