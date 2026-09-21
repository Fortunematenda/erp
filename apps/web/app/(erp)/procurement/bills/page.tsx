'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Checkbox, DatePicker, Descriptions, Divider, Drawer, Dropdown, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Tooltip, Upload, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined, BankOutlined, CheckCircleOutlined, DeleteOutlined, DollarOutlined, DownloadOutlined, EditOutlined, EyeOutlined, FileDoneOutlined, FileTextOutlined, PayCircleOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, RollbackOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AccountSelector } from '@/components/account-selector';
import { StatusTag } from '@/components/crud-page';
import { LineItems } from '@/components/line-items';
import { useMeta } from '@/lib/meta';
import { StatCard } from '@/components/stat-card';
import { EnterBillForm } from '@/components/enter-bill-form';
import { PayBillsWorkspace } from '@/components/pay-bills-workspace';
import { BillManagementList } from '@/components/bill-management-list';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const TERMS = ['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Custom'];
const METHODS = ['BANK', 'CHEQUE', 'CASH', 'CARD', 'MOBILE', 'OTHER'];
const DOC_STATUS = ['DRAFT', 'POSTED', 'VOID'];
const PAY_STATUS = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
const DUE_STATUS = ['OVERDUE', 'DUE_TODAY', 'DUE_THIS_WEEK', 'DUE_THIS_MONTH', 'NOT_YET_DUE'];
const arr = (v: any) => (Array.isArray(v) ? v : []);
function dueFromTerms(invDate: any, terms?: string) {
  if (!invDate || !terms) return undefined;
  const m = terms.match(/^Net (\d+)$/i);
  if (m) return dayjs(invDate).add(parseInt(m[1], 10), 'day');
  if (/receipt/i.test(terms)) return dayjs(invDate);
  return undefined;
}

export default function BillsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [tab, setTab] = useState('management');
  const [detail, setDetail] = useState<any>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payBills, setPayBills] = useState<string[]>([]);
  useEffect(() => { const b = sp.get('bill'); if (b) { setDetail(b); const r = sp.get('tab'); if (r) setTab(r); router.replace('/procurement/bills'); } }, []); // eslint-disable-line

  const items = [
    { key: 'management', label: 'Bill Management', children: <BillManagementList onOpenBill={(id) => setDetail(id)} onGoPay={() => setTab('pay')} /> },
    { key: 'enter', label: 'Enter Bill', children: <EnterBillForm variant="tab" onSaved={() => setTab('management')} /> },
    { key: 'pay', label: 'Pay Bill', children: <PayBillsWorkspace onOpenBill={(id) => setDetail(id)} /> },
  ];
  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div><h1 className="text-[26px] font-bold text-[#171a2e]">Bill Management</h1><p className="text-[13px] text-[#64748b]">Accounts Payable workspace</p></div>
        <Space><Button icon={<FileTextOutlined />} onClick={() => router.push('/expenses/vendor-credits')}>Vendor Credits</Button><Button icon={<ReloadOutlined />} onClick={() => router.refresh()} /><Button icon={<DollarOutlined />} onClick={() => setTab('pay')}>Pay Supplier</Button></Space>
      </div>
      <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
        <Tabs items={items} activeKey={tab} onChange={setTab} destroyOnHidden />
      </Card>

      {detail && <BillDetailModal billId={detail} onClose={() => setDetail(null)} onPay={(id) => { setPayBills([id]); setPayOpen(true); setDetail(null); }} />}
      {payOpen && <PaySupplierDrawer open={payOpen} onClose={() => setPayOpen(false)} initialBills={payBills} onSaved={() => { setPayOpen(false); }} />}
    </div>
  );
}

