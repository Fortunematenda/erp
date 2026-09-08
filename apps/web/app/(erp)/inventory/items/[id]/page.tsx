'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, Descriptions, Empty, Space, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined, DollarOutlined, EditOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { StatusTag } from '@/components/crud-page';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';

export default function ItemDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ['/inventory/items', id], queryFn: () => api(`/inventory/items/${id}`) });
  const sales = useQuery({ queryKey: ['/inventory/reports/sales-by-item', id], queryFn: () => api(`/inventory/reports/sales-by-item?itemId=${id}`) });
  const [tab, setTab] = useState('overview');
  if (isLoading) return <div className="p-8 text-[#8a90ad]">Loading item…</div>;
  if (!data) return <Empty description="Item not found" />;
  const { item, stock, total, movements, priceListItems } = data;
  const perf = (sales.data || [])[0] || { qty: 0, net: 0, invoiceCount: 0, lastSale: null, sales: [] };

  const detailRows = [
    { label: 'SKU', value: item.sku }, { label: 'Name', value: item.name }, { label: 'Type', value: item.type },
    { label: 'Category', value: item.itemCategory }, { label: 'Unit', value: item.unit }, { label: 'Barcode', value: item.barcode },
    { label: 'Brand', value: item.brand }, { label: 'HS Code', value: item.hsCode },
    { label: 'Sales Price', value: <span className="font-semibold text-[#2563eb]">{fmtMoney(item.sellingPrice)}</span> },
    { label: 'Purchase Cost', value: <span className="text-[#f97316]">{fmtMoney(item.purchaseCost)}</span> },
    { label: 'Avg Cost (value)', value: <span className="text-[#8b5cf6]">{fmtMoney(total.avgCost)}</span> },
    { label: 'On Hand', value: fmtNumber(total.onHand) }, { label: 'Reserved', value: fmtNumber(total.reserved) },
    { label: 'Available', value: <span className="font-semibold">{fmtNumber(total.available)}</span> },
    { label: 'Stock Value', value: fmtMoney(total.value) },
    { label: 'Costing Method', value: item.costingMethod || 'WEIGHTED_AVERAGE' },
    { label: 'Sales Tax', value: item.salesTaxCode || '—' }, { label: 'Purchase Tax', value: item.purchaseTaxCode || '—' },
    { label: 'Status', value: item.active ? 'ACTIVE' : 'INACTIVE' },
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
    { title: 'Unit Cost', dataIndex: 'unitCost', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Reference', dataIndex: 'reference' },
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
    { key: 'overview', label: 'Overview', children: <Descriptions column={3} size="small" bordered items={detailRows.map((v) => ({ key: v.label, label: v.label, children: <span className="text-[13px]">{v.value}</span> }))} /> },
    { key: 'stock', label: 'Stock', children: <Table rowKey="warehouseId" dataSource={stock} columns={stockCols} pagination={false} size="small" /> },
    { key: 'sales', label: 'Sales', children: <Table rowKey="invoiceId" dataSource={perf.sales || []} columns={salesCols} pagination={false} size="small" /> },
    { key: 'pricing', label: 'Pricing', children: <Table rowKey="id" dataSource={priceListItems} columns={priceCols} pagination={false} size="small" /> },
    { key: 'movements', label: 'Movements', children: <Table rowKey="id" dataSource={movements} columns={moveCols} pagination={false} size="small" /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Button shape="circle" icon={<ArrowLeftOutlined />} onClick={() => router.back()} />
          <div>
            <div className="flex items-center gap-2"><h1 className="text-[24px] font-bold text-[#171a2e]">{item.name}</h1><Tag style={{ borderRadius: 8 }}>{item.sku}</Tag><StatusTag value={item.type} /></div>
            <div className="text-[13px] text-[#64748b]">{item.itemCategory || item.unit} · {item.brand || '—'}</div>
          </div>
        </div>
        <Space wrap>
          <Button icon={<EditOutlined />} onClick={() => router.push('/inventory')}>Edit</Button>
          <Button icon={<DollarOutlined />} onClick={() => router.push('/inventory')}>+ Adjustment</Button>
        </Space>
      </div>
      <div className="nex-card mb-5 px-5 py-4 flex flex-wrap gap-8 !rounded-xl">
        {[{ l: 'Sales Price', v: fmtMoney(item.sellingPrice), c: '#2563eb' }, { l: 'Qty Sold 30d', v: fmtNumber(perf.qty), c: '#003366' }, { l: 'Net Sales 30d', v: fmtMoney(perf.net), c: '#16a34a' }, { l: 'Last Sale', v: perf.lastSale ? fmtDate(perf.lastSale) : 'Never', c: '#f59e0b' }, { l: 'Purchase Cost', v: fmtMoney(item.purchaseCost), c: '#f97316' }, { l: 'Avg Cost', v: fmtMoney(total.avgCost), c: '#8b5cf6' }, { l: 'On Hand', v: fmtNumber(total.onHand), c: '#003366' }, { l: 'Available', v: fmtNumber(total.available), c: '#16a34a' }, { l: 'Stock Value', v: fmtMoney(total.value), c: '#f59e0b' }].map((k) => (<div key={k.l}><div className="text-[12px] text-[#64748b]">{k.l}</div><div className="text-[18px] font-bold" style={{ color: k.c }}>{k.v}</div></div>))}
      </div>
      <Card className="nex-card" styles={{ body: { padding: '14px 20px' } }}><Tabs items={tabs} activeKey={tab} onChange={setTab} destroyOnHidden /></Card>
    </div>
  );
}
