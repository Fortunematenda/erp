'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { Can } from '@/components/Can';
import { FinanceSummaryCard } from '@/components/finance-ui';

export default function VatReportPage() {
  const [range, setRange] = useState<any>([dayjs().startOf('month'), dayjs()]);
  const q = useQuery({ queryKey: ['/finance/vat-report', range?.[0]?.format('YYYY-MM-DD'), range?.[1]?.format('YYYY-MM-DD')], queryFn: () => api(`/finance/tax/vat-report?from=${range?.[0]?.format('YYYY-MM-DD') || ''}&to=${range?.[1]?.format('YYYY-MM-DD') || ''}`) });
  const d = q.data;

  const rows: any[] = [
    { label: 'Output VAT (sales)', amount: d?.outputVAT || 0, color: '#2563eb' },
    { label: 'Input VAT (purchases)', amount: d?.inputVAT || 0, color: '#16a34a' },
    { label: 'Net VAT Payable / Receivable', amount: d?.netVAT || 0, color: (d?.netVAT || 0) >= 0 ? '#003366' : '#f97316' },
  ];

  const cols: ColumnsType<any> = [
    { title: 'Section', dataIndex: 'label' },
    { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v) => <span className="text-[14px] font-semibold" style={{ color: v < 0 ? '#EF4444' : '#171a2e' }}>{fmtMoney(v)}</span> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">VAT Report</h1><p className="text-[13px] text-[#64748b] mt-1">Output and input VAT from posted transactions</p></div>
        <Can permission="finance.tax.manage">
          <div className="flex gap-2">
            <DatePicker.RangePicker className="!rounded-lg" value={range} onChange={setRange} />
            <Button icon={<ReloadOutlined />} onClick={() => q.refetch()} />
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
          </div>
        </Can>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <FinanceSummaryCard label="Output VAT" value={fmtMoney(d?.outputVAT || 0)} valueColor="#2563eb" />
        <FinanceSummaryCard label="Input VAT" value={fmtMoney(d?.inputVAT || 0)} valueColor="#16A34A" />
        <FinanceSummaryCard label="Net VAT" value={fmtMoney(d?.netVAT || 0)} valueColor={(d?.netVAT || 0) >= 0 ? '#003366' : '#F97316'} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <FinanceSummaryCard label="Taxable Sales" value={fmtMoney(d?.taxableSales || 0)} valueColor="#2563eb" />
        <FinanceSummaryCard label="Taxable Purchases" value={fmtMoney(d?.taxablePurchases || 0)} valueColor="#16A34A" />
        <FinanceSummaryCard label="Period" value={range?.[0] ? `${dayjs(range[0]).format('DD MMM')} – ${dayjs(range[1]).format('DD MMM YYYY')}` : 'All'} valueColor="#64748b" />
      </div>
      <div className="nex-card"><Table rowKey="label" dataSource={rows} columns={cols} pagination={false} /></div>
    </div>
  );
}

