'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Divider, Form, Input, InputNumber, Modal, Select, Switch, Tag, Tooltip, message } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, DeleteOutlined, EyeOutlined, MailOutlined, PlusOutlined, PrinterOutlined, DownloadOutlined, SettingOutlined } from '@ant-design/icons';
import Link from 'next/link';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtMoney } from '@/lib/format';
import { FormSection, customerOptions } from '@/components/sales-ui';
import { DocViewer } from '@/components/documents/doc-viewer';
import { DocumentEmailModal } from '@/components/documents/document-email';
import type { DocOpts } from '@/components/sales/document-preview';

const TERMS = ['Net 15', 'Net 30', 'Net 60', 'Due on Receipt'];

const STATUS_TONES: Record<string, string> = {
  DRAFT: '#94a3b8', POSTED: '#0284c7', VOID: '#dc2626',
  UNPAID: '#f59e0b', PARTIALLY_PAID: '#0284c7', PAID: '#16a34a', OVERDUE: '#dc2626',
  NOT_REQUIRED: '#94a3b8', READY: '#0284c7', PENDING: '#f59e0b', FISCALISED: '#16a34a', RETRY: '#f59e0b', REJECTED: '#dc2626',
};
const invTone = (s: string) => STATUS_TONES[s] || '#94a3b8';
const payTone = (s: string) => STATUS_TONES[s] || '#94a3b8';
const fiscTone = (s: string) => STATUS_TONES[s] || '#94a3b8';
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

