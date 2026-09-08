'use client';
import { useEffect } from 'react';
import { Button, message } from 'antd';
import { MailOutlined, PrinterOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { fmtMoney, fmtDate } from '@/lib/format';

export type PrintDoc = {
  kind: string;
  title: string;
  number: string;
  date?: string;
  dueDate?: string | null;
  currency: string;
  status?: string;
  company?: { name?: string; code?: string; tin?: string; vatNumber?: string };
  party?: { name?: string; address?: string; email?: string; phone?: string } | null;
  lines?: any[];
  subtotal: number;
  taxTotal: number;
  total: number;
  netPay?: number;
  notes?: string | null;
};

const BRAND = '#003366';
const BRAND2 = '#0b4a8f';

export function PrintDocument({ doc, autoPrint = false }: { doc: PrintDoc; autoPrint?: boolean }) {
  const lines = doc.lines || [];
  const money = (v: any) => fmtMoney(Number(v || 0));
  const templateCode = ['invoice', 'quotation', 'statement', 'payslip'].includes(doc.kind) ? doc.kind : null;
  useEffect(() => { if (autoPrint) { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t); } }, [autoPrint]);

  async function emailDoc() {
    if (!doc.party?.email) { message.warning('No email address on this document'); return; }
    try {
      const res = await api(`/delivery/templates/${templateCode}/send`, { method: 'POST', body: JSON.stringify({ to: doc.party.email, data: { party: doc.party.name, number: doc.number, total: money(doc.total), due: doc.dueDate ? fmtDate(doc.dueDate) : '', company: doc.company?.name } }) });
      message.success(`Email ${res.status} — ${res.id}`);
    } catch (e: any) { message.error(e.message); }
  }

  return (
    <div>
      <div className="no-print sticky top-0 z-10 flex gap-2 bg-white/95 p-3 border-b border-slate-200">
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>Print / Save as PDF</Button>
        {templateCode && <Button icon={<MailOutlined />} onClick={emailDoc}>Email</Button>}
        <span className="text-[12px] text-slate-500 self-center">Use your browser's Print dialog and choose "Save as PDF".</span>
      </div>

      <div className="mx-auto max-w-3xl bg-white p-8 print:p-0" style={{ fontFamily: 'Inter, system-ui, sans-serif', color: '#171a2e' }}>
        {/* Header */}
        <div className="flex justify-between gap-8 mb-6">
          <div>
            <div className="text-xl font-bold" style={{ color: BRAND }}>{doc.company?.name || 'NexusERP'}</div>
            {doc.company?.code && <div className="text-[12px] text-slate-500">{doc.company.code}</div>}
            {(doc.company?.tin || doc.company?.vatNumber) && <div className="text-[12px] text-slate-500">TIN {doc.company.tin} {doc.company?.vatNumber ? `· VAT ${doc.company.vatNumber}` : ''}</div>}
          </div>
          <div className="text-right">
            <div className="text-lg font-bold" style={{ color: BRAND }}>{doc.title}</div>
            <div className="text-[13px] text-slate-500">#{doc.number}</div>
            <div className="text-[12px] text-slate-400">Date {doc.date ? fmtDate(doc.date) : '—'}</div>
            {doc.dueDate && <div className="text-[12px] text-slate-400">Due {fmtDate(doc.dueDate)}</div>}
          </div>
        </div>

        {/* Parties */}
        <div className="border rounded-md p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ borderColor: '#dbe2ec' }}>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Bill To</div>
            <div className="text-[14px] font-semibold">{doc.party?.name || '—'}</div>
            {doc.party?.address && <div className="text-[12px] text-slate-500 whitespace-pre-line">{doc.party.address}</div>}
            <div className="text-[12px] text-slate-500">{doc.party?.email}{doc.party?.phone ? ` · ${doc.party.phone}` : ''}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Summary</div>
            <div className="text-[12px] text-slate-600">Subtotal <b> {money(doc.subtotal)}</b></div>
            <div className="text-[12px] text-slate-600">Tax/VAT <b> {money(doc.taxTotal)}</b></div>
            <div className="text-[15px] font-bold" style={{ color: BRAND2 }}>Total {money(doc.total)}</div>
            {doc.netPay != null && <div className="text-[15px] font-bold" style={{ color: BRAND2 }}>Net Pay {money(doc.netPay)}</div>}
          </div>
        </div>

        {/* Lines */}
        <table className="w-full text-[13px] mb-4" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="text-left text-slate-500">
              <th style={{ borderBottom: `2px solid ${BRAND}`, padding: '6px 8px' }}>{doc.kind === 'statement' ? 'Transaction' : 'Description'}</th>
              {doc.kind !== 'statement' && <th style={{ borderBottom: `2px solid ${BRAND}`, padding: '6px 8px' }} className="text-right">Qty</th>}
              <th style={{ borderBottom: `2px solid ${BRAND}`, padding: '6px 8px' }} className="text-right">{doc.kind === 'statement' ? 'Amount' : 'Amount'}</th>
              {doc.kind === 'statement' && <th style={{ borderBottom: `2px solid ${BRAND}`, padding: '6px 8px' }} className="text-right">Balance</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              if (doc.kind === 'statement') {
                return (<tr key={i}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eef', color: '#171a2e' }}>{l.desc}{l.ref ? ` — ${l.ref}` : ''}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eef' }} className="text-right">{l.date ? fmtDate(l.date) : ''}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eef' }} className="text-right font-medium">{money(l.total)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eef' }} className="text-right">{money(l.balance)}</td>
                </tr>);
              }
              return (<tr key={i}>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #eef', color: '#171a2e' }}>{l.desc}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #eef' }} className="text-right text-slate-500">{l.qty}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #eef' }} className="text-right font-medium">{money(l.total)}</td>
              </tr>);
            })}
          </tbody>
        </table>

        <div className="text-[11px] text-slate-400 mt-6 pt-4 border-t border-slate-100">
          {doc.notes && <div className="mb-1">{doc.notes}</div>}
          <div className="text-slate-300">Generated by NexusERP at {new Date().toLocaleString()}</div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}

