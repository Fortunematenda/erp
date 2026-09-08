'use client';
import { useQuery } from '@tanstack/react-query';
import { CrudPage, type Kpi } from '@/components/crud-page';
import { AccountBookOutlined, DollarOutlined, FundOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';

export default function BudgetsPage() {
  const list = useQuery({ queryKey: ['/finance/budgets'], queryFn: () => api('/finance/budgets') });
  const total = (list.data || []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const kpis: Kpi[] = [
    { label: 'Budgets', value: list.data?.length || 0, icon: <AccountBookOutlined />, color: '#003366' },
    { label: 'Total budgeted', value: fmtMoney(total), icon: <DollarOutlined />, color: '#0ea5e9' },
    { label: 'Years covered', value: [...new Set((list.data || []).map((r: any) => r.year))].length, icon: <FundOutlined />, color: '#10b981' },
  ];

  return (
    <CrudPage title="Budgets" subtitle="Set budget amounts per account and period" path="/finance/budgets" createLabel="Budget" canDelete kpis={kpis}
      columns={[
        { title: 'Account', render: (_, r: any) => <span className="font-medium">{r.account?.code} — {r.account?.name}</span> },
        { title: 'Year', dataIndex: 'year', width: 100 },
        { title: 'Period', dataIndex: 'period', width: 100, render: (v) => v || <span className="text-[#c3c7dc]">Year</span> },
        { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v) => <span className="font-semibold">{fmtMoney(v)}</span> },
      ]}
      fields={[
        { name: 'year', label: 'Year', type: 'number', required: true, defaultValue: new Date().getFullYear() },
        { name: 'period', label: 'Period (blank = yearly)', type: 'number' },
        { name: 'accountId', label: 'Account', type: 'select', metaKey: 'accounts', metaLabel: 'name', required: true },
        { name: 'amount', label: 'Budget amount', type: 'money', required: true },
      ]}
    />
  );
}
