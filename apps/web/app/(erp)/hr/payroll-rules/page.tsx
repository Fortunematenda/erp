'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, Modal, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill } from '@/components/sales-ui';

export default function PayrollRulesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['/hr/statutory-rules'], queryFn: () => api('/hr/statutory-rules') });
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(`{\n  "brackets": [\n    { "from": 0, "to": 300, "rate": 0.2 },\n    { "from": 300, "rate": 0.25 }\n  ]\n}`);
  const [form] = Form.useForm();

  async function save() {
    try {
      let parsed: any;
      try { parsed = JSON.parse(config); } catch { message.error('Configuration must be valid JSON'); return; }
      const v = await form.validateFields();
      await api('/hr/statutory-rules', { method: 'POST', body: JSON.stringify({ code: v.code, name: v.name, authority: v.authority, validFrom: v.validFrom?.format('YYYY-MM-DD'), validTo: v.validTo?.format('YYYY-MM-DD'), configuration: parsed }) });
      message.success('Statutory rule saved'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['/hr/statutory-rules'] });
    } catch (e: any) { message.error(e.message || 'Could not save rule'); }
  }

  const cols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 100, render: (v) => <span className="font-mono text-[12px] font-semibold text-[#003366]">{v}</span> },
    { title: 'Name', dataIndex: 'name' },
    { title: 'Authority', dataIndex: 'authority', width: 140 },
    { title: 'Valid From', dataIndex: 'validFrom', width: 140, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YYYY')}</span> },
    { title: 'Valid To', dataIndex: 'validTo', width: 140, render: (v) => <span className="text-[13px] text-[#64748b]">{v ? dayjs(v).format('DD MMM YYYY') : 'Open'}</span> },
    { title: 'Active', dataIndex: 'active', width: 100, render: (v) => <StatusPill status={v !== false ? 'Active' : 'Inactive'} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Payroll Rules (Statutory)</h1><p className="text-[13px] text-[#64748b] mt-1">Effective-dated PAYE & NSSA configuration used by payroll. Payroll will not run until PAYE is configured.</p></div>
        <Can permission="payroll.process">
          <div className="flex gap-2">
            <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/hr/statutory-rules'] })} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setConfig(`{\n  "brackets": [\n    { "from": 0, "to": 300, "rate": 0.2 },\n    { "from": 300, "rate": 0.25 }\n  ]\n}`); setOpen(true); }}>Add Rule</Button>
          </div>
        </Can>
      </div>
      <div className="nex-card"><Table rowKey="id" loading={list.isLoading} dataSource={list.data || []} columns={cols} pagination={false} /></div>

      <Modal open={open} onCancel={() => setOpen(false)} onOk={save} title="Add Statutory Rule" okText="Save" width={560}>
        <Form form={form} layout="vertical" className="mt-2">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Code" name="code" rules={[{ required: true }]}><Input placeholder="PAYE | NSSA" /></Form.Item>
            <Form.Item label="Name" name="name" rules={[{ required: true }]}><Input placeholder="Pay As You Earn" /></Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Authority" name="authority"><Input placeholder="ZIMRA" /></Form.Item>
            <Form.Item label="Valid To" name="validTo"><DatePicker className="w-full" /></Form.Item>
          </div>
          <Form.Item label="Configuration (JSON)" required>
            <Input.TextArea rows={8} value={config} onChange={(e) => setConfig(e.target.value)} className="font-mono" placeholder="PAYE: {brackets:[{from,to,rate}]} · NSSA: {employeePct, employerPct, cap}" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

