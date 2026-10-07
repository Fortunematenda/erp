'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DatePicker, Input, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { MetricStrip } from '@/components/metric-strip';

const { RangePicker } = DatePicker;
const MOVE_TYPES = ['RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_IN', 'RETURN_OUT'];

export function ItemHistory({ itemId }: { itemId: string }) {
  const router = useRouter();
  const meta = useMeta();
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<any>(null);

  const params = new URLSearchParams();
  if (warehouseId) params.set('warehouseId', warehouseId);
  if (type) params.set('type', type);
  if (q) params.set('q', q);
  if (range?.[0]) params.set('from', range[0].startOf('day').toISOString());
  if (range?.[1]) params.set('to', range[1].endOf('day').toISOString());
  const qs = params.toString();

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['/inventory/items', itemId, 'history', qs], queryFn: () => api(`/inventory/items/${itemId}/history${qs ? `?${qs}` : ''}`) });

  const s = data?.summary || {};
  const stockTracked = data?.item?.stockTracked !== false;

  const cols: ColumnsType<any> = [
    { title: 'Date/Time', dataIndex: 'occurredAt', width: 150, render: (v) => fmtDateTime(v) },
    { title: 'Transaction', dataIndex: 'type', width: 130, render: (v) => <Tag>{String(v).replace(/_/g, ' ')}</Tag> },
    { title: 'Reference', dataIndex: 'reference', width: 140, render: (v, r: any) => r.sourceRoute ? <a className="text-[#1d5fb5]" onClick={() => router.push(r.sourceRoute)}>{v}</a> : (v || '—') },
    { title: 'Counterparty', dataIndex: 'counterparty', width: 150, render: (v) => v || '—' },
    { title: 'Warehouse', dataIndex: 'warehouse', width: 120, render: (v) => v || '—' },
    { title: 'Qty In', dataIndex: 'qtyIn', width: 90, align: 'right', render: (v) => v ? <span className="text-[#16a34a]">{fmtNumber(v)}</span> : '' },
    { title: 'Qty Out', dataIndex: 'qtyOut', width: 90, align: 'right', render: (v) => v ? <span className="text-[#e11d48]">-{fmtNumber(v)}</span> : '' },
    { title: 'Running Balance', dataIndex: 'runningBalance', width: 130, align: 'right', render: (v) => <span className="font-semibold">{fmtNumber(v)}</span> },
    { title: 'Unit Cost', dataIndex: 'unitCost', width: 100, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Value Change', dataIndex: 'valueChange', width: 110, align: 'right', render: (v) => <span className={Number(v) < 0 ? 'text-[#e11d48]' : 'text-[#16a34a]'}>{fmtMoney(v)}</span> },
    { title: 'Source', dataIndex: 'sourceLabel', width: 110, render: (v) => v || '—' },
  ];

  if (isError) return <div className="p-4 text-[#e11d48]">Could not load history. <a onClick={() => refetch()} className="text-[#1d5fb5]">Retry</a></div>;

  return (
    <div>
      <MetricStrip
        className="mb-4"
        items={[
          { label: 'Current Stock', value: fmtNumber(s.currentStock), color: '#003366' },
          { label: 'Period Opening', value: fmtNumber(s.periodOpening), color: '#64748b' },
          { label: 'Received', value: fmtNumber(s.received), color: '#16a34a' },
          { label: 'Issued', value: fmtNumber(s.issued), color: '#e11d48' },
          { label: 'Net Adjustments', value: fmtNumber(s.netAdjustments), color: '#f59e0b' },
          { label: 'Returns', value: fmtNumber(s.returns), color: '#8b5cf6' },
          { label: 'Inventory Value', value: fmtMoney(s.inventoryValue), color: '#0ea5e9' },
          { label: 'Avg Cost', value: fmtMoney(s.avgCost), color: '#f97316' },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <RangePicker onChange={(v) => setRange(v)} />
        <Select allowClear placeholder="Warehouse" style={{ width: 170 }} value={warehouseId} onChange={setWarehouseId} options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} />
        <Select allowClear placeholder="Transaction type" style={{ width: 180 }} value={type} onChange={setType} options={MOVE_TYPES.map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} />
        <Input allowClear placeholder="Search reference / party" style={{ width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!stockTracked && <div className="text-[12px] text-[#94a3b8] mb-2">This item is not stock-tracked; no quantity or valuation movements apply.</div>}
      <Table rowKey="id" size="small" loading={isLoading} dataSource={data?.rows || []} columns={cols} pagination={{ pageSize: 15 }} scroll={{ x: 1200 }} />
    </div>
  );
}
