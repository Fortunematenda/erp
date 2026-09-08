'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, ColorPicker, Collapse, Divider, Form, Input, InputNumber, Select, Space, Switch, Tabs, Tag, Upload, message } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, RollbackOutlined, CopyOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { api } from '@/lib/api';
import { DocumentPreview, type PreviewVm } from '@/components/documents/document-preview';

const FONTS = ['Inter', 'Arial', 'Helvetica', 'Roboto', 'Georgia', 'Times New Roman', 'System Default'];

export function TemplateDesigner({ type }: { type: 'invoice' | 'quote' }) {
  const qc = useQueryClient();
  const dk = ['/document-templates', type.toUpperCase()];
  const [tpl, setTpl] = useState<Record<string, any> | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<'customize' | 'preview'>('customize');
  const q = useQuery({ queryKey: dk, queryFn: () => api(`/document-templates/${type.toUpperCase()}`) });
  const t = tpl || q.data || {};

  const set = (k: string, v: any) => setTpl((p) => ({ ...(p || (q.data as any) || {}), [k]: v }));
  const p = t.primaryColor || '#003366';
  const isQuote = type === 'quote';

  async function save() { setSaving(true); try { const r = await api(`/document-templates/${type.toUpperCase()}`, { method: 'PUT', body: JSON.stringify(t) }); message.success('Template saved'); setTpl(r); qc.invalidateQueries({ queryKey: dk }); } catch (e: any) { message.error(e.message); } finally { setSaving(false); } }
  async function reset() { try { const r = await api(`/document-templates/${type.toUpperCase()}/reset`, { method: 'POST' }); setTpl(r); message.success('Reset to default'); qc.invalidateQueries({ queryKey: dk }); } catch (e: any) { message.error(e.message); } }
  async function duplicate() { try { const r = await api(`/document-templates/${type.toUpperCase()}/duplicate`, { method: 'POST', body: JSON.stringify({}) }); message.success('Template duplicated'); } catch (e: any) { message.error(e.message); } }

  const sampleVm: PreviewVm = useMemo(() => {
    const base = {
      kind: isQuote ? 'quote' : 'invoice',
      number: isQuote ? 'QT-00001' : 'INV-00001',
      date: '2026-08-24',
      dueDate: '2026-09-08',
      validUntil: '2026-09-23',
      status: isQuote ? 'OPEN' : 'PENDING',
      displayStatus: isQuote ? undefined : 'PENDING',
      displayStatusLabel: isQuote ? undefined : 'PENDING',
      displayStatusColor: isQuote ? undefined : '#f59e0b',
      isFiscalised: !isQuote,
      company: { name: 'ABC Company', address: '12 Main Street, Harare', phone: '+263 000 0000', email: 'billing@abcco.co', tin: '1234567', vatNumber: 'VAT001', website: 'abcco.co' },
      party: { name: 'David MCA', email: 'mca@gmail.com', phone: '+263 771 000 000', address: '123 Street, Gokwe, Zimbabwe' },
      lines: [{ desc: 'Test mango product', qty: 1, unit: 200, tax: 0.2, total: 240, sku: 'MANGO-01' }],
      subtotal: 200, taxTotal: 40, total: 240, paid: 0, balance: 240, notes: 'Please ensure payment is received before dispatch.',
      statementMemo: 'Your statement for the current period is enclosed.',
      fiscalInfo: isQuote ? null : { receiptId: 'MOCK-RCPT-1', dayNo: 1, deviceId: 'DEV-001', status: 'FISCALISED' },
      template: t,
      sample: true,
    } as PreviewVm;
    return base;
  }, [t, isQuote]);

  const Cols = ({ label, children }: any) => <div className="mb-4" style={{ color: '#171a2e' }}><div className="text-[13px] font-medium mb-1.5">{label}</div>{children}</div>;

  const sectionDefs = [
    { key: 'branding', label: 'Branding', body: <div>
      <Cols label="Logo position"><Select className="w-full" value={t.logoPosition} onChange={(v) => set('logoPosition', v)} options={['left', 'centre', 'right'].map((x) => ({ label: x, value: x === 'centre' ? 'center' : x }))} /></Cols>
      <Cols label="Logo size"><Select className="w-full" value={t.logoSize} onChange={(v) => set('logoSize', v)} options={['small', 'medium', 'large'].map((x) => ({ label: x, value: x }))} /></Cols>
      <Cols label="Logo URL"><Input value={t.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://…/logo.png" /></Cols>
      <Multi colour
        fields={[['Primary', 'primaryColor'], ['Secondary', 'secondaryColor'], ['Text', 'textColor'], ['Muted', 'mutedColor'], ['Table header bg', 'tableHeaderColor'], ['Table header text', 'tableHeaderTextColor']]}
        t={t} set={set}
      />
    </div> },
    { key: 'layout', label: 'Layout', body: <div>
      <Cols label="Header layout"><Select className="w-full" value={t.layoutStyle} onChange={(v) => set('layoutStyle', v)} options={['classic', 'modern', 'compact'].map((x) => ({ label: x, value: x }))} /></Cols>
      <Cols label="Table style"><Select className="w-full" value={t.tableStyle} onChange={(v) => set('tableStyle', v)} options={['minimal', 'striped', 'bordered', 'modern'].map((x) => ({ label: x, value: x }))} /></Cols>
      <Cols label="Totals style"><Select className="w-full" value={t.totalsStyle} onChange={(v) => set('totalsStyle', v)} options={['simple', 'boxed', 'highlighted'].map((x) => ({ label: x, value: x }))} /></Cols>
      <Cols label="Density"><Select className="w-full" value={t.density} onChange={(v) => set('density', v)} options={['normal', 'compact', 'comfortable'].map((x) => ({ label: x, value: x }))} /></Cols>
      <Cols label="Font"><Select className="w-full" value={t.fontFamily} onChange={(v) => set('fontFamily', v)} options={FONTS.map((x) => ({ label: x, value: x }))} /></Cols>
      <Cols label="Base font size"><InputNumber className="w-full" min={9} max={20} value={t.baseFontSize} onChange={(v) => set('baseFontSize', v)} /></Cols>
      <Cols label="Customer block layout"><Select className="w-full" value={t.customerBlockLayout} onChange={(v) => set('customerBlockLayout', v)} options={['stacked', 'side-by-side'].map((x) => ({ label: x, value: x }))} /></Cols>
    </div> },
    { key: 'doc', label: isQuote ? 'Document & Validity' : 'Document & Payment', body: <div>
      <Cols label={isQuote ? 'Quotation title' : 'Invoice title'}><Input value={isQuote ? t.quoteTitle : t.invoiceTitle} onChange={(e) => set(isQuote ? 'quoteTitle' : 'invoiceTitle', e.target.value)} /></Cols>
      {isQuote && <Cols label="Prepared-for label"><Input value={t.preparedForLabel} onChange={(e) => set('preparedForLabel', e.target.value)} /></Cols>}
      {isQuote && <>
        <Cols label="Show validity"><Switch checked={t.showValidity !== false} onChange={(v) => set('showValidity', v)} /></Cols>
        <Cols label="Validity message"><Input.TextArea rows={2} value={t.validityMessage} onChange={(e) => set('validityMessage', e.target.value)} /></Cols>
        <Cols label="Validity days"><InputNumber className="w-full" min={1} max={365} value={t.validityDays} onChange={(v) => set('validityDays', v)} /></Cols>
      </>}
      {!isQuote && <>
        <Cols label="Show payment status"><Switch checked={t.showPaymentStatus !== false} onChange={(v) => set('showPaymentStatus', v)} /></Cols>
        <Cols label="Show balance due"><Switch checked={t.showBalanceDue !== false} onChange={(v) => set('showBalanceDue', v)} /></Cols>
        <Cols label="Show payment details"><Switch checked={t.showPaymentDetails !== false} onChange={(v) => set('showPaymentDetails', v)} /></Cols>
        <Cols label="Show fiscal information"><Switch checked={t.showFiscalInformation !== false} onChange={(v) => set('showFiscalInformation', v)} /></Cols>
      </>}
    </div> },
    { key: 'columns', label: 'Line Items', body: <div>
      <Cols label="Visible columns">
        <Space direction="vertical" size={2} className="w-full">
          {[['SKU', 'sku'], ['Description', 'description'], ['Qty', 'qty'], ['Rate', 'unit'], ['Tax', 'tax'], ['Amount', 'amount']].map(([label, key]) => (
            <div key={key} className="flex justify-between items-center w-full"><span>{label}</span><Switch size="small" checked={t[`show${cap(key)}`] !== false} onChange={(v) => set(`show${cap(key)}`, v)} /></div>
          ))}
        </Space>
      </Cols>
      <Cols label="Show delivery address"><Switch checked={t.showDeliveryAddress === true} onChange={(v) => set('showDeliveryAddress', v)} /></Cols>
      {t.showDeliveryAddress && <Cols label="Hide duplicate delivery address"><Switch checked={t.hideDuplicateDeliveryAddress !== false} onChange={(v) => set('hideDuplicateDeliveryAddress', v)} /></Cols>}
    </div> },
    { key: 'notes', label: 'Notes', body: <div>
      <Cols label={isQuote ? 'Show quote notes' : 'Show notes'}><Switch checked={t.showNotes !== false} onChange={(v) => set('showNotes', v)} /></Cols>
      {!isQuote && <Cols label="Show statement memo"><Switch checked={t.showStatementMemo !== false} onChange={(v) => set('showStatementMemo', v)} /></Cols>}
      {isQuote ? <Cols label="Show acceptance section"><Switch checked={t.showAcceptanceSection !== false} onChange={(v) => set('showAcceptanceSection', v)} /></Cols> : null}
    </div> },
    ...(isQuote ? [] : [{ key: 'status', label: 'Invoice Status', body: <div>
      <Cols label="Show status badge (in header)"><Switch checked={t.showStatusBadge !== false} onChange={(v) => set('showStatusBadge', v)} /></Cols>
      <Cols label="Show status stamp"><Switch checked={t.showStatusStamp !== false} onChange={(v) => set('showStatusStamp', v)} /></Cols>
      <Cols label="Stamp style"><Select className="w-full" value={t.stampStyle || 'outlined'} onChange={(v) => set('stampStyle', v)} options={['outlined', 'soft', 'classic'].map((x) => ({ label: x[0].toUpperCase() + x.slice(1), value: x }))} /></Cols>
      <Cols label="Stamp size"><Select className="w-full" value={t.stampSize || 'medium'} onChange={(v) => set('stampSize', v)} options={['small', 'medium', 'large'].map((x) => ({ label: x, value: x }))} /></Cols>
      <Cols label="Stamp position"><Select className="w-full" value={t.stampPosition || 'center'} onChange={(v) => set('stampPosition', v)} options={[{ label: 'Center', value: 'center' }, { label: 'Top Center', value: 'top-center' }, { label: 'Top Right', value: 'top-right' }]} /></Cols>
      <Cols label="Stamp angle"><InputNumber className="w-full" min={-20} max={20} value={t.stampAngle ?? -12} onChange={(v) => set('stampAngle', v)} /></Cols>
      <div className="text-[11px] text-slate-400">Status is always taken live from the invoice (PAID / PART PAID / OVERDUE / PENDING / DRAFT / VOID / FISCALISED); the colour and label are set automatically.</div>
    </div> }]),
    { key: 'terms', label: 'Terms', body: <div>
      <Cols label={isQuote ? 'Quotation terms' : 'Invoice terms'}><Input.TextArea rows={5} value={isQuote ? t.quoteTerms : t.invoiceTerms} onChange={(e) => set(isQuote ? 'quoteTerms' : 'invoiceTerms', e.target.value)} placeholder={isQuote ? 'Prices remain valid for 30 days…' : 'Payment terms…'} /></Cols>
    </div> },
    { key: 'footer', label: 'Footer', body: <div>
      <Cols label={`${isQuote ? 'Quote' : 'Invoice'} footer message`}><Input.TextArea rows={2} value={isQuote ? t.quoteFooterMessage : t.footerMessage} onChange={(e) => set(isQuote ? 'quoteFooterMessage' : 'footerMessage', e.target.value)} /></Cols>
      <Cols label="Footer alignment"><Select className="w-full" value={t.footerAlignment} onChange={(v) => set('footerAlignment', v)} options={['left', 'center', 'right'].map((x) => ({ label: x, value: x }))} /></Cols>
      <Cols label="Show page number"><Switch checked={t.footerShowPageNumber !== false} onChange={(v) => set('footerShowPageNumber', v)} /></Cols>
      <Cols label="Show company contact"><Switch checked={t.footerShowCompanyContact !== false} onChange={(v) => set('footerShowCompanyContact', v)} /></Cols>
    </div> },
  ];

  return (
    <div className="nex-fade">
      <div className="mb-3"><Link href={isQuote ? '/sales/quotations' : '/sales/invoices'}><Button icon={<ArrowLeftOutlined />}>Back</Button></Link></div>
      <Alert className="mb-4" type="info" showIcon message={`Editing the ${isQuote ? 'QUOTATION' : 'INVOICE'} template. ${isQuote ? 'Quote' : 'Invoice'} settings are stored separately and never affect the ${isQuote ? 'invoice' : 'quote'} template.`} />
      <div className="grid grid-cols-5 gap-4">
        {/* Settings (35%) */}
        <div className="col-span-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-[#171a2e]">{isQuote ? 'Quote' : 'Invoice'} Template Designer</h2>
          </div>
          <div className="nex-card p-4">
            <div className="flex gap-2 mb-3">
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>Save Template</Button>
              <Button icon={<RollbackOutlined />} onClick={reset}>Reset</Button>
              <Button icon={<CopyOutlined />} onClick={duplicate}>Duplicate</Button>
            </div>
            <Collapse defaultActiveKey={['branding']} items={sectionDefs.map((s) => ({ key: s.key, label: s.label, children: s.body }))} />
          </div>
        </div>
        {/* Preview (65%) */}
        <div className="col-span-5 lg:col-span-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-[#171a2e]">Live Preview</h2>
            <Select value={page} onChange={setPage} options={[{ label: 'Desktop', value: 'customize' }]} />
          </div>
          <div className="nex-card p-4"><DocumentPreview vm={sampleVm} /></div>
        </div>
      </div>

      <div className="hidden">
        <Upload beforeUpload={() => false} showUploadList={false} onChange={(f: any) => { const r = new FileReader(); r.onload = () => set('logoUrl', r.result as string); r.readAsDataURL(f.file as File); }}><Button icon={<UploadOutlined />}>Upload logo</Button></Upload>
      </div>
    </div>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function Multi({ fields, t, set }: any) {
  return <div className="grid grid-cols-2 gap-3">{fields.map(([label, key]: string[]) => (
    <div key={key}><div className="text-[11px] text-slate-500 mb-1">{label}</div><div className="flex items-center gap-2"><ColorPicker value={t[key] || '#000000'} onChange={(c: any) => set(key, c.toHexString?.() || c.toString())} /><Input value={t[key] || ''} onChange={(e) => set(key, e.target.value)} /></div></div>
  ))}</div>;
}

