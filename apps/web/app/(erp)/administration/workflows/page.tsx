'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, InputNumber, Modal, Select, Table, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill } from '@/components/sales-ui';

const DTYPE_LABEL: Record<string, string> = {
  PURCHASE_REQUISITION: 'Purchase Requisition', PURCHASE_ORDER: 'Purchase Order', SUPPLIER_INVOICE: 'Supplier Invoice',
  BUDGET: 'Budget', JOURNAL_REVERSAL: 'Journal Reversal', CHECK: 'Check', STOCK_ADJUSTMENT: 'Stock Adjustment',
  ASSET_DISPOSAL: 'Asset Disposal', PAYROLL_RUN: 'Payroll Run',
};

export default function WorkflowsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['/approvals/workflows'], queryFn: () => api('/approvals/workflows') });
  const [open, setOpen] = useState(false);
  const [wf, setWf] = useState<any>(null);
  const [form] = useState(0);
  const [roleName, setRoleName] = useState('Company Administrator');
  const [amountFrom, setAmountFrom] = useState<number | null>(null);
  const [amountTo, setAmountTo] = useState<number | null>(null);

  const wfCols: ColumnsType<any> = [
    { title: 'Document Type', dataIndex: 'documentType', render: (v) => <span className="text-[13px] text-[#171a2e] font-medium">{DTYPE_LABEL[v] || v}</span> },
    { title: 'Workflow', dataIndex: 'name', render: (v) => <span className="text-[13px] text-[#64748b]">{v}</span> },
    { title: 'Steps', dataIndex: 'steps', width: 110, render: (v) => <span className="text-[13px] text-[#475060]">{v?.length || 0}</span> },
    { title: 'Active', dataIndex: 'active', width: 100, render: (v) => <StatusPill status={v ? 'Active' : 'Inactive'} /> },
    { title: 'Actions', key: 'a', width: 140, align: 'right', render: (_, r: any) => (
      <Can permission="approvals.manage"><Button size="small" icon={<PlusOutlined />} onClick={() => { setWf(r); setOpen(true); }}>Add Step</Button></Can>
    ) },
  ];

  const stepCols: ColumnsType<any> = [
    { title: '#', dataIndex: 'sequence', width: 60 },
    { title: 'Role / Approver', dataIndex: 'roleName', render: (v, r) => <span className="text-[13px] text-[#171a2e]">{v || r.approverUserId || '—'}</span> },
    { title: 'Amount From', dataIndex: 'amountFrom', width: 130, render: (v) => v != null ? `$${Number(v)}` : '—' },
    { title: 'Amount To', dataIndex: 'amountTo', width: 130, render: (v) => v != null ? `$${Number(v)}` : '—' },
  ];

  async function addStep() {
    if (!wf) return;
    try {
      await api(`/approvals/workflows/${wf.id}/steps`, { method: 'POST', body: JSON.stringify({ roleName, amountFrom: amountFrom ?? undefined, amountTo: amountTo ?? undefined }) });
      message.success('Step added'); setOpen(false); setRoleName('Company Administrator'); setAmountFrom(null); setAmountTo(null);
      qc.invalidateQueries({ queryKey: ['/approvals/workflows'] });
    } catch (e: any) { message.error(e.message); }
  }

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Workflows & Approvals</h1><p className="text-[13px] text-[#64748b] mt-1">Configure approval workflows per document type</p></div>
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/approvals/workflows'] })}>Refresh</Button>
      </div>

      <Tabs defaultActiveKey="workflows" items={[
        {
          key: 'workflows', label: 'Workflows', children: (
            <div className="nex-card"><Table rowKey="id" loading={list.isLoading} dataSource={list.data || []} columns={wfCols} pagination={false} expandable={{ expandedRowRender: (r) => <Table rowKey="id" columns={stepCols} dataSource={r.steps || []} pagination={false} size="small" /> }} /></div>
          ),
        },
      ]} />

      <Modal open={open} onCancel={() => setOpen(false)} onOk={addStep} title={`Add Step — ${DTYPE_LABEL[wf?.documentType] || ''}`} okText="Add" width={480}>
        <div className="space-y-4 mt-2">
          <Select className="w-full" value={roleName} onChange={(v) => setRoleName(v)} options={['Company Administrator', 'Finance Manager', 'Procurement Manager', 'Sales Manager', 'HR Manager', 'Auditor'].map((r) => ({ label: r, value: r }))} placeholder="Approver role" />
          <div className="grid grid-cols-2 gap-4">
            <div className="text-[13px]"><div className="mb-1">Amount From</div><InputNumber className="w-full" prefix="$" min={0} value={amountFrom} onChange={(v) => setAmountFrom(v)} /></div>
            <div className="text-[13px]"><div className="mb-1">Amount To</div><InputNumber className="w-full" prefix="$" min={0} value={amountTo} onChange={(v) => setAmountTo(v)} /></div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

