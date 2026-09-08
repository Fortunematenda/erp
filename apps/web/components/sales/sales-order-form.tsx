'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Divider, Form, Input, InputNumber, Modal, Popconfirm, Select, Tag, Tooltip, message } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, DeleteOutlined, EyeOutlined, MailOutlined, PlusOutlined, PrinterOutlined, DownloadOutlined, SwapOutlined, LinkOutlined, StopOutlined, CloseOutlined, TruckOutlined } from '@ant-design/icons';
import Link from 'next/link';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtMoney } from '@/lib/format';
import { FormSection, customerOptions, StatusPill } from '@/components/sales-ui';
import { DocViewer } from '@/components/documents/doc-viewer';

const TERMS = ['Net 15', 'Net 30', 'Net 60', 'Due on Receipt'];

type Line = { key: number; itemId?: string; description: string; quantity: number; unitPrice: number; discount: number; taxRate: number };
function lineTotal(l: Line) { const net = Number(l.quantity || 0) * Number(l.unitPrice || 0) - Number(l.discount || 0); const tax = net * (Number(l.taxRate || 0) / 100); return { net, tax, total: net + tax }; }

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

function employeeOptions(employees: any[] | undefined) {
  return (employees || []).map((e: any) => ({ label: `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email || e.employeeNo || e.id, value: e.id }));
}
import { hydrateCustomerDocumentDefaults, resolveProductLinePatch, productOptions, dueDateFromTerms } from '@/components/sales/customer-defaults';
/** Shared hydration path — same service as Quote/Invoice (billing + shipping + terms + tax). */
function applyCustomerDefaults(id: string, form: any, customers: any[]) {
  void hydrateCustomerDocumentDefaults(id, form, customers, { shipping: true });
}

export function SalesOrderForm({ record, onSaved, initial }: { record?: any; onSaved: (id: string) => void; initial?: { customerId?: string; sourceQuoteId?: string } }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const projects = useQuery({ queryKey: ['/projects'], queryFn: () => api('/projects'), enabled: !!meta.data });
  const [form] = Form.useForm();
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [defaultTax, setDefaultTax] = useState(0);
  const [viewer, setViewer] = useState<null | { autoPrint: boolean }>(null);
  const [converting, setConverting] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [custForm] = Form.useForm();

  async function createCustomer() {
    try {
      const v = await custForm.validateFields();
      const created: any = await api('/sales/customers', { method: 'POST', body: JSON.stringify({ name: v.name, firstName: v.firstName, lastName: v.lastName, companyName: v.companyName, email: v.email, phone: v.phone, mobile: v.mobile, address1: v.address1, address2: v.address2, city: v.city, state: v.state, zip: v.zip, country: v.country, creditLimit: Number(v.creditLimit || 0) }) });
      message.success('Customer created');
      form.setFieldValue('customerId', created.id);
      qc.invalidateQueries({ queryKey: ['meta'] });
      setCustOpen(false);
      custForm.resetFields();
    } catch (e: any) { message.error(e.message || 'Could not create customer'); }
  }

  useEffect(() => {
    if (record) {
      form.setFieldsValue({ customerId: record.customer?.id, orderNo: record.orderNo, orderDate: record.orderDate ? dayjs(record.orderDate) : dayjs(), expectedDate: record.expectedDate ? dayjs(record.expectedDate) : null, customerReference: record.customerReference, salesperson: record.salesperson, projectId: record.projectId, branchId: record.branchId, warehouseId: record.warehouseId, currency: record.currency || 'USD', exchangeRate: Number(record.exchangeRate || 1), terms: record.terms, billingAddress: record.billingAddress, shippingAddress: record.shippingAddress, customerMessage: record.customerMessage, internalMemo: record.internalMemo });
      setLines((record.lines || []).map((l: any, i: number) => ({ key: i + 1, itemId: l.itemId, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discount: Number(l.discount || 0), taxRate: Number(l.taxRate) })));
    } else {
      form.resetFields();
      form.setFieldsValue({ orderDate: dayjs(), currency: 'USD', exchangeRate: 1, branchId: meta.data?.branches?.[0]?.id, customerId: initial?.customerId });
      setLines(record ? [] : [{ key: 1, description: '', quantity: 1, unitPrice: 0, discount: 0, taxRate: defaultTax }]);
      // Customer Details → New Order: hydrate billing + shipping + terms + tax defaults.
      if (initial?.customerId && meta.data?.customers?.length) applyCustomerDefaults(initial.customerId, form, meta.data.customers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, meta.data?.customers?.length]);

  const totals = useMemo(() => { const net = lines.reduce((s, l) => s + lineTotal(l).net, 0); const tax = lines.reduce((s, l) => s + lineTotal(l).tax, 0); return { net, tax, total: net + tax }; }, [lines]);

  function updateLine(k: number, patch: Partial<Line>) { setLines((p) => p.map((l) => (l.key === k ? { ...l, ...patch } : l))); }
  function removeLine(k: number) { setLines((p) => p.filter((l) => l.key !== k)); }
  function addLine() { setLines((p) => [...p, { key: p.length + 1, description: '', quantity: 1, unitPrice: 0, discount: 0, taxRate: defaultTax }]); }

  async function save() {
    try {
      setSaving(true);
      const v = await form.validateFields();
      const payload = { branchId: v.branchId, customerId: v.customerId, projectId: v.projectId, orderNo: v.orderNo || undefined, orderDate: v.orderDate?.format('YYYY-MM-DD'), expectedDate: v.expectedDate?.format('YYYY-MM-DD') || undefined, warehouseId: v.warehouseId, salesperson: v.salesperson, customerReference: v.customerReference, billingAddress: v.billingAddress, shippingAddress: v.shippingAddress, customerMessage: v.customerMessage, internalMemo: v.internalMemo, terms: v.terms, currency: v.currency, exchangeRate: Number(v.exchangeRate || 1), lines: lines.map((l) => ({ description: l.description, itemId: l.itemId, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0), discount: Number(l.discount || 0), taxRate: Number(l.taxRate || 0) })) };
      let id = record?.id;
      if (record) { await api(`/sales/sales-orders/${record.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
      else { const created = await api('/sales/sales-orders', { method: 'POST', body: JSON.stringify(payload) }); id = created.id; }
      message.success(record ? 'Order updated' : 'Order created');
      qc.invalidateQueries({ queryKey: ['/sales/sales-orders'] });
      qc.invalidateQueries({ queryKey: ['/sales/quotations'] });
      onSaved(id);
    } catch (e: any) { message.error(e.message || 'Could not save order'); }
    finally { setSaving(false); }
  }

  const isDraft = record?.status === 'DRAFT';
  const active = ['OPEN', 'CONFIRMED'].includes(record?.status);
  const readyInvoice = active && record?.invoiceProgress !== 'INVOICED';

  const doAction = async (path: string, method: 'POST' = 'POST') => {
    try { await api(path, { method }); message.success('Done'); qc.invalidateQueries({ queryKey: ['/sales/sales-orders'] }); qc.invalidateQueries({ queryKey: ['/sales/quotations'] }); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); } catch (e: any) { message.error(e.message); }
  };

  const docActions = (<>
    <Button icon={<EyeOutlined />} onClick={() => setViewer({ autoPrint: false })}>Preview</Button>
    <Button icon={<MailOutlined />} onClick={() => message.info('Email Sales Order')}>Send Email</Button>
    <Button icon={<PrinterOutlined />} onClick={() => setViewer({ autoPrint: true })}>Print</Button>
    <Button icon={<DownloadOutlined />} onClick={() => setViewer({ autoPrint: false })}>PDF</Button>
  </>);

  const customers = meta.data?.customers || [];
  const taxOptions = (meta.data?.taxRates || []).map((t: any) => ({ label: `${t.name} (${Number(t.rate)}%)`, value: Number(t.rate) }));
  const orderItemOptions = productOptions(meta.data?.items);

  /** Product selected/changed → re-resolve Rate from PricingService (respects document currency). */
  async function onOrderProductChange(key: number, itemId: string) {
    const customerId = form.getFieldValue('customerId');
    const currency = form.getFieldValue('currency') || 'USD';
    const { patch, warning } = await resolveProductLinePatch(itemId, meta.data?.items, customerId, currency);
    updateLine(key, patch);
    if (warning) message.warning(warning);
  }

  return (
    <>
      <BackBar to="/sales/orders" title={record ? `Sales Order ${record.orderNo}` : 'Create Sales Order'} actions={record ? docActions : undefined} />
      <div className="nex-card p-6">
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <Form.Item label="Customer" name="customerId" className="!mb-3" rules={[{ required: true, message: 'Select a customer' }]}><Select showSearch optionFilterProp="label" placeholder="Select customer" options={customerOptions(customers)} onChange={(v) => applyCustomerDefaults(v, form, customers)} popupRender={(menu) => (<><div className="p-1">{menu}</div><Divider style={{ margin: '6px 0' }} /><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setCustOpen(true)}>Add customer</Button></>)} /></Form.Item>
          <Form.Item label="Sales Order Number" name="orderNo" className="!mb-3"><Input placeholder="Auto-generated if blank" /></Form.Item>
          <Form.Item label="Order Date" name="orderDate" className="!mb-3" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Expected Delivery" name="expectedDate" className="!mb-3"><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Customer PO / Ref" name="customerReference" className="!mb-3"><Input placeholder="Customer PO or reference" /></Form.Item>
          <Form.Item label="Salesperson" name="salesperson" className="!mb-3"><Select allowClear showSearch optionFilterProp="label" placeholder="Select salesperson" options={employeeOptions(meta.data?.employees)} /></Form.Item>
          <Form.Item label="Branch" name="branchId" className="!mb-3"><Select showSearch optionFilterProp="label" placeholder="Branch" options={(meta.data?.branches || []).map((b: any) => ({ label: b.name, value: b.id }))} /></Form.Item>
          <Form.Item label="Warehouse" name="warehouseId" className="!mb-3"><Select allowClear showSearch optionFilterProp="label" placeholder="Warehouse" options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} /></Form.Item>
          <Form.Item label="Project" name="projectId" className="!mb-3"><Select allowClear showSearch optionFilterProp="label" placeholder="Project" options={(projects.data || []).map((p: any) => ({ label: p.name, value: p.id }))} /></Form.Item>
          <Form.Item label="Currency" name="currency" className="!mb-3"><Select options={['USD', 'ZWL', 'EUR', 'GBP', 'ZAR'].map((c) => ({ label: c, value: c }))} /></Form.Item>
          <Form.Item label="Exchange Rate" name="exchangeRate" className="!mb-3"><InputNumber className="w-full" min={0} step={0.0001} /></Form.Item>
          <Form.Item label="Payment Terms" name="terms" className="!mb-3"><Select allowClear options={TERMS.map((t) => ({ label: t, value: t }))} /></Form.Item>
          </div>

        {record?.quotation && (
          <div className="mb-3 rounded-xl border border-[#eef0f6] bg-[#f8fafc] px-4 py-3 text-[13px] text-[#475060] flex items-center gap-2">
            <LinkOutlined /> Source Quote: <Link href={`/sales/quotations/${record.quotation.id}/edit`} className="font-semibold text-[#003366] hover:underline">{record.quotation.quotationNo}</Link>
          </div>
        )}

        {record && (
          <div className="mb-4 rounded-xl border border-[#eef0f6] bg-gradient-to-br from-white to-[#f8fafc] p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-[#f1f5f9] bg-white px-3 py-2"><div className="text-[11px] text-[#94a3b8] mb-1.5">Order Status</div><StatusPill status={String(record.status || '').replace(/_/g, ' ')} /></div>
              <div className="rounded-lg border border-[#f1f5f9] bg-white px-3 py-2"><div className="text-[11px] text-[#94a3b8] mb-1.5">Fulfilment</div><StatusPill status={String(record.fulfilmentStatus || 'NOT_FULFILLED').replace(/_/g, ' ')} /></div>
              <div className="rounded-lg border border-[#f1f5f9] bg-white px-3 py-2"><div className="text-[11px] text-[#94a3b8] mb-1.5">Invoice Progress</div><StatusPill status={String(record.invoiceProgress || 'NOT_INVOICED').replace(/_/g, ' ')} /></div>
            </div>
            {(record.invoices || []).length > 0 && (
              <div className="mt-3 pt-3 border-t border-[#f1f5f9] text-[12px] text-[#64748b] flex flex-wrap gap-2">
                <span className="font-medium text-[#344054]">Invoices:</span>
                {(record.invoices || []).map((i: any) => <Link key={i.id} href={`/sales/invoices/${i.id}/edit`} className="font-mono text-[#003366] hover:underline">{i.invoiceNo}</Link>)}
                {record.invoiceProgress === 'INVOICED' && <Tag color="green">Fully Invoiced</Tag>}
              </div>
            )}
          </div>
        )}

        <FormSection title="Line Items" />
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[1.2fr_1.7fr_0.6fr_0.9fr_0.8fr_0.9fr_40px] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide"><span>Product</span><span>Description</span><span>Qty</span><span>Rate</span><span>Discount</span><span>Amount</span><span /></div>
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[1.2fr_1.7fr_0.6fr_0.9fr_0.8fr_0.9fr_40px] gap-3 items-center py-2 border-t border-[#f0f1f6]">
                <Select className="w-full" showSearch optionFilterProp="label" placeholder="Product" options={orderItemOptions} value={l.itemId} onChange={(v) => onOrderProductChange(l.key, v)} />
                <Input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Description" />
                <InputNumber className="w-full" min={0} value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: Number(v || 0) })} />
                <Tooltip title="Automatically populated from the customer's price list or the product's default sales price. You may edit it if you have permission."><InputNumber className="w-full" min={0} prefix="$" value={l.unitPrice} onChange={(v) => updateLine(l.key, { unitPrice: Number(v || 0) })} /></Tooltip>
                <InputNumber className="w-full" min={0} prefix="$" value={l.discount} onChange={(v) => updateLine(l.key, { discount: Number(v || 0) })} />
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

        <FormSection title="Addresses" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Form.Item label="Billing Address" name="billingAddress" className="!mb-3"><Input.TextArea rows={2} placeholder="Billing address" /></Form.Item>
          <Form.Item label="Shipping / Delivery Address" name="shippingAddress" className="!mb-3"><Input.TextArea rows={2} placeholder="Shipping address" /></Form.Item>
        </div>

        <FormSection title="Notes" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Form.Item label="Customer Message" name="customerMessage" className="!mb-3"><Input.TextArea rows={2} placeholder="Shown on the customer document" /></Form.Item>
          <Form.Item label="Internal Memo" name="internalMemo" className="!mb-3"><Input.TextArea rows={2} placeholder="Internal only — not shown to customer" /></Form.Item>
        </div>
        </Form>
      </div>

      <div className="flex items-center justify-end gap-2 mt-5 flex-wrap">
        <Link href="/sales/orders"><Button>Cancel</Button></Link>
        {record && !['CLOSED', 'CANCELLED'].includes(record.status) && record.fulfilmentStatus !== 'FULFILLED' && <Link href={`/sales/deliveries?orderId=${record.id}`}><Button icon={<TruckOutlined />}>Create Delivery</Button></Link>}
        {record && isDraft && <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={async () => { await save(); doAction(`/sales/sales-orders/${record.id}/confirm`); }}>Confirm Order</Button>}
        {record && readyInvoice && (
          <Popconfirm title={`Create Invoice from ${record.orderNo}?`} onConfirm={() => doAction(`/sales/sales-orders/${record.id}/convert-invoice`)}>
            <Button type="primary" icon={<SwapOutlined />} loading={converting}>Convert to Invoice</Button>
          </Popconfirm>
        )}
        {record && !['CLOSED', 'CANCELLED'].includes(record.status) && <Button icon={<StopOutlined />} onClick={() => doAction(`/sales/sales-orders/${record.id}/close`)}>Close Order</Button>}
        {record && !['CLOSED', 'CANCELLED'].includes(record.status) && <Popconfirm title="Cancel this sales order?" onConfirm={() => doAction(`/sales/sales-orders/${record.id}/cancel`)}><Button danger icon={<CloseOutlined />}>Cancel Order</Button></Popconfirm>}
        <Button type="primary" loading={saving} onClick={save}>{record ? 'Save Order' : 'Save Draft'}</Button>
      </div>

      <DocViewer open={!!viewer} onClose={() => setViewer(null)} type="sales-order" id={record?.id} autoPrint={viewer?.autoPrint} />

      <Modal title="Add Customer" open={custOpen} onCancel={() => setCustOpen(false)} onOk={createCustomer} okText="Create">
        <Form form={custForm} layout="vertical" className="mt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
            <Form.Item label="First Name" name="firstName"><Input /></Form.Item>
            <Form.Item label="Last Name" name="lastName"><Input /></Form.Item>
          </div>
          <Form.Item label="Display Name" name="name" extra="If left blank, NexusERP will generate the display name from the company or customer name."><Input placeholder="Leave blank to auto-generate" /></Form.Item>
          <Form.Item label="Company" name="companyName"><Input /></Form.Item>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
            <Form.Item label="Email" name="email"><Input /></Form.Item>
            <Form.Item label="Phone" name="phone"><Input /></Form.Item>
          </div>
          <Form.Item label="Street Address" name="address1"><Input /></Form.Item>
          <Form.Item label="Address Line 2" name="address2"><Input /></Form.Item>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
            <Form.Item label="City" name="city"><Input /></Form.Item>
            <Form.Item label="State" name="state"><Input /></Form.Item>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
            <Form.Item label="ZIP" name="zip"><Input /></Form.Item>
            <Form.Item label="Country" name="country"><Input /></Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}
