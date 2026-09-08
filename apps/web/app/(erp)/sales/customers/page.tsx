'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, InputNumber, Popconfirm, Select, Switch, Table, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DollarOutlined, EditOutlined, DeleteOutlined, ExportOutlined, EyeOutlined, FileDoneOutlined, FileTextOutlined,
  PlusOutlined, ReloadOutlined, SearchOutlined, TeamOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtMoney } from '@/lib/format';
import { CustomerAvatar, CurrencyValue, FormSection, StatusPill, SummaryCard } from '@/components/sales-ui';
import { InvoiceFormDrawer, QuoteFormDrawer } from '@/components/sales/invoice-form';
import { PhoneInput } from '@/components/phone-input';
import { formatPhoneNumber } from '@/lib/phone-format';
import { InvoicesWorkspace } from '@/components/invoices-workspace';
import { QuotationsWorkspace } from '@/components/quotations-workspace';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Zimbabwe', 'South Africa', 'Australia', 'Germany', 'France', 'India', 'China', 'Japan', 'Brazil', 'United Arab Emirates', 'Nigeria', 'Kenya'];

export default function CustomerCenter() {
  const qc = useQueryClient();
  const router = useRouter();
  const meta = useMeta();
  const customers = useQuery({ queryKey: ['/sales/customers'], queryFn: () => api('/sales/customers') });
  const invoices = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices') });
  const quotations = useQuery({ queryKey: ['/sales/quotations'], queryFn: () => api('/sales/quotations') });
  const aging = useQuery({ queryKey: ['debtor-age'], queryFn: () => api('/sales/debtor-age') });
  const prefs = useQuery({ queryKey: ['/system/preferences'], queryFn: () => api('/system/preferences') });
  const defaultVat = Number(prefs.data?.vatDefault || 0);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [invoiceCustomer, setInvoiceCustomer] = useState<string | null>(null);
  const [quoteCustomer, setQuoteCustomer] = useState<string | null>(null);
  const [selCust, setSelCust] = useState<string[]>([]);
  const [custBusy, setCustBusy] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!customerOpen) return;
    if (editing) {
      const c = editing;
      form.setFieldsValue({ name: c.name, firstName: c.firstName, lastName: c.lastName, companyName: c.companyName, email: c.email, phone: c.phone, mobile: c.mobile, address1: c.address1, address2: c.address2, city: c.city, state: c.state, zip: c.zip, country: c.country, paymentTerms: c.paymentTerms, priceListId: c.priceListId, notes: c.notes, tin: c.tin, vatNumber: c.vatNumber, creditLimit: Number(c.creditLimit || 0), taxStatus: c.taxStatus || 'Taxable', defaultTaxRate: Number(c.defaultTaxRate || 0), status: c.status || 'ACTIVE' });
    } else {
      form.resetFields();
      form.setFieldsValue({ creditLimit: 0, defaultTaxRate: Number(prefs.data?.vatDefault || 0), taxStatus: 'Taxable', status: 'ACTIVE' });
    }
  }, [customerOpen, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = customers.data || [];
  const invRows = (invoices.data || []).filter((i: any) => i.invoiceStatus !== 'VOID');
  const quoteRows = quotations.data || [];

  const byCustomer = useMemo(() => {
    const m: Record<string, number> = {};
    (aging.data?.byCustomer || []).forEach((r: any) => { m[r.customer?.id || 'none'] = Number(r.total || 0); });
    return m;
  }, [aging.data]);

  const totalReceivables = useMemo(() => {
    const s = aging.data?.summary;
    return s ? s.current + s.d30 + s.d60 + s.d90plus : 0;
  }, [aging.data]);
  const overdueAmount = useMemo(() => {
    const s = aging.data?.summary;
    return s ? s.d30 + s.d60 + s.d90plus : 0;
  }, [aging.data]);
  const openQuotes = quoteRows.filter((c: any) => !['ACCEPTED', 'REJECTED', 'VOID'].includes(c.status)).length;

  const filtered = rows.filter((c: any) => {
    if (q && !`${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  function openAdd() { setEditing(null); setCustomerOpen(true); }
  function openEdit(c: any) { setEditing(c); setCustomerOpen(true); }
  async function saveCustomer() {
    try {
      const v = await form.validateFields();
      if (editing) await api(`/sales/customers/${editing.id}`, { method: 'PATCH', body: JSON.stringify(v) });
      else await api('/sales/customers', { method: 'POST', body: JSON.stringify(v) });
      message.success(editing ? 'Customer updated' : 'Customer created');
      qc.invalidateQueries({ queryKey: ['/sales/customers'] });
      setCustomerOpen(false);
    } catch (e: any) { message.error(e.message || 'Could not save customer'); }
  }
  async function del(c: any) {
    try { await api(`/sales/customers/${c.id}`, { method: 'DELETE' }); message.success('Customer deleted'); qc.invalidateQueries({ queryKey: ['/sales/customers'] }); }
    catch (e: any) { message.error(e.message); }
  }
  function exportCustomers(ids: string[]) {
    const rows = (customers.data || []).filter((c: any) => ids.includes(c.id));
    if (!rows.length) { message.info('Nothing to export'); return; }
    const head = ['Name', 'Email', 'Phone', 'Company'];
    const csv = [head.join(','), ...rows.map((c: any) => [c.name, c.email, c.companyName, c.phone].map((x) => `"${x ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'customers.csv'; a.click(); URL.revokeObjectURL(url);
    message.success('Exported');
  }

  const customerColumns: ColumnsType<any> = [
    { title: 'Name', dataIndex: 'name', render: (_v, r) => (<Link href={`/sales/customers/${r.id}`} className="flex items-center gap-3 group"><CustomerAvatar name={r.name} /><span className="text-[14px] font-medium text-[#171a2e] group-hover:text-[#003366]">{r.name}</span></Link>) },
    { title: 'Email', dataIndex: 'email', render: (v) => <span className="text-[13px] text-[#64748b]">{v || '—'}</span> },
    { title: 'Phone', dataIndex: 'phone', width: 150, render: (v) => <span className="text-[13px] text-[#64748b]">{v ? formatPhoneNumber(v) : '—'}</span> },
    { title: 'Due Balance', key: 'due', width: 140, align: 'right', render: (_, r) => (<CurrencyValue value={byCustomer[r.id] || 0} className={`${byCustomer[r.id] > 0 ? 'text-[#f59e0b]' : ''}`} />) },
    { title: 'Status', dataIndex: 'status', width: 110, render: (_v, r) => <StatusPill status={r.status === 'INACTIVE' ? 'Inactive' : 'Active'} tone={r.status === 'INACTIVE' ? 'amber' : undefined} /> },
    {
      ...ACTIONS_COL,
      render: (_, r) => (
        <RowActionsMenu items={[
          { key: 'view', label: 'View details', icon: <EyeOutlined />, onClick: () => router.push(`/sales/customers/${r.id}`) },
          { key: 'edit', label: 'Edit', icon: <EditOutlined />, onClick: () => openEdit(r) },
          { key: 'invoice', label: 'New Invoice', icon: <FileDoneOutlined />, disabled: r.status === 'INACTIVE', disabledReason: 'Inactive customers cannot be invoiced', onClick: () => setInvoiceCustomer(r.id) },
          { key: 'quote', label: 'New Quote', icon: <FileTextOutlined />, disabled: r.status === 'INACTIVE', disabledReason: 'Inactive customers cannot receive quotes', onClick: () => setQuoteCustomer(r.id) },
          { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, confirm: 'Delete customer?', onClick: () => del(r) },
        ]} />
      ),
    },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Customer Center</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Manage customers, invoices, quotes and receivables in one place</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add Customer</Button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        <SummaryCard icon={<TeamOutlined />} label="Total Customers" value={rows.length} tone="#0ea5e9" />
        <SummaryCard icon={<DollarOutlined />} label="Total Receivables" value={fmtMoney(totalReceivables)} tone="#003366" />
        <SummaryCard icon={<WarningOutlined />} label="Overdue Amount" value={fmtMoney(overdueAmount)} tone="#f59e0b" />
        <SummaryCard icon={<FileTextOutlined />} label="Open Quotes" value={openQuotes} tone="#8b5cf6" />
      </div>

      <div className="nex-card overflow-hidden">
        <Tabs
          defaultActiveKey="customers"
          tabBarStyle={{ paddingLeft: 8 }}
          items={[
            {
              key: 'customers', label: `Customers (${rows.length})`,
              children: (
                <div>
                  <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-[#eef0f6]">
                    <div className="w-full md:w-[420px]"><Input allowClear prefix={<SearchOutlined />} placeholder="Search customers..." className="!rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                    <Select className="w-full sm:w-[160px] !rounded-xl" value={status} onChange={setStatus} options={[{ label: 'All statuses', value: '' }, { label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }]} />
                    <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/sales/customers'] })} />
                    <span className="text-[12px] text-[#94a3b8]">{filtered.length} customers</span>
                  </div>
                  {selCust.length > 0 && (
                    <div className="px-4 py-3 flex items-center gap-3 flex-wrap bg-[#f8faff] border-b border-[#eef0f6]">
                      <span className="text-[13px] font-medium text-[#344054]">{selCust.length} selected</span>
                      <Popconfirm title={`Delete ${selCust.length} selected customers?`} onConfirm={async () => {
                        setCustBusy(true);
                        try { for (const id of selCust) await api(`/sales/customers/${id}`, { method: 'DELETE' }); message.success(`Deleted ${selCust.length}`); qc.invalidateQueries({ queryKey: ['/sales/customers'] }); setSelCust([]); }
                        catch (e: any) { message.error(e.message); }
                        finally { setCustBusy(false); }
                      }}>
                        <Button danger icon={<DeleteOutlined />} loading={custBusy}>Delete</Button>
                      </Popconfirm>
                      <Button icon={<ExportOutlined />} onClick={() => exportCustomers(selCust)}>Export</Button>
                      <div className="ml-auto"><Button size="small" onClick={() => setSelCust([])}>Clear</Button></div>
                    </div>
                  )}
                  <Table rowKey="id" loading={customers.isLoading} dataSource={filtered} columns={customerColumns} scroll={{ x: true }} pagination={false}
                    rowSelection={{ selectedRowKeys: selCust, onChange: (keys) => setSelCust(keys as string[]) }} />
                </div>
              ),
            },
            { key: 'invoices', label: `Invoices (${invRows.length})`, children: <InvoicesWorkspace embedded /> },
            { key: 'quotes', label: `Quotes (${quoteRows.length})`, children: <QuotationsWorkspace embedded /> },
          ]}
        />
      </div>

      <Drawer open={customerOpen} onClose={() => setCustomerOpen(false)} width={900} title={editing ? 'Edit Customer' : 'Add Customer'} footer={
        <div className="flex items-center gap-2 justify-end"><Button onClick={() => setCustomerOpen(false)}>Cancel</Button><Button type="primary" onClick={saveCustomer}>Save</Button></div>
      }>
        <Form form={form} layout="vertical" className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <Form.Item label="First Name" name="firstName" className="!mb-3"><Input placeholder="First name" /></Form.Item>
          <Form.Item label="Last Name" name="lastName" className="!mb-3"><Input placeholder="Last name" /></Form.Item>
          <Form.Item label="Display Name" name="name" className="!mb-3" extra="If left blank, NexusERP will generate the display name from the company or customer name."><Input placeholder="Leave blank to auto-generate" /></Form.Item>
          <Form.Item label="Company" name="companyName" className="!mb-3"><Input placeholder="Company" /></Form.Item>
          <Form.Item label="Email" name="email" className="!mb-3"><Input placeholder="email@example.com" /></Form.Item>
          <Form.Item label="Phone" name="phone" className="!mb-3"><PhoneInput country="ZW" /></Form.Item>
          <Form.Item label="Mobile" name="mobile" className="!mb-3"><PhoneInput country="ZW" /></Form.Item>
          <Form.Item label="Street Address" name="address1" className="!mb-3"><Input placeholder="Street address" /></Form.Item>
          <Form.Item label="Address Line 2" name="address2" className="!mb-3"><Input placeholder="Address line 2" /></Form.Item>
          <Form.Item label="City" name="city" className="!mb-3"><Input placeholder="City" /></Form.Item>
          <Form.Item label="State" name="state" className="!mb-3"><Input placeholder="State / Province" /></Form.Item>
          <Form.Item label="ZIP" name="zip" className="!mb-3"><Input placeholder="ZIP / Postal code" /></Form.Item>
          <Form.Item label="Country" name="country" className="!mb-3"><Select showSearch placeholder="Select country" options={COUNTRIES.map((c) => ({ label: c, value: c }))} /></Form.Item>
          <Form.Item label="Payment Terms" name="paymentTerms" className="!mb-3"><Select allowClear placeholder="e.g. Net 30" options={['Net 15', 'Net 30', 'Net 60', 'Due on Receipt'].map((t) => ({ label: t, value: t }))} /></Form.Item>
          <Form.Item label="Price List" name="priceListId" className="!mb-3"><Select allowClear showSearch optionFilterProp="label" placeholder="Customer price list" options={(meta.data?.priceLists || []).map((p: any) => ({ label: `${p.name} (${p.currency})`, value: p.id }))} /></Form.Item>
          <Form.Item label="Tax ID (TIN)" name="tin" className="!mb-3"><Input placeholder="Tax identification number" /></Form.Item>
          <Form.Item label="VAT Number" name="vatNumber" className="!mb-3"><Input placeholder="VAT number" /></Form.Item>
          <Form.Item label="Credit Limit" name="creditLimit" className="!mb-3"><InputNumber className="w-full" prefix="$" min={0} /></Form.Item>
          <Form.Item label="Notes" name="notes" className="!mb-3 md:col-span-3"><Input.TextArea rows={2} placeholder="Notes" /></Form.Item>
          <Form.Item label="Account Status" name="status" className="!mb-3 md:col-span-3" valuePropName="checked" getValueFromEvent={(checked: boolean) => (checked ? 'ACTIVE' : 'INACTIVE')} getValueProps={(v: string | undefined) => ({ checked: v !== 'INACTIVE' })}>
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>
        </Form>
        <FormSection title="Tax Settings" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Form.Item label="Tax Status" name="taxStatus" className="!mb-2"><Select options={['Taxable', 'Tax Exempt'].map((s) => ({ label: s, value: s }))} /></Form.Item>
          <Form.Item label="Default Tax Rate" name="defaultTaxRate" className="!mb-2"><Select showSearch optionFilterProp="label" placeholder="Select tax rate" options={(meta.data?.taxRates || []).map((t: any) => ({ label: `${t.name} (${Number(t.rate)}%)`, value: Number(t.rate) }))} /></Form.Item>
        </div>
      </Drawer>

      <InvoiceFormDrawer open={!!invoiceCustomer} presetCustomerId={invoiceCustomer || undefined} onClose={() => setInvoiceCustomer(null)} />
      <QuoteFormDrawer open={!!quoteCustomer} presetCustomerId={quoteCustomer || undefined} onClose={() => setQuoteCustomer(null)} />
    </div>
  );
}



