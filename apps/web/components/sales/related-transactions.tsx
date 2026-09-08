'use client';
import { RightOutlined } from '@ant-design/icons';
import { fmtMoney } from '@/lib/format';
import Link from 'next/link';

type DocKind = 'quote' | 'order' | 'invoice' | 'payment' | 'credit-note' | 'delivery';
type Step = { kind: DocKind; no: string; id: string; sub?: string };

const LABEL: Record<DocKind, string> = { quote: 'QUOTE', order: 'SALES ORDER', invoice: 'INVOICE', payment: 'PAYMENT', 'credit-note': 'CREDIT NOTE', delivery: 'DELIVERY' };

function hrefFor(k: DocKind, id: string) {
  if (k === 'quote') return `/sales/quotations/${id}/edit`;
  if (k === 'order') return `/sales/orders/${id}/edit`;
  if (k === 'invoice') return `/sales/invoices/${id}/edit`;
  if (k === 'payment') return `/sales/receipts?receipt=${id}`;
  return undefined;
}
function dispStatus(k: DocKind, r: any): string {
  if (k === 'invoice') {
    if ((r.invoiceStatus || r.status) === 'VOID') return 'VOID';
    const p = (r.paymentStatus || '').replace(/_/g, ' ');
    return p || (r.status || '').replace(/_/g, ' ');
  }
  if (k === 'order') return (r.status || '').replace(/_/g, ' ');
  return (r.status || '').replace(/_/g, ' ');
}
function stepFor(k: DocKind, r: any): Step { return { kind: k, no: r.quotationNo || r.orderNo || r.invoiceNo || r.receiptNo || r.creditNoteNo || r.deliveryNo || r.number || '—', id: r.id, sub: dispStatus(k, r) }; }

function invoiceStatus(r: any): string { if ((r.invoiceStatus || r.status) === 'VOID') return 'VOID'; return (r.paymentStatus || '').replace(/_/g, ' ') || (r.status || '').replace(/_/g, ' '); }

