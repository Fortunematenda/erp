'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Divider, Drawer, Form, Input, InputNumber, Modal, Select, Tooltip, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtMoney } from '@/lib/format';
import { CustomerAvatar, FormSection, customerOptions } from '@/components/sales-ui';
import { fetchCustomerDocumentDefaults, resolveProductLinePatch, productOptions, dueDateFromTerms } from '@/components/sales/customer-defaults';

const TERMS = ['Net 15', 'Net 30', 'Net 60', 'Due on Receipt'];
const STATUSES = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'OPEN', label: 'Open' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'PART_PAID', label: 'Partially Paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'VOID', label: 'Void' },
];
const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Zimbabwe', 'South Africa', 'Australia', 'Germany', 'France', 'India', 'China', 'Japan', 'Brazil', 'United Arab Emirates', 'Nigeria', 'Kenya'];

type Line = { key: number; itemId?: string; description: string; quantity: number; unitPrice: number; unit?: string; taxRate: number };

function lineTotal(l: Line) {
  const net = Number(l.quantity || 0) * Number(l.unitPrice || 0);
  const tax = net * (Number(l.taxRate || 0) / 100);
  return { net, tax, total: net + tax };
}

export function InvoiceFormDrawer({ open, onClose, presetCustomerId }: { open: boolean; onClose: () => void; presetCustomerId?: string }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]);
  const [saving, setSaving] = useState<'draft' | 'save' | null>(null);
  const [defaultTax, setDefaultTax] = useState(0);
  const [customerModal, setCustomerModal] = useState(false);
  const [itemModalKey, setItemModalKey] = useState<number | null>(null);

  const customers = meta.data?.customers || [];
  const customerId = Form.useWatch('customerId', open ? form : undefined);
  const selectedCustomer = customers.find((c: any) => c.id === customerId);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ branchId: meta.data?.branches?.[0]?.id, invoiceDate: dayjs(), terms: 'Net 30', status: 'DRAFT', taxRateId: undefined });
      setLines([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: defaultTax }]);
      if (presetCustomerId) form.setFieldsValue({ customerId: presetCustomerId });
      // Shared hydration path — email, billing address, terms, tax defaults.
      if (presetCustomerId && meta.data?.customers?.length) hydrateCustomer(presetCustomerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetCustomerId]);

  /** Same shared hydration as the full-page Quote/Order/Invoice forms. */
  async function hydrateCustomer(id: string) {
    const d = await fetchCustomerDocumentDefaults(id);
    const c = (meta.data?.customers || []).find((x: any) => x.id === id);
    if (!d && !c) return;
    setTimeout(() => {
      try {
        if (d) {
          if (d.email) form.setFieldValue('email', d.email);
          if (d.billingAddress) form.setFieldValue('billingAddress', d.billingAddress);
          if (d.terms) form.setFieldValue('terms', d.terms);
          if (d.defaultTaxRate) { form.setFieldValue('taxRateId', d.defaultTaxRate); setDefaultTax(d.defaultTaxRate); setLines((prev) => prev.map((l) => ({ ...l, taxRate: d.defaultTaxRate }))); }
          else if (c?.taxStatus === 'Tax Exempt') { form.setFieldValue('taxRateId', 0); setDefaultTax(0); setLines((prev) => prev.map((l) => ({ ...l, taxRate: 0 }))); }
        } else if (c) {
          if (c.email) form.setFieldValue('email', c.email);
          const addr = [c.address1, c.address2, c.city, c.state, c.zip, c.country].filter(Boolean).join(', ');
          if (addr) form.setFieldValue('billingAddress', addr);
          if (c.paymentTerms) form.setFieldValue('terms', c.paymentTerms);
          if (Number(c.defaultTaxRate)) { form.setFieldValue('taxRateId', Number(c.defaultTaxRate)); setDefaultTax(Number(c.defaultTaxRate)); setLines((prev) => prev.map((l) => ({ ...l, taxRate: Number(c.defaultTaxRate) }))); }
        }
      } catch { /* ignore */ }
    }, 0);
  }

  /** Customer changed → refresh hydration from the (new) customer master. */
  useEffect(() => {
    if (open && customerId) hydrateCustomer(customerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, open]);

  const totals = useMemo(() => {
    const net = lines.reduce((s, l) => s + lineTotal(l).net, 0);
    const tax = lines.reduce((s, l) => s + lineTotal(l).tax, 0);
    return { net, tax, total: net + tax };
  }, [lines]);

  const taxOptions = (meta.data?.taxRates || []).map((t: any) => ({ label: `${t.name} (${Number(t.rate)}%)`, value: Number(t.rate) }));

  function addLine() {
    setLines((prev) => [...prev, { key: prev.length + 1, description: '', quantity: 1, unitPrice: 0, taxRate: defaultTax }]);
  }
  function removeLine(key: number) { setLines((prev) => prev.filter((l) => l.key !== key)); }
  function updateLine(key: number, patch: Partial<Line>) { setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l))); }
  async function onProduct(key: number, id: string) {
    const { patch, warning } = await resolveProductLinePatch(id, meta.data?.items, customerId, 'USD');
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    if (warning) message.warning(warning);
  }

  async function submit(mode: 'draft' | 'save') {
    try {
      const v = await form.validateFields();
      if (!v.customerId) { message.error('Select a customer'); return; }
      setSaving(mode);
      const payload = {
        branchId: v.branchId || meta.data?.branches?.[0]?.id,
        customerId: v.customerId,
        invoiceNo: v.invoiceNo || undefined,
        currency: 'USD',
        fiscalRequired: true,
        dueDate: v.dueDate ? v.dueDate.format('YYYY-MM-DD') : undefined,
        lines: lines.map((l) => ({ description: l.description, itemId: l.itemId, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0), taxRate: Number(l.taxRate || 0) })),
      };
      const created = await api('/sales/invoices', { method: 'POST', body: JSON.stringify(payload) });
      if (mode === 'save' && created?.id) {
        await api(`/sales/invoices/${created.id}/post`, { method: 'POST' });
      }
      message.success(mode === 'save' ? 'Invoice saved' : 'Draft saved');
      qc.invalidateQueries({ queryKey: ['/sales/invoices'] });
      qc.invalidateQueries({ queryKey: ['sales-register'] });
      onClose();
    } catch (e: any) {
      message.error(e.message || 'Could not save invoice');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} width={950} styles={{ body: { padding: 24 } }} title="Create Invoice"
      footer={
        <div className="flex items-center gap-2 justify-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit('draft')} loading={saving === 'draft'}>Save as Draft</Button>
          <Button type="primary" onClick={() => submit('save')} loading={saving === 'save'} icon={<PlusOutlined />}>Save Invoice</Button>
        </div>
      }
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-semibold text-[16px] text-[#171a2e]">Create Invoice</div>
          <div className="text-[12px] text-[#64748b] mt-0.5">New customer invoice</div>
        </div>
        <Button icon={<span className="text-[#003366]">⚙</span>}>Customize Template</Button>
      </div>

      <Form form={form} layout="vertical" className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
        <Form.Item label="Customer" name="customerId" className="!mb-3"><Select showSearch placeholder="Select customer" optionFilterProp="label" options={customerOptions(customers)} popupRender={(menu) => (<><div className="p-1">{menu}</div><Divider style={{ margin: '6px 0' }} /><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setCustomerModal(true)}>Add customer</Button></>)} /></Form.Item>
        <Form.Item label="Invoice Number" name="invoiceNo" className="!mb-3"><Input placeholder="Auto-generated if blank" /></Form.Item>
        <Form.Item label="Payment Terms" name="terms" className="!mb-3"><Select options={TERMS.map((t) => ({ label: t, value: t }))} onChange={(t) => { const dd = dueDateFromTerms(t, form.getFieldValue('invoiceDate')); if (dd) form.setFieldValue('dueDate', dayjs(dd)); }} /></Form.Item>

        <Form.Item label="Invoice Date" name="invoiceDate" className="!mb-3"><DatePicker className="w-full" onChange={(d) => { const dd = dueDateFromTerms(form.getFieldValue('terms'), d); if (dd) form.setFieldValue('dueDate', dayjs(dd)); }} /></Form.Item>
        <Form.Item label="Due Date" name="dueDate" className="!mb-3"><DatePicker className="w-full" /></Form.Item>
        <Form.Item label="Email" name="email" className="!mb-3"><Input placeholder="Auto-filled from customer" /></Form.Item>

        <Form.Item label="Billing Address" name="billingAddress" className="!mb-3 md:col-span-2"><Input.TextArea rows={2} placeholder="Billing address" /></Form.Item>
        <Form.Item label="Status" name="status" className="!mb-3"><Select options={STATUSES} /></Form.Item>

        <Form.Item label="Tax Rate (%)" name="taxRateId" className="!mb-3 md:col-span-3">
          <Select allowClear placeholder="Default line tax rate" options={taxOptions} onChange={(v) => { setDefaultTax(v || 0); setLines((prev) => prev.map((l) => ({ ...l, taxRate: v || 0 }))); }} />
        </Form.Item>
      </Form>

      <FormSection title="Line Items" />
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[1.4fr_2fr_0.7fr_1fr_1fr_40px] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide">
            <span>Product</span><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span />
          </div>
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[1.4fr_2fr_0.7fr_1fr_1fr_40px] gap-3 items-center py-2 border-t border-[#f0f1f6]">
              <Select className="w-full" showSearch optionFilterProp="label" placeholder="Product" options={productOptions(meta.data?.items)} value={l.itemId} onChange={(v) => onProduct(l.key, v)} popupRender={(menu) => (<><div className="p-1">{menu}</div><Divider style={{ margin: '6px 0' }} /><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setItemModalKey(l.key)}>Add item</Button></>)} />
              <Input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Description" />
              <InputNumber className="w-full" min={0} value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: Number(v || 0) })} />
              <Tooltip title="Automatically populated from the customer's price list or the product's default sales price. You may edit it if you have permission."><InputNumber className="w-full" min={0} prefix="$" value={l.unitPrice} onChange={(v) => updateLine(l.key, { unitPrice: Number(v || 0) })} /></Tooltip>
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
        <div className="flex items-center gap-6 text-[15px] font-bold text-[#171a2e] border-t border-[#eef0f6] pt-2"><span>Total</span><span className="min-w-[110px] text-right text-[#003366]">{fmtMoney(totals.total)}</span></div>
      </div>

      <FormSection title="Message" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><div className="text-[13px] font-medium text-[#475060] mb-1">Message on Invoice</div><Input.TextArea rows={2} placeholder="Message shown on the invoice" /></div>
        <div><div className="text-[13px] font-medium text-[#475060] mb-1">Statement Memo</div><Input.TextArea rows={2} placeholder="Memo for customer statement" /></div>
      </div>

      <QuickAddCustomer open={customerModal} onClose={() => setCustomerModal(false)} onCreated={(id) => { form.setFieldValue('customerId', id); setCustomerModal(false); }} />
      <QuickAddItem open={itemModalKey !== null} onClose={() => setItemModalKey(null)} onCreated={(id, name) => { if (itemModalKey !== null) updateLine(itemModalKey, { itemId: id, description: name }); setItemModalKey(null); }} />
    </Drawer>
  );
}

