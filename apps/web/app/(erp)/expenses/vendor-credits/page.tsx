'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, DatePicker, Drawer, Dropdown, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Upload, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BankOutlined, DeleteOutlined, DollarOutlined, EyeOutlined, FileDoneOutlined, FileTextOutlined, PayCircleOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UndoOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AccountSelector } from '@/components/account-selector';
import { StatusTag } from '@/components/crud-page';
import { useMeta } from '@/lib/meta';
import { StatCard } from '@/components/stat-card';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const REASONS = ['Returned Goods', 'Pricing Error', 'Overbilling', 'Damaged Goods', 'Quantity Shortage', 'Duplicate Billing', 'Discount / Rebate', 'Service Adjustment', 'Tax Correction', 'Other'];
const arr = (v: any) => (Array.isArray(v) ? v : []);
const DOC_TONE: Record<string, string> = { DRAFT: 'default', POSTED: 'green', VOID: 'red' };
const APP_TONE: Record<string, string> = { UNAPPLIED: 'orange', PARTIALLY_APPLIED: 'amber', FULLY_APPLIED: 'green', REFUNDED: 'purple' };

export default function VendorCreditsPage() {
  const qc = useQueryClient();
  const meta = useMeta();
  const [q, setQ] = useState(''); const [supplierId, setSupplierId] = useState(''); const [appStatus, setAppStatus] = useState(''); const [docStatus, setDocStatus] = useState(''); const [range, setRange] = useState<any>(undefined);
  const [newOpen, setNewOpen] = useState(false); const [applyTarget, setApplyTarget] = useState<any>(null); const [refundTarget, setRefundTarget] = useState<any>(null); const [detail, setDetail] = useState<any>(null); const [reports, setReports] = useState('');
  const list = useQuery({ queryKey: ['/finance/vendor-credits'], queryFn: () => api('/finance/vendor-credits') });
  const bills = useQuery({ queryKey: ['/procurement/supplier-invoices'], queryFn: () => api('/procurement/supplier-invoices') });
  const refunds = useQuery({ queryKey: ['/finance/vendor-credits/reports/refunds'], queryFn: () => api('/finance/vendor-credits/reports/refunds') });
  const rows = (list.data || []).filter((r: any) => (!q || `${r.vendorCreditNo} ${r.supplier?.name || ''} ${r.supplierCreditNo || ''} ${r.reference || ''} ${r.memo || ''}`.toLowerCase().includes(q.toLowerCase())) && (!supplierId || r.supplierId === supplierId) && (!appStatus || r.applicationStatus === appStatus) && (!docStatus || r.status === docStatus) && (!range || (dayjs(r.creditDate).isAfter(range[0], 'day') && dayjs(r.creditDate).isBefore(range[1], 'day'))));
  const billNo = useMemo(() => new Map(arr(bills.data).map((b: any) => [b.id, b.invoiceNo])), [bills.data]);
  function refresh() { qc.invalidateQueries({ queryKey: ['/finance/vendor-credits'] }); qc.invalidateQueries({ queryKey: ['/finance/vendor-credits/reports/refunds'] }); }
  function clear() { setQ(''); setSupplierId(''); setAppStatus(''); setDocStatus(''); setRange(undefined); }

  const total = arr(list.data).filter((r: any) => r.status === 'POSTED').reduce((s: number, r: any) => s + Number(r.total), 0);
  const available = arr(list.data).reduce((s: number, r: any) => s + Number(r.available || 0), 0);
  const refundedThisMonth = arr(refunds.data).filter((r: any) => dayjs(r.date).isSame(dayjs(), 'month')).reduce((s: number, r: any) => s + Number(r.amount), 0);

  const cols: ColumnsType<any> = [
    { title: 'Credit #', dataIndex: 'vendorCreditNo', width: 110, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => setDetail(r)}>{v}</a> },
    { title: 'Supplier', render: (_: any, r: any) => r.supplier?.name || '—' },
    { title: 'Supplier Credit #', dataIndex: 'supplierCreditNo', width: 130, render: (v: any) => v || '—' },
    { title: 'Date', dataIndex: 'creditDate', width: 100, render: fmtDate },
    { title: 'Source', width: 100, render: (_: any, r: any) => r.sourceInvoiceId ? billNo.get(r.sourceInvoiceId) || `#${String(r.sourceInvoiceId).slice(0, 6)}` : '—' },
    { title: 'Total', dataIndex: 'total', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Applied', dataIndex: 'appliedAmount', align: 'right', render: (v: any) => <span className="text-[#16a34a]">{fmtMoney(v)}</span> },
    { title: 'Available', dataIndex: 'available', align: 'right', render: (v: any) => <span className={`font-semibold ${Number(v) > 0 ? 'text-[#f59e0b]' : 'text-[#8a90ad]'}`}>{fmtMoney(v)}</span> },
    { title: 'Application', dataIndex: 'applicationStatus', width: 140, render: (v: any) => <StatusTag value={v} colorMap={APP_TONE} /> },
    { title: 'Document', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} colorMap={DOC_TONE} /> },
    { ...ACTIONS_COL, render: (_: any, r: any) => <RowActions credit={r} onApply={() => setApplyTarget(r)} onRefund={() => setRefundTarget(r)} onView={() => setDetail(r)} onRefresh={refresh} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div><h1 className="text-[26px] font-bold text-[#171a2e]">Vendor Credits</h1><p className="text-[13px] text-[#64748b]">Record supplier credits, apply them to bills and track available credit</p></div>
        <Space><Dropdown menu={{ items: ['available', 'by-reason', 'by-supplier', 'refunds'].map((k) => ({ key: k, label: k.replace(/-/g, ' ').replace(/^by /, 'By ').replace(/^available$/, 'Available Credits').replace(/^refunds$/, 'Supplier Refunds') })), onClick: ({ key }) => setReports(key) }} trigger={['click']}><Button icon={<FileTextOutlined />}>Reports ▾</Button></Dropdown><Button icon={<ReloadOutlined />} onClick={refresh} /><Button type="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>+ New Vendor Credit</Button></Space>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard icon={<FileTextOutlined />} label="Total Vendor Credits" value={fmtMoney(total)} color="#2563eb" />
        <StatCard icon={<DollarOutlined />} label="Available Credit" value={fmtMoney(available)} color="#f59e0b" />
        <StatCard icon={<PayCircleOutlined />} label="Applied This Month" value={fmtMoney(arr(list.data).reduce((s: number, r: any) => s + Number(r.appliedAmount || 0), 0))} color="#16a34a" />
        <StatCard icon={<BankOutlined />} label="Supplier Refunds" value={fmtMoney(refundedThisMonth)} color="#8b5cf6" />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search credit / supplier / reference…" className="!w-72 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Supplier" className="!min-w-[160px]" value={supplierId || undefined} onChange={setSupplierId} options={(meta.data?.suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))} />
        <Select allowClear placeholder="Application Status" className="!min-w-[160px]" value={appStatus || undefined} onChange={setAppStatus} options={['UNAPPLIED', 'PARTIALLY_APPLIED', 'FULLY_APPLIED', 'REFUNDED'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Select allowClear placeholder="Document Status" className="!min-w-[140px]" value={docStatus || undefined} onChange={setDocStatus} options={['DRAFT', 'POSTED', 'VOID'].map((s) => ({ label: s, value: s }))} />
        <DatePicker.RangePicker className="!rounded-xl" value={range} onChange={setRange} />
        <Button onClick={clear}>Clear</Button>
      </div>

      {arr(list.data).length === 0 ? (
        <div className="nex-card !rounded-xl p-12 text-center"><FileTextOutlined className="text-4xl text-[#c7ccdd] mb-3" /><div className="text-[17px] font-bold text-[#171a2e]">No vendor credits yet</div><p className="text-[13px] text-[#64748b] mt-1 mb-4 max-w-md mx-auto">Record a supplier credit when a vendor issues a credit memo, return or billing adjustment.</p><Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>+ New Vendor Credit</Button></div>
      ) : (
        <Table rowKey="id" dataSource={rows} columns={cols} pagination={{ pageSize: 15, showTotal: (t) => `${t} credits` }} scroll={{ x: true }} />
      )}

      {newOpen && <NewCreditDrawer open onClose={() => setNewOpen(false)} onSaved={refresh} />}
      {applyTarget && <ApplyDrawer credit={applyTarget} onClose={() => setApplyTarget(null)} onSaved={refresh} />}
      {refundTarget && <RefundDrawer credit={refundTarget} onClose={() => setRefundTarget(null)} onSaved={refresh} />}
      {detail && <CreditDetailDrawer credit={detail} onClose={() => setDetail(null)} />}
      {reports && <ReportsModal kind={reports} onClose={() => setReports('')} />}
    </div>
  );
}

function RowActions({ credit, onApply, onRefund, onView, onRefresh }: any) {
  const appLabel = credit.applicationStatus === 'FULLY_APPLIED' ? 'Apply Credit' : credit.applicationStatus === 'PARTIALLY_APPLIED' ? 'Apply Remaining' : 'Apply Credit';
  const canPost = credit.status === 'DRAFT';
  const canApply = Number(credit.available || 0) > 0.005 && credit.status === 'POSTED';
  function voidCredit() {
    let reason = '';
    Modal.confirm({
      title: 'Void credit?',
      content: <Input placeholder="Reason *" onChange={(e) => (reason = e.target.value)} />,
      onOk: () => { if (!reason) { message.error('Reason required'); return Promise.reject(); } return api(`/finance/vendor-credits/${credit.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }).then(() => { message.success('Voided'); onRefresh(); }); },
    });
  }
  return (
    <RowActionsMenu items={[
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: onView },
      { key: 'post', label: 'Post', icon: <FileDoneOutlined />, hidden: !canPost, onClick: () => { api(`/finance/vendor-credits/${credit.id}/post`, { method: 'POST' }).then(() => { message.success('Posted'); onRefresh(); }).catch((e) => message.error(e.message)); } },
      { key: 'apply', label: appLabel, icon: <PayCircleOutlined />, hidden: !canApply, onClick: onApply },
      { key: 'refund', label: 'Record Supplier Refund', icon: <DollarOutlined />, onClick: onRefund },
      { key: 'void', label: 'Void Credit', icon: <UndoOutlined />, danger: true, onClick: voidCredit },
    ]} />
  );
}

function NewCreditDrawer({ open, onClose, onSaved }: any) {
  const meta = useMeta();
  const bills = useQuery({ queryKey: ['/procurement/supplier-invoices'], queryFn: () => api('/procurement/supplier-invoices') });
  const [supplierId, setSupplierId] = useState(''); const [creditNo, setCreditNo] = useState(''); const [date, setDate] = useState<any>(dayjs()); const [currency, setCurrency] = useState('USD'); const [reason, setReason] = useState(''); const [sourceInvoiceId, setSourceInvoiceId] = useState(''); const [reference, setReference] = useState(''); const [memo, setMemo] = useState(''); const [attachment, setAttachment] = useState<any>(null); const [lines, setLines] = useState<any[]>([{ key: 1, accountId: '', description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]); const [saving, setSaving] = useState(false);
  const subtotal = lines.reduce((s: number, l: any) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const tax = lines.reduce((s: number, l: any) => s + (Number(l.quantity || 0) * Number(l.unitPrice || 0) * Number(l.taxRate || 0) / 100), 0);
  function addLine() { setLines((p) => [...p, { key: p.length + 1, accountId: '', description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]); }
  function updLine(k: number, p: any) { setLines((p) => p.map((l) => (l.key === k ? { ...l, ...p } : l))); }
  function remLine(k: number) { setLines((p) => p.filter((l) => l.key !== k)); }
  async function save(post: boolean) {
    if (!supplierId) { message.error('Supplier is required'); return; }
    if (!lines.some((l) => Number(l.unitPrice || 0) > 0)) { message.error('Add credit line amounts'); return; }
    setSaving(true);
    try { const body = { supplierId, supplierCreditNo: creditNo || undefined, creditDate: date.format('YYYY-MM-DD'), currency, reason, sourceInvoiceId: sourceInvoiceId || undefined, reference, memo, fileName: attachment?.name, mime: attachment?.mime, dataUrl: attachment?.dataUrl, status: post ? 'POSTED' : 'DRAFT', lines: lines.map((l) => ({ description: l.description, accountId: l.accountId, quantity: Number(l.quantity || 1), unitPrice: Number(l.unitPrice || 0), taxRate: Number(l.taxRate || 0) })) }; await api('/finance/vendor-credits', { method: 'POST', body: JSON.stringify(body) }); message.success(post ? 'Vendor credit posted' : 'Draft saved'); onClose(); onSaved(); } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} title="New Vendor Credit" width={680} extra={<Button onClick={onClose}>Cancel</Button>} footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button onClick={() => save(false)} disabled={saving}>Save Draft</Button><Button type="primary" onClick={() => save(true)} loading={saving}>Post Credit</Button></Space>}>
      <Form layout="vertical">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Supplier *" required><Select showSearch optionFilterProp="label" className="w-full" value={supplierId || undefined} onChange={setSupplierId} options={(meta.data?.suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))} /></Form.Item>
          <Form.Item label="Supplier Credit Memo #"><Input value={creditNo} onChange={(e) => setCreditNo(e.target.value)} placeholder="e.g. CM-12345" /></Form.Item>
          <Form.Item label="Credit Date *" required><DatePicker className="w-full" value={date} onChange={setDate} allowClear={false} /></Form.Item>
          <Form.Item label="Currency *" required><Select className="w-full" value={currency} onChange={setCurrency} options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item>
          <Form.Item label="Reason *" required><Select className="w-full" value={reason || undefined} onChange={setReason} options={REASONS.map((r) => ({ label: r, value: r }))} placeholder="Select reason" /></Form.Item>
          <Form.Item label="Source Bill"><Select allowClear showSearch optionFilterProp="label" className="w-full" value={sourceInvoiceId || undefined} onChange={setSourceInvoiceId} options={arr(bills.data).filter((b: any) => !supplierId || b.supplierId === supplierId).map((b: any) => ({ label: `${b.invoiceNo} — ${b.supplier?.name}`, value: b.id }))} /></Form.Item>
        </div>
        <Form.Item label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Form.Item>
        <div className="mb-1 text-[12px] font-medium text-[#566069]">Credit Lines (Account / Description / Qty / Rate / Tax)</div>
        {lines.map((l) => (
          <div key={l.key} className="grid grid-cols-[2fr_1.6fr_0.7fr_1fr_0.7fr_30px] gap-2 items-center py-1.5 border-t border-[#f0f1f6]">
            <div><AccountSelector allowedTypes={['EXPENSE', 'ASSET']} postingOnly value={l.accountId} onChange={(v) => updLine(l.key, { accountId: v })} placeholder="Account" /></div>
            <div><Input value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} placeholder="Description" /></div>
            <div><InputNumber className="w-full" min={1} value={l.quantity} onChange={(v) => updLine(l.key, { quantity: Number(v || 1) })} /></div>
            <div><InputNumber className="w-full" prefix="$" min={0} value={l.unitPrice} onChange={(v) => updLine(l.key, { unitPrice: Number(v || 0) })} /></div>
            <div><InputNumber className="w-full" min={0} value={l.taxRate} onChange={(v) => updLine(l.key, { taxRate: Number(v || 0) })} /></div>
            <Button type="text" icon={<DeleteOutlined />} className="!text-[#a1a6c0] hover:!text-[#ef4444]" onClick={() => remLine(l.key)} disabled={lines.length === 1} />
          </div>
        ))}
        <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine} className="mt-1">Add Line</Button>
        <div className="flex justify-between mt-2 text-[13px] font-semibold"><span>Total</span><span className="text-[#003366]">{fmtMoney(subtotal + tax)}</span></div>
        <div className="mt-4"><div className="text-[12px] font-medium text-[#566069] mb-1">Attachment (Supplier Credit Memo)</div>{attachment ? <div className="rounded-xl border p-2 flex items-center gap-3"><FileTextOutlined /><div className="flex-1 truncate">{attachment.name}</div><Button size="small" danger icon={<DeleteOutlined />} onClick={() => setAttachment(null)} /></div> : <Upload.Dragger beforeUpload={(file) => { const r = new FileReader(); r.onload = () => setAttachment({ name: file.name, mime: file.type, dataUrl: String(r.result) }); r.readAsDataURL(file); return false; }} showUploadList={false} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" className="!rounded-xl"><p className="text-[12px] text-[#64748b] mb-0"><UploadOutlined className="mr-1" />Drop supplier credit memo here</p></Upload.Dragger>}</div>
        <Form.Item label="Memo" className="mt-4"><Input.TextArea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function ApplyDrawer({ credit, onClose, onSaved }: any) {
  const bills = useQuery({ queryKey: ['/procurement/bills', 'apply'], queryFn: () => api('/procurement/bills?documentStatus=POSTED&pageSize=500') });
  const outstanding = arr(bills.data?.rows).filter((b: any) => b.supplierId === credit.supplierId && Number(b.remaining) > 0);
  const [applyMap, setApplyMap] = useState<Record<string, number>>({}); const [saving, setSaving] = useState(false);
  const applied = Object.values(applyMap).reduce((s: number, v: number) => s + Number(v || 0), 0);
  function autoApply() { const m: Record<string, number> = {}; let avail = Number(credit.available || 0); for (const b of [...outstanding].sort((a, b2) => new Date(a.dueDate || 0).getTime() - new Date(b2.dueDate || 0).getTime())) { if (avail <= 0) break; const amt = Math.min(avail, Number(b.remaining)); if (amt > 0) { m[b.id] = amt; avail -= amt; } } setApplyMap(m); }
  async function submit() {
    const allocs = Object.entries(applyMap).filter(([, v]) => Number(v) > 0).map(([billId, v]) => ({ supplierInvoiceId: billId, amount: Number(v) }));
    if (!allocs.length) { message.error('Select bills to apply'); return; }
    setSaving(true);
    try { await api(`/finance/vendor-credits/${credit.id}/apply`, { method: 'POST', body: JSON.stringify({ allocations: allocs }) }); message.success('Credit applied'); onClose(); onSaved(); } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} title="Apply Vendor Credit" width={680} extra={<Button onClick={onClose}>Cancel</Button>} footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit} loading={saving}>Apply Credit</Button></Space>}>
      <div className="nex-card !rounded-xl px-4 py-3 mb-4 flex items-center gap-6"><div><div className="text-[12px] text-[#64748b]">Credit {credit.vendorCreditNo} · {credit.supplier?.name}</div><div className="text-[18px] font-bold text-[#171a2e]">{fmtMoney(credit.total)}</div></div><div><div className="text-[12px] text-[#64748b]">Already Applied</div><div className="text-[15px] font-semibold text-[#16a34a]">{fmtMoney(credit.appliedAmount)}</div></div><div><div className="text-[12px] text-[#64748b]">Available</div><div className="text-[18px] font-bold text-[#f59e0b]">{fmtMoney(credit.available)}</div></div></div>
      <div className="flex items-center justify-between mb-2"><span className="text-[13px] font-bold">Outstanding Bills</span><Button size="small" onClick={autoApply}>Auto Apply</Button></div>
      {outstanding.length === 0 && <div className="text-[13px] text-[#8a90ad]">No outstanding bills for this supplier</div>}
      {outstanding.map((b: any) => { const checked = (applyMap[b.id] || 0) > 0; return (
        <div key={b.id} className="rounded-xl border border-[#eef0f6] p-3 mb-2 flex items-center gap-3">
          <Checkbox checked={checked} onChange={(e) => setApplyMap((m) => { const n = { ...m }; if (e.target.checked) n[b.id] = Number(b.remaining); else delete n[b.id]; return n; })} />
          <div className="flex-1 min-w-0"><span className="font-medium text-[13px]">{b.invoiceNo}</span>{b.dueDate ? <span className="text-[11px] text-[#8a90ad] ml-2">due {fmtDate(b.dueDate)}</span> : null}</div>
          <span className="text-[12px] text-[#8a90ad]">Outstanding</span><span className="font-bold text-[13px] text-[#F97316] w-20 text-right">{fmtMoney(b.remaining)}</span>
          <InputNumber className="!w-24" prefix="$" min={0} max={Number(b.remaining)} value={applyMap[b.id]} disabled={!checked} onChange={(v) => setApplyMap((m) => ({ ...m, [b.id]: Number(v || 0) }))} />
        </div>
      ); })}
      <div className="nex-card !rounded-xl mt-4 px-4 py-3"><div className="flex justify-between py-1"><span className="text-[12px] text-[#64748b]">Applied This Action</span><span className="text-[14px] font-semibold text-[#16a34a]">{fmtMoney(applied)}</span></div><div className="flex justify-between py-1"><span className="text-[12px] text-[#64748b]">Remaining Credit</span><span className="text-[14px] font-semibold text-[#f59e0b]">{fmtMoney(Math.max(0, Number(credit.available) - applied))}</span></div></div>
    </Drawer>
  );
}
function RefundDrawer({ credit, onClose, onSaved }: any) {
  const banks = useQuery({ queryKey: ['/finance/bank-accounts'], queryFn: () => api('/finance/bank-accounts') });
  const [bankId, setBankId] = useState(''); const [amount, setAmount] = useState<number>(Number(credit.available || 0)); const [date, setDate] = useState<any>(dayjs()); const [reference, setReference] = useState(''); const [memo, setMemo] = useState(''); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!bankId) { message.error('Deposit to account required'); return; } if (!(Number(amount) > 0)) { message.error('Amount required'); return; }
    setSaving(true);
    try { await api(`/finance/vendor-credits/${credit.id}/refund`, { method: 'POST', body: JSON.stringify({ bankAccountId: bankId, amount: Number(amount), date: date.format('YYYY-MM-DD'), reference, memo }) }); message.success('Supplier refund recorded'); onClose(); onSaved(); } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} title="Record Supplier Refund" width={520} extra={<Button onClick={onClose}>Cancel</Button>} footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit} loading={saving}>Record Refund</Button></Space>}>
      <div className="nex-card !rounded-xl px-4 py-3 mb-4"><span className="text-[12px] text-[#64748b]">{credit.vendorCreditNo} · Available</span><span className="text-[18px] font-bold text-[#f59e0b] ml-2">{fmtMoney(credit.available)}</span></div>
      <Form layout="vertical">
        <Form.Item label="Refund Date *" required><DatePicker className="w-full" value={date} onChange={setDate} allowClear={false} /></Form.Item>
        <Form.Item label="Deposit To *" required><Select className="w-full" value={bankId || undefined} onChange={setBankId} options={arr(banks.data).map((b: any) => ({ label: `${b.name} (${b.ledgerAccount?.code || ''})`, value: b.id }))} /></Form.Item>
        <Form.Item label="Amount *" required><InputNumber className="w-full" prefix="$" min={0} max={Number(credit.available)} value={amount} onChange={(v) => setAmount(Number(v || 0))} /></Form.Item>
        <Form.Item label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Form.Item>
        <Form.Item label="Memo"><Input.TextArea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function CreditDetailDrawer({ credit, onClose }: any) {
  const q = useQuery({ queryKey: ['/finance/vendor-credits', credit.id], queryFn: () => api(`/finance/vendor-credits/${credit.id}`) });
  if (q.isLoading) return <Drawer open onClose={onClose} title={`Vendor Credit ${credit.vendorCreditNo}`} width={640}><div className="p-4 text-[#8a90ad]">Loading…</div></Drawer>;
  const v = q.data || credit;
  const tabs = [
    { key: 'details', label: 'Credit Details', children: <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">{[['Supplier', v.supplier?.name], ['Credit #', v.vendorCreditNo], ['Supplier Credit #', v.supplierCreditNo || '—'], ['Date', fmtDate(v.creditDate)], ['Reason', v.reason || '—'], ['Reference', v.reference || '—'], ['Currency', v.currency], ['Memo', v.memo || '—'], ['Total', fmtMoney(v.total)], ['Applied', fmtMoney(v.appliedAmount)], ['Available', fmtMoney(v.available)], ['Document', v.status], ['Application', v.applicationStatus]].map(([k, val]) => <div key={String(k)} className="flex justify-between"><span className="text-[#64748b]">{k}</span><span className="text-[#171a2e]">{String(val ?? '—')}</span></div>)}</div> },
    { key: 'apps', label: 'Applications', children: <Table rowKey="id" size="small" dataSource={arr(v.applications)} pagination={false} columns={[{ title: 'Bill #', render: (_: any, r: any) => r.billNo }, { title: 'Date', dataIndex: 'createdAt', render: fmtDate }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (x: any) => fmtMoney(x) }, { title: 'Status', dataIndex: 'status', render: (x: any) => <StatusTag value={x} /> }]} /> },
    { key: 'attachments', label: 'Attachments', children: v.dataUrl ? <div className="flex items-center gap-3 rounded-xl border p-3"><FileTextOutlined /><div className="flex-1 truncate">{v.fileName}</div><Button size="small" onClick={() => window.open(v.dataUrl, '_blank')}>Preview</Button></div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No attachment" /> },
  ];
  return <Drawer open onClose={onClose} width={640} title={<span>Vendor Credit <b>{v.vendorCreditNo}</b></span>} extra={<Button onClick={onClose}>Close</Button>}><div className="mb-3 flex flex-wrap gap-6">{[{ l: 'Total Credit', v: fmtMoney(v.total), c: '#171a2e' }, { l: 'Applied', v: fmtMoney(v.appliedAmount), c: '#16a34a' }, { l: 'Available', v: fmtMoney(v.available), c: '#f59e0b' }].map((k) => <div key={k.l}><div className="text-[12px] text-[#64748b]">{k.l}</div><div className="text-[18px] font-bold" style={{ color: k.c }}>{k.v}</div></div>)}<div className="flex items-center gap-2 ml-auto"><StatusTag value={v.status} colorMap={DOC_TONE} /><StatusTag value={v.applicationStatus} colorMap={APP_TONE} /></div></div><Tabs items={tabs} /></Drawer>;
}

function ReportsModal({ kind, onClose }: any) {
  const q = useQuery({ queryKey: ['/finance/vendor-credits/reports', kind], queryFn: () => api(`/finance/vendor-credits/reports/${kind}`), enabled: !!kind });
  const rows = arr(q.data);
  const cols: ColumnsType<any> = kind === 'available' ? [{ title: 'Credit #', dataIndex: 'creditNo' }, { title: 'Supplier', dataIndex: 'supplier' }, { title: 'Date', dataIndex: 'date', render: fmtDate }, { title: 'Original', dataIndex: 'original', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Applied', dataIndex: 'applied', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Available', dataIndex: 'available', align: 'right', render: (v: any) => <b style={{ color: '#f59e0b' }}>{fmtMoney(v)}</b> }, { title: 'Age', dataIndex: 'age', align: 'right' }] : kind === 'refunds' ? [{ title: 'Date', dataIndex: 'date', render: fmtDate }, { title: 'Credit', render: (_: any, r: any) => r.vendorCredit?.vendorCreditNo }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Reference', dataIndex: 'reference' }] : [{ title: kind === 'by-reason' ? 'Reason' : 'Supplier', dataIndex: kind === 'by-reason' ? 'reason' : 'supplier' }, { title: 'Count', dataIndex: 'count', align: 'right' }, { title: 'Total', dataIndex: 'total', align: 'right', render: (v: any) => fmtMoney(v) }];
  return <Modal open onCancel={onClose} footer={null} width={760} title={`Report: ${kind.replace(/-/g, ' ')}`}><Table rowKey={(r: any) => String(r.creditNo || r.reason || r.supplier || r.id || 'r')} size="small" dataSource={rows} columns={cols} loading={q.isLoading} pagination={false} /></Modal>;
}
