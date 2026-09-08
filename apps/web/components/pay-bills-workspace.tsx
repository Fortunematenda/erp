'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, DatePicker, Drawer, Dropdown, Form, Input, InputNumber, Select, Space, Table, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, DeleteOutlined, DollarOutlined, EyeOutlined, FileTextOutlined, PayCircleOutlined, SearchOutlined, ShopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AccountSelector } from '@/components/account-selector';
import { StatusTag } from '@/components/crud-page';
import { useMeta } from '@/lib/meta';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const METHODS = ['BANK', 'CHEQUE', 'CASH', 'CARD', 'MOBILE', 'OTHER'];
const PAY_STATUS = ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'];
const DUE_STATUS = ['OVERDUE', 'DUE_TODAY', 'DUE_THIS_WEEK', 'DUE_THIS_MONTH', 'NOT_YET_DUE'];
const arr = (v: any) => (Array.isArray(v) ? v : []);
const DOC_TONE: Record<string, string> = { POSTED: 'green', DRAFT: 'default', VOID: 'red' };

export function PayBillsWorkspace({ onPaymentPosted, onOpenBill }: { onPaymentPosted?: () => void; onOpenBill?: (id: string) => void }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [q, setQ] = useState(''); const [vendorId, setVendorId] = useState(''); const [payStatus, setPayStatus] = useState(''); const [dueStatus, setDueStatus] = useState('');
  const [dueRange, setDueRange] = useState<any>(undefined); const [showPaid, setShowPaid] = useState(false);
  const [sortBy, setSortBy] = useState('dueDate'); const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');
  const [selected, setSelected] = useState<string[]>([]); const [drawer, setDrawer] = useState(false); const [drawerIds, setDrawerIds] = useState<string[]>([]);
  useEffect(() => { setSelected([]); }, [showPaid]); // eslint-disable-line

  const list = useQuery({ queryKey: ['/procurement/bills', 'payw', q, vendorId, payStatus, dueStatus, dueRange, showPaid, sortBy, sortDir], queryFn: () => {
    const p = new URLSearchParams(); p.set('documentStatus', 'POSTED'); if (!showPaid) p.set('onlyOutstanding', 'true');
    if (q) p.set('q', q); if (vendorId) p.set('vendorId', vendorId); if (payStatus) p.set('paymentStatus', payStatus); if (dueStatus) p.set('dueStatus', dueStatus);
    if (dueRange) { p.set('dueDateFrom', dueRange[0].format('YYYY-MM-DD')); p.set('dueDateTo', dueRange[1].format('YYYY-MM-DD')); }
    p.set('sortBy', sortBy); p.set('sortDirection', sortDir); p.set('pageSize', '500');
    return api(`/procurement/bills?${p.toString()}`); } });
  const rows = arr(list.data?.rows);
  const eligible = (r: any) => r.documentStatus === 'POSTED' && Number(r.remaining) > 0;
  const selectedEligible = rows.filter((r: any) => selected.includes(r.id) && eligible(r));
  const amountDue = selectedEligible.reduce((s: number, r: any) => s + Number(r.remaining), 0);
  const vendors = meta.data?.suppliers || [];

  function refresh() { qc.invalidateQueries({ queryKey: ['/procurement/bills'] }); qc.invalidateQueries({ queryKey: ['/procurement/dashboard'] }); qc.invalidateQueries({ queryKey: ['/procurement/supplier-invoices'] }); }
  function openDrawer(ids: string[]) { setDrawerIds(ids); setDrawer(true); }
  function onTableChange(_pg: any, _f: any, sorter: any) { if (sorter?.field) { setSortBy(sorter.field); setSortDir(sorter.order === 'ascend' ? 'asc' : 'desc'); } }

  const cols: ColumnsType<any> = [
    { title: '☐', width: 40, render: (_: any, r: any) => <Checkbox checked={selected.includes(r.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id))} disabled={!eligible(r)} /> },
    { title: 'Bill #', dataIndex: 'invoiceNo', width: 120, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => onOpenBill?.(r.id)}>{v}</a> },
    { title: 'Vendor', render: (_: any, r: any) => r.supplier?.name || '—' },
    { title: 'Vendor Invoice #', dataIndex: 'supplierInvoiceNo', width: 130 },
    { title: 'Bill Date', dataIndex: 'invoiceDate', sorter: true, width: 105, render: fmtDate },
    { title: 'Due Date', dataIndex: 'dueDate', sorter: true, width: 105, render: (v: any, r: any) => <span>{v ? fmtDate(v) : '—'}{r.dueStatus === 'OVERDUE' && <span className="text-red-600 font-semibold"> · OD</span>}</span> },
    { title: 'Total', dataIndex: 'total', align: 'right', sorter: true, render: (v: any) => fmtMoney(v) },
    { title: 'Paid', dataIndex: 'paid', align: 'right', sorter: true, render: (v: any) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Balance', dataIndex: 'remaining', align: 'right', sorter: true, render: (v: any) => <span className={`font-semibold ${Number(v) > 0 ? 'text-[#F97316]' : 'text-[#16a34a]'}`}>{fmtMoney(v)}</span> },
    { title: 'Payment', dataIndex: 'paymentStatus', width: 130, sorter: true, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Document', dataIndex: 'documentStatus', width: 110, render: (v: any) => <StatusTag value={v} colorMap={{ POSTED: 'green', DRAFT: 'default', VOID: 'red' }} /> },
    { ...ACTIONS_COL, render: (_: any, r: any) => <RowActions bill={r} onPay={() => openDrawer([r.id])} onOpen={() => onOpenBill?.(r.id)} /> },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search bill / vendor / reference…" className="!w-72 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Vendor" className="!min-w-[170px]" value={vendorId || undefined} onChange={setVendorId} options={vendors.map((v: any) => ({ label: v.name, value: v.id }))} />
        <Select allowClear placeholder="Payment Status" className="!min-w-[150px]" value={payStatus || undefined} onChange={setPayStatus} options={PAY_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Select allowClear placeholder="Due Status" className="!min-w-[150px]" value={dueStatus || undefined} onChange={setDueStatus} options={DUE_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <DatePicker.RangePicker className="!rounded-xl" value={dueRange} onChange={setDueRange} placeholder={['Due from', 'Due to']} />
        <div className="flex items-center gap-1 text-[13px] text-[#475060]"><Checkbox checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />Show Paid</div>
        <div className="ml-auto"><Button type="primary" icon={<PayCircleOutlined />} disabled={!selectedEligible.length} onClick={() => openDrawer(selectedEligible.map((r: any) => r.id))}>Pay Selected ({selectedEligible.length})</Button></div>
      </div>
      {selectedEligible.length > 0 && <div className="nex-card mb-3 px-4 py-2 flex items-center gap-4 !rounded-xl"><span className="text-[13px] text-[#344054]">Selected Bills: {selectedEligible.length}</span><span className="text-[13px] text-[#344054]">Amount Due: <b className="text-[#F97316]">{fmtMoney(amountDue)}</b></span></div>}
      <Table rowKey="id" loading={list.isLoading} dataSource={rows} columns={cols} scroll={{ x: true }} onChange={onTableChange} pagination={{ pageSize: 20, showTotal: (t) => `${t} bills` }} />
      {drawer && <PaySupplierDrawer open={drawer} onClose={() => { setDrawer(false); refresh(); }} onSaved={() => { setDrawer(false); refresh(); onPaymentPosted?.(); }} bills={rows} initialIds={drawerIds} />}
    </div>
  );
}

function RowActions({ bill, onPay, onOpen }: { bill: any; onPay: () => void; onOpen: () => void }) {
  const remaining = Number(bill.remaining);
  const overdue = bill.dueStatus === 'OVERDUE';
  const canPay = bill.documentStatus === 'POSTED' && remaining > 0;
  const payLabel = overdue ? 'Pay Bill' : Number(bill.paid) > 0.005 ? 'Pay Balance' : 'Pay Bill';
  return (
    <RowActionsMenu items={[
      { key: 'view', label: 'View Bill', icon: <EyeOutlined />, onClick: onOpen },
      { key: 'pay', label: payLabel, icon: <PayCircleOutlined />, hidden: !canPay, onClick: onPay },
      { key: 'payments', label: 'View Payments', icon: <DollarOutlined />, onClick: () => window.open('/procurement', '_blank') },
      { key: 'supplier', label: 'View Supplier', icon: <ShopOutlined />, onClick: () => window.open(`/procurement/suppliers/${bill.supplierId}`, '_blank') },
      { key: 'journal', label: 'View Journal Entry', icon: <FileTextOutlined />, onClick: () => window.open('/finance/journals', '_blank') },
    ]} />
  );
}

function PaySupplierDrawer({ open, onClose, onSaved, bills, initialIds }: { open: boolean; onClose: () => void; onSaved: () => void; bills: any[]; initialIds: string[] }) {
  const [method, setMethod] = useState('BANK'); const [payFrom, setPayFrom] = useState<string>(); const [date, setDate] = useState<any>(dayjs()); const [reference, setReference] = useState(''); const [memo, setMemo] = useState('');
  const [applyMap, setApplyMap] = useState<Record<string, number>>({}); const [advance, setAdvance] = useState(0); const [saving, setSaving] = useState(false);
  const outstanding = bills.filter((b: any) => b.documentStatus === 'POSTED' && Number(b.remaining) > 0);
  const applied = Object.values(applyMap).reduce((s, v) => s + Number(v || 0), 0);
  const amount = Number(applied) + Number(advance || 0);
  const supplierIds = [...new Set(outstanding.filter((b: any) => (applyMap[b.id] || 0) > 0).map((b: any) => b.supplierId))];
  const supplierName = supplierIds.length === 1 ? outstanding.find((b: any) => b.supplierId === supplierIds[0])?.supplier?.name : supplierIds.length > 1 ? `Multiple suppliers (${supplierIds.length})` : '';
  useEffect(() => { if (!open) return; setDate(dayjs()); setMethod('BANK'); setPayFrom(undefined); setReference(''); setMemo(''); setAdvance(0); const m: Record<string, number> = {}; outstanding.forEach((b: any) => { if (initialIds.includes(b.id)) m[b.id] = Number(b.remaining); }); setApplyMap(m); }, [open]); // eslint-disable-line
  async function post() {
    const groups: Record<string, { supplierInvoiceId: string; amount: number }[]> = {};
    Object.entries(applyMap).forEach(([billId, v]) => { if (Number(v) > 0) { const b = outstanding.find((x: any) => x.id === billId); if (b) { (groups[b.supplierId] ||= []).push({ supplierInvoiceId: billId, amount: Number(v) }); } } });
    if (!Object.keys(groups).length) { message.error('Select bills to apply'); return; }
    setSaving(true);
    try {
      for (const sid of Object.keys(groups)) { const allocs = groups[sid]; await api('/procurement/supplier-payments', { method: 'POST', body: JSON.stringify({ supplierId: sid, amount: allocs.reduce((s, a) => s + a.amount, 0), method, referenceNo: reference, note: memo, payFromAccountId: payFrom, paidAt: date.format('YYYY-MM-DD'), allocations: allocs }) }); }
      message.success(Object.keys(groups).length > 1 ? `Payments posted for ${Object.keys(groups).length} suppliers` : 'Payment posted'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={680} title="Pay Supplier" destroyOnHidden extra={<Button onClick={onClose}>Cancel</Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={post} loading={saving} disabled={!Object.keys(applyMap).filter((k) => applyMap[k] > 0).length}>Post Payment</Button></Space>}>
      {supplierName && <div className="nex-card mb-4 px-4 py-3 !rounded-xl"><span className="text-[12px] text-[#64748b]">Supplier</span><span className="font-semibold text-[14px] text-[#171a2e] ml-2">{supplierName}</span></div>}
      <Form layout="vertical">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Payment Date *" required><DatePicker className="w-full" value={date} onChange={setDate} allowClear={false} /></Form.Item>
          <Form.Item label="Payment Method *" required><Select value={method} onChange={setMethod} options={METHODS.map((m) => ({ label: m.replace(/_/g, ' '), value: m }))} /></Form.Item>
        </div>
        <Form.Item label="Pay From *" required><AccountSelector allowedTypes={['BANK', 'CASH']} value={payFrom} onChange={setPayFrom} placeholder="Select bank / cash account" /></Form.Item>
        <Form.Item label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'CHEQUE' ? 'Check number' : 'Transaction reference'} /></Form.Item>
        <Form.Item label="Memo"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
      <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-bold">Outstanding Bills</span><Space><Button size="small" onClick={() => { const m: Record<string, number> = {}; outstanding.forEach((b) => (m[b.id] = Number(b.remaining))); setApplyMap(m); }}>Auto Apply</Button><Button size="small" onClick={() => setApplyMap({})}>Clear</Button></Space></div>
      {outstanding.length === 0 && <div className="text-[13px] text-[#8a90ad]">No outstanding bills</div>}
      {outstanding.map((b: any) => { const checked = (applyMap[b.id] || 0) > 0; return (
        <div key={b.id} className="rounded-xl border border-[#eef0f6] p-3 mb-2 flex items-center gap-3" style={{ background: checked ? '#f8f9ff' : '#fff' }}>
          <Checkbox checked={checked} onChange={(e) => setApplyMap((m) => { const n = { ...m }; if (e.target.checked) n[b.id] = Number(b.remaining); else delete n[b.id]; return n; })} />
          <div className="flex-1 min-w-0"><span className="font-medium text-[13px]">{b.invoiceNo}</span><span className="text-[11px] text-[#8a90ad] ml-2">{b.supplier?.name}{b.dueDate ? ` · due ${fmtDate(b.dueDate)}` : ''}</span></div>
          <span className="text-[12px] text-[#8a90ad]">Balance</span><span className="font-bold text-[13px] text-[#F97316] w-20 text-right">{fmtMoney(b.remaining)}</span>
          <InputNumber className="!w-24" prefix="$" min={0} max={Number(b.remaining)} value={applyMap[b.id]} disabled={!checked} onChange={(v) => setApplyMap((m) => ({ ...m, [b.id]: v || 0 }))} />
        </div>
      ); })}
      <div className="nex-card mt-4 px-4 py-3 !rounded-xl">
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Payment Amount</span><span className="text-[18px] font-bold">{fmtMoney(amount)}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Total Applied</span><span className="text-[14px] font-semibold text-[#16a34a]">{fmtMoney(applied)}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Unapplied / Advance</span><span className="text-[14px] font-semibold text-[#8b5cf6]">{fmtMoney(Number(advance))}</span></div>
        <div className="flex items-center justify-between py-1 pt-2 border-t"><span className="text-[12px] text-[#64748b]">Add to Advance</span><InputNumber className="!w-32" prefix="$" min={0} value={advance} onChange={(v) => setAdvance(v || 0)} /></div>
      </div>
    </Drawer>
  );
}

