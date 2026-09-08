'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Form, Input, Modal, Select, Table, Tabs, Tooltip, message } from 'antd';
import { DollarOutlined, FileDoneOutlined, PlusOutlined, PrinterOutlined, ShopOutlined, ShoppingCartOutlined, TeamOutlined, WarningOutlined, PayCircleOutlined, CheckCircleOutlined, CloseOutlined, SwapOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Zimbabwe', 'South Africa', 'Australia', 'Germany', 'France', 'India', 'China', 'Japan', 'Brazil', 'United Arab Emirates', 'Nigeria', 'Kenya'];
const PAYMENT_TERMS = ['Net 15', 'Net 30', 'Net 60', 'Due on Receipt'];
const VENDOR_TYPES = ['Individual', 'Company', 'Government', 'Non-profit'];
import { api } from '@/lib/api';
import { CrudPage, StatusTag } from '@/components/crud-page';
import { StatCard } from '@/components/stat-card';
import { LineItems } from '@/components/line-items';
import { useMeta } from '@/lib/meta';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

function ProcDocTab({ path, invalidates, idPrefix, numberKey, supplierRequired = true, extraCols = [], createFn, actions = [], printType }: any) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const list = useQuery({ queryKey: [path], queryFn: () => api(path) });
  const itemOptions = (meta.data?.items || []).map((i: any) => ({ label: `${i.sku} — ${i.name}`, value: i.id }));
  const cols: ColumnsType<any> = extraCols || [];

  async function submit(v: any) {
    try {
      setSaving(true);
      const body = createFn ? createFn(v) : v;
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      message.success(`${idPrefix} created`); setOpen(false); form.resetFields();
      invalidates.forEach((k: string) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  async function act(record: any, a: any) {
    try { await api(a.url(record), { method: a.method || 'POST', body: a.body ? JSON.stringify(a.body(record)) : undefined }); if (a.done) message.success(a.done); invalidates.forEach((k: string) => qc.invalidateQueries({ queryKey: [k] })); }
    catch (e: any) { message.error(e.message); }
  }

  return (
    <>
      <div className="flex justify-end mb-4"><Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setOpen(true); }}>New {idPrefix}</Button></div>
      <Table loading={list.isLoading} rowKey="id" dataSource={list.data || []} scroll={{ x: true }}
        columns={[
          { title: idPrefix, dataIndex: numberKey, width: 120 },
          { title: 'Date', dataIndex: 'createdAt', width: 110, render: fmtDate },
          { title: 'Supplier', render: (_, r: any) => r.supplier?.name || r.supplierId || '—' },
          { title: 'Total', dataIndex: 'total', align: 'right', width: 110, render: (v: any) => fmtMoney(v) },
          { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
          ...cols,
          ...((actions.length || printType) ? [{
            ...ACTIONS_COL,
            render: (_: any, r: any) => (
              <RowActionsMenu items={[
                ...(printType ? [{ key: 'print', label: 'Print / PDF', icon: <PrinterOutlined />, onClick: () => window.open(`/documents/${printType}/${r.id}`, '_blank') }] : []),
                ...actions.filter((a: any) => !a.show || a.show(r)).map((a: any) => ({
                  key: a.label,
                  label: a.label,
                  danger: a.danger || a.type === 'danger',
                  icon: a.label === 'Approve' ? <CheckCircleOutlined /> : a.label === 'Reject' ? <CloseOutlined /> : a.label?.includes('Convert') || a.label?.includes('Receive') ? <SwapOutlined /> : a.label === 'Post' ? <FileDoneOutlined /> : undefined,
                  onClick: () => act(r, a),
                })),
              ]} />
            ),
          }] : []),
        ]}
      />
      <Modal title={`New ${idPrefix}`} open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={saving} width={860} destroyOnHidden>
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-2 gap-3">
            <Form.Item label="Supplier" name="supplierId" rules={supplierRequired ? [{ required: true }] : []}>
              <Select showSearch optionFilterProp="label" options={(meta.data?.suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))} />
            </Form.Item>
            <Form.Item label="Date required" name="dateRequired"><DatePicker className="w-full" /></Form.Item>
          </div>
          <Form.Item label="Lines" required><LineItems form={form} lines="lines" items={itemOptions} priceKey="purchaseCost" /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function Procurement() {
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ['/procurement/dashboard'], queryFn: () => api('/procurement/dashboard') });
  const statusPatch = (status: string) => ({ method: 'PATCH', body: (r: any) => ({ status }) });

  const items = [
    { key: 'suppliers', label: 'Suppliers', children: <CrudPage title="Suppliers" path="/procurement/suppliers" createLabel="Supplier" canDelete useDrawer statusFilter="status" statusOptions={[{ label: 'Active', value: 'ACTIVE' }, { label: 'Inactive', value: 'INACTIVE' }, { label: 'On Hold', value: 'ON_HOLD' }]}
      columns={[
        { title: 'Code', dataIndex: 'code', width: 110, render: (v: any, r: any) => <Link className="hover:underline cursor-pointer text-[#2563eb]" href={`/procurement/suppliers/${r.id}`}>{v}</Link> },
        { title: 'Supplier', dataIndex: 'name', render: (v: any, r: any) => <Link className="text-[13px] font-medium text-[#171a2e] hover:text-[#003366] hover:underline" href={`/procurement/suppliers/${r.id}`}>{v}</Link> },
        { title: 'Category', dataIndex: 'vendorType', width: 110 },
        { title: 'Contact', width: 160, render: (_: any, r: any) => <span className="text-[12px] text-[#5a6080]">{r.contactName || r.email || '—'}</span> },
        { title: 'Phone', dataIndex: 'phone', width: 130 },
        { title: 'TIN / VAT', width: 110, render: (_: any, r: any) => r.tin || r.vatNumber || '—' },
        { title: 'Currency', dataIndex: 'currency', width: 90 },
        { title: 'Terms', dataIndex: 'paymentTerms', width: 110 },
        { title: 'Outstanding', dataIndex: 'outstanding', align: 'right', width: 120, render: (v: any) => <span className="font-semibold text-[#F97316]">{fmtMoney(v)}</span> },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
      ]}
      fields={[
        { name: 'firstName', label: 'First Name', span: 1 }, { name: 'lastName', label: 'Last Name' },
        { name: 'name', label: 'Legal / Registered Name', required: true }, { name: 'companyName', label: 'Trading Name' },
        { name: 'vendorType', label: 'Supplier Type', type: 'select', options: ['Company', 'Individual', 'Government', 'Non-profit'].map((c) => ({ label: c, value: c })) },
        { name: 'status', label: 'Status', type: 'select', options: [{ label: 'Active', value: 'ACTIVE' }, { label: 'Inactive', value: 'INACTIVE' }, { label: 'On Hold', value: 'ON_HOLD' }], defaultValue: 'ACTIVE' },
        { name: 'contactName', label: 'Contact Person' }, { name: 'jobTitle', label: 'Job Title' },
        { name: 'email', label: 'Email' }, { name: 'phone', label: 'Phone' },
        { name: 'mobile', label: 'Mobile' }, { name: 'website', label: 'Website' },
        { name: 'address1', label: 'Address Line 1' }, { name: 'address2', label: 'Address Line 2' },
        { name: 'city', label: 'City / Town' }, { name: 'state', label: 'Province / State' },
        { name: 'zip', label: 'Postal Code' }, { name: 'country', label: 'Country', type: 'select', options: COUNTRIES.map((c) => ({ label: c, value: c })) },
        { name: 'tin', label: 'TIN / Tax ID' }, { name: 'vatRegistered', label: 'VAT Registered', type: 'select', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
        { name: 'vatNumber', label: 'VAT Number' }, { name: 'companyRegNo', label: 'Company Reg. No.' },
        { name: 'paymentTerms', label: 'Payment Terms', type: 'select', options: ['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 60', 'Custom'].map((t) => ({ label: t, value: t })) },
        { name: 'currency', label: 'Default Currency', type: 'select', options: ['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c })), defaultValue: 'USD' },
        { name: 'paymentMethod', label: 'Preferred Payment Method', type: 'select', options: ['BANK', 'CHEQUE', 'CASH', 'CARD', 'MOBILE', 'OTHER'].map((m) => ({ label: m, value: m })) },
        { name: 'leadTimeDays', label: 'Lead Time (days)', type: 'number' }, { name: 'creditLimit', label: 'Credit Limit', type: 'money' },
        { name: 'defaultBuyer', label: 'Default Buyer' }, { name: 'accountNumber', label: 'Bank Account Number' },
        { name: 'defaultExpenseCategory', label: 'Default Expense Account', type: 'select', metaKey: 'accounts', metaLabel: 'name' },
        { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      ]}
    /> },
    { key: 'requisitions', label: 'Requisitions', children: <ProcDocTab path="/procurement/requisitions" invalidates={['/procurement/requisitions', '/procurement/purchase-orders']} idPrefix="Requisition" numberKey="requisitionNo" supplierRequired={false}
      createFn={(v: any) => ({ branchId: v.branchId, requestedBy: v.requestedBy, dateRequired: v.dateRequired?.format('YYYY-MM-DD'), notes: v.notes, lines: v.lines.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice })) })}
      actions={[
        { label: 'Submit', show: (r: any) => r.status === 'DRAFT', url: (r: any) => `/procurement/requisitions/${r.id}/status`, ...statusPatch('SUBMITTED'), done: 'Submitted' },
        { label: 'Approve', type: 'primary', show: (r: any) => ['DRAFT', 'SUBMITTED'].includes(r.status), url: (r: any) => `/procurement/requisitions/${r.id}/status`, ...statusPatch('APPROVED'), done: 'Approved' },
        { label: 'Reject', danger: true, show: (r: any) => ['DRAFT', 'SUBMITTED'].includes(r.status), url: (r: any) => `/procurement/requisitions/${r.id}/status`, ...statusPatch('REJECTED'), done: 'Rejected' },
        { label: 'Convert → PO', type: 'primary', show: (r: any) => r.status === 'APPROVED', url: (r: any) => `/procurement/requisitions/${r.id}/convert`, done: 'Converted to PO' },
      ]}
    /> },
    { key: 'orders', label: 'Purchase Orders', children: <ProcDocTab path="/procurement/purchase-orders" invalidates={['/procurement/purchase-orders', '/procurement/grns', '/inventory/stock']} idPrefix="Purchase Order" numberKey="orderNo" printType="purchase-order"
      createFn={(v: any) => ({ supplierId: v.supplierId, orderDate: v.dateRequired?.format('YYYY-MM-DD'), currency: 'USD', lines: v.lines.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice })) })}
      actions={[
        { label: 'Approve', type: 'primary', show: (r: any) => r.status === 'DRAFT', url: (r: any) => `/procurement/purchase-orders/${r.id}/status`, ...statusPatch('APPROVED'), done: 'Approved' },
        { label: 'Receive → GRN', type: 'primary', show: (r: any) => r.status === 'APPROVED', url: (r: any) => `/procurement/purchase-orders/${r.id}/receive`, done: 'Goods received (GRN created)' },
        { label: 'Close', show: (r: any) => ['RECEIVED'].includes(r.status), url: (r: any) => `/procurement/purchase-orders/${r.id}/status`, ...statusPatch('CLOSED'), done: 'Closed' },
      ]}
    /> },
    { key: 'grns', label: 'GRNs', children: <CrudPage title="Goods Received Notes" path="/procurement/grns" hideCreate canDelete
      columns={[
        { title: 'GRN', dataIndex: 'grnNo', width: 120 }, { title: 'PO', render: (_, r: any) => r.purchaseOrder?.orderNo || '—' },
        { title: 'Supplier', render: (_, r: any) => r.supplier?.name || '—' }, { title: 'Warehouse', render: (_, r: any) => r.warehouse?.name || '—' },
        { title: 'Total', dataIndex: 'total', align: 'right', render: (v: any) => fmtMoney(v) },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
      ]}
      rowActions={[{ key: 'post', label: 'Post', type: 'primary', show: (r) => r.status === 'DRAFT', url: (r) => `/procurement/grns/${r.id}/post`, extraInvalidate: ['/inventory/stock'] }]}
    /> },
    { key: 'supplier-invoices', label: 'Supplier Invoices', children: <ProcDocTab path="/procurement/supplier-invoices" invalidates={['/procurement/supplier-invoices']} idPrefix="Supplier Invoice" numberKey="invoiceNo" printType="supplier-invoice"
      createFn={(v: any) => ({ supplierId: v.supplierId, invoiceDate: v.dateRequired?.format('YYYY-MM-DD'), dueDate: v.dueDate?.format('YYYY-MM-DD'), currency: 'USD', lines: v.lines.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice })) })}
      actions={[{ label: 'Post', type: 'primary', show: (r: any) => r.status === 'DRAFT', url: (r: any) => `/procurement/supplier-invoices/${r.id}/post`, done: 'Invoice posted (AP + inventory)' }]}
    /> },
    { key: 'payments', label: 'Supplier Payments', children: <CrudPage title="Supplier Payments" path="/procurement/supplier-payments" createLabel="Payment" canDelete
      sources={['/procurement/supplier-invoices']}
      columns={[
        { title: 'Payment', dataIndex: 'paymentNo', width: 120 }, { title: 'Date', dataIndex: 'paidAt', width: 110, render: fmtDate },
        { title: 'Invoice', render: (_, r: any) => r.supplierInvoice?.invoiceNo || '—' },
        { title: 'Method', dataIndex: 'method', width: 100 },
        { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
      ]}
      fields={[
        { name: 'supplierInvoiceId', label: 'Supplier invoice', type: 'select', required: true, selectPath: '/procurement/supplier-invoices', selectLabel: (r: any) => `${r.invoiceNo} — ${r.supplier?.name} (${r.status})` },
        { name: 'amount', label: 'Amount', type: 'money', required: true },
        { name: 'method', label: 'Method', type: 'select', options: ['CASH', 'BANK', 'MOBILE', 'CARD'].map((m) => ({ label: m, value: m })), defaultValue: 'BANK' },
        { name: 'paidAt', label: 'Payment date', type: 'date' },
        { name: 'referenceNo', label: 'Reference' }, { name: 'note', label: 'Note', type: 'textarea' },
      ]}
    /> },
  ];
  return (
    <div className="nex-fade">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<ShoppingCartOutlined />} label="Purchase Orders" value={dash.data?.purchaseOrders ?? 0} hint={`${fmtMoney(dash.data?.purchaseOrderValue || 0)} committed`} color="#003366" />
        <StatCard icon={<FileDoneOutlined />} label="Open Payables" value={fmtMoney(dash.data?.openPayables || 0)} hint="Approved supplier bills" color="#2563eb" />
        <StatCard icon={<WarningOutlined />} label="Due / Overdue Bills" value={fmtMoney(dash.data?.dueOverdue || 0)} hint={`${dash.data?.overdueBills || 0} overdue bills`} color="#f59e0b" />
        <StatCard icon={<PayCircleOutlined />} label="Payments This Month" value={fmtMoney(dash.data?.paymentsThisMonth || 0)} hint={`${dash.data?.paymentCount || 0} payments`} color="#10b981" />
      </div>
      <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
        <Tabs items={items} defaultActiveKey="suppliers" destroyOnHidden />
      </Card>
    </div>
  );
}

