'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Select, Switch, Table, Tag } from 'antd';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

const MODES = [{ value: 'RETAIL', label: 'Retail' }, { value: 'SERVICE', label: 'Services' }, { value: 'RESTAURANT', label: 'Restaurant' }];

export default function Page() {
  const [form] = Form.useForm();
  const [rows, setRows] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);

  const load = useCallback(async () => {
    const boot = await api('/pos/bootstrap');
    setBranchId(boot.branch.id);
    setRows(await api(`/pos/registers?branchId=${boot.branch.id}`));
  }, []);
  useEffect(() => {
    load().catch((e) => notify.error(e.message));
    api('/pos/cash-accounts').then(setAccounts).catch(() => {});
  }, [load]);

  function edit(r: any) {
    setEditing(r);
    form.setFieldsValue({ name: r.name, code: r.code, ledgerAccountId: r.ledgerAccountId || undefined, defaultMode: r.defaultMode, active: r.active });
  }
  function reset() { setEditing(null); form.resetFields(); }

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Form form={form} layout="vertical" className="rounded-2xl border border-[#e6e9f0] bg-white p-4" initialValues={{ defaultMode: 'RETAIL', active: true }}
        onFinish={async (v) => {
          try {
            await api('/pos/registers', { method: 'POST', body: JSON.stringify({ ...v, id: editing?.id, branchId }) });
            notify.success(editing ? 'Register updated' : 'Register created');
            reset();
            load();
          } catch (e: any) { notify.error(e.message); }
        }}>
        <div className="mb-3 text-[14px] font-semibold">{editing ? `Edit ${editing.code}` : 'New register'}</div>
        <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name the register' }]}><Input placeholder="Front counter" /></Form.Item>
        {!editing && <Form.Item name="code" label="Code" extra="Leave blank to number it automatically."><Input /></Form.Item>}
        <Form.Item name="ledgerAccountId" label="Cash account" extra="Cash taken at this register posts here. Leave blank to use account 1000.">
          <Select allowClear showSearch optionFilterProp="label" options={accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
        </Form.Item>
        <Form.Item name="defaultMode" label="Default mode"><Select options={MODES} /></Form.Item>
        {editing && <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>}
        <div className="flex gap-2">
          <Button type="primary" htmlType="submit">{editing ? 'Save' : 'Create register'}</Button>
          {editing && <Button onClick={reset}>Cancel</Button>}
        </div>
      </Form>
      <Table rowKey="id" size="small" scroll={{ x: 560 }} dataSource={rows} onRow={(r) => ({ onClick: () => edit(r), className: 'cursor-pointer' })} columns={[
        { title: 'Code', dataIndex: 'code' },
        { title: 'Name', dataIndex: 'name' },
        { title: 'Cash account', render: (_, r: any) => { const a = accounts.find((x) => x.id === r.ledgerAccountId); return a ? `${a.code} · ${a.name}` : '1000 (default)'; } },
        { title: 'Mode', render: (_, r: any) => MODES.find((m) => m.value === r.defaultMode)?.label || r.defaultMode },
        { title: 'Shift', render: (_, r: any) => r.shifts?.[0] ? <Tag color={r.shifts[0].status === 'OPEN' ? 'green' : 'gold'}>{r.shifts[0].status === 'OPEN' ? `Open · ${r.shifts[0].user?.firstName || ''}` : 'Awaiting approval'}</Tag> : 'Closed' },
        { title: 'Active', render: (_, r: any) => r.active ? 'Yes' : 'No' },
      ]} />
    </div>
  );
}
