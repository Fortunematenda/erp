'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Descriptions, Drawer, Dropdown, Input, Select, Space, Table, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, DollarOutlined, EditOutlined, EyeOutlined, FileTextOutlined, MoreOutlined, PayCircleOutlined, SearchOutlined, ShopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { StatusTag } from '@/components/crud-page';
import { useMeta } from '@/lib/meta';
import { StatCard } from '@/components/stat-card';
import { PaySupplierDrawer } from '@/components/pay-supplier-drawer';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const DOC_STATUS = ['DRAFT', 'POSTED', 'VOID'];
const PAY_STATUS = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
const DUE_STATUS = ['OVERDUE', 'DUE_TODAY', 'DUE_THIS_WEEK', 'DUE_THIS_MONTH', 'NOT_YET_DUE'];
const arr = (v: any) => (Array.isArray(v) ? v : []);
const PAY_TONE: Record<string, string> = { UNPAID: 'orange', PARTIALLY_PAID: 'amber', PAID: 'green', OVERDUE: 'red' };
const DOC_TONE: Record<string, string> = { POSTED: 'green', DRAFT: 'default', VOID: 'red' };

export function BillManagementList({ onOpenBill, onGoPay }: { onOpenBill?: (id: string) => void; onGoPay?: () => void }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const dash = useQuery({ queryKey: ['/procurement/dashboard'], queryFn: () => api('/procurement/dashboard') });
  const [q, setQ] = useState(''); const [vendorId, setVendorId] = useState(''); const [payStatus, setPayStatus] = useState(''); const [docStatus, setDocStatus] = useState(''); const [dueStatus, setDueStatus] = useState('');
  const [billRange, setBillRange] = useState<any>(undefined); const [dueRange, setDueRange] = useState<any>(undefined);
  const [sortBy, setSortBy] = useState('invoiceDate'); const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25);
  const [payBill, setPayBill] = useState<string[]>([]); const [payOpen, setPayOpen] = useState(false);
  const [paymentsBill, setPaymentsBill] = useState<any>(null);
  const vendors = meta.data?.suppliers || [];

  const list = useQuery({ queryKey: ['/procurement/bills', 'm', q, vendorId, payStatus, docStatus, dueStatus, billRange, dueRange, sortBy, sortDir, page, pageSize], queryFn: () => {
    const p = new URLSearchParams(); if (q) p.set('q', q); if (vendorId) p.set('vendorId', vendorId); if (payStatus) p.set('paymentStatus', payStatus); if (docStatus) p.set('documentStatus', docStatus); if (dueStatus) p.set('dueStatus', dueStatus);
    if (billRange) { p.set('billDateFrom', billRange[0].format('YYYY-MM-DD')); p.set('billDateTo', billRange[1].format('YYYY-MM-DD')); } if (dueRange) { p.set('dueDateFrom', dueRange[0].format('YYYY-MM-DD')); p.set('dueDateTo', dueRange[1].format('YYYY-MM-DD')); }
    p.set('sortBy', sortBy); p.set('sortDirection', sortDir); p.set('page', String(page)); p.set('pageSize', String(pageSize));
    return api(`/procurement/bills?${p.toString()}`); } });
  const data = list.data || { rows: [], total: 0 };
  function refresh() { qc.invalidateQueries({ queryKey: ['/procurement/bills'] }); qc.invalidateQueries({ queryKey: ['/procurement/dashboard'] }); }
  function clear() { setQ(''); setVendorId(''); setPayStatus(''); setDocStatus(''); setDueStatus(''); setBillRange(undefined); setDueRange(undefined); setPage(1); setSortBy('invoiceDate'); setSortDir('desc'); }
  function onTableChange(pg: any, _f: any, s: any) { setPage(pg.current || 1); setPageSize(pg.pageSize || 25); if (s?.field) { setSortBy(s.field); setSortDir(s.order === 'ascend' ? 'asc' : 'desc'); } }
  const openBill = (id: string) => { if (onOpenBill) onOpenBill(id); };
  const weekDue = arr(data.rows).filter((r: any) => r.dueDate && Number(r.remaining) > 0 && dayjs(r.dueDate).isBefore(dayjs().add(7, 'day')) && !dayjs(r.dueDate).isBefore(dayjs(), 'day')).reduce((s: number, r: any) => s + Number(r.remaining), 0);

  const cols: ColumnsType<any> = [
    { title: 'Bill #', dataIndex: 'invoiceNo', sorter: true, width: 120, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => openBill(r.id)}>{v}</a> },
    { title: 'Vendor', sorter: true, render: (_: any, r: any) => r.supplier?.name || '—' },
    { title: 'Bill Date', dataIndex: 'invoiceDate', sorter: true, width: 105, render: fmtDate },
    { title: 'Due Date', dataIndex: 'dueDate', sorter: true, width: 105, render: (v: any, r: any) => <span>{v ? fmtDate(v) : '—'}{r.dueStatus === 'OVERDUE' ? ' <span className="text-red-600 font-semibold">· OD</span>' : ''}</span> },
    { title: 'Amount', dataIndex: 'total', align: 'right', sorter: true, render: (v: any) => fmtMoney(v) },
    { title: 'Paid', dataIndex: 'paid', align: 'right', sorter: true, render: (v: any) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Remaining', dataIndex: 'remaining', align: 'right', sorter: true, render: (v: any) => <span className={`font-semibold ${Number(v) > 0 ? 'text-[#F97316]' : 'text-[#16a34a]'}`}>{fmtMoney(v)}</span> },
    { title: <Tooltip title="Settlement position based on payments and credits applied."><span>Payment Status</span></Tooltip>, dataIndex: 'paymentStatus', width: 140, sorter: true, render: (v: any) => (v === 'NOT_POSTED' ? <span className="text-[#a1a6c0]">—</span> : <StatusTag value={v} colorMap={PAY_TONE} />) },
    { title: 'Payments', dataIndex: 'paymentCount', width: 105, render: (c: any, r: any) => c > 0 ? <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => setPaymentsBill(r)}>{c} {c === 1 ? 'payment' : 'payments'}</a> : <span className="text-[#a1a6c0]">—</span> },
    { title: <Tooltip title="Accounting lifecycle of the supplier Bill."><span>Document Status</span></Tooltip>, dataIndex: 'documentStatus', width: 130, sorter: true, render: (v: any) => <StatusTag value={v} colorMap={DOC_TONE} /> },
    { ...ACTIONS_COL, render: (_: any, r: any) => <RowActions bill={r} onOpen={() => openBill(r.id)} onPay={() => { setPayBill([r.id]); setPayOpen(true); }} /> },
  ];

  const kpis = [
    { icon: <DollarOutlined />, label: 'Total Outstanding', value: fmtMoney(dash.data?.openPayables || 0), color: '#f59e0b' },
    { icon: <CheckCircleOutlined />, label: 'Overdue Bills', value: fmtMoney(dash.data?.dueOverdue || 0), color: '#ef4444', hint: `${dash.data?.overdueBills || 0} bills` },
    { icon: <DollarOutlined />, label: 'Due This Week', value: fmtMoney(weekDue), color: '#2563eb' },
    { icon: <PayCircleOutlined />, label: 'Paid This Month', value: fmtMoney(dash.data?.paymentsThisMonth || 0), color: '#16a34a', onClick: onGoPay },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {kpis.map((k) => <button key={k.label} disabled={!k.onClick} className="text-left disabled:cursor-default" onClick={k.onClick}><StatCard icon={k.icon} label={k.label} value={k.value} hint={k.hint} color={k.color} /></button>)}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search bill / vendor / reference…" className="!w-72 !rounded-xl" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Vendor" className="!min-w-[160px]" value={vendorId || undefined} onChange={(v) => { setVendorId(v || ''); setPage(1); }} options={vendors.map((v: any) => ({ label: v.name, value: v.id }))} />
        <Select allowClear placeholder="Payment Status" className="!min-w-[150px]" value={payStatus || undefined} onChange={(v) => { setPayStatus(v || ''); setPage(1); }} options={PAY_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Select allowClear placeholder="Due Status" className="!min-w-[140px]" value={dueStatus || undefined} onChange={(v) => { setDueStatus(v || ''); setPage(1); }} options={DUE_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <DatePicker.RangePicker className="!rounded-xl" value={billRange} onChange={(v) => { setBillRange(v); setPage(1); }} placeholder={['Bill from', 'Bill to']} />
        <div className="flex items-center gap-2 ml-auto">
          <Dropdown menu={{ items: DOC_STATUS.map((s) => ({ key: s, label: s })), onClick: ({ key }) => { setDocStatus(key); setPage(1); } }} trigger={['click']}><Button>Document Status{docStatus ? `: ${docStatus}` : ''}</Button></Dropdown>
          <Button onClick={clear}>Clear</Button>
        </div>
      </div>
      <Table rowKey="id" loading={list.isLoading} dataSource={arr(data.rows)} columns={cols} scroll={{ x: true }} onChange={onTableChange} pagination={{ current: page, pageSize, total: data.total, showSizeChanger: true, showTotal: (t) => `${t} bills` }} />
      <PaySupplierDrawer open={payOpen} onClose={() => setPayOpen(false)} onSaved={() => { setPayOpen(false); refresh(); }} bills={arr(data.rows)} initialIds={payBill} />
      {paymentsBill && <BillPaymentsDrawer bill={paymentsBill} onClose={() => setPaymentsBill(null)} onOpenBill={openBill} />}
    </div>
  );
}

function RowActions({ bill, onOpen, onPay }: { bill: any; onPay: () => void; onOpen: () => void }) {
  const remaining = Number(bill.remaining);
  const overdue = bill.dueStatus === 'OVERDUE';
  const isDraft = bill.documentStatus === 'DRAFT';
  const canPay = bill.documentStatus === 'POSTED' && remaining > 0;
  const payLabel = overdue ? 'Pay Bill' : Number(bill.paid) > 0.005 ? 'Pay Balance' : 'Pay Bill';
  return (
    <RowActionsMenu items={[
      { key: 'view', label: 'View Bill', icon: <EyeOutlined />, onClick: onOpen },
      { key: 'edit', label: 'Edit', icon: <EditOutlined />, hidden: !isDraft, onClick: onOpen },
      { key: 'pay', label: payLabel, icon: <PayCircleOutlined />, hidden: !canPay, onClick: onPay },
      { key: 'payments', label: 'View Payments', icon: <DollarOutlined />, onClick: () => window.open('/procurement', '_blank') },
      { key: 'supplier', label: 'View Supplier', icon: <ShopOutlined />, onClick: () => window.open(`/procurement/suppliers/${bill.supplierId}`, '_blank') },
      { key: 'journal', label: 'View Journal Entry', icon: <FileTextOutlined />, onClick: () => window.open('/finance/journals', '_blank') },
      { key: 'trail', label: 'Bill Trail', icon: <FileTextOutlined /> },
    ]} />
  );
}

function BillPaymentsDrawer({ bill, onClose, onOpenBill }: { bill: any; onClose: () => void; onOpenBill: (id: string) => void }) {
  const [detail, setDetail] = useState<any>(null);
  const payments = arr(bill.appliedPayments);
  const cols: ColumnsType<any> = [
    { title: 'Payment #', dataIndex: 'paymentNo', render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => setDetail(r)}>{v}</a> },
    { title: 'Date', dataIndex: 'paidAt', render: fmtDate }, { title: 'Method', dataIndex: 'method', width: 100 },
    { title: 'Reference', dataIndex: 'referenceNo', render: (v: any) => v || '—' },
    { title: 'Applied to This Bill', dataIndex: 'appliedToBill', align: 'right', render: (v: any) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
    { title: '', width: 80, render: (_: any, r: any) => <Button size="small" onClick={() => setDetail(r)}>Open</Button> },
  ];
  return (
    <Drawer open onClose={onClose} width={680} title={`Payments for ${bill.invoiceNo}`} extra={<Button onClick={onClose}>Close</Button>}>
      <div className="nex-card mb-4 px-4 py-3 !rounded-xl"><div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[{ l: 'Vendor', v: bill.supplier?.name }, { l: 'Bill Total', v: fmtMoney(bill.total) }, { l: 'Paid', v: fmtMoney(bill.paid) }, { l: 'Remaining', v: fmtMoney(bill.remaining) }, { l: 'Payment Status', v: bill.paymentStatus }].map((k) => <div key={k.l}><div className="text-[12px] text-[#64748b]">{k.l}</div><div className="text-[14px] font-semibold text-[#171a2e]">{k.v}</div></div>)}
      </div></div>
      <Table rowKey="paymentId" size="small" dataSource={payments} columns={cols} pagination={false} />
      {detail && <PaymentDetailDrawer payment={detail} bill={bill} onClose={() => setDetail(null)} onOpenBill={onOpenBill} />}
    </Drawer>
  );
}

