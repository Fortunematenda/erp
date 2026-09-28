'use client';
import { useEffect, useMemo, useState } from 'react';
import { App, Alert, Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Space } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtMoney, fmtNumber } from '@/lib/format';

const REASONS = [
  { value: 'OPENING_BALANCE', label: 'Opening balance' },
  { value: 'STOCK_COUNT', label: 'Stock count correction' },
  { value: 'QUANTITY_INCREASE', label: 'Quantity increase' },
  { value: 'QUANTITY_DECREASE', label: 'Quantity decrease' },
  { value: 'FOUND', label: 'Found stock' },
  { value: 'DAMAGED', label: 'Damaged stock' },
  { value: 'LOST', label: 'Lost stock' },
  { value: 'EXPIRED', label: 'Expired stock' },
  { value: 'OTHER', label: 'Other adjustment' },
];

type Props = {
  open: boolean;
  itemId?: string;
  warehouseId?: string;
  onClose: () => void;
  onDone?: () => void;
};

/** Creates immutable stock movements + GL — never edits quantityOnHand. */
export function StockAdjustmentDrawer({ open, itemId, warehouseId, onClose, onDone }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const mode = Form.useWatch('mode', form) || 'set';
  const whId = Form.useWatch('warehouseId', form);
  const itId = Form.useWatch('itemId', form) || itemId;
  const countedQty = Form.useWatch('countedQty', form);
  const quantity = Form.useWatch('quantity', form);
  const reason = Form.useWatch('reason', form);

  const stock = useQuery({ queryKey: ['/inventory/stock'], queryFn: () => api('/inventory/stock'), enabled: open });
  const position = useMemo(() => {
    const rows = Array.isArray(stock.data) ? stock.data : (stock.data?.value || []);
    return rows.find((r: any) => r.itemId === itId && r.warehouseId === whId);
  }, [stock.data, itId, whId]);

  const systemQty = Number(position?.onHand || 0);
  const avgCost = Number(position?.unitCost || 0);
  const delta = mode === 'set'
    ? Number(((Number(countedQty ?? systemQty) - systemQty)).toFixed(4))
    : Number(quantity || 0) * (['DAMAGED', 'LOST', 'EXPIRED', 'QUANTITY_DECREASE'].includes(reason) ? -1 : 1);

  // Seed only after Drawer has mounted the Form (avoids Ant Design cloneDeep circular-ref warning).
  function seedForm(visible: boolean) {
    if (!visible) {
      setSeeded(false);
      return;
    }
    form.resetFields();
    const wh = warehouseId || meta.data?.warehouses?.[0]?.id;
    form.setFields([
      { name: 'mode', value: 'set' },
      { name: 'reason', value: 'STOCK_COUNT' },
      { name: 'itemId', value: itemId },
      { name: 'warehouseId', value: wh },
      { name: 'date', value: dayjs() },
    ]);
    setSeeded(true);
  }

  useEffect(() => {
    if (!open || !seeded || !(avgCost > 0)) return;
    const current = form.getFieldValue('unitCost');
    if (current == null || current === undefined) {
      form.setFields([{ name: 'unitCost', value: Number(avgCost) }]);
    }
  }, [open, seeded, avgCost, form]);

  async function submit() {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const res = await api('/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          warehouseId: v.warehouseId,
          itemId: v.itemId,
          mode: v.mode,
          countedQty: v.mode === 'set' ? v.countedQty : undefined,
          quantity: v.mode === 'delta' ? v.quantity : undefined,
          reason: v.reason,
          unitCost: v.unitCost,
          // Blank → API allocates ADJ-###### automatically
          reference: v.reference?.trim() || undefined,
          notes: v.notes,
          date: v.date?.format?.('YYYY-MM-DD'),
          postJournal: true,
        }),
      });
      message.success(`Stock adjustment posted (${res.reference || 'saved'}) · on hand now ${fmtNumber(res.afterQty)}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['/inventory'] }),
        qc.invalidateQueries({ queryKey: ['/inventory/stock'] }),
        qc.invalidateQueries({ queryKey: ['/inventory/movements'] }),
        qc.invalidateQueries({ queryKey: ['/inventory/valuation'] }),
        qc.invalidateQueries({ queryKey: ['/inventory/items'] }),
      ]);
      await onDone?.();
      onClose();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.message || 'Adjustment failed');
    } finally {
      setSaving(false);
    }
  }

  const itemOptions = useMemo(
    () => (meta.data?.items || []).map((i: any) => ({ label: `${i.sku} — ${i.name}`, value: i.id })),
    [meta.data?.items],
  );
  const warehouseOptions = useMemo(
    () => (meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id })),
    [meta.data?.warehouses],
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title="Adjust Stock"
      destroyOnHidden
      afterOpenChange={seedForm}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Post Adjustment</Button></Space>}
    >
      <Alert
        type="info"
        showIcon
        className="mb-4"
        message="Accounting adjustment"
        description="Notes are saved on the stock movement and appear on the Movements tab (and on the related journal description)."
      />
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="Item" name="itemId" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" disabled={!!itemId} options={itemOptions} />
        </Form.Item>
        <Form.Item label="Warehouse" name="warehouseId" rules={[{ required: true }]}>
          <Select options={warehouseOptions} />
        </Form.Item>
        <Form.Item label="Adjustment date" name="date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
        <Form.Item label="Reason" name="reason" rules={[{ required: true }]}><Select options={REASONS} /></Form.Item>
        <Form.Item label="Mode" name="mode" rules={[{ required: true }]}>
          <Select options={[{ label: 'Set to counted quantity', value: 'set' }, { label: 'Adjust by quantity (delta)', value: 'delta' }]} />
        </Form.Item>

        <div className="nex-card mb-4 px-4 py-3 !rounded-xl grid grid-cols-3 gap-3 text-center">
          <div><div className="text-[11px] text-[#64748b]">System qty</div><div className="font-bold">{fmtNumber(systemQty)}</div></div>
          <div><div className="text-[11px] text-[#64748b]">Difference</div><div className={`font-bold ${delta < 0 ? 'text-[#ef4444]' : delta > 0 ? 'text-[#16a34a]' : ''}`}>{fmtNumber(delta)}</div></div>
          <div><div className="text-[11px] text-[#64748b]">Avg cost</div><div className="font-bold">{fmtMoney(avgCost)}</div></div>
        </div>

        {mode === 'set' ? (
          <Form.Item label="Counted / new quantity" name="countedQty" rules={[{ required: true }]}><InputNumber className="w-full" min={0} /></Form.Item>
        ) : (
          <Form.Item label="Adjustment quantity" name="quantity" rules={[{ required: true }]} extra="Sign is inferred from reason (damage/loss = decrease)"><InputNumber className="w-full" min={0.0001} /></Form.Item>
        )}
        <Form.Item label="Unit cost" name="unitCost" extra="Defaults to weighted average; required for opening balance valuation">
          <InputNumber prefix="$" className="w-full" min={0} />
        </Form.Item>
        <Form.Item
          label="Reference"
          name="reference"
          extra="Leave blank to auto-generate the next ADJ number (e.g. ADJ-000009)"
        >
          <Input placeholder="Auto: ADJ-######" allowClear />
        </Form.Item>
        <Form.Item label="Notes" name="notes" rules={[{ required: true, message: 'Notes are required for the audit trail' }]} extra="Shown on the Movements tab after posting">
          <Input.TextArea rows={2} placeholder="e.g. Damaged in transit — pallet #12" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
