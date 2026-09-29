'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Alert, Button, Card, ConfigProvider, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Select, Space, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, PrinterOutlined, ShoppingCartOutlined, SwapOutlined, FileAddOutlined, EyeOutlined, EditOutlined, CheckCircleOutlined, CloseOutlined, SyncOutlined, DeleteOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { StatusTag } from '@/components/crud-page';
import { RowActionsMenu, ACTIONS_COL } from '@/components/row-actions-menu';
import { Can, useAuthPermissions } from '@/components/Can';
import { SkeletonTable, SectionLoading } from '@/components/loading';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';

const OPEN_STATUSES = ['OPEN', 'APPROVED', 'PART_RECEIVED', 'RECEIVED'];

export function PurchaseOrdersWorkspace() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const router = useRouter();
  const meta = useMeta();
  const { permissions } = useAuthPermissions();
  const can = (p: string) => permissions.includes(p);
  const canManage = can('procurement.purchase_orders.create');
  const canApprove = can('procurement.purchase_orders.approve');
  const canBill = can('procurement.bills.manage');
  const list = useQuery({ queryKey: ['/procurement/purchase-orders'], queryFn: () => api('/procurement/purchase-orders') });
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiveId, setReceiveId] = useState<string | null>(null);

  const invalidate = () => ['/procurement/purchase-orders', '/procurement/grns', '/procurement/supplier-invoices', '/procurement/supplier-payments', '/inventory/stock', '/procurement/dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  async function act(path: string, method: string, body: any, msg: string) {
    try { await api(path, { method, body: body ? JSON.stringify(body) : undefined }); message.success(msg); invalidate(); }
    catch (e: any) { message.error(e.message); }
  }

  const cols: ColumnsType<any> = [
    { title: 'PO No', dataIndex: 'poNo', width: 120, render: (v, r: any) => <a className="font-mono text-[12px] text-[#1d5fb5]" onClick={() => setDetailId(r.id)}>{v}</a> },
    { title: 'Supplier', width: 170, render: (_v, r: any) => r.supplier?.name || '—' },
    { title: 'Date', dataIndex: 'orderDate', width: 110, render: fmtDate },
    { title: 'Total', dataIndex: 'total', width: 110, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Received', width: 130, align: 'right', render: (_v, r: any) => <span className="text-[12px]">{fmtNumber(r.progress?.received)} / {fmtNumber(r.progress?.ordered)}</span> },
    { title: 'Billed', width: 130, align: 'right', render: (_v, r: any) => <span className="text-[12px]">{fmtNumber(r.progress?.billed)} / {fmtNumber(r.progress?.ordered)}</span> },
    { title: 'Status', dataIndex: 'status', width: 120, render: (v) => <StatusTag value={v} /> },
    { ...ACTIONS_COL, render: (_v, r: any) => (
      <RowActionsMenu items={[
        { key: 'view', label: 'View Purchase Order', icon: <EyeOutlined />, onClick: () => setDetailId(r.id) },
        ...(r.status === 'DRAFT' && canManage ? [{ key: 'edit', label: 'Edit Draft', icon: <EditOutlined />, onClick: () => { setEditId(r.id); setFormOpen(true); } }] : []),
        ...(r.status === 'DRAFT' && canApprove ? [{ key: 'approve', label: 'Approve', icon: <CheckCircleOutlined />, onClick: () => act(`/procurement/purchase-orders/${r.id}/status`, 'PATCH', { status: 'APPROVED' }, 'Purchase order approved') }] : []),
        ...(OPEN_STATUSES.includes(r.status) && (r.progress?.remainingToReceive > 0) && r.progress?.receivingRequired && (canApprove || canManage) ? [{ key: 'receive', label: 'Receive Items', icon: <SwapOutlined />, onClick: () => setReceiveId(r.id) }] : []),
        ...(OPEN_STATUSES.includes(r.status) && (r.progress?.remainingToBill > 0) && canBill ? [{ key: 'bill', label: 'Create Bill', icon: <FileAddOutlined />, onClick: () => router.push(`/expenses/enter-bill?purchaseOrderId=${r.id}`) }] : []),
        { key: 'print', label: 'Print / PDF', icon: <PrinterOutlined />, onClick: () => window.open(`/documents/purchase-order/${r.id}`, '_blank') },
        ...(OPEN_STATUSES.includes(r.status) && canApprove ? [{ key: 'close', label: 'Close', onClick: () => act(`/procurement/purchase-orders/${r.id}/status`, 'PATCH', { status: 'CLOSED' }, 'Purchase order closed') }] : []),
        ...(['DRAFT', 'OPEN', 'APPROVED'].includes(r.status) && canApprove ? [{ key: 'cancel', label: 'Cancel', danger: true, icon: <CloseOutlined />, onClick: () => act(`/procurement/purchase-orders/${r.id}/status`, 'PATCH', { status: 'CANCELLED' }, 'Purchase order cancelled') }] : []),
      ]} />
    ) },
  ];

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Space>
          <Button icon={<SyncOutlined />} onClick={() => list.refetch()} loading={list.isFetching}>Refresh</Button>
          {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditId(null); setFormOpen(true); }}>New Purchase Order</Button>}
        </Space>
      </div>
      {list.isLoading ? <SkeletonTable rows={8} columns={8} /> : (
        <Table rowKey="id" dataSource={list.data || []} columns={cols} scroll={{ x: 1300 }} pagination={{ pageSize: 15 }} />
      )}

      <PoFormDrawer open={formOpen} editId={editId} onClose={() => setFormOpen(false)} onSaved={invalidate} />
      <PoDetailDrawer id={detailId} onClose={() => setDetailId(null)} onReceive={(id) => { setDetailId(null); setReceiveId(id); }} onBill={(id) => { setDetailId(null); router.push(`/expenses/enter-bill?purchaseOrderId=${id}`); }} onChanged={invalidate} />
      <ReceiveDrawer id={receiveId} onClose={() => setReceiveId(null)} onDone={invalidate} />
    </div>
  );
}

