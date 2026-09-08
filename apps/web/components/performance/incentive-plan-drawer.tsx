'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, InputNumber, Select, Space, message } from 'antd';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';

export function IncentivePlanDrawer({ open, onClose, editing }: { open: boolean; onClose: () => void; editing?: any }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const c = editing.calculation || {};
      form.setFieldsValue({
        name: editing.name, eligibility: editing.eligibility, departmentId: editing.departmentId,
        minScore: c.minScore != null ? Number(c.minScore) : undefined, maxScore: c.maxScore != null ? Number(c.maxScore) : undefined,
        calcType: c.calcType || 'PERCENT_SALARY', percentValue: c.percentValue != null ? Number(c.percentValue) : undefined,
        fixedAmount: c.fixedAmount != null ? Number(c.fixedAmount) : undefined,
        maxPayout: editing.maxPayout ? Number(editing.maxPayout) : undefined, payrollComponent: editing.payrollComponent || 'PERFORMANCE_BONUS',
        status: editing.status,
      });
    } else form.resetFields();
  }, [open, editing]);

  async function save() {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    setSaving(true);
    try {
      if (editing) await api(`/performance/incentive-plans/${editing.id}`, { method: 'PATCH', body: JSON.stringify(v) });
      else await api('/performance/incentive-plans', { method: 'POST', body: JSON.stringify(v) });
      message.success(editing ? 'Plan updated' : 'Incentive plan created');
      qc.invalidateQueries({ queryKey: ['/performance/incentive-plans'] });
      onClose();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  const calcType = Form.useWatch('calcType', open ? form : undefined);

  return (
    <Drawer open={open} onClose={onClose} width="min(640px, 96vw)" title={editing ? `Edit Incentive Plan — ${editing.name}` : 'New Incentive Plan'} destroyOnHidden
      extra={<Space><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={save}>Save plan</Button></Space>}>
      <Form form={form} layout="vertical">
        <Form.Item label="Plan name" name="name" rules={[{ required: true }]}><Input placeholder="e.g. Quarterly Performance Bonus" /></Form.Item>
        <Form.Item label="Department (optional scope)" name="departmentId"><Select allowClear placeholder="All departments" options={(meta.data?.departments || []).map((d: any) => ({ label: d.name, value: d.id }))} /></Form.Item>
        <Form.Item label="Eligibility note" name="eligibility"><Input placeholder="e.g. Confirmed employees with approved assessments" /></Form.Item>
        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item label="Minimum score %" name="minScore" tooltip="Band start, e.g. 80"><InputNumber min={0} max={200} className="w-full" /></Form.Item>
          <Form.Item label="Maximum score %" name="maxScore" tooltip="Band end, e.g. 89.99"><InputNumber min={0} max={200} className="w-full" /></Form.Item>
          <Form.Item label="Calculation type" name="calcType" initialValue="PERCENT_SALARY" rules={[{ required: true }]}>
            <Select options={[
              { value: 'PERCENT_SALARY', label: 'Percentage of base salary' },
              { value: 'FIXED', label: 'Fixed amount' },
              { value: 'CUSTOM', label: 'Custom approved amount (set at approval)' },
            ]} />
          </Form.Item>
          {calcType === 'PERCENT_SALARY' && <Form.Item label="Percentage of base salary" name="percentValue" tooltip="e.g. 10 for 10% of monthly base salary"><InputNumber min={0} max={100} className="w-full" /></Form.Item>}
          {calcType === 'FIXED' && <Form.Item label="Fixed amount" name="fixedAmount"><InputNumber min={0} className="w-full" /></Form.Item>}
          <Form.Item label="Maximum payout" name="maxPayout"><InputNumber min={0} className="w-full" /></Form.Item>
          <Form.Item label="Payroll component" name="payrollComponent" initialValue="PERFORMANCE_BONUS"><Input /></Form.Item>
          <Form.Item label="Status" name="status" initialValue="ACTIVE"><Select options={[{ value: 'ACTIVE', label: 'ACTIVE' }, { value: 'INACTIVE', label: 'INACTIVE' }]} /></Form.Item>
        </div>
        <div className="text-[12px] text-[#64748b] bg-[#f8fafc] border rounded-lg px-3 py-2.5">
          Performance results never change pay directly. Approved assessments create <b>proposed</b> incentives; only approved incentives flow into a payroll run as a <b>Performance Bonus</b> input with the incentive reference (INC-xxxxxx).
        </div>
      </Form>
    </Drawer>
  );
}
