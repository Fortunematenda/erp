'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, Descriptions, Empty, Space, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined, DollarOutlined, EditOutlined, SwapOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { StatusTag } from '@/components/crud-page';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { ItemFormDrawer } from '@/components/inventory/item-form-drawer';
import { StockAdjustmentDrawer } from '@/components/inventory/stock-adjustment-drawer';
import { TransferDrawer } from '@/components/inventory/transfer-drawer';
import { ITEM_TYPE_BADGE, ITEM_TYPE_TONE, TRACKING_TONE, isStockTracked, itemTypeLabel, normalizeItemType, trackingLabel, trackingStatus } from '@/lib/item-type';

export default function ItemDetail() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['/inventory/items', id], queryFn: () => api(`/inventory/items/${id}`) });
  const sales = useQuery({ queryKey: ['/inventory/reports/sales-by-item', id], queryFn: () => api(`/inventory/reports/sales-by-item?itemId=${id}`) });
  const [tab, setTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  if (isLoading) return <div className="p-8 text-[#8a90ad]">Loading item…</div>;
  if (!data) return <Empty description="Item not found" />;
  const { item, stock, total, movements, priceListItems, typeLocked } = data;
  const perf = (sales.data || [])[0] || { qty: 0, net: 0, invoiceCount: 0, lastSale: null, sales: [] };
  const tracked = isStockTracked(item.type);
  const typeNorm = normalizeItemType(item.type);

  async function refresh() {
    await Promise.all([
      refetch(),
      qc.invalidateQueries({ queryKey: ['/inventory/items'] }),
      qc.invalidateQueries({ queryKey: ['/inventory/stock'] }),
      qc.invalidateQueries({ queryKey: ['/inventory/movements'] }),
      qc.invalidateQueries({ queryKey: ['/inventory/valuation'] }),
    ]);
  }

  const detailRows = [
    { label: 'SKU / Code', value: item.sku },
    { label: 'Name', value: item.name },
    { label: 'Item Type', value: itemTypeLabel(item.type) },
    { label: 'Tracking', value: <Tag color={TRACKING_TONE[trackingStatus(item.type)]}>{trackingLabel(item.type)}</Tag> },
    { label: 'Category', value: item.itemCategory || '—' },
    { label: 'Unit', value: item.unit },
    ...(tracked ? [{ label: 'Barcode', value: item.barcode || '—' }, { label: 'Brand', value: item.brand || '—' }, { label: 'HS Code', value: item.hsCode || '—' }] : []),
    { label: 'Description', value: item.description || '—' },
    ...(tracked ? [
      { label: 'Costing Method', value: item.costingMethod || 'WEIGHTED_AVERAGE' },
      { label: 'Reorder Level', value: fmtNumber(item.reorderLevel) },
      { label: 'Committed (Reserved)', value: fmtNumber(total.reserved) },
      { label: 'Incoming', value: fmtNumber(data.incoming ?? 0) },
    ] : []),
    { label: 'Sales Tax', value: item.salesTaxCode || '—' },
    { label: 'Purchase Tax', value: item.purchaseTaxCode || '—' },
    { label: 'Status', value: item.active ? 'ACTIVE' : 'ARCHIVED' },
  ];

  const stockCols: ColumnsType<any> = [
    { title: 'Warehouse', dataIndex: 'warehouse' }, { title: 'On Hand', dataIndex: 'onHand', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Reserved', dataIndex: 'reserved', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Available', dataIndex: 'available', align: 'right', render: (v: any) => <span className="font-semibold">{fmtNumber(v)}</span> },
    { title: 'Unit Cost', dataIndex: 'unitCost', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Value', dataIndex: 'value', align: 'right', render: (v: any) => fmtMoney(v) },
  ];
  const moveCols: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'occurredAt', width: 110, render: fmtDate }, { title: 'Warehouse', render: (_: any, r: any) => r.warehouse?.name || '—' },
    { title: 'Type', dataIndex: 'type', width: 140, render: (v: any) => <StatusTag value={v} /> }, { title: 'Qty', dataIndex: 'quantity', align: 'right', render: (v: any) => fmtNumber(v) },
        { title: 'Unit Cost', dataIndex: 'unitCost', align: 'right', render: (v: any) => fmtMoney(v) },
        { title: 'Reference', dataIndex: 'reference' },
        { title: 'Notes', dataIndex: 'notes', ellipsis: true },
  ];
  const salesCols: ColumnsType<any> = [
    { title: 'Invoice', dataIndex: 'invoiceNo', render: (v: any, r: any) => <a className="text-[#2563eb] cursor-pointer" onClick={() => router.push(`/sales/invoices/${r.invoiceId}/edit`)}>{v}</a> },
    { title: 'Date', dataIndex: 'date', render: fmtDate }, { title: 'Customer', dataIndex: 'customer' },
    { title: 'Qty', dataIndex: 'qty', align: 'right', render: (v: any) => fmtNumber(v) }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) },
  ];
  const priceCols: ColumnsType<any> = [
    { title: 'Price List', render: (_: any, r: any) => r.priceList?.name }, { title: 'Price', dataIndex: 'price', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Currency', render: (_: any, r: any) => r.priceList?.currency || 'USD' },
    { title: 'Active', render: (_: any, r: any) => (r.priceList?.active ? 'Yes' : 'No') },
  ];

  const tabs = [
    { key: 'overview', label: 'Details', children: <Descriptions column={3} size="small" bordered items={detailRows.map((v) => ({ key: v.label, label: v.label, children: <span className="text-[13px]">{v.value ?? '—'}</span> }))} /> },
    ...(tracked ? [
      { key: 'stock', label: 'Stock', children: <Table rowKey="warehouseId" dataSource={stock} columns={stockCols} pagination={false} size="small" /> },
      { key: 'movements', label: 'Movements', children: <Table rowKey="id" dataSource={movements} columns={moveCols} pagination={false} size="small" /> },
    ] : []),
    { key: 'sales', label: 'Sales', children: <Table rowKey="invoiceId" dataSource={perf.sales || []} columns={salesCols} pagination={false} size="small" /> },
    { key: 'pricing', label: 'Pricing', children: <Table rowKey="id" dataSource={priceListItems} columns={priceCols} pagination={false} size="small" /> },
  ];

  const kpis = [
    { l: 'Sales Price', v: fmtMoney(item.sellingPrice), c: '#2563eb' },
    { l: 'Qty Sold 30d', v: fmtNumber(perf.qty), c: '#003366' },
    { l: 'Net Sales 30d', v: fmtMoney(perf.net), c: '#16a34a' },
    { l: 'Last Sale', v: perf.lastSale ? fmtDate(perf.lastSale) : 'Never', c: '#f59e0b' },
    { l: tracked ? 'Purchase Cost' : 'Cost / Rate', v: fmtMoney(item.purchaseCost), c: '#f97316' },
    ...(tracked ? [
      { l: 'Avg Cost', v: fmtMoney(total.avgCost), c: '#8b5cf6' },
      { l: 'On Hand', v: fmtNumber(total.onHand), c: '#003366' },
      { l: 'Available', v: fmtNumber(total.available), c: '#16a34a' },
      { l: 'Stock Value', v: fmtMoney(total.value), c: '#f59e0b' },
    ] : []),
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Button shape="circle" icon={<ArrowLeftOutlined />} onClick={() => router.push('/inventory')} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[24px] font-bold text-[#171a2e]">{item.name}</h1>
              <Tag style={{ borderRadius: 8 }}>{item.sku}</Tag>
              <Tag color={ITEM_TYPE_TONE[typeNorm]}>{ITEM_TYPE_BADGE[typeNorm]}</Tag>
              <Tag color={TRACKING_TONE[trackingStatus(item.type)]}>{trackingLabel(item.type)}</Tag>
            </div>
            <div className="text-[13px] text-[#64748b]">{[itemTypeLabel(item.type), `Tracking: ${trackingLabel(item.type)}`, item.itemCategory, item.brand].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <Space wrap>
          <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>Edit</Button>
          {tracked && (
            <>
              <Button icon={<DollarOutlined />} type="primary" onClick={() => setAdjustOpen(true)}>Adjust Stock</Button>
              <Button icon={<SwapOutlined />} onClick={() => setTransferOpen(true)}>Transfer</Button>
            </>
          )}
        </Space>
      </div>
      <div className="nex-card mb-5 px-5 py-4 flex flex-wrap gap-8 !rounded-xl">
        {kpis.map((k) => (<div key={k.l}><div className="text-[12px] text-[#64748b]">{k.l}</div><div className="text-[18px] font-bold" style={{ color: k.c }}>{k.v}</div></div>))}
      </div>
      <Card className="nex-card" styles={{ body: { padding: '14px 20px' } }}><Tabs items={tabs} activeKey={tab} onChange={setTab} destroyOnHidden /></Card>

      <ItemFormDrawer open={editOpen} itemId={item.id} initial={{ ...item, typeLocked }} onClose={() => setEditOpen(false)} onSaved={() => refresh()} />
      {tracked && (
        <>
          <StockAdjustmentDrawer open={adjustOpen} itemId={item.id} onClose={() => setAdjustOpen(false)} onDone={refresh} />
          <TransferDrawer open={transferOpen} itemId={item.id} onClose={() => setTransferOpen(false)} onDone={refresh} />
        </>
      )}
    </div>
  );
}
