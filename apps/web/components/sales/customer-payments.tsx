'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, DatePicker, Drawer, Input, InputNumber, Modal, Row, Select, Space, Table, Tabs, Tag, message } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined, MailOutlined, PrinterOutlined, UndoOutlined, WalletOutlined, FileTextOutlined, ClockCircleOutlined, CheckOutlined, EyeOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const METHODS = ['CASH', 'BANK', 'ACH', 'CHECK', 'CARD', 'MOBILE MONEY', 'OTHER'];
const payable = (i: any) => ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.paymentStatus) && i.invoiceStatus === 'POSTED';

export function CustomerPayments({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unapplied'>('all');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [applyTo, setApplyTo] = useState<any>(null);

  const sumQ = useQuery({ queryKey: ['custpay-summary', customerId], queryFn: () => api(`/sales/customers/${customerId}/payments/summary`) });
  const listQ = useQuery({ queryKey: ['custpay-list', customerId], queryFn: () => api(`/sales/customers/${customerId}/payments`) });
  const openQ = useQuery({ queryKey: ['custpay-open', customerId], queryFn: () => api('/sales/invoices').then((l: any[]) => (l || []).filter((i: any) => i.customerId === customerId && payable(i))) });
  const accountsQ = useQuery({ queryKey: ['finance/accounts'], queryFn: () => api('/finance/accounts').then((l: any[]) => (l || []).filter((a: any) => a.type === 'ASSET')) });

  const payments = (listQ.data || []).filter((p: any) => (filter === 'unapplied' ? Number(p.unapplied) > 0 : true)).filter((p: any) => !search || `${p.receiptNo} ${p.referenceNo || ''} ${p.method}`.toLowerCase().includes(search.toLowerCase()));
  const sum = sumQ.data || {};
  const refresh = () => { qc.invalidateQueries({ queryKey: ['custpay-summary', customerId] }); qc.invalidateQueries({ queryKey: ['custpay-list', customerId] }); qc.invalidateQueries({ queryKey: ['custpay-open', customerId] }); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); };

  const delQs = (id: string) => ['custpay-summary', 'custpay-list'].map((k) => ({ queryKey: [k, id] }));
  const createMut = useMutation({ mutationFn: (b: any) => api(`/sales/customers/${customerId}/payments`, { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => { message.success('Payment recorded successfully'); setAddOpen(false); refresh(); }, onError: (e: any) => message.error(e.message) });
  const applyMut = useMutation({ mutationFn: ({ pid, b }: { pid: string; b: any }) => api(`/sales/payments/${pid}/apply`, { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => { message.success('Credit applied'); setApplyTo(null); refresh(); }, onError: (e: any) => message.error(e.message) });
  const reverseMut = useMutation({ mutationFn: (pid: string) => api(`/sales/payments/${pid}/reverse`, { method: 'POST' }), onSuccess: () => { message.success('Payment reversed'); setDetail(null); refresh(); }, onError: (e: any) => message.error(e.message) });

  const payCols: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'receiptDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD/MM/YY')}</span> },
    { title: 'Payment #', dataIndex: 'receiptNo', width: 130, render: (v, r) => <a className="font-mono text-[12px] font-semibold text-[#003366]" onClick={() => setDetail(r)}>{v}</a> },
    { title: 'Amount', dataIndex: 'amount', width: 120, align: 'right', render: (v) => <span className="text-[13px] font-semibold">{fmtMoney(v)}</span> },
    { title: 'Applied', dataIndex: 'applied', width: 120, align: 'right', render: (v) => <span className="text-[13px]">{fmtMoney(v)}</span> },
    { title: 'Unapplied', dataIndex: 'unapplied', width: 120, align: 'right', render: (v) => <span className={`text-[13px] font-semibold ${Number(v) > 0 ? 'text-[#F97316]' : 'text-[#16A34A]'}`}>{fmtMoney(v)}</span> },
    { title: 'Method', dataIndex: 'method', width: 120, render: (v) => <Tag>{v}</Tag> },
    { title: 'Reference', dataIndex: 'referenceNo', width: 120, render: (v) => v || '—' },
    { ...ACTIONS_COL, render: (_, r) => (
      <RowActionsMenu items={[
        { key: 'details', label: 'Details', icon: <EyeOutlined />, onClick: () => setDetail(r) },
        { key: 'receipt', label: 'Receipt', icon: <PrinterOutlined />, onClick: () => setDetail(r) },
        { key: 'apply', label: 'Apply Credit', icon: <CheckOutlined />, hidden: !(Number(r.unapplied) > 0), onClick: () => setApplyTo(r) },
      ]} />
    ) },
  ];

  return (
    <div className="p-4">
      {/* Summary cards */}
      <Row gutter={[12, 12]} className="mb-4">
        <Summary icon={<FileTextOutlined />} label="Total Invoiced" value={sum.totalInvoiced} color="#0284c7" />
        <Summary icon={<WalletOutlined />} label="Total Paid" value={sum.totalPaid} color="#16a34a" />
        <Summary icon={<ClockCircleOutlined />} label="Remaining Balance" value={sum.remainingBalance} color="#f59e0b" />
        <Summary icon={<WalletOutlined />} label="Unapplied Credits" value={sum.unappliedCredits} color="#dc2626" />
      </Row>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search payments..." className="w-64 !rounded-xl" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Tabs className="!mb-0" activeKey={filter} onChange={(k: any) => setFilter(k)} items={[
          { key: 'all', label: `All Payments (${(listQ.data || []).length})` },
          { key: 'unapplied', label: `Unapplied Credits (${(listQ.data || []).filter((p: any) => Number(p.unapplied) > 0).length})` },
        ]} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-[#94a3b8]">{payments.length} records · {fmtMoney(payments.reduce((s: number, p: any) => s + Number(p.amount), 0))} total</span>
          <Button icon={<ReloadOutlined />} onClick={refresh} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add Payment</Button>
        </div>
      </div>
      {/* Table */}
      <Table rowKey="id" loading={listQ.isLoading} dataSource={payments} columns={payCols} scroll={{ x: true }} pagination={false}
        locale={{ emptyText: filter === 'unapplied' ? <Empty text="No unapplied credits — all customer payments have been fully allocated." /> : <Empty text="No payments recorded — payments received from this customer will appear here." add={() => setAddOpen(true)} /> }} />

      <AddPaymentDrawer open={addOpen} onClose={() => setAddOpen(false)} customerId={customerId} outstanding={openQ.data || []} accounts={accountsQ.data || []} onSave={(b) => createMut.mutate(b)} saving={createMut.isPending} />
      <PaymentDetails payment={detail} onClose={() => setDetail(null)} onReverse={(pid) => reverseMut.mutate(pid)} reverseLoading={reverseMut.isPending} onApply={() => setApplyTo(detail)} />
      <ApplyCreditModal payment={applyTo} onClose={() => setApplyTo(null)} outstanding={openQ.data || []} onApply={(b) => applyMut.mutate({ pid: applyTo.id, b })} saving={applyMut.isPending} />
    </div>
  );
}

