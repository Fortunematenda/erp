'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Tooltip, message } from 'antd';
import { AppstoreOutlined, CopyOutlined, DeleteOutlined, DollarOutlined, EditOutlined, EyeOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined, RiseOutlined, SearchOutlined, WarningOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { CrudPage, StatusTag } from '@/components/crud-page';
import { StatCard } from '@/components/stat-card';
import { useMeta } from '@/lib/meta';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { ItemFormDrawer } from '@/components/inventory/item-form-drawer';
import { StockAdjustmentDrawer } from '@/components/inventory/stock-adjustment-drawer';
import { TransferDrawer } from '@/components/inventory/transfer-drawer';
import {
  ITEM_TYPE_LABELS,
  TRACKING_LABELS,
  TRACKING_TONE,
  isStockTracked,
  normalizeItemType,
  trackingFilterOptions,
  trackingStatus,
} from '@/lib/item-type';

const TYPE_FILTER = [
  { label: 'Inventory Products', value: 'INVENTORY_PRODUCT' },
  { label: 'Non-Inventory Products', value: 'NON_INVENTORY_PRODUCT' },
  { label: 'Services', value: 'SERVICE' },
];
const PERF_META: Record<string, { label: string; tone: string }> = {
  BEST_SELLER: { label: '🔥 Best Seller', tone: 'green' }, SELLING: { label: '● Selling', tone: 'blue' },
  SLOW_MOVING: { label: '● Slow Moving', tone: 'amber' }, NO_SALES: { label: '— No Sales', tone: 'grey' },
  NEW: { label: 'NEW', tone: 'purple' }, SERVICE: { label: 'SERVICE', tone: 'default' },
};
const PERF_TONE: Record<string, string> = { BEST_SELLER: 'green', SELLING: 'blue', SLOW_MOVING: 'amber', NO_SALES: 'default', NEW: 'purple', SERVICE: 'cyan' };
const arr = (v: any) => (Array.isArray(v) ? v : []);
function PerfBadge({ value }: { value: string }) {
  return <StatusTag value={value} colorMap={PERF_TONE} />;
}
function TrackingBadge({ type }: { type?: string }) {
  const status = trackingStatus(type);
  return <Tag color={TRACKING_TONE[status]}>{TRACKING_LABELS[status]}</Tag>;
}

function CountsTab() {
  const qc = useQueryClient();
  const meta = useMeta();
  const list = useQuery({ queryKey: ['/inventory/counts'], queryFn: () => api('/inventory/counts') });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const itemOptions = (meta.data?.items || []).filter((i: any) => isStockTracked(i.type)).map((i: any) => ({ label: `${i.sku} — ${i.name}`, value: i.id }));

  async function submit() {
    try {
      const v = await form.validateFields();
      if (!v.lines?.length) {
        message.error('Add at least one line');
        return;
      }
      setSaving(true);
      await api('/inventory/counts', { method: 'POST', body: JSON.stringify({ warehouseId: v.warehouseId, lines: v.lines.map((l: any) => ({ itemId: l.itemId, countedQty: l.countedQty })) }) });
      message.success('Count created');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['/inventory/counts'] });
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.message);
    } finally { setSaving(false); }
  }

  async function post(id: string) {
    try { await api(`/inventory/counts/${id}/post`, { method: 'POST' }); message.success('Count posted'); qc.invalidateQueries({ queryKey: ['/inventory/counts'] }); qc.invalidateQueries({ queryKey: ['/inventory/stock'] }); }
    catch (e: any) { message.error(e.message); }
  }

  return (
    <>
      <div className="flex justify-end mb-4"><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>New Count</Button></div>
      <Table loading={list.isLoading} rowKey="id" dataSource={list.data || []} scroll={{ x: true }}
        columns={[
          { title: 'Count No', dataIndex: 'countNo', width: 120 }, { title: 'Warehouse', render: (_, r: any) => r.warehouse?.name || '—' },
          { title: 'Lines', dataIndex: 'countNo', width: 90, render: (_, r: any) => (r.lines || []).length },
          { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
          { title: 'Actions', width: 100, render: (_, r: any) => r.status === 'DRAFT' && <Button size="small" type="primary" onClick={() => post(r.id)}>Post</Button> },
        ]}
      />
      <Modal
        title="New stock count"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        width={620}
        forceRender
        afterOpenChange={(visible) => { if (visible) form.resetFields(); }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Warehouse" name="warehouseId" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} />
          </Form.Item>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} align="baseline" className="w-full mb-2" wrap>
                    <Form.Item name={[name, 'itemId']} {...rest} rules={[{ required: true }]} className="!mb-0 w-64"><Select showSearch optionFilterProp="label" placeholder="Item" options={itemOptions} /></Form.Item>
                    <Form.Item name={[name, 'countedQty']} {...rest} rules={[{ required: true }]} className="!mb-0"><InputNumber placeholder="Counted qty" min={0} /></Form.Item>
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ countedQty: 0 })}>Add line</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </>
  );
}

