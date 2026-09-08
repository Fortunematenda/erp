'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, InputNumber, Modal, Select, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { Can } from '@/components/Can';
import { StatusPill } from '@/components/sales-ui';

const MODES = [
  { value: 'INFORMATION_ONLY', label: 'Information only' },
  { value: 'WARN', label: 'Warn' },
  { value: 'REQUIRE_APPROVAL', label: 'Require approval' },
  { value: 'BLOCK', label: 'Block' },
];

export default function BudgetControlPage() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['/finance/budget-control'], queryFn: () => api('/finance/budget-control') });
  const ledger = useQuery({ queryKey: ['/finance/accounts'], queryFn: () => api('/finance/accounts') });
  const [open, setOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [ruleForm] = Form.useForm();
  const [evalForm] = Form.useForm();
  const [evalResult, setEvalResult] = useState<any>(null);

  async function saveRule() {
    try {
      const v = await ruleForm.validateFields();
      await api('/finance/budget-control', { method: 'POST', body: JSON.stringify(v) });
      message.success('Rule saved'); setOpen(false); ruleForm.resetFields(); qc.invalidateQueries({ queryKey: ['/finance/budget-control'] });
    } catch (e: any) { message.error(e.message || 'Could not save rule'); }
  }
  async function evaluate() {
    try {
      const v = await evalForm.validateFields();
      const r = await api(`/finance/budget-control/evaluate?accountId=${v.accountId}&amount=${v.amount}`);
      setEvalResult(r);
    } catch (e: any) { message.error(e.message); }
  }

  const cols: ColumnsType<any> = [
    { title: 'Account', dataIndex: 'account', render: (_v, r) => <span className="text-[13px] text-[#171a2e]">{r.account?.code} · {r.account?.name || 'All accounts'}</span> },
    { title: 'Mode', dataIndex: 'mode', width: 170, render: (v) => <StatusPill status={v.replace(/_/g, ' ')} /> },
    { title: 'Active', dataIndex: 'active', width: 100, render: (v) => <StatusPill status={v ? 'Active' : 'Inactive'} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Budget Control</h1><p className="text-[13px] text-[#64748b] mt-1">Rules that warn, require approval or block overspend</p></div>
        <Can permission="finance.budget.manage">
          <div className="flex gap-2">
            <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/finance/budget-control'] })}>Refresh</Button>
            <Button onClick={() => setEvalOpen(true)}>Evaluate</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>New Rule</Button>
          </div>
        </Can>
      </div>
      <div className="nex-card"><Table rowKey="id" loading={rules.isLoading} dataSource={rules.data || []} columns={cols} pagination={false} /></div>

      <Modal open={open} onCancel={() => setOpen(false)} onOk={saveRule} title="New Budget Control Rule" okText="Create" width={480}>
        <Form form={ruleForm} layout="vertical" className="mt-2">
          <Form.Item label="Account" name="accountId"><Select allowClear showSearch optionFilterProp="label" options={ledger.data?.map((a: any) => ({ label: `${a.code} ${a.name}`, value: a.id }))} /></Form.Item>
          <Form.Item label="Mode" name="mode" initialValue="INFORMATION_ONLY"><Select options={MODES} /></Form.Item>
          <Form.Item label="Active" name="active" initialValue={true}><Select options={[{ label: 'Active', value: true }, { label: 'Inactive', value: false }]} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={evalOpen} onCancel={() => setEvalOpen(false)} title="Budget Check" okText="Check" onOk={evaluate} width={480}>
        <Form form={evalForm} layout="vertical" className="mt-2">
          <Form.Item label="Account" name="accountId"><Select showSearch optionFilterProp="label" options={ledger.data?.map((a: any) => ({ label: `${a.code} ${a.name}`, value: a.id }))} /></Form.Item>
          <Form.Item label="Planned Amount" name="amount"><InputNumber className="w-full" prefix="$" min={0} /></Form.Item>
        </Form>
        {evalResult && (
          <div className="rounded-lg bg-[#f7f8fc] p-4 text-[13px] space-y-1 mt-2">
            <div className="flex justify-between"><span className="text-[#667085]">Budget</span><span className="font-semibold text-[#171a2e]">{fmtMoney(evalResult.budget)}</span></div>
            <div className="flex justify-between"><span className="text-[#667085]">Actual</span><span className="font-semibold text-[#171a2e]">{fmtMoney(evalResult.actual)}</span></div>
            <div className="flex justify-between"><span className="text-[#667085]">Remaining after</span><span className="font-semibold" style={{ color: evalResult.remaining < 0 ? '#EF4444' : '#16A34A' }}>{fmtMoney(evalResult.remaining)}</span></div>
            <div className="flex justify-between pt-1 border-t border-[#eef0f6]"><span className="text-[#667085]">Mode</span><StatusPill status={evalResult.mode.replace(/_/g, ' ')} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

