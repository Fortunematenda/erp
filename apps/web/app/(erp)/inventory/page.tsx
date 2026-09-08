'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Checkbox, DatePicker, Drawer, Dropdown, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Tooltip, message } from 'antd';
import { AppstoreOutlined, CopyOutlined, DeleteOutlined, DollarOutlined, EditOutlined, EyeOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined, RiseOutlined, SearchOutlined, WarningOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { CrudPage, StatusTag } from '@/components/crud-page';
import { StatCard } from '@/components/stat-card';
import { useMeta } from '@/lib/meta';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const ITEM_TYPES = ['INVENTORY', 'NON_INVENTORY', 'SERVICE'];
const COSTING = ['WEIGHTED_AVERAGE', 'FIFO'];
const ACCOUNT_SELECT = { type: 'select' as const, metaKey: 'accounts' as const, metaLabel: 'name' };
const PERF_META: Record<string, { label: string; tone: string }> = {
  BEST_SELLER: { label: '🔥 Best Seller', tone: 'green' }, SELLING: { label: '● Selling', tone: 'blue' },
  SLOW_MOVING: { label: '● Slow Moving', tone: 'amber' }, NO_SALES: { label: '— No Sales', tone: 'grey' },
  NEW: { label: 'NEW', tone: 'purple' }, SERVICE: { label: 'SERVICE', tone: 'default' },
};
const PERF_TONE: Record<string, string> = { BEST_SELLER: 'green', SELLING: 'blue', SLOW_MOVING: 'amber', NO_SALES: 'default', NEW: 'purple', SERVICE: 'cyan' };
const arr = (v: any) => (Array.isArray(v) ? v : []);
function PerfBadge({ value }: { value: string }) {
  const m = PERF_META[value] || { label: value, tone: 'default' };
  return <StatusTag value={value} colorMap={PERF_TONE} />;
}

function CountsTab() {
  const qc = useQueryClient();
  const meta = useMeta();
  const list = useQuery({ queryKey: ['/inventory/counts'], queryFn: () => api('/inventory/counts') });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const itemOptions = (meta.data?.items || []).map((i: any) => ({ label: `${i.sku} — ${i.name}`, value: i.id }));

  async function submit(v: any) {
    try {
      setSaving(true);
      await api('/inventory/counts', { method: 'POST', body: JSON.stringify({ warehouseId: v.warehouseId, lines: v.lines.map((l: any) => ({ itemId: l.itemId, countedQty: l.countedQty })) }) });
      message.success('Count created'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['/inventory/counts'] });
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  async function post(id: string) {
    try { await api(`/inventory/counts/${id}/post`, { method: 'POST' }); message.success('Count posted'); qc.invalidateQueries({ queryKey: ['/inventory/counts'] }); qc.invalidateQueries({ queryKey: ['/inventory/stock'] }); }
    catch (e: any) { message.error(e.message); }
  }

  return (
    <>
      <div className="flex justify-end mb-4"><Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setOpen(true); }}>New Count</Button></div>
      <Table loading={list.isLoading} rowKey="id" dataSource={list.data || []} scroll={{ x: true }}
        columns={[
          { title: 'Count No', dataIndex: 'countNo', width: 120 }, { title: 'Warehouse', render: (_, r: any) => r.warehouse?.name || '—' },
          { title: 'Lines', dataIndex: 'countNo', width: 90, render: (_, r: any) => (r.lines || []).length },
          { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
          { title: 'Actions', width: 100, render: (_, r: any) => r.status === 'DRAFT' && <Button size="small" type="primary" onClick={() => post(r.id)}>Post</Button> },
        ]}
      />
      <Modal title="New stock count" open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={saving} width={620} destroyOnHidden>
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
  const [tab, setTab] = useState('items');
  const stock = useQuery({ queryKey: ['/inventory/stock'], queryFn: () => api('/inventory/stock') });
  const valuation = useQuery({ queryKey: ['/inventory/valuation'], queryFn: () => api('/inventory/valuation') });
  const reorder = useQuery({ queryKey: ['/inventory/reorder'], queryFn: () => api('/inventory/reorder') });
  const itemList = useQuery({ queryKey: ['/inventory/items'], queryFn: () => api('/inventory/items') });
  const warehouses = useQuery({ queryKey: ['/inventory/warehouses'], queryFn: () => api('/inventory/warehouses') });
  const movements = useQuery({ queryKey: ['/inventory/movements'], queryFn: () => api('/inventory/movements') });
  const transferRows = useMemo(() => (movements.data || []).filter((m: any) => String(m.type).startsWith('TRANSFER')), [movements.data]);

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
    { key: 'items', label: 'Items', children: <InventoryItemsTab /> },
    { key: 'warehouses', label: 'Warehouses', children: <CrudPage title="Warehouses" path="/inventory/warehouses" createLabel="Warehouse" canDelete useDrawer
      columns={[{ title: 'Code', dataIndex: 'code', width: 110 }, { title: 'Warehouse', dataIndex: 'name' }, { title: 'Branch', render: (_, r: any) => r.branch?.name || '—' }]}
      fields={[{ name: 'branchId', label: 'Branch', type: 'select', metaKey: 'branches', required: true }, { name: 'code', label: 'Code' }, { name: 'name', label: 'Name', required: true }]}
    /> },
    { key: 'stock', label: 'Stock', children: <Table size="small" rowKey="id" loading={stock.isLoading} dataSource={arr(stock.data)} columns={stockCols} scroll={{ x: true }} pagination={false} /> },
    { key: 'movements', label: 'Movements', children: <CrudPage title="Stock Movements" path="/inventory/movements" createLabel="Movement"
      columns={[
        { title: 'Date', dataIndex: 'occurredAt', width: 110, render: fmtDate }, { title: 'Item', render: (_, r: any) => r.item?.name || r.itemId },
        { title: 'Type', dataIndex: 'type', width: 120, render: (v: any) => <StatusTag value={v} /> }, { title: 'Qty', dataIndex: 'quantity', align: 'right' },
        { title: 'Unit Cost', dataIndex: 'unitCost', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Reference', dataIndex: 'reference' },
      ]}
      fields={[
        { name: 'warehouseId', label: 'Warehouse', type: 'select', metaKey: 'warehouses', required: true },
        { name: 'itemId', label: 'Item', type: 'select', metaKey: 'items', metaLabel: 'name', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: ['RECEIPT', 'ISSUE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_IN', 'RETURN_OUT'].map((t) => ({ label: t, value: t })) },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true },
        { name: 'unitCost', label: 'Unit cost', type: 'money' }, { name: 'reference', label: 'Reference' },
      ]}
    /> },
    { key: 'transfers', label: 'Transfers', children: <Table size="small" rowKey="id" loading={movements.isLoading} dataSource={transferRows} pagination={false} scroll={{ x: true }} columns={[
      { title: 'Date', dataIndex: 'occurredAt', width: 110, render: fmtDate }, { title: 'Item', render: (_, r: any) => r.item?.name || r.itemId },
      { title: 'Type', dataIndex: 'type', width: 140, render: (v: any) => <StatusTag value={v} /> }, { title: 'Warehouse', render: (_, r: any) => r.warehouse?.name || '—' },
      { title: 'Qty', dataIndex: 'quantity', align: 'right' }, { title: 'Reference', dataIndex: 'reference' },
    ]} /> },
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
      { title: 'Preferred Supplier', render: (_, r: any) => r.preferredSupplierId ? (warehouses.data?.[0] ? '' : '') + '#' + String(r.preferredSupplierId).slice(0, 6) : '—' },
    ]} pagination={false} scroll={{ x: true }} /> },
  ];
  const kpis = [
    { icon: <AppstoreOutlined />, label: 'Items', value: itemList.data?.total ?? itemList.data?.length ?? 0, hint: `${warehouses.data?.length || 0} warehouses`, tab: 'items' },
    { icon: <DollarOutlined />, label: 'Stock value', value: fmtMoney(valuation.data?.totalValue), hint: 'Weighted average cost', tab: 'valuation' },
    { icon: <RiseOutlined />, label: 'Units on hand', value: fmtNumber((stock.data || []).reduce((s: number, r: any) => s + Number(r.onHand), 0)), hint: `${stock.data?.length || 0} positions`, tab: 'stock' },
    { icon: <WarningOutlined />, label: 'Reorder alerts', value: reorder.data?.length || 0, hint: 'Below reorder level', gradient: 'linear-gradient(135deg,#fffbeb,#fefce8)', tab: 'reorder' },
  ];
  return (
    <div className="nex-fade">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map((k) => <button key={k.label} onClick={() => setTab(k.tab)} className="text-left"><StatCard icon={k.icon} label={k.label} value={k.value} hint={k.hint} gradient={k.gradient} /></button>)}
      </div>
      <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
        <Tabs items={items} activeKey={tab} onChange={setTab} destroyOnHidden />
      </Card>
    </div>
  );
}

