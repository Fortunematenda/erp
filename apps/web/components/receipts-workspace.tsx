'use client';
import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Table, Popconfirm, Checkbox } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DollarOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, EyeOutlined, UndoOutlined, WalletOutlined, BankOutlined, ThunderboltOutlined, ClearOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtMoney } from '@/lib/format';
import { CustomerAvatar, EmptyState, FilterBar, StatusPill, SummaryCard, customerOptions } from '@/components/sales-ui';
import { SalesDocumentFlow } from '@/components/sales/related-transactions';
import { DocumentTrail } from '@/components/documents/document-trail';
import { AccountSelector } from '@/components/account-selector';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const METHODS = ['CASH', 'BANK_TRANSFER', 'ACH', 'CHECK', 'CARD', 'MOBILE_MONEY', 'OTHER'];
const balanceOf = (i: any) => Number(i.balanceDue ?? (Number(i.total || 0) - Number(i.amountPaid || 0) - Number(i.creditsApplied || 0)));
const isEligible = (i: any) => i.invoiceStatus === 'POSTED' && ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.paymentStatus) && balanceOf(i) > 0.001;

export function ReceiptsWorkspace() {
  const qc = useQueryClient();
  const meta = useMeta();
  const { message } = App.useApp();
  const sp = useSearchParams();
  const list = useQuery({ queryKey: ['/sales/receipts'], queryFn: () => api('/sales/receipts') });
  useEffect(() => {
    const rid = sp.get('receipt');
    if (rid) {
      const found = (Array.isArray(list.data) ? list.data : []).find((x: any) => x.id === rid);
      setView(found || { id: rid });
    }
  }, [sp, list.data]);

  const [q, setQ] = useState('');
  const [customer, setCustomer] = useState('');
  const [method, setMethod] = useState('');
  const [alloc, setAlloc] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<any | null>(null);

  async function doApi(url: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST', body?: any) {
    try {
      await api(url, { method, body: body ? JSON.stringify(body) : undefined });
      message.success('Done');
      qc.invalidateQueries({ queryKey: ['/sales/receipts'] });
      qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
    } catch (e: any) { message.error(e.message); }
  }

  const rows = useMemo(() => {
    const base = Array.isArray(list.data) ? list.data : [];
    let r = base;
    if (q) r = r.filter((x: any) => `${x.receiptNo} ${x.customer?.name || ''} ${(x.invoiceIds || []).join(' ')} ${x.referenceNo || ''} ${x.note || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (customer) r = r.filter((x: any) => x.customerId === customer);
    if (method) r = r.filter((x: any) => x.method === method);
    if (alloc === 'APPLIED') r = r.filter((x: any) => Number(x.unapplied) <= 0.001);
    if (alloc === 'PARTIAL') r = r.filter((x: any) => Number(x.applied) > 0.001 && Number(x.unapplied) > 0.001);
    if (alloc === 'UNAPPLIED') r = r.filter((x: any) => Number(x.applied) <= 0.001);
    return r;
  }, [list.data, q, customer, method, alloc]);

  const kpis = useMemo(() => {
    const base = Array.isArray(list.data) ? list.data : [];
    const total = base.reduce((s, x) => s + Number(x.amount || 0), 0);
    const unapplied = base.reduce((s, x) => s + Number(x.unapplied || 0), 0);
    return { count: base.length, total, unapplied, bank: base.filter((x) => x.depositAccountId).reduce((s, x) => s + Number(x.amount || 0), 0) };
  }, [list.data]);

  const columns: ColumnsType<any> = [
    { title: 'Receipt #', dataIndex: 'receiptNo', width: 130, render: (v, r) => <a className="font-mono text-[12px] font-semibold text-[#003366] hover:underline" onClick={() => setView(r)}>{v}</a> },
    { title: 'Date', dataIndex: 'receiptDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Customer', dataIndex: 'customer', render: (_v, r) => (<span className="flex items-center gap-2.5"><CustomerAvatar name={r.customer?.name} size={28} /><span className="text-[13px] text-[#171a2e]">{r.customer?.name || '—'}</span></span>) },
    { title: 'Invoice / Alloc', dataIndex: 'invoiceIds', render: (_v, r) => r.invoiceIds?.length ? <span className="text-[12px] text-[#64748b]">{r.invoiceIds.length} invoice{r.invoiceIds.length > 1 ? 's' : ''}</span> : <span className="text-[12px] text-[#94a3b8]">Unapplied</span> },
    { title: 'Method', dataIndex: 'method', width: 110, render: (v) => <span className="text-[12px] text-[#64748b]">{v}</span> },
    { title: 'Amount', dataIndex: 'amount', width: 120, align: 'right', render: (v) => <span className="font-semibold">{fmtMoney(v)}</span> },
    { title: 'Applied', dataIndex: 'applied', width: 110, align: 'right', render: (v) => <span className="text-[13px] text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Unapplied', dataIndex: 'unapplied', width: 110, align: 'right', render: (v) => <span className={`text-[13px] ${Number(v) > 0.001 ? 'text-[#f59e0b]' : 'text-[#64748b]'}`}>{fmtMoney(v)}</span> },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusPill status={String(v || '').replace(/_/g, ' ')} /> },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setView(r) },
        { key: 'reverse', label: 'Reverse', icon: <UndoOutlined />, danger: true, hidden: r.status === 'REVERSED', confirm: 'Reverse this receipt?', onClick: () => doApi(`/sales/receipts/${r.id}/reverse`) },
      ]} />
    ) },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Receipts</h1><p className="text-[13px] text-[#64748b] mt-1">Record and allocate customer payments</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>New Receipt</Button>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        <SummaryCard icon={<WalletOutlined />} label="Receipts" value={kpis.count} tone="#003366" />
        <SummaryCard icon={<DollarOutlined />} label="Total Collected" value={fmtMoney(kpis.total)} tone="#16a34a" />
        <SummaryCard icon={<ThunderboltOutlined />} label="Unapplied Credits" value={fmtMoney(kpis.unapplied)} tone="#f59e0b" />
        <SummaryCard icon={<BankOutlined />} label="Bank Deposits" value={fmtMoney(kpis.bank)} tone="#0ea5e9" />
      </div>
      <FilterBar extra={<span className="text-[12px] text-[#94a3b8]">{rows.length} receipts</span>}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search receipts..." className="w-[420px] max-w-full !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Customer" className="!min-w-[170px] !rounded-xl" value={customer || undefined} onChange={setCustomer} options={customerOptions(meta.data?.customers)} />
        <Select allowClear placeholder="Method" className="!min-w-[140px] !rounded-xl" value={method || undefined} onChange={setMethod} options={METHODS.map((m) => ({ label: m.replace(/_/g, ' '), value: m }))} />
        <Select allowClear placeholder="Allocation" className="!min-w-[140px] !rounded-xl" value={alloc || undefined} onChange={setAlloc} options={[{ label: 'Fully Applied', value: 'APPLIED' }, { label: 'Partially Applied', value: 'PARTIAL' }, { label: 'Unapplied', value: 'UNAPPLIED' }]} />
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/sales/receipts'] })} />
      </FilterBar>
      <div className="nex-card">
        {rows.length === 0 ? <EmptyState title="No receipts found" description="Record a customer payment to allocate against invoices." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>New Receipt</Button>} /> : <Table rowKey="id" loading={list.isLoading} dataSource={rows} columns={columns} scroll={{ x: true }} pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} receipts` }} />}
      </div>
      <ReceiveCustomerPaymentDrawer open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['/sales/receipts'] }); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); setCreateOpen(false); }} />
      <ReceiptViewDrawer receipt={view} onClose={() => setView(null)} onAction={doApi} onRefresh={() => { qc.invalidateQueries({ queryKey: ['/sales/receipts'] }); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); }} />
    </div>
  );
}

