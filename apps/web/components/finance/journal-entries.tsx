'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SwapOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { StatusTag } from '@/components/crud-page';
import { fmtDate, fmtMoney } from '@/lib/format';
import { AccountSelector } from '@/components/account-selector';
import { JournalDetailDrawer } from '@/components/finance/journal-detail-drawer';
import { AccountDetailDrawer } from '@/components/finance/account-detail-drawer';

const SOURCE_OPTS = [
  { value: 'MANUAL', label: 'Manual Journal' }, { value: 'OPENING_BALANCE', label: 'Opening Balance' },
  { value: 'SALES_INVOICE', label: 'Invoice' }, { value: 'RECEIPT', label: 'Receipt' },
  { value: 'CREDIT_NOTE', label: 'Credit Note' }, { value: 'DEBIT_NOTE', label: 'Debit Note' },
  { value: 'SUPPLIER_INVOICE', label: 'Supplier Bill' }, { value: 'SUPPLIER_PAYMENT', label: 'Supplier Payment' },
  { value: 'VENDOR_CREDIT', label: 'Vendor Credit' }, { value: 'VENDOR_CREDIT_REFUND', label: 'Vendor Credit Refund' },
  { value: 'CREDIT_CARD_CHARGE', label: 'Credit Card Charge' }, { value: 'CREDIT_CARD_PAYMENT', label: 'Credit Card Payment' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' }, { value: 'CHECK', label: 'Check' }, { value: 'CHECK_VOID', label: 'Check Void' },
  { value: 'COGS', label: 'Inventory' }, { value: 'PAYROLL', label: 'Payroll' }, { value: 'DEPRECIATION', label: 'Depreciation' }, { value: 'REVERSAL', label: 'Reversal' },
];

export function JournalEntries() {
  const qc = useQueryClient();
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [source, setSource] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [range, setRange] = useState<any>(undefined);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [sort, setSort] = useState<{ field?: string; order?: 'ascend' | 'descend' }>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const [reverse, setReverse] = useState<any | null>(null);
  const [revForm] = Form.useForm();
  const [manualOpen, setManualOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [mForm] = Form.useForm();

  useEffect(() => { const id = setTimeout(() => setDebouncedQ(searchQ), 300); return () => clearTimeout(id); }, [searchQ]);
  useEffect(() => { setPage(1); }, [debouncedQ, source, status, range, accountId]);

  const q = useQuery({
    queryKey: ['finance', 'journals-list', debouncedQ, source, status, range?.map((d: any) => d?.format?.('YYYY-MM-DD')), accountId, sort.field, sort.order, page, pageSize],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (debouncedQ) p.set('search', debouncedQ);
      if (source) p.set('source', source);
      if (status) p.set('status', status);
      if (range) { p.set('from', range[0].format('YYYY-MM-DD')); p.set('to', range[1].format('YYYY-MM-DD')); }
      if (accountId) p.set('accountId', accountId);
      if (sort.field) { p.set('sortBy', sort.field); p.set('sortOrder', sort.order === 'ascend' ? 'asc' : 'desc'); }
      return api(`/finance/journals/list?${p.toString()}`);
    },
  });

  const data = q.data;
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const pageTotals = data?.pageTotals || { debit: 0, credit: 0 };
  const imbalance = Math.abs(Number(pageTotals.debit) - Number(pageTotals.credit)) > 0.01;

  const accounts = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => api('/finance/accounts') });

  function refresh() { qc.invalidateQueries({ queryKey: ['finance', 'journals-list'] }); qc.invalidateQueries({ queryKey: ['finance', 'journals'] }); qc.invalidateQueries({ queryKey: ['finance', 'accounts'] }); qc.invalidateQueries({ queryKey: ['finance', 'accounts-summary'] }); qc.invalidateQueries({ queryKey: ['finance', 'ledger'] }); qc.invalidateQueries({ queryKey: ['finance', 'dashboard'] }); qc.invalidateQueries({ queryKey: ['finance', 'trial-balance'] }); }

  function handleTableChange(pagination: any, _f: any, sorter: any) {
    setPage(pagination?.current || 1); setPageSize(pagination?.pageSize || 50);
    if (sorter?.field && sorter?.order) setSort({ field: sorter.field, order: sorter.order });
    else setSort({});
  }

  async function submitReverse() {
    const v = await revForm.validateFields();
    setSaving(true);
    try {
      await api(`/finance/journals/${reverse.id}/reverse`, { method: 'POST' });
      message.success('Journal reversed'); setReverse(null); revForm.resetFields(); refresh();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  const mLines = Form.useWatch('lines', manualOpen ? mForm : undefined) || [];
  const totalDebit = mLines.reduce((s: number, l: any) => s + Number(l?.debit || 0), 0);
  const totalCredit = mLines.reduce((s: number, l: any) => s + Number(l?.credit || 0), 0);
  const diff = Number((totalDebit - totalCredit).toFixed(2));

  async function submitManual() {
    const v = await mForm.validateFields();
    if (Math.abs(totalDebit - totalCredit) > 0.01) { message.error(`Out of balance by ${fmtMoney(diff)}.`); return; }
    setSaving(true);
    try {
      await api('/finance/journals', { method: 'POST', body: JSON.stringify({ date: v.date?.format('YYYY-MM-DD'), description: v.description, reference: v.reference, lines: v.lines.map((l: any) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description })) }) });
      message.success('Manual journal posted');
      setManualOpen(false); mForm.resetFields(); refresh();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  const moneyCell = (v: number) => v ? <span className="font-semibold text-[13px] tabular-nums" style={{ color: '#344054' }}>{fmtMoney(v)}</span> : <span className="text-[#c3c7dc]">—</span>;
  const columns: ColumnsType<any> = [
    { title: 'Journal #', dataIndex: 'number', width: 104, render: (v, r) => <button onClick={() => setDetailId(r.id)} className="font-mono text-[12px] text-[#003366] font-semibold hover:underline">{v}</button> },
    { title: 'Date', dataIndex: 'date', width: 96, sorter: true, sortOrder: sort.order && sort.field === 'date' ? sort.order : null, render: fmtDate },
    { title: 'Reference', dataIndex: 'reference', width: 110, render: (v, r) => v ? <Link href={r.sourceRoute}><span className="font-mono text-[12px] text-[#5a6080] hover:underline">{v}</span></Link> : <span className="text-[#dfe1ee]">—</span> },
    { title: 'Source', dataIndex: 'sourceLabel', width: 130, render: (v) => <Tag style={{ borderRadius: 6 }}>{v || '—'}</Tag> },
    { title: 'Lines', dataIndex: 'linesCount', width: 56, align: 'center', render: (v) => <Tag style={{ borderRadius: 6, border: 'none', background: '#f2f3f9', color: '#5a6080' }}>{v}</Tag> },
    { title: 'Debit', dataIndex: 'amount', width: 104, align: 'right', render: (v) => moneyCell(Number(v)) },
    { title: 'Credit', dataIndex: 'credit', width: 104, align: 'right', render: (v) => moneyCell(Number(v)) },
    { title: 'Balance', width: 108, render: (_, r) => r.isBalanced ? <BalancePill v="Balanced" tone="green" /> : <BalancePill v={`Unbalanced · ${fmtMoney(Number(r.amount) - Number(r.credit))}`} tone="amber" /> },
    { title: 'Status', dataIndex: 'status', width: 96, sorter: true, sortOrder: sort.field === 'status' ? sort.order : null, render: (v) => <StatusTag value={v} /> },
    { title: 'Entered By', dataIndex: 'enteredBy', width: 130, render: (v) => <span className="text-[13px]" style={{ color: '#344054' }}>{v || '—'}</span> },
    { title: 'Actions', width: 82, render: (_, r) => r.status === 'POSTED' ? <Button size="small" icon={<SwapOutlined />} onClick={() => { setReverse(r); revForm.resetFields(); revForm.setFieldsValue({ date: dayjs() }); }}>Reverse</Button> : null },
  ];

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <Kpi label="Journal Entries" value={total} note={`${total} matching entries`} />
        <Kpi label="Total Debits" value={fmtMoney(pageTotals.debit)} />
        <Kpi label="Total Credits" value={fmtMoney(pageTotals.credit)} neg={imbalance} />
      </div>
      {imbalance && <div className="rounded-lg px-4 py-2.5 mb-4 text-[13px]" style={{ background: '#fffbeb', border: '1px solid #feefc3', color: '#92400e' }}>Journal imbalance detected · Difference: {fmtMoney(Number(pageTotals.debit) - Number(pageTotals.credit))}</div>}

      <Card className="nex-card mb-4" styles={{ body: { padding: 0 } }}>
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-[#f2f3f9]">
          <Input allowClear prefix={<span className="text-[#a1a6c0] mr-1">🔍</span>} placeholder="Search journal #, description, reference, account…" className="!rounded-[9px]" style={{ flex: '0 1 340px', minWidth: 280, maxWidth: 420 }} value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
          <Select allowClear showSearch placeholder="All Sources" className="!min-w-[150px]" value={source} onChange={(v) => setSource(v)} options={SOURCE_OPTS} />
          <Select allowClear placeholder="All Statuses" className="!min-w-[120px]" value={status} onChange={setStatus} options={['POSTED', 'DRAFT', 'REVERSED'].map((s) => ({ label: s, value: s }))} />
          <DatePicker.RangePicker value={range} onChange={(v) => setRange(v)} />
          <Select allowClear showSearch placeholder="Account" className="!min-w-[180px]" value={accountId} onChange={setAccountId} options={(accounts.data || []).map((a: any) => ({ label: `${a.code} · ${a.name}`, value: a.id }))} />
          <Button type="primary" icon={<PlusOutlined />} className="ml-auto" onClick={() => { mForm.resetFields(); mForm.setFieldsValue({ lines: [{ debit: 0, credit: 0 }] }); setManualOpen(true); }}>Manual Journal</Button>
        </div>
        <Table
          rowKey="id"
          loading={q.isFetching}
          dataSource={rows}
          columns={columns}
          onChange={handleTableChange}
          expandable={{ expandedRowRender: (r: any) => <JournalLines lines={r.lines || []} enteredBy={r.enteredBy} onOpenAccount={setOpenAccountId} /> }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
          scroll={{ x: 1000 }}
          size="middle"
        />
      </Card>

      <JournalDetailDrawer open={!!detailId} journalId={detailId} onClose={() => setDetailId(null)} />
      <AccountDetailDrawer open={!!openAccountId} accountId={openAccountId} onClose={() => setOpenAccountId(null)} onEdit={() => {}} onChanged={refresh} />

      <Modal open={!!reverse} title={`Reverse Journal ${reverse?.number}`} okText="Reverse" onCancel={() => setReverse(null)} onOk={submitReverse} confirmLoading={saving} destroyOnHidden>
        <Form form={revForm} layout="vertical">
          <Form.Item label="Reversal Date *" name="date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Reason *" name="reason" rules={[{ required: true, message: 'Reason is required' }]}><Input.TextArea rows={2} placeholder="Why is this journal being reversed?" /></Form.Item>
          <Form.Item label="Reference" name="reference"><Input placeholder="Optional reference" /></Form.Item>
        </Form>
      </Modal>

      <Drawer open={manualOpen} onClose={() => setManualOpen(false)} title="Manual Journal" width={720} destroyOnHidden
        footer={<Space className="w-full justify-end"><Button onClick={() => setManualOpen(false)}>Cancel</Button><Button type="primary" disabled={Math.abs(diff) > 0.01} onClick={() => submitManual()} loading={saving}>Post Journal</Button></Space>}>
        <Form form={mForm} layout="vertical">
          <div className="grid grid-cols-3 gap-3">
            <Form.Item label="Journal Date *" name="date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Reference" name="reference"><Input /></Form.Item>
            <Form.Item label="Description / Memo *" name="description" rules={[{ required: true }]}><Input /></Form.Item>
          </div>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-semibold text-[#8a90ad] w-72">Account</span>
                  <span className="text-[12px] font-semibold text-[#8a90ad] w-28 text-right">Debit</span>
                  <span className="text-[12px] font-semibold text-[#8a90ad] w-28 text-right">Credit</span>
                  <span className="text-[12px] font-semibold text-[#8a90ad] flex-1">Line note</span>
                </div>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} align="baseline" className="w-full mb-2" wrap>
                    <Form.Item name={[name, 'accountId']} {...rest} rules={[{ required: true, message: 'Account' }]} className="!mb-0 w-72">
                      <AccountSelector allowedTypes={[]} placeholder="Account" />
                    </Form.Item>
                    <Form.Item name={[name, 'debit']} {...rest} className="!mb-0 w-28"><InputNumber placeholder="0.00" min={0} prefix="$" className="w-full" onChange={() => { const lx = mForm.getFieldValue(['lines', name]); if (Number(lx?.debit) > 0) mForm.setFieldValue(['lines', name, 'credit'], 0); }} /></Form.Item>
                    <Form.Item name={[name, 'credit']} {...rest} className="!mb-0 w-28"><InputNumber placeholder="0.00" min={0} prefix="$" className="w-full" onChange={() => { const lx = mForm.getFieldValue(['lines', name]); if (Number(lx?.credit) > 0) mForm.setFieldValue(['lines', name, 'debit'], 0); }} /></Form.Item>
                    <Form.Item name={[name, 'description']} {...rest} className="!mb-0 flex-1 min-w-[140px]"><Input placeholder="Line note" /></Form.Item>
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ debit: 0, credit: 0 })}>Add line</Button>
              </>
            )}
          </Form.List>
          <div className="mt-3 rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: Math.abs(diff) < 0.01 ? '#f0fdf9' : '#fffbeb', border: `1px solid ${Math.abs(diff) < 0.01 ? '#a7f3d0' : '#fde68a'}` }}>
            <div className="text-[13px]">
              <span className="font-semibold text-[#10b981]">Debit {fmtMoney(totalDebit)}</span> <span className="mx-2 text-[#dfe1ee]">|</span> <span className="font-semibold text-[#ef4444]">Credit {fmtMoney(totalCredit)}</span> <span className="mx-2 text-[#dfe1ee]">|</span>
              <span className="font-semibold" style={{ color: Math.abs(diff) < 0.01 ? '#10b981' : '#f59e0b' }}>{Math.abs(diff) < 0.01 ? 'Balanced' : `Out of balance by ${fmtMoney(diff)}`}</span>
            </div>
          </div>
        </Form>
      </Drawer>
    </div>
  );
}

