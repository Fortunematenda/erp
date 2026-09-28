'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Divider, Dropdown, Form, Input, InputNumber, Modal, Select, Switch, Tag, Tooltip } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, DeleteOutlined, DownOutlined, EyeOutlined, MailOutlined, PlusOutlined } from '@ant-design/icons';
import Link from 'next/link';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useMeta } from '@/lib/meta';
import { useAuth } from '@/lib/auth-store';
import { fmtMoney } from '@/lib/format';
import { FormSection, customerOptions } from '@/components/sales-ui';
import { DocViewer } from '@/components/documents/doc-viewer';
import { DocumentEmailModal } from '@/components/documents/document-email';
import type { DocOpts } from '@/components/sales/document-preview';

const TERMS = ['Net 15', 'Net 30', 'Net 60', 'Due on Receipt'];

const STATUS_TONES: Record<string, string> = {
  DRAFT: '#94a3b8', POSTED: '#0284c7', VOID: '#dc2626', AWAITING_PAYMENT: '#f59e0b',
  UNPAID: '#f59e0b', PARTIALLY_PAID: '#0284c7', PAID: '#16a34a', OVERDUE: '#dc2626',
  NOT_REQUIRED: '#94a3b8', READY: '#0284c7', PENDING: '#f59e0b', FISCALISED: '#16a34a', RETRY: '#f59e0b', REJECTED: '#dc2626',
};
const invTone = (s: string) => STATUS_TONES[s] || '#94a3b8';
const payTone = (s: string) => STATUS_TONES[s] || '#94a3b8';
const fiscTone = (s: string) => STATUS_TONES[s] || '#94a3b8';
function displayInvoiceLife(record: any) {
  const life = String(record?.invoiceStatus || record?.status || '').toUpperCase();
  if (life === 'DRAFT') return 'DRAFT';
  if (life === 'VOID') return 'VOID';
  const pay = String(record?.paymentStatus || 'UNPAID').toUpperCase();
  if (pay === 'PAID') return 'PAID';
  if (pay === 'PARTIALLY_PAID') return 'PARTIALLY PAID';
  if (pay === 'OVERDUE') return 'OVERDUE';
  return 'AWAITING PAYMENT';
}
function hexFade(hex: string, a: number) { try { const h = hex.replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return `rgba(${r}, ${g}, ${b}, ${a})`; } catch { return hex; } }
function StatusTile({ label, value, tone }: { label: string; value?: string; tone: string }) {
  return (
    <div className="rounded-lg border border-[#f1f5f9] bg-white px-3 py-2">
      <div className="text-[11px] text-[#94a3b8] mb-1.5">{label}</div>
      <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: tone, background: hexFade(tone, 0.10), border: `1px solid ${hexFade(tone, 0.22)}` }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
        {value || '—'}
      </div>
    </div>
  );
}

import { hydrateCustomerDocumentDefaults, resolveProductLinePatch, mergeDuplicateProductLine, dueDateFromTerms } from '@/components/sales/customer-defaults';
import { ProductSelect } from '@/components/sales/product-select';
/** Shared hydration path (spec: identical for Quote/Order/Invoice, manual select or ?customer= entry). */
function applyCustomerDefaults(id: string, form: any, customers: any[], opts?: { shipping?: boolean; addressField?: string }) {
  void hydrateCustomerDocumentDefaults(id, form, customers, opts);
}
const INVOICE_STATUS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PART_PAID', label: 'Partially Paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'VOID', label: 'Void' },
];
const QUOTE_STATUS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SENT', label: 'Sent' },
  { value: 'VIEWED', label: 'Viewed' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CONVERTED', label: 'Converted' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Zimbabwe', 'South Africa', 'Australia', 'Germany', 'France', 'India', 'China', 'Japan', 'Brazil', 'United Arab Emirates', 'Nigeria', 'Kenya'];

type Line = { key: number; itemId?: string; description: string; quantity: number; unitPrice: number; unit?: string; taxRate: number };
function lineTotal(l: Line) { const net = Number(l.quantity || 0) * Number(l.unitPrice || 0); const tax = net * (Number(l.taxRate || 0) / 100); return { net, tax, total: net + tax }; }

