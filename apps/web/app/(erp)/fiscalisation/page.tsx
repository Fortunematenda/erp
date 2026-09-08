'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Col, DatePicker, Drawer, Empty, Input, InputNumber, Row, Select, Space, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ReloadOutlined, SettingOutlined, CloudServerOutlined, CalendarOutlined, FileDoneOutlined, DollarOutlined,
  WarningOutlined, CheckCircleOutlined, ClockCircleOutlined, FileTextOutlined, PlayCircleOutlined,
  SyncOutlined, VerticalAlignTopOutlined, DownloadOutlined, WalletOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { StatusPill, EmptyState } from '@/components/sales-ui';
import { StatCard } from '@/components/stat-card';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';

const { RangePicker } = DatePicker;

const DOC_TYPES = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'];
const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK', 'MOBILE_MONEY', 'CREDIT', 'CHEQUE', 'OTHER'];
const FISCAL_STATUSES = ['READY', 'PENDING', 'SUBMITTED', 'FISCALISED', 'RETRY', 'REJECTED'];

export default function Fiscalisation() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['fiscal-config'], queryFn: () => api('/fiscalisation/config') });
  const dashboard = useQuery({ queryKey: ['fiscal-dashboard'], queryFn: () => api('/fiscalisation/dashboard') });
  const ready = useQuery({ queryKey: ['fiscal-ready'], queryFn: () => api('/fiscalisation/ready') });
  const devices = useQuery({ queryKey: ['fiscal-devices'], queryFn: () => api('/fiscalisation/devices') });
  const receipts = useQuery({ queryKey: ['fiscal-receipts'], queryFn: () => api('/fiscalisation/receipts') });
  const days = useQuery({ queryKey: ['fiscal-days'], queryFn: () => api('/fiscalisation/days') });
  const reconciliation = useQuery({ queryKey: ['fiscal-recon'], queryFn: () => api('/fiscalisation/reconciliation') });
  const currencies = useQuery({ queryKey: ['currencies'], queryFn: () => api('/finance/currencies') });

  const [tab, setTab] = useState('dashboard');
  const [busy, setBusy] = useState(false);
  const [selReceipt, setSelReceipt] = useState<any>(null);
  const [selDay, setSelDay] = useState<any>(null);
  const [fiscalIdle, setFiscalIdle] = useState<any>(null);

  // ready queue filters
  const [fSearch, setFSearch] = useState('');
  const [fType, setFType] = useState('');
  const [fCur, setFCur] = useState('');
  const [fPay, setFPay] = useState('');
  // receipts filters
  const [rFrom, setRFrom] = useState<any>(null);
  const [rTo, setRTo] = useState<any>(null);
  const [rType, setRType] = useState('');
  const [rStatus, setRStatus] = useState('');
  const [rStatusTab, setRStatusTab] = useState('all');

  const mode = config.data?.mode || 'mock';
  const dev = dashboard.data?.device;
  const isOpen = dashboard.data?.fiscalDay?.status === 'OPEN';
  const activeReady = ready.data;

  const readyDocs = useMemo(() => {
    const invoices = (activeReady?.invoices || []).map((i: any) => ({ ...i, source: 'INVOICE' }));
    const cns = (activeReady?.creditNotes || []).map((c: any) => ({ ...c, source: 'CREDIT_NOTE' }));
    const dns = (activeReady?.debitNotes || []).map((d: any) => ({ ...d, source: 'DEBIT_NOTE' }));
    return [...invoices, ...cns, ...dns].filter((r) => {
      if (fSearch && !`${r.docNo} ${r.customer || ''}`.toLowerCase().includes(fSearch.toLowerCase())) return false;
      if (fType && r.documentType !== fType) return false;
      if (fCur && r.currency !== fCur) return false;
      return true;
    });
  }, [activeReady, fSearch, fType, fCur]);

  const docTypeMap: Record<string, { label: string; color: string }> = { INVOICE: { label: 'Invoice', color: 'blue' }, CREDIT_NOTE: { label: 'Credit Note', color: 'orange' }, DEBIT_NOTE: { label: 'Debit Note', color: 'red' } };

  function refresh() { ['fiscal-dashboard', 'fiscal-ready', 'fiscal-devices', 'fiscal-receipts', 'fiscal-days', 'fiscal-recon', 'fiscal-reports'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
  async function act(path: string, body?: any, msg = 'Done') { try { await api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }); message.success(msg); refresh(); } catch (e: any) { message.error(e.message); } }
  async function fiscaliseDoc(doc: any) {
    const path = doc.source === 'INVOICE' ? `fiscalise` : doc.source === 'CREDIT_NOTE' ? `fiscalise-credit-note` : `fiscalise-debit-note`;
    const key = doc.source === 'INVOICE' ? 'invoiceId' : doc.source === 'CREDIT_NOTE' ? 'creditNoteId' : 'debitNoteId';
    try { await api(`/fiscalisation/devices/${dev?.id}/${path}`, { method: 'POST', body: JSON.stringify({ [key]: doc.id }) }); message.success(`${doc.docNo} fiscalised`); refresh(); } catch (e: any) { message.error(e.message); }
  }

  const receiptCols: ColumnsType<any> = [
    { title: 'Receipt #', width: 110, render: (_v, r: any) => <button className="text-[#1d5fb5] hover:underline" onClick={() => setSelReceipt(r)}>RCP-{String(r.globalReceiptNo).padStart(6, '0')}</button> },
    { title: 'Global #', dataIndex: 'globalReceiptNo', width: 80 },
    { title: 'Day', dataIndex: 'fiscalDayNo', width: 60, render: (v) => `#${v}` },
    { title: 'Document', width: 120, render: (_v, r: any) => r.invoice?.invoiceNo || r.creditNote?.creditNoteNo || r.debitNote?.debitNoteNo || '—' },
    { title: 'Type', dataIndex: 'receiptType', width: 130, render: (v) => <Tag color="blue">{v.replace('Fiscal', '')}</Tag> },
    { title: 'Customer', width: 130, render: (_v, r: any) => r.customerName || '—' },
    { title: 'Date', dataIndex: 'createdAt', width: 150, render: (v) => <span className="text-[12px]">{fmtDateTime(v)}</span> },
    { title: 'Currency', dataIndex: 'currency', width: 80 },
    { title: 'Payment', dataIndex: 'paymentMethod', width: 100 },
    { title: 'Total', dataIndex: 'total', width: 90, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'VAT', dataIndex: 'tax', width: 80, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusPill status={v} /> },
  ];

  const dayCols: ColumnsType<any> = [
    { title: 'Fiscal Day', dataIndex: 'dayNo', width: 90, render: (v, r) => <button className="text-[#1d5fb5] hover:underline font-medium" onClick={() => setSelDay(r)}>#{v}</button> },
    { title: 'Device', dataIndex: 'device', width: 120 },
    { title: 'Opened', dataIndex: 'openedAt', width: 160, render: (v) => fmtDateTime(v) },
    { title: 'Closed', dataIndex: 'closedAt', width: 160, render: (v) => fmtDateTime(v) },
    { title: 'Receipts', dataIndex: 'receiptCount', width: 90, align: 'right' },
    { title: 'Gross', dataIndex: 'gross', width: 100, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'VAT', dataIndex: 'vat', width: 100, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Credit Notes', dataIndex: 'creditNotes', width: 110, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Status', dataIndex: 'status', width: 90, render: (v) => <StatusPill status={v} /> },
    { title: 'Actions', width: 80, align: 'right', render: (_v, r) => <Button size="small" onClick={() => setSelDay(r)}>View</Button> },
  ];

  const reconCols: ColumnsType<any> = [
    { title: 'Document', dataIndex: 'docNo', width: 130 },
    { title: 'Type', dataIndex: 'docType', width: 90 },
    { title: 'Posted', dataIndex: 'postedAmount', width: 110, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Fiscal', dataIndex: 'fiscalAmount', width: 110, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Difference', dataIndex: 'difference', width: 110, align: 'right', render: (v) => <span className={Number(v) ? 'text-[#e11d48]' : 'text-[#16a34a]'}>{fmtMoney(v)}</span> },
    { title: 'Fiscal Status', dataIndex: 'fiscalStatus', width: 140, render: (v) => <StatusPill status={v} /> },
  ];

  const recon = reconciliation.data || [];
  const reconTotals = useMemo(() => ({ posted: recon.reduce((s: any, r: any) => s + Number(r.postedAmount), 0), fiscal: recon.reduce((s: any, r: any) => s + Number(r.fiscalAmount), 0), diff: recon.reduce((s: any, r: any) => s + Number(r.difference), 0), unfiscalised: recon.filter((r: any) => r.fiscalStatus === 'NOT_FISCALISED').length }), [recon]);

  const d = dashboard.data || {};
  const today = d.today || {};
  const attention = d.needsAttention || {};

  const receiptsFiltered = useMemo(() => (receipts.data || []).filter((r: any) => {
    if (rStatusTab === 'failed' && !['RETRY', 'REJECTED'].includes(r.status)) return false;
    if (rStatusTab === 'success' && r.status !== 'FISCALISED') return false;
    if (rFrom && new Date(r.createdAt) < rFrom) return false;
    if (rTo && new Date(r.createdAt) > rTo) return false;
    if (rType && r.receiptType !== rType) return false;
    if (rStatus && r.status !== rStatus) return false;
    return true;
  }), [receipts.data, rStatusTab, rFrom, rTo, rType, rStatus]);

  const reportTotals = useMemo(() => ({
    receipts: receiptsFiltered.length,
    gross: receiptsFiltered.reduce((s: any, r: any) => s + Number(r.total || 0), 0),
    vat: receiptsFiltered.reduce((s: any, r: any) => s + Number(r.tax || 0), 0),
  }), [receiptsFiltered]);

  const byType = useMemo(() => Object.entries(countBy(receiptsFiltered, (r: any) => r.receiptType.replace('Fiscal', ''))).map(([key, count]) => ({ key, count })), [receiptsFiltered]);
  const byPayment = useMemo(() => Object.entries(countBy(receiptsFiltered, (r: any) => r.paymentMethod || 'CASH')).map(([key, count]) => ({ key, count })), [receiptsFiltered]);
  const byCurrency = useMemo(() => {
    const acc: Record<string, { currency: string; count: number; gross: number }> = {};
    for (const r of receiptsFiltered) { const c = r.currency || 'USD'; const e = acc[c] || (acc[c] = { currency: c, count: 0, gross: 0 }); e.count++; e.gross += Number(r.total || 0); }
    return Object.values(acc);
  }, [receiptsFiltered]);

  function exportCsv() {
    const rows = [
      ['Receipt #', 'Global #', 'Day', 'Document', 'Type', 'Currency', 'Payment', 'Total', 'VAT', 'Status'],
      ...receiptsFiltered.map((r: any) => ['RCP-' + String(r.globalReceiptNo).padStart(6, '0'), r.globalReceiptNo, r.fiscalDayNo, r.invoice?.invoiceNo || r.creditNote?.creditNoteNo || r.debitNote?.debitNoteNo || '', r.receiptType, r.currency || 'USD', r.paymentMethod || '', Number(r.total || 0), Number(r.tax || 0), r.status]),
    ];
    const csv = rows.map((row: any) => row.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fiscal-receipts.csv'; a.click();
  }

  const renderDayDrawer = () => (
    <Drawer open={!!selDay} title={`Fiscal Day #${selDay?.dayNo ?? ''}`} onClose={() => setSelDay(null)} width={820} destroyOnHidden extra={<Button onClick={() => setSelDay(null)}>Close</Button>}>
      {selDay && (
        <div>
          <div className="flex flex-wrap gap-2 mb-4"><StatusPill status={selDay.status} /></div>
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div className="nex-card p-4"><div className="text-[12px] text-[#64748b]">Opened</div><div className="text-[14px] font-semibold">{fmtDateTime(selDay.openedAt)}</div></div>
            <div className="nex-card p-4"><div className="text-[12px] text-[#64748b]">Closed</div><div className="text-[14px] font-semibold">{selDay.closedAt ? fmtDateTime(selDay.closedAt) : '—'}</div></div>
            <div className="nex-card p-4"><div className="text-[12px] text-[#64748b]">Device</div><div className="text-[14px] font-semibold">{selDay.device}</div></div>
            <div className="nex-card p-4"><div className="text-[12px] text-[#64748b]">Branch</div><div className="text-[14px] font-semibold">{selDay.branch}</div></div>
          </div>
        </div>
      )}
    </Drawer>
  );

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">ZIMRA Fiscalisation</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Virtual fiscal device, fiscal days and receipt management</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={mode === 'mock' ? 'MOCK' : 'LIVE'} tone={mode === 'mock' ? 'amber' : 'green'} />
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
          <Button icon={<SettingOutlined />} onClick={() => (window.location.href = '/administration/integrations-config')}>Configuration</Button>
        </div>
      </div>

      {mode === 'mock' && (
        <div className="flex items-start gap-3 bg-[#fff7ed] border border-[#fed7aa] rounded-lg px-4 py-3 mb-5">
          <WarningOutlined className="text-[#f59e0b] mt-0.5" />
          <div><div className="text-[13px] font-semibold text-[#9a3412]">Development / Mock Mode</div><div className="text-[12px] text-[#b45309]">Fiscalisation requests are being simulated locally. No live ZIMRA transmission is occurring.</div></div>
        </div>
      )}

      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'dashboard', label: 'Dashboard', children: (
          <div className="space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={<CloudServerOutlined />} label="Device Status" value={dev?.connection || '—'} hint={dev?.name} />
              <StatCard icon={<CalendarOutlined />} label="Fiscal Day" value={isOpen ? `#${d.fiscalDay?.dayNo}` : 'CLOSED'} hint={isOpen ? 'OPEN' : 'No open day'} />
              <StatCard icon={<FileDoneOutlined />} label="Receipts Today" value={today.receipts ?? 0} hint="Today" />
              <StatCard icon={<DollarOutlined />} label="VAT Today" value={fmtMoney(today.vat)} hint="Tax collected" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={<FileTextOutlined />} label="Last Fiscal Day" value={d.lastClosedDay ? `#${d.lastClosedDay.dayNo}` : '—'} hint={d.lastClosedDay?.closedAt ? fmtDate(d.lastClosedDay.closedAt) : 'No closed day'} />
              <StatCard icon={<FileDoneOutlined />} label="Last Receipt" value={d.lastReceipt?.receiptNo || '—'} hint={d.lastReceipt ? fmtDate(d.lastReceipt.createdAt) : ''} />
              <StatCard icon={<SyncOutlined />} label="Failed / Retry" value={d.failed ?? 0} hint="Awaiting retry" />
              <StatCard icon={<CheckCircleOutlined />} label="Certificate" value={dev?.certificateStatus || 'UNKNOWN'} hint={dev?.certificateExpiresAt ? `expires ${fmtDate(dev.certificateExpiresAt)}` : '—'} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="nex-card p-5">
                <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Fiscal Operations</div>
                {dev ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[13px]"><span className="text-[#64748b]">Device</span><span className="font-medium text-[#171a2e]">{dev.name}</span></div>
                    <div className="flex items-center justify-between text-[13px]"><span className="text-[#64748b]">Branch</span><span className="font-medium text-[#171a2e]">{dev.branch}</span></div>
                    <div className="flex items-center justify-between text-[13px]"><span className="text-[#64748b]">Connection</span><StatusPill status={dev.connection} /></div>
                    <div className="flex items-center justify-between text-[13px]"><span className="text-[#64748b]">Fiscal Day</span><span className="font-medium text-[#171a2e]">#{dev.fiscalDayNo} · {dev.dayStatus}</span></div>
                    <div className="flex items-center justify-between text-[13px]"><span className="text-[#64748b]">Daily Receipt</span><span className="font-medium text-[#171a2e]">{dev.receiptCounter}</span></div>
                    <div className="flex items-center justify-between text-[13px]"><span className="text-[#64748b]">Global Receipt</span><span className="font-medium text-[#171a2e]">{dev.globalReceiptNo}</span></div>
                    <div className="flex items-center justify-between text-[13px]"><span className="text-[#64748b]">Certificate</span><StatusPill status={dev.certificateStatus} /></div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {!isOpen && <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => act(`/fiscalisation/devices/${dev.id}/open-day`, undefined, 'Fiscal day opened')}>Open Fiscal Day</Button>}
                      {isOpen && <Button danger icon={<VerticalAlignTopOutlined />} onClick={() => act(`/fiscalisation/devices/${dev.id}/close-day`, undefined, 'Fiscal day closed')}>Close Fiscal Day</Button>}
                      {dev.status === 'UNREGISTERED' && <Button onClick={() => act(`/fiscalisation/devices/${dev.id}/register`, undefined, 'Device registered')}>Register Device</Button>}
                      <Button icon={<SyncOutlined />} loading={busy} onClick={() => act('/fiscalisation/retry', undefined, 'Retried')}>Retry Failed</Button>
                    </div>
                  </div>
                ) : <EmptyState title="No fiscal device" description="Configure a device to get started." />}
              </div>
              <div className="nex-card p-5">
                <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Needs Attention</div>
                <div className="space-y-3">
                  <button className="w-full text-left flex items-center justify-between" onClick={() => setTab('fiscalisation')}><span className="text-[13px] text-[#344054]"><WarningOutlined className="text-[#e11d48] mr-2" />Failed fiscal transactions</span><span className={`font-bold ${attention.failed ? 'text-[#e11d48]' : 'text-[#16a34a]'}`}>{attention.failed || 0}</span></button>
                  <button className="w-full text-left flex items-center justify-between" onClick={() => setTab('fiscalisation')}><span className="text-[13px] text-[#344054]"><FileTextOutlined className="text-[#f59e0b] mr-2" />Posted awaiting fiscalisation</span><span className="font-bold text-[#171a2e]">{attention.pendingFiscalise || 0}</span></button>
                  <div className="flex items-center justify-between text-[13px]"><span className="text-[#344054]"><CheckCircleOutlined className="text-[#16a34a] mr-2" />Certificate expiry</span><span className={`font-bold ${attention.certificateDays != null && attention.certificateDays < 30 ? 'text-[#e11d48]' : 'text-[#171a2e]'}`}>{dev?.certificateStatus}</span></div>
                  <div className="flex items-center justify-between text-[13px]"><span className="text-[#344054]"><ClockCircleOutlined className="text-[#0ea5e9] mr-2" />Fiscal day open hours</span><span className="font-bold text-[#171a2e]">{attention.dayOpenHours} h</span></div>
                </div>
                <div className="text-[13px] font-semibold text-[#171a2e] mt-5 mb-2">Recent Fiscal Activity</div>
                <div className="space-y-1.5">
                  {(receipts.data || []).slice(0, 5).map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between text-[12px] py-1 border-b border-[#f0f1f6] last:border-0">
                      <span className="text-[#94a3b8]">{fmtDateTime(r.createdAt).slice(11, 16)}</span>
                      <span className="text-[#171a2e] font-medium">{r.invoice?.invoiceNo || r.creditNote?.creditNoteNo || r.debitNote?.debitNoteNo || '—'}</span>
                      <StatusPill status={r.status} />
                      <span className="text-[#171a2e]">{fmtMoney(r.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) },
        { key: 'fiscalisation', label: 'Fiscalisation', children: (
          <div className="p-4">
            {!isOpen && <div className="text-center py-6 mb-4 border border-[#ffe4e6] bg-[#fff1f2] rounded-lg">{`No open fiscal day. Open a fiscal day before fiscalising documents.`}<div className="mt-3"><Button type="primary" icon={<PlayCircleOutlined />} onClick={() => act(`/fiscalisation/devices/${dev?.id}/open-day`, undefined, 'Fiscal day opened')}>Open Fiscal Day</Button></div></div>}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Input allowClear placeholder="Search document / customer..." value={fSearch} onChange={(e) => setFSearch(e.target.value)} style={{ width: 200 }} />
              <Select allowClear placeholder="Type" style={{ width: 130 }} value={fType || undefined} onChange={(v) => setFType(v || '')} options={DOC_TYPES.map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} />
              <Select allowClear placeholder="Currency" style={{ width: 110 }} value={fCur || undefined} onChange={(v) => setFCur(v || '')} options={(currencies.data || []).concat([{ code: 'USD' }]).filter((c: any, i: number, a: any[]) => a.findIndex((x: any) => x.code === c.code) === i).map((c: any) => ({ label: c.code, value: c.code }))} />
            </div>
            {readyDocs.length ? <Table rowKey="id" loading={ready.isLoading} dataSource={readyDocs} pagination={{ pageSize: 12 }} columns={[
              { title: 'Document', width: 130, render: (_v, r: any) => <span className="font-medium text-[#171a2e]">{r.docNo}</span> },
              { title: 'Type', width: 120, render: (_v, r: any) => <Tag color={docTypeMap[r.documentType]?.color}>{docTypeMap[r.documentType]?.label}</Tag> },
              { title: 'Customer', width: 160, render: (_v, r: any) => r.customer || 'Walk-in' },
              { title: 'Date', width: 120, render: (_v, r: any) => fmtDate(r.date) },
              { title: 'Currency', width: 80, render: (_v, r: any) => r.currency },
              { title: 'Total', width: 100, align: 'right', render: (_v, r: any) => fmtMoney(r.total) },
              { title: 'VAT', width: 90, align: 'right', render: (_v, r: any) => fmtMoney(r.tax) },
              { title: 'Status', width: 110, render: (_v, r: any) => <StatusPill status={r.fiscalStatus || 'READY'} /> },
              { title: 'Actions', width: 110, align: 'right', render: (_v, r: any) => <Button size="small" type="primary" disabled={!isOpen || !dev} onClick={() => fiscaliseDoc(r)}>Fiscalise</Button> },
            ]} /> : <EmptyState title="No documents to fiscalise" description="Posted documents that are ready for fiscalisation will appear here." />}
          </div>
        ) },
        { key: 'receipts', label: `Fiscal Receipts (${receipts.data?.length || 0})`, children: (
          <div className="p-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <StatCard icon={<FileDoneOutlined />} label="Total Receipts" value={reportTotals.receipts} color="#1d5fb5" />
              <StatCard icon={<DollarOutlined />} label="Gross Amount" value={fmtMoney(reportTotals.gross)} color="#16a34a" />
              <StatCard icon={<WalletOutlined />} label="Total VAT" value={fmtMoney(reportTotals.vat)} color="#f59e0b" />
              <StatCard icon={<SyncOutlined />} label="Failed" value={receipts.data?.filter((r: any) => ['RETRY', 'REJECTED'].includes(r.status)).length ?? 0} color="#e11d48" />
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <RangePicker value={rFrom && rTo ? [rFrom, rTo] : null} onChange={(v) => { setRFrom(v?.[0]?.toDate()); setRTo(v?.[1]?.toDate()); }} />
              <Select allowClear placeholder="Receipt type" style={{ width: 150 }} value={rType || undefined} onChange={(v) => setRType(v || '')} options={['FiscalInvoice', 'FiscalCreditNote', 'FiscalDebitNote'].map((t) => ({ label: t.replace('Fiscal', ''), value: t }))} />
              <Select allowClear placeholder="Payment" style={{ width: 130 }} value={fPay || undefined} onChange={(v) => setFPay(v || '')} options={PAYMENT_METHODS.map((p) => ({ label: p, value: p }))} />
              <Select allowClear placeholder="Status" style={{ width: 130 }} value={rStatus || undefined} onChange={(v) => setRStatus(v || '')} options={FISCAL_STATUSES.map((s) => ({ label: s, value: s }))} />
              <Button icon={<ReloadOutlined />} onClick={() => { setRFrom(null); setRTo(null); setRType(''); setFPay(''); setRStatus(''); }}>Clear</Button>
              <Button icon={<DownloadOutlined />} onClick={exportCsv}>Export</Button>
            </div>
            <Tabs activeKey={rStatusTab} onChange={setRStatusTab} items={[
              { key: 'all', label: 'All', children: <Table rowKey="id" loading={receipts.isLoading} dataSource={receiptsFiltered} columns={receiptCols} pagination={{ pageSize: 12 }} /> },
              { key: 'success', label: 'Fiscalised', children: <Table rowKey="id" loading={receipts.isLoading} dataSource={receiptsFiltered} columns={receiptCols} pagination={{ pageSize: 12 }} /> },
              { key: 'failed', label: 'Failed', children: receiptsFiltered.length ? <Table rowKey="id" loading={receipts.isLoading} dataSource={receiptsFiltered} columns={receiptCols} pagination={{ pageSize: 12 }} /> : <EmptyState title="No failed receipts." /> },
            ]} />
          </div>
        ) },
        { key: 'days', label: `Fiscal Days (${days.data?.length || 0})`, children: (
          <div className="p-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <StatCard icon={<CalendarOutlined />} label="Current Day" value={isOpen ? `#${d.fiscalDay?.dayNo || dev?.fiscalDayNo}` : 'None'} color="#1d5fb5" />
              <StatCard icon={<FileTextOutlined />} label="Last Closed Day" value={d.lastClosedDay ? `#${d.lastClosedDay.dayNo}` : '—'} color="#16a34a" />
              <StatCard icon={<FileDoneOutlined />} label="Today's Receipts" value={today.receipts ?? 0} color="#0ea5e9" />
              <StatCard icon={<DollarOutlined />} label="Today's Gross" value={fmtMoney(today.gross)} color="#f59e0b" />
            </div>
            <Table rowKey="id" loading={days.isLoading} dataSource={days.data || []} columns={dayCols} pagination={{ pageSize: 12 }} />
          </div>
        ) },
        { key: 'reports', label: 'Reports', children: (
          <div className="p-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <StatCard icon={<FileDoneOutlined />} label="Total Receipts" value={reportTotals.receipts} color="#1d5fb5" />
              <StatCard icon={<DollarOutlined />} label="Total Amount" value={fmtMoney(reportTotals.gross)} color="#16a34a" />
              <StatCard icon={<WalletOutlined />} label="Total VAT" value={fmtMoney(reportTotals.vat)} color="#f59e0b" />
              <StatCard icon={<CalendarOutlined />} label="Date Range" value={rFrom && rTo ? `${fmtDate(rFrom.toISOString())} – ${fmtDate(rTo.toISOString())}` : 'All time'} color="#64748b" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
              <div className="nex-card p-4">
                <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Receipt Types Distribution</div>
                {byType.length ? <div className="space-y-2">{byType.map((b) => <div key={b.key} className="flex items-center justify-between text-[13px]"><span className="text-[#344054]">{b.key}</span><span className="font-medium text-[#171a2e]">{b.count}</span></div>)}</div> : <div className="text-[13px] text-[#94a3b8]">No fiscal receipts in the selected period.</div>}
              </div>
              <div className="nex-card p-4">
                <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Payment Method Distribution</div>
                {byPayment.length ? <div className="space-y-2">{byPayment.map((b) => <div key={b.key} className="flex items-center justify-between text-[13px]"><span className="text-[#344054]">{b.key}</span><span className="font-medium text-[#171a2e]">{b.count}</span></div>)}</div> : <div className="text-[13px] text-[#94a3b8]">No fiscal payments recorded.</div>}
              </div>
            </div>
            {byCurrency.length > 1 && <div className="nex-card p-4 mb-5"><div className="text-[13px] font-semibold text-[#171a2e] mb-3">Currency Distribution</div><Table rowKey="currency" size="small" dataSource={byCurrency} columns={[{ title: 'Currency', dataIndex: 'currency' }, { title: 'Receipts', dataIndex: 'count', align: 'right' }, { title: 'Gross', dataIndex: 'gross', align: 'right', render: (v) => fmtMoney(v) }]} pagination={false} /></div>}
            <div className="nex-card p-4 mb-5">
              <div className="text-[13px] font-semibold text-[#171a2e] mb-3 flex items-center justify-between"><span>Fiscal Receipts</span><Button size="small" icon={<DownloadOutlined />} onClick={exportCsv}>Export CSV</Button></div>
              <Table rowKey="id" size="small" loading={receipts.isLoading} dataSource={receiptsFiltered} columns={receiptCols} pagination={{ pageSize: 12 }} />
            </div>
            <div className="nex-card p-4">
              <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Fiscal vs Posted Sales (Reconciliation)</div>
              <div className="flex flex-wrap gap-4 mb-3 text-[13px]"><span>Posted <b>{fmtMoney(reconTotals.posted)}</b></span><span>Fiscalised <b>{fmtMoney(reconTotals.fiscal)}</b></span><span>Difference <b className={reconTotals.diff ? 'text-[#e11d48]' : 'text-[#16a34a]'}>{fmtMoney(reconTotals.diff)}</b></span><span>Unfiscalised <b>{reconTotals.unfiscalised}</b></span></div>
              <Table rowKey="id" size="small" loading={reconciliation.isLoading} dataSource={recon} columns={reconCols} pagination={{ pageSize: 10 }} />
            </div>
          </div>
        ) },
      ]} />

      <ReceiptDetailDrawer receipt={selReceipt} onClose={() => setSelReceipt(null)} />
      {renderDayDrawer()}
    </div>
  );
}

