'use client';
import { useEffect } from 'react';
import { Alert, App, Button, Checkbox, Divider, Drawer, Form, Input, InputNumber, Radio, Select, Space } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtNumber } from '@/lib/format';
import { ITEM_TYPE, ITEM_TYPE_LABELS, TRACKING_HINTS, TRACKING_LABELS, isStockTracked, itemTypeOptions, normalizeItemType, trackingStatus, type ItemType } from '@/lib/item-type';

const SERVICE_UNITS = ['Each', 'Hour', 'Day', 'Job', 'Month', 'Project'];

type Props = {
  open: boolean;
  itemId?: string | null;
  initial?: any | null;
  onClose: () => void;
  onSaved?: (item: any) => void;
};

/** Master-data editor — fields depend on Item Type (Inventory / Non-Inventory / Service). */
export function ItemFormDrawer({ open, itemId, initial, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const categories = useQuery({ queryKey: ['/inventory/categories'], queryFn: () => api('/inventory/categories'), enabled: open });
  const detail = useQuery({
    queryKey: ['/inventory/items', itemId, 'edit'],
    queryFn: () => api(`/inventory/items/${itemId}`),
    enabled: open && !!itemId && !initial,
  });

  const item = initial || detail.data?.item;
  const total = detail.data?.total || { onHand: initial?.onHand ?? 0, available: initial?.available ?? 0 };
  const typeWatch = Form.useWatch('type', form) as ItemType | undefined;
  const itemType = normalizeItemType(typeWatch || item?.type);
  const stock = isStockTracked(itemType);
  const isSvc = itemType === ITEM_TYPE.SERVICE;
  const typeLocked = !!(item?.id && (detail.data?.typeLocked || initial?.typeLocked || Number(item?.onHand) > 0 || (detail.data?.movements || []).length > 0));

  useEffect(() => {
    if (!open) return;
    if (item) {
      form.setFieldsValue({
        ...item,
        type: normalizeItemType(item.type),
        sellingPrice: Number(item.sellingPrice || 0),
        purchaseCost: Number(item.purchaseCost || 0),
        reorderLevel: Number(item.reorderLevel || 0),
        reorderQuantity: Number(item.reorderQuantity || 0),
        minSellingPrice: item.minSellingPrice != null ? Number(item.minSellingPrice) : undefined,
        costingMethod: item.costingMethod || 'WEIGHTED_AVERAGE',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        type: ITEM_TYPE.INVENTORY_PRODUCT,
        unit: 'EA',
        active: true,
        costingMethod: 'WEIGHTED_AVERAGE',
        allowDiscount: true,
      });
    }
  }, [open, item]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || item?.id) return;
    if (isSvc && (!form.getFieldValue('unit') || form.getFieldValue('unit') === 'EA')) {
      form.setFieldValue('unit', 'Hour');
    }
  }, [itemType, open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    try {
      const v = await form.validateFields();
      const payload = { ...v, type: normalizeItemType(v.type), categoryId: v.categoryId || undefined };
      const saved = item?.id
        ? await api(`/inventory/items/${item.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/inventory/items', { method: 'POST', body: JSON.stringify(payload) });
      message.success(item?.id ? 'Item updated' : 'Item created');
      qc.invalidateQueries({ queryKey: ['/inventory/items'] });
      qc.invalidateQueries({ queryKey: ['meta'] });
      onSaved?.(saved);
      onClose();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.message || 'Could not save item');
    }
  }

  const accounts = (meta.data?.accounts || []).map((a: any) => ({ label: `${a.code} — ${a.name}`, value: a.id }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={720}
      title={item?.id ? `Edit ${ITEM_TYPE_LABELS[itemType]}` : 'New Product or Service'}
      destroyOnHidden
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={save}>{item?.id ? 'Save' : 'Create'}</Button></Space>}
    >
      <Form form={form} layout="vertical">
        <Form.Item label="Item Type" name="type" rules={[{ required: true, message: 'Select an item type' }]} className="mb-2">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            disabled={typeLocked}
            options={itemTypeOptions()}
            className="flex flex-wrap gap-1"
          />
        </Form.Item>
        {typeLocked && (
          <Alert
            type="warning"
            showIcon
            className="mb-4"
            message="This item's type cannot be changed because it already has transaction history."
          />
        )}
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message={`${TRACKING_LABELS[trackingStatus(itemType)]} — ${TRACKING_HINTS[itemType]}`}
        />

        {item?.id && stock && (
          <div className="nex-card mb-4 px-4 py-3 !rounded-xl flex flex-wrap items-center gap-6">
            <div>
              <div className="text-[12px] text-[#64748b]">Quantity on Hand</div>
              <div className="text-[18px] font-bold text-[#171a2e]">{fmtNumber(total.onHand)}</div>
            </div>
            <div>
              <div className="text-[12px] text-[#64748b]">Available</div>
              <div className="text-[18px] font-bold text-[#16a34a]">{fmtNumber(total.available)}</div>
            </div>
            <div className="text-[12px] text-[#64748b] max-w-xs">Quantity cannot be edited here. Use Adjust Stock to create an accounting movement.</div>
          </div>
        )}

        <Divider orientation="left" plain>General</Divider>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label={isSvc ? 'Service Code / SKU' : 'SKU'} name="sku">
            <Input placeholder="Auto if blank" />
          </Form.Item>
          {!isSvc && (
            <Form.Item label="Barcode" name="barcode"><Input /></Form.Item>
          )}
          <Form.Item label={isSvc ? 'Service Name' : 'Item Name'} name="name" rules={[{ required: true }]} className="col-span-2">
            <Input />
          </Form.Item>
          <Form.Item label={isSvc ? 'Service Unit' : 'Unit of Measure'} name="unit">
            {isSvc ? (
              <Select options={SERVICE_UNITS.map((u) => ({ label: u, value: u }))} />
            ) : (
              <Input />
            )}
          </Form.Item>
          <Form.Item label="Category" name="categoryId">
            <Select allowClear showSearch optionFilterProp="label" options={(categories.data || []).map((c: any) => ({ label: c.name, value: c.id }))} />
          </Form.Item>
          <Form.Item label="Description" name="description" className="col-span-2"><Input.TextArea rows={2} /></Form.Item>
          {!isSvc && (
            <>
              <Form.Item label="Brand" name="brand"><Input /></Form.Item>
              <Form.Item label="HS Code" name="hsCode"><Input /></Form.Item>
            </>
          )}
        </div>

        <Divider orientation="left" plain>Sales</Divider>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label={isSvc ? 'Service Rate' : 'Sales Price (default)'} name="sellingPrice" extra="Does not change historical invoices">
            <InputNumber prefix="$" className="w-full" min={0} />
          </Form.Item>
          {!isSvc && (
            <Form.Item label="Min Selling Price" name="minSellingPrice"><InputNumber prefix="$" className="w-full" min={0} /></Form.Item>
          )}
          <Form.Item label="Sales Tax Code" name="salesTaxCode"><Input /></Form.Item>
          <Form.Item label={isSvc ? 'Service Revenue Account' : 'Income / Sales Account'} name="incomeAccountId">
            <Select allowClear showSearch optionFilterProp="label" options={accounts} />
          </Form.Item>
          <Form.Item label="Sales Description" name="salesDescription" className="col-span-2"><Input.TextArea rows={2} /></Form.Item>
        </div>

        <Divider orientation="left" plain>Purchasing</Divider>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            label={isSvc ? 'Subcontractor / Purchase Cost' : 'Default Purchase Price'}
            name="purchaseCost"
            extra={stock ? 'Default for new POs only — not live stock cost' : undefined}
          >
            <InputNumber prefix="$" className="w-full" min={0} />
          </Form.Item>
          <Form.Item label="Preferred Supplier" name="preferredSupplierId">
            <Select allowClear showSearch optionFilterProp="label" options={(meta.data?.suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))} />
          </Form.Item>
          <Form.Item label="Purchase Tax Code" name="purchaseTaxCode"><Input /></Form.Item>
          {!isSvc && <Form.Item label="Supplier SKU" name="supplierSku"><Input /></Form.Item>}
          <Form.Item
            label={stock ? 'COGS Account' : isSvc ? 'Service Expense Account' : 'Purchase / Expense Account'}
            name={stock ? 'cogsAccountId' : 'expenseAccountId'}
          >
            <Select allowClear showSearch optionFilterProp="label" options={accounts} />
          </Form.Item>
          <Form.Item label="Purchase Description" name="purchaseDescription" className="col-span-2"><Input.TextArea rows={2} /></Form.Item>
        </div>

        {stock && (
          <>
            <Divider orientation="left" plain>Inventory</Divider>
            <div className="grid grid-cols-2 gap-4">
              <Form.Item label="Costing Method" name="costingMethod">
                <Select options={[{ label: 'Weighted Average (active)', value: 'WEIGHTED_AVERAGE' }, { label: 'FIFO (not yet implemented)', value: 'FIFO', disabled: true }]} />
              </Form.Item>
              <Form.Item label="Default Warehouse" name="defaultWarehouseId">
                <Select allowClear options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} />
              </Form.Item>
              <Form.Item label="Reorder Level" name="reorderLevel"><InputNumber className="w-full" min={0} /></Form.Item>
              <Form.Item label="Reorder Quantity" name="reorderQuantity"><InputNumber className="w-full" min={0} /></Form.Item>
              <Form.Item label="Inventory Asset Account" name="inventoryAssetAccountId"><Select allowClear showSearch optionFilterProp="label" options={accounts} /></Form.Item>
              <Form.Item label="Adjustment Account" name="adjustmentAccountId" extra="P&L account for stock gains/losses"><Select allowClear showSearch optionFilterProp="label" options={accounts} /></Form.Item>
              <Form.Item label="Track Batch" name="trackBatch" valuePropName="checked"><Checkbox /></Form.Item>
              <Form.Item label="Track Serial" name="trackSerial" valuePropName="checked"><Checkbox /></Form.Item>
            </div>
          </>
        )}

        <Divider orientation="left" plain>Status</Divider>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Allow Discount" name="allowDiscount" valuePropName="checked"><Checkbox /></Form.Item>
          <Form.Item label="Active" name="active" valuePropName="checked"><Checkbox /></Form.Item>
        </div>
      </Form>
    </Drawer>
  );
}