function Summary({ icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <Col xs={12} md={6}>
      <div className="rounded-lg border border-[#f1f5f9] bg-white p-3" style={{ borderTop: `3px solid ${color}` }}>
        <div className="flex items-center gap-1.5 text-[11px] text-[#94a3b8]"><span style={{ color }}>{icon}</span>{label}</div>
        <div className="text-[20px] font-semibold text-[#171a2e]">{fmtMoney(value || 0)}</div>
      </div>
    </Col>
  );
}

function Empty({ text, add }: { text: string; add?: () => void }) {
  return <div className="py-10 text-center">{text}<div className="mt-3">{add && <Button type="primary" icon={<PlusOutlined />} onClick={add}>Add Payment</Button>}</div></div>;
}

function AddPaymentDrawer({ open, onClose, customerId, outstanding, accounts, onSave, saving }: { open: boolean; onClose: () => void; customerId: string; outstanding: any[]; accounts: any[]; onSave: (b: any) => void; saving: boolean }) {
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(dayjs());
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [depositId, setDepositId] = useState<string>();
  const [memo, setMemo] = useState('');
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const custQ = useQuery({ queryKey: ['customer', customerId], queryFn: () => api('/sales/customers').then((l: any[]) => (l || []).find((c: any) => c.id === customerId)), enabled: open });
  const cust = custQ.data;
  const applied = Object.values(alloc).reduce((s, v) => s + Number(v || 0), 0);
  const unapplied = Math.max(0, Number(amount) - applied);
  const toggle = (inv: any, checked: boolean) => setAlloc((p) => {
    if (checked) { const rem = Number(inv.balanceDue); const cap = Math.min(rem, Math.max(0, Number(amount) - applied)); return { ...p, [inv.id]: Math.min(rem, cap) }; }
    const n = { ...p }; delete n[inv.id]; return n;
  });
  const autoApply = () => {
    let remaining = Number(amount || 0); const n: Record<string, number> = {};
    const sorted = [...outstanding].sort((a: any, b: any) => (a.dueDate || a.invoiceDate) .localeCompare(b.dueDate || b.invoiceDate));
    for (const inv of sorted) { if (remaining <= 0) break; const use = Math.min(Number(inv.balanceDue), remaining); if (use > 0) { n[inv.id] = use; remaining -= use; } }
    setAlloc(n);
  };
  const save = () => { if (!(Number(amount) > 0)) { message.warning('Enter a payment amount'); return; } if (applied > Number(amount) + 0.005) { message.warning('Applied exceeds payment'); return; } onSave({ paymentDate: date.format('YYYY-MM-DD'), amount: Number(amount), method, reference, depositAccountId: depositId, memo, allocations: Object.entries(alloc).filter(([k, v]) => Number(v) > 0).map(([k, v]) => ({ invoiceId: k, amount: Number(v) })) }); };
  return (
    <Drawer open={open} onClose={onClose} width={820} title="Receive Payment" extra={<Button onClick={onClose}>Cancel</Button>} footer={<div className="flex items-center justify-end gap-3"><div className="text-[14px]"><span className="text-[#64748b]">Payment {fmtMoney(amount)} · Applied {fmtMoney(applied)} · </span><span className="font-semibold text-[#003366]">Unapplied {fmtMoney(unapplied)}</span></div><Button type="primary" loading={saving} onClick={save}>Save Payment</Button></div>} styles={{ body: { padding: 20 } }}>
      <div className="mb-4"><div className="text-[11px] uppercase tracking-wide text-[#94a3b8]">Customer</div><div className="text-[15px] font-semibold text-[#171a2e]">{cust?.name || 'Customer'}</div><div className="text-[12px] text-[#64748b]">Outstanding balance comes from open invoices below.</div></div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="Payment Date *"><DatePicker className="w-full" value={date} onChange={(v) => v && setDate(v)} /></Field>
        <Field label="Payment Amount *"><InputNumber className="w-full" min={0} prefix="$" value={amount} onChange={(v) => setAmount(Number(v || 0))} /></Field>
        <Field label="Payment Method *"><Select className="w-full" value={method} onChange={setMethod} options={METHODS.map((m) => ({ label: m, value: m }))} /></Field>
        <Field label="Reference / Check #"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'CHECK' ? 'Check Number' : method === 'BANK' || method === 'ACH' ? 'Transaction Reference' : 'Reference'} /></Field>
        <Field label="Deposit To *"><Select className="w-full" allowClear value={depositId} onChange={setDepositId} placeholder="Bank / Cash account" options={accounts.map((a: any) => ({ label: `${a.code} — ${a.name}`, value: a.id }))} /></Field>
        <Field label="Memo"><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Customer settlement…" /></Field>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-semibold text-[#171a2e]">Outstanding Invoices</div>
        <Space size={8}><Button size="small" onClick={autoApply}>Auto Apply</Button><Button size="small" onClick={() => setAlloc({})}>Clear Allocations</Button></Space>
      </div>
      <Table rowKey="id" size="small" dataSource={outstanding} pagination={false} scroll={{ x: true }} columns={[
        { title: 'Select', width: 50, render: (_v, r: any) => <input type="checkbox" checked={alloc[r.id] != null} onChange={(e) => toggle(r, e.target.checked)} /> },
        { title: 'Invoice #', render: (_v, r: any) => <Link href={`/sales/invoices/${r.id}/edit`} className="text-[#003366] font-medium">{r.invoiceNo}</Link> },
        { title: 'Date', width: 100, render: (_v, r: any) => <span className="text-[#64748b] text-[13px]">{dayjs(r.invoiceDate).format('DD/MM/YY')}</span> },
        { title: 'Total', width: 110, render: (_v, r: any) => <span className="text-[13px]">{fmtMoney(r.total)}</span> },
        { title: 'Remaining', width: 110, render: (_v, r: any) => <span className="text-[13px] font-semibold">{fmtMoney(r.balanceDue)}</span> },
        { title: 'Apply', width: 130, render: (_v, r: any) => <InputNumber className="w-full" min={0} max={r.balanceDue} value={alloc[r.id]} onChange={(v) => setAlloc((p) => ({ ...p, [r.id]: Number(v || 0) }))} /> },
      ]} locale={{ emptyText: 'No outstanding invoices' }} />
    </Drawer>
  );
}