function countBy(rows: any[], fn: (r: any) => string): Record<string, number> { const acc: Record<string, number> = {}; for (const r of rows) { const k = fn(r) || 'UNKNOWN'; acc[k] = (acc[k] || 0) + 1; } return acc; }

function ReceiptDetailDrawer({ receipt, onClose }: { receipt: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ['fiscal-receipt-history', receipt?.id], queryFn: () => api(`/fiscalisation/receipts/${receipt?.id}/history`), enabled: !!receipt });
  return (
    <Drawer open={!!receipt} title={receipt ? `Receipt RCP-${String(receipt.globalReceiptNo).padStart(6, '0')}` : 'Receipt'} onClose={onClose} width={620} destroyOnHidden
      extra={<Button onClick={onClose}>Close</Button>}>
      {receipt && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2"><StatusPill status={receipt.status} /></div>
          <div className="nex-card p-4 space-y-2">
            <div className="flex justify-between text-[13px]"><span className="text-[#64748b]">Global Receipt</span><b>{receipt.globalReceiptNo}</b></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#64748b]">Fiscal Day</span><b>#{receipt.fiscalDayNo}</b></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#64748b]">Document</span><b>{receipt.invoice?.invoiceNo || receipt.creditNote?.creditNoteNo || receipt.debitNote?.debitNoteNo || '—'}</b></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#64748b]">Date/Time</span><b>{fmtDateTime(receipt.createdAt)}</b></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#64748b]">Customer</span><b>{receipt.customerName || 'Walk-in'}</b></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#64748b]">Payment</span><b>{receipt.paymentMethod || '—'}</b></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#64748b]">Currency</span><b>{receipt.currency}</b></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#64748b]">Subtotal</span><span>{fmtMoney(Number(receipt.total || 0) - Number(receipt.tax || 0))}</span></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#64748b]">VAT</span><span>{fmtMoney(receipt.tax)}</span></div>
            <div className="flex justify-between text-[13px] border-t pt-2"><span className="text-[#171a2e] font-semibold">Total</span><b>{fmtMoney(receipt.total)}</b></div>
          </div>
          {receipt.zimraReceiptId && <div className="nex-card p-4"><div className="text-[12px] text-[#64748b] mb-1">Provider receipt ID</div><div className="text-[13px] font-medium font-mono">{receipt.zimraReceiptId}</div></div>}
          {receipt.rawRequest && <details className="nex-card p-4"><summary className="text-[13px] font-semibold cursor-pointer text-[#171a2e]">Request details (technical)</summary><pre className="mt-2 text-[11px] text-[#64748b] overflow-auto">{JSON.stringify(receipt.rawRequest, null, 2)}</pre></details>}
          {history.data?.length > 0 && <div className="nex-card p-4"><div className="text-[12px] text-[#64748b] mb-2">Attempt history</div><div className="space-y-1.5">{history.data.slice(0, 8).map((l: any) => <div key={l.id} className="flex items-center justify-between text-[12px] py-1 border-b last:border-0"><span className="text-[#64748b]">{fmtDateTime(l.createdAt)}</span><span className="text-[#171a2e]">{l.operation} · {l.status}</span></div>)}</div></div>}
        </div>
      )}
    </Drawer>
  );
}
