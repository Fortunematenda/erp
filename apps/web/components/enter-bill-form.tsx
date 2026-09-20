'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Dropdown, Input, InputNumber, Select, Space, Tooltip } from 'antd';
import { DeleteOutlined, DownOutlined, PlusOutlined, UploadOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AccountSelector } from '@/components/account-selector';
import { useMeta } from '@/lib/meta';
import { fmtMoney } from '@/lib/format';

const TERMS = ['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Custom'];
const CURRENCIES = ['USD', 'ZAR', 'ZWG', 'EUR', 'GBP', 'CAD', 'AUD', 'GBP'];
function dueFromTerms(invDate: any, terms?: string) {
  if (!invDate || !terms) return undefined;
  const m = terms.match(/^Net (\d+)$/i);
  if (m) return dayjs(invDate).add(parseInt(m[1], 10), 'day');
  if (/receipt/i.test(terms)) return dayjs(invDate);
  return undefined;
}

export function EnterBillForm({ onSaved, variant = 'tab', initialSupplierId, onCancel }: { onSaved?: () => void; variant?: 'page' | 'tab'; initialSupplierId?: string; onCancel?: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const suppliers = meta.data?.suppliers || [];
  const projects = useQuery({ queryKey: ['/projects'], queryFn: () => api('/projects') });
  const [supplierId, setSupplierId] = useState(initialSupplierId || '');
  const [supplierInvNo, setSupplierInvNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<any>(dayjs());
  const [terms, setTerms] = useState<string>('Net 30');
  const [dueDate, setDueDate] = useState<any>(undefined);
  const [currency, setCurrency] = useState('USD');
  const [projectId, setProjectId] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [attachment, setAttachment] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([{ key: 1, accountId: '', description: '', amount: 0, error: '' }]);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const supplier = suppliers.find((s: any) => s.id === supplierId);

  useEffect(() => { if (supplier?.paymentTerms) setTerms(supplier.paymentTerms); }, [supplierId]); // eslint-disable-line
  useEffect(() => { if (supplier?.currency) setCurrency(supplier.currency); }, [supplierId]); // eslint-disable-line
  useEffect(() => { if (terms === 'Custom') { setDueDate(undefined); return; } setDueDate(dueFromTerms(invoiceDate, terms)); }, [terms, invoiceDate]); // eslint-disable-line

  const subtotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const grand = subtotal;
  function addLine() { setLines((prev) => [...prev, { key: prev.length + 1, accountId: '', description: '', amount: 0, error: '' }]); }
  function updLine(k: number, p: any) { setLines((prev) => prev.map((l) => (l.key === k ? { ...l, ...p, error: '' } : l))); }
  function remLine(k: number) { setLines((prev) => prev.filter((l) => l.key !== k)); }

  function validate(): boolean {
    let ok = true;
    const next = lines.map((l) => ({ ...l, error: '' }));
    if (!supplierId) { message.error('Supplier is required.'); ok = false; }
    if (!supplierInvNo.trim()) { message.error('Supplier Invoice # is required.'); ok = false; }
    if (!terms) { message.error('Terms is required.'); ok = false; }
    if (lines.length === 0) { message.error('Add at least one bill line.'); ok = false; }
    lines.forEach((l, i) => {
      if (!l.accountId) { next[i] = { ...l, error: 'Account required' }; ok = false; }
      else if (!l.description.trim()) { next[i] = { ...l, error: 'Description required' }; ok = false; }
      else if (!(Number(l.amount) > 0)) { next[i] = { ...l, error: 'Amount required' }; ok = false; }
    });
    setLines(next);
    if (!ok) return false;
    return true;
  }

  async function save(mode: 'draft' | 'post' | 'submit') {
    if (!validate()) return;
    if (mode !== 'draft' && !dueDate) { message.error('Due Date is required.'); return; }
    setSaving(mode === 'draft'); setPosting(mode !== 'draft');
    try {
      const body = { supplierId, invoiceNo: supplierInvNo.trim(), invoiceDate: invoiceDate.format('YYYY-MM-DD'), dueDate: dueDate ? dueDate.format('YYYY-MM-DD') : undefined, terms, currency, projectId: projectId || undefined, ref: reference, memo, lines: lines.map((l) => ({ description: l.description, quantity: 1, unitPrice: Number(l.amount), taxRate: 0, accountId: l.accountId })) };
      const bill = await api('/procurement/supplier-invoices', { method: 'POST', body: JSON.stringify(body) });
      if (attachment) await api(`/procurement/supplier-invoices/${bill.id}/attachments`, { method: 'POST', body: JSON.stringify({ name: attachment.name, mime: attachment.mime, size: attachment.size, dataUrl: attachment.dataUrl }) });
      if (mode === 'post') {
        await api(`/procurement/supplier-invoices/${bill.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST' }) });
        message.success('Bill posted — awaiting payment');
      } else if (mode === 'submit') {
        await api(`/procurement/supplier-invoices/${bill.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'SUBMIT' }) });
        message.success('Bill submitted for approval');
      } else {
        message.success('Draft saved');
      }
      qc.invalidateQueries({ queryKey: ['/procurement/bills'] }); qc.invalidateQueries({ queryKey: ['/procurement/dashboard'] }); qc.invalidateQueries({ queryKey: ['/procurement/supplier-invoices'] });
      onSaved?.();
    } catch (e: any) {
      const m = e.message || 'Could not save bill';
      if (/already exists/i.test(m)) { const mm = m.match(/Bill:\s*(PINV-\d+)/i); message.error(mm ? `This supplier invoice already exists. ${mm[1]}` : m); }
      else message.error(m);
    } finally { setSaving(false); setPosting(false); }
  }

  const headerFields = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-5">
      <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Supplier *</label><Select showSearch optionFilterProp="label" className="w-full" value={supplierId || undefined} onChange={setSupplierId} options={suppliers.map((v: any) => ({ label: v.name, value: v.id }))} placeholder="Select supplier" /></div>
      <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Supplier Invoice #</label><Input value={supplierInvNo} onChange={(e) => setSupplierInvNo(e.target.value)} placeholder="e.g. INV-12345" /></div>
      <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Invoice Date *</label><DatePicker className="w-full" value={invoiceDate} onChange={setInvoiceDate} allowClear={false} /></div>
      <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Terms *</label><Select className="w-full" value={terms} onChange={setTerms} options={TERMS.map((t) => ({ label: t, value: t }))} /></div>
      <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Due Date</label><DatePicker className="w-full" value={dueDate} onChange={setDueDate} disabled={terms !== 'Custom'} /></div>
      <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Currency *</label><Select className="w-full" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ label: c, value: c }))} /></div>
      <div><label className="block text-[12px] font-medium text-[#566069] mb-1">Project</label><Select allowClear showSearch optionFilterProp="label" className="w-full" value={projectId || undefined} onChange={setProjectId} placeholder="Optional" options={(projects.data || []).map((p: any) => ({ label: p.name, value: p.id }))} /></div>
      <div className="md:col-span-2"><label className="block text-[12px] font-medium text-[#566069] mb-1">Reference</label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO / external / supplier reference" /></div>
    </div>
  );

  return (
    <div className={variant === 'tab' ? '' : 'w-full'}>
      <div className="w-full p-0 md:px-1 pb-6">
        {headerFields}

        <div className="mt-8"><div className="flex items-center gap-3 mb-2"><div className="h-px flex-1 bg-[#eef0f6]" /><span className="text-[12px] font-semibold text-[#64748b]">* Bill Lines</span><div className="h-px flex-1 bg-[#eef0f6]" /></div>
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-1 md:grid-cols-[2.2fr_2fr_1fr_40px] gap-3 items-start py-2.5 border-t border-[#f0f1f6]">
              <div><AccountSelector allowedTypes={['EXPENSE', 'ASSET']} postingOnly value={l.accountId} onChange={(v) => updLine(l.key, { accountId: v })} placeholder="Account" /></div>
              <div><Input value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} placeholder="Description" /></div>
              <div><InputNumber className="w-full" min={0} prefix="$" value={l.amount} onChange={(v) => updLine(l.key, { amount: Number(v || 0) })} placeholder="Amount" /></div>
              <Tooltip title="Remove line"><Button type="text" icon={<DeleteOutlined />} className="!text-[#a1a6c0] hover:!text-[#ef4444]" onClick={() => remLine(l.key)} disabled={lines.length === 1} /></Tooltip>
              {l.error && <span className="text-[12px] text-[#ef4444] md:col-span-4 -mt-1">{l.error}</span>}
            </div>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine} className="mt-2">Add Line</Button>
        </div>

        <div className="mt-8">
          <div className="text-[12px] font-medium text-[#566069] mb-1">Attachment (Vendor Invoice File)</div>
          {attachment ? (
            <div className="rounded-xl border border-[#e6e9f0] p-3 flex items-center gap-3">
              <FileTextIcon /><div className="flex-1 min-w-0"><div className="font-medium text-[13px] text-[#171a2e] truncate">{attachment.name}</div><div className="text-[11px] text-[#8a90ad]">{Math.round(attachment.size / 1024)} KB</div></div>
              <Space size={2}><Tooltip title="Preview"><Button size="small" icon={<EyeOutlined />} onClick={() => window.open(attachment.dataUrl, '_blank')} /></Tooltip><Tooltip title="Remove"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => setAttachment(null)} /></Tooltip></Space>
            </div>
          ) : (
            <label className="block w-full rounded-xl border border-dashed border-[#c7d0e0] bg-[#fafbfe] hover:border-[#0b4a8f]/50 hover:bg-[#f6f8fd] transition-colors cursor-pointer p-8 text-center">
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setAttachment({ name: f.name, mime: f.type, size: f.size, dataUrl: String(r.result) }); r.readAsDataURL(f); }} />
              <p className="text-[13px] text-[#64748b] mb-1"><UploadOutlined className="mr-1" />Drag vendor invoice here or click to browse</p>
              <p className="text-[11px] text-[#a1a6c0] mb-0">PDF, JPG, PNG, DOC, XLS</p>
            </label>
          )}
        </div>

        <div className="mt-8">
          <div className="text-[12px] font-medium text-[#566069] mb-1">Internal Memo</div>
          <Input.TextArea rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Internal accounting / procurement notes…" />
        </div>

        <div className="mt-8 flex flex-col items-end space-y-1.5">
          <div className="flex items-center gap-6 text-[13px] text-[#475060]"><span>Subtotal</span><span className="min-w-[120px] text-right font-medium text-[#171a2e]">{fmtMoney(subtotal)}</span></div>
          <div className="flex items-center gap-6 text-[13px] text-[#475060]"><span>Tax</span><span className="min-w-[120px] text-right font-medium text-[#171a2e]">{fmtMoney(0)}</span></div>
          <div className="flex items-center gap-6 text-[16px] font-bold text-[#171a2e] border-t border-[#eef0f6] pt-2"><span>Total</span><span className="min-w-[120px] text-right text-[#003366]">{fmtMoney(grand)}</span></div>
          <div className="text-[12px] text-[#8a90ad] mt-1">Save Draft keeps the bill editable. Save & Post creates Accounts Payable.</div>
        </div>

        {variant === 'page' && (
          <div className="sticky bottom-0 mt-6 pt-4 border-t border-[#eef0f6] bg-white flex items-center justify-end gap-2">
            <Button onClick={() => onCancel?.()}>Cancel</Button>
            <Button onClick={() => save('draft')} disabled={saving || posting}>Save Draft</Button>
            <Dropdown.Button type="primary" icon={<DownOutlined />} loading={posting}
              onClick={() => save('post')}
              menu={{ items: [
                { key: 'post', label: 'Save & Post', onClick: () => save('post') },
                { key: 'draft', label: 'Save Draft', onClick: () => save('draft') },
                { key: 'submit', label: 'Submit for Approval', onClick: () => save('submit') },
              ] }}>
              Save & Post
            </Dropdown.Button>
          </div>
        )}
        {variant === 'tab' && (
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button onClick={() => save('draft')} disabled={saving || posting}>Save Draft</Button>
            <Dropdown.Button type="primary" icon={<DownOutlined />} loading={posting}
              onClick={() => save('post')}
              menu={{ items: [
                { key: 'post', label: 'Save & Post', onClick: () => save('post') },
                { key: 'draft', label: 'Save Draft', onClick: () => save('draft') },
                { key: 'submit', label: 'Submit for Approval', onClick: () => save('submit') },
              ] }}>
              Save & Post
            </Dropdown.Button>
          </div>
        )}
      </div>
    </div>
  );
}
function FileTextIcon() { return <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#0033660f] text-[#003366]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>; }
