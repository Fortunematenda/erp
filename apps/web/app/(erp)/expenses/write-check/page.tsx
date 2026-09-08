'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Drawer, Dropdown, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined, BankOutlined, CheckCircleOutlined, DeleteOutlined, EyeOutlined, FileTextOutlined, MoreOutlined, PayCircleOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AccountSelector } from '@/components/account-selector';
import { StatusTag } from '@/components/crud-page';
import { useMeta } from '@/lib/meta';
import { StatCard } from '@/components/stat-card';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { amountInWords } from '@/lib/amount-words';

export default function WriteCheckPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const meta = useMeta();
  const [tab, setTab] = useState('write');
  const banks = useQuery({ queryKey: ['/finance/bank-accounts'], queryFn: () => api('/finance/bank-accounts') });
  const checkList = useQuery({ queryKey: ['/finance/checks'], queryFn: () => api('/finance/checks') });
  const bankAccounts = banks.data || [];
  const suppliers = meta.data?.suppliers || [];
  const [bankId, setBankId] = useState(''); const [checkNo, setCheckNo] = useState(''); const [date, setDate] = useState<any>(dayjs());
  const [supplierId, setSupplierId] = useState(''); const [payeeOverride, setPayeeOverride] = useState(''); const [amount, setAmount] = useState<number | null>(null);
  const [amountWords, setAmountWords] = useState(''); const [payeeAddress, setPayeeAddress] = useState(''); const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<any[]>([{ key: 1, accountId: '', description: '', amount: 0 }]); const [saving, setSaving] = useState(false);
  const selectedBank = bankAccounts.find((b: any) => b.id === bankId);
  const supplier = suppliers.find((s: any) => s.id === supplierId);
  const payTo = payeeOverride || supplier?.name || '';
  useEffect(() => { if (supplier) setPayeeAddress([supplier.address1, supplier.address2, supplier.city, supplier.country].filter(Boolean).join(', ')); }, [supplierId]); // eslint-disable-line
  useEffect(() => { setAmountWords(amountInWords(amount || 0)); }, [amount]);
  useEffect(() => { if (!bankId) { setCheckNo(''); return; } api(`/finance/checks/next?bankAccountId=${bankId}`).then((d) => setCheckNo(d.next)).catch(() => {}); }, [bankId]); // eslint-disable-line
  const allocTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const used = lines.filter((l) => (Number(l.amount) || 0) > 0);
  const linesValid = !used.length || Math.abs(used.reduce((s, l) => s + Number(l.amount), 0) - Number(amount || 0)) < 0.01;
  function addLine() { setLines((p) => [...p, { key: p.length + 1, accountId: '', description: '', amount: 0 }]); }
  function updLine(k: number, p: any) { setLines((p) => p.map((l) => (l.key === k ? { ...l, ...p } : l))); }
  function remLine(k: number) { setLines((p) => p.filter((l) => l.key !== k)); }
  function reset() { setBankId(''); setCheckNo(''); setDate(dayjs()); setSupplierId(''); setPayeeOverride(''); setAmount(null); setAmountWords(''); setPayeeAddress(''); setMemo(''); setLines([{ key: 1, accountId: '', description: '', amount: 0 }]); }
  async function record(print: boolean) {
    if (!bankId) { message.error('Bank account is required.'); return; }
    if (!(Number(amount) > 0)) { message.error('Amount must be greater than zero.'); return; }
    if (!payTo.trim()) { message.error('Pay to is required.'); return; }
    if (!linesValid) { message.error('Split line totals must equal the check amount.'); return; }
    setSaving(true);
    try {
      const body = { bankAccountId: bankId, date: date.format('YYYY-MM-DD'), payTo: payTo.trim(), payeeOverride: payeeOverride || undefined, amount: Number(amount), amountInWords: amountWords, payeeAddress, memo, supplierId: supplierId || undefined, allocations: used.map((l) => ({ accountId: l.accountId, description: l.description, amount: Number(l.amount) })), recordStatus: 'RECORDED' };
      const check = await api('/finance/checks', { method: 'POST', body: JSON.stringify(body) });
      if (print) await api(`/finance/checks/${check.id}/print`, { method: 'POST', body: '{}' });
      message.success(print ? 'Check recorded & printed' : 'Check recorded');
      qc.invalidateQueries({ queryKey: ['/finance/checks'] }); reset(); setTab('history');
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  const write = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-4">
          <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Date *</label><DatePicker className="w-full" value={date} onChange={setDate} allowClear={false} /></div>
          <div className="md:col-span-2"><label className="block text-[12px] font-medium text-[#566069] mb-1">Bank Account *</label><Select showSearch optionFilterProp="label" className="w-full" value={bankId || undefined} onChange={setBankId} options={bankAccounts.map((b: any) => ({ label: `${b.name}${b.ledgerAccount?.code ? ` (${b.ledgerAccount.code})` : ''}`, value: b.id }))} placeholder="Select bank account" /></div>
          <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Check # *</label><Input value={checkNo} onChange={(e) => setCheckNo(e.target.value)} placeholder="Auto" /></div>
          <div className="md:col-span-2"><label className="block text-[12px] font-medium text-[#566069] mb-1">Pay To *</label><Select showSearch allowClear optionFilterProp="label" className="w-full" value={supplierId || undefined} onChange={setSupplierId} options={suppliers.map((s: any) => ({ label: s.name, value: s.id }))} placeholder="Supplier / vendor" /></div>
          <div className="md:col-span-3"><label className="block text-[12px] font-medium text-[#566069] mb-1">Payee Name (override)</label><Input value={payeeOverride} onChange={(e) => setPayeeOverride(e.target.value)} placeholder="Optional override" /></div>
          <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Amount ($) *</label><InputNumber className="w-full" prefix="$" min={0} value={amount} onChange={setAmount} placeholder="0.00" /></div>
          <div className="md:col-span-2"><label className="block text-[12px] font-medium text-[#566069] mb-1">In Words</label><Input value={amountWords} onChange={(e) => setAmountWords(e.target.value)} /></div>
          <div className="md:col-span-3"><label className="block text-[12px] font-medium text-[#566069] mb-1">Payee Address</label><Input.TextArea rows={2} value={payeeAddress} onChange={(e) => setPayeeAddress(e.target.value)} /></div>
          <div className="md:col-span-3"><label className="block text-[12px] font-medium text-[#566069] mb-1">Memo</label><Input.TextArea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} showCount maxLength={200} /></div>
        </div>
        <div className="mt-6"><div className="flex items-center gap-3 mb-2"><div className="h-px flex-1 bg-[#eef0f6]" /><span className="text-[12px] font-semibold text-[#64748b]">Split Lines (Expense Accounts)</span><div className="h-px flex-1 bg-[#eef0f6]" /></div>
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-1 md:grid-cols-[2.2fr_2fr_1fr_40px] gap-3 items-center py-2 border-t border-[#f0f1f6]">
              <div><AccountSelector allowedTypes={['EXPENSE', 'ASSET']} postingOnly value={l.accountId} onChange={(v) => updLine(l.key, { accountId: v })} placeholder="Account" /></div>
              <div><Input value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} placeholder="Description" /></div>
              <div><InputNumber className="w-full" prefix="$" min={0} value={l.amount} onChange={(v) => updLine(l.key, { amount: Number(v || 0) })} /></div>
              <Tooltip title="Remove line"><Button type="text" icon={<DeleteOutlined />} className="!text-[#a1a6c0] hover:!text-[#ef4444]" onClick={() => remLine(l.key)} disabled={lines.length === 1} /></Tooltip>
            </div>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine} className="mt-2">Add Line</Button>
          <div className={`text-[12px] mt-2 ${linesValid ? 'text-[#8a90ad]' : 'text-[#ef4444]'}`}>Allocated {fmtMoney(allocTotal)} of ${fmtMoney(Number(amount) || 0)}</div>
        </div>
        <div className="sticky bottom-0 mt-6 pt-4 border-t border-[#eef0f6] bg-white flex items-center justify-end gap-2">
          <Button onClick={() => reset()}>Clear</Button>
          <Button onClick={() => record(false)} disabled={saving}>Record Only</Button>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => record(true)} loading={saving}>Record & Print</Button>
        </div>
      </div>
      <PreviewPanel bankId={bankId} checkNo={checkNo} date={date} payTo={payTo} amount={amount} amountWords={amountWords} memo={memo} payeeAddress={payeeAddress} selectedBank={selectedBank} />
    </div>
  );
  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div><h1 className="text-[26px] font-bold text-[#171a2e]">Write a Check</h1><p className="text-[13px] text-[#64748b]">Write, record, and print checks</p></div>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.back()}>Back</Button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard icon={<FileTextOutlined />} label="Total checks" value={checkList.data?.length || 0} />
        <StatCard icon={<BankOutlined />} label="Bank accounts" value={bankAccounts.length} />
        <StatCard icon={<PayCircleOutlined />} label="Not printed" value={(checkList.data || []).filter((c: any) => !c.printed).length} />
        <StatCard icon={<FileTextOutlined />} label="Next check #" value={checkNo || 'Auto'} />
      </div>
      <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
        <Tabs items={[
          { key: 'write', label: 'Write Check', children: write },
          { key: 'history', label: 'Check History', children: <CheckHistory list={checkList} /> },
        ]} activeKey={tab} onChange={setTab} destroyOnHidden />
      </Card>
    </div>
  );
}