function PoFormDrawer({ open, editId, onClose, onSaved }: { open: boolean; editId: string | null; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const detail = useQuery({ queryKey: ['/procurement/purchase-orders', editId], queryFn: () => api(`/procurement/purchase-orders/${editId}`), enabled: open && !!editId });

  const lines = Form.useWatch('lines', form) || [];
  const totals = useMemo(() => {
    let sub = 0, tax = 0;
    for (const l of lines) { const net = Number(l?.quantity || 0) * Number(l?.unitPrice || 0); sub += net; tax += net * Number(l?.taxRate || 0) / 100; }
    return { sub, tax, total: sub + tax };
  }, [lines]);

  const supplierId = Form.useWatch('supplierId', form);

  function onSupplier(id: string) {
    const s = (meta.data?.suppliers || []).find((x: any) => x.id === id);
    if (s) form.setFieldsValue({ currency: s.currency || 'USD', paymentTerms: s.paymentTerms || undefined, shipTo: form.getFieldValue('shipTo') || [s.address1, s.city, s.country].filter(Boolean).join(', ') });
  }

  function fill() {
    const d = detail.data;
    if (d) form.setFieldsValue({ supplierId: d.supplierId, orderDate: d.orderDate ? dayjs(d.orderDate) : undefined, expectedDate: d.expectedDate ? dayjs(d.expectedDate) : undefined, warehouseId: d.warehouseId, currency: d.currency, paymentTerms: d.paymentTerms, supplierReference: d.supplierReference, shipTo: d.shipTo, memo: d.memo, lines: (d.lines || []).map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: 0 })) });
    else { form.resetFields(); form.setFieldsValue({ currency: 'USD', orderDate: dayjs(), lines: [{ quantity: 1, unitPrice: 0, taxRate: 0 }] }); }
  }

  async function submit() {
    try {
      const v = await form.validateFields();
      if (!v.lines?.length) return message.error('Add at least one line');
      setSaving(true);
      const body = {
        supplierId: v.supplierId, orderDate: v.orderDate?.format('YYYY-MM-DD'), expectedDate: v.expectedDate?.format('YYYY-MM-DD'),
        warehouseId: v.warehouseId, currency: v.currency, paymentTerms: v.paymentTerms, supplierReference: v.supplierReference, shipTo: v.shipTo, memo: v.memo,
        lines: v.lines.map((l: any) => ({ description: l.description, itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate || 0) })),
      };
      if (editId) await api(`/procurement/purchase-orders/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/procurement/purchase-orders', { method: 'POST', body: JSON.stringify(body) });
      message.success(editId ? 'Purchase order updated' : 'Purchase order created');
      onSaved(); onClose();
    } catch (e: any) { if (!e?.errorFields) message.error(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} width={980} destroyOnHidden afterOpenChange={(v) => { if (v) fill(); }}
      title={editId ? 'Edit Purchase Order' : 'New Purchase Order'}
      styles={{ body: { padding: '18px 24px 8px' } }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-6 text-[13px]">
            <span className="text-[#64748b]">Subtotal <b className="text-[#171a2e] ml-1">{fmtMoney(totals.sub)}</b></span>
            <span className="text-[#64748b]">Tax <b className="text-[#171a2e] ml-1">{fmtMoney(totals.tax)}</b></span>
            <span className="text-[14px] text-[#64748b]">Total <b className="text-[#003366] text-[16px] ml-1">{fmtMoney(totals.total)}</b></span>
          </div>
          <Space>
            <Button onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={submit}>{saving ? 'Creating…' : editId ? 'Save Purchase Order' : 'Create Purchase Order'}</Button>
          </Space>
        </div>
      }>
      <ConfigProvider componentSize="large">
        <Form form={form} layout="vertical" requiredMark={false} className="nex-po-form">
          <div className="nex-form-section">Purchase Details</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4">
            <Form.Item label="Supplier" name="supplierId" rules={[{ required: true, message: 'Select a supplier' }]} className="sm:col-span-2">
              <Select showSearch optionFilterProp="label" placeholder="Select supplier" onChange={onSupplier} options={(meta.data?.suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))} />
            </Form.Item>
            <Form.Item label="PO Date" name="orderDate"><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Expected Date" name="expectedDate"><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Warehouse" name="warehouseId"><Select allowClear placeholder="Warehouse" options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} /></Form.Item>
            <Form.Item label="Currency" name="currency"><Select options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item>
            <Form.Item label="Payment Terms" name="paymentTerms"><Select allowClear placeholder="Terms" options={['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 60'].map((t) => ({ label: t, value: t }))} /></Form.Item>
            <Form.Item label="Reference" name="supplierReference"><Input placeholder="Optional" /></Form.Item>
            <Form.Item label="Ship / Receive To" name="shipTo" className="sm:col-span-2"><Input placeholder="Delivery address" /></Form.Item>
            <Form.Item label="Notes" name="memo" className="sm:col-span-2"><Input placeholder="Internal notes" /></Form.Item>
          </div>

          <div className="nex-form-section mt-5">Items</div>
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[minmax(180px,2.2fr)_minmax(160px,1.8fr)_110px_120px_80px_120px_40px] gap-x-3 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8] border-b border-[#e6e9f2]">
                <span>Item</span><span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit Cost</span><span className="text-right">Tax</span><span className="text-right">Amount</span><span />
              </div>
              <Form.List name="lines">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((field) => (
                      <PoLineRow key={field.key} field={field} form={form} items={meta.data?.items || []} onRemove={remove} />
                    ))}
                    <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ quantity: 1, unitPrice: 0, taxRate: 0 })} className="mt-3">Add Line</Button>
                  </>
                )}
              </Form.List>
            </div>
          </div>
        </Form>
      </ConfigProvider>
    </Drawer>
  );
}

function PoLineRow({ field, form, items, onRemove }: any) {
  const { key, name, ...rest } = field;
  const unit = Form.useWatch(['lines', name, 'unit'], form);
  const qty = Form.useWatch(['lines', name, 'quantity'], form);
  const price = Form.useWatch(['lines', name, 'unitPrice'], form);
  function applyItem(itemId: string) {
    const it = (items || []).find((x: any) => x.id === itemId);
    if (!it) return;
    const patch: any[] = [
      { name: ['lines', name, 'unitPrice'], value: Number(it.purchaseCost || 0) },
      { name: ['lines', name, 'unit'], value: it.unit },
    ];
    if (!form.getFieldValue(['lines', name, 'description'])) patch.push({ name: ['lines', name, 'description'], value: it.purchaseDescription || it.name });
    form.setFields(patch);
  }
  return (
    <div className="grid grid-cols-[minmax(180px,2.2fr)_minmax(160px,1.8fr)_110px_120px_80px_120px_40px] gap-x-3 items-start px-1 py-1.5 border-b border-[#f0f1f6]">
      <Form.Item {...rest} name={[name, 'itemId']} className="!mb-0">
        <Select showSearch allowClear optionFilterProp="label" placeholder="Select item" options={(items || []).map((i: any) => ({ label: [i.sku, i.name].filter(Boolean).join(' — '), value: i.id }))} onChange={applyItem} />
      </Form.Item>
      <Form.Item {...rest} name={[name, 'description']} className="!mb-0" rules={[{ required: true, message: 'Description' }]}>
        <Input placeholder="Description" />
      </Form.Item>
      <Form.Item {...rest} name={[name, 'quantity']} className="!mb-0" rules={[{ required: true, message: 'Qty' }]}>
        <InputNumber className="w-full" min={0} style={{ textAlign: 'right' }} addonAfter={unit || undefined} />
      </Form.Item>
      <Form.Item {...rest} name={[name, 'unitPrice']} className="!mb-0" rules={[{ required: true, message: 'Cost' }]}>
        <InputNumber className="w-full" min={0} prefix="$" style={{ textAlign: 'right' }} />
      </Form.Item>
      <Form.Item {...rest} name={[name, 'taxRate']} className="!mb-0">
        <InputNumber className="w-full" min={0} style={{ textAlign: 'right' }} />
      </Form.Item>
      <Form.Item {...rest} name={[name, 'unit']} hidden><Input /></Form.Item>
      <div className="flex items-center h-10 justify-end text-[13px] font-semibold text-[#003366]">{fmtMoney(Number(qty || 0) * Number(price || 0))}</div>
      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => onRemove(name)} className="!h-10" />
    </div>
  );
}

function PoDetailDrawer({ id, onClose, onReceive, onBill, onChanged }: { id: string | null; onClose: () => void; onReceive: (id: string) => void; onBill: (id: string) => void; onChanged: () => void }) {
  const { message } = App.useApp();
  const detail = useQuery({ queryKey: ['/procurement/purchase-orders', id], queryFn: () => api(`/procurement/purchase-orders/${id}`), enabled: !!id });
  const related = useQuery({ queryKey: ['/procurement/purchase-orders', id, 'related'], queryFn: () => api(`/procurement/purchase-orders/${id}/related`), enabled: !!id });
  const match = useQuery({ queryKey: ['/procurement/purchase-orders', id, 'match'], queryFn: () => api(`/procurement/purchase-orders/${id}/match`), enabled: !!id });
  const d = detail.data;
  const p = d?.progress || {};

  const itemCols: ColumnsType<any> = [
    { title: 'Item', render: (_v, r: any) => r.description || '—' },
    { title: 'Ordered', dataIndex: 'quantity', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Received', dataIndex: 'receivedQty', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Billed', dataIndex: 'invoicedQty', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Remaining', align: 'right', render: (_v, r: any) => fmtNumber(Math.max(0, Number(r.quantity) - Number(r.receivedQty))) },
    { title: 'Cost', dataIndex: 'unitPrice', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Line Total', dataIndex: 'lineTotal', align: 'right', render: (v: any) => fmtMoney(v) },
  ];
  const matchCols: ColumnsType<any> = [
    { title: 'Item', render: (_v, r: any) => r.description },
    { title: 'Ordered', dataIndex: 'poQty', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Received', dataIndex: 'receivedQty', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'Billed', dataIndex: 'invoiceQty', align: 'right', render: (v: any) => fmtNumber(v) },
    { title: 'PO Cost', dataIndex: 'poPrice', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Bill Cost', dataIndex: 'invoicePrice', align: 'right', render: (v: any) => fmtMoney(v) },
    { title: 'Variance', dataIndex: 'variance', align: 'right', render: (v) => <span className={Number(v) ? 'text-[#e11d48]' : 'text-[#16a34a]'}>{fmtMoney(v)}</span> },
  ];

  const tabs = [
    { key: 'overview', label: 'Overview', children: d ? <Descriptions column={2} size="small" bordered items={[
      { key: 'po', label: 'PO Number', children: d.poNo },
      { key: 'sup', label: 'Supplier', children: d.supplier?.name || '—' },
      { key: 'date', label: 'PO Date', children: fmtDate(d.orderDate) },
      { key: 'exp', label: 'Expected', children: d.expectedDate ? fmtDate(d.expectedDate) : '—' },
      { key: 'wh', label: 'Warehouse', children: (d as any).warehouseId || '—' },
      { key: 'cur', label: 'Currency', children: d.currency },
      { key: 'status', label: 'Status', children: <StatusTag value={d.status} /> },
      { key: 'total', label: 'Total', children: fmtMoney(d.total) },
    ]} /> : <Empty /> },
    { key: 'items', label: 'Items', children: <Table rowKey="id" size="small" dataSource={d?.lines || []} columns={itemCols} pagination={false} /> },
    { key: 'receiving', label: `Receiving (${related.data?.goodsReceipts?.length || 0})`, children: <Table rowKey="id" size="small" dataSource={related.data?.goodsReceipts || []} pagination={false} columns={[
      { title: 'Receipt', dataIndex: 'grnNo', render: (v, r: any) => <a className="text-[#1d5fb5]" onClick={() => window.open(`/documents/goods-received-note/${r.id}`, '_blank')}>{v}</a> },
      { title: 'Date', dataIndex: 'receivedAt', render: fmtDate }, { title: 'Status', dataIndex: 'status', render: (v) => <StatusTag value={v} /> },
    ]} /> },
    { key: 'billing', label: `Billing (${related.data?.bills?.length || 0})`, children: <Table rowKey="id" size="small" dataSource={related.data?.bills || []} pagination={false} columns={[
      { title: 'Bill', dataIndex: 'invoiceNo', render: (v) => <a className="text-[#1d5fb5]" onClick={() => window.open('/expenses/bills', '_blank')}>{v}</a> },
      { title: 'Status', dataIndex: 'status', render: (v) => <StatusTag value={v} /> },
      { title: 'Total', dataIndex: 'total', align: 'right', render: (v: any) => fmtMoney(v) },
      { title: 'Balance', dataIndex: 'balanceDue', align: 'right', render: (v: any) => fmtMoney(v) },
      { title: 'Payment', dataIndex: 'paymentStatus', render: (v) => <StatusTag value={v} /> },
    ]} /> },
    { key: 'matching', label: 'Three-Way Matching', children: <Table rowKey="lineId" size="small" dataSource={match.data || []} columns={matchCols} pagination={false} /> },
    { key: 'payments', label: `Payments (${related.data?.payments?.length || 0})`, children: <Table rowKey="id" size="small" dataSource={related.data?.payments || []} pagination={false} columns={[
      { title: 'Payment', dataIndex: 'paymentNo' }, { title: 'Date', dataIndex: 'paidAt', render: fmtDate }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v: any) => fmtMoney(v) }, { title: 'Status', dataIndex: 'status', render: (v) => <StatusTag value={v} /> },
    ]} /> },
  ];

  return (
    <Drawer open={!!id} onClose={onClose} width={960} destroyOnHidden title={d ? `Purchase Order ${d.poNo}` : 'Purchase Order'}
      extra={<Space>
        {OPEN_STATUSES.includes(d?.status) && (p.remainingToReceive > 0) && p.receivingRequired && <Button icon={<SwapOutlined />} onClick={() => onReceive(id!)}>Receive Items</Button>}
        {OPEN_STATUSES.includes(d?.status) && (p.remainingToBill > 0) && <Button type="primary" icon={<FileAddOutlined />} onClick={() => onBill(id!)}>Create Bill</Button>}
        <Button icon={<PrinterOutlined />} onClick={() => window.open(`/documents/purchase-order/${id}`, '_blank')}>Print</Button>
      </Space>}>
      {detail.isLoading ? <SectionLoading rows={6} /> : d ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <MiniStat label="Ordered" value={fmtNumber(p.ordered)} />
            <MiniStat label="Received" value={`${fmtNumber(p.received)}`} sub={`Remaining ${fmtNumber(p.remainingToReceive)}`} />
            <MiniStat label="Billed" value={`${fmtNumber(p.billed)}`} sub={`Remaining ${fmtNumber(p.remainingToBill)}`} />
            <MiniStat label="Status" value={<StatusTag value={d.status} />} />
          </div>
          <Tabs items={tabs} destroyOnHidden />
        </>
      ) : null}
    </Drawer>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return <div className="nex-card p-3"><div className="text-[11px] text-[#94a3b8] uppercase tracking-wide">{label}</div><div className="text-[14px] font-semibold text-[#171a2e] mt-0.5">{value}</div>{sub && <div className="text-[11px] text-[#94a3b8]">{sub}</div>}</div>;
}

function ReceiveDrawer({ id, onClose, onDone }: { id: string | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const recv = useQuery({ queryKey: ['/procurement/purchase-orders', id, 'receiving'], queryFn: () => api(`/procurement/purchase-orders/${id}/receiving`), enabled: !!id });

  async function submit() {
    try {
      const v = await form.validateFields();
      const lines = (recv.data?.lines || []).map((l: any, i: number) => ({ quantity: Number(v[`q_${i}`] ?? 0) }));
      if (!lines.some((l: any) => l.quantity > 0)) return message.error('Enter a quantity to receive');
      setBusy(true);
      await api(`/procurement/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({ warehouseId: v.warehouseId, reference: v.reference, date: v.date?.format('YYYY-MM-DD'), lines }) });
      message.success('Receipt confirmed — stock updated');
      onDone(); onClose();
    } catch (e: any) { if (!e?.errorFields) message.error(e.message); }
    finally { setBusy(false); }
  }

  const rows = recv.data?.lines || [];
  return (
    <Drawer open={!!id} onClose={onClose} width={720} destroyOnHidden title={`Receive Items — ${recv.data?.poNo || ''}`}
      extra={<Space><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={busy} onClick={submit}>Receive Items</Button></Space>}>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-3 gap-3">
          <Form.Item label="Warehouse" name="warehouseId" initialValue={recv.data?.warehouseId}><Select allowClear options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} /></Form.Item>
          <Form.Item label="Receipt Date" name="date"><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Reference" name="reference"><Input placeholder="Optional" /></Form.Item>
        </div>
        <Table rowKey="lineId" size="small" pagination={false} dataSource={rows} columns={[
          { title: 'Item', render: (_v, r: any) => r.description || '—' },
          { title: 'Ordered', dataIndex: 'ordered', align: 'right', render: (v: any) => fmtNumber(v) },
          { title: 'Previously Received', dataIndex: 'previouslyReceived', align: 'right', render: (v: any) => fmtNumber(v) },
          { title: 'Receive Now', width: 130, render: (_v, r: any, i: number) => r.stockTracked ? <Form.Item name={`q_${i}`} noStyle initialValue={Math.max(0, Number(r.remaining))}><InputNumber min={0} max={Number(r.remaining)} className="w-full" /></Form.Item> : <span className="text-[12px] text-[#94a3b8]">No stock</span> },
          { title: 'Remaining', dataIndex: 'remaining', align: 'right', render: (v: any) => fmtNumber(v) },
        ]} />
      </Form>
    </Drawer>
  );
}

