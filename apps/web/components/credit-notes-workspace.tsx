'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Space, Table } from 'antd';
import { DeleteOutlined, DollarOutlined, EyeOutlined, FileDoneOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UndoOutlined, ThunderboltOutlined, RobotOutlined } from '@ant-design/icons';
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

const REASONS = ['Returned Goods', 'Pricing Error', 'Overcharge', 'Damaged Goods', 'Service Cancellation', 'Discount', 'Tax Adjustment', 'Other'];
const DOC_STATUS = ['DRAFT', 'POSTED', 'VOID'];
const APP_STATUS = ['UNAPPLIED', 'PARTIALLY_APPLIED', 'APPLIED', 'REFUNDED'];
const FISC_STATUS = ['NOT_REQUIRED', 'READY', 'PENDING', 'FISCALISED', 'RETRY', 'REJECTED'];
type Line = { key: number; description: string; itemId?: string; quantity: number; unitPrice: number; taxRate: number };

export function CreditNotesWorkspace() {
  const qc = useQueryClient();
  const meta = useMeta();
  const sp = useSearchParams();
  const { message } = App.useApp();
  const list = useQuery({ queryKey: ['/sales/credit-notes'], queryFn: () => api('/sales/credit-notes') });
  const [q, setQ] = useState('');
  const [doc, setDoc] = useState('');
  const [app, setApp] = useState('');
  const [fisc, setFisc] = useState('');
  const [customer, setCustomer] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [applyCn, setApplyCn] = useState<any | null>(null);
  const [view, setView] = useState<any | null>(null);

  async function doApi(url: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST', body?: any) {
    try { await api(url, { method, body: body ? JSON.stringify(body) : undefined }); message.success('Done'); qc.invalidateQueries({ queryKey: ['/sales/credit-notes'] }); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); } catch (e: any) { message.error(e.message); }
  }

  const rows = useMemo(() => {
    const base = Array.isArray(list.data) ? list.data : [];
    let r = base;
    if (q) r = r.filter((x: any) => `${x.creditNoteNo} ${x.customer?.name || ''} ${x.reason || ''} ${x.invoice?.invoiceNo || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (doc) r = r.filter((x: any) => x.status === doc);
    if (app) r = r.filter((x: any) => x.applicationStatus === app);
    if (fisc) r = r.filter((x: any) => x.fiscalStatus === fisc);
    if (customer) r = r.filter((x: any) => x.customerId === customer);
    return r;
  }, [list.data, q, doc, app, fisc, customer]);

  const kpis = useMemo(() => {
    const base = Array.isArray(list.data) ? list.data : [];
    const posted = base.filter((x: any) => x.status === 'POSTED');
    const total = posted.reduce((s: number, x: any) => s + Number(x.total || 0), 0);
    const unapplied = posted.reduce((s: number, x: any) => s + Math.max(0, Number(x.total || 0) - Number(x.appliedAmount || 0)), 0);
    const pending = posted.filter((x: any) => ['READY', 'PENDING', 'RETRY', 'REJECTED'].includes(x.fiscalStatus)).length;
    return { count: base.length, total, unapplied, pending };
  }, [list.data]);

  const columns: ColumnsType<any> = [
    { title: 'Credit Note #', dataIndex: 'creditNoteNo', width: 130, render: (v, r) => <a className="font-mono text-[12px] font-semibold text-[#003366] hover:underline" onClick={() => setView(r)}>{v}</a> },
    { title: 'Customer', dataIndex: 'customer', render: (_v, r) => (<span className="flex items-center gap-2"><CustomerAvatar name={r.customer?.name} size={26} /><span className="text-[13px] text-[#171a2e]">{r.customer?.name || '—'}</span></span>) },
    { title: 'Date', dataIndex: 'creditNoteDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Source Invoice', render: (_v, r) => r.invoice?.invoiceNo ? <Link href={`/sales/invoices/${r.invoice.id}/edit`} className="font-mono text-[12px] text-[#003366] hover:underline">{r.invoice.invoiceNo}</Link> : '—' },
    { title: 'Total', dataIndex: 'total', width: 120, align: 'right', render: (v) => <span className="font-semibold">{fmtMoney(v)}</span> },
    { title: 'Applied', dataIndex: 'appliedAmount', width: 110, align: 'right', render: (v) => <span className="text-[13px] text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Available', width: 110, align: 'right', render: (_v, r) => <span className="text-[13px] text-[#f59e0b]">{fmtMoney(Math.max(0, Number(r.total || 0) - Number(r.appliedAmount || 0)))}</span> },
    { title: 'Application', dataIndex: 'applicationStatus', width: 130, render: (v) => <StatusPill status={String(v || '').replace(/_/g, ' ')} /> },
    { title: 'Fiscal', dataIndex: 'fiscalStatus', width: 110, render: (v) => <StatusPill status={String(v || '—').replace(/_/g, ' ')} /> },
    { title: 'Doc', dataIndex: 'status', width: 100, render: (v) => <StatusPill status={v} /> },
    { ...ACTIONS_COL, render: (_, r) => <CreditActions r={r} onView={() => setView(r)} onApply={() => setApplyCn(r)} onAction={doApi} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Credit Notes</h1><p className="text-[13px] text-[#64748b] mt-1">Customer credits, returns and invoice adjustments</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>New Credit Note</Button>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        <SummaryCard icon={<FileDoneOutlined />} label="Credit Notes" value={kpis.count} tone="#003366" />
        <SummaryCard icon={<DollarOutlined />} label="Total Credited" value={fmtMoney(kpis.total)} tone="#f59e0b" />
        <SummaryCard icon={<UndoOutlined />} label="Unapplied Credit" value={fmtMoney(kpis.unapplied)} tone="#0ea5e9" />
        <SummaryCard icon={<RobotOutlined />} label="Fiscal Pending" value={kpis.pending} tone="#dc2626" />
      </div>
      <FilterBar extra={<span className="text-[12px] text-[#94a3b8]">{rows.length} credit notes</span>}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search credit notes..." className="w-[420px] max-w-full !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="Doc status" className="!min-w-[130px] !rounded-xl" value={doc || undefined} onChange={setDoc} options={DOC_STATUS.map((s) => ({ label: s, value: s }))} />
        <Select allowClear placeholder="Application" className="!min-w-[150px] !rounded-xl" value={app || undefined} onChange={setApp} options={APP_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Select allowClear placeholder="Fiscal" className="!min-w-[130px] !rounded-xl" value={fisc || undefined} onChange={setFisc} options={FISC_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Customer" className="!min-w-[170px] !rounded-xl" value={customer || undefined} onChange={setCustomer} options={customerOptions(meta.data?.customers)} />
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/sales/credit-notes'] })} />
      </FilterBar>
      <div className="nex-card">
        {rows.length === 0 ? <EmptyState title="No credit notes" description="Create a credit note to adjust a customer balance." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>New Credit Note</Button>} /> : <Table rowKey="id" loading={list.isLoading} dataSource={rows} columns={columns} scroll={{ x: true }} pagination={{ pageSize: 10, showSizeChanger: false }} />}
      </div>
      <CreditNoteCreateDrawer open={createOpen} initialInvoiceId={sp.get('invoice') || undefined} onClose={() => setCreateOpen(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['/sales/credit-notes'] }); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); setCreateOpen(false); }} />
      <CreditNoteApplyDrawer cn={applyCn} onClose={() => setApplyCn(null)} onApplied={() => { qc.invalidateQueries({ queryKey: ['/sales/credit-notes'] }); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); setApplyCn(null); }} />
      <CreditNoteViewDrawer cn={view} onClose={() => setView(null)} onAction={doApi} />
    </div>
  );
}

function CreditActions({ r, onView, onApply, onAction }: { r: any; onView: () => void; onApply: () => void; onAction: (url: string, m?: 'POST' | 'PATCH' | 'DELETE', b?: any) => Promise<void> }) {
  const canApply = r.status === 'POSTED' && r.applicationStatus !== 'APPLIED' && Number(r.total || 0) - Number(r.appliedAmount || 0) > 0.001;
  const isDraft = r.status === 'DRAFT';
  return (
    <RowActionsMenu items={[
      { key: 'view', icon: <EyeOutlined />, label: 'View / Edit', onClick: onView },
      { key: 'apply', icon: <ThunderboltOutlined />, label: 'Apply Credit', disabled: !canApply, disabledReason: 'Credit is not available to apply', onClick: onApply },
      { key: 'void', icon: <UndoOutlined />, danger: true, label: 'Void', disabled: r.status !== 'POSTED', disabledReason: 'Only posted credit notes can be voided', confirm: 'Void this posted credit note? (reverses GL)', onClick: () => onAction(`/sales/credit-notes/${r.id}/void`) },
      { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Delete', disabled: !isDraft, disabledReason: 'Only draft credit notes can be deleted', confirm: 'Delete draft credit note?', onClick: () => onAction(`/sales/credit-notes/${r.id}`, 'DELETE') },
    ]} />
  );
}

function CreditNoteCreateDrawer({ open, initialInvoiceId, onClose, onCreated }: { open: boolean; initialInvoiceId?: string; onClose: () => void; onCreated: () => void }) {
  const meta = useMeta();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const invoices = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices'), enabled: open });
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]);
  const [saving, setSaving] = useState(false);
  const [restock, setRestock] = useState(false);
  const allInvoices = useMemo(() => (Array.isArray(invoices.data) ? invoices.data : []), [invoices.data]);
  const itemOpts = useMemo(() => (meta.data?.items || []).map((i: any) => ({ label: `${i.sku} — ${i.name}`, value: i.id, name: i.name, price: Number(i.sellingPrice || 0) })), [meta.data?.items]);
  useEffect(() => { if (open && initialInvoiceId) { const inv = allInvoices.find((i: any) => i.id === initialInvoiceId); if (inv) { form.setFieldsValue({ customerId: inv.customerId, invoiceId: inv.id }); setLines((inv.lines || []).map((l: any, i: number) => ({ key: i + 1, description: l.description, itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) }))); } } }, [open, initialInvoiceId, allInvoices]); // eslint-disable-line
  const totals = useMemo(() => { const sub = lines.reduce((s: number, l) => s + Number(l.quantity) * Number(l.unitPrice), 0); const tax = lines.reduce((s: number, l) => s + Number(l.quantity) * Number(l.unitPrice) * Number(l.taxRate) / 100, 0); return { sub, tax, total: sub + tax }; }, [lines]);
  function upd(k: number, p: Partial<Line>) { setLines((prev) => prev.map((l) => (l.key === k ? { ...l, ...p } : l))); }
  async function save(post: boolean) {
    try {
      setSaving(true);
      const v = await form.validateFields();
      if (!v.customerId) { message.warning('Select a customer'); return; }
      const mapped = lines
        .filter((l) => Number(l.quantity) > 0)
        .map((l) => ({
          description: (l.description || '').trim() || (l.itemId ? itemOpts.find((o) => o.value === l.itemId)?.name : '') || 'Credit line',
          itemId: l.itemId || undefined,
          quantity: Number(l.quantity || 0),
          unitPrice: Number(l.unitPrice || 0),
          taxRate: Number(l.taxRate || 0),
        }));
      if (!mapped.length) { message.warning('Add at least one line with quantity'); return; }
      if (restock) {
        if (!v.warehouseId) { message.warning('Select a warehouse for goods return'); return; }
        if (mapped.some((l) => !l.itemId)) { message.warning('Each restock line needs an item'); return; }
        await api('/sales/customer-returns', {
          method: 'POST',
          body: JSON.stringify({
            customerId: v.customerId,
            invoiceId: v.invoiceId || undefined,
            warehouseId: v.warehouseId,
            reason: v.reason || 'Returned Goods',
            returnedAt: v.creditNoteDate?.format('YYYY-MM-DD'),
            confirm: true,
            issueCredit: true,
            postCredit: post,
            lines: mapped,
          }),
        });
        message.success(post ? 'Goods returned, stock updated, credit posted' : 'Goods returned, stock updated, credit draft created');
      } else {
        const payload = { customerId: v.customerId, invoiceId: v.invoiceId || undefined, creditNoteDate: v.creditNoteDate?.format('YYYY-MM-DD'), reason: v.reason, lines: mapped };
        const created: any = await api('/sales/credit-notes', { method: 'POST', body: JSON.stringify(payload) });
        if (post && created?.id) await api(`/sales/credit-notes/${created.id}/post`, { method: 'POST' });
        message.success(post ? 'Credit note posted' : 'Draft saved');
      }
      onCreated();
    } catch (e: any) { message.error(e.message || 'Could not save'); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={860} title="New Credit Note" footer={<div className="flex items-center justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button onClick={() => save(false)} loading={saving}>{restock ? 'Return & Draft Credit' : 'Save Draft'}</Button><Button type="primary" onClick={() => save(true)} loading={saving}>{restock ? 'Return & Issue Credit' : 'Issue Credit'}</Button></div>}>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Form.Item label="Customer" name="customerId" rules={[{ required: true }]} className="!mb-3"><Select showSearch optionFilterProp="label" placeholder="Select customer" options={customerOptions(meta.data?.customers)} /></Form.Item>
          <Form.Item label="Credit Note Date" name="creditNoteDate" className="!mb-3" initialValue={dayjs()}><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Source Invoice" name="invoiceId" className="!mb-3"><Select allowClear showSearch optionFilterProp="label" placeholder="Select invoice" options={allInvoices.map((i: any) => ({ label: `${i.invoiceNo} · ${i.customer?.name || ''}`, value: i.id }))} /></Form.Item>
          <Form.Item label="Reason" name="reason" rules={[{ required: true }]} className="!mb-3"><Select options={REASONS.map((r) => ({ label: r, value: r }))} /></Form.Item>
          <Form.Item label="Physical goods return (restock)" className="!mb-3 md:col-span-2">
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={restock} onChange={(e) => { setRestock(e.target.checked); if (e.target.checked) form.setFieldValue('reason', 'Returned Goods'); else form.setFieldValue('warehouseId', undefined); }} /> Restock inventory (creates RETURN_IN + credit note)</label>
          </Form.Item>
          {restock && (
            <Form.Item label="Warehouse" name="warehouseId" rules={[{ required: true, message: 'Warehouse required' }]} className="!mb-3">
              <Select showSearch optionFilterProp="label" options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name || w.code, value: w.id }))} />
            </Form.Item>
          )}
        </div>
        <div className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wide mb-2">Credit Lines</div>
        {lines.map((l) => (
          <div key={l.key} className={`grid gap-3 items-center mb-2 ${restock ? 'grid-cols-[1.4fr_1.4fr_0.55fr_0.8fr_0.65fr_0.85fr_40px]' : 'grid-cols-[1.6fr_0.6fr_0.9fr_0.7fr_0.9fr_40px]'}`}>
            {restock && (
              <Select showSearch optionFilterProp="label" value={l.itemId} options={itemOpts} placeholder="Item" onChange={(v) => { const o = itemOpts.find((x) => x.value === v); upd(l.key, { itemId: v, description: l.description || o?.name || '', unitPrice: l.unitPrice || o?.price || 0 }); }} />
            )}
            <Input value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} placeholder="Description" />
            <InputNumber className="w-full" min={0} value={l.quantity} onChange={(v) => upd(l.key, { quantity: Number(v || 0) })} />
            <InputNumber className="w-full" min={0} prefix="$" value={l.unitPrice} onChange={(v) => upd(l.key, { unitPrice: Number(v || 0) })} />
            <Space.Compact className="w-full"><InputNumber className="w-full" min={0} value={l.taxRate} onChange={(v) => upd(l.key, { taxRate: Number(v || 0) })} /><Button disabled>%</Button></Space.Compact>
            <div className="text-right font-medium">{fmtMoney(Number(l.quantity) * Number(l.unitPrice) * (1 + Number(l.taxRate) / 100))}</div>
            <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} />
          </div>
        ))}
        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setLines((p) => [...p, { key: p.length + 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }])}>Add Line</Button>
        <div className="flex flex-col items-end mt-4 space-y-1 text-[13px]">
          <div className="flex justify-between w-56"><span className="text-[#64748b]">Subtotal</span><span>{fmtMoney(totals.sub)}</span></div>
          <div className="flex justify-between w-56"><span className="text-[#64748b]">Tax</span><span>{fmtMoney(totals.tax)}</span></div>
          <div className="flex justify-between w-56 font-bold text-[#003366]"><span>CREDIT TOTAL</span><span>{fmtMoney(totals.total)}</span></div>
        </div>
      </Form>
    </Drawer>
  );
}

function CreditNoteApplyDrawer({ cn, onClose, onApplied }: { cn: any; onClose: () => void; onApplied: () => void }) {
  const { message } = App.useApp();
  const [invoiceId, setInvoiceId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const invoices = useQuery({
    queryKey: ['/sales/invoices', 'apply-credit', cn?.customerId],
    queryFn: () => api('/sales/invoices'),
    enabled: !!cn,
  });
  const options = useMemo(() => {
    const rows = Array.isArray(invoices.data) ? invoices.data : [];
    return rows
      .filter((i: any) => {
        if (i.customerId !== cn?.customerId) return false;
        const st = i.invoiceStatus || i.status;
        return ['POSTED', 'PART_PAID', 'SENT', 'OVERDUE'].includes(st) || Number(i.balanceDue || 0) > 0;
      })
      .map((i: any) => ({ label: `${i.invoiceNo} · ${fmtMoney(i.total)}`, value: i.id }));
  }, [invoices.data, cn?.customerId]);
  useEffect(() => {
    if (!cn) { setInvoiceId(undefined); return; }
    setInvoiceId(cn.invoiceId || undefined);
  }, [cn]);
  async function apply() {
    if (!cn?.id) return;
    if (!invoiceId) { message.warning('Select an invoice'); return; }
    try {
      setSaving(true);
      await api(`/sales/credit-notes/${cn.id}/apply`, { method: 'POST', body: JSON.stringify({ invoiceId }) });
      message.success('Credit applied');
      onApplied();
    } catch (e: any) { message.error(e.message || 'Could not apply'); } finally { setSaving(false); }
  }
  return (
    <Drawer open={!!cn} onClose={onClose} width={480} title={cn?.creditNoteNo ? `Apply ${cn.creditNoteNo}` : 'Apply Credit'} footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={apply}>Apply Credit</Button></div>}>
      {cn && (
        <div className="space-y-4">
          <div className="text-[13px] text-[#64748b]">Customer: <span className="text-[#171a2e] font-medium">{cn.customer?.name || '—'}</span></div>
          <div className="text-[13px] text-[#64748b]">Available: <span className="text-[#171a2e] font-semibold">{fmtMoney(Math.max(0, Number(cn.total || 0) - Number(cn.appliedAmount || 0)))}</span></div>
          <div>
            <div className="text-[12px] font-medium text-[#566069] mb-1">Invoice</div>
            <Select showSearch optionFilterProp="label" className="w-full" placeholder="Select invoice" value={invoiceId} onChange={setInvoiceId} options={options} />
          </div>
        </div>
      )}
    </Drawer>
  );
}

function CreditNoteViewDrawer({ cn, onClose, onAction }: { cn: any; onClose: () => void; onAction: (url: string, m?: 'POST' | 'PATCH' | 'DELETE', b?: any) => Promise<void> }) {
  const id = cn?.id;
  const det = useQuery({ queryKey: ['/sales/credit-notes', id], queryFn: () => api(`/sales/credit-notes/${id}`), enabled: !!id });
  const r = det.data || cn;
  return (
    <Drawer open={!!cn} onClose={onClose} width={720} title={r?.creditNoteNo ? `Credit Note ${r.creditNoteNo}` : 'Credit Note'}>
      {r && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] mb-4">
          {[['Customer', r.customer?.name], ['Date', r.creditNoteDate ? dayjs(r.creditNoteDate).format('DD MMM YY') : '—'], ['Source Invoice', r.invoice?.invoiceNo], ['Reason', r.reason], ['Total', fmtMoney(r.total)], ['Applied', fmtMoney(r.appliedAmount)], ['Available', fmtMoney(Math.max(0, Number(r.total || 0) - Number(r.appliedAmount || 0)))], ['Doc Status', r.status], ['Application', String(r.applicationStatus || '').replace(/_/g, ' ')], ['Fiscal', r.fiscalStatus]].map(([l, v]) => <div key={String(l)}><div className="text-[11px] text-[#94a3b8]">{l}</div><div className="text-[13px] text-[#171a2e]">{v || '—'}</div></div>)}
        </div>
      )}
      {r?.lines?.length > 0 && (
        <div className="rounded-xl border border-[#eef0f6] mb-4">
          <div className="grid grid-cols-[1.5fr_0.6fr_0.9fr_0.7fr_0.9fr] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide"><span>Description</span><span>Qty</span><span>Rate</span><span>Tax</span><span className="text-right">Amount</span></div>
          {r.lines.map((l: any) => <div key={l.id} className="grid grid-cols-[1.5fr_0.6fr_0.9fr_0.7fr_0.9fr] gap-3 items-center py-2 border-t border-[#f0f1f6] px-3"><span className="text-[13px]">{l.description}</span><span className="text-[13px] text-[#64748b]">{Number(l.quantity)}</span><span className="text-[13px] text-[#64748b]">{fmtMoney(l.unitPrice)}</span><span className="text-[13px] text-[#64748b]">{Number(l.taxRate)}%</span><span className="text-[13px] text-right">{fmtMoney(l.lineTotal)}</span></div>)}
        </div>
      )}
      {id && <SalesDocumentFlow kind="invoice" record={{ id, invoiceNo: r?.invoice?.invoiceNo, sourceQuote: null, sourceSalesOrder: null }} />}
      {id && <DocumentTrail type="credit-note" id={id} />}
    </Drawer>
  );
}