// ============ Bill Management tab ============
function BillManagementTab({ onOpen, onPay, onGoPay }: { onOpen: (id: string) => void; onPay: (ids: string[]) => void; onGoPay: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const meta = useMeta();
  const dash = useQuery({ queryKey: ['/procurement/dashboard'], queryFn: () => api('/procurement/dashboard') });
  const [q, setQ] = useState(''); const [vendorId, setVendorId] = useState(''); const [docStatus, setDocStatus] = useState(''); const [payStatus, setPayStatus] = useState(''); const [dueStatus, setDueStatus] = useState('');
  const [billRange, setBillRange] = useState<any>(undefined); const [dueRange, setDueRange] = useState<any>(undefined);
  const [sortBy, setSortBy] = useState('invoiceDate'); const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25);
  const [colsOn, setColsOn] = useState<Record<string, boolean>>({ currency: false, po: false, project: false, matchStatus: false, created: false });
  const list = useQuery({ queryKey: ['/procurement/bills', q, vendorId, docStatus, payStatus, dueStatus, billRange, dueRange, sortBy, sortDir, page, pageSize], queryFn: () => {
    const p = new URLSearchParams(); if (q) p.set('q', q); if (vendorId) p.set('vendorId', vendorId); if (docStatus) p.set('documentStatus', docStatus); if (payStatus) p.set('paymentStatus', payStatus); if (dueStatus) p.set('dueStatus', dueStatus);
    if (billRange) { p.set('billDateFrom', billRange[0].format('YYYY-MM-DD')); p.set('billDateTo', billRange[1].format('YYYY-MM-DD')); } if (dueRange) { p.set('dueDateFrom', dueRange[0].format('YYYY-MM-DD')); p.set('dueDateTo', dueRange[1].format('YYYY-MM-DD')); }
    p.set('sortBy', sortBy); p.set('sortDirection', sortDir); p.set('page', String(page)); p.set('pageSize', String(pageSize));
    return api(`/procurement/bills?${p.toString()}`); } });
  const data = list.data || { rows: [], total: 0 }; const vendors = meta.data?.suppliers || [];

  function refresh() { qc.invalidateQueries({ queryKey: ['/procurement/bills'] }); qc.invalidateQueries({ queryKey: ['/procurement/dashboard'] }); }
  function clear() { setQ(''); setVendorId(''); setDocStatus(''); setPayStatus(''); setDueStatus(''); setBillRange(undefined); setDueRange(undefined); setPage(1); setSortBy('invoiceDate'); setSortDir('desc'); }
  function onTableChange(pg: any, _f: any, sorter: any) { setPage(pg.current || 1); setPageSize(pg.pageSize || 25); if (sorter?.field) { setSortBy(sorter.field); setSortDir(sorter.order === 'ascend' ? 'asc' : 'desc'); } }

  const cols: ColumnsType<any> = [
    { title: 'Bill #', dataIndex: 'invoiceNo', sorter: true, width: 120, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => onOpen(r.id)}>{v}</a> },
    { title: 'Vendor', dataIndex: 'supplier', sorter: true, render: (v: any, r: any) => v ? <a className="text-[#171a2e] hover:text-[#003366] hover:underline cursor-pointer" onClick={() => router.push(`/procurement/suppliers/${r.supplierId}`)}>{v.name}</a> : '—' },
    { title: 'Vendor Inv #', dataIndex: 'supplierInvoiceNo', width: 130 },
    { title: 'Bill Date', dataIndex: 'invoiceDate', sorter: true, width: 110, render: fmtDate },
    { title: 'Due Date', dataIndex: 'dueDate', sorter: true, width: 110, render: (v: any, r: any) => <span>{v ? fmtDate(v) : '—'}{r.dueStatus === 'OVERDUE' ? ' <span className="text-red-600 font-semibold">· OVERDUE</span>' : ''}</span> },
    { title: 'Amount', dataIndex: 'total', align: 'right', sorter: true, render: (v: any) => fmtMoney(v) },
    { title: 'Paid', dataIndex: 'amountPaid', align: 'right', sorter: true, render: (v: any) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Remaining', dataIndex: 'remaining', align: 'right', sorter: true, render: (v: any) => <span className={`font-semibold ${Number(v) > 0 ? 'text-[#F97316]' : 'text-[#16a34a]'}`}>{fmtMoney(v)}</span> },
    { title: 'Payment', dataIndex: 'paymentStatus', width: 130, sorter: true, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Document', dataIndex: 'status', width: 110, sorter: true, render: (v: any) => <StatusTag value={v} /> },
    ...(colsOn.currency ? [{ title: 'Currency', dataIndex: 'currency', width: 90 }] : []),
    ...(colsOn.po ? [{ title: 'PO', render: (_: any, r: any) => r.purchaseOrder?.poNo || '—', width: 110 }] : []),
    ...(colsOn.project ? [{ title: 'Project', dataIndex: 'project', render: (v: any) => v?.name || '—', width: 130 }] : []),
    ...(colsOn.matchStatus ? [{ title: 'Match', dataIndex: 'matchStatus', width: 130, render: (v: any) => <StatusTag value={v} /> }] : []),
    ...(colsOn.created ? [{ title: 'Created', dataIndex: 'createdAt', width: 110, render: fmtDate }] : []),
    { ...ACTIONS_COL, render: (_: any, r: any) => <BillRowActions bill={r} onOpen={() => onOpen(r.id)} onPay={() => onPay([r.id])} /> },
  ];
  const colItems = ['currency', 'po', 'project', 'matchStatus', 'created'].map((k) => ({ key: k, label: k.replace(/(^|\s)\w/g, (m) => m.toUpperCase()) }));

  const kpis = [
    { icon: <DollarOutlined />, label: 'Total Outstanding', value: fmtMoney(dash.data?.openPayables || 0), color: '#f59e0b', click: () => { setPayStatus(''); setDueStatus(''); } },
    { icon: <BankOutlined />, label: 'Overdue Bills', value: fmtMoney(dash.data?.dueOverdue || 0), color: '#ef4444', hint: `${dash.data?.overdueBills || 0} bills`, click: () => { setPayStatus(''); setDueStatus('OVERDUE'); } },
    { icon: <FileDoneOutlined />, label: 'Due This Week', value: fmtMoney(weekDue(data.rows)), color: '#2563eb', click: () => { setPayStatus(''); setDueStatus('DUE_THIS_WEEK'); } },
    { icon: <PayCircleOutlined />, label: 'Paid This Month', value: fmtMoney(dash.data?.paymentsThisMonth || 0), color: '#16a34a', click: onGoPay },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {kpis.map((k) => <button key={k.label} className="text-left" onClick={k.click}><StatCard icon={k.icon} label={k.label} value={k.value} hint={k.hint} color={k.color} /></button>)}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search bill / vendor / reference…" className="!w-72 !rounded-xl" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Vendor" className="!min-w-[160px]" value={vendorId || undefined} onChange={(v) => { setVendorId(v || ''); setPage(1); }} options={vendors.map((v: any) => ({ label: v.name, value: v.id }))} />
        <Select allowClear placeholder="Document Status" className="!min-w-[130px]" value={docStatus || undefined} onChange={(v) => { setDocStatus(v || ''); setPage(1); }} options={DOC_STATUS.map((s) => ({ label: s, value: s }))} />
        <Select allowClear placeholder="Payment Status" className="!min-w-[140px]" value={payStatus || undefined} onChange={(v) => { setPayStatus(v || ''); setPage(1); }} options={PAY_STATUS.map((s) => ({ label: s, value: s }))} />
        <Select allowClear placeholder="Due Status" className="!min-w-[140px]" value={dueStatus || undefined} onChange={(v) => { setDueStatus(v || ''); setPage(1); }} options={DUE_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <DatePicker.RangePicker className="!rounded-xl" value={billRange} onChange={(v) => { setBillRange(v); setPage(1); }} placeholder={['Bill from', 'Bill to']} />
        <DatePicker.RangePicker className="!rounded-xl" value={dueRange} onChange={(v) => { setDueRange(v); setPage(1); }} placeholder={['Due from', 'Due to']} />
        <Dropdown menu={{ items: colItems, selectable: true, selectedKeys: Object.keys(colsOn).filter((k) => colsOn[k]), onSelect: ({ key }) => setColsOn((c) => ({ ...c, [key]: true })), onDeselect: ({ key }) => setColsOn((c) => ({ ...c, [key]: false })) }} trigger={['click']}><Button icon={<FileTextOutlined />}>Columns</Button></Dropdown>
        <Button onClick={clear}>Clear</Button>
      </div>
      <Table rowKey="id" loading={list.isLoading} dataSource={arr(data.rows)} columns={cols} scroll={{ x: true }} onChange={onTableChange} pagination={{ current: page, pageSize, total: data.total, showSizeChanger: true, showTotal: (t) => `${t} bills` }} />
    </div>
  );
}
function weekDue(rows: any[]) { const end = dayjs().add(7, 'day'); return rows.filter((r) => r.dueDate && Number(r.remaining) > 0 && dayjs(r.dueDate).isBefore(end) && !dayjs(r.dueDate).isBefore(dayjs(), 'day')).reduce((s, r) => s + Number(r.remaining), 0); }

function BillRowActions({ bill, onOpen, onPay }: { bill: any; onOpen: () => void; onPay: () => void }) {
  const qc = useQueryClient();
  const remaining = Number(bill.remaining);
  const overdue = bill.dueStatus === 'OVERDUE';
  const canPay = bill.status === 'POSTED' && remaining > 0.005;
  const payLabel = overdue ? 'Pay Now' : Number(bill.amountPaid) > 0.005 ? 'Pay Balance' : 'Pay Bill';
  return (
    <RowActionsMenu items={[
      { key: 'view', label: 'View Bill', icon: <EyeOutlined />, onClick: onOpen },
      { key: 'edit', label: 'Edit', icon: <EditOutlined />, hidden: bill.status !== 'DRAFT', onClick: onOpen },
      { key: 'pay', label: payLabel, icon: <PayCircleOutlined />, hidden: !canPay, onClick: onPay },
      { key: 'post', label: 'Save & Post', icon: <FileDoneOutlined />, onClick: async () => { try { await api(`/procurement/supplier-invoices/${bill.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST' }) }); message.success('Bill posted — awaiting payment'); qc.invalidateQueries({ queryKey: ['/procurement/bills'] }); qc.invalidateQueries({ queryKey: ['/procurement/dashboard'] }); } catch (e: any) { message.error(e.message); } } },
      { key: 'journal', label: 'View Journal Entry', icon: <FileTextOutlined />, hidden: bill.status !== 'POSTED', onClick: () => window.open('/finance/journals', '_blank') },
      { key: 'flow', label: 'Document Flow', icon: <FileDoneOutlined />, hidden: bill.status !== 'POSTED', onClick: () => window.open('/procurement', '_blank') },
      { key: 'void', label: 'Void Bill', icon: <RollbackOutlined />, danger: true, hidden: bill.status !== 'POSTED', onClick: async () => { try { await api(`/procurement/supplier-invoices/${bill.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'VOID' }) }); message.success('Bill voided'); qc.invalidateQueries({ queryKey: ['/procurement/bills'] }); } catch (e: any) { message.error(e.message); } } },
      { key: 'delete', label: 'Delete Draft', icon: <DeleteOutlined />, danger: true, hidden: bill.status !== 'DRAFT', onClick: async () => { try { await api(`/procurement/supplier-invoices/${bill.id}`, { method: 'DELETE' }); message.success('Draft deleted'); qc.invalidateQueries({ queryKey: ['/procurement/bills'] }); } catch (e: any) { message.error(e.message); } } },
    ]} />
  );
}

// ============ Enter Bill tab (compact) ============
function EnterBillTab({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient(); const meta = useMeta();
  const [form] = Form.useForm();
  const [vendorId, setVendorId] = useState(''); const [billDate, setBillDate] = useState<any>(dayjs()); const [terms, setTerms] = useState<string>('Net 30'); const [dueDate, setDueDate] = useState<any>(dayjs().add(30, 'day'));
  const [currency, setCurrency] = useState('USD'); const [billNo, setBillNo] = useState(''); const [supplierInvNo, setSupplierInvNo] = useState(''); const [memo, setMemo] = useState(''); const [ref, setRef] = useState(''); const [projectId, setProjectId] = useState('');
  const [attachment, setAttachment] = useState<any>(null); const [saving, setSaving] = useState(false);
  const supplier = (meta.data?.suppliers || []).find((s: any) => s.id === vendorId);
  const vendors = meta.data?.suppliers || [];
  useEffect(() => { if (supplier?.paymentTerms) setTerms(supplier.paymentTerms); }, [vendorId]);
  useEffect(() => { if (terms === 'Custom') { setDueDate(undefined); return; } setDueDate(dueFromTerms(billDate, terms)); }, [terms, billDate]);
  const lines = Form.useWatch('lines', form) || [];
  const total = lines.reduce((s: number, l: any) => s + (Number(l.quantity) * Number(l.unitPrice) * (1 - (Number(l.discount) || 0) / 100) * (1 + Number(l.taxRate || 0) / 100)), 0);
  const projects = useQuery({ queryKey: ['/projects'], queryFn: () => api('/projects') });

  async function save(post: boolean) {
    const v = await form.validateFields().catch(() => null); if (!v?.lines || !v.lines.length) { message.error('Add at least one line'); return; }
    setSaving(true);
    try {
      const body = { supplierId: vendorId, invoiceNo: billNo || undefined, supplierInvoiceNo: supplierInvNo || undefined, invoiceDate: billDate.format('YYYY-MM-DD'), dueDate: dueDate ? dueDate.format('YYYY-MM-DD') : undefined, terms, currency, ref, memo, projectId: projectId || undefined, lines: v.lines.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount || 0, taxRate: l.taxRate || 0, accountId: l.accountId })) };
      const bill = await api('/procurement/supplier-invoices', { method: 'POST', body: JSON.stringify(body) });
      if (attachment) await api(`/procurement/supplier-invoices/${bill.id}/attachments`, { method: 'POST', body: JSON.stringify({ name: attachment.name, mime: attachment.mime, size: attachment.size, dataUrl: attachment.dataUrl }) });
      if (post) await api(`/procurement/supplier-invoices/${bill.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST' }) });
      message.success(post ? 'Bill posted — awaiting payment' : 'Draft saved'); qc.invalidateQueries({ queryKey: ['/procurement/bills'] }); qc.invalidateQueries({ queryKey: ['/procurement/dashboard'] }); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="w-full">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard icon={<FileTextOutlined />} label="Total Lines" value={lines.length} />
        <StatCard icon={<DollarOutlined />} label="Total Amount" value={fmtMoney(total)} />
        <StatCard icon={<BankOutlined />} label="Vendor" value={supplier?.name || '—'} />
        <StatCard icon={<CheckCircleOutlined />} label="Status" value="New" />
      </div>
      <Form form={form} layout="vertical" className="nex-card !rounded-xl p-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Form.Item label="Bill Date *" required><DatePicker className="w-full" value={billDate} onChange={setBillDate} allowClear={false} /></Form.Item>
          <Form.Item label="Due Date"><DatePicker className="w-full" value={dueDate} onChange={setDueDate} disabled={terms !== 'Custom'} /></Form.Item>
          <Form.Item label="Bill #"><Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="Auto" disabled /></Form.Item>
          <Form.Item label="Terms *" required><Select value={terms} onChange={setTerms} options={TERMS.map((t) => ({ label: t, value: t }))} /></Form.Item>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Form.Item label="Vendor *" required><Select showSearch optionFilterProp="label" value={vendorId || undefined} onChange={setVendorId} options={vendors.map((v: any) => ({ label: v.name, value: v.id }))} placeholder="Select vendor" /></Form.Item>
          <Form.Item label="Vendor Invoice #"><Input value={supplierInvNo} onChange={(e) => setSupplierInvNo(e.target.value)} placeholder="e.g. INV-12345" /></Form.Item>
          <Form.Item label="Currency"><Select value={currency} onChange={setCurrency} options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item>
          <Form.Item label="Project"><Select allowClear showSearch optionFilterProp="label" value={projectId || undefined} onChange={setProjectId} options={(projects.data || []).map((p: any) => ({ label: p.name, value: p.id }))} /></Form.Item>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Form.Item>
          <Form.Item label="Memo"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
        </div>
        <div className="mb-4">
          <div className="text-[12px] font-medium text-[#566] mb-1">Attachment (Vendor Invoice File)</div>
          {attachment ? (
            <div className="rounded-xl border border-[#eef0f6] p-3 flex items-center gap-3">
              <FileTextOutlined className="text-[#003366]" />
              <div className="flex-1 min-w-0"><div className="font-medium text-[13px] truncate">{attachment.name}</div><div className="text-[11px] text-[#8a90ad]">{Math.round(attachment.size / 1024)} KB</div></div>
              <Space size={2}><Tooltip title="Preview"><Button size="small" icon={<EyeOutlined />} onClick={() => window.open(attachment.dataUrl, '_blank')} /></Tooltip><Tooltip title="Remove"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => setAttachment(null)} /></Tooltip></Space>
            </div>
          ) : (
            <Upload.Dragger beforeUpload={(file) => { const r = new FileReader(); r.onload = () => setAttachment({ name: file.name, mime: file.type, size: file.size, dataUrl: String(r.result) }); r.readAsDataURL(file); return false; }} showUploadList={false} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" className="!rounded-xl">
              <p className="text-[13px] text-[#64748b] mb-0"><UploadOutlined className="mr-1" />Drop vendor invoice here or click to browse</p><p className="text-[11px] text-[#a1a6c0] mb-0">PDF, JPG, PNG, DOC, XLS</p>
            </Upload.Dragger>
          )}
        </div>
        <Form.Item label="Bill Lines" required><LineItems form={form} lines="lines" items={meta.data?.items || []} account priceKey="purchaseCost" /></Form.Item>
        <div className="flex justify-end font-semibold text-[15px] text-[#171a2e] mb-2">Total: <span className="text-[#003366] ml-2">{fmtMoney(total)}</span></div>
        <div className="text-[12px] text-[#64748b] mb-4">Unpaid — creates Accounts Payable</div>
        <div className="flex justify-end gap-2"><Button onClick={onSaved}>Cancel</Button><Button onClick={() => save(false)} disabled={saving}>Save Draft</Button><Button type="primary" onClick={() => save(true)} loading={saving}>Save & Post</Button></div>
      </Form>
    </div>
  );
}

// ============ Pay Bill tab ============
function PayBillTab({ onPay }: { onPay: (ids: string[]) => void }) {
  const meta = useMeta();
  const [q, setQ] = useState(''); const [vendorId, setVendorId] = useState(''); const [dueStatus, setDueStatus] = useState('DUE');
  const [sortBy, setSortBy] = useState('dueDate'); const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');
  const [selected, setSelected] = useState<string[]>([]);
  const list = useQuery({ queryKey: ['/procurement/bills', 'pay', q, vendorId, dueStatus, sortBy, sortDir], queryFn: () => {
    const p = new URLSearchParams(); p.set('onlyOutstanding', 'true'); if (q) p.set('q', q); if (vendorId) p.set('vendorId', vendorId); p.set('sortBy', sortBy); p.set('sortDirection', sortDir); p.set('pageSize', '500');
    return api(`/procurement/bills?${p.toString()}`); } });
  const rows = arr(list.data?.rows);
  const selectedBills = rows.filter((r: any) => selected.includes(r.id));
  const amountDue = selectedBills.reduce((s: number, r: any) => s + Number(r.remaining), 0);

  const cols: ColumnsType<any> = [
    { title: '☐', width: 40, render: (_: any, r: any) => <Checkbox checked={selected.includes(r.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id))} /> },
    { title: 'Bill #', dataIndex: 'invoiceNo', width: 120 }, { title: 'Vendor', render: (_: any, r: any) => r.supplier?.name || '—' },
    { title: 'Vendor Inv #', dataIndex: 'supplierInvoiceNo', width: 130 }, { title: 'Bill Date', dataIndex: 'invoiceDate', width: 105, render: fmtDate },
    { title: 'Due Date', dataIndex: 'dueDate', sorter: true, width: 105, render: (v: any, r: any) => <span>{v ? fmtDate(v) : '—'}{r.dueStatus === 'OVERDUE' && <span className="text-red-600 font-semibold"> · OD</span>}</span> },
    { title: 'Total', dataIndex: 'total', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Paid', dataIndex: 'amountPaid', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Balance', dataIndex: 'remaining', align: 'right', sorter: true, render: (v: any) => <span className="font-semibold text-[#F97316]">{fmtMoney(v)}</span> },
    { title: 'Payment', dataIndex: 'paymentStatus', width: 120, render: (v: any) => <StatusTag value={v} /> },
    { title: '', width: 130, render: (_: any, r: any) => <Button size="small" type="primary" icon={<PayCircleOutlined />} onClick={() => onPay([r.id])}>{r.dueStatus === 'OVERDUE' ? 'Pay Now' : Number(r.amountPaid) > 0.005 ? 'Pay Balance' : 'Pay Bill'}</Button> },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search bill / vendor / reference…" className="!w-72 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Vendor" className="!min-w-[170px]" value={vendorId || undefined} onChange={setVendorId} options={(meta.data?.suppliers || []).map((v: any) => ({ label: v.name, value: v.id }))} />
        <Select value={dueStatus} onChange={setDueStatus} className="!min-w-[150px]" options={[{ label: 'Outstanding Bills', value: 'DUE' }, ...DUE_STATUS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))]} />
        <div className="ml-auto"><Button type="primary" icon={<PayCircleOutlined />} disabled={!selected.length} onClick={() => onPay(selected)}>Pay Selected ({selected.length})</Button></div>
      </div>
      {selected.length > 0 && <div className="nex-card mb-3 px-4 py-2 flex items-center gap-4 !rounded-xl"><span className="text-[13px] text-[#344054]">Selected Bills: {selected.length}</span><span className="text-[13px] text-[#344054]">Amount Due: <b className="text-[#F97316]">{fmtMoney(amountDue)}</b></span></div>}
      <Table rowKey="id" loading={list.isLoading} dataSource={rows} columns={cols} scroll={{ x: true }} pagination={{ pageSize: 20 }} />
    </div>
  );
}

// ============ Bill Detail modal ============
function BillDetailModal({ billId, onClose, onPay }: { billId: string; onClose: () => void; onPay: (id: string) => void }) {
  const { data: bill, isLoading } = useQuery({ queryKey: ['/procurement/bills', billId], queryFn: () => api(`/procurement/bills/${billId}`) });
  const [tab, setTab] = useState('details');
  if (isLoading) return <Drawer open onClose={onClose} title="Bill" width={980}><div className="p-4 text-[#8a90ad]">Loading bill…</div></Drawer>;
  if (!bill) return null;
  const payable = bill.status === 'POSTED' && Number(bill.remaining) > 0.005;
  const lineCols: ColumnsType<any> = [
    { title: 'Account', render: (_: any, r: any) => r.accountCode ? <span className="font-mono text-[12px]">{r.accountCode}</span> : <span className="text-[#8a90ad]">—</span> },
    { title: 'Item / Service', render: (_: any, r: any) => r.itemId ? <span>Item</span> : <span className="text-[#8a90ad]">—</span> },
    { title: 'Description', dataIndex: 'description' }, { title: 'Qty', dataIndex: 'quantity', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Rate', dataIndex: 'unitPrice', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Tax', dataIndex: 'taxAmount', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Amount', dataIndex: 'lineTotal', align: 'right', render: (v: any) => <span className="font-semibold">{fmtMoney(v)}</span> },
  ];
  const payCols: ColumnsType<any> = [
    { title: 'Payment #', dataIndex: 'paymentNo', render: (v: any, r: any) => <a className="text-[#2563eb]" href="/procurement" target="_blank">{v}</a> },
    { title: 'Date', dataIndex: 'paidAt', render: fmtDate }, { title: 'Method', dataIndex: 'method', width: 100 },
    { title: 'Reference', dataIndex: 'referenceNo' }, { title: 'Applied', dataIndex: 'applied', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
  ];
  const tabs = [
    { key: 'details', label: 'Bill Details', children: <div>
      <Descriptions column={3} size="small" bordered items={[{ label: 'Vendor', children: bill.supplier?.name }, { label: 'Vendor Invoice #', children: bill.supplierInvoiceNo || '—' }, { label: 'Bill #', children: bill.invoiceNo }, { label: 'Bill Date', children: fmtDate(bill.invoiceDate) }, { label: 'Terms', children: bill.terms || '—' }, { label: 'Due Date', children: bill.dueDate ? fmtDate(bill.dueDate) : '—' }, { label: 'Currency', children: bill.currency }, { label: 'PO', children: bill.purchaseOrder?.poNo || '—' }, { label: 'Project', children: bill.project?.name || '—' }, { label: 'Reference', children: bill.ref || '—' }, { label: 'Memo', children: bill.memo || '—' }]} />
      <div className="mt-4"><Table rowKey="id" size="small" dataSource={bill.lines || []} columns={lineCols} pagination={false} /></div>
      <div className="flex justify-end mt-3 max-w-md ml-auto"><Descriptions column={1} size="small" bordered items={[{ label: 'Subtotal', children: fmtMoney(bill.subtotal) }, { label: 'Tax', children: fmtMoney(bill.taxTotal) }, { label: 'Total', children: <b>{fmtMoney(bill.total)}</b> }, { label: 'Paid', children: <span className="text-[#16a34a]">{fmtMoney(bill.amountPaid)}</span> }, { label: 'Balance Due', children: <span className="text-[#F97316] font-semibold">{fmtMoney(bill.remaining)}</span> }]} /></div>
    </div> },
    { key: 'payments', label: 'Payments', children: <Table rowKey="id" size="small" dataSource={bill.payments || []} columns={payCols} pagination={false} /> },
    { key: 'attachments', label: 'Attachments', children: arr(bill.attachments).length ? <div className="space-y-2">{arr(bill.attachments).map((a: any) => <div key={a.id} className="rounded-xl border p-3 flex items-center gap-3"><FileTextOutlined /><div className="flex-1 truncate">{a.name}</div><Tooltip title="Preview"><Button size="small" icon={<EyeOutlined />} onClick={() => window.open(a.dataUrl, '_blank')} /></Tooltip></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No attachments" /> },
    { key: 'flow', label: 'Document Flow', children: <div className="space-y-2">
      <FlowRow type="Purchase Order" ref={bill.purchaseOrder?.poNo || '—'} href={bill.purchaseOrderId ? `/documents/purchase-order/${bill.purchaseOrderId}` : undefined} />
      <FlowRow type="Goods Receipt" ref="—" />
      <FlowRow type="Supplier Bill" ref={bill.invoiceNo} href={`/documents/supplier-invoice/${bill.id}`} />
      {(bill.payments || []).map((p: any) => <FlowRow key={p.id} type="Supplier Payment" ref={p.paymentNo} href="/procurement" />)}
      <FlowRow type="Journal Entry" ref="—" href="/finance/journals" />
    </div> },
    { key: 'trail', label: 'Bill Trail', children: <div className="space-y-2">
      {[{ t: `Bill ${bill.invoiceNo} created`, d: bill.createdAt }, ...(bill.status === 'POSTED' ? [{ t: 'Bill posted', d: bill.createdAt }] : []), ...arr(bill.payments).map((p: any) => ({ t: `Payment ${p.paymentNo} · ${fmtMoney(p.applied)}`, d: p.paidAt }))].map((e, i) => <div key={i} className="flex items-center gap-3 rounded-xl border p-3"><CheckCircleOutlined className="text-[#003366]" /><div className="flex-1"><div className="text-[13px] text-[#171a2e]">{e.t}</div><div className="text-[11px] text-[#8a90ad]">{fmtDate(e.d)}</div></div></div>)}
    </div> },
    { key: 'preview', label: 'Document Preview', children: <iframe src={`/documents/supplier-invoice/${bill.id}`} className="w-full h-[520px] rounded-xl border" /> },
  ];
  return (
    <Drawer open onClose={onClose} width={980} title={<span>Supplier Bill <b>{bill.invoiceNo}</b></span>}
      extra={<Space wrap>{payable && <Button type="primary" icon={<PayCircleOutlined />} onClick={() => onPay(bill.id)}>{Number(bill.amountPaid) > 0.005 ? 'Pay Balance' : 'Make Payment'}</Button>}<Tooltip title="Print"><a href={`/documents/supplier-invoice/${bill.id}`} target="_blank"><Button icon={<PrinterOutlined />} /></a></Tooltip>{bill.status === 'DRAFT' && <Button icon={<CheckCircleOutlined />} onClick={() => { api(`/procurement/supplier-invoices/${bill.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST' }) }).then(() => { message.success('Bill posted — awaiting payment'); onClose(); }).catch((e) => message.error(e.message)); }}>Save & Post</Button>}</Space>}>
      <div className="mb-4 flex flex-wrap gap-8 rounded-xl bg-[#f8f9ff] px-5 py-3">
        {[{ l: 'Bill Total', v: fmtMoney(bill.total), c: '#171a2e' }, { l: 'Paid', v: fmtMoney(bill.amountPaid), c: '#16a34a' }, { l: 'Balance Due', v: fmtMoney(bill.remaining), c: '#F97316' }, { l: 'Due Date', v: bill.dueDate ? fmtDate(bill.dueDate) : '—', c: '#64748b' }].map((k) => <div key={k.l}><div className="text-[12px] text-[#64748b]">{k.l}</div><div className="text-[18px] font-bold" style={{ color: k.c }}>{k.v}</div></div>)}
        <div className="flex items-center gap-2 ml-auto"><StatusTag value={bill.status} /><StatusTag value={bill.paymentStatus} /></div>
      </div>
      <Tabs items={tabs} activeKey={tab} onChange={setTab} destroyOnHidden />
    </Drawer>
  );
}

function FlowRow({ type, ref, href }: { type: string; ref: string; href?: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-[#eef0f6] px-4 py-2.5"><span className="text-[13px] text-[#64748b] w-36">{type}</span>{href ? <a className="text-[#2563eb] hover:underline" href={href} target="_blank">{ref}</a> : <span className="text-[13px] text-[#171a2e]">{ref}</span>}</div>;
}

function PaySupplierDrawer({ open, onClose, initialBills, onSaved }: { open: boolean; onClose: () => void; initialBills: string[]; onSaved: () => void }) {
  const bills = useQuery({ queryKey: ['/procurement/bills', 'pay-drawer'], queryFn: () => api('/procurement/bills?onlyOutstanding=true&pageSize=500') });
  const [method, setMethod] = useState('BANK'); const [payFrom, setPayFrom] = useState<string>(); const [date, setDate] = useState<any>(dayjs()); const [reference, setReference] = useState(''); const [memo, setMemo] = useState('');
  const [applyMap, setApplyMap] = useState<Record<string, number>>({}); const [advance, setAdvance] = useState(0); const [saving, setSaving] = useState(false);
  const rows = arr(bills.data?.rows);
  const outstanding = rows.filter((r: any) => r.status === 'POSTED' && Number(r.remaining) > 0);
  const applied = Object.values(applyMap).reduce((s, v) => s + Number(v || 0), 0);
  const amount = Number(applied) + Number(advance || 0);
  useEffect(() => { if (!open) return; setDate(dayjs()); setMethod('BANK'); setPayFrom(undefined); setReference(''); setMemo(''); setAdvance(0); const m: Record<string, number> = {}; outstanding.forEach((b: any) => { if (initialBills.includes(b.id)) m[b.id] = Number(b.remaining); }); setApplyMap(m); }, [open]); // eslint-disable-line
  async function post() {
    if (!(amount > 0)) { message.error('Select bills to apply'); return; }
    const supplierId = outstanding.find((b: any) => applyMap[b.id] > 0)?.supplierId;
    if (!supplierId) { message.error('No supplier'); return; }
    setSaving(true);
    try {
      const allocations = Object.entries(applyMap).filter(([, v]) => Number(v) > 0).map(([billId, v]) => ({ supplierInvoiceId: billId, amount: Number(v) }));
      await api('/procurement/supplier-payments', { method: 'POST', body: JSON.stringify({ supplierId, amount, method, referenceNo: reference, note: memo, payFromAccountId: payFrom, paidAt: date.format('YYYY-MM-DD'), allocations }) });
      message.success('Payment posted'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={680} title="Pay Supplier" extra={<Button onClick={onClose}>Cancel</Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={post} loading={saving}>Post Payment</Button></Space>}>
      <Form layout="vertical">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Payment Date *" required><DatePicker className="w-full" value={date} onChange={setDate} allowClear={false} /></Form.Item>
          <Form.Item label="Payment Method *" required><Select value={method} onChange={setMethod} options={METHODS.map((m) => ({ label: m.replace(/_/g, ' '), value: m }))} /></Form.Item>
        </div>
        <Form.Item label="Pay From *" required><AccountSelector allowedTypes={['BANK', 'CASH']} value={payFrom} onChange={setPayFrom} placeholder="Select bank / cash account" /></Form.Item>
        <Form.Item label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'CHEQUE' ? 'Check number' : 'Transaction reference'} /></Form.Item>
        <Form.Item label="Memo"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
      <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-bold">Outstanding Bills</span><Space><Button size="small" onClick={() => { const m: Record<string, number> = {}; outstanding.forEach((b) => (m[b.id] = Number(b.remaining))); setApplyMap(m); }}>Auto Apply</Button><Button size="small" onClick={() => setApplyMap({})}>Clear</Button></Space></div>
      {outstanding.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No outstanding bills" />}
      {outstanding.map((b: any) => { const checked = (applyMap[b.id] || 0) > 0; return (
        <div key={b.id} className="rounded-xl border border-[#eef0f6] p-3 mb-2 flex items-center gap-3" style={{ background: checked ? '#f8f9ff' : '#fff' }}>
          <Checkbox checked={checked} onChange={(e) => setApplyMap((m) => { const n = { ...m }; if (e.target.checked) n[b.id] = Number(b.remaining); else delete n[b.id]; return n; })} />
          <div className="flex-1 min-w-0"><span className="font-medium text-[13px]">{b.invoiceNo}</span>{b.dueDate ? <span className="text-[11px] text-[#8a90ad] ml-2">due {fmtDate(b.dueDate)}{b.dueStatus === 'OVERDUE' ? ' · OD' : ''}</span> : null}</div>
          <span className="text-[12px] text-[#8a90ad]">Balance</span><span className="font-bold text-[13px] text-[#F97316] w-20 text-right">{fmtMoney(b.remaining)}</span>
          <InputNumber className="!w-24" prefix="$" min={0} max={Number(b.remaining)} value={applyMap[b.id]} disabled={!checked} onChange={(v) => setApplyMap((m) => ({ ...m, [b.id]: v || 0 }))} />
        </div>
      ); })}
      <div className="nex-card mt-4 px-4 py-3 !rounded-xl">
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Payment Amount</span><span className="text-[18px] font-bold">{fmtMoney(amount)}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Total Applied</span><span className="text-[14px] font-semibold text-[#16a34a]">{fmtMoney(applied)}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Unapplied / Advance</span><span className="text-[14px] font-semibold text-[#8b5cf6]">{fmtMoney(Number(advance))}</span></div>
        <div className="flex items-center justify-between py-1 pt-2 border-t"><span className="text-[12px] text-[#64748b]">Add to Advance</span><InputNumber className="!w-32" prefix="$" min={0} value={advance} onChange={(v) => setAdvance(v || 0)} /></div>
      </div>
    </Drawer>
  );
}
