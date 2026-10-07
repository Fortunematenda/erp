'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Checkbox, Collapse, ConfigProvider, DatePicker, Dropdown, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Tooltip } from 'antd';
import { DeleteOutlined, DownOutlined, PlusOutlined, UploadOutlined, EyeOutlined, FileSearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AccountSelector } from '@/components/account-selector';
import { useMeta } from '@/lib/meta';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { ITEM_TYPE_BADGE, normalizeItemType } from '@/lib/item-type';
import { useAuthPermissions } from '@/components/Can';

const TERMS = ['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Custom'];
const CURRENCIES = ['USD', 'ZAR', 'ZWG', 'EUR', 'GBP', 'CAD', 'AUD'];
function dueFromTerms(invDate: any, terms?: string) {
  if (!invDate || !terms) return undefined;
  const m = terms.match(/^Net (\d+)$/i);
  if (m) return dayjs(invDate).add(parseInt(m[1], 10), 'day');
  if (/receipt/i.test(terms)) return dayjs(invDate);
  return undefined;
}
let keySeq = 1;
const newLine = () => ({ key: keySeq++, itemId: undefined, description: '', quantity: 1, unitPrice: 0, taxRate: 0, accountId: '', purchaseOrderLineId: undefined, itemType: undefined, unit: undefined, error: '' });

function Field({ label, required, error, children, className }: { label: string; required?: boolean; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="nex-field-label">{label}{required && <span className="req">*</span>}</label>
      {children}
      {error && <div className="text-[12px] text-[#dc2626] mt-1">{error}</div>}
    </div>
  );
}

