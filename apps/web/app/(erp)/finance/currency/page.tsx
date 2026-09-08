'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, Table, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill } from '@/components/sales-ui';

export default function CurrencyPage() {
  const qc = useQueryClient();
  const currencies = useQuery({ queryKey: ['/finance/currencies'], queryFn: () => api('/finance/currencies') });
  const rates = useQuery({ queryKey: ['/finance/exchange-rates'], queryFn: () => api('/finance/exchange-rates') });
  const [curOpen, setCurOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [curForm] = Form.useForm();
  const [rateForm] = Form.useForm();

  async function saveCur() { try { const v = await curForm.validateFields(); await api('/finance/currencies', { method: 'POST', body: JSON.stringify(v) }); message.success('Currency added'); setCurOpen(false); curForm.resetFields(); qc.invalidateQueries({ queryKey: ['/finance/currencies'] }); } catch (e: any) { message.error(e.message || 'Could not save'); } }
  async function saveRate() { try { const v = await rateForm.validateFields(); await api('/finance/exchange-rates', { method: 'POST', body: JSON.stringify(v) }); message.success('Rate saved'); setRateOpen(false); rateForm.resetFields(); qc.invalidateQueries({ queryKey: ['/finance/exchange-rates'] }); } catch (e: any) { message.error(e.message || 'Could not save'); } }

  const curCols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 100, render: (v) => <span className="font-mono text-[12px] font-semibold text-[#003366]">{v}</span> },
    { title: 'Name', dataIndex: 'name' },
    { title: 'Symbol', dataIndex: 'symbol', width: 100 },
    { title: 'Active', dataIndex: 'active', width: 100, render: (v) => <StatusPill status={v ? 'Active' : 'Inactive'} /> },
  ];

  const rateCols: ColumnsType<any> = [
    { title: 'From', dataIndex: 'fromCurrency', width: 110, render: (v) => <span className="font-mono text-[12px] text-[#475060]">{v}</span> },
    { title: 'To', dataIndex: 'toCurrency', width: 110, render: (v) => <span className="font-mono text-[12px] text-[#475060]">{v}</span> },
    { title: 'Rate', dataIndex: 'rate', align: 'right', width: 130, render: (v) => <span className="text-[13px] font-semibold text-[#171a2e]">{Number(v)}</span> },
    { title: 'Effective', dataIndex: 'effectiveDate', width: 140, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YYYY')}</span> },
    { title: 'Source', dataIndex: 'source', width: 120 },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Currency & Exchange Rates</h1><p className="text-[13px] text-[#64748b] mt-1">Define currencies and maintain conversion rates</p></div>
        <Can permission="finance.bank.manage">
          <div className="flex gap-2">
            <Button icon={<ReloadOutlined />} onClick={() => { qc.invalidateQueries({ queryKey: ['/finance/currencies'] }); qc.invalidateQueries({ queryKey: ['/finance/exchange-rates'] }); }} />
            <Button onClick={() => setRateOpen(true)}>Add Rate</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCurOpen(true)}>Add Currency</Button>
          </div>
        </Can>
      </div>
      <Tabs defaultActiveKey="currencies" items={[
        { key: 'currencies', label: 'Currencies', children: <div className="nex-card"><Table rowKey="id" loading={currencies.isLoading} dataSource={currencies.data || []} columns={curCols} pagination={false} /></div> },
        { key: 'rates', label: 'Exchange Rates', children: <div className="nex-card"><Table rowKey="id" loading={rates.isLoading} dataSource={rates.data || []} columns={rateCols} pagination={false} /></div> },
      ]} />

      <Modal open={curOpen} onCancel={() => setCurOpen(false)} onOk={saveCur} title="Add Currency" okText="Save" width={420}>
        <Form form={curForm} layout="vertical" className="mt-2">
          <Form.Item label="Code" name="code" rules={[{ required: true }]}><Input placeholder="USD" /></Form.Item>
          <Form.Item label="Name" name="name" rules={[{ required: true }]}><Input placeholder="US Dollar" /></Form.Item>
          <Form.Item label="Symbol" name="symbol"><Input placeholder="$" /></Form.Item>
        </Form>
      </Modal>

      <Modal open={rateOpen} onCancel={() => setRateOpen(false)} onOk={saveRate} title="Add Exchange Rate" okText="Save" width={420}>
        <Form form={rateForm} layout="vertical" className="mt-2">
          <Form.Item label="From" name="fromCurrency" rules={[{ required: true }]}><Input placeholder="ZAR" /></Form.Item>
          <Form.Item label="To" name="toCurrency" initialValue="USD"><Input /></Form.Item>
          <Form.Item label="Rate" name="rate" rules={[{ required: true }]}><InputNumber className="w-full" min={0} /></Form.Item>
          <Form.Item label="Date" name="effectiveDate" initialValue={dayjs()}><DatePicker className="w-full" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