export function ReceiveCustomerPaymentDrawer({ open, onClose, onCreated, initialCustomerId, initialInvoiceId }: { open: boolean; onClose: () => void; onCreated: () => void; initialCustomerId?: string; initialInvoiceId?: string }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const invoices = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices'), enabled: open });
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState(0);
  const [alloc, setAlloc] = useState<Record<string, { balance: number; apply: number }>>({});
  const [saving, setSaving] = useState(false);
  const allInvoices = useMemo(() => (Array.isArray(invoices.data) ? invoices.data : []), [invoices.data]);

  const eligible = useMemo(() => allInvoices.filter((i: any) => i.customerId === customerId && isEligible(i)).sort((a: any, b: any) => (a.dueDate || a.invoiceDate || '') < (b.dueDate || b.invoiceDate || '') ? -1 : 1), [allInvoices, customerId]);

  // Preselect customer when opened from an invoice (keep form + state in sync).
  useEffect(() => {
    if (!open) return;
    const seeded = initialCustomerId
      || (initialInvoiceId ? allInvoices.find((i: any) => i.id === initialInvoiceId)?.customerId : undefined)
      || '';
    if (!seeded) return;
    setCustomerId((prev) => (prev === seeded ? prev : seeded));
    if (form.getFieldValue('customerId') !== seeded) {
      form.setFieldValue('customerId', seeded);
    }
  }, [open, initialCustomerId, initialInvoiceId, allInvoices]); // eslint-disable-line react-hooks/exhaustive-deps -- form instance is stable
  useEffect(() => {
    if (open && initialInvoiceId && customerId && allInvoices.length) {
      const inv = allInvoices.find((i: any) => i.id === initialInvoiceId && isEligible(i));
      if (inv) { setAlloc({ [inv.id]: { balance: balanceOf(inv), apply: balanceOf(inv) } }); setAmount(balanceOf(inv)); }
    }
  }, [open, initialInvoiceId, customerId, allInvoices]);

  function toggleInvoice(inv: any, checked: boolean) {
    if (checked) setAlloc((p) => ({ ...p, [inv.id]: { balance: balanceOf(inv), apply: balanceOf(inv) } }));
    else setAlloc((p) => { const n = { ...p }; delete n[inv.id]; return n; });
  }
  useEffect(() => { const sum = Object.values(alloc).reduce((s, a) => s + Number(a.apply || 0), 0); setAmount(sum); }, [alloc]);

  function setApply(id: string, apply: number) {
    setAlloc((p) => ({ ...p, [id]: { ...p[id], apply: Math.min(Math.max(0, Number(apply || 0)), p[id].balance) } }));
  }
  function onAmountChange(v: number) {
    let remaining = Math.max(0, Number(v || 0));
    const next: Record<string, { balance: number; apply: number }> = {};
    eligible.forEach((inv: any) => {
      const cur = alloc[inv.id];
      if (!cur) return;
      const apply = Math.min(remaining, cur.balance);
      next[inv.id] = { balance: cur.balance, apply };
      remaining -= apply;
    });
    setAlloc(next);
    setAmount(Number(v || 0));
  }
  function autoApply() {
    if (!eligible.length) return;
    const next: Record<string, { balance: number; apply: number }> = {};
    let remaining = Math.max(0, Number(amount || 0));
    // No receipt amount yet → select every outstanding invoice at full balance
    // (amount syncs from allocations via the effect below).
    if (remaining <= 0.001) {
      eligible.forEach((inv: any) => {
        const bal = balanceOf(inv);
        if (bal > 0.001) next[inv.id] = { balance: bal, apply: bal };
      });
      setAlloc(next);
      return;
    }
    // Otherwise distribute the entered receipt amount FIFO across open invoices.
    eligible.forEach((inv: any) => {
      if (remaining <= 0.001) return;
      const bal = balanceOf(inv);
      const apply = Math.min(remaining, bal);
      if (apply > 0.001) next[inv.id] = { balance: bal, apply };
      remaining -= apply;
    });
    setAlloc(next);
  }
  const applied = Object.values(alloc).reduce((s, a) => s + Number(a.apply || 0), 0);
  const unapplied = Math.max(0, Number(amount || 0) - applied);
  const bankTransfer = method === 'BANK_TRANSFER'; const check = method === 'CHECK'; const card = method === 'CARD';

  async function save() {
    try {
      setSaving(true);
      const v = await form.validateFields();
      const custId = v.customerId || customerId || initialCustomerId;
      if (!custId) { message.warning('Select a customer'); return; }
      if (!(Number(amount) > 0)) { message.warning('Enter a receipt amount'); return; }
      const allocations = Object.entries(alloc).filter(([, a]) => Number(a.apply) > 0.001).map(([invoiceId, a]) => ({ invoiceId, amount: Number(a.apply) }));
      if (Number(amount) - applied > 0.5 && allocations.length === 0 && !v.noInvoice) { /* allow unapplied-only */ }
      const payload = { customerId: custId, receiptDate: v.receiptDate?.format('YYYY-MM-DD') || dayjs().format('YYYY-MM-DD'), amount: Number(amount), method, referenceNo: v.referenceNo || v.checkNo || v.txnRef || v.cardRef, depositAccountId: v.depositAccountId, note: v.note, allocations };
      await api('/sales/receipts', { method: 'POST', body: JSON.stringify(payload) });
      message.success('Receipt posted');
      onCreated();
    } catch (e: any) { message.error(e.message || 'Could not post receipt'); }
    finally { setSaving(false); }
  }

  const invColumns: ColumnsType<any> = [
    { title: '', width: 40, render: (_v, r) => <Checkbox checked={!!alloc[r.id]} onChange={(e) => toggleInvoice(r, e.target.checked)} /> },
    { title: 'Invoice #', dataIndex: 'invoiceNo', render: (v, r) => <Link href={`/sales/invoices/${r.id}/edit`} className="font-mono text-[12px] text-[#003366] hover:underline">{v}</Link> },
    { title: 'Date', dataIndex: 'invoiceDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM')} </span> },
    { title: 'Due', dataIndex: 'dueDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{v ? dayjs(v).format('DD MMM') : '—'}</span> },
    { title: 'Total', dataIndex: 'total', width: 110, align: 'right', render: (v) => <span className="text-[13px] font-medium">{fmtMoney(v)}</span> },
    { title: 'Paid', dataIndex: 'amountPaid', width: 100, align: 'right', render: (_v, r) => <span className="text-[13px] text-[#64748b]">{fmtMoney(Number(r.amountPaid || 0))}</span> },
    { title: 'Balance', dataIndex: 'balance', width: 110, align: 'right', render: (_v, r) => <span className="text-[13px] font-semibold text-[#f59e0b]">{fmtMoney(balanceOf(r))}</span> },
    { title: 'Apply', dataIndex: 'id', width: 120, align: 'right', render: (_v, r) => <InputNumber className="w-28" disabled={!alloc[r.id]} min={0} max={balanceOf(r)} value={alloc[r.id]?.apply} onChange={(val) => setApply(r.id, Number(val || 0))} /> },
  ];

  return (
    <Drawer open={open} onClose={onClose} width={920} title="Record Customer Payment" footer={<div className="flex items-center justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={save} loading={saving} disabled={saving}>Record Payment</Button></div>}>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Form.Item label="Customer" name="customerId" className="!mb-3" rules={[{ required: true, message: 'Select a customer' }]}><Select showSearch optionFilterProp="label" placeholder="Select customer" disabled={!!initialCustomerId} onChange={(id) => { setCustomerId(id); setAlloc({}); setAmount(0); }} options={customerOptions(meta.data?.customers)} /></Form.Item>
          <Form.Item label="Receipt Date" name="receiptDate" className="!mb-3" initialValue={dayjs()} rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Payment Method" name="method" className="!mb-3" initialValue="CASH"><Select value={method} onChange={setMethod} options={METHODS.map((m) => ({ label: m.replace(/_/g, ' '), value: m }))} /></Form.Item>
          <Form.Item label="Deposit To" name="depositAccountId" className="!mb-3" rules={[{ required: true, message: 'Select a deposit account' }]}><AccountSelector allowedTypes={['BANK', 'CASH', 'UNDEPOSITED_FUNDS']} placeholder="Select bank / cash account" /></Form.Item>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          {check ? (
            <>
              <Form.Item label="Check Number" name="checkNo" className="!mb-3"><Input placeholder="Check #" /></Form.Item>
              <Form.Item label="Bank" name="checkBank" className="!mb-3"><Input placeholder="Issuing bank" /></Form.Item>
            </>
          ) : bankTransfer ? (
            <Form.Item label="Transaction Reference" name="txnRef" className="!mb-3 md:col-span-1"><Input placeholder="Bank / transfer reference" /></Form.Item>
          ) : card ? (
            <Form.Item label="Processor Reference" name="cardRef" className="!mb-3 md:col-span-1"><Input placeholder="Card processor reference" /></Form.Item>
          ) : (
            <Form.Item label="Reference" name="referenceNo" className="!mb-3 md:col-span-1"><Input placeholder="Optional payment reference" /></Form.Item>
          )}
        </div>
        <Form.Item label="Notes" name="note" className="!mb-4">
          <Input.TextArea rows={3} placeholder="Optional notes about this payment" className="!resize-none" />
        </Form.Item>

        <div className="mt-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#64748b]">Outstanding Invoices</span>
            <span className="ml-auto flex gap-2">
              <Button size="small" icon={<ThunderboltOutlined />} onClick={autoApply} disabled={!customerId || !eligible.length}>Auto Apply</Button>
              <Button size="small" icon={<ClearOutlined />} onClick={() => { setAlloc({}); setAmount(0); }} disabled={!Object.keys(alloc).length}>Clear</Button>
            </span>
          </div>
          {!customerId ? (
            <div className="rounded-xl border border-dashed border-[#eef0f6] bg-[#fafbff] py-8 text-center text-[13px] text-[#64748b]">Select a customer to view outstanding invoices.</div>
          ) : eligible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#eef0f6] bg-[#fafbff] py-8 text-center text-[13px] text-[#64748b]">
              No outstanding invoices.<div className="text-[12px] text-[#94a3b8] mt-1">This customer has no posted unpaid, partially-paid or overdue invoices.</div>
            </div>
          ) : (
            <Table size="small" rowKey="id" dataSource={eligible} columns={invColumns} pagination={false} scroll={{ x: true }} />
          )}
        </div>

        <div className="mt-4 rounded-xl border border-[#eef0f6] bg-[#fafbff] p-4">
          <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#64748b] mb-3">Payment Summary</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><div className="text-[12px] text-[#64748b]">Receipt Amount</div><InputNumber className="w-full !rounded-xl" prefix="$" min={0} value={amount} onChange={(v) => onAmountChange(Number(v || 0))} /></div>
            <div className="text-center"><div className="text-[11px] text-[#64748b]">Total Applied</div><div className="text-[13px] font-semibold text-[#16a34a] mt-0.5 tabular-nums">{fmtMoney(applied)}</div></div>
            <div className="text-center"><div className="text-[11px] text-[#64748b]">Unapplied</div><div className={`text-[13px] font-semibold mt-0.5 tabular-nums ${unapplied > 0.001 ? 'text-[#f59e0b]' : 'text-[#171a2e]'}`}>{fmtMoney(unapplied)}</div></div>
          </div>
        </div>
      </Form>
    </Drawer>
  );
}

