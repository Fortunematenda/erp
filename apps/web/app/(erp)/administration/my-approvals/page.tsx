'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, InputNumber, Modal, Popconfirm, Select, Table, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill } from '@/components/sales-ui';

const DTYPE_LABEL: Record<string, string> = {
  PURCHASE_REQUISITION: 'Purchase Requisition', PURCHASE_ORDER: 'Purchase Order', SUPPLIER_INVOICE: 'Supplier Invoice',
  BUDGET: 'Budget', JOURNAL_REVERSAL: 'Journal Reversal', CHECK: 'Check', STOCK_ADJUSTMENT: 'Stock Adjustment',
  ASSET_DISPOSAL: 'Asset Disposal', PAYROLL_RUN: 'Payroll Run',
};

export default function MyApprovalsPage() {
  const qc = useQueryClient();
  const requests = useQuery({ queryKey: ['/approvals/requests'], queryFn: () => api('/approvals/requests') });
  const types = useQuery({ queryKey: ['/approvals/document-types'], queryFn: () => api('/approvals/document-types') });
  const [open, setOpen] = useState(false);
  const [dt, setDt] = useState('');
  const [docNo, setDocNo] = useState('');
  const [docId, setDocId] = useState('');
  const [amount, setAmount] = useState(0);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!dt) { message.warning('Select a document type'); return; }
    try {
      setSaving(true);
      await api('/approvals/requests', { method: 'POST', body: JSON.stringify({ documentType: dt, documentId: docId, documentNo: docNo, amount }) });
      message.success('Submitted for approval'); setOpen(false); setDocNo(''); setDocId(''); setAmount(0);
      qc.invalidateQueries({ queryKey: ['/approvals/requests'] });
    } catch (e: any) { message.error(e.message); }
    finally { setSaving(false); }
  }
  async function act(id: string, action: string, comment?: string) {
    try { await api(`/approvals/requests/${id}/act`, { method: 'POST', body: JSON.stringify({ action, comment }) }); message.success(`Request ${action.toLowerCase()}`); qc.invalidateQueries({ queryKey: ['/approvals/requests'] }); }
    catch (e: any) { message.error(e.message); }
  }

  const cols: ColumnsType<any> = [
    { title: 'Document', dataIndex: 'documentType', width: 180, render: (v) => <span className="text-[13px] font-medium text-[#171a2e]">{DTYPE_LABEL[v] || v}</span> },
    { title: 'No.', dataIndex: 'documentNo', render: (v) => <span className="font-mono text-[12px] text-[#003366]">{v || '—'}</span> },
    { title: 'Amount', dataIndex: 'amount', width: 130, align: 'right', render: (v) => <span className="text-[13px] font-semibold text-[#003366]">${Number(v).toLocaleString()}</span> },
    { title: 'Submitted', dataIndex: 'submittedAt', width: 150, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Status', dataIndex: 'status', width: 150, render: (v) => <StatusPill status={v.replace(/_/g, ' ')} /> },
    {
      title: 'Actions', key: 'a', width: 220, align: 'right', render: (_, r: any) => (
        <Can permission="approvals.approve">
          {['SUBMITTED', 'PENDING_APPROVAL'].includes(r.status) ? (
            <div className="flex items-center gap-1 justify-end">
              <Popconfirm title="Approve?" onConfirm={() => act(r.id, 'APPROVE')}><Button size="small" type="primary" icon={<CheckOutlined />}>Approve</Button></Popconfirm>
              <Popconfirm title="Reject?" onConfirm={() => act(r.id, 'REJECT')}><Button size="small" danger icon={<CloseOutlined />}>Reject</Button></Popconfirm>
              <Popconfirm title="Return to requester?" onConfirm={() => act(r.id, 'RETURN')}><Button size="small" icon={<RollbackOutlined />}>Return</Button></Popconfirm>
            </div>
          ) : null}
        </Can>
      ),
    },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">My Approvals</h1><p className="text-[13px] text-[#64748b] mt-1">Submit documents for approval and action pending approvals</p></div>
        <Can permission="approvals.submit"><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Submit for Approval</Button></Can>
      </div>

      <Tabs defaultActiveKey="requests" items={[
        {
          key: 'requests', label: `Requests (${requests.data?.length || 0})`, children: (
            <div className="nex-card">
              <div className="px-4 py-3 border-b border-[#eef0f6] flex items-center gap-2"><Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/approvals/requests'] })} /></div>
              <Table rowKey="id" loading={requests.isLoading} dataSource={requests.data || []} columns={cols} scroll={{ x: true }} pagination={{ pageSize: 10, showSizeChanger: false }} />
            </div>
          ),
        },
      ]} />

      <Modal open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={saving} title="Submit for Approval" okText="Submit" width={480}>
        <div className="space-y-4 mt-2">
          <Select className="w-full" placeholder="Document type" value={dt || undefined} onChange={setDt} options={(types.data || []).map((t: any) => ({ label: DTYPE_LABEL[t] || t, value: t }))} />
          <Input placeholder="Document No." value={docNo} onChange={(e) => setDocNo(e.target.value)} />
          <Input placeholder="Document ID" value={docId} onChange={(e) => setDocId(e.target.value)} />
          <InputNumber className="w-full" prefix="$" min={0} placeholder="Amount" value={amount} onChange={(v) => setAmount(Number(v || 0))} />
        </div>
      </Modal>
    </div>
  );
}

