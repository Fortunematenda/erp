'use client';
import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Table, Popconfirm } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircleOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, DeleteOutlined, FileDoneOutlined, TruckOutlined, StopOutlined, EyeOutlined, ShoppingCartOutlined, DollarOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtMoney } from '@/lib/format';
import { CustomerAvatar, EmptyState, FilterBar, StatusPill, SummaryCard } from '@/components/sales-ui';
import { SalesDocumentFlow } from '@/components/sales/related-transactions';
import { DocumentTrail } from '@/components/documents/document-trail';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const STATUSES = ['DRAFT', 'PICKED', 'READY_TO_DISPATCH', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

export function DeliveriesWorkspace() {
  const qc = useQueryClient();
  const meta = useMeta();
  const sp = useSearchParams();
  const { message } = App.useApp();
  const list = useQuery({ queryKey: ['/sales/deliveries'], queryFn: () => api('/sales/deliveries') });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [customer, setCustomer] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<any | null>(null);
  useEffect(() => { if (sp.get('orderId')) setCreateOpen(true); }, [sp]);

  async function doApi(url: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST', body?: any) {
    try {
      await api(url, { method, body: body ? JSON.stringify(body) : undefined });
      message.success('Done');
      qc.invalidateQueries({ queryKey: ['/sales/deliveries'] });
      qc.invalidateQueries({ queryKey: ['/sales/sales-orders'] });
    } catch (e: any) { message.error(e.message); }
  }

  const rows = useMemo(() => {
    const base = Array.isArray(list.data) ? list.data : [];
    let r = base;
    if (q) r = r.filter((d: any) => `${d.deliveryNo} ${d.customer?.name || ''} ${d.orderNo || ''} ${d.invoiceNo || ''} ${d.driver || ''} ${d.vehicle || ''} ${d.trackingNo || ''} ${d.reference || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (status) r = r.filter((d: any) => d.status === status);
    if (customer) r = r.filter((d: any) => d.customerId === customer);
    if (warehouse) r = r.filter((d: any) => d.warehouseId === warehouse);
    return r;
  }, [list.data, q, status, customer, warehouse]);

  const kpis = useMemo(() => {
    const base = Array.isArray(list.data) ? list.data : [];
    const open = base.filter((d: any) => !['DELIVERED', 'CANCELLED'].includes(d.status));
    const ready = base.filter((d: any) => ['READY_TO_DISPATCH', 'PICKED', 'DRAFT'].includes(d.status));
    const today = base.filter((d: any) => d.status === 'DISPATCHED' && dayjs(d.date).isSame(dayjs(), 'day'));
    const value = base.filter((d: any) => ['DISPATCHED', 'DELIVERED'].includes(d.status)).reduce((s: number, d: any) => s + (d.lines || []).reduce((x: number, l: any) => x + Number(l.unitPrice || 0) * Number(l.quantity), 0), 0);
    return { open: open.length, ready: ready.length, today: today.length, value };
  }, [list.data]);

  const columns: ColumnsType<any> = [
    { title: 'Delivery #', dataIndex: 'deliveryNo', width: 130, render: (v, r) => <a className="font-mono text-[12px] font-semibold text-[#003366] hover:underline" onClick={() => setView(r)}>{v}</a> },
    { title: 'Customer', dataIndex: 'customer', render: (_v, r) => (<span className="flex items-center gap-2.5"><CustomerAvatar name={r.customer?.name} size={28} /><span className="text-[13px] text-[#171a2e]">{r.customer?.name || '—'}</span></span>) },
    { title: 'Sales Order', dataIndex: 'orderNo', width: 120, render: (v, r) => v ? <Link href={`/sales/orders/${r.salesOrderId}/edit`} className="font-mono text-[12px] text-[#003366] hover:underline">{v}</Link> : '—' },
    { title: 'Invoice', dataIndex: 'invoiceNo', width: 120, render: (v, r) => v ? <Link href={`/sales/invoices/${r.invoiceId}/edit`} className="font-mono text-[12px] text-[#003366] hover:underline">{v}</Link> : '—' },
    { title: 'Date', dataIndex: 'date', width: 110, render: (v) => <span className="text-[13px] text-[#64748b]">{dayjs(v).format('DD MMM YY')}</span> },
    { title: 'Lines', dataIndex: 'lines', width: 60, align: 'center', render: (_v, r) => <span className="text-[13px] text-[#64748b]">{r.lines?.length || 0}</span> },
    { title: 'Qty', dataIndex: 'totalQty', width: 70, align: 'right', render: (v) => <span className="text-[13px] font-medium">{v ?? 0}</span> },
    { title: 'Status', dataIndex: 'status', width: 140, render: (v) => <StatusPill status={String(v || '').replace(/_/g, ' ')} /> },
    { ...ACTIONS_COL, render: (_v, r) => <DeliveryActions r={r} onAction={doApi} onView={() => setView(r)} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Deliveries</h1><p className="text-[13px] text-[#64748b] mt-1">Dispatch customer orders, issue stock and track fulfilment</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>New Delivery</Button>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        <SummaryCard icon={<ShoppingCartOutlined />} label="Open Deliveries" value={kpis.open} tone="#003366" />
        <SummaryCard icon={<TruckOutlined />} label="Ready to Dispatch" value={kpis.ready} tone="#0ea5e9" />
        <SummaryCard icon={<ClockCircleOutlined />} label="Dispatched Today" value={kpis.today} tone="#8b5cf6" />
        <SummaryCard icon={<DollarOutlined />} label="Delivered Value" value={fmtMoney(kpis.value)} tone="#10b981" />
      </div>
      <FilterBar extra={<span className="text-[12px] text-[#94a3b8]">{rows.length} deliveries</span>}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search deliveries..." className="w-[420px] max-w-full !rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="Status" className="!min-w-[140px] !rounded-xl" value={status || undefined} onChange={setStatus} options={STATUSES.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Customer" className="!min-w-[170px] !rounded-xl" value={customer || undefined} onChange={setCustomer} options={(meta.data?.customers || []).map((c: any) => ({ label: c.name, value: c.id }))} />
        <Select allowClear placeholder="Warehouse" className="!min-w-[150px] !rounded-xl" value={warehouse || undefined} onChange={setWarehouse} options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} />
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/sales/deliveries'] })} />
      </FilterBar>
      <div className="nex-card">
        {rows.length === 0 ? <EmptyState title="No deliveries found" description="Create a delivery to dispatch stock and track fulfilment." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>New Delivery</Button>} /> : <Table rowKey="id" loading={list.isLoading} dataSource={rows} columns={columns} scroll={{ x: true }} pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} deliveries` }} />}
      </div>
      <CreateDeliveryDrawer open={createOpen} initialOrderId={sp.get('orderId') || undefined} onClose={() => setCreateOpen(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['/sales/deliveries'] }); setCreateOpen(false); }} />
      <DeliveryViewDrawer delivery={view} onClose={() => setView(null)} onAction={doApi} onRefresh={() => { qc.invalidateQueries({ queryKey: ['/sales/deliveries'] }); qc.invalidateQueries({ queryKey: ['/sales/sales-orders'] }); }} />
    </div>
  );
}