function PaymentDetails({ payment, onClose, onReverse, reverseLoading, onApply }: { payment: any; onClose: () => void; onReverse: (pid: string) => void; reverseLoading: boolean; onApply: () => void }) {
  const q = useQuery({ queryKey: ['paydetail', payment?.id], queryFn: () => api(`/sales/payments/${payment?.id}`), enabled: !!payment });
  const p = q.data;
  return (
    <Drawer open={!!payment} onClose={onClose} width={640} title={`Payment ${p?.receiptNo || ''}`}>
      {!p ? null : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">{[['Customer', p.customer?.name], ['Date', dayjs(p.receiptDate).format('DD/MM/YYYY')], ['Amount', fmtMoney(p.amount)], ['Method', p.method], ['Reference', p.referenceNo || '—'], ['Status', p.status]].map(([l, v]) => <div key={l as string}><div className="text-[11px] text-[#94a3b8]">{l}</div><div className="text-[14px] font-medium text-[#171a2e]">{v}</div></div>)}</div>
          <div className="grid grid-cols-2 gap-3">{[['Applied', fmtMoney(p.applied)], ['Unapplied', fmtMoney(p.unapplied)]].map(([l, v]) => <div key={l as string}><div className="text-[11px] text-[#94a3b8]">{l}</div><div className={`text-[14px] font-semibold ${l === 'Unapplied' && Number(p.unapplied) > 0 ? 'text-[#F97316]' : 'text-[#171a2e]'}`}>{v}</div></div>)}</div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[#94a3b8] mb-2">Applied To</div>
            <Table rowKey="id" size="small" pagination={false} dataSource={p.allocations || []} columns={[
              { title: 'Invoice', render: (_v, r: any) => <Link href={`/sales/invoices/${r.invoiceId}/edit`} className="text-[#003366]">{r.invoice?.invoiceNo}</Link> },
              { title: 'Original', align: 'right', render: (_v, r: any) => fmtMoney(r.invoice?.total) },
              { title: 'Applied', align: 'right', render: (_v, r: any) => <span className="font-semibold">{fmtMoney(r.amountApplied)}</span> },
              { title: 'Remaining', align: 'right', render: (_v, r: any) => fmtMoney(Math.max(0, Number(r.invoice?.total) - Number(r.amountApplied))) },
            ]} locale={{ emptyText: 'Nothing applied yet' }} />
          </div>
          {p.memo && <div><div className="text-[11px] text-[#94a3b8]">Memo</div><div className="text-[13px] text-[#344054]">{p.memo}</div></div>}
          <div className="flex gap-2 pt-2">
            {Number(p.unapplied) > 0 && <Button type="primary" icon={<CheckOutlined />} onClick={onApply}>Apply Credit</Button>}
            {p.status !== 'REVERSED' && <Button danger icon={<UndoOutlined />} loading={reverseLoading} onClick={() => onReverse(p.id)}>Reverse Payment</Button>}
            <Button icon={<MailOutlined />} onClick={() => message.success('Receipt email is available via the Send Email flow.')}>Email Receipt</Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function ApplyCreditModal({ payment, onClose, outstanding, onApply, saving }: { payment: any; onClose: () => void; outstanding: any[]; onApply: (b: any) => void; saving: boolean }) {
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const available = Number(payment?.unapplied || 0);
  const applied = Object.values(alloc).reduce((s, v) => s + Number(v || 0), 0);
  return (
    <Modal open={!!payment} onCancel={() => { setAlloc({}); onClose(); }} onOk={() => { if (applied < 0.005) { message.warning('Enter an apply amount'); return; } onApply({ allocations: Object.entries(alloc).filter(([k, v]) => Number(v) > 0).map(([k, v]) => ({ invoiceId: k, amount: Number(v) })) }); }} confirmLoading={saving} title="Apply Customer Credit" okText="Apply">
      <div className="mb-3 text-[13px]">Available Credit: <span className="font-semibold text-[#F97316]">{fmtMoney(available)}</span></div>
      <Table rowKey="id" size="small" dataSource={outstanding} pagination={false} columns={[
        { title: 'Invoice', render: (_v, r: any) => <Link href={`/sales/invoices/${r.id}/edit`}>{r.invoiceNo}</Link> },
        { title: 'Remaining', align: 'right', render: (_v, r: any) => fmtMoney(r.balanceDue) },
        { title: 'Apply', width: 140, render: (_v, r: any) => <InputNumber className="w-full" min={0} max={Math.min(r.balanceDue, available)} value={alloc[r.id]} onChange={(v) => setAlloc((p) => ({ ...p, [r.id]: Number(v || 0) }))} /> },
      ]} />
      <div className="mt-3 text-right text-[13px]">Total Applied: <span className="font-semibold">{fmtMoney(applied)}</span> · Remaining Credit: <span className="font-semibold">{fmtMoney(Math.max(0, available - applied))}</span></div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: any }) { return <div><div className="text-[11px] text-[#64748b] mb-1">{label}</div>{children}</div>; }
