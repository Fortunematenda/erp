'use client';
import { useEffect, useState } from 'react';
import { App, Alert, Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Space } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';

type Props = {
  open: boolean;
  itemId?: string;
  fromWarehouseId?: string;
  onClose: () => void;
  onDone?: () => void;
};

/** Transfer creates linked TRANSFER_OUT + TRANSFER_IN at WAC — company stock unchanged. */
export function TransferDrawer({ open, itemId, fromWarehouseId, onClose, onDone }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      itemId,
      fromWarehouseId: fromWarehouseId || meta.data?.warehouses?.[0]?.id,
      date: dayjs(),
    });
  }, [open, itemId, fromWarehouseId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    try {
      const v = await form.validateFields();
      if (v.fromWarehouseId === v.toWarehouseId) {
        message.error('Source and destination warehouses must differ');
        return;
      }
      setSaving(true);
      await api('/inventory/transfers', {
        method: 'POST',
        body: JSON.stringify({
          fromWarehouseId: v.fromWarehouseId,
          toWarehouseId: v.toWarehouseId,
          itemId: v.itemId,
          quantity: v.quantity,
          reference: v.reference,
          notes: v.notes,
          date: v.date?.format?.('YYYY-MM-DD'),
        }),
      });
      message.success('Transfer posted');
      qc.invalidateQueries({ queryKey: ['/inventory'] });
      qc.invalidateQueries({ queryKey: ['/inventory/stock'] });
      qc.invalidateQueries({ queryKey: ['/inventory/movements'] });
      onDone?.();
      onClose();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.message || 'Transfer failed');
    } finally {
      setSaving(false);
    }
  }

  const wh = (meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      title="Transfer Stock"
      destroyOnHidden
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Post Transfer</Button></Space>}
    >
      <Alert type="info" showIcon className="mb-4" message="Creates TRANSFER_OUT and TRANSFER_IN at weighted-average cost. Total company stock is unchanged." />
      <Form form={form} layout="vertical">
        <Form.Item label="Item" name="itemId" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" disabled={!!itemId} options={(meta.data?.items || []).map((i: any) => ({ label: `${i.sku} — ${i.name}`, value: i.id }))} />
        </Form.Item>
        <Form.Item label="From warehouse" name="fromWarehouseId" rules={[{ required: true }]}><Select options={wh} /></Form.Item>
        <Form.Item label="To warehouse" name="toWarehouseId" rules={[{ required: true }]}><Select options={wh} /></Form.Item>
        <Form.Item label="Quantity" name="quantity" rules={[{ required: true }]}><InputNumber className="w-full" min={0.0001} /></Form.Item>
        <Form.Item label="Date" name="date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
        <Form.Item label="Reference" name="reference"><Input /></Form.Item>
        <Form.Item label="Notes" name="notes"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Drawer>
  );
}
