'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AutoComplete, Button, Card, DatePicker, Drawer, Dropdown, Empty, Form, Image, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Upload, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BankOutlined, CreditCardOutlined, DeleteOutlined, DollarOutlined, EyeOutlined, FileTextOutlined, MoreOutlined, PayCircleOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AccountSelector } from '@/components/account-selector';
import { EmployeeSelector } from '@/components/employee-selector';
import { StatusTag } from '@/components/crud-page';
import { useMeta } from '@/lib/meta';
import { StatCard } from '@/components/stat-card';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const TX_TYPES = ['CHARGE', 'FEE', 'INTEREST', 'REFUND', 'CREDIT', 'ADJUSTMENT'];
const TX_LABEL: Record<string, string> = { CHARGE: 'Charge', FEE: 'Fee', INTEREST: 'Interest', REFUND: 'Refund', CREDIT: 'Credit', ADJUSTMENT: 'Adjustment', PAYMENT: 'Payment' };
const arr = (v: any) => (Array.isArray(v) ? v : []);
const PERF: Record<string, string> = { ACTIVE: 'green', INACTIVE: 'default', CLOSED: 'red' };

export default function CardChargesPage() {
  const qc = useQueryClient();
  const meta = useMeta();
  const [cardId, setCardId] = useState(''); const [range, setRange] = useState<any>(undefined); const [q, setQ] = useState(''); const [type, setType] = useState('');
  const [addCard, setAddCard] = useState(false); const [addCharge, setAddCharge] = useState(false); const [payCard, setPayCard] = useState(false); const [reports, setReports] = useState(''); const [stmt, setStmt] = useState<any>(null);
  const banks = useQuery({ queryKey: ['/finance/bank-accounts'], queryFn: () => api('/finance/bank-accounts') });
  const cards = useQuery({ queryKey: ['/finance/credit-cards'], queryFn: () => api('/finance/credit-cards') });
  const cardList = cards.data || [];

  const reg = useQuery({ queryKey: ['/finance/credit-cards/register', cardId], queryFn: () => {
    if (cardId) return api(`/finance/credit-cards/${cardId}/register`);
    // All Cards — combine each card's register (consolidate KPI + transactions).
    return Promise.all((cardList.length ? cardList : []).map((c: any) => api(`/finance/credit-cards/${c.id}/register`))).then((regs: any[]) => {
      const rows = regs.flatMap((r) => (r.rows || []).map((x: any) => ({ ...x, cardName: r.card?.name })));
      rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const cur = regs.reduce((s, r) => s + Number(r.currentBalance), 0);
      const cm = regs.reduce((s, r) => s + Number(r.chargesThisMonth), 0);
      const pm = regs.reduce((s, r) => s + Number(r.paymentsThisMonth), 0);
      return { card: null, rows, currentBalance: cur, chargesThisMonth: cm, paymentsThisMonth: pm, availableCredit: regs.reduce((s, r) => s + Number(r.availableCredit), 0) };
    });
  }, enabled: !!cardList.length });
  const regData = reg.data || { card: null, rows: [], currentBalance: 0, chargesThisMonth: 0, paymentsThisMonth: 0, availableCredit: 0 };
  const filtered = regData.rows.filter((r: any) => (!q || `${r.vendor || ''} ${r.description || ''} ${r.reference || ''}`.toLowerCase().includes(q.toLowerCase())) && (!type || r.type === type) && (!range || (dayjs(r.date).isAfter(range[0], 'day') && dayjs(r.date).isBefore(range[1], 'day'))));

  function refresh() { qc.invalidateQueries({ queryKey: ['/finance/credit-cards'] }); qc.invalidateQueries({ queryKey: ['/finance/credit-cards/register'] }); }
  const selectedCard = cardList.find((c: any) => c.id === cardId);

  const kpis = [
    { icon: <CreditCardOutlined />, label: 'Current Balance', value: fmtMoney(regData.currentBalance), color: '#2563eb', onClick: () => {} },
    { icon: <DollarOutlined />, label: 'Charges This Month', value: fmtMoney(regData.chargesThisMonth), color: '#f59e0b', onClick: () => setType('CHARGE') },
    { icon: <PayCircleOutlined />, label: 'Payments This Month', value: fmtMoney(regData.paymentsThisMonth), color: '#16a34a', onClick: () => setType('PAYMENT') },
    { icon: <BankOutlined />, label: 'Available Credit', value: fmtMoney(regData.availableCredit), color: '#8b5cf6', onClick: () => {} },
  ];

  const cols: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'date', width: 105, render: fmtDate },
    { title: 'Type', dataIndex: 'type', width: 100, render: (v: any) => <Tag color={({ CHARGE: 'blue', PAYMENT: 'green', REFUND: 'orange', FEE: 'amber', INTEREST: 'amber', CREDIT: 'orange', ADJUSTMENT: 'default' } as Record<string, string>)[String(v)] || 'default'}>{TX_LABEL[String(v)] || v}</Tag> },
    { title: 'Vendor / Payee', render: (_: any, r: any) => r.vendor || '—' },
    { title: 'Description', dataIndex: 'description', render: (v: any) => (v && v.length > 26 ? v.slice(0, 26) + '…' : v) || '—' },
    { title: 'Account', render: (_: any, r: any) => r.allocations?.[0]?.accountId ? 'Split' : '—' },
    { title: 'Project', dataIndex: 'projectId', render: (v: any) => (v ? '#' + String(v).slice(0, 6) : '—') },
    { title: 'Charge', dataIndex: 'charge', align: 'right', render: (v: any) => (Number(v) ? <span className="text-[#f97316]">{fmtMoney(v)}</span> : '—') },
    { title: 'Payment/Credit', dataIndex: 'credit', align: 'right', render: (v: any) => (Number(v) ? <span className="text-[#16a34a]">{fmtMoney(v)}</span> : '—') },
    { title: 'Balance', dataIndex: 'balance', align: 'right', render: (v: any) => <span className="font-semibold">{fmtMoney(v)}</span> },
    { title: 'Status', dataIndex: 'status', width: 100, render: (v: any) => <StatusTag value={v} colorMap={{ POSTED: 'green', DRAFT: 'default', VOID: 'red', REVERSED: 'red' }} /> },
    { title: 'Receipt', dataIndex: 'receiptStatus', width: 110, render: (v: any, r: any) => r.attachments ? <a className="text-[#2563eb] cursor-pointer" onClick={() => setStmt(r)}>{v.replace(/_/g, ' ')}</a> : <span className={v === 'MISSING' ? 'text-[#ef4444]' : 'text-[#8a90ad]'}>{v.replace(/_/g, ' ')}</span> },
    { title: '', width: 120, render: (_: any, r: any) => <RowActions tx={r} onView={() => setStmt(r)} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div><h1 className="text-[26px] font-bold text-[#171a2e]">Credit Card Charges</h1><p className="text-[13px] text-[#64748b]">Track card spending, balances and payments</p></div>
        <Space><Dropdown menu={{ items: ['spend-by-account', 'spend-by-vendor', 'spend-by-project', 'missing-receipts'].map((k) => ({ key: k, label: k.replace(/-/g, ' ').replace(/^spend/, 'Spend capital').replace(/spend/, 'Spend') })), onClick: ({ key }) => setReports(key) }} trigger={['click']}><Button icon={<FileTextOutlined />}>Reports ▾</Button></Dropdown><Button icon={<ReloadOutlined />} onClick={refresh} /><Button icon={<PayCircleOutlined />} onClick={() => setPayCard(true)}>Pay Card</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setAddCharge(true)}>+ Add Charge</Button></Space>
      </div>

      {cardList.length === 0 ? (
        <div className="nex-card !rounded-xl p-14 text-center">
          <CreditCardOutlined className="text-4xl text-[#c7ccdd] mb-3" />
          <div className="text-[17px] font-bold text-[#171a2e]">No credit cards yet</div>
          <p className="text-[13px] text-[#64748b] mt-1 mb-5 max-w-sm mx-auto">Add a corporate card to track charges, payments, receipts and reconciliation.</p>
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setAddCard(true)}>+ Add Credit Card</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Select showSearch optionFilterProp="label" className="!min-w-[220px]" value={cardId || 'all'} onChange={(v) => { setCardId(v === 'all' ? '' : v); }} options={[{ label: 'All Cards', value: 'all' }, ...cardList.map((c: any) => ({ label: `${c.name} ••••${c.last4 || ''} · ${c.currency}`, value: c.id }))]} />
            <DatePicker.RangePicker className="!rounded-xl" value={range} onChange={setRange} />
            <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search…" className="!w-56 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select allowClear placeholder="Type" className="!min-w-[130px]" value={type || undefined} onChange={setType} options={TX_TYPES.map((t) => ({ label: TX_LABEL[t], value: t }))} />
          </div>

          {selectedCard && (
            <div className="nex-card !rounded-xl px-4 py-3 mb-4 flex items-center gap-4"><CreditCardOutlined className="text-[#003366]" /><span className="font-semibold text-[#171a2e]">{selectedCard.name} ••••{selectedCard.last4}</span><Tag color={PERF[selectedCard.status] || 'default'}>{selectedCard.status}</Tag><span className="text-[12px] text-[#64748b]">Credit Limit {fmtMoney(selectedCard.creditLimit)}</span><span className="text-[12px] text-[#64748b]">Statement Balance {fmtMoney(regData.currentBalance)}</span></div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            {kpis.map((k) => <button key={k.label} className="text-left" onClick={k.onClick}><StatCard icon={k.icon} label={k.label} value={k.value} color={k.color} /></button>)}
          </div>

          <Card className="nex-card" styles={{ body: { padding: 0 } }}>
            <div className="flex items-center justify-between border-b border-[#eef0f6] px-5 py-3"><div className="text-[13px] font-bold text-[#171a2e]">Credit Card Register <span className="text-[#8a90ad] font-normal">{filtered.length} rows</span></div><Button onClick={() => setAddCard(true)}>Manage Cards</Button></div>
            <Table rowKey={(r: any) => `${r.kind}-${r.id}`} dataSource={filtered} columns={cols} pagination={{ pageSize: 15, showTotal: (t) => `${t} transactions` }} scroll={{ x: true }} />
          </Card>
        </>
      )}

      {addCard && <AddCardDrawer open onClose={() => setAddCard(false)} onSaved={refresh} />}
      {addCharge && <AddChargeDrawer open cardId={cardId} onClose={() => setAddCharge(false)} onSaved={refresh} />}
      {payCard && <PayCardDrawer open cardId={cardId} bankAccounts={banks.data || []} onClose={() => setPayCard(false)} onSaved={refresh} />}
      {reports && <ReportsModal kind={reports} onClose={() => setReports('')} />}
      {stmt && <TxDetail tx={stmt} onClose={() => setStmt(null)} />}
    </div>
  );
}