function Chain({ steps }: { steps: Step[] }) {
  return (
    <div className="flex items-start flex-wrap gap-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <RightOutlined className="text-[11px] text-[#94a3b8] mt-6" />}
          {hrefFor(s.kind, s.id) ? (
            <Link href={hrefFor(s.kind, s.id)!} className="group inline-flex flex-col rounded-lg border border-[#e6e9f0] bg-white px-3 py-2 hover:border-[#cbd5e8] hover:shadow-sm transition-all min-w-[120px]">
              <span className="text-[10px] uppercase tracking-wide text-[#94a3b8]">{LABEL[s.kind]}</span>
              <span className="text-[12px] font-semibold text-[#003366] group-hover:underline font-mono">{s.no}</span>
              {s.sub && <span className="text-[10.5px] text-[#64748b] mt-0.5">{s.sub}</span>}
            </Link>
          ) : (
            <span className="inline-flex flex-col rounded-lg border border-[#eef0f6] bg-[#fafbfd] px-3 py-2 min-w-[120px]">
              <span className="text-[10px] uppercase tracking-wide text-[#94a3b8]">{LABEL[s.kind]}</span>
              <span className="text-[12px] font-semibold text-[#64748b] font-mono">{s.no}</span>
              {s.sub && <span className="text-[10.5px] text-[#94a3b8] mt-0.5">{s.sub}</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function buildSteps(kind: 'quote' | 'order' | 'invoice', r: any): Step[] {
  const steps: Step[] = [];
  if (kind === 'quote') {
    steps.push(stepFor('quote', r));
    (r.salesOrders || []).forEach((so: any) => steps.push(stepFor('order', so)));
    (r.invoices || []).forEach((i: any) => steps.push(stepFor('invoice', i)));
  } else if (kind === 'order') {
    if (r.quotation) steps.push(stepFor('quote', r.quotation));
    steps.push(stepFor('order', r));
    (r.invoices || []).forEach((i: any) => steps.push(stepFor('invoice', i)));
  } else {
    if (r.sourceQuote) steps.push(stepFor('quote', r.sourceQuote));
    if (r.sourceSalesOrder) steps.push(stepFor('order', r.sourceSalesOrder));
    steps.push(stepFor('invoice', r));
    (r.receipts || []).forEach((p: any) => steps.push(stepFor('payment', p)));
  }
  return steps;
}

function buildRows(kind: 'quote' | 'order' | 'invoice', r: any): { type: string; number: string; status: string; amount: number; href?: string }[] {
  const rows: { type: string; number: string; status: string; amount: number; href?: string }[] = [];
  const money = (n: any) => Number(n || 0);
  if (kind === 'quote') {
    rows.push({ type: 'Quote', number: r.quotationNo, status: (r.status || '').replace(/_/g, ' '), amount: money(r.total), href: hrefFor('quote', r.id) });
    (r.salesOrders || []).forEach((so: any) => rows.push({ type: 'Sales Order', number: so.orderNo, status: (so.status || '').replace(/_/g, ' '), amount: money(so.total), href: hrefFor('order', so.id) }));
    (r.invoices || []).forEach((i: any) => rows.push({ type: 'Invoice', number: i.invoiceNo, status: invoiceStatus(i), amount: money(i.total), href: hrefFor('invoice', i.id) }));
  } else if (kind === 'order') {
    if (r.quotation) rows.push({ type: 'Quote', number: r.quotation.quotationNo, status: (r.quotation.status || '').replace(/_/g, ' '), amount: money(r.quotation.total), href: hrefFor('quote', r.quotation.id) });
    rows.push({ type: 'Sales Order', number: r.orderNo, status: (r.status || '').replace(/_/g, ' '), amount: money(r.total) });
    (r.invoices || []).forEach((i: any) => rows.push({ type: 'Invoice', number: i.invoiceNo, status: invoiceStatus(i), amount: money(i.total), href: hrefFor('invoice', i.id) }));
    (r.deliveryNotes || []).forEach((d: any) => rows.push({ type: 'Delivery', number: d.deliveryNo, status: (d.status || '').replace(/_/g, ' '), amount: 0 }));
  } else {
    if (r.sourceQuote) rows.push({ type: 'Quote', number: r.sourceQuote.quotationNo, status: (r.sourceQuote.status || '').replace(/_/g, ' '), amount: money(r.sourceQuote.total), href: hrefFor('quote', r.sourceQuote.id) });
    if (r.sourceSalesOrder) rows.push({ type: 'Sales Order', number: r.sourceSalesOrder.orderNo, status: (r.sourceSalesOrder.status || '').replace(/_/g, ' '), amount: money(r.sourceSalesOrder.total), href: hrefFor('order', r.sourceSalesOrder.id) });
    rows.push({ type: 'Invoice', number: r.invoiceNo, status: invoiceStatus(r), amount: money(r.total) });
    (r.receipts || []).forEach((p: any) => rows.push({ type: 'Payment', number: p.receiptNo, status: (p.status || 'POSTED').replace(/_/g, ' '), amount: money(p.amount), href: `/sales/receipts?receipt=${p.id}` }));
    (r.creditNotes || []).forEach((c: any) => rows.push({ type: 'Credit Note', number: c.creditNoteNo, status: (c.status || '').replace(/_/g, ' '), amount: money(c.total) }));
    (r.sourceSalesOrder?.deliveryNotes || []).forEach((d: any) => rows.push({ type: 'Delivery', number: d.deliveryNo, status: (d.status || '').replace(/_/g, ' '), amount: 0 }));
  }
  return rows;
}

export function SalesDocumentFlow({ kind, record }: { kind: 'quote' | 'order' | 'invoice'; record: any }) {
  if (!record) return null;
  const steps = buildSteps(kind, record);
  const rows = buildRows(kind, record);
  const noRelations = kind === 'invoice' ? !record.sourceQuote && !record.sourceSalesOrder : kind === 'order' ? !record.quotation : !(record.salesOrders || []).length && !(record.invoices || []).length;
  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#94a3b8] mb-3">Document Flow</div>
        {noRelations ? (
          <div className="text-[13px] text-[#64748b]">{kind === 'invoice' ? 'This invoice was created directly and has no source Quote or Sales Order.' : 'This sales order was created directly.'}</div>
        ) : (
          <Chain steps={steps} />
        )}
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#94a3b8] mb-3">Related Transactions</div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#eef0f6] text-left">
              <th className="py-2 pr-2 text-[11px] font-semibold text-[#94a3b8] uppercase">Type</th>
              <th className="py-2 pr-2 text-[11px] font-semibold text-[#94a3b8] uppercase">Number</th>
              <th className="py-2 pr-2 text-[11px] font-semibold text-[#94a3b8] uppercase">Status</th>
              <th className="py-2 text-[11px] font-semibold text-[#94a3b8] uppercase text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-[#f0f1f6] last:border-b-0">
                <td className="py-2 pr-2 text-[12px] text-[#64748b]">{row.type}</td>
                <td className="py-2 pr-2">
                  {row.href ? <Link href={row.href} className="font-mono text-[#003366] hover:underline">{row.number}</Link> : <span className="font-mono text-[#64748b]">{row.number}</span>}
                </td>
                <td className="py-2 pr-2 text-[12px] text-[#64748b] capitalize">{row.status}</td>
                <td className="py-2 text-[12px] font-medium text-[#171a2e] text-right">{row.amount ? fmtMoney(row.amount) : '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="py-4 text-center text-[13px] text-[#94a3b8]">No related transactions.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Backwards-compatible named exports.
export function FlowIndicator({ kind, record }: { kind: 'quote' | 'order' | 'invoice'; record: any }) {
  return <SalesDocumentFlow kind={kind} record={record} />;
}
export function RelatedTransactions({ kind, record }: { kind: 'quote' | 'order' | 'invoice'; record: any }) {
  return <SalesDocumentFlow kind={kind} record={record} />;
}