export default function Inventory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view') || 'items';
  const typeParam = searchParams.get('type') || '';
  const [tab, setTab] = useState(viewParam);
  useEffect(() => { setTab(viewParam); }, [viewParam]);

  const stock = useQuery({ queryKey: ['/inventory/stock'], queryFn: () => api('/inventory/stock') });
  const valuation = useQuery({ queryKey: ['/inventory/valuation'], queryFn: () => api('/inventory/valuation') });
  const reorder = useQuery({ queryKey: ['/inventory/reorder'], queryFn: () => api('/inventory/reorder') });
  const itemList = useQuery({ queryKey: ['/inventory/items'], queryFn: () => api('/inventory/items') });
  const warehouses = useQuery({ queryKey: ['/inventory/warehouses'], queryFn: () => api('/inventory/warehouses') });
  const movements = useQuery({ queryKey: ['/inventory/movements'], queryFn: () => api('/inventory/movements') });
  const transferRows = useMemo(() => (movements.data || []).filter((m: any) => String(m.type).startsWith('TRANSFER')), [movements.data]);

  function changeTab(key: string) {
    setTab(key);
    const p = new URLSearchParams(searchParams.toString());
    p.set('view', key);
    if (key !== 'items') p.delete('type');
    router.replace(`/inventory?${p.toString()}`);
  }

  // Per-item aggregate across warehouses for the items table.
  const itemStock = useMemo(() => {
    const m: Record<string, any> = {};
    (stock.data || []).forEach((r: any) => {
      const cur = m[r.itemId] || { onHand: 0, reserved: 0, available: 0, value: 0, avgCost: 0 };
      cur.onHand += Number(r.onHand); cur.reserved += Number(r.reserved); cur.available += Number(r.available); cur.value += Number(r.value); cur.avgCost = Number(r.unitCost);
      m[r.itemId] = cur;
    });
    return m;
  }, [stock.data]);

  const stockCols: ColumnsType<any> = [
    { title: 'SKU', dataIndex: 'sku', width: 100, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => router.push(`/inventory/items/${r.itemId}`)}>{v}</a> },
    { title: 'Item', dataIndex: 'name' },
    { title: 'Warehouse', dataIndex: 'warehouse', width: 130 },
    { title: 'On Hand', dataIndex: 'onHand', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Reserved', dataIndex: 'reserved', align: 'right', render: (v: any) => <span className="text-[#8b5cf6]">{fmtNumber(v)}</span> },
    { title: 'Available', dataIndex: 'available', align: 'right', render: (v: any) => <span className="font-semibold text-[#2563eb]">{fmtNumber(v)}</span> },
    { title: 'Incoming', dataIndex: 'incoming', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Unit Cost', dataIndex: 'unitCost', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Value', dataIndex: 'value', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Status', dataIndex: 'status', width: 120, render: (v: any) => <StatusTag value={v} /> },
  ];

  const itemCols: ColumnsType<any> = [
    { title: 'SKU', dataIndex: 'sku', width: 110, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => router.push(`/inventory/items/${r.id}`)}>{v}</a> },
    { title: 'Item', dataIndex: 'name', render: (v: any, r: any) => <a className="font-medium text-[#171a2e] hover:text-[#003366] hover:underline cursor-pointer" onClick={() => router.push(`/inventory/items/${r.id}`)}>{v}</a> },
    { title: 'Type', dataIndex: 'type', width: 120, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Category', dataIndex: 'itemCategory', width: 110 },
    { title: 'Unit', dataIndex: 'unit', width: 70 },
    { title: 'Sales Price', dataIndex: 'sellingPrice', align: 'right', width: 100, render: (v: any) => <span className="font-semibold text-[#2563eb]">{fmtMoney(v)}</span> },
    { title: 'On Hand', render: (_: any, r: any) => fmtNumber(itemStock[r.id]?.onHand || 0), align: 'right', width: 90 },
    { title: 'Available', render: (_: any, r: any) => <span className="font-semibold">{fmtNumber(itemStock[r.id]?.available || 0)}</span>, align: 'right', width: 100 },
    { title: 'Avg Cost', render: (_: any, r: any) => fmtMoney(itemStock[r.id]?.avgCost || 0), align: 'right', width: 100 },
    { title: 'Value', render: (_: any, r: any) => fmtMoney(itemStock[r.id]?.value || 0), align: 'right', width: 110 },
    { title: 'Status', dataIndex: 'active', width: 90, render: (v: any) => (v ? 'ACTIVE' : 'INACTIVE') },
  ];

  const items = [
    { key: 'items', label: 'Products & Services', children: <InventoryItemsTab initialType={typeParam} /> },
    { key: 'warehouses', label: 'Warehouses', children: <CrudPage title="Warehouses" path="/inventory/warehouses" createLabel="Warehouse" canDelete useDrawer
      columns={[{ title: 'Code', dataIndex: 'code', width: 110 }, { title: 'Warehouse', dataIndex: 'name' }, { title: 'Branch', render: (_, r: any) => r.branch?.name || '—' }]}
      fields={[{ name: 'branchId', label: 'Branch', type: 'select', metaKey: 'branches', required: true }, { name: 'code', label: 'Code' }, { name: 'name', label: 'Name', required: true }]}
    /> },
    { key: 'stock', label: 'Stock Overview', children: <Table size="small" rowKey="id" loading={stock.isLoading} dataSource={arr(stock.data)} columns={stockCols} scroll={{ x: true }} pagination={false} /> },
    { key: 'movements', label: 'Stock Movements', children: <CrudPage title="Stock Movement Ledger" subtitle="Immutable history — corrections require a new adjustment or reversal" path="/inventory/movements" createLabel="Manual Movement" hideEdit
      columns={[
        { title: 'Date', dataIndex: 'occurredAt', width: 110, render: fmtDate }, { title: 'Item', render: (_, r: any) => r.item?.name || r.itemId },
        { title: 'Type', dataIndex: 'type', width: 120, render: (v: any) => <StatusTag value={v} /> }, { title: 'Qty', dataIndex: 'quantity', align: 'right' },
        { title: 'Unit Cost', dataIndex: 'unitCost', align: 'right', render: (v: any) => fmtMoney(v) },
        { title: 'Reference', dataIndex: 'reference', width: 120 },
        { title: 'Notes', dataIndex: 'notes', ellipsis: true },
      ]}
      fields={[
        { name: 'warehouseId', label: 'Warehouse', type: 'select', metaKey: 'warehouses', required: true },
        { name: 'itemId', label: 'Item', type: 'select', metaKey: 'items', metaLabel: 'name', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: ['RECEIPT', 'ISSUE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_IN', 'RETURN_OUT'].map((t) => ({ label: t, value: t })) },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true },
        { name: 'unitCost', label: 'Unit cost (WAC used if blank on outbound)', type: 'money' }, { name: 'reference', label: 'Reference' },
      ]}
    /> },
    { key: 'transfers', label: 'Transfers', children: <TransfersTab rows={transferRows} loading={movements.isLoading} /> },
    { key: 'counts', label: 'Stock Counts', children: <CountsTab /> },
    { key: 'valuation', label: 'Valuation', children: <CardWrapper loading={valuation.isLoading} extra={`Total value: ${fmtMoney(valuation.data?.totalValue)}`}>
      <Table size="small" rowKey="id" dataSource={arr(valuation.data?.rows)} columns={[
        { title: 'SKU', dataIndex: 'sku', width: 110 }, { title: 'Item', dataIndex: 'name' },
        { title: 'On Hand', dataIndex: 'onHand', align: 'right', render: (v: any) => fmtNumber(v) },
        { title: 'Avg Cost', dataIndex: 'avgCost', align: 'right', render: (v: any) => fmtMoney(v) },
        { title: 'Value', dataIndex: 'value', align: 'right', render: (v: any) => fmtMoney(v) },
      ]} pagination={false} scroll={{ x: true }} />
    </CardWrapper> },
    { key: 'reorder', label: 'Reorder Alerts', children: <Table size="small" rowKey="id" loading={reorder.isLoading} dataSource={arr(reorder.data)} columns={[
      { title: 'SKU', dataIndex: 'sku', width: 110 }, { title: 'Item', dataIndex: 'name' },
      { title: 'Warehouse', dataIndex: 'warehouse', width: 130 },
      { title: 'Available', dataIndex: 'available', align: 'right', render: (v: any) => <span className="text-red-600 font-medium">{fmtNumber(v)}</span> },
      { title: 'Reorder Level', dataIndex: 'reorderLevel', align: 'right' },
      { title: 'Suggested Qty', dataIndex: 'suggestedQty', align: 'right', render: (v: any) => fmtNumber(v) },
      { title: 'Preferred Supplier', render: (_, r: any) => r.preferredSupplierId ? '#' + String(r.preferredSupplierId).slice(0, 6) : '—' },
    ]} pagination={false} scroll={{ x: true }} /> },
  ];
  const itemRows = arr(itemList.data?.rows || itemList.data);
  const invCount = itemRows.filter((r: any) => isStockTracked(r.type)).length;
  const nonInvCount = itemRows.filter((r: any) => normalizeItemType(r.type) === 'NON_INVENTORY_PRODUCT').length;
  const svcCount = itemRows.filter((r: any) => normalizeItemType(r.type) === 'SERVICE').length;
  const lowStock = (stock.data || []).filter((r: any) => r.status === 'LOW STOCK' || r.status === 'OUT OF STOCK').length;
  const outStock = (stock.data || []).filter((r: any) => r.status === 'OUT OF STOCK').length;
  const kpis = [
    { icon: <AppstoreOutlined />, label: 'Total Items', value: itemList.data?.total ?? itemRows.length, hint: `${invCount} tracked · ${nonInvCount} untracked · ${svcCount} services`, tab: 'items' },
    { icon: <DollarOutlined />, label: 'Inventory Value', value: fmtMoney(valuation.data?.totalValue), hint: 'Tracked inventory products only', tab: 'valuation' },
    { icon: <RiseOutlined />, label: 'Low / Out of Stock', value: `${lowStock}`, hint: `${outStock} out of stock (tracked only)`, tab: 'reorder' },
    { icon: <WarningOutlined />, label: 'Reorder Alerts', value: reorder.data?.length || 0, hint: 'Tracked products below reorder', gradient: 'linear-gradient(135deg,#fffbeb,#fefce8)', tab: 'reorder' },
  ];
  return (
    <div className="nex-fade">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map((k) => <button key={k.label} onClick={() => changeTab(k.tab)} className="text-left"><StatCard icon={k.icon} label={k.label} value={k.value} hint={k.hint} gradient={k.gradient} /></button>)}
      </div>
      <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
        <Tabs items={items} activeKey={tab} onChange={changeTab} destroyOnHidden />
      </Card>
    </div>
  );
}