function ReceiptViewDrawer({ receipt, onClose, onAction, onRefresh }: { receipt: any; onClose: () => void; onAction: (url: string, method?: 'POST' | 'PATCH' | 'DELETE', body?: any) => Promise<void>; onRefresh: () => void }) {
  const id = receipt?.id;
  const detail = useQuery({ queryKey: ['/sales/receipts', id], queryFn: () => api(`/sales/receipts/${id}`), enabled: !!id });
  const r = detail.data || receipt;
  return (
    <Drawer open={!!receipt} onClose={onClose} width={720} title={r?.receiptNo ? `Receipt ${r.receiptNo}` : 'Receipt'}>
      {id && (
        <div className="flex items-center gap-2 mb-4">
          <StatusPill status={String(r?.status || 'POSTED').replace(/_/g, ' ')} />
          <span className="text-[13px] text-[#64748b]">{r?.customer?.name}</span>
          {r?.status !== 'REVERSED' && <span className="ml-auto"><Popconfirm title="Reverse this receipt?" onConfirm={() => { onAction(`/sales/receipts/${id}/reverse`); onRefresh(); }}><Button size="small" danger icon={<UndoOutlined />}>Reverse Receipt</Button></Popconfirm></span>}
        </div>
      )}
      {r && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] mb-4">
          {[['Date', r.receiptDate ? dayjs(r.receiptDate).format('DD MMM YY') : '—'], ['Amount', fmtMoney(r.amount)], ['Method', r.method], ['Reference', r.referenceNo], ['Applied', fmtMoney(r.applied)], ['Unapplied', fmtMoney(r.unapplied)], ['Deposit To', r.depositAccountId ? 'Account' : '—'], ['Notes', r.note]].map(([l, v]) => <div key={String(l)}><div className="text-[11px] text-[#94a3b8]">{l}</div><div className="text-[13px] text-[#171a2e]">{v || '—'}</div></div>)}
        </div>
      )}
      {r?.allocations?.length > 0 && (
        <div className="rounded-xl border border-[#eef0f6] mb-4">
          <div className="grid grid-cols-[1.4fr_0.9fr_0.9fr] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide"><span>Applied To</span><span className="text-right">Original Total</span><span className="text-right">Applied</span></div>
          {r.allocations.map((a: any) => (
            <div key={a.id} className="grid grid-cols-[1.4fr_0.9fr_0.9fr] gap-3 items-center py-2 border-t border-[#f0f1f6] px-3">
              <Link href={`/sales/invoices/${a.invoiceId}/edit`} className="font-mono text-[12px] text-[#003366] hover:underline">{a.invoice?.invoiceNo}</Link>
              <span className="text-[13px] text-[#64748b] text-right">{fmtMoney(a.invoice?.total)}</span>
              <span className="text-[13px] font-medium text-right">{fmtMoney(a.amountApplied)}</span>
            </div>
          ))}
        </div>
      )}
      {id && <SalesDocumentFlow kind="invoice" record={{ id, invoiceNo: r?.invoiceNo, sourceQuote: null, sourceSalesOrder: null }} />}
      {id && <DocumentTrail type="receipt" id={id} />}
    </Drawer>
  );
}