function RowActions({ tx, onView }: { tx: any; onView: () => void }) {
  function voidTx() {
    let reason = '';
    Modal.confirm({
      title: 'Void transaction?',
      content: <Input placeholder="Reason *" onChange={(e) => (reason = e.target.value)} />,
      onOk: () => {
        if (!reason) { message.error('Reason required'); return Promise.reject(); }
        return api(`/finance/credit-cards/${tx.cardAccountId}/transactions/${tx.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }).then(() => message.success('Voided'));
      },
    });
  }
  return (
    <RowActionsMenu items={[
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: onView },
      { key: 'void', label: 'Void', icon: <DeleteOutlined />, danger: true, onClick: voidTx },
    ]} />
  );
}

function AddCardDrawer({ open, onClose, onSaved }: any) {
  const meta = useMeta();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function submit() {
    const v = await form.validateFields().catch(() => null); if (!v) return;
    setSaving(true);
    try {
      await api('/finance/credit-cards', { method: 'POST', body: JSON.stringify({ ...v, last4: String(v.last4 || '').slice(-4), creditLimit: Number(v.creditLimit || 0), liabilityAccountId: v.ledgerAccountId || v.liabilityAccountId }) });
      message.success('Card created'); onClose(); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} title="Add Credit Card" width={640} extra={<Button onClick={onClose}>Cancel</Button>} footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit} loading={saving}>Save Card</Button></Space>}>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Card Name *" name="name" rules={[{ required: true }]}><Input placeholder="Corporate Visa" /></Form.Item>
          <Form.Item label="Issuer / Provider" name="issuer"><Input placeholder="CBZ Bank" /></Form.Item>
          <Form.Item label="Last 4 Digits *" name="last4" rules={[{ required: true }]}><Input maxLength={4} placeholder="3021" /></Form.Item>
          <Form.Item label="Card Type" name="cardType"><Select allowClear options={['VISA', 'MASTERCARD', 'AMEX', 'DEBIT', 'Fuel', 'Other'].map((t) => ({ label: t, value: t }))} /></Form.Item>
          <Form.Item label="Currency *" name="currency" initialValue="USD"><Select options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item>
          <Form.Item label="Status" name="status" initialValue="ACTIVE"><Select options={['ACTIVE', 'INACTIVE', 'CLOSED'].map((s) => ({ label: s, value: s }))} /></Form.Item>
        </div>
        <Form.Item label="Credit Card Liability Account *" name="ledgerAccountId" rules={[{ required: true }]}><AccountSelector allowedTypes={['LIABILITY']} postingOnly placeholder="Select liability account" /></Form.Item>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Credit Limit" name="creditLimit"><InputNumber prefix="$" className="w-full" /></Form.Item>
          <Form.Item label="Opening Balance" name="openingBalance"><InputNumber prefix="$" className="w-full" /></Form.Item>
          <Form.Item label="Statement Closing Day" name="statementDay"><InputNumber min={1} max={31} className="w-full" /></Form.Item>
          <Form.Item label="Payment Due Day" name="paymentDueDay"><InputNumber min={1} max={31} className="w-full" /></Form.Item>
          <Form.Item label="Cardholder" name="cardholderId"><EmployeeSelector placeholder="Assign cardholder" /></Form.Item>
          <Form.Item label="Default Expense Account" name="defaultExpenseAccountId"><AccountSelector allowedTypes={['EXPENSE', 'ASSET']} postingOnly placeholder="Optional" /></Form.Item>
        </div>
      </Form>
    </Drawer>
  );
}

function AddChargeDrawer({ open, cardId, onClose, onSaved }: any) {
  const meta = useMeta();
  const cards = useQuery({ queryKey: ['/finance/credit-cards'], queryFn: () => api('/finance/credit-cards') });
  const projects = useQuery({ queryKey: ['/projects'], queryFn: () => api('/projects') });
  const [cid, setCid] = useState(cardId || ''); const [date, setDate] = useState<any>(dayjs()); const [vendor, setVendor] = useState(''); const [supplierId, setSupplierId] = useState(''); const [supplierName, setSupplierName] = useState(''); const [desc, setDesc] = useState(''); const [amount, setAmount] = useState<number>(0); const [tax, setTax] = useState(0); const [reference, setReference] = useState(''); const [memo, setMemo] = useState(''); const [projectId, setProjectId] = useState(''); const [attachment, setAttachment] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([{ key: 1, accountId: '', description: '', amount: 0 }]); const [saving, setSaving] = useState(false);
  const subtotal = Math.max(0, Number(amount || 0) - Number(tax));
  const allocTotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const used = lines.filter((l) => Number(l.amount || 0) > 0);
  function addLine() { setLines((p) => [...p, { key: p.length + 1, accountId: '', description: '', amount: 0 }]); }
  function updLine(k: number, p: any) { setLines((p) => p.map((l) => (l.key === k ? { ...l, ...p } : l))); }
  function remLine(k: number) { setLines((p) => p.filter((l) => l.key !== k)); }
  async function submit() {
    if (!cid) { message.error('Select a credit card'); return; }
    if (!(Number(amount) > 0)) { message.error('Amount is required'); return; }
    if (used.length && Math.abs(used.reduce((s, l) => s + Number(l.amount), 0) - subtotal) > 0.01) { message.error('Split line totals must equal the charge amount (excl. tax)'); return; }
    setSaving(true);
    try {
      const body = { cardAccountId: cid, date: date.format('YYYY-MM-DD'), vendor: (supplierName || vendor).trim(), supplierId: supplierId || undefined, description: desc, amount: Number(amount), taxAmount: Number(tax), projectId: projectId || undefined, reference, memo, allocations: used.map((l) => ({ accountId: l.accountId, description: l.description, amount: Number(l.amount) })), fileName: attachment?.name, mime: attachment?.mime, dataUrl: attachment?.dataUrl, status: 'POSTED' };
      await api(`/finance/credit-cards/${cid}/transactions`, { method: 'POST', body: JSON.stringify(body) }); message.success('Charge recorded'); onClose(); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} title="Add Card Charge" width={640} extra={<Button onClick={onClose}>Cancel</Button>} footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit} loading={saving}>Record Charge</Button></Space>}>
      <Form layout="vertical">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Credit Card *" required><Select className="w-full" value={cid || undefined} onChange={setCid} options={(cards.data || []).map((c: any) => ({ label: `${c.name} ••••${c.last4 || ''}`, value: c.id }))} /></Form.Item>
          <Form.Item label="Transaction Date *" required><DatePicker className="w-full" value={date} onChange={setDate} allowClear={false} /></Form.Item>
          <Form.Item label="Vendor / Payee" name="vendor"><AutoComplete className="w-full" value={supplierName || undefined} placeholder="Merchant / supplier" options={(meta.data?.suppliers || []).map((s: any) => ({ value: s.name, label: s.name }))} onSelect={(name: string) => { const s = (meta.data?.suppliers || []).find((x: any) => x.name === name); if (s) { setSupplierName(s.name); setSupplierId(s.id); setVendor(s.name); } }} onChange={(v: string) => { setSupplierName(''); setSupplierId(''); setVendor(v); }} allowClear /></Form.Item>
          <Form.Item label="Project"><Select allowClear showSearch optionFilterProp="label" className="w-full" value={projectId || undefined} onChange={setProjectId} options={(projects.data || []).map((p: any) => ({ label: p.name, value: p.id }))} /></Form.Item>
          <Form.Item label="Amount *" required><InputNumber className="w-full" prefix="$" min={0} value={amount} onChange={(v) => setAmount(v == null ? 0 : Number(v))} /></Form.Item>
          <Form.Item label="Tax / Input VAT"><InputNumber className="w-full" prefix="$" min={0} value={tax} onChange={(v) => setTax(Number(v || 0))} /></Form.Item>
          <Form.Item label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Form.Item>
          <Form.Item label="Type" name="type" initialValue="CHARGE"><Select options={['CHARGE', 'FEE', 'INTEREST', 'ADJUSTMENT'].map((t) => ({ label: t, value: t }))} /></Form.Item>
        </div>
        <Form.Item label="Description *"><Input.TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></Form.Item>
        <div className="mb-2 text-[12px] font-medium text-[#566069]">Expense / Asset Allocation</div>
        {lines.map((l) => (
          <div key={l.key} className="grid grid-cols-[2.2fr_1.6fr_1fr_30px] gap-2 items-center py-1.5 border-t border-[#f0f1f6]">
            <div><AccountSelector allowedTypes={['EXPENSE', 'ASSET']} postingOnly value={l.accountId} onChange={(v) => updLine(l.key, { accountId: v })} placeholder="Account" /></div>
            <div><Input value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} placeholder="Description" /></div>
            <div><InputNumber className="w-full" prefix="$" min={0} value={l.amount} onChange={(v) => updLine(l.key, { amount: Number(v || 0) })} /></div>
            <Button type="text" icon={<DeleteOutlined />} className="!text-[#a1a6c0] hover:!text-[#ef4444]" onClick={() => remLine(l.key)} disabled={lines.length === 1} />
          </div>
        ))}
        <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine} className="mt-1">Add Line</Button>
        <div className={`text-[12px] mt-1 ${Math.abs(allocTotal - subtotal) < 0.01 || !used.length ? 'text-[#8a90ad]' : 'text-[#ef4444]'}`}>Allocated {fmtMoney(allocTotal)} / {fmtMoney(subtotal)}</div>
        <div className="mt-4"><div className="text-[12px] font-medium text-[#566069] mb-1">Attachment / Receipt</div>{attachment ? <div className="rounded-xl border p-2 flex items-center gap-3"><FileTextIcon /><div className="flex-1 truncate">{attachment.name}</div><Button size="small" danger icon={<DeleteOutlined />} onClick={() => setAttachment(null)} /></div> : <Upload.Dragger beforeUpload={(file) => { const r = new FileReader(); r.onload = () => setAttachment({ name: file.name, mime: file.type, dataUrl: String(r.result) }); r.readAsDataURL(file); return false; }} showUploadList={false} accept=".pdf,.jpg,.jpeg,.png" className="!rounded-xl"><p className="text-[12px] text-[#64748b] mb-0"><UploadOutlined className="mr-1" />Drop receipt here or click to browse</p></Upload.Dragger>}</div>
        <Form.Item label="Memo" className="mt-4"><Input.TextArea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function PayCardDrawer({ open, cardId, bankAccounts, onClose, onSaved }: any) {
  const cards = useQuery({ queryKey: ['/finance/credit-cards'], queryFn: () => api('/finance/credit-cards') });
  const [cid, setCid] = useState(cardId || ''); const [date, setDate] = useState<any>(dayjs()); const [bankId, setBankId] = useState(''); const [amount, setAmount] = useState<number>(0); const [reference, setReference] = useState(''); const [memo, setMemo] = useState(''); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!cid) { message.error('Select a credit card'); return; } if (!bankId) { message.error('Pay from bank account'); return; } if (!(Number(amount) > 0)) { message.error('Amount required'); return; }
    setSaving(true);
    try { await api(`/finance/credit-cards/${cid}/payments`, { method: 'POST', body: JSON.stringify({ date: date.format('YYYY-MM-DD'), bankAccountId: bankId, amount: Number(amount), reference, memo }) }); message.success('Card payment posted'); onClose(); onSaved(); } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} title="Pay Credit Card" width={520} extra={<Button onClick={onClose}>Cancel</Button>} footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit} loading={saving}>Post Payment</Button></Space>}>
      <Form layout="vertical">
        <Form.Item label="Credit Card *" required><Select className="w-full" value={cid || undefined} onChange={setCid} options={(cards.data || []).map((c: any) => ({ label: `${c.name} ••••${c.last4 || ''}`, value: c.id }))} /></Form.Item>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Payment Date *" required><DatePicker className="w-full" value={date} onChange={setDate} allowClear={false} /></Form.Item>
          <Form.Item label="Pay From Bank Account *" required><Select className="w-full" value={bankId || undefined} onChange={setBankId} options={bankAccounts.map((b: any) => ({ label: `${b.name} (${b.ledgerAccount?.code || ''})`, value: b.id }))} /></Form.Item>
        </div>
        <Form.Item label="Amount *" required><InputNumber className="w-full" prefix="$" min={0} value={amount} onChange={(v) => setAmount(v == null ? 0 : Number(v))} /></Form.Item>
        <Form.Item label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Form.Item>
        <Form.Item label="Memo"><Input.TextArea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function ReportsModal({ kind, onClose }: any) {
  const q = useQuery({ queryKey: ['/finance/credit-cards/reports', kind], queryFn: () => api(`/finance/credit-cards/reports/${kind}`), enabled: !!kind });
  const rows = arr(q.data);
  const cols: ColumnsType<any> = kind === 'missing-receipts' ? [
    { title: 'Date', dataIndex: 'date', render: fmtDate }, { title: 'Card', dataIndex: 'card' }, { title: 'Vendor', dataIndex: 'vendor' }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Days Outstanding', dataIndex: 'daysOutstanding', align: 'right' },
  ] : kind === 'spend-by-vendor' ? [
    { title: 'Vendor', dataIndex: 'vendor' }, { title: 'Transactions', dataIndex: 'count' }, { title: 'Charges', dataIndex: 'charges', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Credits', dataIndex: 'credits', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Net', dataIndex: 'net', align: 'right', render: (v: any) => <b>{fmtMoney(v)}</b> }, { title: 'Last Tx', dataIndex: 'lastTransaction', render: (v: any) => fmtDate(v) },
  ] : [
    { title: kind === 'spend-by-project' ? 'Project' : 'Account', dataIndex: kind === 'spend-by-project' ? 'projectId' : 'key' }, { title: 'Transactions', dataIndex: 'count' }, { title: 'Spend', dataIndex: kind === 'spend-by-project' ? 'spend' : 'total', align: 'right', render: (v: any) => <b>{fmtMoney(v)}</b> },
  ];
  return <Modal open onCancel={onClose} footer={null} width={720} title={`Report: ${kind.replace(/-/g, ' ')}`}><Table rowKey={(r: any) => String(r.key || r.vendor || r.projectId || r.id || 'r')} size="small" dataSource={rows} columns={cols} loading={q.isLoading} pagination={false} /></Modal>;
}

function TxDetail({ tx, onClose }: any) {
  return (
    <Drawer open onClose={onClose} width={560} title={`Transaction ${tx.reference || tx.id}`} extra={<Button onClick={onClose}>Close</Button>}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div className="text-[#64748b]">Date</div><div className="text-[#171a2e]">{fmtDate(tx.date)}</div>
        <div className="text-[#64748b]">Type</div><div className="text-[#171a2e]">{TX_LABEL[tx.type] || tx.type}</div>
        <div className="text-[#64748b]">Vendor</div><div className="text-[#171a2e]">{tx.vendor || '—'}</div>
        <div className="text-[#64748b]">Description</div><div className="text-[#171a2e]">{tx.description || '—'}</div>
        <div className="text-[#64748b]">Amount</div><div className="text-[#171a2e]">{fmtMoney(tx.charge || tx.credit)}</div>
        <div className="text-[#64748b]">Status</div><div><StatusTag value={tx.status} /></div>
        <div className="text-[#64748b]">Reconciliation</div><div className="text-[#171a2e]">{tx.cleared || '—'}</div>
        <div className="text-[#64748b]">Receipt</div><div className="text-[#171a2e]">{tx.receiptStatus || '—'}</div>
      </div>
      {tx?.allocations?.length ? (<div className="mt-4"><div className="text-[13px] font-bold mb-1">Allocation</div><Table size="small" rowKey="id" dataSource={tx.allocations} pagination={false} columns={[{ title: 'Account', render: (_: any, r: any) => r.accountId ? '#' + String(r.accountId).slice(0, 6) : '—' }, { title: 'Description', dataIndex: 'description' }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) }]} /></div>) : null}
    </Drawer>
  );
}
function FileTextIcon() { return <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#0033660f] text-[#003366]"><FileTextOutlined /></span>; }