function BackBar({ to, title, actions }: { to: string; title: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
      <div className="flex items-center gap-3">
        <Link href={to} className="inline-flex items-center gap-2 rounded-lg border border-[#e6e9f0] px-3 py-1.5 text-[13px] text-[#475060] hover:border-[#cbd5e8] hover:text-[#003366] transition-colors"><ArrowLeftOutlined /> Back</Link>
        <h1 className="text-[22px] font-bold text-[#171a2e] m-0">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function InvoiceForm({ record, onSaved, initial }: { record?: any; onSaved: (id: string) => void; initial?: { customerId?: string; projectId?: string } }) {
  const { modal } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const permissions = useAuth((s) => s.permissions);
  const canPost = permissions.includes('sales.invoices.post') || permissions.includes('*') || permissions.includes('ALL');
  const [form] = Form.useForm();
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [defaultTax, setDefaultTax] = useState(0);
  const [custOpen, setCustOpen] = useState(false);
  const [itemModalKey, setItemModalKey] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [customise, setCustomise] = useState(false);
  const [opts, setOpts] = useState<DocOpts>({ showLogo: true, showTax: true });
  const [viewer, setViewer] = useState<null | { autoPrint?: boolean; autoDownload?: boolean }>(null);
  const [sendEmail, setSendEmail] = useState<null | { type: 'invoice' | 'quotation'; id: string }>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (record) {
      form.setFieldsValue({
        customerId: record.customer?.id || record.customerId,
        invoiceNo: record.invoiceNo,
        invoiceDate: record.invoiceDate ? dayjs(record.invoiceDate) : dayjs(),
        dueDate: record.dueDate ? dayjs(record.dueDate) : null,
        email: record.email || record.customer?.email || '',
        status: record.status || 'DRAFT',
        terms: record.terms || 'Net 30',
        billingAddress: record.billingAddress || '',
        branchId: record.branchId || meta.data?.branches?.[0]?.id,
      });
      setLines((record.lines || []).map((l: any, i: number) => ({ key: i + 1, itemId: l.itemId, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })));
      setNotes(record.notes || '');
    } else {
      form.resetFields();
      form.setFieldsValue({ invoiceDate: dayjs(), terms: 'Net 30', status: 'DRAFT', branchId: meta.data?.branches?.[0]?.id, customerId: initial?.customerId });
      setLines([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: defaultTax }]);
      setNotes('');
      // Customer Details → New Invoice (or quote/order link): hydrate defaults once the meta data is ready.
      if (initial?.customerId && meta.data?.customers?.length) applyCustomerDefaults(initial.customerId, form, meta.data.customers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, meta.data?.customers?.length, meta.data?.branches?.length]);

  // Keep branchId filled once meta arrives (form has no Branch field).
  useEffect(() => {
    const branchId = meta.data?.branches?.[0]?.id;
    if (!branchId) return;
    if (!form.getFieldValue('branchId')) form.setFieldValue('branchId', branchId);
  }, [form, meta.data?.branches]);

  const totals = useMemo(() => { const net = lines.reduce((s, l) => s + lineTotal(l).net, 0); const tax = lines.reduce((s, l) => s + lineTotal(l).tax, 0); return { net, tax, total: net + tax }; }, [lines]);
  const locked = !!(record && String(record.invoiceStatus || record.status || '').toUpperCase() !== 'DRAFT');

  function updateLine(k: number, patch: Partial<Line>) { setLines((p) => p.map((l) => (l.key === k ? { ...l, ...patch } : l))); }
  function removeLine(k: number) { setLines((p) => p.filter((l) => l.key !== k)); }
  function addLine() { setLines((p) => [...p, { key: p.length + 1, description: '', quantity: 1, unitPrice: 0, taxRate: defaultTax }]); }

  function saveErrorMessage(e: any) {
    const formMsg = e?.errorFields?.[0]?.errors?.[0];
    if (formMsg) return formMsg;
    if (typeof e?.message === 'string' && e.message.trim()) return e.message;
    return 'Could not save invoice';
  }

  function buildInvoiceLines() {
    const items = meta.data?.items || [];
    return lines
      .filter((l) => String(l.description || '').trim() || l.itemId)
      .map((l) => {
        const item = l.itemId ? items.find((x: any) => x.id === l.itemId) : null;
        const description = String(l.description || '').trim() || item?.name || item?.description || 'Item';
        return {
          description,
          itemId: l.itemId || undefined,
          quantity: Number(l.quantity || 0),
          unitPrice: Number(l.unitPrice || 0),
          taxRate: Number(l.taxRate || 0),
        };
      });
  }

  async function submit(mode: 'draft' | 'post' | 'send') {
    try {
      const v = await form.validateFields();
      const payloadLines = buildInvoiceLines();
      if (!payloadLines.length) {
        notify.error('Add at least one line with a product or description');
        return;
      }
      const branchId = v.branchId || record?.branchId || meta.data?.branches?.[0]?.id;
      if (!branchId) {
        notify.error('No branch configured. Add a branch in Administration first.');
        return;
      }
      setSaving(true);
      let id = record?.id;
      if (locked && record) {
        await api(`/sales/invoices/${record.id}`, { method: 'PATCH', body: JSON.stringify({ notes }) });
        notify.success('Notes updated');
        setDirty(false);
        qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
        qc.invalidateQueries({ queryKey: ['/documents/invoice', record.id] });
        qc.invalidateQueries({ queryKey: ['/documents', 'invoice', record.id] });
        qc.invalidateQueries({ queryKey: ['/documents', 'invoice', record.id, 'pdf'] });
        onSaved(record.id);
        return;
      }
      const fmtDate = (d: any) => {
        if (!d) return undefined;
        if (typeof d?.format === 'function') return d.format('YYYY-MM-DD');
        const parsed = dayjs(d);
        return parsed.isValid() ? parsed.format('YYYY-MM-DD') : undefined;
      };
      const payload = {
        branchId,
        customerId: v.customerId,
        projectId: initial?.projectId,
        invoiceNo: v.invoiceNo || undefined,
        currency: 'USD',
        fiscalRequired: true,
        invoiceDate: fmtDate(v.invoiceDate),
        terms: v.terms,
        billingAddress: v.billingAddress,
        notes,
        email: v.email || undefined,
        dueDate: fmtDate(v.dueDate),
        lines: payloadLines,
      };
      if (record) { await api(`/sales/invoices/${record.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
      else { const created = await api('/sales/invoices', { method: 'POST', body: JSON.stringify(payload) }); id = created.id; }

      if (mode === 'draft') {
        notify.success(record ? 'Draft updated' : 'Draft saved');
        qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
        qc.invalidateQueries({ queryKey: ['sales-register'] });
        qc.invalidateQueries({ queryKey: ['meta'] });
        onSaved(id);
        return;
      }

      if (!canPost) {
        notify.error('You do not have permission to post invoices.');
        onSaved(id);
        return;
      }

      const fin = await api(`/sales/invoices/${id}/finalize`, {
        method: 'POST',
        body: JSON.stringify({
          action: mode === 'send' ? 'SEND' : 'POST',
          to: v.email ? [v.email] : undefined,
          subject: `Invoice`,
        }),
      });

      if (mode === 'send') {
        if (fin.emailError) notify.warning(`Invoice posted successfully, but email could not be sent: ${fin.emailError}`);
        else if (fin.emailed) notify.success('Invoice posted and sent');
        else notify.success('Invoice posted. Use Resend if you need to email it.');
      } else {
        notify.success('Invoice posted — awaiting payment');
      }

      qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
      qc.invalidateQueries({ queryKey: ['sales-register'] });
      qc.invalidateQueries({ queryKey: ['meta'] });
      onSaved(id);
      if (mode === 'send' && fin.emailError && id) setSendEmail({ type: 'invoice', id });
    } catch (e: any) { notify.error(saveErrorMessage(e)); }
    finally { setSaving(false); }
  }

  const customers = meta.data?.customers || [];
  const taxOptions = (meta.data?.taxRates || []).map((t: any) => ({ label: `${t.name} (${Number(t.rate)}%)`, value: Number(t.rate) }));

  /** Product selected/changed → merge qty if already on another line; else resolve Rate. */
  async function onProductChange(key: number, itemId: string) {
    let didMerge = false;
    let newQty = 0;
    setLines((prev) => {
      const merged = mergeDuplicateProductLine(prev, key, itemId, () => ({ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: defaultTax }));
      if (merged.merged) {
        didMerge = true;
        newQty = merged.newQty;
        return merged.lines;
      }
      return prev;
    });
    if (didMerge) {
      setDirty(true);
      notify.info(`Quantity updated to ${newQty} — same product kept on one line`);
      return;
    }
    const customerId = form.getFieldValue('customerId');
    const currency = form.getFieldValue('currency') || 'USD';
    const { patch, warning } = await resolveProductLinePatch(itemId, meta.data?.items, customerId, currency);
    updateLine(key, patch);
    if (warning) notify.warning(warning);
  }

  const docActions = record ? (
    <>
      <Button type="primary" icon={<MailOutlined />} onClick={openEmail}>Send</Button>
      <Button icon={<EyeOutlined />} onClick={() => setViewer({})}>Preview</Button>
    </>
  ) : undefined;

  function openEmail() {
    if (!record?.id) return;
    if (dirty) {
      modal.confirm({ title: 'Unsaved changes', content: 'You have unsaved changes. Email the last saved version?', okText: 'Email saved version', cancelText: 'Cancel', onOk: () => setSendEmail({ type: 'invoice', id: record.id }) });
    } else setSendEmail({ type: 'invoice', id: record.id });
  }

  return (
    <>
      <BackBar to="/sales/invoices" title={record ? (locked ? 'Invoice' : 'Edit Draft Invoice') : 'Create Invoice'} actions={docActions} />
      <div className="nex-card p-6">
        {record && String(record.invoiceStatus || record.status || '').toUpperCase() === 'DRAFT' && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
            <span className="mt-0.5 inline-flex items-center rounded-full border border-[#cbd5e1] bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Draft</span>
            <div className="text-[13px] text-[#475569] leading-snug">
              This invoice is a draft — it does not affect accounts receivable until you <strong className="font-semibold text-[#334155]">Save &amp; send</strong> or <strong className="font-semibold text-[#334155]">Save &amp; post</strong>.
            </div>
          </div>
        )}
        <Form form={form} layout="vertical" className="grid grid-cols-1 md:grid-cols-3 gap-x-4" onValuesChange={() => setDirty(true)}>
          <Form.Item label="Customer" name="customerId" className="!mb-3" rules={[{ required: true, message: 'Select a customer' }]}>
            <Select disabled={locked} showSearch placeholder="Select customer" optionFilterProp="label" options={customerOptions(customers)} onChange={(v) => applyCustomerDefaults(v, form, customers)} popupRender={(menu) => (<><div className="p-1">{menu}</div><Divider style={{ margin: '6px 0' }} /><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setCustOpen(true)}>Add customer</Button></>)} />
          </Form.Item>
          <Form.Item label="Invoice Number" name="invoiceNo" className="!mb-3"><Input disabled={locked} placeholder="Auto-generated if blank" /></Form.Item>
          <Form.Item label="Payment Terms" name="terms" className="!mb-3"><Select disabled={locked} options={TERMS.map((t) => ({ label: t, value: t }))} onChange={(t) => { const dd = dueDateFromTerms(t, form.getFieldValue('invoiceDate')); if (dd) form.setFieldValue('dueDate', dayjs(dd)); }} /></Form.Item>
          <Form.Item label="Invoice Date" name="invoiceDate" className="!mb-3"><DatePicker disabled={locked} className="w-full" onChange={(d) => { const dd = dueDateFromTerms(form.getFieldValue('terms'), d); if (dd) form.setFieldValue('dueDate', dayjs(dd)); }} /></Form.Item>
          <Form.Item label="Due Date" name="dueDate" className="!mb-3"><DatePicker disabled={locked} className="w-full" /></Form.Item>
          <Form.Item label="Email" name="email" className="!mb-3"><Input disabled={locked} placeholder="Auto-filled from customer" /></Form.Item>
          <Form.Item label="Billing Address" name="billingAddress" className="!mb-3 md:col-span-2"><Input.TextArea disabled={locked} rows={2} placeholder="Billing address" /></Form.Item>
          <Form.Item label="Tax Rate (%)" name="taxRateId" className="!mb-3 md:col-span-3"><Select disabled={locked} allowClear placeholder="Default line tax rate" options={taxOptions} onChange={(v) => { setDefaultTax(v || 0); setLines((prev) => prev.map((l) => ({ ...l, taxRate: v || 0 }))); }} /></Form.Item>
        </Form>
        {record && (
          <div className="mb-4 rounded-xl border border-[#eef0f6] bg-gradient-to-br from-white to-[#f8fafc] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#94a3b8]">Document Status</div>
              <div className="text-[11px] text-[#cbd5e1]">INV-{record.invoiceNo}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatusTile label="Invoice Status" value={displayInvoiceLife(record)} tone={invTone(String(record.invoiceStatus) === 'DRAFT' || String(record.invoiceStatus) === 'VOID' ? record.invoiceStatus : (record.paymentStatus === 'PAID' ? 'PAID' : 'AWAITING_PAYMENT'))} />
              <StatusTile
                label="Payment Status"
                value={String(record.invoiceStatus || '').toUpperCase() === 'DRAFT' ? '—' : (record.paymentStatus || '').replace(/_/g, ' ')}
                tone={String(record.invoiceStatus || '').toUpperCase() === 'DRAFT' ? '#94a3b8' : payTone(record.paymentStatus)}
              />
              <StatusTile
                label="Fiscal Status"
                value={String(record.invoiceStatus || '').toUpperCase() === 'DRAFT' ? '—' : record.fiscalStatus}
                tone={String(record.invoiceStatus || '').toUpperCase() === 'DRAFT' ? '#94a3b8' : fiscTone(record.fiscalStatus)}
              />
            </div>
            <div className="mt-3 pt-3 border-t border-[#f1f5f9] flex items-center gap-2 flex-wrap">
              {record.invoiceStatus !== 'DRAFT' && record.invoiceStatus !== 'VOID' && (
                <Button size="small" icon={<MailOutlined />} onClick={openEmail}>Resend email</Button>
              )}
              <span className="text-[11px] text-[#94a3b8]">
                {record.invoiceStatus === 'DRAFT'
                  ? 'Drafts stay editable and off the books. Posting or sending updates accounts receivable.'
                  : 'Posted invoices update AR automatically. Material changes need a credit note.'}
              </span>
            </div>
          </div>
        )}

        <FormSection title="Line Items" />
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(200px,1.4fr)_minmax(180px,1.6fr)_0.7fr_1fr_1fr_40px] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide"><span>Product</span><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span /></div>
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[minmax(200px,1.4fr)_minmax(180px,1.6fr)_0.7fr_1fr_1fr_40px] gap-3 items-center py-2 border-t border-[#f0f1f6]">
                <ProductSelect
                  disabled={locked}
                  items={meta.data?.items}
                  value={l.itemId}
                  onChange={(v) => onProductChange(l.key, v)}
                  onAddNew={locked ? undefined : () => setItemModalKey(l.key)}
                />
                <Input disabled={locked} value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Description" />
                <InputNumber disabled={locked} className="w-full" min={0.0001} value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: Number(v || 0) })} />
                <Tooltip title="Automatically populated from the customer's price list or the product's default sales price. You may edit it if you have permission."><InputNumber disabled={locked} className="w-full" min={0} prefix="$" value={l.unitPrice} onChange={(v) => updateLine(l.key, { unitPrice: Number(v || 0) })} /></Tooltip>
                <div className="text-[13px] font-semibold text-[#171a2e] text-right">{fmtMoney(lineTotal(l).total)}</div>
                <Button disabled={locked} type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(l.key)} />
              </div>
            ))}
          </div>
        </div>
        <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine} className="mt-3" disabled={locked}>Add Line</Button>

        <div className="flex flex-col items-end mt-6 space-y-1.5">
          <div className="flex items-center gap-6 text-[13px] text-[#475060]"><span>Subtotal</span><span className="min-w-[110px] text-right text-[#171a2e] font-medium">{fmtMoney(totals.net)}</span></div>
          <div className="flex items-center gap-6 text-[13px] text-[#475060]"><span>Tax</span><span className="min-w-[110px] text-right text-[#171a2e] font-medium">{fmtMoney(totals.tax)}</span></div>
          <div className="flex items-center gap-6 text-[16px] font-bold text-[#171a2e] border-t border-[#eef0f6] pt-2"><span>Total</span><span className="min-w-[110px] text-right text-[#003366]">{fmtMoney(totals.total)}</span></div>
        </div>

        <FormSection title="Notes" />
        <Input.TextArea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Optional notes shown on the invoice" />
        {locked && (
          <div className="mt-2 text-[12px] text-[#94a3b8]">This invoice is posted — amounts and customer details are locked. Only notes can be changed; use a credit note for material corrections.</div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#eef0f6]">
        {locked ? (
          <Button type="primary" onClick={() => submit('draft')} loading={saving}>Save</Button>
        ) : canPost ? (
          <>
            <Button onClick={() => submit('draft')} loading={saving}>Save</Button>
            <div className="flex items-center gap-1.5">
              <Button type="primary" loading={saving} onClick={() => submit('send')}>Save & send</Button>
              <Dropdown
                menu={{
                  items: [
                    { key: 'send', label: 'Save & send', onClick: () => submit('send') },
                    { key: 'post', label: 'Save & post (no email)', onClick: () => submit('post') },
                  ],
                }}
              >
                <Button type="primary" icon={<DownOutlined />} loading={saving} aria-label="More save options" />
              </Dropdown>
            </div>
          </>
        ) : (
          <Button type="primary" onClick={() => submit('draft')} loading={saving}>Save</Button>
        )}
      </div>
      <QuickAddCustomer open={custOpen} onClose={() => setCustOpen(false)} onCreated={(id) => { form.setFieldValue('customerId', id); setCustOpen(false); }} />
      <QuickAddItem open={itemModalKey !== null} onClose={() => setItemModalKey(null)} onCreated={(id, name) => {
        if (itemModalKey === null) return;
        const merged = mergeDuplicateProductLine(lines, itemModalKey, id, () => ({ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: defaultTax }));
        if (merged.merged) {
          setLines(merged.lines);
          setDirty(true);
          notify.info(`Quantity updated to ${merged.newQty} — same product kept on one line`);
        } else {
          updateLine(itemModalKey, { itemId: id, description: name });
        }
        setItemModalKey(null);
      }} />
      <DocViewer open={!!viewer} onClose={() => setViewer(null)} type="invoice" id={record?.id} number={record?.invoiceNo} autoPrint={viewer?.autoPrint} autoDownload={viewer?.autoDownload} />
      <DocumentEmailModal doc={sendEmail} open={!!sendEmail} onClose={() => setSendEmail(null)} />
    </>
  );
}

export function QuoteForm({ record, onSaved, initial }: { record?: any; onSaved: (id: string) => void; initial?: { customerId?: string; projectId?: string } }) {
  const { modal } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [defaultTax, setDefaultTax] = useState(0);
  const [custOpen, setCustOpen] = useState(false);
  const [itemModalKey, setItemModalKey] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [customise, setCustomise] = useState(false);
  const [opts, setOpts] = useState<DocOpts>({ showLogo: true, showTax: true });
  const [viewer, setViewer] = useState<null | { autoPrint?: boolean; autoDownload?: boolean }>(null);
  const [sendEmail, setSendEmail] = useState<null | { type: 'invoice' | 'quotation'; id: string }>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (record) {
      form.setFieldsValue({ customerId: record.customer?.id, quotationNo: record.quotationNo, quoteDate: record.quotationDate ? dayjs(record.quotationDate) : null, validUntil: record.validUntil ? dayjs(record.validUntil) : null, email: record.customer?.email, address: record.address || '', notes: record.notes, status: String(record.status || 'DRAFT').toUpperCase() });
      setLines((record.lines || []).map((l: any, i: number) => ({ key: i + 1, itemId: l.itemId, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })));
      setNotes(record.notes || '');
    } else {
      form.resetFields();
      form.setFieldsValue({ quoteDate: dayjs(), validUntil: dayjs().add(30, 'day'), status: 'DRAFT', customerId: initial?.customerId });
      setLines([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]);
      setNotes('');
      // Customer Details → New Quote: hydrate the same shared defaults.
      if (initial?.customerId && meta.data?.customers?.length) applyCustomerDefaults(initial.customerId, form, meta.data.customers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, meta.data?.customers?.length]);

  const totals = useMemo(() => { const net = lines.reduce((s, l) => s + lineTotal(l).net, 0); const tax = lines.reduce((s, l) => s + lineTotal(l).tax, 0); return { net, tax, total: net + tax }; }, [lines]);

  function updateLine(k: number, patch: Partial<Line>) { setLines((p) => p.map((l) => (l.key === k ? { ...l, ...patch } : l))); }
  function removeLine(k: number) { setLines((p) => p.filter((l) => l.key !== k)); }
  function addLine() { setLines((p) => [...p, { key: p.length + 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]); }

  const taxOptions = (meta.data?.taxRates || []).map((t: any) => ({ label: `${t.name} (${Number(t.rate)}%)`, value: Number(t.rate) }));
  /** Quote product selected/changed → merge duplicates; else resolve Rate. */
  async function onQuoteProductChange(key: number, itemId: string) {
    let didMerge = false;
    let newQty = 0;
    setLines((prev) => {
      const merged = mergeDuplicateProductLine(prev, key, itemId, () => ({ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }));
      if (merged.merged) {
        didMerge = true;
        newQty = merged.newQty;
        return merged.lines;
      }
      return prev;
    });
    if (didMerge) {
      notify.info(`Quantity updated to ${newQty} — same product kept on one line`);
      return;
    }
    const customerId = form.getFieldValue('customerId');
    const { patch, warning } = await resolveProductLinePatch(itemId, meta.data?.items, customerId, 'USD');
    updateLine(key, patch);
    if (warning) notify.warning(warning);
  }
  async function submit(andSend = false) {
    try {
      const v = await form.validateFields();
      const payload = { branchId: meta.data?.branches?.[0]?.id, customerId: v.customerId, projectId: initial?.projectId, address: v.address, notes, validUntil: v.validUntil?.format('YYYY-MM-DD'), status: andSend ? 'SENT' : (v.status || 'DRAFT'), lines: lines.map((l) => ({ description: l.description, itemId: l.itemId, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0), taxRate: Number(l.taxRate || 0) })) };
      setSaving(true);
      let id = record?.id;
      if (record) { await api(`/sales/quotations/${record.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
      else { const created = await api('/sales/quotations', { method: 'POST', body: JSON.stringify(payload) }); id = created.id; }
      if (payload.status && payload.status !== 'DRAFT' && id) await api(`/sales/quotations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: payload.status }) }).catch(() => {});
      notify.success(andSend ? 'Quote saved' : (record ? 'Draft updated' : 'Draft saved'));
      qc.invalidateQueries({ queryKey: ['/sales/quotations'] });
      qc.invalidateQueries({ queryKey: ['sales-register'] });
      onSaved(id);
      if (andSend && id) setSendEmail({ type: 'quotation', id });
    } catch (e: any) { notify.error(e.message || 'Could not save quote'); }
    finally { setSaving(false); }
  }

  const docActions = record ? (
    <>
      <Button type="primary" icon={<MailOutlined />} onClick={openEmail}>Send</Button>
      <Button icon={<EyeOutlined />} onClick={() => setViewer({})}>Preview</Button>
    </>
  ) : undefined;

  function openEmail() {
    if (!record?.id) return;
    if (dirty) {
      modal.confirm({ title: 'Unsaved changes', content: 'You have unsaved changes. Email the last saved version?', okText: 'Email saved version', cancelText: 'Cancel', onOk: () => setSendEmail({ type: 'quotation', id: record.id }) });
    } else setSendEmail({ type: 'quotation', id: record.id });
  }

  return (
    <>
      <BackBar to="/sales/quotations" title={record ? 'Edit Quote' : 'Create Quote'} actions={docActions} />
      <div className="nex-card p-6">
        <Form form={form} layout="vertical" className="grid grid-cols-1 md:grid-cols-3 gap-x-4" onValuesChange={() => setDirty(true)}>
          <Form.Item label="Customer" name="customerId" className="!mb-3" rules={[{ required: true, message: 'Select a customer' }]}>
            <Select showSearch placeholder="Select customer" optionFilterProp="label" options={customerOptions(meta.data?.customers)} onChange={(v) => applyCustomerDefaults(v, form, meta.data?.customers || [])} popupRender={(menu) => (<><div className="p-1">{menu}</div><Divider style={{ margin: '6px 0' }} /><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setCustOpen(true)}>Add customer</Button></>)} />
          </Form.Item>
          <Form.Item label="Quote Number" name="quotationNo" className="!mb-3"><Input placeholder="Auto-generated if blank" /></Form.Item>
          <Form.Item label="Email" name="email" className="!mb-3"><Input placeholder="Auto-filled from customer" /></Form.Item>
          <Form.Item label="Quote Date" name="quoteDate" className="!mb-3"><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Expiry Date" name="validUntil" className="!mb-3"><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Tax Rate (%)" name="taxRateId" className="!mb-3"><Select allowClear placeholder="Default line tax rate" options={taxOptions} onChange={(v) => { setDefaultTax(v || 0); setLines((prev) => prev.map((l) => ({ ...l, taxRate: v || 0 }))); }} /></Form.Item>
          <Form.Item label="Address" name="address" className="!mb-3 md:col-span-2"><Input.TextArea rows={2} placeholder="Billing address — auto-filled from customer" /></Form.Item>
          <Form.Item label="Status" name="status" className="!mb-3"><Select options={QUOTE_STATUS} /></Form.Item>
        </Form>
        <FormSection title="Line Items" />
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(200px,1.4fr)_minmax(180px,1.6fr)_0.7fr_1fr_1fr_40px] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide"><span>Product</span><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span /></div>
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[minmax(200px,1.4fr)_minmax(180px,1.6fr)_0.7fr_1fr_1fr_40px] gap-3 items-center py-2 border-t border-[#f0f1f6]">
                <ProductSelect
                  items={meta.data?.items}
                  value={l.itemId}
                  onChange={(v) => onQuoteProductChange(l.key, v)}
                  onAddNew={() => setItemModalKey(l.key)}
                />
                <Input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Description" />
                <InputNumber className="w-full" min={0.0001} value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: Number(v || 0) })} placeholder="Qty" />
                <Tooltip title="Automatically populated from the customer's price list or the product's default sales price. You may edit it if you have permission."><InputNumber className="w-full" min={0} prefix="$" value={l.unitPrice} onChange={(v) => updateLine(l.key, { unitPrice: Number(v || 0) })} placeholder="Rate" /></Tooltip>
                <div className="text-[13px] font-semibold text-[#171a2e] text-right">{fmtMoney(lineTotal(l).total)}</div>
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(l.key)} />
              </div>
            ))}
          </div>
        </div>
        <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine} className="mt-3">Add Line</Button>
        <div className="flex flex-col items-end mt-6 space-y-1.5">
          <div className="flex items-center gap-6 text-[13px] text-[#475060]"><span>Subtotal</span><span className="min-w-[110px] text-right text-[#171a2e] font-medium">{fmtMoney(totals.net)}</span></div>
          <div className="flex items-center gap-6 text-[13px] text-[#475060]"><span>Tax</span><span className="min-w-[110px] text-right text-[#171a2e] font-medium">{fmtMoney(totals.tax)}</span></div>
          <div className="flex items-center gap-6 text-[16px] font-bold text-[#171a2e] border-t border-[#eef0f6] pt-2"><span>Total</span><span className="min-w-[110px] text-right text-[#003366]">{fmtMoney(totals.total)}</span></div>
        </div>

        <FormSection title="Notes" />
        <Input.TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes shown on the quote" />
      </div>
      <div className="flex items-center justify-end gap-2 mt-5">
        <Link href="/sales/quotations"><Button>Cancel</Button></Link>
        <Button onClick={() => submit(false)} loading={saving}>Save Draft</Button>
        <Button type="primary" icon={<MailOutlined />} onClick={() => submit(true)} loading={saving}>Save & Send</Button>
      </div>
      <QuickAddCustomer open={custOpen} onClose={() => setCustOpen(false)} onCreated={(id) => { form.setFieldValue('customerId', id); setCustOpen(false); }} />
      <QuickAddItem open={itemModalKey !== null} onClose={() => setItemModalKey(null)} onCreated={(id, name) => {
        if (itemModalKey === null) return;
        const merged = mergeDuplicateProductLine(lines, itemModalKey, id, () => ({ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }));
        if (merged.merged) {
          setLines(merged.lines);
          notify.info(`Quantity updated to ${merged.newQty} — same product kept on one line`);
        } else {
          updateLine(itemModalKey, { itemId: id, description: name });
        }
        setItemModalKey(null);
      }} />
      <DocViewer open={!!viewer} onClose={() => setViewer(null)} type="quotation" id={record?.id} number={record?.quotationNo} autoPrint={viewer?.autoPrint} autoDownload={viewer?.autoDownload} />
      <DocumentEmailModal doc={sendEmail} open={!!sendEmail} onClose={() => setSendEmail(null)} />
      <CustomiseModal open={customise} onClose={() => setCustomise(false)} opts={opts} onChange={setOpts} />
    </>
  );
}

function QuickAddCustomer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function save() {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const res = await api('/sales/customers', { method: 'POST', body: JSON.stringify({ name: v.name, firstName: v.firstName, lastName: v.lastName, companyName: v.companyName, email: v.email, phone: v.phone, mobile: v.mobile, address1: v.address1, address2: v.address2, city: v.city, state: v.state, zip: v.zip, country: v.country, notes: v.notes, taxStatus: v.taxStatus, defaultTaxRate: Number(v.defaultTaxRate || 0) }) });
      qc.invalidateQueries({ queryKey: ['meta'] });
      notify.success('Customer created');
      form.resetFields();
      onCreated(res.id);
    } catch (e: any) { notify.error(e.message || 'Could not create customer'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open={open} title="Add Customer" onCancel={onClose} onOk={save} confirmLoading={saving} width={520} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item label="First Name" name="firstName"><Input placeholder="First name" /></Form.Item>
        <Form.Item label="Last Name" name="lastName"><Input placeholder="Last name" /></Form.Item>
        <Form.Item label="Display Name" name="name" extra="If left blank, NexusERP will generate the display name from the company or customer name."><Input placeholder="Leave blank to auto-generate" /></Form.Item>
        <Form.Item label="Company" name="companyName"><Input placeholder="Company" /></Form.Item>
        <Form.Item label="Email" name="email"><Input placeholder="email@example.com" /></Form.Item>
        <Form.Item label="Phone" name="phone"><Input placeholder="Phone" /></Form.Item>
        <Form.Item label="Mobile" name="mobile"><Input placeholder="Mobile" /></Form.Item>
        <Form.Item label="Street Address" name="address1"><Input placeholder="Street address" /></Form.Item>
        <Form.Item label="Address Line 2" name="address2"><Input placeholder="Address line 2" /></Form.Item>
        <Form.Item label="City" name="city"><Input placeholder="City" /></Form.Item>
        <Form.Item label="State" name="state"><Input placeholder="State" /></Form.Item>
        <Form.Item label="ZIP" name="zip"><Input placeholder="ZIP" /></Form.Item>
        <Form.Item label="Country" name="country"><Select showSearch placeholder="Select country" options={COUNTRIES.map((c) => ({ label: c, value: c }))} /></Form.Item>
        <Form.Item label="Tax Status" name="taxStatus" initialValue="Taxable"><Select options={['Taxable', 'Tax Exempt'].map((s) => ({ label: s, value: s }))} /></Form.Item>
        <Form.Item label="Default Tax Rate" name="defaultTaxRate"><Select showSearch optionFilterProp="label" placeholder="Select tax rate" options={(meta?.data?.taxRates || []).map((t: any) => ({ label: `${t.name} (${Number(t.rate)}%)`, value: Number(t.rate) }))} /></Form.Item>
        <Form.Item label="Notes" name="notes"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}

function QuickAddItem({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string, name: string) => void }) {
  
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function save() {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const res = await api('/inventory/items', { method: 'POST', body: JSON.stringify({
        name: v.name,
        type: v.type || 'INVENTORY_PRODUCT',
        unit: v.unit || (v.type === 'SERVICE' ? 'Hour' : 'EA'),
        reorderLevel: Number(v.reorderLevel || 0),
        sellingPrice: Number(v.sellingPrice || 0),
      }) });
      qc.invalidateQueries({ queryKey: ['meta'] });
      notify.success('Item created');
      form.resetFields();
      onCreated(res.id, v.name);
    } catch (e: any) { notify.error(e.message || 'Could not create item'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open={open} title="Add New Item" onCancel={onClose} onOk={save} confirmLoading={saving} width={480} destroyOnHidden afterOpenChange={(v) => { if (v) form.setFieldsValue({ type: 'INVENTORY_PRODUCT', unit: 'EA' }); }}>
      <Form form={form} layout="vertical">
        <Form.Item label="Item Type" name="type" rules={[{ required: true }]}>
          <Select options={[
            { label: 'Inventory Product', value: 'INVENTORY_PRODUCT' },
            { label: 'Non-Inventory Product', value: 'NON_INVENTORY_PRODUCT' },
            { label: 'Service', value: 'SERVICE' },
          ]} />
        </Form.Item>
        <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required' }]}><Input placeholder="Item name" /></Form.Item>
        <Form.Item label="Unit" name="unit"><Input placeholder="EA, Hour, Job…" /></Form.Item>
        <Form.Item label="Selling Price / Rate" name="sellingPrice" extra="Used to auto-populate the Rate on quotes, orders and invoices."><InputNumber className="w-full" min={0} prefix="$" /></Form.Item>
        <Form.Item noStyle shouldUpdate={(p, c) => p.type !== c.type}>
          {({ getFieldValue }) => getFieldValue('type') === 'INVENTORY_PRODUCT' ? (
            <Form.Item label="Reorder Level" name="reorderLevel"><InputNumber className="w-full" min={0} /></Form.Item>
          ) : null}
        </Form.Item>
      </Form>
    </Modal>
  );
}

function CustomiseModal({ open, onClose, opts, onChange }: { open: boolean; onClose: () => void; opts: DocOpts; onChange: (o: DocOpts) => void }) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} title="Customise Template" width={420}>
      <div className="space-y-4">
        <div className="flex items-center justify-between"><span className="text-[14px] text-[#344054]">Show logo</span><Switch checked={opts.showLogo} onChange={(v) => onChange({ ...opts, showLogo: v })} /></div>
        <div className="flex items-center justify-between"><span className="text-[14px] text-[#344054]">Show tax breakdown</span><Switch checked={opts.showTax} onChange={(v) => onChange({ ...opts, showTax: v })} /></div>
        <div className="pt-2"><Button block onClick={onClose}>Done</Button></div>
      </div>
    </Modal>
  );
}


