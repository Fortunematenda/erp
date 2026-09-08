'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Table, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DeleteOutlined, EyeOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, InboxOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { CurrencyValue, StatusPill } from '@/components/sales-ui';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const PROJECT_STATUS = ['Active', 'Planning', 'On Hold', 'Completed', 'Cancelled'];

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-[#667085]">{label}</div>
      <div className="text-[26px] font-medium leading-[1.2] mt-1" style={{ color: color || '#475467' }}>{value}</div>
    </div>
  );
}

function Empty({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="text-center py-16">
      <InboxOutlined className="text-5xl text-[#c7ccdd]" />
      <div className="text-[15px] font-semibold text-[#171a2e] mt-4">{title}</div>
      <div className="text-[13px] text-[#64748b] mt-1">{desc}</div>
    </div>
  );
}

export default function ProjectsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const projects = useQuery({ queryKey: ['/projects'], queryFn: () => api('/projects') });
  const customers = useQuery({ queryKey: ['/sales/customers'], queryFn: () => api('/sales/customers') });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // report state
  const [range, setRange] = useState<any>(null);
  const [projectId, setProjectId] = useState('');
  const prof = useQuery({ queryKey: ['/projects/profitability', range?.[0]?.format('YYYY-MM-DD'), range?.[1]?.format('YYYY-MM-DD'), projectId], queryFn: () => {
    const p: string[] = [];
    if (range?.[0]) p.push(`from=${range[0].format('YYYY-MM-DD')}`);
    if (range?.[1]) p.push(`to=${range[1].format('YYYY-MM-DD')}`);
    if (projectId) p.push(`projectId=${projectId}`);
    return api(`/projects/profitability${p.length ? '?' + p.join('&') : ''}`);
  } });

  async function save() {
    try {
      const v = await form.validateFields();
      setSaving(true);
      await api('/projects', { method: 'POST', body: JSON.stringify({ name: v.name, description: v.description, projectCode: v.projectCode, budget: Number(v.budget || 0), currency: 'USD', status: v.status || 'Active', customerId: v.customerId, startDate: v.startDate?.format('YYYY-MM-DD') }) });
      message.success('Project created successfully.');
      qc.invalidateQueries({ queryKey: ['/projects'] });
      setOpen(false);
      form.resetFields();
    } catch (e: any) { message.error(e.message || 'Could not create project'); }
    finally { setSaving(false); }
  }

  const projectCols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'projectCode', width: 130, render: (v) => <span className="font-mono text-[12px] font-semibold text-[#003366]">{v}</span> },
    { title: 'Project Name', dataIndex: 'name', render: (v) => <span className="text-[13px] text-[#171a2e]">{v}</span> },
    { title: 'Status', dataIndex: 'status', width: 130, render: (v) => <StatusPill status={v} /> },
    { title: 'Budget', dataIndex: 'budget', width: 140, align: 'right', render: (v) => <CurrencyValue value={v} /> },
    { title: 'Customer', dataIndex: 'customer', width: 160, render: (_v, r) => <span className="text-[13px] text-[#64748b]">{r.customer?.name || '—'}</span> },
    { title: 'Start Date', dataIndex: 'startDate', width: 120, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('MM/DD/YYYY')}</span> },
    {
      ...ACTIONS_COL, render: (_, r: any) => (
        <RowActionsMenu items={[
          { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => router.push(`/projects/${r.id}`) },
          { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, confirm: 'Delete project?', onClick: async () => { try { await api(`/projects/${r.id}`, { method: 'DELETE' }); message.success('Project deleted'); qc.invalidateQueries({ queryKey: ['/projects'] }); } catch (e: any) { message.error(e.message); } } },
        ]} />
      ),
    },
  ];

  const profRows = prof.data?.rows || [];
  const sum = prof.data?.summary || { totalRevenue: 0, totalCosts: 0, totalProfit: 0, avgMargin: 0 };
  const profitColor = sum.totalProfit > 0 ? '#16A34A' : sum.totalProfit < 0 ? '#EF4444' : '#475467';
  const marginColor = sum.avgMargin > 0 ? '#16A34A' : sum.avgMargin < 0 ? '#EF4444' : '#475467';

  const profCols: ColumnsType<any> = [
    { title: 'Project Name', dataIndex: 'name', render: (v) => <span className="text-[13px] text-[#171a2e]">{v}</span> },
    { title: 'Start Date', dataIndex: 'startDate', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('MM/DD/YYYY')}</span> },
    { title: 'Revenue', dataIndex: 'revenue', align: 'right', width: 120, render: (v) => <CurrencyValue value={v} /> },
    { title: 'Material', dataIndex: 'materialCost', align: 'right', width: 100, render: (v) => <span className="text-[12px] text-[#64748b]">{fmtMoney(v)}</span> },
    { title: 'Labour', dataIndex: 'labour', align: 'right', width: 90, render: (v) => <span className="text-[12px] text-[#64748b]">{fmtMoney(v)}</span> },
    { title: 'Other', dataIndex: 'otherCost', align: 'right', width: 90, render: (v) => <span className="text-[12px] text-[#64748b]">{fmtMoney(v)}</span> },
    { title: 'Total Cost', dataIndex: 'cost', align: 'right', width: 110, render: (v) => <span className="text-[13px] text-[#171a2e]">{fmtMoney(v)}</span> },
    { title: 'Profit', dataIndex: 'profit', align: 'right', width: 110, render: (v) => <span className="text-[13px] font-semibold" style={{ color: v > 0 ? '#16A34A' : v < 0 ? '#EF4444' : '#475467' }}>{fmtMoney(v)}</span> },
    { title: 'Margin %', dataIndex: 'margin', align: 'right', width: 90, render: (v) => <span className="text-[13px] font-semibold" style={{ color: v > 0 ? '#16A34A' : v < 0 ? '#EF4444' : '#475467' }}>{v.toFixed(1)}%</span> },
    { title: 'Budget', dataIndex: 'budget', align: 'right', width: 100, render: (v) => <span className="text-[12px] text-[#64748b]">{fmtMoney(v)}</span> },
    { title: 'Variance', dataIndex: 'variance', align: 'right', width: 100, render: (v) => <span className="text-[12px] font-semibold" style={{ color: v > 0 ? '#16A34A' : v < 0 ? '#EF4444' : '#475467' }}>{fmtMoney(v)}</span> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Projects</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Plan, track and report on project work</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>New Project</Button>
      </div>

      <Tabs
        defaultActiveKey="projects"
        items={[
          {
            key: 'projects', label: `Projects (${projects.data?.length || 0})`,
            children: projects.data?.length === 0 ? (
              <div className="nex-card"><Empty title="No projects yet" desc="Click New Project to create your first project." /></div>
            ) : (
              <div className="nex-card"><Table rowKey="id" loading={projects.isLoading} dataSource={projects.data || []} columns={projectCols} scroll={{ x: true }} pagination={{ pageSize: 10, showSizeChanger: false }} /></div>
            ),
          },
          {
            key: 'profitability', label: 'Project Profitability Report',
            children: (
              <div>
                <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
                  <DatePicker.RangePicker className="!rounded-lg" value={range} onChange={setRange} />
                  <Select allowClear showSearch optionFilterProp="label" placeholder="All Projects" className="!min-w-[190px] !rounded-lg" value={projectId || undefined} onChange={(v) => setProjectId(v || '')} options={(projects.data || []).map((p: any) => ({ label: p.name, value: p.id }))} />
                  <Button type="primary" icon={<ReloadOutlined />} onClick={() => prof.refetch()}>Refresh Report</Button>
                  <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
                </div>

                <div className="nex-card mb-4 p-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Metric label="Total Revenue" value={fmtMoney(sum.totalRevenue)} />
                    <Metric label="Total Costs" value={fmtMoney(sum.totalCosts)} />
                    <Metric label="Total Profit" value={fmtMoney(sum.totalProfit)} color={profitColor} />
                    <Metric label="Average Margin" value={prof.isLoading ? '–' : `${sum.avgMargin.toFixed(2)}%`} color={marginColor} />
                  </div>
                </div>

                <div className="nex-card">
                  {profRows.length === 0 ? (
                    <Empty title="No project profitability data found." desc="No project transactions match the selected date range." />
                  ) : (
                    <Table rowKey={(r: any) => r.id} loading={prof.isLoading} dataSource={profRows} columns={profCols} scroll={{ x: true }} pagination={false} />
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />

      <Modal open={open} onCancel={() => setOpen(false)} title="New Project" okText="Save" cancelText="Cancel" onOk={save} confirmLoading={saving} width={680} okButtonProps={{ loading: saving }}>
        <Form form={form} layout="vertical" className="mt-2">
          <Form.Item label="Project Name" name="name" rules={[{ required: true, message: 'Project name is required.' }]}><Input placeholder="e.g. Website Redesign" maxLength={120} /></Form.Item>
          <Form.Item label="Project Description" name="description"><Input.TextArea rows={3} placeholder="Describe the project scope, objectives, deliverables..." /></Form.Item>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
            <Form.Item label="Project Code" name="projectCode"><Input placeholder="e.g. PRJ-001" /></Form.Item>
            <Form.Item label="Budget (USD)" name="budget"><InputNumber className="w-full" prefix="$" min={0} /></Form.Item>
            <Form.Item label="Status" name="status" initialValue="Active"><Select options={PROJECT_STATUS.map((s) => ({ label: s, value: s }))} /></Form.Item>
            <Form.Item label="Customer (for invoicing)" name="customerId"><Select showSearch optionFilterProp="label" allowClear placeholder="Select customer" options={(customers.data || []).map((c: any) => ({ label: c.name, value: c.id }))} /></Form.Item>
          </div>
          <Form.Item label="Start Date" name="startDate"><DatePicker className="w-full" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

