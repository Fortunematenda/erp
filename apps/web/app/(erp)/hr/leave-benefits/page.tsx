'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, InputNumber, Modal, Select, Table, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';

export default function LeaveBenefitsPage() {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ['/hr/leave-types'], queryFn: () => api('/hr/leave-types') });
  const balances = useQuery({ queryKey: ['/hr/leave-balances'], queryFn: () => api('/hr/leave-balances') });
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });
  const plans = useQuery({ queryKey: ['/hr/benefit-plans'], queryFn: () => api('/hr/benefit-plans') });
  const eb = useQuery({ queryKey: ['/hr/employee-benefits'], queryFn: () => api('/hr/employee-benefits') });
  const [typeOpen, setTypeOpen] = useState(false);
  const [accrueOpen, setAccrueOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [ebOpen, setEbOpen] = useState(false);
  const [ltForm] = Form.useForm();
  const [accForm] = Form.useForm();
  const [planForm] = Form.useForm();
  const [ebForm] = Form.useForm();

  async function saveType() { try { const v = await ltForm.validateFields(); await api('/hr/leave-types', { method: 'POST', body: JSON.stringify(v) }); setTypeOpen(false); ltForm.resetFields(); qc.invalidateQueries({ queryKey: ['/hr/leave-types'] }); } catch (e: any) { message.error(e.message || 'Could not save'); } }
  async function accrue() { try { const v = await accForm.validateFields(); await api('/hr/leave-balances/accrue', { method: 'POST', body: JSON.stringify(v) }); setAccrueOpen(false); accForm.resetFields(); qc.invalidateQueries({ queryKey: ['/hr/leave-balances'] }); } catch (e: any) { message.error(e.message); } }
  async function savePlan() { try { const v = await planForm.validateFields(); await api('/hr/benefit-plans', { method: 'POST', body: JSON.stringify(v) }); setPlanOpen(false); planForm.resetFields(); qc.invalidateQueries({ queryKey: ['/hr/benefit-plans'] }); } catch (e: any) { message.error(e.message); } }
  async function saveEb() { try { const v = await ebForm.validateFields(); await api('/hr/employee-benefits', { method: 'POST', body: JSON.stringify(v) }); setEbOpen(false); ebForm.resetFields(); qc.invalidateQueries({ queryKey: ['/hr/employee-benefits'] }); } catch (e: any) { message.error(e.message); } }

  const typeCols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 110, render: (v) => <span className="font-mono text-[12px] font-semibold text-[#003366]">{v}</span> },
    { title: 'Name', dataIndex: 'name' },
    { title: 'Days / Year', dataIndex: 'daysPerYear', width: 120 },
    { title: 'Max Carryover', width: 120, render: (_, r) => r.policy?.maxCarryOver || 0 },
    { title: 'Accrual / Month', width: 130, render: (_, r) => r.policy?.accrualPerMonth || 0 },
    { title: 'Active', width: 100, render: (_, r) => (r.active ? 'Active' : 'Inactive') },
  ];
  const balCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => <span className="text-[13px] text-[#171a2e]">{r.employee?.firstName} {r.employee?.lastName}</span> },
    { title: 'Leave Type', render: (_v, r) => <span className="text-[12px] text-[#64748b]">{r.leaveType?.name}</span> },
    { title: 'Balance', dataIndex: 'balance', width: 120, render: (v) => <span className="text-[13px] font-semibold text-[#003366]">{Number(v)} days</span> },
  ];
  const planCols: ColumnsType<any> = [
    { title: 'Plan', dataIndex: 'name' },
    { title: 'Type', dataIndex: 'type', width: 120 },
    { title: 'Taxable', dataIndex: 'taxable', width: 100, render: (v) => (v ? 'Yes' : 'No') },
    { title: 'Employer Contribution', dataIndex: 'employerContribution', width: 150, render: (v) => `$${Number(v)}` },
  ];
  const ebCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => <span className="text-[13px] text-[#171a2e]">{r.employee?.firstName} {r.employee?.lastName}</span> },
    { title: 'Plan', render: (_v, r) => <span className="text-[12px] text-[#64748b]">{r.plan?.name}</span> },
    { title: 'Amount', dataIndex: 'amount', width: 130, render: (v) => `$${Number(v)}` },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Leave & Benefits</h1><p className="text-[13px] text-[#64748b] mt-1">Leave types, balances and employee benefits</p></div>
        <Can permission="hr.employees.manage"><Button icon={<ReloadOutlined />} onClick={() => { types.refetch(); balances.refetch(); plans.refetch(); eb.refetch(); }}>Refresh</Button></Can>
      </div>
      <Tabs defaultActiveKey="types" items={[
        { key: 'types', label: 'Leave Types', children: <div className="nex-card"><div className="flex justify-end px-4 pt-3"><Button type="primary" icon={<PlusOutlined />} onClick={() => setTypeOpen(true)}>Add Leave Type</Button></div><Table rowKey="id" loading={types.isLoading} dataSource={types.data || []} columns={typeCols} pagination={false} /></div> },
        { key: 'balances', label: 'Leave Balances', children: <div className="nex-card"><div className="flex justify-end px-4 pt-3"><Button type="primary" icon={<PlusOutlined />} onClick={() => setAccrueOpen(true)}>Accrue Leave</Button></div><Table rowKey="id" loading={balances.isLoading} dataSource={balances.data || []} columns={balCols} pagination={false} /></div> },
        { key: 'plans', label: 'Benefit Plans', children: <div className="nex-card"><div className="flex justify-end px-4 pt-3"><Button type="primary" icon={<PlusOutlined />} onClick={() => setPlanOpen(true)}>Add Plan</Button></div><Table rowKey="id" loading={plans.isLoading} dataSource={plans.data || []} columns={planCols} pagination={false} /></div> },
        { key: 'benefits', label: 'Employee Benefits', children: <div className="nex-card"><div className="flex justify-end px-4 pt-3"><Button type="primary" icon={<PlusOutlined />} onClick={() => setEbOpen(true)}>Assign Benefit</Button></div><Table rowKey="id" loading={eb.isLoading} dataSource={eb.data || []} columns={ebCols} pagination={false} /></div> },
      ]} />

      <Modal open={typeOpen} onCancel={() => setTypeOpen(false)} onOk={saveType} title="Add Leave Type" okText="Save" width={480}>
        <Form form={ltForm} layout="vertical" className="mt-2">
          <Form.Item label="Code" name="code" rules={[{ required: true }]}><Input placeholder="ANNUAL" /></Form.Item>
          <Form.Item label="Name" name="name" rules={[{ required: true }]}><Input placeholder="Annual Leave" /></Form.Item>
          <Form.Item label="Days per Year" name="daysPerYear" initialValue={20}><InputNumber className="w-full" min={0} /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Accrual per Month" name={['policy', 'accrualPerMonth']} initialValue={0}><InputNumber className="w-full" min={0} /></Form.Item>
            <Form.Item label="Max Carryover" name={['policy', 'maxCarryOver']} initialValue={0}><InputNumber className="w-full" min={0} /></Form.Item>
          </div>
        </Form>
      </Modal>
      <Modal open={accrueOpen} onCancel={() => setAccrueOpen(false)} onOk={accrue} title="Accrue Leave" okText="Accrue" width={440}>
        <Form form={accForm} layout="vertical" className="mt-2">
          <Form.Item label="Employee" name="employeeId" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={employees.data?.map((e: any) => ({ label: `${e.firstName} ${e.lastName}`, value: e.id }))} /></Form.Item>
          <Form.Item label="Leave Type" name="leaveTypeId" rules={[{ required: true }]}><Select options={types.data?.map((t: any) => ({ label: t.name, value: t.id }))} /></Form.Item>
          <Form.Item label="Days" name="days" rules={[{ required: true }]}><InputNumber className="w-full" min={0} /></Form.Item>
        </Form>
      </Modal>
      <Modal open={planOpen} onCancel={() => setPlanOpen(false)} onOk={savePlan} title="Add Benefit Plan" okText="Save" width={440}>
        <Form form={planForm} layout="vertical" className="mt-2">
          <Form.Item label="Name" name="name" rules={[{ required: true }]}><Input placeholder="Medical Aid" /></Form.Item>
          <Form.Item label="Type" name="type" initialValue="MEDICAL"><Select options={['MEDICAL', 'PENSION', 'HOUSING', 'TRANSPORT', 'LOAN', 'OTHER'].map((t) => ({ label: t, value: t }))} /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Taxable" name="taxable" initialValue={false}><Select options={[{ label: 'Yes', value: true }, { label: 'No', value: false }]} /></Form.Item>
            <Form.Item label="Employer Contribution" name="employerContribution" initialValue={0}><InputNumber className="w-full" prefix="$" min={0} /></Form.Item>
          </div>
        </Form>
      </Modal>
      <Modal open={ebOpen} onCancel={() => setEbOpen(false)} onOk={saveEb} title="Assign Benefit" okText="Save" width={440}>
        <Form form={ebForm} layout="vertical" className="mt-2">
          <Form.Item label="Employee" name="employeeId" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={employees.data?.map((e: any) => ({ label: `${e.firstName} ${e.lastName}`, value: e.id }))} /></Form.Item>
          <Form.Item label="Plan" name="planId" rules={[{ required: true }]}><Select options={plans.data?.map((p: any) => ({ label: p.name, value: p.id }))} /></Form.Item>
          <Form.Item label="Amount" name="amount" initialValue={0}><InputNumber className="w-full" prefix="$" min={0} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