function CardWrapper({ loading, extra, children }: any) {
  return <Card className="shadow-sm border-0 mb-4" loading={loading} extra={extra}>{children}</Card>;
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

function InventoryItemsTab() {
  const qc = useQueryClient();
  const router = useRouter();
  const meta = useMeta();
  const categories = useQuery({ queryKey: ['/inventory/categories'], queryFn: () => api('/inventory/categories') });
  const [q, setQ] = useState(''); const [categoryId, setCategoryId] = useState(''); const [type, setType] = useState(''); const [perf, setPerf] = useState('');
  const [dateRange, setDateRange] = useState<any>(undefined); const [sortBy, setSortBy] = useState('createdAt'); const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25);
  const [drawer, setDrawer] = useState(false); const [editing, setEditing] = useState<any>(null);
  const [addCat, setAddCat] = useState(false); const [manage, setManage] = useState(false); const [reports, setReports] = useState('');
  const [form] = Form.useForm(); const [catForm] = Form.useForm();
  const itemCatId = Form.useWatch('categoryId', drawer ? form : undefined);
  const catParentId = Form.useWatch('parentId', addCat ? catForm : undefined);

  const list = useQuery({ queryKey: ['/inventory/items', q, categoryId, type, perf, dateRange, sortBy, sortDir, page, pageSize], queryFn: () => {
    const p = new URLSearchParams(); if (q) p.set('q', q); if (categoryId) p.set('categoryId', categoryId); if (type) p.set('type', type); if (perf) p.set('performance', perf);
    if (dateRange) { p.set('createdFrom', dateRange[0].format('YYYY-MM-DD')); p.set('createdTo', dateRange[1].format('YYYY-MM-DD')); } p.set('sortBy', sortBy); p.set('sortDirection', sortDir); p.set('page', String(page)); p.set('pageSize', String(pageSize));
    return api(`/inventory/items?${p.toString()}`); } });

  const data = list.data || { rows: [], total: 0, page, pageSize };
  function refresh() { qc.invalidateQueries({ queryKey: ['/inventory/items'] }); }
  function clear() { setQ(''); setCategoryId(''); setType(''); setPerf(''); setDateRange(undefined); setPage(1); }

  async function onTableChange(pagination: any, _f: any, sorter: any) {
    setPage(pagination.current || 1); setPageSize(pagination.pageSize || 25);
    if (sorter?.field) { setSortBy(sorter.field); setSortDir(sorter.order === 'ascend' ? 'asc' : 'desc'); }
  }

  function openItem(item: any) {
    setEditing(item);
    if (item) form.setFieldsValue({ ...item, active: item.active, trackBatch: item.trackBatch, trackSerial: item.trackSerial, trackExpiry: item.trackExpiry, allowDiscount: item.allowDiscount });
    else form.resetFields();
    setDrawer(true);
  }
  async function saveItem() {
    const v = await form.validateFields().catch(() => null); if (!v) return;
    try {
      const payload = { ...v, type: v.type || 'INVENTORY', unit: v.unit || 'EA', categoryId: v.categoryId || undefined };
      if (editing) await api(`/inventory/items/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/inventory/items', { method: 'POST', body: JSON.stringify(payload) });
      message.success(editing ? 'Item updated' : 'Item created'); setDrawer(false); refresh();
    } catch (e: any) { message.error(e.message); }
  }
  async function saveCategory() {
    const v = await catForm.validateFields().catch(() => null); if (!v) return;
    try { const cat = await api('/inventory/categories', { method: 'POST', body: JSON.stringify({ ...v, parentId: v.parentId || undefined }) }); message.success('Category created'); setAddCat(false); catForm.resetFields(); qc.invalidateQueries({ queryKey: ['/inventory/categories'] }); qc.invalidateQueries({ queryKey: ['meta'] }); if (!editing) form.setFieldValue('categoryId', cat.id); } catch (e: any) { message.error(e.message); }
  }
  async function manageAction(action: string, cat: any) {
    try {
      if (action === 'deactivate') await api(`/inventory/categories/${cat.id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
      else if (action === 'activate') await api(`/inventory/categories/${cat.id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
      message.success('Updated'); qc.invalidateQueries({ queryKey: ['/inventory/categories'] }); refresh();
    } catch (e: any) { message.error(e.message); }
  }

  const catCols: any = [
    { title: 'Code', dataIndex: 'code', width: 90 }, { title: 'Category', dataIndex: 'name' },
    { title: 'Parent', render: (_: any, r: any) => categories.data?.find((c: any) => c.id === r.parentId)?.name || '—' },
    { title: 'Items', render: (_: any, r: any) => r._count?.items ?? 0 }, { title: 'Status', dataIndex: 'active', width: 90, render: (v: any) => (v ? 'Active' : 'Inactive') },
    { ...ACTIONS_COL, render: (_: any, r: any) => (
      <RowActionsMenu items={[
        { key: 'edit', label: 'Edit', icon: <EditOutlined />, onClick: () => { setManage(false); } },
        { key: 'deactivate', label: 'Deactivate', icon: <DeleteOutlined />, danger: true, hidden: !r.active, onClick: () => manageAction('deactivate', r) },
        { key: 'activate', label: 'Activate', hidden: r.active, onClick: () => manageAction('activate', r) },
      ]} />
    ) },
  ];

  const perfCols: ColumnsType<any> = [
    { title: 'SKU', dataIndex: 'sku', width: 100, sorter: true, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => router.push(`/inventory/items/${r.id}`)}>{v}</a> },
    { title: 'Item', dataIndex: 'name', sorter: true, render: (v: any, r: any) => <a className="font-medium text-[#171a2e] hover:text-[#003366] hover:underline cursor-pointer" onClick={() => router.push(`/inventory/items/${r.id}`)}>{v}</a> },
    { title: 'Category', dataIndex: 'categoryName', sorter: true, render: (_: any, r: any) => categories.data?.find((c: any) => c.id === r.categoryId)?.name || '—' },
    { title: 'Type', dataIndex: 'type', width: 110, sorter: true, render: (v: any) => <StatusTag value={v} /> },
    { title: 'Unit', dataIndex: 'unit', width: 70 },
    { title: 'Sales Price', dataIndex: 'sellingPrice', align: 'right', sorter: true, width: 100, render: (v: any) => <span className="font-semibold text-[#2563eb]">{fmtMoney(v)}</span> },
    { title: 'On Hand', dataIndex: 'onHand', align: 'right', sorter: true, width: 90, render: (v: any) => fmtNumber(v) },
    { title: 'Available', dataIndex: 'available', align: 'right', sorter: true, width: 100, render: (v: any) => <span className="font-semibold">{fmtNumber(v)}</span> },
    { title: 'Avg Cost', dataIndex: 'avgCost', align: 'right', sorter: true, width: 100, render: (v: any) => fmtMoney(v) },
    { title: 'Stock Value', dataIndex: 'value', align: 'right', sorter: true, width: 110, render: (v: any) => fmtMoney(v) },
    { title: 'Qty Sold (30d)', dataIndex: 'qtySold', align: 'right', sorter: true, width: 100, render: (v: any) => fmtNumber(v) },
    { title: 'Sales Perf.', dataIndex: 'performance', width: 130, sorter: true, render: (v: any) => <Tooltip title={`Last 30 days · Qty Sold ${fmtNumber(data.rows?.find((r: any) => r.performance === v)?.qtySold)}`}><PerfBadge value={v} /></Tooltip> },
    { title: 'Created', dataIndex: 'createdAt', width: 110, sorter: true, render: (v: any) => fmtDate(v) },
    { ...ACTIONS_COL, render: (_: any, r: any) => (
      <RowActionsMenu items={[
        { key: 'edit', label: 'Edit', icon: <EditOutlined />, onClick: () => router.push(`/inventory/items/${r.id}`) },
        { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, confirm: 'Delete?', onClick: async () => { try { await api(`/inventory/items/${r.id}`, { method: 'DELETE' }); message.success('Deleted'); refresh(); } catch (e: any) { message.error(e.message); } } },
      ]} />
    ) },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input allowClear prefix={<SearchOutlined style={{ color: '#a1a6c0' }} />} placeholder="Search items…" className="!w-80 !rounded-xl" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <div className="!w-56"><CategorySelect value={categoryId || undefined} onChange={(v) => { setCategoryId(v || ''); setPage(1); }} categories={categories.data || []} onAdd={() => { setAddCat(true); }} onManage={() => setManage(true)} /></div>
        <Select allowClear placeholder="Type" className="!min-w-[140px]" value={type || undefined} onChange={(v) => { setType(v || ''); setPage(1); }} options={ITEM_TYPES.map((t) => ({ label: t, value: t }))} />
        <Select allowClear placeholder="Sales Perf." className="!min-w-[150px]" value={perf || undefined} onChange={(v) => { setPerf(v || ''); setPage(1); }} options={['BEST_SELLER', 'SELLING', 'SLOW_MOVING', 'NO_SALES', 'NEW'].map((t) => ({ label: PERF_META[t].label, value: t }))} />
        <DatePicker.RangePicker className="!rounded-xl" value={dateRange} onChange={(v) => { setDateRange(v); setPage(1); }} placeholder={['Date from', 'Date to']} />
        <Button onClick={clear}>Clear</Button>
        <div className="ml-auto flex items-center gap-2">
          <Dropdown menu={{ items: ['sales-by-item', 'best-sellers', 'slow-moving', 'dead-stock', 'sales-by-category', 'stock-by-category'].map((k) => ({ key: k, label: k.replace(/-/g, ' ') })), onClick: ({ key }) => { setReports(key); } }} trigger={['click']}><Button icon={<FileTextOutlined />}>Reports ▾</Button></Dropdown>
          <Button icon={<ReloadOutlined />} onClick={refresh} /><Button type="primary" icon={<PlusOutlined />} onClick={() => openItem(null)}>+ Item</Button>
        </div>
      </div>
      <Table rowKey="id" loading={list.isLoading} dataSource={arr(data.rows)} columns={perfCols} scroll={{ x: true }} onChange={onTableChange}
        pagination={{ current: page, pageSize, total: data.total, showSizeChanger: true, showTotal: (t) => `${t} items` }} />

      <Drawer open={drawer} onClose={() => setDrawer(false)} title={editing ? 'Edit Item' : 'New Item'} destroyOnHidden width={680}
        extra={<Button onClick={() => setDrawer(false)}>Cancel</Button>}
        footer={<Space className="w-full justify-end"><Button onClick={() => setDrawer(false)}>Cancel</Button><Button type="primary" onClick={saveItem}>{editing ? 'Save Item' : 'Create Item'}</Button></Space>}>
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="SKU" name="sku"><Input /></Form.Item>
            <Form.Item label="Item Name" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Item Type" name="type" initialValue="INVENTORY"><Select options={ITEM_TYPES.map((t) => ({ label: t, value: t }))} /></Form.Item>
            <Form.Item label="Unit of Measure" name="unit" initialValue="EA"><Input /></Form.Item>
          </div>
          <Form.Item label="Category"><CategorySelect value={itemCatId} onChange={(v) => form.setFieldValue('categoryId', v)} categories={categories.data || []} onAdd={() => setAddCat(true)} onManage={() => setManage(true)} /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Sales Price" name="sellingPrice"><InputNumber prefix="$" className="w-full" /></Form.Item>
            <Form.Item label="Purchase Cost" name="purchaseCost"><InputNumber prefix="$" className="w-full" /></Form.Item>
            <Form.Item label="Reorder Level" name="reorderLevel"><InputNumber className="w-full" /></Form.Item>
            <Form.Item label="Min Selling Price" name="minSellingPrice"><InputNumber prefix="$" className="w-full" /></Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Default Warehouse" name="defaultWarehouseId"><Select allowClear options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} /></Form.Item>
            <Form.Item label="Preferred Supplier" name="preferredSupplierId"><Select allowClear options={(meta.data?.suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))} /></Form.Item>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Form.Item label="Track Batch" name="trackBatch" valuePropName="checked"><Checkbox /></Form.Item>
            <Form.Item label="Track Serial" name="trackSerial" valuePropName="checked"><Checkbox /></Form.Item>
            <Form.Item label="Active" name="active" valuePropName="checked"><Checkbox /></Form.Item>
          </div>
        </Form>
      </Drawer>

      <Modal open={addCat} onCancel={() => setAddCat(false)} onOk={saveCategory} okText="Create" title="New Category">
        <Form form={catForm} layout="vertical" className="mt-2">
          <Form.Item label="Category Name" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Category Code" name="code"><Input placeholder="e.g. NET" /></Form.Item>
            <Form.Item label="Parent Category" name="parentId"><CategorySelect value={catParentId} onChange={(v) => catForm.setFieldValue('parentId', v)} categories={categories.data || []} onAdd={() => setAddCat(false)} onManage={() => setManage(false)} /></Form.Item>
          </div>
          <Form.Item label="Description" name="description"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={manage} onCancel={() => setManage(false)} footer={null} title="Manage Categories" width={720}>
        <Table rowKey="id" dataSource={arr(categories.data)} columns={catCols} pagination={false} size="small" />
      </Modal>

      <ReportsModal reportKey={reports} onClose={() => setReports('')} />
    </div>
  );
}

function ReportsModal({ reportKey, onClose }: { reportKey: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['/inventory/reports', reportKey], queryFn: () => api(`/inventory/reports/${reportKey}`), enabled: !!reportKey });
  const router = useRouter();
  if (!reportKey) return null;
  const data = q.data || [];
  const base = { title: 'SKU', dataIndex: 'sku', width: 100, render: (v: any, r: any) => <a className="text-[#2563eb] hover:underline cursor-pointer" onClick={() => r.itemId && router.push(`/inventory/items/${r.itemId}`)}>{v}</a> };
  const cols: ColumnsType<any> = reportKey === 'sales-by-item' ? [
    base, { title: 'Item', dataIndex: 'name' }, { title: 'Category', dataIndex: 'category' }, { title: 'Qty Sold', dataIndex: 'qty', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Net Sales', dataIndex: 'net', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Invoices', dataIndex: 'invoiceCount', align: 'right' }, { title: 'Last Sale', dataIndex: 'lastSale', render: (v: any) => (v ? fmtDate(v) : '—') },
  ] : reportKey === 'best-sellers' ? [
    { title: 'Rank', dataIndex: 'rank', width: 60 }, base, { title: 'Item', dataIndex: 'name' }, { title: 'Qty Sold', dataIndex: 'qty', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Net Sales', dataIndex: 'net', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Available', dataIndex: 'available', align: 'right', render: (v: any) => fmtNumber(v) },
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
    <Modal open onCancel={onClose} footer={null} width={860} title={`Report: ${reportKey.replace(/-/g, ' ')}`}>
      <Table rowKey="id" size="small" loading={q.isLoading} dataSource={arr(data)} columns={cols} pagination={false} scroll={{ x: true }}
        expandable={reportKey === 'sales-by-item' ? { expandedRowRender: (r: any) => <Table size="small" rowKey="invoiceId" dataSource={r.sales || []} pagination={false} columns={[{ title: 'Invoice', dataIndex: 'invoiceNo', render: (v: any, x: any) => <a className="text-[#2563eb] cursor-pointer" onClick={() => router.push(`/sales/invoices/${x.invoiceId}/edit`)}>{v}</a> }, { title: 'Date', dataIndex: 'date', render: fmtDate }, { title: 'Customer', dataIndex: 'customer' }, { title: 'Qty', dataIndex: 'qty', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) }]} /> } : undefined } />
    </Modal>
  );
}

