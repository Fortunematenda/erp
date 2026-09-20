'use client';
import { Button, Form, Input, InputNumber, Select, Space, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { AccountSelector } from '@/components/account-selector';
import { fmtMoney } from '@/lib/format';

type ItemOpt = { label: string; value: string | number; price: number; name: string };

function buildItemOptions(items: any[], priceKey: string): ItemOpt[] {
  return (Array.isArray(items) ? items : [])
    .map((i: any): ItemOpt | null => {
      if (i && i.label != null && (i.value != null || i.id != null) && i.sku == null && i.name == null) {
        return {
          label: String(i.label),
          value: i.value ?? i.id,
          price: Number(i.price ?? i[priceKey] ?? i.sellingPrice ?? i.purchaseCost ?? 0) || 0,
          name: String(i.itemName || ''),
        };
      }
      const sku = i?.sku ?? i?.code ?? '';
      const name = i?.name ?? i?.description ?? '';
      const value = i?.id ?? i?.value;
      if (value == null) return null;
      return {
        label: [sku, name].filter(Boolean).join(' — ') || 'Untitled item',
        value,
        price: Number(i?.[priceKey] ?? i?.sellingPrice ?? i?.purchaseCost ?? 0) || 0,
        name: String(name || ''),
      };
    })
    .filter((o): o is ItemOpt => !!o);
}

function LineAmount({ listName, index }: { listName: string; index: number }) {
  const qty = Form.useWatch([listName, index, 'quantity']);
  const price = Form.useWatch([listName, index, 'unitPrice']);
  const amount = Number(qty || 0) * Number(price || 0);
  return (
    <Tooltip title="Amount (Qty × Rate)">
      <span className="inline-block w-24 text-right text-[13px] font-semibold text-[#003366]">{fmtMoney(amount)}</span>
    </Tooltip>
  );
}

export function LineItems({
  form,
  lines = 'lines',
  items = [],
  lineDefaults,
  account = false,
  priceKey = 'sellingPrice',
}: {
  form: any;
  lines?: string;
  items?: any[];
  lineDefaults?: Record<string, any>;
  account?: boolean;
  priceKey?: string;
}) {
  const itemMeta = buildItemOptions(items, priceKey);
  // Select options must be plain {label,value} only — extra fields on options can
  // leak into Form store clones and trigger Ant Design "circular references" warnings.
  const selectOptions = itemMeta.map(({ label, value }) => ({ label, value }));
  const metaById = new Map(itemMeta.map((o) => [o.value, o]));

  function applyItemDefaults(rowIndex: number, itemId: string | number | null | undefined) {
    if (itemId == null || itemId === '') return;
    const meta = metaById.get(itemId);
    if (!meta) return;
    const price = Number(meta.price) || 0;
    const currentDesc = form.getFieldValue([lines, rowIndex, 'description']);
    const patch: { name: (string | number)[]; value: string | number }[] = [
      { name: [lines, rowIndex, 'unitPrice'], value: price },
    ];
    if (!currentDesc && meta.name) {
      patch.push({ name: [lines, rowIndex, 'description'], value: String(meta.name) });
    }
    form.setFields(patch);
  }

  return (
    <Form.List name={lines}>
      {(fields, { add, remove }) => (
        <>
          {fields.map(({ key, name, ...restField }) => (
            <Space key={key} align="baseline" className="w-full mb-2" wrap>
              <Form.Item
                {...restField}
                name={[name, 'description']}
                rules={[{ required: true, message: 'Description' }]}
                className="!mb-0 w-44"
              >
                <Input placeholder="Description" />
              </Form.Item>
              <Form.Item {...restField} name={[name, 'itemId']} className="!mb-0 w-40">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Item"
                  options={selectOptions}
                  onChange={(v) => applyItemDefaults(name, v)}
                />
              </Form.Item>
              <Form.Item {...restField} name={[name, 'quantity']} rules={[{ required: true }]} className="!mb-0">
                <InputNumber placeholder="Qty" min={1} />
              </Form.Item>
              <Form.Item {...restField} name={[name, 'unitPrice']} rules={[{ required: true }]} className="!mb-0">
                <InputNumber placeholder="Unit price" min={0} prefix="$" />
              </Form.Item>
              <Form.Item {...restField} name={[name, 'taxRate']} className="!mb-0">
                <InputNumber placeholder="Tax %" min={0} />
              </Form.Item>
              {account && (
                <Form.Item
                  {...restField}
                  name={[name, 'accountId']}
                  rules={[{ required: true, message: 'Account' }]}
                  className="!mb-0 w-60"
                >
                  <AccountSelector allowedTypes={['EXPENSE', 'ASSET']} postingOnly placeholder="Account" />
                </Form.Item>
              )}
              <LineAmount listName={lines} index={name} />
              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
            </Space>
          ))}
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => add({ quantity: 1, unitPrice: 0, taxRate: 0, ...(lineDefaults || {}) })}
          >
            Add line
          </Button>
        </>
      )}
    </Form.List>
  );
}
