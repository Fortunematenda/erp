'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, Popconfirm, Select, Table } from 'antd';
import { notify } from '@/lib/notify';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClockCircleOutlined, DollarOutlined, ExportOutlined, EyeOutlined, FileDoneOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, DeleteOutlined, SettingOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { invoiceDisplayStatus, isInvoiceDraft } from '@/lib/invoice-status';
import { CurrencyValue, CustomerAvatar, EmptyState, FilterBar, StatusPill, SummaryCard } from '@/components/sales-ui';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { letterheadHtml } from '@/components/documents/document-letterhead';

export function InvoicesWorkspace({ customerId, embedded, hideCustomer }: { customerId?: string; embedded?: boolean; hideCustomer?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const list = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices') });
  const devices = useQuery({ queryKey: ['fiscal-devices'], queryFn: () => api('/fiscalisation/devices') });
  const [q, setQ] = useState('');
  const [invStatus, setInvStatus] = useState('');
  const [payStatus, setPayStatus] = useState('');
  const [fiscStatus, setFiscStatus] = useState('');
  const [range, setRange] = useState<any>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function bulkPost() { setBusy(true); try { for (const id of sel) await api(`/sales/invoices/${id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST' }) }).catch(() => {}); notify.success(`Posted ${sel.length}`); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); setSel([]); } catch (e: any) { notify.error(e.message); } finally { setBusy(false); } }
  async function bulkDel() { setBusy(true); try { for (const id of sel) await api(`/sales/invoices/${id}`, { method: 'DELETE' }); notify.success(`Deleted ${sel.length}`); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); setSel([]); } catch (e: any) { notify.error(e.message); } finally { setBusy(false); } }

  const rows = useMemo(() => {
    let r = (Array.isArray(list.data) ? list.data : []).filter((i: any) => i.invoiceStatus !== 'VOID');
    if (customerId) r = r.filter((i: any) => i.customerId === customerId);
    if (q) r = r.filter((i: any) => `${i.invoiceNo} ${i.customer?.name || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (invStatus) r = r.filter((i: any) => i.invoiceStatus === invStatus);
    if (payStatus) r = r.filter((i: any) => i.paymentStatus === payStatus);
    if (fiscStatus) r = r.filter((i: any) => i.fiscalStatus === fiscStatus);
    if (range?.[0] && range?.[1]) r = r.filter((i: any) => dayjs(i.invoiceDate).isAfter(dayjs(range[0])) && dayjs(i.invoiceDate).isBefore(dayjs(range[1]).add(1, 'day')));
    return r;
  }, [list.data, customerId, q, invStatus, payStatus, fiscStatus, range]);

  const exportRows = useMemo(() => (sel.length ? rows.filter((r: any) => sel.includes(r.id)) : rows), [rows, sel]);

  function csvCell(v: any) {
    const s = String(v ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  }

  function escapeHtml(v: any) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function refreshList() {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['/sales/invoices'] }),
        list.refetch(),
      ]);
      notify.success('Invoice list refreshed');
    } catch (e: any) {
      notify.error(e?.message || 'Could not refresh');
    } finally {
      setRefreshing(false);
    }
  }

  function exportCsv() {
    if (!exportRows.length) {
      notify.warning('No invoices to export');
      return;
    }
    const header = ['Invoice #', 'Customer', 'Date', 'Due Date', 'Amount', 'Balance', 'Status'];
    const lines = exportRows.map((i: any) => [
      i.invoiceNo,
      i.customer?.name || '',
      i.invoiceDate ? dayjs(i.invoiceDate).format('YYYY-MM-DD') : '',
      i.dueDate ? dayjs(i.dueDate).format('YYYY-MM-DD') : '',
      Number(i.total || 0).toFixed(2),
      isInvoiceDraft(i) ? '' : Number(i.balanceDue != null ? i.balanceDue : 0).toFixed(2),
      invoiceDisplayStatus(i),
    ].map(csvCell).join(','));
    const csv = `\uFEFF${[header.map(csvCell).join(','), ...lines].join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoices-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify.success(
      sel.length
        ? `Downloaded ${exportRows.length} selected invoice${exportRows.length === 1 ? '' : 's'} as CSV`
        : `Downloaded ${exportRows.length} invoice${exportRows.length === 1 ? '' : 's'} as CSV`,
    );
  }

  /** Print via hidden iframe — no browser pop-up window (Xero/QB style). Always includes company letterhead. */
  async function printList() {
    if (!rows.length) {
      notify.warning('No invoices to print');
      return;
    }
    let letterhead = '';
    try {
      const [tpl, prefs] = await Promise.all([
        api('/document-templates/INVOICE').catch(() => ({})),
        api('/system/preferences').catch(() => ({})),
      ]);
      const company = {
        name: prefs?.companyName || tpl?.companyName || 'Company',
        address: prefs?.address || '',
        phone: prefs?.phone || '',
        email: prefs?.email || '',
        tin: '',
        vatNumber: '',
      };
      letterhead = letterheadHtml(company, {
        ...(tpl || {}),
        logoUrl: tpl?.logoUrl || prefs?.logo || null,
        pdfHeader: prefs?.pdfHeader || null,
        primaryColor: tpl?.primaryColor || '#003366',
        mutedColor: tpl?.mutedColor || '#6b7280',
      });
    } catch {
      letterhead = letterheadHtml({ name: 'Company' }, { primaryColor: '#003366' });
    }
    const body = rows.map((i: any) => `<tr>
      <td>${escapeHtml(i.invoiceNo)}</td>
      <td>${escapeHtml(i.customer?.name || '—')}</td>
      <td>${i.invoiceDate ? dayjs(i.invoiceDate).format('DD MMM YYYY') : '—'}</td>
      <td>${i.dueDate ? dayjs(i.dueDate).format('DD MMM YYYY') : '—'}</td>
      <td style="text-align:right">${Number(i.total || 0).toFixed(2)}</td>
      <td style="text-align:right">${isInvoiceDraft(i) ? '—' : Number(i.balanceDue != null ? i.balanceDue : 0).toFixed(2)}</td>
      <td>${escapeHtml(invoiceDisplayStatus(i))}</td>
    </tr>`).join('');
    const html = `<!doctype html><html><head><title>Invoices</title>
      <style>
        body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;padding:24px;margin:0}
        h1{font-size:18px;margin:0 0 4px;color:#003366}
        .meta{font-size:12px;color:#64748b;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border-bottom:1px solid #e2e8f0;padding:8px 6px;text-align:left}
        th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
        @media print{body{padding:12px}}
      </style></head><body>
      ${letterhead}
      <div style="height:2px;background:#003366;margin:8px 0 16px"></div>
      <h1>Invoices</h1>
      <div class="meta">${rows.length} invoice${rows.length === 1 ? '' : 's'} · ${dayjs().format('DD MMM YYYY HH:mm')}</div>
      <table><thead><tr>
        <th>Invoice #</th><th>Customer</th><th>Date</th><th>Due</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th><th>Status</th>
      </tr></thead><tbody>${body}</tbody></table>
    </body></html>`;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Print invoices');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      notify.error('Could not open the print dialog. Try again, or use Export to download a CSV.');
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const win = iframe.contentWindow;
    const cleanup = () => { try { iframe.remove(); } catch { /* ignore */ } };
    const runPrint = () => {
      try {
        win?.focus();
        win?.print();
      } catch {
        notify.error('Could not open the print dialog. Try again, or use Export to download a CSV.');
      } finally {
        setTimeout(cleanup, 1000);
      }
    };
    // Give the iframe a tick to layout before printing
    setTimeout(runPrint, 50);
  }

  const totals = useMemo(() => {
    let total = 0, paid = 0, unpaid = 0, overdue = 0, drafts = 0;
    for (const i of rows) {
      if (isInvoiceDraft(i)) { drafts += 1; continue; } // drafts are not AR (Xero/QB)
      total += Number(i.total || 0);
      paid += Number(i.amountPaid || 0);
      const bal = Number(i.balanceDue != null ? i.balanceDue : (Number(i.total || 0) - Number(i.amountPaid || 0)));
      unpaid += bal;
      if (i.invoiceStatus === 'POSTED' && bal > 0 && i.dueDate && dayjs(i.dueDate).isBefore(dayjs(), 'day')) overdue += bal;
    }
    return { total, paid, unpaid, overdue, drafts, count: rows.length, paidCount: rows.filter((i: any) => !isInvoiceDraft(i) && i.paymentStatus === 'PAID').length };
  }, [rows]);

  async function post(r: any) { try { await api(`/sales/invoices/${r.id}/finalize`, { method: 'POST', body: JSON.stringify({ action: 'POST' }) }); notify.success('Invoice posted — awaiting payment'); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); qc.invalidateQueries({ queryKey: ['sales-register'] }); } catch (e: any) { notify.error(e.message); } }
  async function del(r: any) { try { await api(`/sales/invoices/${r.id}`, { method: 'DELETE' }); notify.success('Invoice deleted'); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); qc.invalidateQueries({ queryKey: ['sales-register'] }); } catch (e: any) { notify.error(e.message); } }
  async function fiscal(r: any) { const dev = (devices.data || []).find((d: any) => d.status === 'ACTIVE' && d.dayStatus === 'OPEN'); if (!dev) { notify.warning('No open fiscal day on an active device'); return; } try { await api(`/fiscalisation/devices/${dev.id}/fiscalise`, { method: 'POST', body: JSON.stringify({ invoiceId: r.id }) }); notify.success('Fiscalised'); qc.invalidateQueries({ queryKey: ['/sales/invoices'] }); } catch (e: any) { notify.error(e.message); } }
  const canFiscal = (r: any) => { const recv = (r.receipts || []).reduce((s: number, x: any) => s + Number(x.amount), 0); return recv >= Number(r.total) - 0.001 && r.fiscalStatus !== 'FISCALISED'; };

  const columns: ColumnsType<any> = [
    { title: 'Invoice #', dataIndex: 'invoiceNo', width: 130, render: (v, r) => <Link href={`/sales/invoices/${r.id}/edit`} className="font-mono text-[12px] font-semibold text-[#003366] hover:text-[#0b4a8f] hover:underline">{v}</Link> },
    ...(hideCustomer ? [] : [{ title: 'Customer', dataIndex: 'customer', render: (_v: any, r: any) => (<span className="flex items-center gap-2.5"><CustomerAvatar name={r.customer?.name} size={28} /><span className="text-[13px] text-[#171a2e]">{r.customer?.name || '—'}</span></span>) } as any]),
    { title: 'Date', dataIndex: 'invoiceDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Due Date', dataIndex: 'dueDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{v ? dayjs(v).format('DD MMM YY') : '—'}</span> },
    { title: 'Amount', dataIndex: 'total', width: 130, align: 'right', render: (v) => <CurrencyValue value={v} /> },
    { title: 'Balance', dataIndex: 'balanceDue', width: 110, align: 'right', render: (v, r) => (
      isInvoiceDraft(r)
        ? <span className="text-[13px] text-[#94a3b8]">—</span>
        : <span className={`text-[13px] font-semibold ${Number(v) > 0 ? 'text-[#F97316]' : 'text-[#16A34A]'}`}>{fmtMoney(Number(v || 0))}</span>
    ) },
    { title: 'Status', key: 'displayStatus', width: 150, render: (_v, r) => <StatusPill status={invoiceDisplayStatus(r)} /> },
    { ...ACTIONS_COL, render: (_, r: any) => (
      <RowActionsMenu items={[
        { key: 'view', label: isInvoiceDraft(r) ? 'Edit' : 'View', icon: <EyeOutlined />, onClick: () => router.push(`/sales/invoices/${r.id}/edit`) },
        { key: 'post', label: 'Save & Post', icon: <FileDoneOutlined />, hidden: !isInvoiceDraft(r), onClick: () => post(r) },
        { key: 'fiscal', label: 'Fiscalise', icon: <RobotOutlined />, hidden: !canFiscal(r), onClick: () => fiscal(r) },
        { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, hidden: !isInvoiceDraft(r), confirm: 'Delete invoice?', onClick: () => del(r) },
      ]} />
    ) },
  ];
  const kpis = [
    { label: 'Total Invoiced', value: fmtMoney(totals.total), icon: <DollarOutlined />, tone: '#2563eb' },
    { label: 'Unpaid', value: fmtMoney(totals.unpaid), icon: <ClockCircleOutlined />, tone: '#f59e0b', valueColor: '#F97316' },
    { label: 'Paid', value: fmtMoney(totals.paid), icon: <FileDoneOutlined />, tone: '#16a34a', valueColor: '#16A34A' },
    { label: 'Overdue', value: fmtMoney(totals.overdue), icon: <ClockCircleOutlined />, tone: '#dc2626', valueColor: '#EF4444' },
  ];
  const invOpts = ['DRAFT', 'POSTED', 'VOID'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }));
  const payOpts = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }));
  const fiscOpts = ['NOT_REQUIRED', 'READY', 'PENDING', 'FISCALISED', 'RETRY', 'REJECTED'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }));

  return (
    <div className="nex-fade">
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Invoices</h1><p className="text-[13px] text-[#64748b] mt-1">Create, send and track customer invoices</p></div>
          <div className="flex items-center gap-2">
            <Link href="/sales/invoices/template">
              <Button icon={<SettingOutlined />} aria-label="Invoice template settings" title="Invoice template" />
            </Link>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/sales/invoices/new')}>New Invoice</Button>
          </div>
        </div>
      )}
      {!embedded && <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">{kpis.map((k) => <SummaryCard key={k.label} icon={k.icon} label={k.label} value={k.value} tone={k.tone} valueColor={k.valueColor} />)}</div>}
      <FilterBar extra={<span>{totals.count} invoices · {totals.drafts} draft · {totals.paidCount} paid</span>}>
        <Input allowClear prefix={<SearchOutlined className="text-[#64748b]" />} placeholder="Search by customer or number" className="w-72 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="Inv status" className="!min-w-[120px] !rounded-xl" value={invStatus || undefined} onChange={setInvStatus} options={invOpts} />
        <Select allowClear placeholder="Payment status" className="!min-w-[150px] !rounded-xl" value={payStatus || undefined} onChange={setPayStatus} options={payOpts} />
        <Select allowClear placeholder="Fiscal status" className="!min-w-[140px] !rounded-xl" value={fiscStatus || undefined} onChange={setFiscStatus} options={fiscOpts} />
        <DatePicker.RangePicker className="!rounded-xl" value={range} onChange={setRange} />
        <Button icon={<ReloadOutlined />} loading={refreshing || list.isFetching} onClick={refreshList} aria-label="Refresh" />
        <Button icon={<PrinterOutlined />} onClick={printList}>Print</Button>
        <Button icon={<ExportOutlined />} onClick={exportCsv}>Export</Button>
      </FilterBar>
      <div className="nex-card">
        {rows.length === 0 ? <EmptyState title="No invoices yet" description="Create your first invoice to start billing customers." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/sales/invoices/new')}>New Invoice</Button>} /> : (<>
          {sel.length > 0 && (<div className="px-4 py-3 flex items-center gap-3 flex-wrap bg-[#f8faff] border-b border-[#eef0f6]"><span className="text-[13px] font-medium text-[#344054]">{sel.length} selected</span><Button type="primary" icon={<FileDoneOutlined />} loading={busy} onClick={bulkPost}>Save & Post</Button><Button icon={<ExportOutlined />} onClick={exportCsv}>Export</Button><Popconfirm title={`Delete ${sel.length} selected invoices?`} onConfirm={bulkDel}><Button danger icon={<DeleteOutlined />} loading={busy}>Delete</Button></Popconfirm><div className="ml-auto"><Button size="small" onClick={() => setSel([])}>Clear</Button></div></div>)}
          <Table
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            columns={columns}
            scroll={{ x: true }}
            rowSelection={{ selectedRowKeys: sel, onChange: (keys) => setSel(keys as string[]) }}
            pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} invoices` }}
            onRow={(r) => ({
              onClick: (e) => {
                const el = e.target as HTMLElement;
                if (el.closest('a,button,.ant-checkbox-wrapper,.ant-dropdown,.ant-dropdown-trigger,.ant-popover,.ant-popconfirm')) return;
                router.push(`/sales/invoices/${r.id}/edit`);
              },
              className: 'cursor-pointer',
            })}
          />
        </>)}
      </div>
    </div>
  );
}