export function EnterBillForm({ onSaved, variant = 'tab', initialSupplierId, initialPurchaseOrderId, onCancel }: { onSaved?: () => void; variant?: 'page' | 'tab'; initialSupplierId?: string; initialPurchaseOrderId?: string; onCancel?: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const { permissions } = useAuthPermissions();
  const canPost = permissions.includes('procurement.bills.manage');
  const suppliers = meta.data?.suppliers || [];
  const items = meta.data?.items || [];
  const accounts = meta.data?.accounts || [];
  const taxRates = meta.data?.taxRates || [];
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
  const [lines, setLines] = useState<any[]>([newLine()]);
  const [po, setPo] = useState<{ id: string; poNo: string; lines: any[] } | null>(null);
  const [receiveNow, setReceiveNow] = useState(false);
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const supplier = suppliers.find((s: any) => s.id === supplierId);
  const eligiblePos = useQuery({ queryKey: ['/procurement/purchase-orders/eligible', supplierId], queryFn: () => api(`/procurement/purchase-orders/eligible?supplierId=${supplierId}`), enabled: poModalOpen && !!supplierId });

  useEffect(() => { if (supplier?.paymentTerms) setTerms(supplier.paymentTerms); }, [supplierId]); // eslint-disable-line
  useEffect(() => { if (supplier?.currency) setCurrency(supplier.currency); }, [supplierId]); // eslint-disable-line
  useEffect(() => { if (terms === 'Custom') { setDueDate(undefined); return; } setDueDate(dueFromTerms(invoiceDate, terms)); }, [terms, invoiceDate]); // eslint-disable-line

  const itemById = useMemo(() => new Map(items.map((i: any) => [i.id, i])), [items]);
  const acctName = (id?: string) => { const a = accounts.find((x: any) => x.id === id); return a ? `${a.code} ${a.name}` : null; };
  const taxRateOf = (code?: string | null) => { if (!code) return 0; const t = taxRates.find((x: any) => x.code === code || x.taxCode === code); return t ? Number(t.rate) : 0; };

  const subtotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const taxTotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0) * Number(l.taxRate || 0) / 100, 0);
  const grand = subtotal + taxTotal;
  const hasInventory = lines.some((l) => (l.itemType || (l.itemId ? normalizeItemType(itemById.get(l.itemId)?.type) : null)) === 'INVENTORY_PRODUCT');

  function updLine(k: number, p: any) { setLines((prev) => prev.map((l) => (l.key === k ? { ...l, ...p, error: '' } : l))); }
  function addLine() { setLines((prev) => [...prev, newLine()]); }
  function remLine(k: number) { setLines((prev) => prev.filter((l) => l.key !== k)); }

  function pickItem(k: number, itemId: string) {
    const it: any = itemById.get(itemId);
    if (!it) { updLine(k, { itemId }); return; }
    updLine(k, {
      itemId,
      itemType: normalizeItemType(it.type),
      description: it.purchaseDescription || it.name,
      unitPrice: Number(it.purchaseCost || 0),
      unit: it.unit,
      taxRate: taxRateOf(it.purchaseTaxCode),
      accountId: '',
    });
  }

  async function addFromPo(poId: string) {
    try {
      const data = await api(`/procurement/purchase-orders/${poId}/bill-lines`);
      const poLines = (data.lines || []).filter((l: any) => Number(l.remainingToBill) > 0);
      if (!poLines.length) { message.info('Nothing remaining to bill on this purchase order.'); return; }
      setPo({ id: data.purchaseOrderId, poNo: data.poNo, lines: data.lines });
      setLines(poLines.map((l: any) => ({
        key: keySeq++, itemId: l.itemId || undefined, description: l.description, quantity: Number(l.remainingToBill),
        unitPrice: Number(l.unitPrice), taxRate: taxRateOf(itemById.get(l.itemId)?.purchaseTaxCode), unit: l.unit,
        accountId: l.accountId || '', purchaseOrderLineId: l.purchaseOrderLineId, itemType: l.itemId ? normalizeItemType(itemById.get(l.itemId)?.type) : undefined, error: '',
      })));
      if (data.supplierId) setSupplierId((prev) => prev || data.supplierId);
      if (data.currency) setCurrency(data.currency);
      setPoModalOpen(false);
      message.success(`Loaded ${poLines.length} line(s) from ${data.poNo}`);
    } catch (e: any) { message.error(e.message); }
  }

  useEffect(() => { if (initialPurchaseOrderId) addFromPo(initialPurchaseOrderId); }, [initialPurchaseOrderId]); // eslint-disable-line

  const matching = useMemo(() => {
    if (!po) return null;
    let received = 0, ordered = 0, billed = 0, unreceived = 0, qtyVar = false;
    for (const l of po.lines) {
      const bl = lines.find((x) => x.purchaseOrderLineId === l.purchaseOrderLineId);
      const billNow = bl ? Number(bl.quantity || 0) : 0;
      const isStock = !!l.itemId;
      ordered += Number(l.ordered || 0); received += Number(l.received || 0); billed += Number(l.billed || l.invoiced || 0) + billNow;
      if (isStock && billNow > Number(l.received || 0) + 0.001) { unreceived += billNow - Number(l.received || 0); qtyVar = true; }
    }
    return { ordered, received, billed, unreceived, qtyVar, poNo: po.poNo };
  }, [po, lines]);

  const previewLines = lines.map((l) => {
    const it: any = l.itemId ? itemById.get(l.itemId) : null;
    const type = l.itemType || (it ? normalizeItemType(it.type) : null);
    const dr = type === 'INVENTORY_PRODUCT' ? (acctName(it?.inventoryAssetAccountId) || '1200 Inventory') : (acctName(it?.expenseAccountId) || 'Expense');
    const cogs = type === 'INVENTORY_PRODUCT' ? (acctName(it?.cogsAccountId) || 'Cost of Goods Sold') : null;
    return { key: l.key, description: l.description, amount: Number(l.quantity || 0) * Number(l.unitPrice || 0), dr, cogs, type };
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!supplierId) e.supplierId = 'Supplier is required.';
    if (!supplierInvNo.trim()) e.supplierInvNo = 'Supplier Invoice # is required.';
    if (!terms) e.terms = 'Payment terms are required.';
    const lineErrs = lines.map((l) => {
      if (!l.itemId && !l.accountId) return 'Item or account is required.';
      if (!String(l.description || '').trim()) return 'Description is required.';
      if (!(Number(l.quantity) > 0)) return 'Quantity must be greater than zero.';
      return '';
    });
    const badLine = lineErrs.findIndex((x) => x);
    setErrors(e);
    if (badLine >= 0) setLines((prev) => prev.map((l, i) => ({ ...l, error: lineErrs[i] })));
    if (Object.keys(e).length || badLine >= 0) {
      message.error(Object.values(e)[0] || lineErrs[badLine]);
      return false;
    }
    return true;
  }

  async function save(mode: 'draft' | 'post' | 'submit') {
    if (!validate()) return;
    if (mode !== 'draft' && !dueDate) { message.error('Due Date is required.'); return; }
    setSaving(mode === 'draft'); setPosting(mode !== 'draft');
    try {
      const body = {
        supplierId, invoiceNo: supplierInvNo.trim(), invoiceDate: invoiceDate.format('YYYY-MM-DD'),
        dueDate: dueDate ? dueDate.format('YYYY-MM-DD') : undefined, terms, currency, projectId: projectId || undefined, ref: reference, memo,
        purchaseOrderId: po?.id,
        receiveNow: hasInventory ? receiveNow : undefined,
        warehouseId: receiveNow ? warehouseId : undefined,
        lines: lines.map((l) => ({ description: l.description, itemId: l.itemId || undefined, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate || 0), accountId: l.accountId || undefined, purchaseOrderLineId: l.purchaseOrderLineId })),
      };
      const bill = await api('/procurement/supplier-invoices', { method: 'POST', body: JSON.stringify(body) });
      if (attachment) await api(`/procurement/supplier-invoices/${bill.id}/attachments`, { method: 'POST', body: JSON.stringify({ name: attachment.name, mime: attachment.mime, size: attachment.size, dataUrl: attachment.dataUrl }) });
      if (mode === 'post') {
        await api(`/procurement/supplier-invoices/${bill.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST', confirmMissingReceipt: true, overrideReason: matching?.unreceived ? 'bill-first confirmed in form' : undefined }) });
        message.success('Bill posted — awaiting payment');
      } else if (mode === 'submit') {
        await api(`/procurement/supplier-invoices/${bill.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'SUBMIT' }) });
        message.success('Bill submitted for approval');
      } else message.success('Draft saved');
      ['/procurement/bills', '/procurement/dashboard', '/procurement/supplier-invoices', '/procurement/purchase-orders', '/finance/ledger'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onSaved?.();
    } catch (e: any) {
      message.error(e.message || 'Could not save bill');
    } finally { setSaving(false); setPosting(false); }
  }

  const itemOptions = items.map((i: any) => ({ label: `${i.sku ? i.sku + ' — ' : ''}${i.name}`, value: i.id }));
  const busy = saving || posting;

  return (
    <div className={variant === 'tab' ? '' : 'w-full'}>
      <ConfigProvider componentSize="large">
        <div className="nex-form w-full p-0 md:px-1 pb-24">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4">
            <Field label="Supplier" required error={errors.supplierId} className="sm:col-span-2">
              <Select showSearch optionFilterProp="label" status={errors.supplierId ? 'error' : undefined} className="w-full" value={supplierId || undefined} onChange={(v) => { setSupplierId(v); setErrors((e) => ({ ...e, supplierId: '' })); }} options={suppliers.map((v: any) => ({ label: v.name, value: v.id }))} placeholder={meta.isLoading ? 'Loading suppliers…' : 'Select supplier'} notFoundContent={meta.isLoading ? <Spin size="small" /> : undefined} />
            </Field>
            <Field label="Supplier Invoice #" required error={errors.supplierInvNo}>
              <Input status={errors.supplierInvNo ? 'error' : undefined} value={supplierInvNo} onChange={(e) => { setSupplierInvNo(e.target.value); setErrors((x) => ({ ...x, supplierInvNo: '' })); }} placeholder="e.g. INV-12345" />
            </Field>
            <Field label="Invoice Date" required>
              <DatePicker className="w-full" value={invoiceDate} onChange={setInvoiceDate} allowClear={false} />
            </Field>

            <Field label="Payment Terms" required error={errors.terms}>
              <Select className="w-full" value={terms} onChange={setTerms} options={TERMS.map((t) => ({ label: t, value: t }))} />
            </Field>
            <Field label="Due Date">
              {terms === 'Custom'
                ? <DatePicker className="w-full" value={dueDate} onChange={setDueDate} placeholder="Select due date" />
                : <div className="nex-readonly" title="Calculated from Invoice Date + Payment Terms">{dueDate ? dueDate.format('DD MMM YYYY') : '—'}</div>}
            </Field>
            <Field label="Currency" required>
              <Select className="w-full" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ label: c, value: c }))} />
            </Field>
            <Field label="Project">
              <Select allowClear showSearch optionFilterProp="label" className="w-full" value={projectId || undefined} onChange={setProjectId} placeholder="Optional" options={(projects.data || []).map((p: any) => ({ label: p.name, value: p.id }))} />
            </Field>

            <Field label="Reference" className="sm:col-span-2">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO / external / supplier reference" />
            </Field>
            <Field label="Additional Notes" className="sm:col-span-2">
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Internal accounting / procurement notes" />
            </Field>
          </div>

          {matching && (
            <div className="mt-6 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[#92400e]">Three-Way Matching — {matching.poNo}</span>
                <Tag color={matching.qtyVar ? 'orange' : 'green'}>{matching.qtyVar ? 'QUANTITY VARIANCE' : 'MATCHED'}</Tag>
              </div>
              <div className="flex flex-wrap gap-6 text-[13px]">
                <span className="text-[#92400e]">Ordered <b className="text-[#171a2e]">{fmtNumber(matching.ordered)}</b></span>
                <span className="text-[#92400e]">Received <b className="text-[#171a2e]">{fmtNumber(matching.received)}</b></span>
                <span className="text-[#92400e]">Billed now <b className="text-[#171a2e]">{fmtNumber(matching.billed)}</b></span>
              </div>
              {matching.qtyVar && (
                <>
                  <div className="mt-2 text-[13px] font-medium text-[#b45309]">⚠ Bill quantity exceeds goods received by {fmtNumber(matching.unreceived)} unit(s). You can post this as a bill-first GRNI accrual; stock is not shown until received.</div>
                  <Space className="mt-3" wrap>
                    <Button size="small" onClick={() => document.getElementById('bill-lines')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Adjust Bill</Button>
                    <Button size="small" onClick={() => save('submit')} loading={posting}>Request Approval</Button>
                  </Space>
                </>
              )}
            </div>
          )}

          <div id="bill-lines" className="mt-6 flex items-center justify-between mb-3">
            <div className="nex-form-section !mb-0">Bill Items</div>
            <div className="flex items-center gap-3">
              {!supplierId && <span className="text-[12px] text-[#94a3b8]">Select a supplier to view available purchase orders.</span>}
              <Tooltip title={!supplierId ? 'Select a supplier first' : undefined}>
                <Button icon={<FileSearchOutlined />} disabled={!supplierId} onClick={() => setPoModalOpen(true)}>Add from PO</Button>
              </Tooltip>
            </div>
          </div>
          <Table className="nex-items-table" rowKey="key" size="middle" pagination={false} dataSource={lines} scroll={{ x: 1080 }} columns={[
            { title: 'Item', width: 240, render: (_v, l: any) => <Select allowClear showSearch optionFilterProp="label" className="w-full" placeholder="Select item" value={l.itemId} options={itemOptions} onChange={(v) => pickItem(l.key, v)} /> },
            { title: 'Description', width: 220, render: (_v, l: any) => <Input value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} placeholder="Description" /> },
            { title: 'Qty', width: 110, align: 'right', render: (_v, l: any) => <InputNumber min={0} className="w-full" style={{ textAlign: 'right' }} value={l.quantity} onChange={(v) => updLine(l.key, { quantity: Number(v || 0) })} addonAfter={l.unit || undefined} /> },
            { title: 'Unit Cost', width: 130, align: 'right', render: (_v, l: any) => <InputNumber min={0} prefix="$" className="w-full" style={{ textAlign: 'right' }} value={l.unitPrice} onChange={(v) => updLine(l.key, { unitPrice: Number(v || 0) })} /> },
            { title: 'Tax %', width: 90, align: 'right', render: (_v, l: any) => <InputNumber min={0} className="w-full" style={{ textAlign: 'right' }} value={l.taxRate} onChange={(v) => updLine(l.key, { taxRate: Number(v || 0) })} /> },
            { title: 'Account', width: 210, render: (_v, l: any) => <AccountSelector billLine postingOnly allowedTypes={['EXPENSE', 'ASSET']} value={l.accountId} onChange={(v) => updLine(l.key, { accountId: v })} placeholder="Auto / override" /> },
            { title: 'Amount', width: 110, align: 'right', render: (_v, l: any) => <span className="font-semibold text-[#003366] tabular-nums">{fmtMoney(Number(l.quantity || 0) * Number(l.unitPrice || 0))}</span> },
            { title: 'Type', width: 110, render: (_v, l: any) => { const t = l.itemType; return t ? <Tag>{ITEM_TYPE_BADGE[t as keyof typeof ITEM_TYPE_BADGE] || t}</Tag> : <span className="text-[11px] text-[#94a3b8]">account line</span>; } },
            { title: '', width: 50, render: (_v, l: any) => <Tooltip title="Remove line"><Button type="text" danger icon={<DeleteOutlined />} onClick={() => remLine(l.key)} disabled={lines.length === 1} /></Tooltip> },
          ]} />
          {lines.some((l) => l.error) && <div className="text-[12px] text-[#dc2626] mt-2">{lines.filter((l) => l.error).map((l, i) => <div key={i}>{l.error}</div>)}</div>}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine} className="mt-3">Add Line</Button>

          <Collapse
            className="mt-5"
            items={[{
              key: 'preview', label: <span className="text-[13px] font-semibold text-[#171a2e]">Accounting Preview</span>,
              children: (
                <div>
                  <Table rowKey="key" size="small" pagination={false} dataSource={previewLines as any[]} columns={[
                    { title: 'Item', dataIndex: 'description' },
                    { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) },
                    { title: 'Debit', dataIndex: 'dr', render: (v: any) => <span className="text-[#15803d] font-medium">{v}</span> },
                    { title: 'Credit', render: () => <span className="text-[#b91c1c] font-medium">2000 Accounts Payable</span> },
                    { title: 'COGS (future sale/issue)', dataIndex: 'cogs', render: (v: any) => v ? <span className="text-[#475467]">{v} — not debited on purchase</span> : <span className="text-[#cbd5e1]">—</span> },
                  ] as any} />
                  <div className="text-[12px] text-[#64748b] mt-2">Inventory purchases are capitalised to Inventory Asset (or accrued to GRNI until received); COGS is recognised only when the goods are sold/issued.</div>
                </div>
              ),
            }]}
          />

          {hasInventory && (
            <div className="mt-5 rounded-xl border border-[#e2e8f0] bg-white p-4">
              <div className="text-[13px] font-semibold text-[#334155] mb-2">Inventory</div>
              <div className="flex flex-wrap items-center gap-4">
                <Checkbox checked={receiveNow} onChange={(e) => setReceiveNow(e.target.checked)}>Goods received now (create the stock receipt on posting)</Checkbox>
                {receiveNow && <Select allowClear showSearch optionFilterProp="label" placeholder="Receiving warehouse" style={{ minWidth: 240 }} value={warehouseId} onChange={setWarehouseId} options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} />}
              </div>
              <div className="text-[12px] text-[#64748b] mt-2">If not ticked, the bill is recorded as a GRNI accrual and stock is added when the goods are received.</div>
            </div>
          )}

          <div className="mt-5">
            <div className="nex-field-label">Attachment (Vendor Invoice File)</div>
            {attachment ? (
              <div className="rounded-xl border border-[#e2e8f0] p-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#0033660f] text-[#003366]">📄</span>
                <div className="flex-1 min-w-0"><div className="font-medium text-[13px] text-[#171a2e] truncate">{attachment.name}</div><div className="text-[11px] text-[#64748b]">{Math.round(attachment.size / 1024)} KB</div></div>
                <Space size={2}><Tooltip title="Preview"><Button size="small" icon={<EyeOutlined />} onClick={() => window.open(attachment.dataUrl, '_blank')} /></Tooltip><Tooltip title="Remove"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => setAttachment(null)} /></Tooltip></Space>
              </div>
            ) : (
              <label className="block w-full rounded-xl border border-dashed border-[#cbd5e1] bg-[#fafbfe] hover:border-[#003366]/50 hover:bg-[#f6f8fd] transition-colors cursor-pointer p-6 text-center">
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setAttachment({ name: f.name, mime: f.type, size: f.size, dataUrl: String(r.result) }); r.readAsDataURL(f); }} />
                <p className="text-[13px] text-[#475467] mb-1"><UploadOutlined className="mr-1" />Drag vendor invoice here or click to browse</p>
                <p className="text-[11px] text-[#94a3b8] mb-0">PDF, JPG, PNG, DOC, XLS</p>
              </label>
            )}
          </div>

          <div className="mt-6 flex flex-col items-end gap-1">
            <div className="flex items-center gap-8 text-[13px] text-[#475467]"><span>Subtotal</span><span className="min-w-[130px] text-right font-medium text-[#171a2e] tabular-nums">{fmtMoney(subtotal)}</span></div>
            <div className="flex items-center gap-8 text-[13px] text-[#475467]"><span>Tax</span><span className="min-w-[130px] text-right font-medium text-[#171a2e] tabular-nums">{fmtMoney(taxTotal)}</span></div>
            <div className="flex items-center gap-8 text-[16px] font-bold text-[#171a2e] border-t border-[#e2e8f0] pt-2 mt-1"><span>Total</span><span className="min-w-[130px] text-right text-[#003366] tabular-nums">{fmtMoney(grand)}</span></div>
          </div>
        </div>
      </ConfigProvider>

      {canPost && (
        <div className="sticky bottom-0 z-10 mt-6 -mx-1 px-4 py-3 bg-white/95 backdrop-blur border-t border-[#e2e8f0] flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-[#475467]">Total <b className="text-[#003366] text-[15px] ml-1 tabular-nums">{fmtMoney(grand)}</b></div>
          <Space>
            {variant === 'page' && <Button onClick={() => onCancel?.()} disabled={busy}>Cancel</Button>}
            <Button onClick={() => save('draft')} loading={saving} disabled={posting}>{saving ? 'Saving Bill…' : 'Save Draft'}</Button>
            <Dropdown.Button type="primary" icon={<DownOutlined />} loading={posting} disabled={saving}
              onClick={() => save('post')}
              menu={{ items: [
                { key: 'post', label: 'Save & Post', onClick: () => save('post') },
                { key: 'submit', label: 'Submit for Approval', onClick: () => save('submit') },
              ] }}>
              {posting ? 'Posting Bill…' : 'Save & Post'}
            </Dropdown.Button>
          </Space>
        </div>
      )}
      {!canPost && <div className="mt-4 text-[12px] text-[#94a3b8]">You do not have permission to create or post bills.</div>}

      <Modal open={poModalOpen} title="Add from Purchase Order" onCancel={() => setPoModalOpen(false)} footer={null} width={720} destroyOnHidden>
        {eligiblePos.isLoading ? <div className="py-10 text-center text-[#475467]"><Spin /> <span className="ml-2">Loading purchase orders…</span></div> : (
          <>
            <Table rowKey="id" size="small" dataSource={eligiblePos.data || []} pagination={false} columns={[
              { title: 'PO No', dataIndex: 'poNo', width: 130 },
              { title: 'Date', dataIndex: 'orderDate', render: (v) => dayjs(v).format('YYYY-MM-DD') },
              { title: 'Remaining to Bill', align: 'right', render: (_v, r: any) => fmtNumber(r.progress?.remainingToBill) },
              { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => fmtMoney(v) },
              { title: '', width: 90, render: (_v, r: any) => <Button type="primary" size="small" onClick={() => addFromPo(r.id)}>Add</Button> },
            ]} />
            {!(eligiblePos.data || []).length && <div className="text-center text-[#64748b] py-8">No open purchase orders with a remaining billable balance for this supplier.</div>}
          </>
        )}
      </Modal>
    </div>
  );
}