import { hydrateCustomerDocumentDefaults, resolveProductLinePatch, productOptions, dueDateFromTerms } from '@/components/sales/customer-defaults';
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
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [defaultTax, setDefaultTax] = useState(0);
  const [custOpen, setCustOpen] = useState(false);
  const [itemModalKey, setItemModalKey] = useState<number | null>(null);
  const [messageText, setMessageText] = useState('');
  const [memo, setMemo] = useState('');
  const [customise, setCustomise] = useState(false);
  const [opts, setOpts] = useState<DocOpts>({ showLogo: true, showTax: true });
  const [viewer, setViewer] = useState<null | { autoPrint: boolean }>(null);
  const [sendEmail, setSendEmail] = useState<null | { type: 'invoice' | 'quotation'; id: string }>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (record) {
      form.setFieldsValue({ customerId: record.customer?.id, invoiceNo: record.invoiceNo, invoiceDate: record.invoiceDate ? dayjs(record.invoiceDate) : dayjs(), dueDate: record.dueDate ? dayjs(record.dueDate) : null, email: record.email || record.customer?.email || '', status: record.status || 'DRAFT', terms: record.terms || 'Net 30', billingAddress: record.billingAddress || '' });
      setLines((record.lines || []).map((l: any, i: number) => ({ key: i + 1, itemId: l.itemId, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })));
      setMessageText(record.notes || ''); setMemo(record.statementMemo || '');
    } else {
      form.resetFields();
      form.setFieldsValue({ invoiceDate: dayjs(), terms: 'Net 30', status: 'DRAFT', branchId: meta.data?.branches?.[0]?.id, customerId: initial?.customerId });
      setLines([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: defaultTax }]);
      // Customer Details → New Invoice (or quote/order link): hydrate defaults once the meta data is ready.
      if (initial?.customerId && meta.data?.customers?.length) applyCustomerDefaults(initial.customerId, form, meta.data.customers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, meta.data?.customers?.length]);

  const totals = useMemo(() => { const net = lines.reduce((s, l) => s + lineTotal(l).net, 0); const tax = lines.reduce((s, l) => s + lineTotal(l).tax, 0); return { net, tax, total: net + tax }; }, [lines]);
  const locked = !!(record && String(record.invoiceStatus || record.status || '').toUpperCase() !== 'DRAFT');

  function updateLine(k: number, patch: Partial<Line>) { setLines((p) => p.map((l) => (l.key === k ? { ...l, ...patch } : l))); }
  function removeLine(k: number) { setLines((p) => p.filter((l) => l.key !== k)); }
  function addLine() { setLines((p) => [...p, { key: p.length + 1, description: '', quantity: 1, unitPrice: 0, taxRate: defaultTax }]); }

  async function submit(mode: 'draft' | 'save') {
    try {
      const v = await form.validateFields();
      setSaving(true);
      let id = record?.id;
      if (locked && record) {
        await api(`/sales/invoices/${record.id}`, { method: 'PATCH', body: JSON.stringify({ notes: messageText, statementMemo: memo, customerReference: record.customerReference, poReference: record.poReference }) });
        message.success('Notes saved. Financial fields on posted invoices cannot be changed.');
        qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
        onSaved(record.id);
        return;
      }
      const payload = { branchId: v.branchId || meta.data?.branches?.[0]?.id, customerId: v.customerId, projectId: initial?.projectId, invoiceNo: v.invoiceNo || undefined, currency: 'USD', fiscalRequired: true, invoiceDate: v.invoiceDate ? v.invoiceDate.format('YYYY-MM-DD') : undefined, terms: v.terms, billingAddress: v.billingAddress, notes: messageText, statementMemo: memo, email: v.email, dueDate: v.dueDate ? v.dueDate.format('YYYY-MM-DD') : undefined, lines: lines.map((l) => ({ description: l.description, itemId: l.itemId, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0), taxRate: Number(l.taxRate || 0) })) };
      if (record) { await api(`/sales/invoices/${record.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
      else { const created = await api('/sales/invoices', { method: 'POST', body: JSON.stringify(payload) }); id = created.id; }
      if (mode === 'save' && id && v.status) {
        if (v.status === 'POSTED' && (!record || record.status === 'DRAFT')) await api(`/sales/invoices/${id}/post`, { method: 'POST' }).catch(() => {});
        else if (v.status !== 'DRAFT' && (record ? record.status : 'DRAFT') !== v.status) await api(`/sales/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: v.status }) }).catch(() => {});
      }
      message.success(record ? 'Invoice updated' : 'Invoice saved');
      qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
      qc.invalidateQueries({ queryKey: ['sales-register'] });
      qc.invalidateQueries({ queryKey: ['meta'] });
      onSaved(id);
    } catch (e: any) { message.error(e.message || 'Could not save invoice'); }
    finally { setSaving(false); }
  }

  const customers = meta.data?.customers || [];
  const taxOptions = (meta.data?.taxRates || []).map((t: any) => ({ label: `${t.name} (${Number(t.rate)}%)`, value: Number(t.rate) }));
  const itemOptions = productOptions(meta.data?.items);

  /** Product selected/changed → re-resolve Rate from PricingService; manual rates only refresh on product change. */
  async function onProductChange(key: number, itemId: string) {
    const customerId = form.getFieldValue('customerId');
    const currency = form.getFieldValue('currency') || 'USD';
    const { patch, warning } = await resolveProductLinePatch(itemId, meta.data?.items, customerId, currency);
    updateLine(key, patch);
    if (warning) message.warning(warning);
  }

  const docActions = (<>
    <Button icon={<EyeOutlined />} onClick={() => setViewer({ autoPrint: false })}>Preview</Button>
    <Button icon={<MailOutlined />} onClick={openEmail}>Send Email</Button>
    <Button icon={<PrinterOutlined />} onClick={() => setViewer({ autoPrint: true })}>Print</Button>
    <Button icon={<DownloadOutlined />} onClick={() => setViewer({ autoPrint: false })}>PDF</Button>
  </>);

  function openEmail() {
    if (!record?.id) return;
    if (dirty) {
      Modal.confirm({ title: 'Unsaved changes', content: 'You have unsaved changes. Email the last saved version?', okText: 'Email saved version', cancelText: 'Cancel', onOk: () => setSendEmail({ type: 'invoice', id: record.id }) });
    } else setSendEmail({ type: 'invoice', id: record.id });
  }

  return (
    <>
      <BackBar to="/sales/invoices" title={record ? 'Edit Invoice' : 'Create Invoice'} actions={record ? docActions : undefined} />
      <div className="nex-card p-6">
        <Form form={form} layout="vertical" className="grid grid-cols-1 md:grid-cols-3 gap-x-4" onValuesChange={() => setDirty(true)}>
          <Form.Item label="Customer" name="customerId" className="!mb-3" rules={[{ required: true, message: 'Select a customer' }]}>
            <Select disabled={locked} showSearch placeholder="Select customer" optionFilterProp="label" options={customerOptions(customers)} onChange={(v) => applyCustomerDefaults(v, form, customers)} popupRender={(menu) => (<><div className="p-1">{menu}</div><Divider style={{ margin: '6px 0' }} /><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setCustOpen(true)}>Add customer</Button></>)} />
          </Form.Item>
          <Form.Item label="Invoice Number" name="invoiceNo" className="!mb-3"><Input disabled={locked} placeholder="Auto-generated if blank" /></Form.Item>
          <Form.Item label="Payment Terms" name="terms" className="!mb-3"><Select disabled={locked} options={TERMS.map((t) => ({ label: t, value: t }))} onChange={(t) => { const dd = dueDateFromTerms(t, form.getFieldValue('invoiceDate')); if (dd) form.setFieldValue('dueDate', dayjs(dd)); }} /></Form.Item>
          <Form.Item label="Invoice Date" name="invoiceDate" className="!mb-3"><DatePicker disabled={locked} className="w-full" onChange={(d) => { const dd = dueDateFromTerms(form.getFieldValue('terms'), d); if (dd) form.setFieldValue('dueDate', dayjs(dd)); }} /></Form.Item>
          <Form.Item label="Due Date" name="dueDate" className="!mb-3"><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Email" name="email" className="!mb-3"><Input placeholder="Auto-filled from customer" /></Form.Item>
          <Form.Item label="Billing Address" name="billingAddress" className="!mb-3 md:col-span-2"><Input.TextArea rows={2} placeholder="Billing address" /></Form.Item>
          <Form.Item label="Tax Rate (%)" name="taxRateId" className="!mb-3 md:col-span-3"><Select allowClear placeholder="Default line tax rate" options={taxOptions} onChange={(v) => { setDefaultTax(v || 0); setLines((prev) => prev.map((l) => ({ ...l, taxRate: v || 0 }))); }} /></Form.Item>
        </Form>
        {record && (
          <div className="mb-4 rounded-xl border border-[#eef0f6] bg-gradient-to-br from-white to-[#f8fafc] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#94a3b8]">Document Status</div>
              <div className="text-[11px] text-[#cbd5e1]">INV-{record.invoiceNo}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatusTile label="Invoice Status" value={record.invoiceStatus} tone={invTone(record.invoiceStatus)} />
              <StatusTile label="Payment Status" value={(record.paymentStatus || '').replace(/_/g, ' ')} tone={payTone(record.paymentStatus)} />
              <StatusTile label="Fiscal Status" value={record.fiscalStatus} tone={fiscTone(record.fiscalStatus)} />
            </div>
            <div className="mt-3 pt-3 border-t border-[#f1f5f9] flex items-center gap-2">
              {record.invoiceStatus === 'DRAFT' && <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => api(`/sales/invoices/${record.id}/post`, { method: 'POST' }).then(() => { message.success('Invoice posted'); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); }).catch((e: any) => message.error(e.message))}>Post Invoice</Button>}
              <span className="text-[11px] text-[#94a3b8]">Invoice lifecycle (DRAFT → POSTED → VOID) is independent of Payment Status (UNPAID / PARTIALLY PAID / PAID). Posted financial fields cannot be edited — use a credit note.</span>
            </div>
          </div>
        )}

        <FormSection title="Line Items" />
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[1.3fr_1.8fr_0.7fr_1fr_1fr_40px] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide"><span>Product</span><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span /></div>
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[1.3fr_1.8fr_0.7fr_1fr_1fr_40px] gap-3 items-center py-2 border-t border-[#f0f1f6]">
                <Select disabled={locked} className="w-full" showSearch optionFilterProp="label" placeholder="Product" options={itemOptions} value={l.itemId} onChange={(v) => onProductChange(l.key, v)} popupRender={(menu) => (<><div className="p-1">{menu}</div><Divider style={{ margin: '6px 0' }} /><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setItemModalKey(l.key)}>Add new item</Button></>)} />
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

        <FormSection title="Message" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-[13px] font-medium text-[#344054] mb-1">Message on Invoice</div>
            <Input.TextArea rows={2} value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Message shown on the invoice" />
          </div>
          <div>
            <div className="text-[13px] font-medium text-[#344054] mb-1">Statement Memo</div>
            <Input.TextArea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo for customer statement" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-5">
        <Link href="/sales/invoices"><Button>Cancel</Button></Link>
        {!locked && <Button onClick={() => submit('draft')} loading={saving}>Save as Draft</Button>}
        <Button type="primary" onClick={() => submit('save')} loading={saving}>{locked ? 'Save notes' : 'Save Invoice'}</Button>
      </div>
      <QuickAddCustomer open={custOpen} onClose={() => setCustOpen(false)} onCreated={(id) => { form.setFieldValue('customerId', id); setCustOpen(false); }} />
      <QuickAddItem open={itemModalKey !== null} onClose={() => setItemModalKey(null)} onCreated={(id, name) => { if (itemModalKey !== null) updateLine(itemModalKey, { itemId: id, description: name }); setItemModalKey(null); }} />
      <DocViewer open={!!viewer} onClose={() => setViewer(null)} type="invoice" id={record?.id} autoPrint={viewer?.autoPrint} />
      <DocumentEmailModal doc={sendEmail} open={!!sendEmail} onClose={() => setSendEmail(null)} />
    </>
  );
}

