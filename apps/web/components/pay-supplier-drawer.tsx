'use client';
import { useEffect, useState } from 'react';
import { Button, Checkbox, DatePicker, Drawer, Form, Input, InputNumber, Select, Space, message } from 'antd';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AccountSelector } from '@/components/account-selector';
import { fmtDate, fmtMoney } from '@/lib/format';

const METHODS = ['BANK', 'CHEQUE', 'CASH', 'CARD', 'MOBILE', 'OTHER'];

// Canonical Pay Supplier drawer — creates one supplier-scoped payment per supplier,
// each with its own bill allocations. Reused by Bill Management, Pay Bills, Supplier 360, etc.
export function PaySupplierDrawer({ open, onClose, onSaved, bills, initialIds, supplierName }: { open: boolean; onClose: () => void; onSaved: () => void; bills: any[]; initialIds: string[]; supplierName?: string }) {
  const [method, setMethod] = useState('BANK'); const [payFrom, setPayFrom] = useState<string>(); const [date, setDate] = useState<any>(dayjs()); const [reference, setReference] = useState(''); const [memo, setMemo] = useState('');
  const [applyMap, setApplyMap] = useState<Record<string, number>>({}); const [advance, setAdvance] = useState(0); const [saving, setSaving] = useState(false);
  const outstanding = bills.filter((b: any) => b.documentStatus === 'POSTED' && Number(b.remaining) > 0);
  const applied = Object.values(applyMap).reduce((s, v) => s + Number(v || 0), 0);
  const amount = Number(applied) + Number(advance || 0);
  const supplierIds = [...new Set(outstanding.filter((b: any) => (applyMap[b.id] || 0) > 0).map((b: any) => b.supplierId))];
  const label = supplierName || (supplierIds.length === 1 ? outstanding.find((b: any) => b.supplierId === supplierIds[0])?.supplier?.name : supplierIds.length > 1 ? `Multiple suppliers (${supplierIds.length})` : '');
  useEffect(() => { if (!open) return; setDate(dayjs()); setMethod('BANK'); setPayFrom(undefined); setReference(''); setMemo(''); setAdvance(0); const m: Record<string, number> = {}; outstanding.forEach((b: any) => { if (initialIds.includes(b.id)) m[b.id] = Number(b.remaining); }); setApplyMap(m); }, [open]); // eslint-disable-line
  async function post() {
    const groups: Record<string, { supplierInvoiceId: string; amount: number }[]> = {};
    Object.entries(applyMap).forEach(([billId, v]) => { if (Number(v) > 0) { const b = outstanding.find((x: any) => x.id === billId); if (b) { (groups[b.supplierId] ||= []).push({ supplierInvoiceId: billId, amount: Number(v) }); } } });
    if (!Object.keys(groups).length) { message.error('Select bills to apply'); return; }
    setSaving(true);
    try {
      for (const sid of Object.keys(groups)) { const allocs = groups[sid]; await api('/procurement/supplier-payments', { method: 'POST', body: JSON.stringify({ supplierId: sid, amount: allocs.reduce((s, a) => s + a.amount, 0), method, referenceNo: reference, note: memo, payFromAccountId: payFrom, paidAt: date.format('YYYY-MM-DD'), allocations: allocs }) }); }
      message.success(Object.keys(groups).length > 1 ? `Payments posted for ${Object.keys(groups).length} suppliers` : 'Payment posted'); onSaved();
    } catch (e: any) { message.error('Bill balance has changed. ' + (e.message || '')); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={680} title="Pay Supplier" destroyOnHidden extra={<Button onClick={onClose}>Cancel</Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={post} loading={saving} disabled={!Object.keys(applyMap).filter((k) => applyMap[k] > 0).length}>Make Payment</Button></Space>}>
      {label && <div className="nex-card mb-4 px-4 py-3 !rounded-xl"><span className="text-[12px] text-[#64748b]">Supplier</span><span className="font-semibold text-[14px] text-[#171a2e] ml-2">{label}</span></div>}
      <Form layout="vertical">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Payment Date *" required><DatePicker className="w-full" value={date} onChange={setDate} allowClear={false} /></Form.Item>
          <Form.Item label="Payment Method *" required><AccountMethod value={method} onChange={setMethod} /></Form.Item>
        </div>
        <Form.Item label="Pay From *" required><AccountSelector allowedTypes={['BANK', 'CASH']} value={payFrom} onChange={setPayFrom} placeholder="Select bank / cash account" /></Form.Item>
        <Form.Item label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'CHEQUE' ? 'Check number' : 'Transaction reference'} /></Form.Item>
        <Form.Item label="Memo"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Form.Item>
      </Form>
      <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-bold">Outstanding Bills</span><Space><Button size="small" onClick={() => { const m: Record<string, number> = {}; outstanding.forEach((b) => (m[b.id] = Number(b.remaining))); setApplyMap(m); }}>Auto Apply</Button><Button size="small" onClick={() => setApplyMap({})}>Clear</Button></Space></div>
      {outstanding.length === 0 && <div className="text-[13px] text-[#8a90ad]">No outstanding bills</div>}
      {outstanding.map((b: any) => { const checked = (applyMap[b.id] || 0) > 0; return (
        <div key={b.id} className="rounded-xl border border-[#eef0f6] p-3 mb-2 flex items-center gap-3" style={{ background: checked ? '#f8f9ff' : '#fff' }}>
          <Checkbox checked={checked} onChange={(e) => setApplyMap((m) => { const n = { ...m }; if (e.target.checked) n[b.id] = Number(b.remaining); else delete n[b.id]; return n; })} />
          <div className="flex-1 min-w-0"><span className="font-medium text-[13px]">{b.invoiceNo}</span><span className="text-[11px] text-[#8a90ad] ml-2">{b.supplier?.name}{b.dueDate ? ` · due ${fmtDate(b.dueDate)}` : ''}</span></div>
          <span className="text-[12px] text-[#8a90ad]">Balance</span><span className="font-bold text-[13px] text-[#F97316] w-20 text-right">{fmtMoney(b.remaining)}</span>
          <InputNumber className="!w-24" prefix="$" min={0} max={Number(b.remaining)} value={applyMap[b.id]} disabled={!checked} onChange={(v) => setApplyMap((m) => ({ ...m, [b.id]: v || 0 }))} />
        </div>
      ); })}
      <div className="nex-card mt-4 px-4 py-3 !rounded-xl">
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Payment Amount</span><span className="text-[13px] font-semibold tabular-nums">{fmtMoney(amount)}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Total Applied</span><span className="text-[14px] font-semibold text-[#16a34a]">{fmtMoney(applied)}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-[12px] text-[#64748b]">Unapplied / Advance</span><span className="text-[14px] font-semibold text-[#8b5cf6]">{fmtMoney(Number(advance))}</span></div>
        <div className="flex items-center justify-between py-1 pt-2 border-t"><span className="text-[12px] text-[#64748b]">Add to Advance</span><InputNumber className="!w-32" prefix="$" min={0} value={advance} onChange={(v) => setAdvance(v || 0)} /></div>
      </div>
    </Drawer>
  );
}

function AccountMethod({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Select className="w-full" value={value} onChange={onChange} options={METHODS.map((m) => ({ label: m.replace(/_/g, ' '), value: m }))} />;
}
