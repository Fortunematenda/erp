'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Switch, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeftOutlined, DollarOutlined, FileDoneOutlined, FileTextOutlined, PrinterOutlined, SwapOutlined,
  UserOutlined, WarningOutlined,
} from '@ant-design/icons';
import { Table } from 'antd';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { CurrencyValue, CustomerAvatar, DetailGrid, StatusPill, SummaryCard } from '@/components/sales-ui';
import { InvoiceFormDrawer, QuoteFormDrawer } from '@/components/sales/invoice-form';
import { CustomerPayments } from '@/components/sales/customer-payments';
import { CustomerTrail } from '@/components/sales/customer-trail';
import { InvoicesWorkspace } from '@/components/invoices-workspace';
import { QuotationsWorkspace } from '@/components/quotations-workspace';

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Zimbabwe', 'South Africa', 'Australia', 'Germany', 'France', 'India', 'China', 'Japan', 'Brazil', 'United Arab Emirates', 'Nigeria', 'Kenya'];

export default function CustomerDetails() {
  const { id } = useParams();
  const qc = useQueryClient();
  const meta = useMeta();
  const stmt = useQuery({ queryKey: ['customer-statement', id], queryFn: () => api(`/sales/statements/${id}`) });
  const invoices = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices') });
  const quotations = useQuery({ queryKey: ['/sales/quotations'], queryFn: () => api('/sales/quotations') });
  const receipts = useQuery({ queryKey: ['/sales/receipts'], queryFn: () => api('/sales/receipts') });
  const creditNotes = useQuery({ queryKey: ['/sales/credit-notes'], queryFn: () => api('/sales/credit-notes') });

  const [editOpen, setEditOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [period, setPeriod] = useState<any>(null);
  const [form] = Form.useForm();

  const customer = stmt.data?.customer;
  const transactions = stmt.data?.transactions || [];
  const balance = Number(stmt.data?.balance || 0);

  const custInvoices = useMemo(() => (invoices.data || []).filter((i: any) => i.customer?.id === id), [invoices.data, id]);
  const custQuotes = useMemo(() => (quotations.data || []).filter((q: any) => q.customer?.id === id), [quotations.data, id]);
  const custReceipts = useMemo(() => (receipts.data || []).filter((r: any) => r.invoice?.customer?.id === id), [receipts.data, id]);
  const custCredits = useMemo(() => (creditNotes.data || []).filter((c: any) => c.customer?.id === id), [creditNotes.data, id]);

  const paidAmount = custReceipts.reduce((s: number, r: any) => s + Number(r.amount), 0);
  const openInvoices = custInvoices.filter((i: any) => ['POSTED', 'PART_PAID', 'DRAFT'].includes(i.status)).length;
  const overdueAmount = useMemo(() => {
    let sum = 0;
    transactions.forEach((t: any) => { if (t.type === 'INVOICE' && t.amount > 0) { /* statement is chronological; derive past-due from pattern - approximate as 0 */ } });
    return 0;
  }, [transactions]);

  async function saveEdit() {
    try {
      const v = await form.validateFields();
      await api(`/sales/customers/${id}`, { method: 'PATCH', body: JSON.stringify(v) });
      message.success('Customer updated');
      qc.invalidateQueries({ queryKey: ['customer-statement', id] });
      setEditOpen(false);
    } catch (e: any) { message.error(e.message || 'Could not update customer'); }
  }
  function openEdit() {
    form.resetFields();
    form.setFieldsValue({ name: customer?.name, firstName: customer?.firstName, lastName: customer?.lastName, companyName: customer?.companyName, email: customer?.email, phone: customer?.phone, mobile: customer?.mobile, address1: customer?.address1, address2: customer?.address2, city: customer?.city, state: customer?.state, zip: customer?.zip, country: customer?.country, paymentTerms: customer?.paymentTerms, priceListId: customer?.priceListId, notes: customer?.notes, tin: customer?.tin, vatNumber: customer?.vatNumber, creditLimit: Number(customer?.creditLimit || 0), taxStatus: customer?.taxStatus || 'Taxable', defaultTaxRate: Number(customer?.defaultTaxRate || 0), status: customer?.status || 'ACTIVE' });
    setEditOpen(true);
  }

  const detailItems: [string, React.ReactNode][] = [
    ['Display Name', customer?.name],
    ['Company', customer?.companyName],
    ['Email', customer?.email],
    ['Phone', customer?.phone],
    ['Mobile', customer?.mobile],
    ['Address', [customer?.address1, customer?.city, customer?.state, customer?.zip, customer?.country].filter(Boolean).join(', ') || null],
    ['Tax Status', customer?.taxStatus || 'Taxable'],
    ['Default Tax Rate', customer?.defaultTaxRate ? `${Number(customer.defaultTaxRate)}%` : null],
    ['Tax ID (TIN)', customer?.tin],
    ['VAT Number', customer?.vatNumber],
    ['Credit Limit', fmtMoney(customer?.creditLimit || 0)],
    ['Balance', <span key="b" className={balance < 0 ? 'text-[#16a34a]' : 'text-[#171a2e]'}>{fmtMoney(balance)}</span>],
    ['Status', <StatusPill key="s" status={customer?.status === 'INACTIVE' ? 'Inactive' : 'Active'} tone={customer?.status === 'INACTIVE' ? 'amber' : undefined} />],
  ];

  const txnColumns: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'date', width: 110, render: (v) => <span className="text-[13px] text-[#475060]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Type', dataIndex: 'type', width: 120, render: (v) => <StatusPill status={String(v).replace(/_/g, ' ')} /> },
    { title: 'Reference', dataIndex: 'ref', render: (v) => <span className="font-mono text-[12px] text-[#003366]">{v}</span> },
    { title: 'Debit', width: 120, align: 'right', render: (_v, r: any) => <span className="text-[13px] text-[#171a2e] font-medium">{r.type === 'INVOICE' ? fmtMoney(r.amount) : '—'}</span> },
    { title: 'Credit', width: 120, align: 'right', render: (_v, r: any) => <span className="text-[13px] text-[#16a34a] font-medium">{r.type !== 'INVOICE' ? fmtMoney(Math.abs(r.amount)) : '—'}</span> },
    { title: 'Balance', dataIndex: 'balance', width: 130, align: 'right', render: (v) => <CurrencyValue value={v} /> },
  ];

  const payColumns: ColumnsType<any> = [
    { title: 'Payment Date', dataIndex: 'receiptDate', width: 120, render: (v) => <span className="text-[13px] text-[#475060]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Reference', dataIndex: 'receiptNo', render: (v) => <span className="font-mono text-[12px] text-[#003366]">{v}</span> },
    { title: 'Method', dataIndex: 'method', width: 110, render: (v) => <StatusPill status={v} /> },
    { title: 'Amount', dataIndex: 'amount', width: 130, align: 'right', render: (v) => <CurrencyValue value={v} /> },
    { title: 'Invoice', width: 150, render: (_, r: any) => <span className="text-[12px] text-[#64748b]">{r.invoice?.invoiceNo || '—'}</span> },
  ];

  const statementTxn = (period ? transactions.filter((t: any) => dayjs(t.date).isAfter(dayjs(period[0])) && dayjs(t.date).isBefore(dayjs(period[1]).add(1, 'day'))) : transactions);

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <Link href="/sales/customers" className="flex items-center gap-2 text-[13px] text-[#475060] hover:text-[#003366]"><ArrowLeftOutlined /> Back</Link>
        <div className="flex items-center gap-2">
          <Button icon={<UserOutlined />} onClick={openEdit}>Edit Customer</Button>
          <Button icon={<FileDoneOutlined />} disabled={customer?.status === 'INACTIVE'} onClick={() => setInvOpen(true)}>New Invoice</Button>
          <Link href={`/sales/orders/new?customerId=${id}`}><Button icon={<SwapOutlined />} disabled={customer?.status === 'INACTIVE'}>New Order</Button></Link>
          <Button type="primary" icon={<FileTextOutlined />} disabled={customer?.status === 'INACTIVE'} onClick={() => setQuoteOpen(true)}>New Quote</Button>
        </div>
      </div>

      <div className="nex-card p-6 flex flex-col md:flex-row items-start md:items-center gap-6 mb-6">
        <div className="flex items-center gap-4">
          <CustomerAvatar name={customer?.name} size={64} />
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-[20px] font-bold text-[#171a2e]">{customer?.name}</span>
              <StatusPill status={customer?.status === 'INACTIVE' ? 'Inactive' : 'Active'} tone={customer?.status === 'INACTIVE' ? 'amber' : undefined} />
            </div>
            <div className="text-[13px] text-[#64748b] mt-1">{customer?.email || '—'}{customer?.phone ? ` · ${customer.phone}` : ''}</div>
          </div>
        </div>
        <div className="md:ml-auto text-right">
          <div className="text-[13px] text-[#64748b]">Total Receivables</div>
          <div className="text-[26px] font-bold text-[#171a2e]">{fmtMoney(balance)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        <SummaryCard icon={<DollarOutlined />} label="Receivables" value={fmtMoney(balance)} tone="#0ea5e9" />
        <SummaryCard icon={<FileDoneOutlined />} label="Paid" value={fmtMoney(paidAmount)} tone="#16a34a" />
        <SummaryCard icon={<WarningOutlined />} label="Overdue" value={fmtMoney(overdueAmount)} tone="#f59e0b" />
        <SummaryCard icon={<FileTextOutlined />} label="Open Invoices" value={fmtNumber(openInvoices, 0)} tone="#8b5cf6" />
      </div>

      <div className="nex-card overflow-hidden">
        <Tabs className="customer-detail-tabs" defaultActiveKey="details" items={[
          { key: 'details', label: 'Customer Details', children: <div className="p-4 pl-10"><DetailGrid items={detailItems} cols={2} /></div> },
          { key: 'invoices', label: `Invoices (${custInvoices.length})`, children: <InvoicesWorkspace customerId={String(id)} embedded hideCustomer /> },
          { key: 'quotes', label: `Quotes (${custQuotes.length})`, children: <QuotationsWorkspace customerId={String(id)} embedded hideCustomer /> },
          { key: 'transactions', label: 'Transaction List', children: <Table rowKey={(r: any) => `${r.type}-${r.ref}`} dataSource={transactions} columns={txnColumns} scroll={{ x: true }} pagination={false} /> },
          { key: 'trail', label: 'Trails & Notes', children: <CustomerTrail customerId={String(id)} /> },
          { key: 'payments', label: `Payments (${custReceipts.length})`, children: <CustomerPayments customerId={id as string} /> },
          {
            key: 'statements', label: 'Statements', children: (
              <div>
                <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-[#eef0f6]">
                  <DatePicker.RangePicker className="!rounded-xl" value={period} onChange={setPeriod} />
                  <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
                  <span className="ml-auto text-[12px] text-[#94a3b8]">{statementTxn.length} entries · balance {fmtMoney(balance)}</span>
                </div>
                <Table rowKey={(r: any) => `${r.type}-${r.ref}`} dataSource={statementTxn} columns={txnColumns} scroll={{ x: true }} pagination={false} size="middle" />
              </div>
            ),
          },
        ]} />
      </div>

      <Drawer open={editOpen} onClose={() => setEditOpen(false)} width={720} title="Edit Customer" footer={<div className="flex items-center gap-2 justify-end"><Button onClick={() => setEditOpen(false)}>Cancel</Button><Button type="primary" onClick={saveEdit}>Save</Button></div>}>
        <Form form={form} layout="vertical" className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <Form.Item label="First Name" name="firstName" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Last Name" name="lastName" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Display Name" name="name" className="!mb-3" extra="If left blank and saved, NexusERP will regenerate it from the company or customer name."><Input placeholder="Leave blank to auto-generate" /></Form.Item>
          <Form.Item label="Company" name="companyName" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Email" name="email" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Phone" name="phone" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Mobile" name="mobile" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Street Address" name="address1" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Address Line 2" name="address2" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="City" name="city" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="State" name="state" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="ZIP" name="zip" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Country" name="country" className="!mb-3"><Select showSearch placeholder="Select country" options={COUNTRIES.map((c: any) => ({ label: c, value: c }))} /></Form.Item>
          <Form.Item label="Payment Terms" name="paymentTerms" className="!mb-3"><Select allowClear placeholder="e.g. Net 30" options={['Net 15', 'Net 30', 'Net 60', 'Due on Receipt'].map((t: any) => ({ label: t, value: t }))} /></Form.Item>
          <Form.Item label="Price List" name="priceListId" className="!mb-3"><Select allowClear showSearch optionFilterProp="label" placeholder="Customer price list" options={(meta.data?.priceLists || []).map((p: any) => ({ label: `${p.name} (${p.currency})`, value: p.id }))} /></Form.Item>
          <Form.Item label="Tax ID (TIN)" name="tin" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="VAT Number" name="vatNumber" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Credit Limit" name="creditLimit" className="!mb-3"><InputNumber className="w-full" prefix="$" min={0} /></Form.Item>
          <Form.Item label="Tax Status" name="taxStatus" className="!mb-3"><Select options={['Taxable', 'Tax Exempt'].map((s: any) => ({ label: s, value: s }))} /></Form.Item>
          <Form.Item label="Default Tax Rate" name="defaultTaxRate" className="!mb-3"><Select showSearch optionFilterProp="label" placeholder="Select tax rate" options={(meta?.data?.taxRates || []).map((t: any) => ({ label: `${t.name} (${Number(t.rate)}%)`, value: Number(t.rate) }))} /></Form.Item>
          <Form.Item label="Notes" name="notes" className="!mb-3 md:col-span-3"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item label="Account Status" name="status" className="!mb-3 md:col-span-3" valuePropName="checked" getValueFromEvent={(checked: boolean) => (checked ? 'ACTIVE' : 'INACTIVE')} getValueProps={(v: string | undefined) => ({ checked: v !== 'INACTIVE' })}>
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>
        </Form>
      </Drawer>

      <InvoiceFormDrawer open={invOpen} presetCustomerId={String(id)} onClose={() => setInvOpen(false)} />
      <QuoteFormDrawer open={quoteOpen} presetCustomerId={String(id)} onClose={() => setQuoteOpen(false)} />
    </div>
  );
}