function PreviewPanel({ bankId, checkNo, date, payTo, amount, amountWords, memo, payeeAddress, selectedBank }: any) {
  const [scale, setScale] = useState(1);
  return (
    <div className="lg:sticky lg:top-4">
      <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-bold text-[#171a2e] flex items-center gap-2"><EyeOutlined /> Live Preview</span><Space size={2}><Button size="small" onClick={() => setScale((s) => Math.max(0.6, s - 0.1))}>-</Button><Button size="small" onClick={() => setScale((s) => Math.min(1.4, s + 0.1))}>+</Button></Space></div>
      <div className="rounded-xl border border-[#c7d0e0] bg-white py-8 px-8 shadow-sm">
        <div className="border border-[#94a3b8] rounded-md p-5" style={{ minHeight: 200 }}>
          <div className="flex items-start justify-between border-b-2 border-[#171a2e] pb-2 mb-3">
            <div><div className="text-[12px] text-[#64748b] uppercase tracking-wide">{selectedBank?.ledgerAccount?.code || ''}</div><div className="font-bold text-[17px] text-[#171a2e]">{selectedBank?.name || 'Your Bank'}</div></div>
            <div className="text-right"><div className="text-[12px] text-[#64748b]">Date</div><div className="font-semibold text-[14px]">{date?.format('MM/DD/YYYY') || '—'}</div></div>
          </div>
          <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-3"><span className="text-[13px] text-[#64748b]">Pay to the order of</span><span className="font-semibold text-[15px] text-[#171a2e] border-b border-[#171a2e] px-2 pb-0.5">{payTo || '________________'}</span></div><span className="font-bold text-[15px] text-[#171a2e]">$ {fmtMoney(Number(amount) || 0)}</span></div>
          <div className="font-medium text-[13px] text-[#171a2e] mb-5 italic">{amountWords || '***'}</div>
          <div className="flex items-end justify-between gap-4">
            <div className="text-[12px] text-[#64748b] max-w-[45%] whitespace-pre-wrap">Memo: {memo || '—'}{payeeAddress ? `\n${payeeAddress}` : ''}</div>
            <div className="text-right"><div className="border-t-2 border-[#171a2e] w-40 mb-0.5" /><div className="text-[11px] text-[#64748b]">Authorized Signature</div></div>
          </div>
        </div>
        <div className="flex justify-end mt-3"><div className="text-right"><div className="text-[11px] text-[#64748b]">Check #</div><div className="font-mono font-bold text-[14px]">{checkNo || '—'}</div></div></div>
      </div>
      <Button type="primary" ghost className="mt-4" icon={<PrinterOutlined />} disabled={!checkNo} onClick={() => window.print()}>Print Preview</Button>
    </div>
  );
}

function CheckHistory({ list }: { list: any }) {
  const [q, setQ] = useState(''); const [bankId, setBankId] = useState(''); const [view, setView] = useState<any>(null);
  const rows = (list.data || []).filter((r: any) => (!q || `${r.checkNo} ${r.payTo} ${r.memo || ''}`.toLowerCase().includes(q.toLowerCase())) && (!bankId || r.bankAccountId === bankId));
  const cols: ColumnsType<any> = [
    { title: 'Check #', dataIndex: 'checkNo', width: 110, render: (v: any, r: any) => <a className="text-[#2563eb] cursor-pointer" onClick={() => setView(r)}>{v}</a> },
    { title: 'Date', dataIndex: 'date', width: 105, render: fmtDate }, { title: 'Payee', dataIndex: 'payTo' },
    { title: 'Bank Account', render: (_: any, r: any) => r.bankAccount?.name || '—' },
    { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Record', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Printed', width: 110, render: (_: any, r: any) => r.printed ? <span className="text-[#16a34a]">Print {r.printCount > 1 ? `(x${r.printCount})` : ''}</span> : <span className="text-[#8a90ad]">Not printed</span> },
    { title: 'Cleared', dataIndex: 'clearedStatus', width: 110, render: (v: any) => <StatusTag value={v} /> },
    { ...ACTIONS_COL, render: (_: any, r: any) => <CheckRowActions r={r} onView={() => setView(r)} onPrinted={() => list.refetch()} /> },
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search check # / payee / memo…" className="!w-72 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="Bank account" className="!min-w-[170px]" value={bankId || undefined} onChange={setBankId} options={Array.from(new Map<string, { label: string; value: string }>((list.data || []).map((c: any) => [c.bankAccountId, { label: c.bankAccount?.name || '—', value: c.bankAccountId }])).values())} />
        <Button icon={<ReloadOutlined />} onClick={() => list.refetch()} />
      </div>
      <Table rowKey="id" dataSource={rows} columns={cols} pagination={{ pageSize: 12, showTotal: (t) => `${t} checks` }} />
      {view && <CheckDetailDrawer check={view} onClose={() => setView(null)} refetch={list.refetch} />}
    </div>
  );
}

function CheckRowActions({ r, onView, onPrinted }: { r: any; onView: () => void; onPrinted: () => void }) {
  function voidCheck() {
    let reason = '';
    Modal.confirm({
      title: 'Void check?',
      content: <Input placeholder="Reason *" onChange={(e) => (reason = e.target.value)} />,
      onOk: () => {
        if (!reason) { message.error('Reason required'); return Promise.reject(); }
        return api(`/finance/checks/${r.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }).then(() => { message.success('Check voided'); onPrinted(); });
      },
    });
  }
  return (
    <RowActionsMenu items={[
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: onView },
      { key: 'print', label: r.printed ? 'Reprint' : 'Print', icon: <PrinterOutlined />, onClick: () => { api(`/finance/checks/${r.id}/print`, { method: 'POST', body: '{}' }).then(() => { message.success(r.printed ? 'Check reprinted' : 'Check printed'); onPrinted(); }).catch((e) => message.error(e.message)); } },
      { key: 'open', label: 'Open Linked Payment', icon: <PayCircleOutlined />, onClick: () => window.open('/procurement', '_blank') },
      { key: 'void', label: 'Void Check', icon: <DeleteOutlined />, danger: true, onClick: voidCheck },
    ]} />
  );
}

function CheckDetailDrawer({ check, onClose, refetch }: { check: any; onClose: () => void; refetch: () => void }) {
  const cols: ColumnsType<any> = [
    { title: 'Account', render: (_: any, r: any) => r.account?.code || '—' }, { title: 'Description', dataIndex: 'description' }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) },
  ];
  return (
    <Drawer open onClose={onClose} width={620} title={`Check ${check.checkNo}`} extra={<Space><Button icon={<PrinterOutlined />} onClick={() => { api(`/finance/checks/${check.id}/print`, { method: 'POST', body: '{}' }).then(() => { message.success('Printed'); refetch(); }).catch((e) => message.error(e.message)); }}>{check.printed ? 'Reprint' : 'Print'}</Button><Button onClick={onClose}>Close</Button></Space>}>
      <table className="w-full text-[13px] mb-4"><tbody>
        {[['Check #', check.checkNo], ['Date', fmtDate(check.date)], ['Bank Account', check.bankAccount?.name], ['Payee', check.payTo], ['Amount', fmtMoney(check.amount)], ['In Words', check.amountInWords], ['Memo', check.memo || '—'], ['Record Status', check.status], ['Print Status', check.printed ? `Printed (${check.printCount}x)` : 'Not printed'], ['Printed At', check.lastPrintedAt ? fmtDate(check.lastPrintedAt) : '—'], ['Cleared', check.clearedStatus]].map(([k, v]) => <tr key={k as string} className="border-t border-[#eef0f6]"><td className="py-1.5 pr-4 text-[#64748b] w-36">{k}</td><td className="py-1.5 text-[#171a2e]">{String(v ?? '—')}</td></tr>)}
      </tbody></table>
      <div className="text-[13px] font-bold text-[#171a2e] mb-2">Split Lines</div>
      <Table rowKey="id" size="small" dataSource={check.allocations || []} columns={cols} pagination={false} />
    </Drawer>
  );
}