function Kpi({ label, value, note, neg }: { label: string; value: any; note?: string; neg?: boolean }) {
  return (
    <div className="nex-card p-4 rounded-[12px] min-h-[100px]">
      <div className="text-[13px] font-semibold text-[#667085]">{label}</div>
      <div className={`text-[21px] font-semibold leading-[1.2] tracking-[-0.01em] mt-1 ${neg ? 'text-[#ef4444]' : 'text-[#475467]'}`}>{value}</div>
      {note && <div className="text-[11.5px] text-[#98A2B3] mt-1">{note}</div>}
    </div>
  );
}

function BalancePill({ v, tone }: { v: string; tone: 'green' | 'amber' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${tone === 'green' ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fffbeb] text-[#b54708]'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${tone === 'green' ? 'bg-[#10b981]' : 'bg-[#f59e0b]'}`} />{v}
    </span>
  );
}

function JournalLines({ lines, enteredBy, onOpenAccount }: { lines: any[]; enteredBy?: string; onOpenAccount: (id: string) => void }) {
  const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
  const blank = <span className="text-[#c3c7dc]">—</span>;
  return (
    <div className="px-2 py-3">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-[#f8f9ff]">
            <th className="text-left text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide px-3 py-2 w-8">#</th>
            <th className="text-left text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide px-3 py-2 w-64">Account</th>
            <th className="text-left text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide px-3 py-2">Memo</th>
            <th className="text-right text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide px-3 py-2 w-28">Debit</th>
            <th className="text-right text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide px-3 py-2 w-28">Credit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f2f3f9]">
          {lines.map((l: any, i: number) => (
            <tr key={l.id}>
              <td className="px-3 py-2 text-[#a1a6c0]">{i + 1}</td>
              <td className="px-3 py-2">
                <button onClick={() => onOpenAccount(l.accountId)} className="text-left hover:text-[#003366] hover:underline">
                  <span className="font-mono text-[12px] text-[#003366]">{l.code}</span><span className="mx-1 text-[#a1a6c0]">·</span><span className="font-medium">{l.name}</span>
                </button>
              </td>
              <td className="px-3 py-2" style={{ color: '#475467' }}>{l.description || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: '#344054' }}>{Number(l.debit) ? fmtMoney(l.debit) : blank}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: '#344054' }}>{Number(l.credit) ? fmtMoney(l.credit) : blank}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[#e9edf2] bg-[#f8f9ff]">
            <td className="px-3 py-2" />
            <td className="px-3 py-2 font-semibold" style={{ color: '#5a6080' }}>Totals ({lines.length} line{lines.length === 1 ? '' : 's'})</td>
            <td />
            <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: '#1f2937' }}>{fmtMoney(totalDebit)}</td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: '#1f2937' }}>{fmtMoney(totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-2 text-[12px]" style={{ color: '#98A2B3' }}>Entered By: {enteredBy || '—'}</div>
    </div>
  );
}
