'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Drawer, Form, Input, InputNumber, Modal, Select, Table } from 'antd';
import { DeleteOutlined, DollarOutlined, EyeOutlined, FileDoneOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UndoOutlined, WalletOutlined, RobotOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtMoney } from '@/lib/format';
import { CustomerAvatar, EmptyState, FilterBar, StatusPill, SummaryCard, customerOptions } from '@/components/sales-ui';
import { SalesDocumentFlow } from '@/components/sales/related-transactions';
import { DocumentTrail } from '@/components/documents/document-trail';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const REASONS = ['Undercharge', 'Additional Service', 'Additional Quantity', 'Freight / Delivery', 'Surcharge', 'Pricing Correction', 'Tax Adjustment', 'Backorder', 'Other'];
const DOC_STATUS = ['DRAFT', 'POSTED', 'VOID'];
const PAY_STATUS = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
const FISC_STATUS = ['NOT_REQUIRED', 'READY', 'PENDING', 'FISCALISED', 'RETRY', 'REJECTED'];
type Line = { key: number; description: string; quantity: number; unitPrice: number; taxRate: number };

export function DebitNotesWorkspace() {
  const qc = useQueryClient();
  const meta = useMeta();
  const sp = useSearchParams();
  const { message } = App.useApp();
  const list = useQuery({ queryKey: ['/sales/debit-notes'], queryFn: () => api('/sales/debit-notes') });
  const [q, setQ] = useState('');
  const [doc, setDoc] = useState('');
  const [pay, setPay] = useState('');
  const [fisc, setFisc] = useState('');
  const [customer, setCustomer] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [payCn, setPayCn] = useState<any | null>(null);
  const [view, setView] = useState<any | null>(null);

  async function doApi(url: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST', body?: any) {
    try { await api(url, { method, body: body ? JSON.stringify(body) : undefined }); message.success('Done'); qc.invalidateQueries({ queryKey: ['/sales/debit-notes'] }); } catch (e: any) { message.error(e.message); }
  }

  const rows = useMemo(() => {
    const base = Array.isArray(list.data) ? list.data : [];
    let r = base;
    if (q) r = r.filter((x: any) => `${x.debitNoteNo} ${x.customer?.name || ''} ${x.reason || ''} ${x.invoice?.invoiceNo || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (doc) r = r.filter((x: any) => x.status === doc);
    if (pay) r = r.filter((x: any) => x.paymentStatus === pay);
    if (fisc) r = r.filter((x: any) => x.fiscalStatus === fisc);
    if (customer) r = r.filter((x: any) => x.customerId === customer);
    return r;
  }, [list.data, q, doc, pay, fisc, customer]);

  const kpis = useMemo(() => {
    const base = Array.isArray(list.data) ? list.data : [];
    const posted = base.filter((x: any) => x.status === 'POSTED');
    const total = posted.reduce((s: number, x: any) => s + Number(x.total || 0), 0);
    const outstanding = posted.reduce((s: number, x: any) => s + Number(x.balanceDue ?? (Number(x.total || 0) - Number(x.amountPaid || 0))), 0);
    const pending = posted.filter((x: any) => ['READY', 'PENDING', 'RETRY', 'REJECTED'].includes(x.fiscalStatus)).length;
    return { count: base.length, total, outstanding, pending };
  }, [list.data]);

  const columns: ColumnsType<any> = [
    { title: 'Debit Note #', dataIndex: 'debitNoteNo', width: 130, render: (v, r) => <a className="font-mono text-[12px] font-semibold text-[#003366] hover:underline" onClick={() => setView(r)}>{v}</a> },
    { title: 'Customer', dataIndex: 'customer', render: (_v, r) => (<span className="flex items-center gap-2"><CustomerAvatar name={r.customer?.name} size={26} /><span className="text-[13px] text-[#171a2e]">{r.customer?.name || '—'}</span></span>) },
    { title: 'Date', dataIndex: 'date', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Source Invoice', render: (_v, r) => r.invoice?.invoiceNo ? <Link href={`/sales/invoices/${r.invoice.id}/edit`} className="font-mono text-[12px] text-[#003366] hover:underline">{r.invoice.invoiceNo}</Link> : '—' },
    { title: 'Total', dataIndex: 'total', width: 110, align: 'right', render: (v) => <span className="font-semibold">{fmtMoney(v)}</span> },
    { title: 'Paid', dataIndex: 'amountPaid', width: 100, align: 'right', render: (v) => <span className="text-[13px] text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Balance', width: 110, align: 'right', render: (_v, r) => <span className="text-[13px] font-semibold text-[#f59e0b]">{fmtMoney(Number(r.balanceDue ?? Number(r.total || 0) - Number(r.amountPaid || 0)))}</span> },
    { title: 'Payment', dataIndex: 'paymentStatus', width: 120, render: (v) => <StatusPill status={String(v || 'UNPAID').replace(/_/g, ' ')} /> },
    { title: 'Fiscal', dataIndex: 'fiscalStatus', width: 110, render: (v) => <StatusPill status={String(v || '—').replace(/_/g, ' ')} /> },
    { title: 'Doc', dataIndex: 'status', width: 100, render: (v) => <StatusPill status={v} /> },
    { ...ACTIONS_COL, render: (_, r) => <DebitActions r={r} onView={() => setView(r)} onPay={() => setPayCn(r)} onAction={doApi} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Debit Notes</h1><p className="text-[13px] text-[#64748b] mt-1">Additional customer charges and receivable adjustments</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>New Debit Note</Button>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        <SummaryCard icon={<FileDoneOutlined />} label="Debit Notes" value={kpis.count} tone="#003366" />
        <SummaryCard icon={<DollarOutlined />} label="Total Debited" value={fmtMoney(kpis.total)} tone="#f59e0b" />
        <SummaryCard icon={<WalletOutlined />} label="Outstanding" value={fmtMoney(kpis.outstanding)} tone="#0ea5e9" />
        <SummaryCard icon={<RobotOutlined />} label="Fiscal Pending" value={kpis.pending} tone="#dc2626" />
      </div>
      <FilterBar extra={<span className="text-[12px] text-[#94a3b8]">{rows.length} debit notes</span>}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search debit notes..." className="w-[420px] max-w-full !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="Doc status" className="!min-w-[130px] !rounded-xl" value={doc || undefined} onChange={setDoc} options={DOC_STATUS.map((s) => ({ label: s, value: s }))} />
        <Select allowClear placeholder="Payment" className="!min-w-[150px] !rounded-xl" value={pay || undefined} onChange={setPay} options={PAY_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Select allowClear placeholder="Fiscal" className="!min-w-[130px] !rounded-xl" value={fisc || undefined} onChange={setFisc} options={FISC_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Customer" className="!min-w-[170px] !rounded-xl" value={customer || undefined} onChange={setCustomer} options={customerOptions(meta.data?.customers)} />
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/sales/debit-notes'] })} />
      </FilterBar>
      <div className="nex-card">
        {rows.length === 0 ? <EmptyState title="No debit notes" description="Create a debit note for additional customer charges." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>New Debit Note</Button>} /> : <Table rowKey="id" loading={list.isLoading} dataSource={rows} columns={columns} scroll={{ x: true }} pagination={{ pageSize: 10, showSizeChanger: false }} />}
      </div>
      <DebitNoteCreateDrawer open={createOpen} initialInvoiceId={sp.get('invoice') || undefined} onClose={() => setCreateOpen(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['/sales/debit-notes'] }); setCreateOpen(false); }} />
      <PayDebitModal dn={payCn} onClose={() => setPayCn(null)} onAction={doApi} />
      <DebitNoteViewDrawer dn={view} onClose={() => setView(null)} onAction={doApi} />
    </div>
  );
}

function DebitActions({ r, onView, onPay, onAction }: { r: any; onView: () => void; onPay: () => void; onAction: (url: string, m?: 'POST' | 'PATCH' | 'DELETE', b?: any) => Promise<void> }) {
  const canPay = r.status === 'POSTED' && ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(r.paymentStatus) && Number(r.balanceDue ?? (Number(r.total || 0) - Number(r.amountPaid || 0))) > 0.001;
  const isDraft = r.status === 'DRAFT';
  return (
    <RowActionsMenu items={[
      { key: 'view', icon: <EyeOutlined />, label: 'View / Edit', onClick: onView },
      { key: 'pay', icon: <WalletOutlined />, label: 'Receive Payment', disabled: !canPay, disabledReason: 'Debit note is not payable in its current status', onClick: onPay },
      { key: 'void', icon: <UndoOutlined />, danger: true, label: 'Void', disabled: r.status !== 'POSTED', disabledReason: 'Only posted debit notes can be voided', confirm: 'Void this posted debit note? (reverses GL)', onClick: () => onAction(`/sales/debit-notes/${r.id}/void`) },
      { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Delete', disabled: !isDraft, disabledReason: 'Only draft debit notes can be deleted', confirm: 'Delete draft debit note?', onClick: () => onAction(`/sales/debit-notes/${r.id}`, 'DELETE') },
    ]} />
  );
}

function DebitNoteCreateDrawer({ open, initialInvoiceId, onClose, onCreated }: { open: boolean; initialInvoiceId?: string; onClose: () => void; onCreated: () => void }) {
  const meta = useMeta();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const invoices = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices'), enabled: open });
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]);
  const [saving, setSaving] = useState(false);
  const allInvoices = useMemo(() => (Array.isArray(invoices.data) ? invoices.data : []), [invoices.data]);
  useEffect(() => { if (open && initialInvoiceId) { const inv = allInvoices.find((i: any) => i.id === initialInvoiceId); if (inv) form.setFieldsValue({ customerId: inv.customerId, invoiceId: inv.id }); } }, [open, initialInvoiceId, allInvoices]);
  const totals = useMemo(() => { const sub = lines.reduce((s: number, l) => s + Number(l.quantity) * Number(l.unitPrice), 0); const tax = lines.reduce((s: number, l) => s + Number(l.quantity) * Number(l.unitPrice) * Number(l.taxRate) / 100, 0); return { sub, tax, total: sub + tax }; }, [lines]);
  function upd(k: number, p: Partial<Line>) { setLines((prev) => prev.map((l) => (l.key === k ? { ...l, ...p } : l))); }
  async function save(post: boolean) {
    try { setSaving(true); const v = await form.validateFields(); if (!v.customerId) { message.warning('Select a customer'); return; }
      const payload = { customerId: v.customerId, invoiceId: v.invoiceId || undefined, date: v.date?.format('YYYY-MM-DD'), reason: v.reason, lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0), taxRate: Number(l.taxRate || 0) })) };
      const created: any = await api('/sales/debit-notes', { method: 'POST', body: JSON.stringify(payload) });
      if (post && created?.id) await api(`/sales/debit-notes/${created.id}/post`, { method: 'POST' });
      message.success(post ? 'Debit note posted' : 'Draft saved'); onCreated();
    } catch (e: any) { message.error(e.message || 'Could not save'); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={820} title="New Debit Note" footer={<div className="flex items-center justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button onClick={() => save(false)} loading={saving}>Save Draft</Button><Button type="primary" onClick={() => save(true)} loading={saving}>Post Debit Note</Button></div>}>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Form.Item label="Customer" name="customerId" rules={[{ required: true }]} className="!mb-3"><Select showSearch optionFilterProp="label" placeholder="Select customer" options={customerOptions(meta.data?.customers)} /></Form.Item>
          <Form.Item label="Debit Note Date" name="date" className="!mb-3" initialValue={dayjs()}><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Source Invoice" name="invoiceId" className="!mb-3"><Select allowClear showSearch optionFilterProp="label" placeholder="Select invoice" options={allInvoices.map((i: any) => ({ label: `${i.invoiceNo} · ${i.customer?.name || ''}`, value: i.id }))} /></Form.Item>
          <Form.Item label="Reason" name="reason" rules={[{ required: true }]} className="!mb-3"><Select options={REASONS.map((r) => ({ label: r, value: r }))} /></Form.Item>
        </div>
        <div className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wide mb-2">Additional Charges</div>
        {lines.map((l) => (
          <div key={l.key} className="grid grid-cols-[1.6fr_0.6fr_0.9fr_0.7fr_0.9fr_40px] gap-3 items-center mb-2">
            <Input value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} placeholder="Product / Charge" />
            <InputNumber className="w-full" min={0} value={l.quantity} onChange={(v) => upd(l.key, { quantity: Number(v || 0) })} />
            <InputNumber className="w-full" min={0} prefix="$" value={l.unitPrice} onChange={(v) => upd(l.key, { unitPrice: Number(v || 0) })} />
            <InputNumber className="w-full" min={0} value={l.taxRate} onChange={(v) => upd(l.key, { taxRate: Number(v || 0) })} addonAfter="%" />
            <div className="text-right font-medium">{fmtMoney(Number(l.quantity) * Number(l.unitPrice) * (1 + Number(l.taxRate) / 100))}</div>
            <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} />
          </div>
        ))}
        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setLines((p) => [...p, { key: p.length + 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }])}>Add Line</Button>
        <div className="flex flex-col items-end mt-4 space-y-1 text-[13px]">
          <div className="flex justify-between w-56"><span className="text-[#64748b]">Subtotal</span><span>{fmtMoney(totals.sub)}</span></div>
          <div className="flex justify-between w-56"><span className="text-[#64748b]">Tax</span><span>{fmtMoney(totals.tax)}</span></div>
          <div className="flex justify-between w-56 font-bold text-[#003366]"><span>DEBIT TOTAL</span><span>{fmtMoney(totals.total)}</span></div>
        </div>
      </Form>
    </Drawer>
  );
}

function PayDebitModal({ dn, onClose, onAction }: { dn: any; onClose: () => void; onAction: (url: string, m?: 'POST' | 'PATCH' | 'DELETE', b?: any) => Promise<void> }) {
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const bal = Number(dn?.balanceDue ?? (Number(dn?.total || 0) - Number(dn?.amountPaid || 0)));
  useEffect(() => { setAmount(bal); }, [bal]);
  return (
    <Modal open={!!dn} onCancel={onClose} title={`Receive Payment · ${dn?.debitNoteNo || ''}`} okText="Post Payment" okButtonProps={{ loading: busy }} onOk={async () => { setBusy(true); try { await onAction(`/sales/debit-notes/${dn.id}/pay`, 'POST', { amount }); onClose(); } finally { setBusy(false); } }}>
      <div className="text-[13px] text-[#64748b] mb-3">Balance Due <b className="text-[#171a2e]">{fmtMoney(bal)}</b></div>
      <InputNumber className="w-full" prefix="$" min={0} max={bal} value={amount} onChange={(v) => setAmount(Number(v || 0))} />
    </Modal>
  );
}

function DebitNoteViewDrawer({ dn, onClose, onAction }: { dn: any; onClose: () => void; onAction: (url: string, m?: 'POST' | 'PATCH' | 'DELETE', b?: any) => Promise<void> }) {
  const id = dn?.id;
  const det = useQuery({ queryKey: ['/sales/debit-notes', id], queryFn: () => api(`/sales/debit-notes/${id}`), enabled: !!id });
  const r = det.data || dn;
  return (
    <Drawer open={!!dn} onClose={onClose} width={720} title={r?.debitNoteNo ? `Debit Note ${r.debitNoteNo}` : 'Debit Note'}>
      {r && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] mb-4">
          {[['Customer', r.customer?.name], ['Date', r.date ? dayjs(r.date).format('DD MMM YY') : '—'], ['Source Invoice', r.invoice?.invoiceNo], ['Reason', r.reason], ['Total', fmtMoney(r.total)], ['Paid', fmtMoney(r.amountPaid)], ['Balance', fmtMoney(Number(r.balanceDue ?? Number(r.total || 0) - Number(r.amountPaid || 0)))], ['Payment Status', String(r.paymentStatus || 'UNPAID').replace(/_/g, ' ')], ['Doc Status', r.status], ['Fiscal', r.fiscalStatus]].map(([l, v]) => <div key={String(l)}><div className="text-[11px] text-[#94a3b8]">{l}</div><div className="text-[13px] text-[#171a2e]">{v || '—'}</div></div>)}
        </div>
      )}
      {r?.lines?.length > 0 && (
        <div className="rounded-xl border border-[#eef0f6] mb-4">
          <div className="grid grid-cols-[1.5fr_0.6fr_0.9fr_0.7fr_0.9fr] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide"><span>Description</span><span>Qty</span><span>Rate</span><span>Tax</span><span className="text-right">Amount</span></div>
          {r.lines.map((l: any) => <div key={l.id} className="grid grid-cols-[1.5fr_0.6fr_0.9fr_0.7fr_0.9fr] gap-3 items-center py-2 border-t border-[#f0f1f6] px-3"><span className="text-[13px]">{l.description}</span><span className="text-[13px] text-[#64748b]">{Number(l.quantity)}</span><span className="text-[13px] text-[#64748b]">{fmtMoney(l.unitPrice)}</span><span className="text-[13px] text-[#64748b]">{Number(l.taxRate)}%</span><span className="text-[13px] text-right">{fmtMoney(l.lineTotal)}</span></div>)}
        </div>
      )}
      {id && <SalesDocumentFlow kind="invoice" record={{ id, invoiceNo: r?.invoice?.invoiceNo, sourceQuote: null, sourceSalesOrder: null }} />}
      {id && <DocumentTrail type="debit-note" id={id} />}
    </Drawer>
  );
}
