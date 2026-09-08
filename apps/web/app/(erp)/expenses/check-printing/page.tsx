'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BankOutlined, DeleteOutlined, EyeOutlined, PaperClipOutlined, PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { fmtMoney } from '@/lib/format';
import { FinanceSummaryCard } from '@/components/finance-ui';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + words(n % 100) : ''}`;
  return String(n);
}
function amountInWords(v: number): string {
  const whole = Math.floor(Math.abs(v));
  const cents = Math.round((Math.abs(v) - whole) * 100);
  if (!whole && !cents) return 'Zero and 00/100 Dollars';
  return `${words(whole)} and ${String(cents).padStart(2, '0')}/100 Dollars`;
}

type Split = { key: number; accountId?: string; description: string; amount: number };

export default function CheckPrintingPage() {
  const qc = useQueryClient();
  const { companies } = useAuth();
  const [form] = Form.useForm();
  const accounts = useQuery({ queryKey: ['/finance/accounts'], queryFn: () => api('/finance/accounts') });
  const journals = useQuery({ queryKey: ['/finance/journals'], queryFn: () => api('/finance/journals') });
  const bills = useQuery({ queryKey: ['/procurement/supplier-invoices'], queryFn: () => api('/procurement/supplier-invoices') });
  const checksQ = useQuery({ queryKey: ['/finance/checks'], queryFn: () => api('/finance/checks') });
  const bankAccountsQ = useQuery({ queryKey: ['/finance/bank-accounts'], queryFn: () => api('/finance/bank-accounts') });
  const suppliers = useQuery({ queryKey: ['/procurement/suppliers'], queryFn: () => api('/procurement/suppliers') });
  const [splits, setSplits] = useState<Split[]>([]);
  const [memo, setMemo] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  const bankAccounts = bankAccountsQ.data || [];
  const expenseAccounts = (accounts.data || []).filter((a: any) => a.type === 'EXPENSE');
  const bankId = Form.useWatch('bankAccountId', form);
  const amount = Number(Form.useWatch('amount', form) || 0);
  const checkNo = Form.useWatch('checkNo', form);
  const date = Form.useWatch('date', form);
  const vendorId = Form.useWatch('vendorId', form);
  const openBills = useMemo(() => (bills.data || []).filter((i: any) => Math.max(0, Number(i.total) - (i.payments || []).reduce((x: number, p: any) => x + Number(p.amount), 0)) > 0.01), [bills.data]);

  const checks = checksQ.data || [];
  const totalChecks = checks.length;
  const thisMonth = checks.filter((p: any) => dayjs(p.date).isSame(dayjs(), 'month')).reduce((s: number, p: any) => s + Number(p.amount), 0);

  const bankBalance = useMemo(() => {
    let bal = 0;
    (journals.data || []).forEach((j: any) => (j.lines || []).forEach((l: any) => { if (l.accountId === bankId) bal += Number(l.debit || 0) - Number(l.credit || 0); }));
    return bal;
  }, [journals.data, bankId]);

  useEffect(() => {
    if (!form.getFieldValue('checkNo')) form.setFieldsValue({ checkNo: String(totalChecks + 1), date: dayjs() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalChecks]);

  const inWords = amountInWords(amount);
  const splitsTotal = splits.reduce((s, x) => s + Number(x.amount || 0), 0);

  function addSplit() { setSplits((p) => [...p, { key: p.length + 1, description: '', amount: 0 }]); }
  function updSplit(k: number, patch: Partial<Split>) { setSplits((p) => p.map((x) => (x.key === k ? { ...x, ...patch } : x))); }
  function rmSplit(k: number) { setSplits((p) => p.filter((x) => x.key !== k)); }

  async function record() {
    try {
      const v = await form.validateFields();
      if (splits.length && Math.abs(splitsTotal - Number(v.amount)) > 0.01) { message.error('Split lines must total the check amount'); return; }
      const allocations: any[] = splits.filter((x: any) => Number(x.amount) > 0).map((x: any) => ({ accountId: x.accountId, description: x.description, amount: Number(x.amount) }));
      if (!allocations.length && v.billId) allocations.push({ supplierInvoiceId: v.billId, description: 'Supplier bill', amount: Number(v.amount) });
      await api('/finance/checks', { method: 'POST', body: JSON.stringify({ bankAccountId: v.bankAccountId, date: v.date?.format('YYYY-MM-DD'), payTo: v.vendorId ? suppliers.data?.find((s: any) => s.id === v.vendorId)?.name : (v.payeeOverride || 'Manual payee'), amount: Number(v.amount), amountInWords: inWords, memo, allocations }) });
      message.success('Check recorded');
      qc.invalidateQueries({ queryKey: ['/finance/checks'] });
      form.resetFields();
      setMemo('');
      setSplits([]);
    } catch (e: any) { message.error(e.message || 'Could not record check'); }
  }

  const companyName = companies[0]?.name || 'NexusERP';
  const bankName = (accounts.data || []).find((a: any) => a.id === bankId)?.name || 'Your Bank';

  const splitCols: ColumnsType<any> = [
    { title: 'Account', render: (_v, r) => <Select className="w-full" showSearch optionFilterProp="label" placeholder="Account" options={expenseAccounts.map((a: any) => ({ label: `${a.code} ${a.name}`, value: a.id }))} value={r.accountId} onChange={(v) => updSplit(r.key, { accountId: v })} /> },
    { title: 'Description', render: (_v, r) => <Input value={r.description} onChange={(e) => updSplit(r.key, { description: e.target.value })} placeholder="Description" /> },
    { title: 'Amount', width: 140, align: 'right', render: (_v, r) => <InputNumber className="w-full" prefix="$" min={0} value={r.amount} onChange={(v) => updSplit(r.key, { amount: Number(v || 0) })} /> },
    { title: '', width: 40, render: (_v, r) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => rmSplit(r.key)} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-lg flex items-center justify-center text-white bg-[#003366] text-lg"><PrinterOutlined /></span><div><h1 className="text-[24px] font-bold text-[#171a2e] leading-tight">Check Printing</h1><p className="text-[13px] text-[#64748b] mt-0.5">Write, record, and print checks · {totalChecks} checks on file</p></div></div>
        <Button icon={<PrinterOutlined />}>Print</Button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <FinanceSummaryCard label="Total Checks" value={String(totalChecks)} valueColor="#2563eb" />
        <FinanceSummaryCard label="Bank Balance" value={bankId ? fmtMoney(bankBalance) : '–'} valueColor="#16A34A" subtitle={bankId ? '' : 'Select a bank account'} />
        <FinanceSummaryCard label="This Month" value={fmtMoney(thisMonth)} valueColor="#7c3aed" />
        <FinanceSummaryCard label="Next Check #" value={`#${totalChecks + 1}`} valueColor="#f97316" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
        <div className="nex-card p-6">
          <div className="flex items-center gap-2 mb-4"><span className="text-[#003366]"><BankOutlined /></span><span className="text-[16px] font-semibold text-[#171a2e]">Write a Check</span></div>
          <Form form={form} layout="vertical">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
              <Form.Item label="Date" name="date" className="!mb-3" rules={[{ required: true, message: 'Date required' }]}><DatePicker className="w-full" /></Form.Item>
              <Form.Item label="Bank Account" name="bankAccountId" className="!mb-3 md:!col-span-2" rules={[{ required: true, message: 'Select bank' }]}><Select showSearch optionFilterProp="label" placeholder="Select bank account" options={bankAccounts.map((a: any) => ({ label: a.name, value: a.id }))} /></Form.Item>
              <Form.Item label="Check #" name="checkNo" className="!mb-3" rules={[{ required: true, message: 'Check # required' }]}><Input /></Form.Item>
              <Form.Item label="Pay To" name="vendorId" className="!mb-3 md:!col-span-2"><Select showSearch optionFilterProp="label" allowClear placeholder="Select vendor" options={suppliers.data?.map((s: any) => ({ label: s.name, value: s.id }))} /></Form.Item>
              <Form.Item label="Apply To Bill" name="billId" className="!mb-3"><Select allowClear showSearch optionFilterProp="label" placeholder="Bill" options={openBills.map((b: any) => ({ label: `${b.invoiceNo} — ${b.supplier?.name || ''} (${fmtMoney(b.total)})`, value: b.id }))} /></Form.Item>
            </div>
            <Form.Item name="payeeOverride" className="!mb-3" label={<span className="text-[13px] font-medium text-[#344054]">Payee Name (override)</span>}><Input placeholder="Or type payee name directly" /></Form.Item>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
              <Form.Item name="amount" className="!mb-0" label={<span className="text-[13px] font-medium text-[#344054]">Amount ($) *</span>} rules={[{ required: true, message: 'Amount required' }]}><InputNumber className="w-full" prefix="$" min={0} /></Form.Item>
              <div><div className="text-[13px] font-medium text-[#344054] mb-1">In Words</div><div className="rounded-lg bg-[#f7f8fc] px-3 py-2 text-[13px] text-[#64748b] min-h-[42px]">{inWords}</div></div>
            </div>
            <div className="mb-3"><div className="text-[13px] font-medium text-[#344054] mb-1">Payee Address</div><Input placeholder="Payee mailing address (shown in the envelope window)" /></div>
            <div className="mb-3"><div className="text-[13px] font-medium text-[#344054] mb-1">Memo</div><Input value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} placeholder="What is this check for?" /><div className="text-[11px] text-[#94a3b8] text-right mt-1">{memo.length} / 200</div></div>
            <div className="flex items-center gap-2 mb-4"><Button icon={<PaperClipOutlined />} onClick={() => message.info('Attachment storage is not configured.')}>Attach Receipt</Button><span className="text-[12px] text-[#94a3b8]">Receipts can be attached when document storage is enabled.</span></div>

            <div className="flex items-center gap-3 my-3"><div className="h-px flex-1 bg-[#eef0f6]" /><span className="text-[13px] font-semibold text-[#475060]">Split Lines (Expense Accounts)</span><div className="h-px flex-1 bg-[#eef0f6]" /></div>
            <Table rowKey="key" columns={splitCols as any} dataSource={splits} pagination={false} size="small" />
            <Button type="dashed" block icon={<PlusOutlined />} onClick={addSplit} className="mt-2">Add Split</Button>
            {splits.length > 0 && <div className="text-right text-[13px] text-[#64748b] mt-2">Split Total: <span className="font-semibold text-[#171a2e]">{fmtMoney(splitsTotal)}</span> / Check {fmtMoney(amount)}</div>}

            <div className="flex items-center gap-2 mt-5">
              <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>Preview</Button>
              <div className="ml-auto flex gap-2"><Button onClick={record}>Save</Button><Button type="primary" icon={<PrinterOutlined />} onClick={record}>Save & Print</Button></div>
            </div>
          </Form>
        </div>

        <div className="nex-card p-6">
          <div className="flex items-center gap-2 mb-4"><span className="text-[#003366]"><EyeOutlined /></span><span className="text-[16px] font-semibold text-[#171a2e]">Live Preview</span></div>
          <div className="overflow-x-auto">
            <div className="min-w-[380px] border border-[#cbd5e8] rounded-md bg-[#fdfefe] p-5">
              <div className="flex justify-between items-start">
                <div><div className="font-bold text-[#003366] text-[16px]">{companyName}</div><div className="text-[12px] text-[#64748b]">{bankName}</div></div>
                <div className="text-right"><div className="text-[11px] uppercase text-[#64748b]">Check #</div><div className="font-mono font-semibold text-[#171a2e]">{checkNo || '—'}</div><div className="text-[12px] text-[#64748b]">{date ? dayjs(date).format('MM/DD/YYYY') : ''}</div></div>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div className="text-[13px] text-[#171a2e]">Pay to the Order of <span className="font-semibold">{vendorId ? suppliers.data?.find((s: any) => s.id === vendorId)?.name : '____________'}</span></div>
                <div className="text-right"><div className="text-[11px] text-[#64748b]">Amount</div><div className="font-mono font-semibold text-[#171a2e]">{amount ? fmtMoney(amount) : '$ 0.00'}</div></div>
              </div>
              <div className="mt-3 border-t border-[#e5eaf2] pt-2 text-[13px] text-[#64748b]">{inWords}</div>
              {memo && <div className="mt-3 text-[13px] text-[#475060]">Memo: {memo}</div>}
              <div className="mt-8 flex justify-between items-end"><div /><div><div className="text-[11px] text-[#64748b]">Authorized Signature</div><div className="border-b border-[#cbd5e8] w-[180px] h-5" /></div></div>
            </div>
          </div>
        </div>
      </div>

      <Drawer open={previewOpen} onClose={() => setPreviewOpen(false)} width={620} title="Check Preview">
        <div className="border border-[#cbd5e8] rounded-md bg-[#fdfefe] p-6">
          <div className="flex justify-between items-start">
            <div><div className="font-bold text-[#003366] text-[18px]">{companyName}</div><div className="text-[13px] text-[#64748b]">{bankName}</div></div>
            <div className="text-right"><div className="text-[11px] uppercase text-[#64748b]">Check #</div><div className="font-mono font-semibold">{checkNo || '—'}</div><div className="text-[13px] text-[#64748b]">{date ? dayjs(date).format('MM/DD/YYYY') : ''}</div></div>
          </div>
          <div className="mt-4 flex items-end justify-between"><span className="text-[14px]">Pay to the Order of <span className="font-semibold">{vendorId ? suppliers.data?.find((s: any) => s.id === vendorId)?.name : '____________'}</span></span><span className="font-mono font-semibold text-[16px]">{amount ? fmtMoney(amount) : '$ 0.00'}</span></div>
          <div className="mt-3 border-t border-[#e5eaf2] pt-2 text-[14px] text-[#64748b]">{inWords}</div>
          <div className="mt-8 flex justify-between items-end"><div /><div><div className="text-[11px] text-[#64748b]">Authorized Signature</div><div className="border-b border-[#cbd5e8] w-[200px] h-5" /></div></div>
        </div>
      </Drawer>
    </div>
  );
}