function CardWrapper({ loading, extra, children }: any) {
  return <Card className="shadow-sm border-0 mb-4" loading={loading} extra={extra}>{children}</Card>;
}

function TransfersTab({ rows, loading }: { rows: any[]; loading: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex justify-end mb-4"><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>New Transfer</Button></div>
      <Table size="small" rowKey="id" loading={loading} dataSource={rows} pagination={false} scroll={{ x: true }} columns={[
        { title: 'Date', dataIndex: 'occurredAt', width: 110, render: fmtDate }, { title: 'Item', render: (_, r: any) => r.item?.name || r.itemId },
        { title: 'Type', dataIndex: 'type', width: 140, render: (v: any) => <StatusTag value={v} /> }, { title: 'Warehouse', render: (_, r: any) => r.warehouse?.name || '—' },
        { title: 'Qty', dataIndex: 'quantity', align: 'right' }, { title: 'Unit Cost', dataIndex: 'unitCost', align: 'right', render: (v: any) => fmtMoney(v) },
        { title: 'Reference', dataIndex: 'reference' },
        { title: 'Notes', dataIndex: 'notes', ellipsis: true },
      ]} />
      <TransferDrawer open={open} onClose={() => setOpen(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['/inventory/movements'] }); qc.invalidateQueries({ queryKey: ['/inventory/stock'] }); }} />
    </>
  );
}