export function QuoteForm({ record, onSaved, initial }: { record?: any; onSaved: (id: string) => void; initial?: { customerId?: string; projectId?: string } }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [defaultTax, setDefaultTax] = useState(0);
  const [custOpen, setCustOpen] = useState(false);
  const [itemModalKey, setItemModalKey] = useState<number | null>(null);
  const [messageText, setMessageText] = useState('');
  const [memo, setMemo] = useState('');
  const [customise, setCustomise] = useState(false);
  const [opts, setOpts] = useState<DocOpts>({ showLogo: true, showTax: true });
  const [viewer, setViewer] = useState<null | { autoPrint: boolean }>(null);
  const [sendEmail, setSendEmail] = useState<null | { type: 'invoice' | 'quotation'; id: string }>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (record) {
      form.setFieldsValue({ customerId: record.customer?.id, quotationNo: record.quotationNo, quoteDate: record.quotationDate ? dayjs(record.quotationDate) : null, validUntil: record.validUntil ? dayjs(record.validUntil) : null, email: record.customer?.email, address: record.address || '', notes: record.notes, status: String(record.status || 'DRAFT').toUpperCase() });
      setLines((record.lines || []).map((l: any, i: number) => ({ key: i + 1, itemId: l.itemId, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })));
      setMessageText(record.notes || ''); setMemo(record.statementMemo || '');
    } else {
      form.resetFields();
      form.setFieldsValue({ quoteDate: dayjs(), validUntil: dayjs().add(30, 'day'), status: 'DRAFT', customerId: initial?.customerId });
      setLines([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]);
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
  const quoteItemOptions = productOptions(meta.data?.items);
  /** Quote product selected/changed → resolve Rate from PricingService (sales price, never cost). */
  async function onQuoteProductChange(key: number, itemId: string) {
    const customerId = form.getFieldValue('customerId');
    const { patch, warning } = await resolveProductLinePatch(itemId, meta.data?.items, customerId, 'USD');
    updateLine(key, patch);
    if (warning) message.warning(warning);
  }
  async function submit() {
    try {
      const v = await form.validateFields();
      const payload = { branchId: meta.data?.branches?.[0]?.id, customerId: v.customerId, projectId: initial?.projectId, address: v.address, notes: messageText, statementMemo: memo, validUntil: v.validUntil?.format('YYYY-MM-DD'), status: v.status, lines: lines.map((l) => ({ description: l.description, itemId: l.itemId, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0), taxRate: Number(l.taxRate || 0) })) };
      setSaving(true);
      let id = record?.id;
      if (record) { await api(`/sales/quotations/${record.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
      else { const created = await api('/sales/quotations', { method: 'POST', body: JSON.stringify(payload) }); id = created.id; }
      if (v.status && v.status !== 'DRAFT' && id) await api(`/sales/quotations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: v.status }) });
      message.success(record ? 'Quote updated' : 'Quote created');
      qc.invalidateQueries({ queryKey: ['/sales/quotations'] });
      qc.invalidateQueries({ queryKey: ['sales-register'] });
      onSaved(id);
    } catch (e: any) { message.error(e.message || 'Could not save quote'); }
    finally { setSaving(false); }
  }

  const docActions = (<>
    <Button icon={<EyeOutlined />} onClick={() => setViewer({ autoPrint: false })}>Preview</Button>
    <Button icon={<SettingOutlined />} onClick={() => setCustomise(true)}>Customise</Button>
    <Button icon={<MailOutlined />} onClick={openEmail}>Send Email</Button>
    <Button icon={<PrinterOutlined />} onClick={() => setViewer({ autoPrint: true })}>Print</Button>
    <Button icon={<DownloadOutlined />} onClick={() => setViewer({ autoPrint: false })}>PDF</Button>
  </>);

  function openEmail() {
    if (!record?.id) return;
    if (dirty) {
      Modal.confirm({ title: 'Unsaved changes', content: 'You have unsaved changes. Email the last saved version?', okText: 'Email saved version', cancelText: 'Cancel', onOk: () => setSendEmail({ type: 'quotation', id: record.id }) });
    } else setSendEmail({ type: 'quotation', id: record.id });
  }

  return (
    <>
      <BackBar to="/sales/quotations" title={record ? 'Edit Quote' : 'Create Quote'} actions={record ? docActions : undefined} />
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
            <div className="grid grid-cols-[1.3fr_1.6fr_0.7fr_1fr_1fr_40px] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide"><span>Product</span><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span /></div>
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[1.3fr_1.6fr_0.7fr_1fr_1fr_40px] gap-3 items-center py-2 border-t border-[#f0f1f6]">
                <Select className="w-full" showSearch optionFilterProp="label" placeholder="Select product" options={quoteItemOptions} value={l.itemId} onChange={(v) => onQuoteProductChange(l.key, v)} popupRender={(menu) => (<><div className="p-1">{menu}</div><Divider style={{ margin: '6px 0' }} /><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setItemModalKey(l.key)}>Add new item</Button></>)} />
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

        <FormSection title="Message" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><div className="text-[13px] font-medium text-[#344054] mb-1">Message</div><Input.TextArea rows={2} value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Message shown on the quote" /></div>
          <div><div className="text-[13px] font-medium text-[#344054] mb-1">Statement Memo</div><Input.TextArea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo" /></div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-5">
        <Link href="/sales/quotations"><Button>Cancel</Button></Link>
        <Button type="primary" onClick={submit} loading={saving}>Save Quote</Button>
      </div>
      <QuickAddCustomer open={custOpen} onClose={() => setCustOpen(false)} onCreated={(id) => { form.setFieldValue('customerId', id); setCustOpen(false); }} />
      <QuickAddItem open={itemModalKey !== null} onClose={() => setItemModalKey(null)} onCreated={(id, name) => { if (itemModalKey !== null) updateLine(itemModalKey, { itemId: id, description: name }); setItemModalKey(null); }} />
      <DocViewer open={!!viewer} onClose={() => setViewer(null)} type="quotation" id={record?.id} autoPrint={viewer?.autoPrint} />
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
      message.success('Customer created');
      form.resetFields();
      onCreated(res.id);
    } catch (e: any) { message.error(e.message || 'Could not create customer'); }
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
      const res = await api('/inventory/items', { method: 'POST', body: JSON.stringify({ name: v.name, unit: v.unit || 'EA', reorderLevel: Number(v.reorderLevel || 0), sellingPrice: Number(v.sellingPrice || 0) }) });
      qc.invalidateQueries({ queryKey: ['meta'] });
      message.success('Item created');
      form.resetFields();
      onCreated(res.id, v.name);
    } catch (e: any) { message.error(e.message || 'Could not create item'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open={open} title="Add New Item" onCancel={onClose} onOk={save} confirmLoading={saving} width={480} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required' }]}><Input placeholder="Item name" /></Form.Item>
        <Form.Item label="Unit" name="unit"><Input placeholder="EA, KG, BOX…" /></Form.Item>
        <Form.Item label="Selling Price" name="sellingPrice" extra="Used to auto-populate the Rate on quotes, orders and invoices."><InputNumber className="w-full" min={0} prefix="$" /></Form.Item>
        <Form.Item label="Reorder Level" name="reorderLevel"><InputNumber className="w-full" min={0} /></Form.Item>
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