export function QuoteFormDrawer({ open, onClose, presetCustomerId }: { open: boolean; onClose: () => void; presetCustomerId?: string }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]);
  const [saving, setSaving] = useState(false);
  const [customerModal, setCustomerModal] = useState(false);
  const customerId = Form.useWatch('customerId', open ? form : undefined);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ quoteDate: dayjs(), validUntil: dayjs().add(30, 'day') });
      setLines([{ key: 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]);
      if (presetCustomerId) form.setFieldsValue({ customerId: presetCustomerId });
      // Shared hydration path (email + billing address + terms + tax defaults).
      const target = presetCustomerId;
      if (target) (async () => {
        const d = await fetchCustomerDocumentDefaults(target);
        const c = (meta.data?.customers || []).find((x: any) => x.id === target);
        if (!d && !c) return;
        setTimeout(() => {
          try {
            if (d) { if (d.email) form.setFieldValue('email', d.email); if (d.billingAddress) form.setFieldValue('address', d.billingAddress); if (d.defaultTaxRate) setLines((prev) => prev.map((l) => ({ ...l, taxRate: d.defaultTaxRate }))); }
            else if (c) { if (c.email) form.setFieldValue('email', c.email); const addr = [c.address1, c.address2, c.city, c.state, c.zip, c.country].filter(Boolean).join(', '); if (addr) form.setFieldValue('address', addr); if (Number(c.defaultTaxRate)) setLines((prev) => prev.map((l) => ({ ...l, taxRate: Number(c.defaultTaxRate) }))); }
          } catch { /* ignore */ }
        }, 0);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetCustomerId]);

  const totals = useMemo(() => {
    const net = lines.reduce((s, l) => s + lineTotal(l).net, 0);
    const tax = lines.reduce((s, l) => s + lineTotal(l).tax, 0);
    return { net, tax, total: net + tax };
  }, [lines]);

  function addLine() { setLines((p) => [...p, { key: p.length + 1, description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]); }
  function removeLine(k: number) { setLines((p) => p.filter((l) => l.key !== k)); }
  function updateLine(k: number, patch: Partial<Line>) { setLines((p) => p.map((l) => (l.key === k ? { ...l, ...patch } : l))); }
  async function onQuoteProduct(k: number, id: string) {
    const { patch, warning } = await resolveProductLinePatch(id, meta.data?.items, customerId, 'USD');
    updateLine(k, patch);
    if (warning) message.warning(warning);
  }

  async function submit() {
    try {
      const v = await form.validateFields();
      if (!v.customerId) { message.error('Select a customer'); return; }
      setSaving(true);
      await api('/sales/quotations', { method: 'POST', body: JSON.stringify({ branchId: meta.data?.branches?.[0]?.id, customerId: v.customerId, notes: v.notes, validUntil: v.validUntil?.format('YYYY-MM-DD'), lines: lines.map((l) => ({ description: l.description, itemId: l.itemId, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0), taxRate: Number(l.taxRate || 0) })) }) });
      message.success('Quote created');
      qc.invalidateQueries({ queryKey: ['/sales/quotations'] });
      qc.invalidateQueries({ queryKey: ['sales-register'] });
      onClose();
    } catch (e: any) {
      message.error(e.message || 'Could not create quote');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} width={850} styles={{ body: { padding: 24 } }} title="New Quote"
      footer={<div className="flex items-center gap-2 justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit} loading={saving}>Create Quote</Button></div>}
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="font-semibold text-[16px] text-[#171a2e]">Create Quote</div>
        <div className="text-[12px] text-[#64748b]">Customer estimate</div>
      </div>
      <Form form={form} layout="vertical" className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
        <Form.Item label="Customer" name="customerId" className="!mb-3 !col-span-2"><Select showSearch placeholder="Select customer" optionFilterProp="label" options={customerOptions(meta.data?.customers)} popupRender={(menu) => (<><div className="p-1">{menu}</div><Divider style={{ margin: '6px 0' }} /><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setCustomerModal(true)}>Add customer</Button></>)} /></Form.Item>
        <Form.Item label="Address" name="address" className="!mb-3"><Input.TextArea rows={2} placeholder="Billing address — auto-filled from customer" /></Form.Item>
        <Form.Item label="Valid Until" name="validUntil" className="!mb-3"><DatePicker className="w-full" /></Form.Item>
        <Form.Item label="Notes" name="notes" className="!mb-3 !col-span-3"><Input.TextArea rows={2} placeholder="Quote notes" /></Form.Item>
      </Form>
      <FormSection title="Line Items" />
      {lines.map((l) => (
        <div key={l.key} className="grid grid-cols-[1fr_1.2fr_0.7fr_0.8fr_0.8fr_1fr_40px] gap-3 items-center py-2 border-t border-[#f0f1f6]">
          <Select className="w-full" showSearch optionFilterProp="label" placeholder="Product" allowClear options={productOptions(meta.data?.items)} value={l.itemId || undefined} onChange={(v) => { if (v) onQuoteProduct(l.key, v); else updateLine(l.key, { itemId: undefined, unitPrice: 0 }); }} />
          <Input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Description" />
          <InputNumber className="w-full" min={0} value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: Number(v || 0) })} placeholder="Qty" />
          <Tooltip title="Automatically populated from the customer's price list or the product's default sales price. You may edit it if you have permission."><InputNumber className="w-full" min={0} prefix="$" value={l.unitPrice} onChange={(v) => updateLine(l.key, { unitPrice: Number(v || 0) })} placeholder="Rate" /></Tooltip>
          <InputNumber className="w-full" min={0} prefix="%" value={l.taxRate} onChange={(v) => updateLine(l.key, { taxRate: Number(v || 0) })} />
          <div className="text-[13px] font-semibold text-[#171a2e] text-right">{fmtMoney(lineTotal(l).total)}</div>
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(l.key)} />
        </div>
      ))}
      <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine} className="mt-3">Add Line</Button>
      <div className="flex flex-col items-end mt-6 space-y-1.5">
        <div className="flex items-center gap-6 text-[13px] text-[#475060]"><span>Subtotal</span><span className="min-w-[110px] text-right text-[#171a2e] font-medium">{fmtMoney(totals.net)}</span></div>
        <div className="flex items-center gap-6 text-[13px] text-[#475060]"><span>Tax</span><span className="min-w-[110px] text-right text-[#171a2e] font-medium">{fmtMoney(totals.tax)}</span></div>
        <div className="flex items-center gap-6 text-[15px] font-bold text-[#171a2e] border-t border-[#eef0f6] pt-2"><span>Total</span><span className="min-w-[110px] text-right text-[#003366]">{fmtMoney(totals.total)}</span></div>
      </div>

      <QuickAddCustomer open={customerModal} onClose={() => setCustomerModal(false)} onCreated={(id) => { form.setFieldValue('customerId', id); setCustomerModal(false); }} />
    </Drawer>
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
    <Modal open={open} title="Add Customer" onCancel={onClose} onOk={save} confirmLoading={saving} width={560} destroyOnHidden>
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
      const res = await api('/inventory/items', { method: 'POST', body: JSON.stringify({ name: v.name, unit: v.unit || 'EA', reorderLevel: Number(v.reorderLevel || 0) }) });
      qc.invalidateQueries({ queryKey: ['meta'] });
      message.success('Item created');
      form.resetFields();
      onCreated(res.id, v.name);
    } catch (e: any) { message.error(e.message || 'Could not create item'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open={open} title="Add Item" onCancel={onClose} onOk={save} confirmLoading={saving} width={480} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required' }]}><Input placeholder="Item name" /></Form.Item>
        <Form.Item label="Unit" name="unit"><Input placeholder="EA, KG, BOX…" /></Form.Item>
        <Form.Item label="Reorder Level" name="reorderLevel"><InputNumber className="w-full" min={0} /></Form.Item>
      </Form>
    </Modal>
  );
}


