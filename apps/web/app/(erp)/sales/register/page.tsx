'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Empty, Input, Select, Skeleton, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BankOutlined, FileDoneOutlined, FileTextOutlined, GiftOutlined, ReloadOutlined, SearchOutlined, ShoppingCartOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { SoftBadge, statusTone } from '@/components/crud-page';
import { SummaryCard } from '@/components/sales-ui';

const TYPE_OPTIONS = [
  { label: 'All types', value: '' },
  { label: 'Quotes', value: 'Quote' },
  { label: 'Orders', value: 'Order' },
  { label: 'Invoices', value: 'Invoice' },
  { label: 'Payments', value: 'Payment' },
  { label: 'Credit Notes', value: 'Credit Note' },
];

const TYPE_TONE: Record<string, { tone: string; label: string; icon: React.ReactNode }> = {
  'Quote': { tone: 'blue', label: 'Quote', icon: <FileTextOutlined /> },
  'Order': { tone: 'indigo', label: 'Order', icon: <ShoppingCartOutlined /> },
  'Invoice': { tone: 'purple', label: 'Invoice', icon: <FileDoneOutlined /> },
  'Payment': { tone: 'green', label: 'Payment', icon: <BankOutlined /> },
  'Credit Note': { tone: 'amber', label: 'Credit Note', icon: <GiftOutlined /> },
};

const PAGE_SIZE = 25;

export default function SalesRegisterPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [range, setRange] = useState<any>(null);

  const qs = useMemo(() => {
    const p: string[] = [`page=${page}`, `pageSize=${PAGE_SIZE}`];
    if (search) p.push(`search=${encodeURIComponent(search)}`);
    if (type) p.push(`type=${encodeURIComponent(type)}`);
    if (range?.[0]) p.push(`dateFrom=${range[0].format('YYYY-MM-DD')}`);
    if (range?.[1]) p.push(`dateTo=${range[1].format('YYYY-MM-DD')}`);
    return `?${p.join('&')}`;
  }, [page, search, type, range]);

  const q = useQuery({ queryKey: ['sales-register', qs], queryFn: () => api(`/sales/register${qs}`) });

  const summary = q.data?.summary;
  const summaryCards = [
    { label: 'Quotes', value: summary?.quotesAmount, icon: <FileTextOutlined />, tone: '#2563eb' },
    { label: 'Orders', value: summary?.ordersAmount, icon: <ShoppingCartOutlined />, tone: '#4338ca' },
    { label: 'Invoices', value: summary?.invoicesAmount, icon: <FileDoneOutlined />, tone: '#7c3aed' },
    { label: 'Payments', value: summary?.paymentsAmount, icon: <BankOutlined />, tone: '#16a34a' },
    { label: 'Credit Notes', value: summary?.creditNotesAmount, icon: <GiftOutlined />, tone: '#b45309' },
  ];

  const columns: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'date', width: 110, render: (v) => <span className="text-[13px] text-[#475060]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Type', dataIndex: 'type', width: 140, render: (v: string) => { const c = TYPE_TONE[v] || TYPE_TONE['Quote']; return <SoftBadge tone={c.tone}>{c.label}</SoftBadge>; } },
    { title: 'Number', dataIndex: 'number', render: (v) => <span className="font-mono text-[12px] font-semibold text-[#003366]">{v}</span> },
    { title: 'Customer', dataIndex: 'customer', render: (v) => <span className="text-[13px] text-[#3c4263]">{v || '—'}</span> },
    { title: 'Memo', dataIndex: 'memo', ellipsis: true, render: (v) => <span className="text-[12px] text-[#94a3b8]">{v || '—'}</span> },
    { title: 'Status', dataIndex: 'status', width: 130, render: (v: string) => <SoftBadge tone={statusTone(v)}>{String(v || 'Draft').replace(/_/g, ' ')}</SoftBadge> },
    { title: 'Amount', dataIndex: 'amount', width: 130, align: 'right', render: (v: number) => <span className={`text-[14px] font-bold ${v < 0 ? 'text-[#dc2626]' : 'text-[#171a2e]'}`}>{fmtMoney(v)}</span> },
  ];

  const resetPage = () => setPage(1);

  return (
    <div className="nex-fade">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-5">
        {summaryCards.map((c) => (
          <SummaryCard key={c.label} icon={c.icon} label={c.label} value={q.isLoading ? '—' : fmtMoney(c.value || 0)} tone={c.tone} />
        ))}
      </div>

      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search number, customer, memo…"
          className="w-72 !rounded-xl"
          value={search}
          onChange={(e) => { setSearch(e.target.value); resetPage(); }}
        />
        <Select
          className="!min-w-[150px] !rounded-xl"
          value={type}
          options={TYPE_OPTIONS}
          onChange={(v) => { setType(v); resetPage(); }}
        />
        <DatePicker.RangePicker className="!rounded-xl" value={range} onChange={(v) => { setRange(v); resetPage(); }} />
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['sales-register'] })} />
        <span className="ml-auto text-[12px] text-[#94a3b8]">{q.data?.total ?? 0} records</span>
      </div>

      <div className="nex-card">
        <Table
          size="middle"
          rowKey={(r: any) => `${r.sourceId}`}
          loading={q.isLoading}
          dataSource={q.data?.data || []}
          columns={columns}
          scroll={{ x: true }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No sales records" /> }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total || 0, showSizeChanger: false, onChange: setPage, showTotal: (t: number) => `${t} records` }}
        />
      </div>
    </div>
  );
}