// ---- Category select with inline Add / Manage ----
function CategorySelect({ value, onChange, categories, onAdd, onManage, placeholder = 'Select category' }: { value?: string; onChange?: (v: string) => void; categories: any[]; onAdd: () => void; onManage: () => void; placeholder?: string }) {
  const depthOf = (id: string | null | undefined) => { let d = 0, cur: any = categories.find((c) => c.id === id); const seen = new Set(); while (cur?.parentId && !seen.has(cur.parentId)) { d++; seen.add(cur.parentId); cur = categories.find((c) => c.id === cur.parentId); } return d; };
  return (
    <Select
      showSearch value={value || undefined} onChange={(v) => onChange?.(v)} allowClear placeholder={placeholder}
      optionFilterProp="label" style={{ width: '100%' }}
      options={categories.map((c) => ({ value: c.id, label: `${'  '.repeat(depthOf(c.id))}${depthOf(c.id) ? '↳ ' : ''}${c.name}` }))}
      popupRender={(menu: any) => (<div><div className="max-h-64 overflow-auto">{menu}</div><div className="border-t border-[#eef0f6] mt-1 pt-1.5"><Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => { onAdd(); }}>Add Category</Button><Button type="text" size="small" block icon={<AppstoreOutlined />} onClick={onManage}>Manage Categories</Button></div></div>)}
    />
  );
}

