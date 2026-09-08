'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { StatusTag, type Kpi } from '@/components/crud-page';
import { customerOptions } from '@/components/sales-ui';
import { useMeta } from '@/lib/meta';
import { fmtDate, fmtMoney } from '@/lib/format';
import dayjs from 'dayjs';

export function LinesForm({ form, lines, accounts }: { form: any; lines: string; accounts?: any[] }) {
  return (
    <Form.List name={lines}>
      {(fields, { add, remove }) => (
        <>
          {fields.map(({ key, name, ...rest }) => (
            <Space key={key} align="baseline" className="w-full mb-2" wrap>
              <Form.Item name={[name, 'description']} {...rest} rules={[{ required: true, message: 'Description' }]} className="!mb-0 w-48"><Input placeholder="Description" /></Form.Item>
              <Form.Item name={[name, 'itemId']} {...rest} className="!mb-0 w-36"><Select allowClear showSearch optionFilterProp="label" placeholder="Item" options={accounts || []} /></Form.Item>
              <Form.Item name={[name, 'quantity']} {...rest} rules={[{ required: true }]} className="!mb-0"><InputNumber placeholder="Qty" min={1} /></Form.Item>
              <Form.Item name={[name, 'unitPrice']} {...rest} rules={[{ required: true }]} className="!mb-0"><InputNumber placeholder="Unit price" min={0} prefix="$" /></Form.Item>
              <Form.Item name={[name, 'taxRate']} {...rest} className="!mb-0"><InputNumber placeholder="Tax %" min={0} /></Form.Item>
              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
            </Space>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ quantity: 1, unitPrice: 0, taxRate: 15.5 })}>Add line</Button>
        </>
      )}
    </Form.List>
  );
}

export function DocList(props: {
  path: string;
  idPrefix: string;
  noField: string;
  dateField?: string;
  columns?: ColumnsType<any>;
  createBody?: (v: any) => any;
  formExtra?: React.ReactNode;
  invalidates?: string[];
  kpis?: Kpi[];
  actions?: (record: any) => React.ReactNode;
  statusFilter?: string;
  statusOptions?: { label: string; value: any }[];
  dateFilter?: string;
  canDelete?: boolean;
}) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [statusValue, setStatusValue] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<any>(undefined);
  const [form] = Form.useForm();
  const list = useQuery({ queryKey: [props.path], queryFn: () => api(props.path) });
  const itemOptions = (meta.data?.items || []).map((i: any) => ({ label: `${i.sku} — ${i.name}`, value: i.id }));

  const data = useMemo(() => {
    let rows = list.data || [];
    if (q) rows = rows.filter((r: any) => `${r[props.noField]} ${r.customer?.name || ''} ${r.description || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (statusValue && props.statusFilter) rows = rows.filter((r: any) => r[props.statusFilter as string] === statusValue);
    if (dateRange && props.dateFilter) {
      const [s, e] = dateRange;
      rows = rows.filter((r: any) => {
        const d = dayjs(r[props.dateFilter as string]);
        if (!d.isValid()) return true;
        return !d.isBefore(s, 'day') && !d.isAfter(e, 'day');
      });
    }
    return rows;
  }, [list.data, q, statusValue, dateRange, props.statusFilter, props.dateFilter, props.noField]);

  async function create(v: any) {
    try {
      setSaving(true);
      const payload = props.createBody ? props.createBody(v) : { ...v };
      await api(props.path, { method: 'POST', body: JSON.stringify(payload) });
      message.success(`${props.idPrefix} created`);
      setOpen(false);
      form.resetFields();
      (props.invalidates || [props.path]).forEach((k: string) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  async function remove(id: string) {
    try { await api(`${props.path}/${id}`, { method: 'DELETE' }); message.success(`${props.idPrefix} deleted`); qc.invalidateQueries({ queryKey: [props.path] }); }
    catch (e: any) { message.error(e.message); }
  }

  const dateIndex = props.dateFilter || props.dateField || 'createdAt';

  const cols: ColumnsType<any> = [
    { title: props.idPrefix, dataIndex: props.noField, width: 130, render: (v) => <span className="font-mono font-semibold text-[12px] text-[#003366]">{v}</span> },
    { title: 'Date', dataIndex: dateIndex, width: 110, render: fmtDate },
    { title: 'Customer', render: (_, r: any) => r.customer?.name || r.customerId || '—' },
    { title: 'Total', dataIndex: 'total', align: 'right', width: 120, render: (v) => <span className="font-semibold">{fmtMoney(v)}</span> },
    { title: 'Status', dataIndex: 'status', width: 120, render: (v) => <StatusTag value={v} /> },
    ...(props.columns || []),
  ];
  if (props.actions || props.canDelete) {
    cols.push({
      title: 'Actions', width: 150, render: (_, r: any) => (
        <Space size={4}>
          {props.actions?.(r)}
          {props.canDelete && <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(r.id)} />}
        </Space>
      ),
    });
  }

  return (
    <div className="nex-fade">
      {!!props.kpis?.length && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {props.kpis.map((k, i) => <DocKpi key={i} {...k} />)}
        </div>
      )}
      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <Space wrap>
            <Input allowClear prefix={<span className="text-[#a1a6c0] mr-1">🔍</span>} placeholder={`Search ${props.idPrefix.toLowerCase()}s…`} className="w-60 !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
            {props.statusFilter && (
              <Select allowClear placeholder="Status" className="!min-w-[140px]" value={statusValue} onChange={setStatusValue}
                options={props.statusOptions || [...new Set((list.data || []).map((r: any) => r[props.statusFilter as string]).filter(Boolean))].map((s) => ({ label: String(s).replace(/_/g, ' '), value: s }))} />
            )}
            {props.dateFilter && <DatePicker.RangePicker className="!rounded-xl" value={dateRange} onChange={setDateRange} />}
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setOpen(true); }}>New {props.idPrefix}</Button>
        </div>
        <Table loading={list.isLoading} rowKey="id" dataSource={data} scroll={{ x: true }} columns={cols} pagination={{ pageSize: 10 }} />
      </Card>
      <Modal title={`New ${props.idPrefix}`} open={open} onCancel={() => setOpen(false)} onOk={create} confirmLoading={saving} width={820} destroyOnHidden>
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-2 gap-3">
            <Form.Item label="Branch" name="branchId" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(meta.data?.branches || []).map((b: any) => ({ label: b.name, value: b.id }))} /></Form.Item>
            <Form.Item label="Customer" name="customerId"><Select allowClear showSearch optionFilterProp="label" options={customerOptions(meta.data?.customers)} /></Form.Item>
          </div>
          {props.formExtra}
          <Form.Item label="Lines" required>
            <LinesForm form={form} lines="lines" accounts={itemOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export function DocKpi(props: Kpi) {
  return (
    <div className="nex-stat nex-card-hover">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg" style={{ background: props.color || '#003366', boxShadow: `0 6px 14px ${(props.color || '#003366')}55` }}>{props.icon}</div>
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-[#8a90ad] truncate">{props.label}</div>
          <div className="text-[20px] font-bold text-[#171a2e] leading-tight truncate">{props.value}</div>
          {props.hint && <div className="text-[11px] text-[#a1a6c0]">{props.hint}</div>}
        </div>
      </div>
    </div>
  );
}