function PaymentDetailDrawer({ payment, bill, onClose, onOpenBill }: { payment: any; bill: any; onClose: () => void; onOpenBill: (id: string) => void }) {
  return (
    <Drawer open onClose={onClose} width={560} title={`Payment ${payment.paymentNo}`} extra={<Button onClick={onClose}>Close</Button>}>
      <Descriptions column={1} size="small" bordered items={[
        { label: 'Payment #', children: payment.paymentNo }, { label: 'Supplier', children: bill.supplier?.name }, { label: 'Payment Date', children: fmtDate(payment.paidAt) },
        { label: 'Payment Method', children: payment.method }, { label: 'Reference', children: payment.referenceNo || '—' },
        { label: 'Payment Amount', children: <b>{fmtMoney(payment.paymentAmount)}</b> }, { label: 'Applied to This Bill', children: <span className="text-[#16a34a]">{fmtMoney(payment.appliedToBill)}</span> },
        { label: 'Status', children: <StatusTag value={payment.status} /> },
      ]} />
      <div className="mt-4 text-[13px] font-bold text-[#171a2e]">Allocations</div>
      <Table size="small" rowKey="paymentId" dataSource={[payment]} pagination={false} columns={[
        { title: 'Bill #', render: () => <a className="text-[#2563eb] cursor-pointer" onClick={() => onOpenBill(bill.id)}>{bill.invoiceNo}</a> },
        { title: 'Bill Total', render: () => fmtMoney(bill.total) }, { title: 'Applied', dataIndex: 'appliedToBill', align: 'right', render: (v: any) => fmtMoney(v) },
        { title: 'Balance After', render: () => <span className="text-[#F97316]">{fmtMoney(bill.remaining)}</span> },
      ]} />
    </Drawer>
  );
}
