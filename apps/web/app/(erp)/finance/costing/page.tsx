'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Drawer, Input, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, ReloadOutlined, SearchOutlined, WarningOutlined, PayCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { FinanceSummaryCard } from '@/components/finance-ui';

function amount(v: number) { return v ? <span className="font-semibold tabular-nums text-[14px]" style={{ color: '#334155' }}>{fmtMoney(v)}</span> : <span className="text-[#c3c7dc]">—</span>; }
function statusChip(s: string) {
  const cfg: Record<string, [string, string]> = { NORMAL: ['#f2f4f7', '#475467'], MISSING_COST: ['#fef2f2', '#b42318'], NEGATIVE: ['#fef2f2', '#b42318'] };
  const [bg, fg] = cfg[s] || cfg.NORMAL;
  return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: bg, color: fg }}>{s.replace(/_/g, ' ')}</span>;
}

function ItemCostDrawer({ open, itemId, onClose, onRefresh }: { open: boolean; itemId: string | null; onClose: () => void; onRefresh: () => void }) {
  const q = useQuery({ queryKey: ['inventory', 'costing', 'item', itemId], queryFn: () => api(`/inventory/costing-report?itemId=${itemId}`), enabled: open && !!itemId });
  const d = q.data;
  const item = (d?.rows || []).find((r: any) => r.itemId === itemId);
  const movements = useQuery({ queryKey: ['inventory', 'movements', itemId], queryFn: () => api(`/inventory/items/${itemId}`), enabled: open && !!itemId });
  const mrows = movements.data?.movements || [];
  const invAcct = item?.inventoryAccountId;
  return (
    <Drawer open={open} onClose={onClose} width={720} title={item ? `${item.sku} · ${item.name}` : 'Item Cost'} destroyOnHidden>
      {!item ? <div className="text-[#a1a6c0] text-[13px] py-8 text-center">Loading item cost…</div> : (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <MiniStat label="On Hand" value={String(item.onHand)} />
            <MiniStat label="Unit Cost" value={fmtMoney(item.avgCost)} />
            <MiniStat label="Inventory Value" value={fmtMoney(item.value)} />
            <MiniStat label="Last Cost" value={item.lastCost != null ? fmtMoney(item.lastCost) : '—'} />
          </div>
          <div className="nex-card overflow-hidden mb-4">
            <div className="px-5 pt-3 pb-2 border-b border-[#f2f3f9] text-[13px] font-semibold text-[#5a6080]">Warehouse Breakdown</div>
            <table className="w-full text-[13px]">
              <thead><tr className="bg-[#f8f9ff]"><th className="text-left text-[11px] font-semibold text-[#98A2B3] uppercase px-4 py-2">Warehouse</th><th className="text-right ... px-4 py-2">On Hand</th><th className="text-right px-4 py-2">Value</th></tr></thead>
              <tbody className="divide-y divide-[#f2f3f9]">
                {(d?.warehouses || []).filter((w: any) => w.value > 0).map((w: any) => (
                  <tr key={w.warehouseId}><td className="px-4 py-2 text-[#475467]">{w.name}</td><td className="px-4 py-2 text-right tabular-nums">{w.units}</td><td className="px-4 py-2 text-right tabular-nums">{fmtMoney(w.value)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {invAcct && (
            <div className="rounded-lg px-4 py-2.5 mb-4 text-[13px]" style={{ background: '#f6fdfa', color: '#047857' }}>
              Inventory ledger is reconciled to the Inventory asset account in General Ledger.
            </div>
          )}
          <div className="text-[13px] font-semibold text-[#5a6080] mb-2">Recent Movements</div>
          <Table size="small" rowKey="id" dataSource={mrows} pagination={{ pageSize: 8 }} columns={[
            { title: 'Date', dataIndex: 'occurredAt', width: 110, render: (v) => dayjs(v).format('D MMM YY') },
            { title: 'Type', dataIndex: 'type', width: 130, render: (v) => <Tag style={{ borderRadius: 6 }}>{String(v).replace(/_/g, ' ')}</Tag> },
            { title: 'Reference', dataIndex: 'reference', render: (v) => (v ? <span className="font-mono text-[12px] text-[#003366]">{v}</span> : '—') },
            { title: 'Qty', dataIndex: 'quantity', align: 'right', width: 90, render: (v: any, r: any) => <span style={{ color: ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'].includes(r.type) ? '#047857' : '#b42318' }}>{String(v).replace(/^-/, '')}</span> },
            { title: 'Unit Cost', dataIndex: 'unitCost', align: 'right', width: 100, render: (v) => fmtMoney(v) },
          ]} />
        </div>
      )}
    </Drawer>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) { return <div className="nex-card rounded-lg p-3.5" style={{ border: '1px solid #e9edf2' }}><div className="text-[12px] text-[#667085]">{label}</div><div className="text-[19px] font-semibold text-[#1f2937] mt-1 tabular-nums">{value}</div></div>; }

export default function CostingPage() {
  const qc = useQueryClient();
  const [asOf, setAsOf] = useState<any>(dayjs());
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [view, setView] = useState<'item' | 'warehouse' | 'category'>('item');
  const [openItem, setOpenItem] = useState<string | null>(null);

  useEffect(() => { const id = setTimeout(() => setDebouncedQ(search), 300); return () => clearTimeout(id); }, [search]);

  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: () => api('/inventory/warehouses') });
  const report = useQuery({
    queryKey: ['inventory', 'costing-report', asOf?.format('YYYY-MM-DD'), warehouseId, categoryId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (asOf) p.set('asOf', asOf.format('YYYY-MM-DD'));
      if (warehouseId) p.set('warehouseId', warehouseId);
      if (categoryId) p.set('categoryId', categoryId);
      return api(`/inventory/costing-report?${p.toString()}`);
    },
    placeholderData: (prev: any) => prev,
  });
  const d = report.data;
  const summary = d?.summary;
  const recon = d?.reconciliation;
  const reconDiff = recon ? Math.abs(Number(recon.difference || 0)) > 0.01 : false;

  const allRows = useMemo(() => {
    let r = (d?.rows || []);
    if (debouncedQ) r = r.filter((x: any) => `${x.sku} ${x.name} ${x.category || ''}`.toLowerCase().includes(debouncedQ.toLowerCase()));
    return r;
  }, [d, debouncedQ]);
  const whRows = d?.warehouses || [];
  const catRows = d?.categories || [];
  const rows = view === 'item' ? allRows : (view === 'warehouse' ? whRows : catRows);

  const itemCols: ColumnsType<any> = [
    { title: 'SKU', dataIndex: 'sku', width: 110, render: (v, r) => <button onClick={() => setOpenItem(r.itemId)} className="font-mono text-[12px] text-[#003366] font-semibold hover:underline">{v}</button> },
    { title: 'Item', dataIndex: 'name', render: (v, r) => <button onClick={() => setOpenItem(r.itemId)} className="font-medium text-left hover:text-[#003366] hover:underline">{v}</button> },
    { title: 'On Hand', dataIndex: 'onHand', align: 'right', width: 100, render: (v) => <span className="tabular-nums text-[#475467]">{v}</span> },
    { title: 'Avg / Unit Cost', dataIndex: 'avgCost', align: 'right', width: 120, render: amount },
    { title: 'Value', dataIndex: 'value', align: 'right', width: 130, render: (v) => <span className="font-semibold tabular-nums text-[#1f2937]">{fmtMoney(v)}</span> },
    { title: 'Last Cost', dataIndex: 'lastCost', align: 'right', width: 110, render: (v) => (v != null ? fmtMoney(v) : '—') },
    { title: 'Last Movement', dataIndex: 'lastMovement', width: 130, render: (v) => (v ? dayjs(v).format('D MMM YY') : '—') },
    { title: 'Status', dataIndex: 'status', width: 120, render: statusChip },
  ];
  const whCols: ColumnsType<any> = [
    { title: 'Warehouse', dataIndex: 'name', render: (v) => <span className="font-medium">{v}</span> },
    { title: 'Items', dataIndex: 'items', align: 'right', width: 100, render: (v) => v },
    { title: 'Units', dataIndex: 'units', align: 'right', width: 100, render: (v) => v },
    { title: 'Inventory Value', dataIndex: 'value', align: 'right', render: (v) => <span className="font-semibold tabular-nums text-[#1f2937]">{fmtMoney(v)}</span> },
  ];
  const catCols: ColumnsType<any> = [
    { title: 'Category', dataIndex: 'name', render: (v) => <span className="font-medium">{v}</span> },
    { title: 'Items', dataIndex: 'items', align: 'right', width: 90, render: (v) => v },
    { title: 'Units', dataIndex: 'units', align: 'right', width: 90, render: (v) => v },
    { title: 'Inventory Value', dataIndex: 'value', align: 'right', render: (v) => <span className="font-semibold tabular-nums text-[#1f2937]">{fmtMoney(v)}</span> },
    { title: '% of Total', dataIndex: 'pct', align: 'right', width: 100, render: (v) => `${v}%` },
  ];
  const cols = view === 'item' ? itemCols : (view === 'warehouse' ? whCols : catCols);

  function exportCsv() {
    const header = view === 'item' ? 'SKU,Item,On Hand,Avg Cost,Value,Last Cost,Status' : (view === 'warehouse' ? 'Warehouse,Items,Units,Value' : 'Category,Items,Units,Value,% of Total');
    const lines = rows.map((r: any) => view === 'item' ? [r.sku, `"${r.name}"`, r.onHand, r.avgCost, r.value, r.lastCost ?? '', r.status].join(',') : [r.name, r.items, r.units, r.value, r.pct ?? ''].join(','));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'inventory-valuation.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  function refresh() { qc.invalidateQueries({ queryKey: ['inventory', 'costing-report'] }); }

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">Costing</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Inventory valuation, item costs and cost movements {asOf ? `· As at ${dayjs(asOf).format('D MMM YYYY')}` : ''}</p>
        </div>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!rows.length}>CSV</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        </Space>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <button type="button" onClick={() => setView('item')} className="text-left w-full"><FinanceSummaryCard label="Inventory Value" value={fmtMoney(summary?.inventoryValue ?? 0)} valueColor="#2563eb" subtitle={`${summary?.itemsInStock ?? 0} valued items`} /></button>
        <button type="button" onClick={() => setView('item')} className="text-left w-full"><FinanceSummaryCard label="Items in Stock" value={summary?.itemsInStock ?? 0} valueColor="#7c3aed" subtitle="SKUs with stock" /></button>
        <button type="button" onClick={() => setView('warehouse')} className="text-left w-full"><FinanceSummaryCard label="Units on Hand" value={summary?.unitsOnHand ?? 0} valueColor="#f59e0b" subtitle="Across warehouses" /></button>
        <button type="button" onClick={() => setView('item')} className="text-left w-full"><FinanceSummaryCard label="COGS This Period" value={fmtMoney(summary?.cogsPeriod ?? 0)} valueColor="#b45309" subtitle="Posted value issued" /></button>
      </div>

      {(summary?.negativeStock || summary?.missingCost) ? (
        <div className="rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2 text-[13px]" style={{ background: '#fff5f5', border: '1px solid #fed7d7', color: '#b42318' }}>
          <WarningOutlined /> {summary.negativeStock} negative-stock item(s), {summary.missingCost} missing-cost item(s).
        </div>
      ) : null}
      {recon && (recon.control == null
        ? <div className="rounded-lg px-4 py-2.5 mb-4 text-[13px]" style={{ background: '#fffbeb', border: '1px solid #feecb0', color: '#92400e' }}>Inventory value {fmtMoney(recon.subledger)} — no Inventory asset account is mapped to these items (accounting setup required).</div>
        : (reconDiff
          ? <div className="rounded-lg px-4 py-2.5 mb-4 text-[13px]" style={{ background: '#fff5f5', border: '1px solid #fed7d7', color: '#b42318' }}>Inventory Valuation {fmtMoney(recon.subledger)} vs GL Inventory {fmtMoney(recon.control)} — Difference {fmtMoney(recon.difference)}.</div>
          : <div className="rounded-lg px-4 py-2.5 mb-4 text-[13px]" style={{ background: '#f6fdfa', color: '#047857' }}>Inventory Valuation reconciles to GL Inventory ({fmtMoney(recon.control)}).</div>))}

      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[12px] text-[#5a6080]">As of <DatePicker value={asOf} onChange={setAsOf} allowClear={false} /></div>
        <Input allowClear prefix={<SearchOutlined className="text-[#a1a6c0]" />} placeholder="Search SKU / item / category…" className="!w-72 !rounded-lg" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select allowClear showSearch placeholder="All Warehouses" className="!min-w-[150px]" value={warehouseId} onChange={setWarehouseId} options={(warehouses.data || []).map((w: any) => ({ label: w.name, value: w.id }))} />
        <Select allowClear showSearch placeholder="All Categories" className="!min-w-[140px]" value={categoryId} onChange={setCategoryId} options={[...new Set((d?.rows || []).map((r: any) => r.category).filter(Boolean))].map((c) => ({ label: c, value: (d?.rows || []).find((r: any) => r.category === c)?.categoryId }))} />
        <div className="ml-auto flex items-center gap-1 text-[13px]">
          {[['item', 'Item Valuation'], ['warehouse', 'Warehouse'], ['category', 'Category']].map(([k, l]) => <button key={k} onClick={() => setView(k as any)} className={`px-3 py-1 rounded-full text-[12px] font-medium ${view === k ? 'bg-[#003366] text-white' : 'bg-[#f2f3f9] text-[#5a6080] hover:bg-[#e8ebf4]'}`}>{l}</button>)}
        </div>
      </div>

      <div className="nex-card">
        <Table rowKey={(r: any) => (view === 'item' ? r.itemId : r.warehouseId || r.categoryId || r.name)} loading={report.isFetching} dataSource={rows} columns={cols} scroll={{ x: view === 'item' ? 1000 : 600 }} sticky size="middle" pagination={{ pageSize: 10, showSizeChanger: true }} />
        <div className="flex items-center justify-end gap-6 px-5 py-3 border-t border-[#e9edf2] text-[13px]">
          <span className="font-semibold" style={{ color: '#5a6080' }}>TOTALS</span>
          <span className="tabular-nums font-semibold">Units {summary?.unitsOnHand ?? 0}</span>
          <span className="tabular-nums font-bold text-[#1f2937]">Value {fmtMoney(summary?.inventoryValue ?? 0)}</span>
        </div>
      </div>

      <ItemCostDrawer open={!!openItem} itemId={openItem} onClose={() => setOpenItem(null)} onRefresh={refresh} />
    </div>
  );
}