function CreateBillDrawer({ id, onClose, onDone }: { id: string | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const prefill = useQuery({ queryKey: ['/procurement/purchase-orders', id, 'bill-lines'], queryFn: () => api(`/procurement/purchase-orders/${id}/bill-lines`), enabled: !!id });
  const d = prefill.data;
  const lines = Form.useWatch('lines', form) || [];
  const total = lines.reduce((s: number, l: any) => s + Number(l?.quantity || 0) * Number(l?.unitPrice || 0) * (1 + Number(l?.taxRate || 0) / 100), 0);

  async function submit() {
    try {
      const v = await form.validateFields();
      const ls = (v.lines || []).filter((l: any) => Number(l.quantity) > 0);
      if (!ls.length) return message.error('Enter a quantity to bill');
      setBusy(true);
      const created = await api('/procurement/supplier-invoices', { method: 'POST', body: JSON.stringify({ supplierId: d.supplierId, purchaseOrderId: id, invoiceNo: v.invoiceNo, invoiceDate: v.invoiceDate?.format('YYYY-MM-DD'), dueDate: v.dueDate?.format('YYYY-MM-DD'), currency: d.currency, lines: ls }) });
      try {
        await api(`/procurement/supplier-invoices/${created.id}/post`, { method: 'POST', body: JSON.stringify({ confirmMissingReceipt: true }) });
        message.success('Bill created and posted');
      } catch (postErr: any) {
        message.warning(`Bill ${created.invoiceNo} saved as draft: ${postErr.message}`);
      }
      onDone(); onClose();
    } catch (e: any) { if (!e?.errorFields) message.error(e.message); }
    finally { setBusy(false); }
  }

  const rows = (d?.lines || []).filter((l: any) => Number(l.remainingToBill) > 0);
  return (
    <Drawer open={!!id} onClose={onClose} width={780} destroyOnHidden title={`Create Bill — ${d?.poNo || ''}`}
      extra={<Space><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={busy} onClick={submit}>Create Bill</Button></Space>}>
      {prefill.isLoading ? <div className="text-[#94a3b8]">Preparing bill…</div> : (
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-3 gap-3">
            <Form.Item label="Vendor Invoice No" name="invoiceNo" rules={[{ required: true, message: 'Supplier invoice number' }]}><Input /></Form.Item>
            <Form.Item label="Bill Date" name="invoiceDate" initialValue={dayjs()}><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Due Date" name="dueDate"><DatePicker className="w-full" /></Form.Item>
          </div>
          {rows.length === 0 && <Alert type="info" showIcon message="Nothing remaining to bill on this purchase order." />}
          <Form.List name="lines" initialValue={rows.map((l: any) => ({ purchaseOrderLineId: l.purchaseOrderLineId, itemId: l.itemId, description: l.description, quantity: Number(l.remainingToBill), unitPrice: Number(l.unitPrice), taxRate: 0, unit: l.unit }))}>
            {(fields) => (
              <Table rowKey="key" size="small" pagination={false} dataSource={fields} columns={[
                { title: 'Item', render: (_v, f: any) => f.name != null ? <Form.Item name={[f.name, 'description']} noStyle><span>{form.getFieldValue(['lines', f.name, 'description'])}</span></Form.Item> : null },
                { title: 'Bill Now', width: 130, render: (_v, f: any) => <Form.Item name={[f.name, 'quantity']} noStyle><InputNumber min={0} className="w-full" /></Form.Item> },
                { title: 'Cost', width: 120, render: (_v, f: any) => <Form.Item name={[f.name, 'unitPrice']} noStyle><InputNumber min={0} className="w-full" prefix="$" /></Form.Item> },
                { title: 'Tax %', width: 100, render: (_v, f: any) => <Form.Item name={[f.name, 'taxRate']} noStyle><InputNumber min={0} className="w-full" /></Form.Item> },
                { title: 'PO Line', width: 90, render: (_v, f: any) => <span className="font-mono text-[11px] text-[#94a3b8]">{String(form.getFieldValue(['lines', f.name, 'purchaseOrderLineId']) || '').slice(0, 8)}</span> },
              ]} />
            )}
          </Form.List>
          <div className="flex justify-end mt-4 text-[13px]"><span className="text-[#64748b]">Bill Total <b className="text-[#003366]">{fmtMoney(total)}</b></span></div>
        </Form>
      )}
    </Drawer>
  );
}
