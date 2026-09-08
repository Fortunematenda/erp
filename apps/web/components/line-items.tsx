'use client';
import { Button, Form, Input, InputNumber, Select, Space, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { AccountSelector } from '@/components/account-selector';
import { fmtMoney } from '@/lib/format';

export function LineItems({ form, lines = 'lines', items = [], lineDefaults, account = false, priceKey = 'sellingPrice' }: { form: any; lines?: string; items?: any[]; lineDefaults?: Record<string, any>; account?: boolean; priceKey?: string }) {
  const opts = items.map((i: any) => ({
    label: `${i.sku} — ${i.name}${Number(i.sellingPrice) ? ' ($' + Number(i.sellingPrice).toFixed(2) + ')' : ''}`,
    value: i.id,
    price: Number(i[priceKey] ?? i.sellingPrice ?? 0),
    name: i.name,
  }));
  const watchIdx = (name: number) => [lines, name];
  return (
    <Form.List name={lines}>
      {(fields, { add, remove }) => (
        <>
          {fields.map(({ key, name, ...rest }) => (
            <Form.Item key={key} noStyle shouldUpdate={(prev: any, cur: any) => prev[lines]?.[name]?.quantity !== cur[lines]?.[name]?.quantity || prev[lines]?.[name]?.unitPrice !== cur[lines]?.[name]?.unitPrice}>
              {() => {
                const v = form.getFieldValue(watchIdx(name)) || {};
                const amount = Number(v.quantity || 0) * Number(v.unitPrice || 0);
                return (
                  <Space align="baseline" className="w-full mb-2" wrap>
                    <Form.Item name={[name, 'description']} {...rest} rules={[{ required: true, message: 'Description' }]} className="!mb-0 w-44"><Input placeholder="Description" /></Form.Item>
                    <Form.Item name={[name, 'itemId']} {...rest} className="!mb-0 w-40">
                      <Select allowClear showSearch optionFilterProp="label" placeholder="Item"
                        onChange={(v, _o) => {
                          const o = opts.find((x) => x.value === v);
                          if (!o) return;
                          form.setFieldValue([lines, name, 'unitPrice'], o.price);
                          if (!form.getFieldValue([lines, name, 'description']) && o.name) form.setFieldValue([lines, name, 'description'], o.name);
                        }}
                        options={opts} />
                    </Form.Item>
                    <Form.Item name={[name, 'quantity']} {...rest} rules={[{ required: true }]} className="!mb-0"><InputNumber placeholder="Qty" min={1} /></Form.Item>
                    <Form.Item name={[name, 'unitPrice']} {...rest} rules={[{ required: true }]} className="!mb-0"><InputNumber placeholder="Unit price" min={0} prefix="$" /></Form.Item>
                    <Form.Item name={[name, 'taxRate']} {...rest} className="!mb-0"><InputNumber placeholder="Tax %" min={0} /></Form.Item>
                    {account && <Form.Item name={[name, 'accountId']} {...rest} rules={[{ required: true, message: 'Account' }]} className="!mb-0 w-60"><AccountSelector allowedTypes={['EXPENSE', 'ASSET']} postingOnly placeholder="Account" /></Form.Item>}
                    <Tooltip title="Amount (Qty × Rate)"><span className="inline-block w-24 text-right text-[13px] font-semibold text-[#003366]">{fmtMoney(amount)}</span></Tooltip>
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                  </Space>
                );
              }}
            </Form.Item>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ quantity: 1, unitPrice: 0, taxRate: 0, ...lineDefaults })}>Add line</Button>
        </>
      )}
    </Form.List>
  );
}