function InventoryItemsTab({ initialType = '' }: { initialType?: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const categories = useQuery({ queryKey: ['/inventory/categories'], queryFn: () => api('/inventory/categories') });
  const [q, setQ] = useState(''); const [categoryId, setCategoryId] = useState(''); const [type, setType] = useState(initialType); const [tracking, setTracking] = useState('');
  const [perf, setPerf] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | undefined>('true');
  const [dateRange, setDateRange] = useState<any>(undefined); const [sortBy, setSortBy] = useState('createdAt'); const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25);
  const [editItem, setEditItem] = useState<any>(null); const [editOpen, setEditOpen] = useState(false);
  const [adjustItemId, setAdjustItemId] = useState<string | undefined>();
  const [transferItemId, setTransferItemId] = useState<string | undefined>();
  const [addCat, setAddCat] = useState(false); const [manage, setManage] = useState(false); const [editCat, setEditCat] = useState<any>(null); const [reports, setReports] = useState('');
  const [reportType, setReportType] = useState('');
  const [catForm] = Form.useForm();
  const catParentId = Form.useWatch('parentId', addCat || editCat ? catForm : undefined);

  useEffect(() => { setType(initialType || ''); setPage(1); }, [initialType]);

  const list = useQuery({ queryKey: ['/inventory/items', q, categoryId, type, tracking, perf, activeFilter, dateRange, sortBy, sortDir, page, pageSize], queryFn: () => {
    const p = new URLSearchParams(); if (q) p.set('q', q); if (categoryId) p.set('categoryId', categoryId);
    if (type) p.set('type', type); else if (tracking) p.set('tracking', tracking);
    if (perf) p.set('performance', perf);
    if (activeFilter !== undefined) p.set('active', activeFilter);
    if (dateRange) { p.set('createdFrom', dateRange[0].format('YYYY-MM-DD')); p.set('createdTo', dateRange[1].format('YYYY-MM-DD')); } p.set('sortBy', sortBy); p.set('sortDirection', sortDir); p.set('page', String(page)); p.set('pageSize', String(pageSize));
    return api(`/inventory/items?${p.toString()}`); } });

  const data = list.data || { rows: [], total: 0, page, pageSize };
  function refresh() { qc.invalidateQueries({ queryKey: ['/inventory/items'] }); }
  function clear() { setQ(''); setCategoryId(''); setType(''); setTracking(''); setPerf(''); setActiveFilter('true'); setDateRange(undefined); setPage(1); }
  async function onTableChange(pagination: any, _f: any, sorter: any) {
    setPage(pagination.current || 1); setPageSize(pagination.pageSize || 25);
    if (sorter?.field) { setSortBy(sorter.field); setSortDir(sorter.order === 'ascend' ? 'asc' : 'desc'); }
  }
  function openCreate() { setEditItem(null); setEditOpen(true); }
  function openEdit(item: any) { setEditItem(item); setEditOpen(true); }
  function openDuplicate(item: any) {
    const { id, sku, createdAt, updatedAt, onHand, reserved, available, avgCost, value, qtySold, net, lastSale, performance, incoming, trackingStatus: _ts, ...rest } = item || {};
    setEditItem({ ...rest, sku: undefined, name: `${item.name || 'Item'} (Copy)`, active: true });
    setEditOpen(true);
  }

  async function saveCategory() {
    const v = await catForm.validateFields().catch(() => null); if (!v) return;
    try {
      if (editCat) await api(`/inventory/categories/${editCat.id}`, { method: 'PATCH', body: JSON.stringify({ ...v, parentId: v.parentId || undefined }) });
      else await api('/inventory/categories', { method: 'POST', body: JSON.stringify({ ...v, parentId: v.parentId || undefined }) });
      message.success(editCat ? 'Category updated' : 'Category created');
      setAddCat(false); setEditCat(null); catForm.resetFields();
      qc.invalidateQueries({ queryKey: ['/inventory/categories'] }); qc.invalidateQueries({ queryKey: ['meta'] });
    } catch (e: any) { message.error(e.message); }
  }
  async function manageAction(action: string, cat: any) {
    try {
      if (action === 'deactivate') await api(`/inventory/categories/${cat.id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
      else if (action === 'activate') await api(`/inventory/categories/${cat.id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
      message.success('Updated'); qc.invalidateQueries({ queryKey: ['/inventory/categories'] }); refresh();
    } catch (e: any) { message.error(e.message); }
  }
  async function archiveItem(r: any) {
    try { await api(`/inventory/items/${r.id}/archive`, { method: 'POST', body: '{}' }); message.success('Item archived'); refresh(); }
    catch (e: any) { message.error(e.message); }
  }
  async function restoreItem(r: any) {
    try { await api(`/inventory/items/${r.id}/restore`, { method: 'POST', body: '{}' }); message.success('Item restored'); refresh(); }
    catch (e: any) { message.error(e.message); }
  }
  async function deleteItem(r: any) {
    try { await api(`/inventory/items/${r.id}`, { method: 'DELETE' }); message.success('Deleted'); refresh(); }
    catch (e: any) { message.error(e.message); }
  }

  const catCols: any = [
    { title: 'Code', dataIndex: 'code', width: 90 }, { title: 'Category', dataIndex: 'name' },
    { title: 'Parent', render: (_: any, r: any) => categories.data?.find((c: any) => c.id === r.parentId)?.name || '—' },
    { title: 'Items', render: (_: any, r: any) => r._count?.items ?? 0 }, { title: 'Status', dataIndex: 'active', width: 90, render: (v: any) => (v ? 'Active' : 'Inactive') },
    { ...ACTIONS_COL, render: (_: any, r: any) => (
      <RowActionsMenu items={[
        { key: 'edit', label: 'Edit', icon: <EditOutlined />, onClick: () => { setManage(false); setEditCat(r); catForm.setFieldsValue(r); setAddCat(true); } },
        { key: 'deactivate', label: 'Deactivate', icon: <DeleteOutlined />, danger: true, hidden: !r.active, onClick: () => manageAction('deactivate', r) },
        { key: 'activate', label: 'Activate', hidden: r.active, onClick: () => manageAction('activate', r) },
      ]} />
    ) },
  ];

  const perfCols: ColumnsType<any> = [
    { title: 'SKU', dataIndex: 'sku', width: 100, sorter: true, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => router.push(`/inventory/items/${r.id}`)}>{v}</a> },
    { title: 'Item', dataIndex: 'name', sorter: true, render: (v: any, r: any) => <a className="font-medium text-[#171a2e] hover:text-[#003366] hover:underline cursor-pointer" onClick={() => router.push(`/inventory/items/${r.id}`)}>{v}</a> },
    { title: 'Category', dataIndex: 'categoryName', sorter: true, render: (_: any, r: any) => categories.data?.find((c: any) => c.id === r.categoryId)?.name || '—' },
    { title: 'Type', dataIndex: 'type', width: 160, sorter: true, render: (v: any) => ITEM_TYPE_LABELS[normalizeItemType(v)] || v },
    { title: 'Tracking', dataIndex: 'type', width: 130, render: (_: any, r: any) => <TrackingBadge type={r.type} /> },
    { title: 'Unit', dataIndex: 'unit', width: 70 },
    { title: 'Price', dataIndex: 'sellingPrice', align: 'right', sorter: true, width: 100, render: (v: any) => <span className="font-semibold text-[#2563eb]">{fmtMoney(v)}</span> },
    { title: 'Stock', dataIndex: 'onHand', align: 'right', sorter: true, width: 90, render: (v: any, r: any) => (isStockTracked(r.type) ? fmtNumber(v) : '—') },
    { title: 'Available', dataIndex: 'available', align: 'right', sorter: true, width: 100, render: (v: any, r: any) => (isStockTracked(r.type) ? <span className="font-semibold">{fmtNumber(v)}</span> : '—') },
    { title: 'Avg Cost', dataIndex: 'avgCost', align: 'right', sorter: true, width: 100, render: (v: any, r: any) => (isStockTracked(r.type) ? fmtMoney(v) : '—') },
    { title: 'Stock Value', dataIndex: 'value', align: 'right', sorter: true, width: 110, render: (v: any, r: any) => (isStockTracked(r.type) ? fmtMoney(v) : '—') },
    { title: 'Qty Sold (30d)', dataIndex: 'qtySold', align: 'right', sorter: true, width: 100, render: (v: any) => fmtNumber(v) },
    { title: 'Sales Perf.', dataIndex: 'performance', width: 130, sorter: true, render: (v: any) => <Tooltip title="Last 30 days"><PerfBadge value={v} /></Tooltip> },
    { title: 'Status', dataIndex: 'active', width: 90, render: (v: any) => (v ? 'ACTIVE' : 'ARCHIVED') },
    { title: 'Created', dataIndex: 'createdAt', width: 110, sorter: true, render: (v: any) => fmtDate(v) },
    { ...ACTIONS_COL, render: (_: any, r: any) => (
      <RowActionsMenu items={[
        { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => router.push(`/inventory/items/${r.id}`) },
        { key: 'edit', label: 'Edit', icon: <EditOutlined />, onClick: () => openEdit(r) },
        { key: 'adjust', label: 'Adjust Stock', icon: <DollarOutlined />, hidden: !isStockTracked(r.type), onClick: () => setAdjustItemId(r.id) },
        { key: 'transfer', label: 'Transfer Stock', icon: <CopyOutlined />, hidden: !isStockTracked(r.type), onClick: () => setTransferItemId(r.id) },
        { key: 'movements', label: 'View Stock Movements', icon: <FileTextOutlined />, hidden: !isStockTracked(r.type), onClick: () => router.push(`/inventory/items/${r.id}`) },
        { key: 'transactions', label: 'View Transactions', icon: <FileTextOutlined />, onClick: () => router.push(`/inventory/items/${r.id}`) },
        { key: 'duplicate', label: 'Duplicate', icon: <CopyOutlined />, onClick: () => openDuplicate(r) },
        { key: 'archive', label: 'Archive', icon: <DeleteOutlined />, hidden: !r.active, confirm: 'Archive this item?', onClick: () => archiveItem(r) },
        { key: 'restore', label: 'Restore', hidden: !!r.active, onClick: () => restoreItem(r) },
        { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, hidden: isStockTracked(r.type) && Number(r.onHand) > 0, confirm: 'Permanently delete? Only if no history.', onClick: () => deleteItem(r) },
      ]} />
    ) },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search items…" className="!w-80 !rounded-xl" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <div className="!w-56"><CategorySelect value={categoryId || undefined} onChange={(v) => { setCategoryId(v || ''); setPage(1); }} categories={categories.data || []} onAdd={() => { setEditCat(null); catForm.resetFields(); setAddCat(true); }} onManage={() => setManage(true)} /></div>
        <Select allowClear placeholder="Item Type" className="!min-w-[180px]" value={type || undefined} onChange={(v) => { setType(v || ''); setTracking(''); setPage(1); }} options={TYPE_FILTER} />
        <Select allowClear placeholder="Tracking" className="!min-w-[150px]" value={tracking || undefined} onChange={(v) => { setTracking(v || ''); if (v) setType(''); setPage(1); }} options={trackingFilterOptions()} />
        <Select allowClear placeholder="Status" className="!min-w-[120px]" value={activeFilter} onChange={(v) => { setActiveFilter(v); setPage(1); }} options={[{ label: 'Active', value: 'true' }, { label: 'Archived', value: 'false' }]} />
        <Select allowClear placeholder="Sales Perf." className="!min-w-[150px]" value={perf || undefined} onChange={(v) => { setPerf(v || ''); setPage(1); }} options={['BEST_SELLER', 'SELLING', 'SLOW_MOVING', 'NO_SALES', 'NEW'].map((t) => ({ label: PERF_META[t].label, value: t }))} />
        <DatePicker.RangePicker className="!rounded-xl" value={dateRange} onChange={(v) => { setDateRange(v); setPage(1); }} placeholder={['Date from', 'Date to']} />
        <Button onClick={clear}>Clear</Button>
        <div className="ml-auto flex items-center gap-2">
          <Dropdown menu={{ items: ['sales-by-item', 'best-sellers', 'slow-moving', 'dead-stock', 'sales-by-category', 'stock-by-category'].map((k) => ({ key: k, label: k.replace(/-/g, ' ') })), onClick: ({ key }) => { setReports(key); } }} trigger={['click']}><Button icon={<FileTextOutlined />}>Reports ▾</Button></Dropdown>
          <Button icon={<ReloadOutlined />} onClick={refresh} /><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>+ Product / Service</Button>
        </div>
      </div>
      <Table rowKey="id" loading={list.isLoading} dataSource={arr(data.rows)} columns={perfCols} scroll={{ x: true }} onChange={onTableChange}
        pagination={{ current: page, pageSize, total: data.total, showSizeChanger: true, showTotal: (t) => `${t} items` }} />

      <ItemFormDrawer open={editOpen} initial={editItem} itemId={editItem?.id} onClose={() => setEditOpen(false)} onSaved={() => refresh()} />
      <StockAdjustmentDrawer open={!!adjustItemId} itemId={adjustItemId} onClose={() => setAdjustItemId(undefined)} onDone={refresh} />
      <TransferDrawer open={!!transferItemId} itemId={transferItemId} onClose={() => setTransferItemId(undefined)} onDone={refresh} />

      <Modal open={addCat} onCancel={() => { setAddCat(false); setEditCat(null); }} onOk={saveCategory} okText={editCat ? 'Save' : 'Create'} title={editCat ? 'Edit Category' : 'New Category'}>
        <Form form={catForm} layout="vertical" className="mt-2">
          <Form.Item label="Category Name" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Category Code" name="code"><Input placeholder="e.g. NET" /></Form.Item>
            <Form.Item label="Parent Category" name="parentId"><CategorySelect value={catParentId} onChange={(v) => catForm.setFieldValue('parentId', v)} categories={(categories.data || []).filter((c: any) => c.id !== editCat?.id)} onAdd={() => {}} onManage={() => setManage(true)} /></Form.Item>
          </div>
          <Form.Item label="Description" name="description"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={manage} onCancel={() => setManage(false)} footer={null} title="Manage Categories" width={720}>
        <Table rowKey="id" dataSource={arr(categories.data)} columns={catCols} pagination={false} size="small" />
      </Modal>

      <ReportsModal reportKey={reports} onClose={() => setReports('')} reportType={reportType} setReportType={setReportType} />
    </div>
  );
}

function ReportsModal({ reportKey, onClose, reportType, setReportType }: { reportKey: string; onClose: () => void; reportType: string; setReportType: (v: string) => void }) {
  const q = useQuery({
    queryKey: ['/inventory/reports', reportKey, reportType],
    queryFn: () => {
      const p = new URLSearchParams();
      if (reportType) p.set('itemType', reportType);
      const qs = p.toString();
      return api(`/inventory/reports/${reportKey}${qs ? `?${qs}` : ''}`);
    },
    enabled: !!reportKey,
  });
  const router = useRouter();
  if (!reportKey) return null;
  const data = q.data || [];
  const base = { title: 'SKU', dataIndex: 'sku', width: 100, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => r.itemId && router.push(`/inventory/items/${r.itemId}`)}>{v}</a> };
  const typeCol = { title: 'Type', dataIndex: 'type', width: 150, render: (v: any) => ITEM_TYPE_LABELS[normalizeItemType(v)] || v || '—' };
  const cols: ColumnsType<any> = reportKey === 'sales-by-item' ? [
    base, { title: 'Item', dataIndex: 'name' }, typeCol, { title: 'Category', dataIndex: 'category' }, { title: 'Qty Sold', dataIndex: 'qty', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Net Sales', dataIndex: 'net', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Invoices', dataIndex: 'invoiceCount', align: 'right' }, { title: 'Last Sale', dataIndex: 'lastSale', render: (v: any) => (v ? fmtDate(v) : '—') },
  ] : reportKey === 'best-sellers' ? [
    { title: 'Rank', dataIndex: 'rank', width: 60 }, base, { title: 'Item', dataIndex: 'name' }, typeCol, { title: 'Qty Sold', dataIndex: 'qty', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Net Sales', dataIndex: 'net', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Available', dataIndex: 'available', align: 'right', render: (v: any, r: any) => (isStockTracked(r.type) ? fmtNumber(v) : '—') },
  ] : reportKey === 'sales-by-category' ? [
    { title: 'Category', dataIndex: 'category' }, { title: 'Qty Sold', dataIndex: 'qty', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Net Sales', dataIndex: 'net', align: 'right', render: (v: any) => fmtMoney(v) },
  ] : reportKey === 'stock-by-category' ? [
    { title: 'Category', dataIndex: 'category' }, { title: 'Items', dataIndex: 'items', align: 'right' }, { title: 'Units', dataIndex: 'units', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Stock Value', dataIndex: 'value', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Out of Stock', dataIndex: 'outOfStock', align: 'right' },
  ] : reportKey === 'slow-moving' ? [
    base, { title: 'Item', dataIndex: 'name' }, { title: 'On Hand', dataIndex: 'onHand', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Stock Value', dataIndex: 'value', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Last Sale', dataIndex: 'lastSale', render: (v: any) => (v ? fmtDate(v) : 'Never') }, { title: 'Qty 30d', dataIndex: 'qtySold30d', align: 'right', render: (v: any) => fmtNumber(v) },
  ] : [
    base, { title: 'Item', dataIndex: 'name' }, { title: 'On Hand', dataIndex: 'onHand', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Avg Cost', dataIndex: 'avgCost', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Stock Value', dataIndex: 'value', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Last Sale', dataIndex: 'lastSale', render: (v: any) => (v ? fmtDate(v) : 'Never') },
  ];
  return (
    <Modal open onCancel={() => { setReportType(''); onClose(); }} footer={null} width={860} title={`Report: ${reportKey.replace(/-/g, ' ')}`}>
      {['sales-by-item', 'best-sellers'].includes(reportKey) && (
        <div className="mb-3">
          <Select allowClear placeholder="Filter by item type" className="!min-w-[220px]" value={reportType || undefined} onChange={(v) => setReportType(v || '')} options={TYPE_FILTER} />
        </div>
      )}
      <Table rowKey="id" size="small" loading={q.isLoading} dataSource={arr(data)} columns={cols} pagination={false} scroll={{ x: true }}
        expandable={reportKey === 'sales-by-item' ? { expandedRowRender: (r: any) => <Table size="small" rowKey="invoiceId" dataSource={r.sales || []} pagination={false} columns={[{ title: 'Invoice', dataIndex: 'invoiceNo', render: (v: any, x: any) => <a className="text-[#2563eb] cursor-pointer" onClick={() => router.push(`/sales/invoices/${x.invoiceId}/edit`)}>{v}</a> }, { title: 'Date', dataIndex: 'date', render: fmtDate }, { title: 'Customer', dataIndex: 'customer' }, { title: 'Qty', dataIndex: 'qty', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) }]} /> } : undefined } />
    </Modal>
  );
}

