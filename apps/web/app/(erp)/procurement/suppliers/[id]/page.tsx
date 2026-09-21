'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { App, Button, Card, Checkbox, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Tooltip, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined, BankOutlined, CheckCircleOutlined, DeleteOutlined, DollarOutlined, DownloadOutlined, EditOutlined, EyeOutlined, FileDoneOutlined, FileTextOutlined, PayCircleOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, RollbackOutlined, SearchOutlined, ShoppingCartOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AccountSelector } from '@/components/account-selector';
import { StatusTag } from '@/components/crud-page';
import { LineItems } from '@/components/line-items';
import { useMeta } from '@/lib/meta';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { MetricStrip } from '@/components/metric-strip';

const METHODS = ['BANK', 'CHEQUE', 'CASH', 'CARD', 'MOBILE', 'OTHER'];
const TERMS = ['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Custom'];
const d = (v: any) => (v ? dayjs(v) : null);
function dueFromTerms(invDate: any, terms?: string) {
  if (!invDate || !terms) return undefined;
  const m = terms.match(/^Net (\d+)$/i);
  if (m) return dayjs(invDate).add(parseInt(m[1], 10), 'day');
  if (/receipt/i.test(terms)) return dayjs(invDate);
  return undefined;
}

export default function SupplierDetail() {
  const { message } = App.useApp();
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['/procurement/suppliers', id], queryFn: () => api(`/procurement/suppliers/${id}`) });
  const [tab, setTab] = useState('overview');
  const [payOpen, setPayOpen] = useState(false);
  const [payBills, setPayBills] = useState<string[]>([]);
  const [invFilter, setInvFilter] = useState('');
  const [invPayStatus, setInvPayStatus] = useState('');
  const [payFilter, setPayFilter] = useState('');
  const [range, setRange] = useState<any>(undefined);
  const [stmtRange, setStmtRange] = useState<any>(undefined);
  const [detailPay, setDetailPay] = useState<any>(null);
  const [billDrawer, setBillDrawer] = useState(false);
  const [poDrawer, setPoDrawer] = useState(false);
  const [prefillBill, setPrefillBill] = useState<any>(null);

  if (isLoading) return <div className="p-8 text-[#8a90ad]">Loading supplier…</div>;
  if (!data) return <Empty description="Supplier not found" />;
  const { supplier, outstanding, purchaseOrders, grns, invoices, payments } = data;
  const outstandingBills = (invoices || []).filter((i: any) => i.status === 'POSTED' && Number(i.balanceDue) > 0);
  const unpaid = (invoices || []).filter((i: any) => i.status === 'POSTED' && ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.paymentStatus) && Number(i.balanceDue) > 0);

  function refresh() { qc.invalidateQueries({ queryKey: ['/procurement/suppliers', id] }); qc.invalidateQueries({ queryKey: ['/procurement/dashboard'] }); }
  function openPay(ids: string[]) { setPayBills(ids); setPayOpen(true); }

  function jumpToBills(statuses?: string[], balOnly?: boolean) {
    setInvFilter(''); setInvPayStatus((statuses || []).join(',')); setTab('invoices');
    if (!statuses) setInvPayStatus('');
  }

  // Tab label helper with counts
  const tabLabel = (t: string, n: number) => `${t}${n ? ` (${n})` : ''}`;

  // ---------- Invoices tab ----------
  let invRows = invoices || [];
  if (invFilter) { const q = invFilter.toLowerCase(); invRows = invRows.filter((i: any) => `${i.invoiceNo} ${i.supplierInvoiceNo || ''} ${i.ref || ''} ${i.memo || ''}`.toLowerCase().includes(q)); }
  if (invPayStatus) { const set = invPayStatus.split(',').filter(Boolean); invRows = invRows.filter((i: any) => set.includes(i.paymentStatus)); }
  const invCols: ColumnsType<any> = [
    { title: 'Bill #', dataIndex: 'invoiceNo', width: 110, render: (v: any) => <span className="font-medium text-[#2563eb]">{v}</span> },
    { title: 'Supplier Inv #', dataIndex: 'supplierInvoiceNo', width: 130 },
    { title: 'Invoice Date', dataIndex: 'invoiceDate', width: 110, render: fmtDate },
    { title: 'Due Date', dataIndex: 'dueDate', width: 110, render: (v: any) => (v ? fmtDate(v) : '—') },
    { title: 'Total', dataIndex: 'total', align: 'right', width: 100, render: (v: any) => fmtMoney(v) },
    { title: 'Paid', dataIndex: 'amountPaid', align: 'right', width: 100, render: (v: any) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Balance', dataIndex: 'balanceDue', align: 'right', width: 110, render: (v: any) => <span className="font-semibold text-[#F97316]">{fmtMoney(v)}</span> },
    { title: 'Payment', dataIndex: 'paymentStatus', width: 130, render: (v: any, r: any) => <span><StatusTag value={v} />{isOverdue(r) && <Tag color="red" style={{ marginLeft: 4 }}>OVERDUE</Tag>}</span> },
    { title: 'Match', dataIndex: 'matchStatus', width: 130, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Status', dataIndex: 'status', width: 100, render: (v: any) => <StatusTag value={v} /> },
    { title: '', width: 170, fixed: 'right', render: (_: any, r: any) => <div className="flex gap-1">{r.status === 'DRAFT' ? <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => { api(`/procurement/supplier-invoices/${r.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST' }) }).then(() => { message.success('Bill posted — awaiting payment'); refresh(); }).catch((e) => message.error(e.message)); }}>Save & Post</Button> : <BillAction bill={r} onPay={() => openPay([r.id])} onOpen={() => setDetailPay({ type: 'bill', id: r.id })} />}{<Tooltip title="Print / PDF"><Link href={`/documents/supplier-invoice/${r.id}`} target="_blank"><Button size="small" icon={<PrinterOutlined />} /></Link></Tooltip>}</div> },
  ];
  function isOverdue(b: any) { return b.status === 'POSTED' && b.dueDate && dayjs(b.dueDate).isBefore(dayjs(), 'day') && Number(b.balanceDue) > 0.005; }

  // ---------- Payments tab ----------
  let payRows = payments || [];
  if (payFilter) { const q = payFilter.toLowerCase(); payRows = payRows.filter((p: any) => `${p.paymentNo} ${p.referenceNo || ''} ${p.payFromAccountName || ''} ${p.method}`.toLowerCase().includes(q)); }
  const payCols: ColumnsType<any> = [
    { title: 'Payment #', dataIndex: 'paymentNo', width: 120, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => setDetailPay({ type: 'payment', id: r.id })}>{v}</a> },
    { title: 'Date', dataIndex: 'paidAt', width: 110, render: fmtDate },
    { title: 'Method', dataIndex: 'method', width: 100 },
    { title: 'Reference', dataIndex: 'referenceNo', render: (v: any) => v || '—' },
    { title: 'Amount', dataIndex: 'amount', align: 'right', width: 110, render: (v: any) => fmtMoney(v) },
    { title: 'Applied', dataIndex: 'applied', align: 'right', width: 100, render: (v: any) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Advance', dataIndex: 'unapplied', align: 'right', width: 100, render: (v: any) => (Number(v) > 0 ? <span className="text-[#8b5cf6]">{fmtMoney(v)}</span> : '—') },
    { title: 'Pay From', dataIndex: 'payFromAccountName', width: 130 },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
    { title: '', width: 90, fixed: 'right', render: (_: any, r: any) => r.status === 'POSTED' ? (<Popconfirm title="Reverse this payment?" onConfirm={() => reversePay(r)}><Button size="small" danger icon={<RollbackOutlined />}>Reverse</Button></Popconfirm>) : null },
  ];

  async function reversePay(p: any) {
    let reason = '';
    Modal.confirm({
      title: `Reverse payment ${p.paymentNo}?`,
      content: <div className="mt-2"><label className="text-[12px] font-medium text-[#566]">Reason *</label><Input onChange={(e) => { reason = e.target.value; }} placeholder="e.g. Wrong amount" /></div>,
      okText: 'Reverse', onOk: async () => {
        if (!reason) { message.error('Reason is required'); throw new Error('reason'); }
        try { await api(`/procurement/supplier-payments/${p.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }); message.success('Payment reversed'); setDetailPay(null); refresh(); } catch (e: any) { message.error(e.message); throw new Error(e.message); }
      },
    });
  }
  async function poAction(action: string, po: any) {
    try {
      if (action === 'approve') { await api(`/procurement/purchase-orders/${po.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'APPROVED' }) }); message.success('Purchase order approved'); }
      else if (action === 'receive') { await api(`/procurement/purchase-orders/${po.id}/receive`, { method: 'POST', body: '{}' }); message.success('Receipt confirmed — stock updated'); }
      else if (action === 'cancel') { await api(`/procurement/purchase-orders/${po.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) }); message.success('Purchase order cancelled'); }
      else if (action === 'bill') { setPrefillBill({ purchaseOrderId: po.id, supplierId: supplier.id }); setBillDrawer(true); return; }
      refresh();
    } catch (e: any) { message.error(e.message); }
  }
  async function grnAction(action: string, g: any) {
    try {
      if (action === 'post') { await api(`/procurement/grns/${g.id}/confirm`, { method: 'POST', body: '{}' }); message.success('Receipt confirmed — stock updated'); }
      else if (action === 'bill') { setPrefillBill({ purchaseOrderId: g.purchaseOrderId, supplierId: g.supplierId }); setBillDrawer(true); return; }
      refresh();
    } catch (e: any) { message.error(e.message); }
  }

  // ---------- Statement ----------
  const stmtRows: any[] = [];
  (invoices || []).filter((i: any) => i.status !== 'DRAFT').forEach((i: any) => stmtRows.push({ key: `inv-${i.id}`, date: i.invoiceDate, type: 'Supplier Bill', doc: i.invoiceNo, docId: i.id, debit: 0, credit: Number(i.total), balance: 0 }));
  (payments || []).forEach((p: any) => stmtRows.push({ key: `pay-${p.id}`, date: p.paidAt, type: 'Supplier Payment', doc: p.paymentNo, docId: p.id, debit: Number(p.amount), credit: 0, balance: 0 }));
  stmtRows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let run = 0; stmtRows.forEach((r) => { run += Number(r.credit) - Number(r.debit); r.balance = run; });
  const stmtFiltered = stmtRange ? stmtRows.filter((r) => { const dd = dayjs(r.date); return !dd.isBefore(stmtRange[0], 'day') && !dd.isAfter(stmtRange[1], 'day'); }) : stmtRows;
  function exportStmt() {
    const head = ['Date', 'Type', 'Document', 'Debit', 'Credit', 'Balance'];
    const rows = stmtFiltered.map((r: any) => [fmtDate(r.date), r.type, r.doc, Number(r.debit), Number(r.credit), Number(r.balance)]);
    const csv = [head.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `supplier-statement-${supplier.code}.csv`; a.click();
  }

  // ---------- Overview ----------
  const overviewItems = [
    { label: 'Supplier Code', value: supplier.code }, { label: 'Supplier Type', value: supplier.vendorType }, { label: 'Status', value: supplier.status },
    { label: 'Contact', value: [supplier.contactName, supplier.jobTitle].filter(Boolean).join(' · ') || '—' },
    { label: 'Email', value: supplier.email }, { label: 'Phone', value: supplier.phone }, { label: 'Mobile', value: supplier.mobile },
    { label: 'Address', value: [supplier.address1, supplier.address2, supplier.city, supplier.country].filter(Boolean).join(', ') },
    { label: 'TIN', value: supplier.tin }, { label: 'VAT', value: supplier.vatRegistered ? supplier.vatNumber || 'VAT registered' : 'Not registered' },
    { label: 'Payment Terms', value: supplier.paymentTerms }, { label: 'Currency', value: supplier.currency },
    { label: 'Credit Limit', value: fmtMoney(supplier.creditLimit) }, { label: 'Website', value: supplier.website },
  ].filter((i) => i.value != null && i.value !== '' && i.value !== '—');

  const tabItems = [
    { key: 'overview', label: 'Overview', children: <OverviewTab supplier={supplier} /> },
    { key: 'orders', label: tabLabel('Purchase Orders', purchaseOrders.length), children: <OrdersTab rows={purchaseOrders} onAction={poAction} onNew={() => setPoDrawer(true)} /> },
    { key: 'grns', label: tabLabel('GRNs', grns.length), children: <GrnsTab rows={grns} onAction={grnAction} /> },
    { key: 'invoices', label: tabLabel('Supplier Invoices', invoices.length), children: (
      <div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search bills…" className="w-56 !rounded-xl" value={invFilter} onChange={(e) => setInvFilter(e.target.value)} />
          <Select allowClear placeholder="Payment Status" className="!min-w-[150px]" value={invPayStatus || undefined} onChange={(v) => setInvPayStatus(v || '')} options={['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
          <div className="ml-auto"><Space><Button icon={<PlusOutlined />} onClick={() => { setPrefillBill(null); setBillDrawer(true); }}>New Bill</Button><Button type="primary" icon={<PayCircleOutlined />} onClick={() => openPay(unpaid.map((i: any) => i.id))}>Pay Selected</Button></Space></div>
        </div>
        <Table rowKey="id" dataSource={invRows} columns={invCols} scroll={{ x: true }} pagination={{ pageSize: 8, showSizeChanger: false }} />
      </div>
    ) },
    { key: 'payments', label: tabLabel('Payments', payments.length), children: (
      <div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search payments…" className="w-56 !rounded-xl" value={payFilter} onChange={(e) => setPayFilter(e.target.value)} />
          <DatePicker.RangePicker className="!rounded-xl" value={range} onChange={setRange} />
          <div className="ml-auto"><Button icon={<PlusOutlined />} onClick={() => openPay([])}>New Payment</Button></div>
        </div>
        <Table rowKey="id" dataSource={payRows} columns={payCols} scroll={{ x: true }} pagination={{ pageSize: 8, showSizeChanger: false }} />
      </div>
    ) },
    { key: 'statement', label: 'Statement', children: (
      <div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <DatePicker.RangePicker className="!rounded-xl" value={stmtRange} onChange={setStmtRange} />
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button><Button icon={<FileTextOutlined />} onClick={exportStmt}>Export CSV</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        </div>
        <Table rowKey="key" dataSource={stmtFiltered} pagination={false} size="small" columns={[{ title: 'Date', dataIndex: 'date', render: fmtDate }, { title: 'Type', dataIndex: 'type', width: 150 }, { title: 'Document', dataIndex: 'doc', width: 130, render: (v: any, r: any) => <a className="hover:underline cursor-pointer text-[#2563eb]" onClick={() => { if (r.type.includes('Payment')) setDetailPay({ type: 'payment', id: r.docId }); else setDetailPay({ type: 'bill', id: r.docId }); }}>{v}</a> }, { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Credit', dataIndex: 'credit', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Balance', dataIndex: 'balance', align: 'right', render: (v: any) => <span className="font-semibold">{fmtMoney(v)}</span> }]} />
      </div>
    ) },
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Button shape="circle" icon={<ArrowLeftOutlined />} onClick={() => router.back()} />
          <div>
            <div className="flex items-center gap-2"><h1 className="text-[24px] font-bold text-[#171a2e]">{supplier.name}</h1><Tag style={{ borderRadius: 8 }}>{supplier.code}</Tag><StatusTag value={supplier.status} /></div>
            <div className="text-[13px] text-[#64748b]">{supplier.vendorType || 'Supplier'} · {supplier.currency}{supplier.paymentTerms ? ` · ${supplier.paymentTerms}` : ''}</div>
          </div>
        </div>
        <Space wrap>
          {Number(outstanding) > 0 && <Button type="primary" icon={<PayCircleOutlined />} onClick={() => openPay(outstandingBills.map((b: any) => b.id))}>Pay Supplier</Button>}
          <Button icon={<ShoppingCartOutlined />} onClick={() => setPoDrawer(true)}>+ Purchase Order</Button>
          <Button icon={<EditOutlined />} onClick={() => router.push('/procurement')}>Edit</Button>
        </Space>
      </div>

      <MetricStrip
        className="mb-5"
        items={[
          { label: 'Outstanding AP', value: fmtMoney(outstanding), color: '#F97316', onClick: () => jumpToBills(['UNPAID', 'PARTIALLY_PAID', 'OVERDUE']) },
          { label: 'Open Bills', value: unpaid.length, color: '#2563eb', onClick: () => { setInvFilter(''); setInvPayStatus(''); setTab('invoices'); } },
          { label: 'Purchase Orders', value: purchaseOrders.length, color: '#003366', onClick: () => setTab('orders') },
          { label: 'Total Payments', value: fmtMoney(payments.reduce((s: number, p: any) => s + Number(p.amount), 0)), color: '#10b981', onClick: () => setTab('payments') },
        ]}
      />

      <Card className="nex-card" styles={{ body: { padding: '14px 20px' } }}><Tabs items={tabItems} activeKey={tab} onChange={setTab} destroyOnHidden /></Card>

      <PaySupplierDrawer open={payOpen} onClose={() => setPayOpen(false)} supplier={supplier} initialBills={payBills} bills={unpaid} onSaved={refresh} />
      <BillDrawer open={billDrawer} onClose={() => setBillDrawer(false)} supplier={supplier} prefill={prefillBill} onSaved={() => { setBillDrawer(false); refresh(); }} />
      <OrderDrawer open={poDrawer} onClose={() => setPoDrawer(false)} supplier={supplier} onSaved={() => { setPoDrawer(false); refresh(); }} />

      {detailPay?.type === 'bill' && <BillDetail bill={invoices.find((i: any) => i.id === detailPay.id)} onClose={() => setDetailPay(null)} onPay={() => { openPay([detailPay.id]); setDetailPay(null); }} />}
      {detailPay?.type === 'payment' && <PaymentDetail payment={payments.find((p: any) => p.id === detailPay.id)} onClose={() => setDetailPay(null)} onReverse={() => reversePay(payments.find((p: any) => p.id === detailPay.id))} />}
    </div>
  );
}

function isOverdue(b: any) { return b.status === 'POSTED' && b.dueDate && dayjs(b.dueDate).isBefore(dayjs(), 'day') && Number(b.balanceDue) > 0.005; }

function BillAction({ bill, onPay, onOpen }: { bill: any; onPay: () => void; onOpen: () => void }) {
  if (bill.status !== 'POSTED') return <Button size="small" onClick={onOpen}>Open</Button>;
  if (Number(bill.balanceDue) <= 0.005) return <Button size="small" onClick={onOpen}>View</Button>;
  const label = isOverdue(bill) ? 'Pay Now' : Number(bill.amountPaid) > 0.005 ? 'Pay Balance' : 'Pay Bill';
  return <Button size="small" type="primary" icon={<PayCircleOutlined />} onClick={onPay}>{label}</Button>;
}

function PaySupplierDrawer({ open, onClose, supplier, initialBills, bills, onSaved }: { open: boolean; onClose: () => void; supplier: any; initialBills: string[]; bills: any[]; onSaved: () => void }) {
  const { message } = App.useApp();
  const [method, setMethod] = useState('BANK');
  const [payFrom, setPayFrom] = useState<string>();
  const [date, setDate] = useState<any>(dayjs());
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [applyMap, setApplyMap] = useState<Record<string, number>>({});
  const [advance, setAdvance] = useState(0);
  const [saving, setSaving] = useState(false);

  const billsTotal = bills.map((b: any) => ({ ...b, balance: Number(b.balanceDue) })).sort((a, b) => new Date(b.dueDate || b.invoiceDate).getTime() - new Date(a.dueDate || a.invoiceDate).getTime());
  const applied = Object.values(applyMap).reduce((s, v) => s + Number(v || 0), 0);
  const amount = Number(applied) + Number(advance || 0);

  function init() {
    setDate(dayjs()); setMethod('BANK'); setPayFrom(undefined); setReference(''); setMemo(''); setAdvance(0);
    const map: Record<string, number> = {};
    billsTotal.forEach((b: any) => { if (initialBills.includes(b.id)) map[b.id] = Number(b.balance); });
    if (!initialBills.length && billsTotal.length) { billsTotal.forEach((b: any) => { map[b.id] = Number(b.balance); }); }
    setApplyMap(map);
  }
  useEffect(() => { if (open) init(); }, [open]); // eslint-disable-line

  function toggle(id: string, balance: number) {
    setApplyMap((m) => { const n = { ...m }; if (n[id] != null && n[id] > 0) { delete n[id]; } else { n[id] = Number(balance); } return n; });
  }
  function setApply(id: string, v: number | null) { setApplyMap((m) => ({ ...m, [id]: !v || v <= 0 ? 0 : Number(v) })); }

  async function post() {
    if (!(amount > 0)) { message.error('Enter a payment amount or select bills to apply'); return; }
    setSaving(true);
    try {
      const allocations = Object.entries(applyMap).filter(([, v]) => Number(v) > 0).map(([billId, v]) => ({ supplierInvoiceId: billId, amount: Number(v) }));
      await api('/procurement/supplier-payments', { method: 'POST', body: JSON.stringify({ supplierId: supplier.id, amount, method, referenceNo: reference, note: memo, payFromAccountId: payFrom, paidAt: date.format('YYYY-MM-DD'), allocations }) });
      message.success('Payment posted'); onClose(); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} width={680} title="Pay Supplier" destroyOnHidden
      extra={<Button onClick={onClose}>Cancel</Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={post} loading={saving}>Make Payment</Button></Space>}>
      <div className="nex-card mb-4 px-4 py-3 !rounded-xl"><div className="flex items-center gap-2"><span className="text-[12px] text-[#64748b]">Supplier</span><span className="font-semibold text-[14px] text-[#171a2e]">{supplier.name}</span><Tag style={{ borderRadius: 8 }}>{supplier.code}</Tag></div></div>
      <Form layout="vertical">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Payment Date *" required><DatePicker className="w-full" value={date} onChange={setDate} allowClear={false} /></Form.Item>
          <Form.Item label="Payment Method *" required><Select value={method} onChange={setMethod} options={METHODS.map((m) => ({ label: m.replace(/_/g, ' '), value: m }))} /></Form.Item>
        </div>
        <Form.Item label="Pay From *" required><AccountSelector allowedTypes={['BANK', 'CASH']} value={payFrom} onChange={setPayFrom} placeholder="Select bank / cash account" /></Form.Item>
        <Form.Item label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'CHEQUE' ? 'Check number' : 'Transaction reference / EFT'}/></Form.Item>
        <Form.Item label="Memo"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-bold text-[#171a2e]">Outstanding Bills</span>
        <Space><Button size="small" onClick={() => { const m: Record<string, number> = {}; billsTotal.forEach((b) => (m[b.id] = Number(b.balance))); setApplyMap(m); }}>Auto Apply</Button><Button size="small" onClick={() => setApplyMap({})}>Clear</Button></Space>
      </div>
      {billsTotal.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No outstanding bills to apply" />}
      {billsTotal.map((b: any) => {
        const checked = (applyMap[b.id] || 0) > 0;
        return (
          <div key={b.id} className="rounded-xl border border-[#eef0f6] p-3 mb-2 flex items-center gap-3" style={{ background: checked ? '#f8f9ff' : '#fff' }}>
            <Checkbox checked={checked} onChange={() => toggle(b.id, b.balance)} />
            <div className="flex-1 min-w-0"><span className="font-medium text-[13px] text-[#171a2e]">{b.invoiceNo}</span>{b.dueDate ? <span className="text-[11px] text-[#8a90ad] ml-2"><BankOutlined /> due {fmtDate(b.dueDate)}{isOverdue(b) ? ' · OVERDUE' : ''}</span> : null}</div>
            <span className="text-[12px] text-[#8a90ad]">Balance</span>
            <span className="font-bold text-[13px] text-[#F97316] w-20 text-right">{fmtMoney(b.balance)}</span>
            <InputNumber className="!w-22" prefix="$" min={0} max={Number(b.balance)} value={applyMap[b.id]} disabled={!checked} onChange={(v) => setApply(b.id, v)} placeholder="Apply" />
          </div>
        );
      })}
      <div className="nex-card mt-4 px-4 py-3 !rounded-xl">
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Payment Amount</span><span className="text-[13px] font-semibold text-[#171a2e] tabular-nums">{fmtMoney(amount)}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Total Applied</span><span className="text-[14px] font-semibold text-[#16a34a]">{fmtMoney(applied)}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Unapplied / Advance</span><span className="text-[14px] font-semibold text-[#8b5cf6]">{fmtMoney(Number(advance))}</span></div>
        <div className="flex items-center justify-between py-1 pt-2 border-t border-[#eef0f6]"><span className="text-[12px] text-[#64748b]">Add to Advance</span><InputNumber className="!w-32" prefix="$" min={0} value={advance} onChange={(v) => setAdvance(v || 0)} /></div>
      </div>
    </Drawer>
  );
}

function BillDetail({ bill, onClose, onPay }: { bill?: any; onClose: () => void; onPay: () => void }) {
  if (!bill) return null;
  const payable = bill.status === 'POSTED' && Number(bill.balanceDue) > 0.005;
  return (
    <Modal open onCancel={onClose} title={`Bill ${bill.invoiceNo}`} footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Close</Button>{payable && <Button type="primary" icon={<PayCircleOutlined />} onClick={onPay}>{Number(bill.amountPaid) > 0.005 ? 'Pay Balance' : 'Pay Bill'}</Button>}</div>}>
      <Descriptions column={2} size="small" bordered items={[{ label: 'Bill #', children: bill.invoiceNo }, { label: 'Supplier Inv #', children: bill.supplierInvoiceNo || '—' }, { label: 'Invoice Date', children: fmtDate(bill.invoiceDate) }, { label: 'Due Date', children: bill.dueDate ? fmtDate(bill.dueDate) : '—' }, { label: 'Total', children: fmtMoney(bill.total) }, { label: 'Paid', children: <span className="text-[#16a34a]">{fmtMoney(bill.amountPaid)}</span> }, { label: 'Balance', children: <span className="text-[#F97316] font-semibold">{fmtMoney(bill.balanceDue)}</span> }, { label: 'Payment Status', children: <StatusTag value={bill.paymentStatus} /> }]} />
      {isOverdue(bill) && <Tag color="red" className="mt-3">OVERDUE</Tag>}
    </Modal>
  );
}

function PaymentDetail({ payment, onClose, onReverse }: { payment?: any; onClose: () => void; onReverse: () => void }) {
  if (!payment) return null;
  const allocs = payment.allocations || [];
  return (
    <Modal open onCancel={onClose} width={640} title={`Payment ${payment.paymentNo}`} footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Close</Button><a href="/finance/journals" target="_blank"><Button icon={<FileTextOutlined />}>Journal</Button></a><a href="/finance/cash-bank" target="_blank"><Button icon={<BankOutlined />}>Bank Transaction</Button></a>{payment.status === 'POSTED' && <Button danger icon={<RollbackOutlined />} onClick={onReverse}>Reverse Payment</Button>}</div>}>
      <Descriptions column={2} size="small" bordered items={[{ label: 'Payment #', children: payment.paymentNo }, { label: 'Supplier', children: payment.supplier?.name || '—' }, { label: 'Date', children: fmtDate(payment.paidAt) }, { label: 'Amount', children: fmtMoney(payment.amount) }, { label: 'Method', children: payment.method }, { label: 'Reference', children: payment.referenceNo || '—' }, { label: 'Pay From', children: `${payment.payFromAccountName || payment.payFromAccountCode || '—'}` }, { label: 'Status', children: <StatusTag value={payment.status} /> }]} />
      <div className="mt-4 text-[13px] font-bold text-[#171a2e]">Applied To</div>
      <Table size="small" rowKey="id" dataSource={allocs} pagination={false} columns={[{ title: 'Bill', render: (_: any, a: any) => <span className="text-[#2563eb]">{a.supplierInvoice?.invoiceNo}</span> }, { title: 'Original', render: (_: any, a: any) => fmtMoney(a.supplierInvoice?.total) }, { title: 'Applied', render: (_: any, a: any) => <span className="text-[#16a34a]">{fmtMoney(a.amountApplied)}</span> }, { title: 'Balance After', render: (_: any, a: any) => <span className="text-[#F97316]">{fmtMoney(a.supplierInvoice?.balanceDue)}</span> }]} />
      {Number(payment.unapplied) > 0 && <div className="mt-3 text-[13px]"><span className="text-[#8a90ad]">Unapplied / Advance:</span> <span className="font-semibold text-[#8b5cf6]">{fmtMoney(payment.unapplied)}</span></div>}
    </Modal>
  );
}

function OverviewTab({ supplier }: { supplier: any }) {
  const items = [
    { label: 'Supplier Code', value: supplier.code }, { label: 'Status', value: supplier.status }, { label: 'Supplier Type', value: supplier.vendorType },
    { label: 'Contact', value: [supplier.contactName, supplier.jobTitle].filter(Boolean).join(' · ') || '—' },
    { label: 'Email', value: supplier.email }, { label: 'Phone', value: supplier.phone },
    { label: 'Address', value: [supplier.address1, supplier.address2, supplier.city, supplier.country].filter(Boolean).join(', ') },
    { label: 'TIN', value: supplier.tin }, { label: 'VAT', value: supplier.vatRegistered ? supplier.vatNumber || 'Yes' : 'No' },
    { label: 'Payment Terms', value: supplier.paymentTerms }, { label: 'Currency', value: supplier.currency },
    { label: 'Credit Limit', value: fmtMoney(supplier.creditLimit) }, { label: 'Preferred', value: supplier.preferred ? 'Yes' : 'No' }, { label: 'Website', value: supplier.website },
  ].filter((i) => i.value != null && i.value !== '' && i.value !== '—');
  return <Descriptions column={2} size="small" bordered items={items.map((v) => ({ key: v.label, label: v.label, children: <span className="text-[13px]">{v.value}</span> }))} />;
}

function OrdersTab({ rows, onAction, onNew }: { rows: any[]; onAction: (a: string, r: any) => void; onNew: () => void }) {
  const cols: ColumnsType<any> = [
    { title: 'PO #', dataIndex: 'poNo', width: 110, render: (v: any, r: any) => <a href={`/documents/purchase-order/${r.id}`} target="_blank" className="text-[#2563eb] hover:underline">{v}</a> },
    { title: 'Date', dataIndex: 'orderDate', width: 100, render: fmtDate },
    { title: 'Expected', dataIndex: 'expectedDate', width: 100, render: (v: any) => (v ? fmtDate(v) : '—') },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Receipt', dataIndex: 'receiptStatus', width: 130, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Billing', dataIndex: 'billingStatus', width: 130, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Total', dataIndex: 'total', align: 'right', render: (v: any) => fmtMoney(v) },
    { ...ACTIONS_COL, render: (_: any, r: any) => (
      <RowActionsMenu items={[
        { key: 'approve', label: 'Approve', icon: <CheckCircleOutlined />, hidden: r.status !== 'DRAFT', onClick: () => onAction('approve', r) },
        { key: 'receive', label: 'Receive Items', icon: <CheckCircleOutlined />, hidden: !['APPROVED', 'PART_RECEIVED'].includes(r.status), onClick: () => onAction('receive', r) },
        { key: 'bill', label: 'Create Bill', icon: <FileDoneOutlined />, onClick: () => onAction('bill', r) },
        { key: 'print', label: 'Print / PDF', icon: <PrinterOutlined />, onClick: () => window.open(`/documents/purchase-order/${r.id}`, '_blank') },
        { key: 'cancel', label: 'Cancel', icon: <DeleteOutlined />, danger: true, hidden: !['DRAFT', 'APPROVED'].includes(r.status), onClick: () => onAction('cancel', r) },
      ]} />
    ) },
  ];
  return (
    <div>
      <div className="flex justify-end mb-3"><Button icon={<PlusOutlined />} onClick={onNew}>+ Purchase Order</Button></div>
      <Table rowKey="id" dataSource={rows} columns={cols} pagination={false} size="small" scroll={{ x: true }} />
    </div>
  );
}

function GrnsTab({ rows, onAction }: { rows: any[]; onAction: (a: string, r: any) => void }) {
  const cols: ColumnsType<any> = [
    { title: 'GRN', dataIndex: 'grnNo', width: 110, render: (v: any) => <span className="font-medium">{v}</span> },
    { title: 'Date', dataIndex: 'receivedAt', width: 110, render: fmtDate },
    { title: 'PO', render: (_: any, r: any) => r.purchaseOrder?.poNo || '—' },
    { title: 'Warehouse', render: (_: any, r: any) => r.warehouse?.name || '—' },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Lines', render: (_: any, r: any) => r.lines?.length || 0 },
    { ...ACTIONS_COL, render: (_: any, r: any) => (
      <RowActionsMenu items={[
        { key: 'confirm', label: 'Confirm Receipt', icon: <CheckCircleOutlined />, hidden: r.status !== 'DRAFT', onClick: () => onAction('post', r) },
        { key: 'bill', label: 'Create Bill', icon: <FileDoneOutlined />, hidden: !r.purchaseOrderId, onClick: () => onAction('bill', r) },
      ]} />
    ) },
  ];
  return <Table rowKey="id" dataSource={rows} columns={cols} pagination={false} size="small" scroll={{ x: true }} />;
}

function BillDrawer({ open, onClose, supplier, prefill, onSaved }: { open: boolean; onClose: () => void; supplier: any; prefill: any; onSaved: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const projects = useQuery({ queryKey: ['/projects'], queryFn: () => api('/projects') });
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [supplierInvNo, setSupplierInvNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<any>(dayjs());
  const [terms, setTerms] = useState<string>(supplier.paymentTerms || 'Net 30');
  const [dueDate, setDueDate] = useState<any>(undefined);
  const [currency, setCurrency] = useState(supplier.currency || 'USD');
  const [memo, setMemo] = useState('');
  const [ref, setRef] = useState('');
  const [projectId, setProjectId] = useState('');
  const [attachment, setAttachment] = useState<any>(null);
  useEffect(() => {
    if (!open) return;
    // Form mounts with the drawer; reset on next tick after connect.
    const t = window.setTimeout(() => {
      form.resetFields();
      setSupplierInvNo(''); setInvoiceDate(dayjs()); setTerms(supplier.paymentTerms || 'Net 30'); setCurrency(supplier.currency || 'USD'); setMemo(''); setRef(''); setProjectId(''); setAttachment(null);
      if (!dueFromTerms(dayjs(), supplier.paymentTerms || 'Net 30')) setDueDate(undefined); else setDueDate(dueFromTerms(dayjs(), supplier.paymentTerms || 'Net 30'));
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]); // eslint-disable-line
  useEffect(() => {
    if (terms === 'Custom') { setDueDate(undefined); return; }
    const nd = dueFromTerms(invoiceDate, terms); setDueDate(nd);
  }, [terms, invoiceDate]); // eslint-disable-line
  const itemOptions = meta.data?.items || [];
  const projectOptions = (projects.data || []).map((p: any) => ({ label: `${p.projectCode || p.code || ''} ${p.name}`, value: p.id }));
  async function submit() {
    const v = await form.validateFields().catch(() => null);
    if (!v?.lines?.length) { message.error('Add at least one line'); return; }
    setSaving(true);
    try {
      const body = { supplierId: supplier.id, invoiceNo: supplierInvNo || undefined, invoiceDate: invoiceDate.format('YYYY-MM-DD'), dueDate: dueDate ? dueDate.format('YYYY-MM-DD') : undefined, terms, currency, ref, memo, projectId: projectId || undefined, purchaseOrderId: prefill?.purchaseOrderId, lines: (v.lines || []).map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate || 0, accountId: l.accountId })) };
      const bill = await api('/procurement/supplier-invoices', { method: 'POST', body: JSON.stringify(body) });
      if (attachment) { await api(`/procurement/supplier-invoices/${bill.id}/attachments`, { method: 'POST', body: JSON.stringify({ name: attachment.name, mime: attachment.mime, size: attachment.size, dataUrl: attachment.dataUrl }) }); }
      message.success('Supplier bill created'); onSaved(); qc.invalidateQueries({ queryKey: ['/procurement/supplier-invoices'] });
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={720} title="Enter Bill" forceRender destroyOnHidden={false} extra={<Button onClick={onClose}>Cancel</Button>} footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit} loading={saving}>Save Bill</Button></Space>}>
      <div className="nex-card mb-4 px-4 py-3 !rounded-xl"><span className="text-[12px] text-[#64748b]">Supplier</span><span className="font-semibold text-[14px] text-[#171a2e] ml-2">{supplier.name}</span>{prefill?.purchaseOrderId ? <span className="ml-2 text-[12px] text-[#8a90ad]">from PO</span> : null}</div>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Supplier Invoice #"><Input value={supplierInvNo} onChange={(e) => setSupplierInvNo(e.target.value)} placeholder="e.g. INV-12345" /></Form.Item>
          <Form.Item label="Invoice Date *" required><DatePicker className="w-full" value={invoiceDate} onChange={setInvoiceDate} allowClear={false} /></Form.Item>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Terms *" required><Select value={terms} onChange={setTerms} options={TERMS.map((t) => ({ label: t, value: t }))} /></Form.Item>
          <Form.Item label={terms === 'Custom' ? 'Due Date (manual)' : 'Due Date'} required={terms === 'Custom'}><DatePicker className="w-full" value={dueDate} onChange={setDueDate} disabled={terms !== 'Custom'} /></Form.Item>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Currency" required><Select value={currency} onChange={setCurrency} options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item>
          <Form.Item label="Project"><Select allowClear showSearch optionFilterProp="label" value={projectId || undefined} onChange={setProjectId} options={projectOptions} placeholder="Optional" /></Form.Item>
        </div>
        <Form.Item label="Reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Form.Item>
        <Form.Item label="Bill Lines" required><LineItems form={form} lines="lines" items={itemOptions} account priceKey="purchaseCost" /></Form.Item>
        <div className="mb-4">
          <div className="text-[12px] font-medium text-[#566] mb-1">Attachment (Vendor Invoice File)</div>
          {attachment ? (
            <div className="rounded-xl border border-[#eef0f6] p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#0033660f] text-[#003366]"><FileTextOutlined /></div>
              <div className="flex-1 min-w-0"><div className="font-medium text-[13px] text-[#171a2e] truncate">{attachment.name}</div><div className="text-[11px] text-[#8a90ad]">{attachment.size ? `${(attachment.size / 1024).toFixed(0)} KB` : ''} · {attachment.mime}</div></div>
              <Space size={2}><Tooltip title="Preview"><Button size="small" icon={<EyeOutlined />} onClick={() => window.open(attachment.dataUrl, '_blank')} /></Tooltip><Tooltip title="Download"><Button size="small" icon={<DownloadOutlined />} onClick={() => { const a = document.createElement('a'); a.href = attachment.dataUrl; a.download = attachment.name; a.click(); }} /></Tooltip><Tooltip title="Remove"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => setAttachment(null)} /></Tooltip></Space>
            </div>
          ) : (
            <Upload.Dragger beforeUpload={(file) => {
              const reader = new FileReader();
              reader.onload = () => setAttachment({ name: file.name, mime: file.type, size: file.size, dataUrl: String(reader.result) });
              reader.readAsDataURL(file);
              return false;
            }} showUploadList={false} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" className="!rounded-xl">
              <p className="text-[13px] text-[#64748b] mb-0"><FileTextOutlined className="mr-1" />Drag vendor invoice here or click to browse</p>
              <p className="text-[11px] text-[#a1a6c0] mb-0">PDF, JPG, PNG, DOC, XLS</p>
            </Upload.Dragger>
          )}
        </div>
        <Form.Item label="Internal Memo"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function OrderDrawer({ open, onClose, supplier, onSaved }: { open: boolean; onClose: () => void; supplier: any; onSaved: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [orderDate, setOrderDate] = useState<any>(dayjs());
  const [expectedDate, setExpectedDate] = useState<any>(dayjs().add(7, 'day'));
  const [currency, setCurrency] = useState(supplier.currency || 'USD');
  const [memo, setMemo] = useState('');
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      form.resetFields();
      setOrderDate(dayjs()); setExpectedDate(dayjs().add(7, 'day')); setCurrency(supplier.currency || 'USD'); setMemo('');
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]); // eslint-disable-line
  const itemOptions = meta.data?.items || [];
  async function submit() {
    const v = await form.validateFields().catch(() => null);
    if (!v?.lines?.length) { message.error('Add at least one line'); return; }
    setSaving(true);
    try {
      const body = { supplierId: supplier.id, orderDate: orderDate.format('YYYY-MM-DD'), expectedDate: expectedDate ? expectedDate.format('YYYY-MM-DD') : undefined, currency, memo, lines: (v.lines || []).map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate || 0 })) };
      await api('/procurement/purchase-orders', { method: 'POST', body: JSON.stringify(body) });
      message.success('Purchase order created'); onSaved(); qc.invalidateQueries({ queryKey: ['/procurement/purchase-orders'] });
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={680} title="New Purchase Order" forceRender destroyOnHidden={false} extra={<Button onClick={onClose}>Cancel</Button>} footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit} loading={saving}>Save Purchase Order</Button></Space>}>
      <div className="nex-card mb-4 px-4 py-3 !rounded-xl"><span className="text-[12px] text-[#64748b]">Supplier</span><span className="font-semibold text-[14px] text-[#171a2e] ml-2">{supplier.name}</span></div>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-3 gap-4">
          <Form.Item label="Order Date *" required><DatePicker className="w-full" value={orderDate} onChange={setOrderDate} allowClear={false} /></Form.Item>
          <Form.Item label="Expected Delivery"><DatePicker className="w-full" value={expectedDate} onChange={setExpectedDate} /></Form.Item>
          <Form.Item label="Currency" required><Select value={currency} onChange={setCurrency} options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item>
        </div>
        <Form.Item label="Lines" required><LineItems form={form} lines="lines" items={itemOptions} priceKey="purchaseCost" /></Form.Item>
        <Form.Item label="Internal Memo"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
    </Drawer>
  );
}