function DeliveryActions({ r, onAction, onView }: { r: any; onAction: (url: string, method?: 'POST' | 'PATCH' | 'DELETE', body?: any) => Promise<void>; onView: () => void }) {
  const base = `/sales/deliveries/${r.id}`;
  const isDraft = r.status === 'DRAFT';
  const canPick = isDraft;
  const canDispatch = ['DRAFT', 'PICKED', 'READY_TO_DISPATCH'].includes(r.status);
  const canDeliver = ['DISPATCHED', 'READY_TO_DISPATCH'].includes(r.status);
  const canInvoice = ['DISPATCHED', 'DELIVERED'].includes(r.status) && !r.invoiceId;
  const canCancel = !['DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(r.status);
  return (
    <RowActionsMenu items={[
      { key: 'view', icon: <EyeOutlined />, label: 'View / Edit', onClick: onView },
      { key: 'pick', icon: <TruckOutlined />, label: 'Mark Picked', disabled: !canPick, disabledReason: 'Only draft deliveries can be picked', onClick: () => onAction(`${base}/pick`) },
      { key: 'ready', icon: <CheckCircleOutlined />, label: 'Mark Ready', disabled: r.status === 'READY_TO_DISPATCH' || !['DRAFT', 'PICKED'].includes(r.status), disabledReason: 'Delivery is not ready to mark as ready', onClick: () => onAction(`${base}/ready`) },
      { key: 'dispatch', icon: <TruckOutlined />, label: 'Dispatch (issue stock)', disabled: !canDispatch, disabledReason: 'Delivery cannot be dispatched in its current status', onClick: () => onAction(`${base}/dispatch`) },
      { key: 'deliver', icon: <CheckCircleOutlined />, label: 'Mark Delivered', disabled: !canDeliver, disabledReason: 'Dispatch the delivery first', onClick: () => onAction(`${base}/deliver`) },
      { key: 'invoice', icon: <FileDoneOutlined />, label: 'Create Invoice', disabled: !canInvoice, disabledReason: r.invoiceId ? 'Invoice already exists' : 'Deliver or dispatch first', onClick: () => onAction(`${base}/invoice`) },
      { key: 'cancel', icon: <StopOutlined />, danger: true, label: 'Cancel Delivery', disabled: !canCancel, disabledReason: 'This delivery cannot be cancelled', confirm: 'Cancel this delivery?', onClick: () => onAction(`${base}/cancel`) },
      { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Delete', disabled: !isDraft, disabledReason: 'Only draft deliveries can be deleted', confirm: 'Delete this delivery?', onClick: () => onAction(base, 'DELETE') },
    ]} />
  );
}

function CreateDeliveryDrawer({ open, initialOrderId, onClose, onCreated }: { open: boolean; initialOrderId?: string; onClose: () => void; onCreated: () => void }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const orders = useQuery({ queryKey: ['/sales/sales-orders'], queryFn: () => api('/sales/sales-orders'), enabled: open });
  const [orderId, setOrderId] = useState(initialOrderId || '');
  const [lines, setLines] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const order = useMemo(() => (Array.isArray(orders.data) ? orders.data : []).find((o: any) => o.id === orderId), [orders.data, orderId]);
  const eligible = useMemo(() => (Array.isArray(orders.data) ? orders.data : []).filter((o: any) => ['OPEN', 'CONFIRMED'].includes(o.status) && o.fulfilmentStatus !== 'FULFILLED'), [orders.data]);
  useEffect(() => { if (open && initialOrderId && orders.data && orderId && lines.length === 0 && !order) { selectOrder(initialOrderId); } }, [open, initialOrderId, orders.data]);

  function selectOrder(id: string) {
    setOrderId(id);
    const o = (Array.isArray(orders.data) ? orders.data : []).find((x: any) => x.id === id);
    if (o) {
      form.setFieldsValue({ customerId: o.customerId, shippingAddress: o.shippingAddress || (o.customer?.name ? 'addr' : ''), warehouseId: o.warehouseId || meta.data?.warehouses?.[0]?.id });
      setLines((o.lines || []).map((l: any) => ({ salesOrderLineId: l.id, itemId: l.itemId, description: l.description, ordered: Number(l.quantity), delivered: Number(l.deliveredQty || 0), remaining: Math.max(0, Number(l.quantity) - Number(l.deliveredQty || 0)), deliver: Math.max(0, Number(l.quantity) - Number(l.deliveredQty || 0)) })));
    } else setLines([]);
  }

  async function save() {
    try {
      setSaving(true);
      const v = await form.validateFields();
      const payload = { salesOrderId: orderId, warehouseId: v.warehouseId, date: v.date?.format('YYYY-MM-DD') || dayjs().format('YYYY-MM-DD'), shippingAddress: v.shippingAddress, driver: v.driver, vehicle: v.vehicle, trackingNo: v.trackingNo, carrier: v.carrier, reference: v.reference, notes: v.notes, lines: lines.filter((l) => l.deliver > 0).map((l) => ({ salesOrderLineId: l.salesOrderLineId, quantity: Number(l.deliver) })) };
      await api('/sales/deliveries', { method: 'POST', body: JSON.stringify(payload) });
      message.success('Delivery created');
      onCreated();
      qc.invalidateQueries({ queryKey: ['/sales/sales-orders'] });
    } catch (e: any) { message.error(e.message || 'Could not create delivery'); }
    finally { setSaving(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} width={900} title="Create Delivery" footer={<div className="flex items-center justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={save} loading={saving}>Save Delivery</Button></div>}>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Form.Item label="Sales Order" name="salesOrderId" className="!mb-3" rules={[{ required: true, message: 'Select a sales order' }]}><Select showSearch optionFilterProp="label" placeholder="Select sales order" onChange={selectOrder} options={eligible.map((o: any) => ({ label: `${o.orderNo} · ${o.customer?.name || ''}`, value: o.id }))} /></Form.Item>
          <Form.Item label="Customer" name="customerId" className="!mb-3"><Input disabled /></Form.Item>
          <Form.Item label="Delivery Date" name="date" className="!mb-3" initialValue={dayjs()}><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Warehouse" name="warehouseId" className="!mb-3" rules={[{ required: true, message: 'Select a warehouse' }]}><Select showSearch optionFilterProp="label" placeholder="Warehouse" options={(meta.data?.warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))} /></Form.Item>
          <Form.Item label="Shipping Address" name="shippingAddress" className="!mb-3 md:col-span-2"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item label="Driver" name="driver" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Vehicle" name="vehicle" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Tracking / Waybill #" name="trackingNo" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Carrier" name="carrier" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Reference" name="reference" className="!mb-3"><Input /></Form.Item>
          <Form.Item label="Notes" name="notes" className="!mb-3 md:col-span-2"><Input.TextArea rows={2} /></Form.Item>
        </div>
        {order && (
          <div className="mt-2">
            <div className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wide mb-2">Line Items</div>
            <div className="grid grid-cols-[1.4fr_0.6fr_0.7fr_0.7fr_0.7fr] gap-3 px-3 py-2 text-[12px] font-semibold text-[#64748b] uppercase tracking-wide"><span>Product</span><span>Ordered</span><span>Delivered</span><span>Remaining</span><span>Deliver Now</span></div>
            {lines.map((l: any, i: number) => (
              <div key={l.salesOrderLineId} className="grid grid-cols-[1.4fr_0.6fr_0.7fr_0.7fr_0.7fr] gap-3 items-center py-2 border-t border-[#f0f1f6]">
                <div className="text-[13px] text-[#171a2e] truncate">{l.description}</div>
                <div className="text-[13px] text-[#64748b]">{l.ordered}</div>
                <div className="text-[13px] text-[#64748b]">{l.delivered}</div>
                <div className="text-[13px] text-[#64748b]">{l.remaining}</div>
                <InputNumber className="w-full" min={0} max={l.remaining} value={l.deliver} onChange={(v) => setLines((p) => p.map((x, j) => j === i ? { ...x, deliver: Math.min(Number(v || 0), x.remaining) } : x))} />
              </div>
            ))}
          </div>
        )}
      </Form>
    </Drawer>
  );
}

function DeliveryViewDrawer({ delivery, onClose, onAction, onRefresh }: { delivery: any; onClose: () => void; onAction: (url: string, method?: 'POST' | 'PATCH' | 'DELETE', body?: any) => Promise<void>; onRefresh: () => void }) {
  const id = delivery?.id;
  const detail = useQuery({ queryKey: ['/sales/deliveries', id], queryFn: () => api(`/sales/deliveries/${id}`), enabled: !!id });
  const d = detail.data || delivery;
  const base = `/sales/deliveries/${id}`;
  const canDispatch = id && ['DRAFT', 'PICKED', 'READY_TO_DISPATCH'].includes(d.status);
  const canDeliver = id && ['DISPATCHED', 'READY_TO_DISPATCH'].includes(d.status);
  const canInvoice = id && ['DISPATCHED', 'DELIVERED'].includes(d.status) && !d.invoiceId;
  const canCancel = id && !['DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(d.status);
  return (
    <Drawer open={!!delivery} onClose={onClose} width={760} title={d?.deliveryNo ? `Delivery ${d.deliveryNo}` : 'Delivery'}>
      {id && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <StatusPill status={String(d.status || '').replace(/_/g, ' ')} />
          {d.customer?.name && <span className="text-[13px] text-[#64748b]">{d.customer.name}</span>}
          <span className="ml-auto flex gap-2">
            {canDispatch && <Button size="small" type="primary" icon={<TruckOutlined />} onClick={() => { onAction(`${base}/dispatch`); onRefresh(); }}>Dispatch</Button>}
            {canDeliver && <Button size="small" icon={<CheckCircleOutlined />} onClick={() => { onAction(`${base}/deliver`); onRefresh(); }}>Mark Delivered</Button>}
            {canInvoice && <Popconfirm title="Create Invoice from this delivery?" onConfirm={() => { onAction(`${base}/invoice`); onRefresh(); }}><Button size="small" type="primary" icon={<FileDoneOutlined />}>Create Invoice</Button></Popconfirm>}
            {canCancel && <Popconfirm title="Cancel this delivery?" onConfirm={() => { onAction(`${base}/cancel`); onRefresh(); }}><Button size="small" danger icon={<StopOutlined />}>Cancel</Button></Popconfirm>}
          </span>
        </div>
      )}
      {d && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] mb-4">
          {[['Sales Order', d.orderNo || d.salesOrder?.orderNo], ['Invoice', d.invoiceNo || d.invoice?.invoiceNo], ['Warehouse', d.warehouseId ? 'Warehouse' : '—'], ['Driver', d.driver], ['Vehicle', d.vehicle], ['Tracking #', d.trackingNo], ['Shipping Address', d.shippingAddress]].map(([l, v]) => <div key={String(l)}><div className="text-[11px] text-[#94a3b8]">{l}</div><div className="text-[13px] text-[#171a2e]">{v || '—'}</div></div>)}
        </div>
      )}
      {id && <SalesDocumentFlow kind="invoice" record={{ id, invoiceNo: d.invoice?.invoiceNo, invoiceStatus: d.status, sourceSalesOrder: d.salesOrder?.id ? { id: d.salesOrder.id, orderNo: d.salesOrder.orderNo } : null }} />}
      {id && <DocumentTrail type="delivery" id={id} />}
    </Drawer>
  );
}
