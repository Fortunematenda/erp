'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Tabs, message } from 'antd';
import { BankOutlined, CheckCircleOutlined, DollarOutlined, ToolOutlined, WarningOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { CrudPage, StatusTag } from '@/components/crud-page';
import { StatCard } from '@/components/stat-card';
import { fmtDate, fmtMoney } from '@/lib/format';

export default function Assets() {
  const qc = useQueryClient();
  const register = useQuery({ queryKey: ['/assets'], queryFn: () => api('/assets') });
  const maintenance = useQuery({ queryKey: ['/assets/maintenance'], queryFn: () => api('/assets/maintenance') });

  const bookValue = (register.data || []).reduce((s: number, r: any) => s + Number(r.bookValue ?? Number(r.cost) - Number(r.accumulatedDepreciation || 0)), 0);
  const active = (register.data || []).filter((r: any) => r.status === 'ACTIVE').length;
  const scheduled = (maintenance.data || []).filter((r: any) => r.status === 'SCHEDULED').length;

  const items = [
    { key: 'register', label: 'Asset Register', children: <CrudPage title="Asset Register" path="/assets" createLabel="Asset" canDelete
      columns={[
        { title: 'Asset No', dataIndex: 'assetNo', width: 110 }, { title: 'Asset', dataIndex: 'name' }, { title: 'Category', dataIndex: 'category', width: 120 },
        { title: 'Location', dataIndex: 'location', width: 120 }, { title: 'Cost', dataIndex: 'cost', align: 'right', render: (v: any) => fmtMoney(v) },
        { title: 'Book Value', align: 'right', render: (_v: any, r: any) => fmtMoney(Number(r.bookValue ?? Number(r.cost) - Number(r.accumulatedDepreciation || 0))) },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
      ]}
      fields={[
        { name: 'assetNo', label: 'Asset no' }, { name: 'name', label: 'Name', required: true },
        { name: 'category', label: 'Category', required: true, options: ['VEHICLE', 'MACHINERY', 'EQUIPMENT', 'FURNITURE', 'BUILDING', 'COMPUTER', 'OTHER'].map((c) => ({ label: c, value: c })), type: 'select' },
        { name: 'location', label: 'Location' }, { name: 'purchaseDate', label: 'Purchase date', type: 'date' },
        { name: 'cost', label: 'Cost', type: 'money', required: true }, { name: 'salvageValue', label: 'Salvage value', type: 'money' },
        { name: 'usefulLife', label: 'Useful life (years)', type: 'number' },
      ]}
      rowActions={[
        { key: 'edit', label: 'Edit', type: 'default' },
        { key: 'depreciate', label: 'Depreciate', type: 'default', show: (r) => r.status === 'ACTIVE', url: (r) => `/assets/${r.id}/depreciate`, extraInvalidate: ['/finance/journals'] },
        { key: 'dispose', label: 'Dispose', type: 'default', show: (r) => r.status === 'ACTIVE', url: (r) => `/assets/${r.id}/dispose`, body: () => ({ proceeds: 0, reason: 'Disposed' }), confirm: 'Dispose this asset? (posts GL gain/loss)' },
      ]}
      extra={<Button type="primary" icon={<DollarOutlined />} onClick={() => api('/assets/depreciation-run', { method: 'POST' }).then(() => { message.success('Depreciation run posted'); qc.invalidateQueries({ queryKey: ['/assets'] }); qc.invalidateQueries({ queryKey: ['/finance/journals'] }); }).catch((e) => message.error(e.message))}>Run Depreciation</Button>}
    /> },
    { key: 'maintenance', label: 'Maintenance', children: <CrudPage title="Asset Maintenance" path="/assets/maintenance" createLabel="Job" canDelete
      columns={[
        { title: 'Asset', render: (_, r: any) => r.asset?.name || r.assetId }, { title: 'Scheduled', dataIndex: 'scheduledDate', width: 110, render: fmtDate },
        { title: 'Completed', dataIndex: 'completedDate', width: 110, render: (v: any) => (v ? fmtDate(v) : '—') },
        { title: 'Cost', dataIndex: 'cost', align: 'right', render: (v: any) => fmtMoney(v) },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v: any) => <StatusTag value={v} /> },
      ]}
      fields={[
        { name: 'assetId', label: 'Asset', type: 'select', selectPath: '/assets', selectLabel: (r: any) => `${r.assetNo || ''} — ${r.name}`, required: true },
        { name: 'scheduledDate', label: 'Scheduled date', type: 'date', required: true }, { name: 'completedDate', label: 'Completed date', type: 'date' },
        { name: 'description', label: 'Description', type: 'textarea' }, { name: 'cost', label: 'Cost', type: 'money' },
      ]}
      rowActions={[{ key: 'done', label: 'Complete', type: 'primary', show: (r) => r.status !== 'COMPLETED', url: (r) => `/assets/maintenance/${r.id}/status`, body: () => ({ status: 'COMPLETED' }), method: 'PATCH' }]}
    /> },
  ];
  return (
    <div className="nex-fade">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<BankOutlined />} label="Assets registered" value={register.data?.length || 0} hint={`${active} active`} />
        <StatCard icon={<DollarOutlined />} label="Book value" value={fmtMoney(bookValue)} hint="Cost less depreciation" />
        <StatCard icon={<ToolOutlined />} label="Maintenance jobs" value={maintenance.data?.length || 0} hint={`${scheduled} scheduled`} />
        <StatCard icon={<CheckCircleOutlined />} label="Completed jobs" value={(maintenance.data || []).filter((r: any) => r.status === 'COMPLETED').length} hint="All time" />
      </div>
      <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
        <Tabs items={items} defaultActiveKey="register" destroyOnHidden />
      </Card>
    </div>
  );
}

