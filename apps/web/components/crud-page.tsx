'use client';
import { useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page';
import { useMeta } from '@/lib/meta';
import { StatCard } from '@/components/stat-card';
import dayjs from 'dayjs';

export type FieldDef = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'select' | 'date' | 'textarea' | 'json';
  options?: { label: string; value: any }[];
  metaKey?: keyof import('@/lib/meta').Meta;
  metaLabel?: string;
  selectPath?: string;
  selectLabel?: (r: any) => string;
  required?: boolean;
  span?: number;
  defaultValue?: any;
  placeholder?: string;
  disabled?: boolean;
};

export type RowAction = {
  key: string;
  label: string;
  type?: 'default' | 'primary' | 'danger' | 'link';
  icon?: React.ReactNode;
  show?: (record: any) => boolean;
  confirm?: string;
  method?: 'POST' | 'PATCH' | 'DELETE';
  url?: (record: any) => string;
  body?: (record: any) => any;
  extraInvalidate?: string[];
  onDone?: (res: any, record: any) => void;
};

export type Kpi = { label: string; value: React.ReactNode; icon?: React.ReactNode; color?: string; hint?: string };

export type CrudPageProps = {
  title: string;
  subtitle?: string;
  path: string;
  columns: ColumnsType<any>;
  fields?: FieldDef[];
  createPayload?: (values: any, ctx: any) => any;
  editPayload?: (values: any, record: any) => any;
  editValues?: (record: any) => any;
  rowActions?: RowAction[];
  search?: (record: any, q: string) => boolean;
  idKey?: string;
  hideCreate?: boolean;
  hideEdit?: boolean;
  canDelete?: boolean;
  deleteUrl?: (record: any) => string;
  noPagination?: boolean;
  extra?: React.ReactNode;
  createLabel?: string;
  createSubmitLabel?: string;
  editSubmitLabel?: string;
  statusTag?: (record: any) => { text: string; color: string };
  emptyText?: React.ReactNode;
  sources?: string[];
  kpis?: Kpi[];
  statusFilter?: string;
  statusOptions?: { label: string; value: any }[];
  dateField?: string;
  footer?: React.ReactNode;
  selectable?: boolean;
  bulkActions?: { label: string; type?: 'default' | 'primary' | 'danger'; icon?: React.ReactNode; confirm?: string; run: (ids: string[]) => Promise<void> }[];
  useDrawer?: boolean;
  documentType?: string;
};

const rowKeyFields: Record<string, string> = {};

export function CrudPage(props: CrudPageProps) {
  const {
    title, subtitle, path, columns, fields = [], createPayload, editPayload, editValues,
    rowActions = [], search, idKey = 'id', hideCreate, hideEdit, canDelete, deleteUrl,
    noPagination, extra, createLabel = 'New', statusTag, documentType,
    createSubmitLabel = 'Save', editSubmitLabel = 'Save',
  } = props;
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [statusValue, setStatusValue] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<any>(undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [form] = Form.useForm();

  const list = useQuery({ queryKey: [path], queryFn: () => api(path) });

  const sources = props.sources || [];
  const sourceResults = useQueries({ queries: sources.map((s) => ({ queryKey: [s], queryFn: () => api(s) })) });
  const listCache: Record<string, any[]> = {};
  sources.forEach((s, i) => { listCache[s] = sourceResults[i].data || []; });

  const data = useMemo(() => {
    let rows = list.data || [];
    if (q) {
      const fn = search || ((r: any) => Object.values(r).some((v: any) => String(v ?? '').toLowerCase().includes(q.toLowerCase())));
      rows = rows.filter((r: any) => fn(r, q));
    }
    if (statusValue && props.statusFilter) rows = rows.filter((r: any) => r[props.statusFilter as string] === statusValue);
    if (dateRange && props.dateField) {
      const [s, e] = dateRange;
      rows = rows.filter((r: any) => {
        const d = dayjs(r[props.dateField as string]);
        if (!d.isValid()) return true;
        return !d.isBefore(s, 'day') && !d.isAfter(e, 'day');
      });
    }
    return rows;
  }, [list.data, q, search, statusValue, dateRange, props.statusFilter, props.dateField]);

  function invalidate(extraKeys: string[] = []) {
    qc.invalidateQueries({ queryKey: [path] });
    (extraKeys || []).forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }

  // Seed only after the overlay has opened and <Form form={form}> is mounted.
  // destroyOnHidden + resetFields-before-open caused Ant Design's disconnected useForm warning.
  function openCreate() { setEditing(null); setOpen(true); }
  function openEdit(record: any) { setEditing(record); setOpen(true); }

  function formSafeValue(f: FieldDef, raw: any) {
    if (raw === undefined || raw === null) return undefined;
    if (f.type === 'date') {
      const d = dayjs(raw);
      return d.isValid() ? d : undefined;
    }
    // Never put nested API records into the form store — Ant Design cloneDeep warns on cycles.
    if (typeof raw === 'object') return undefined;
    return raw;
  }

  function seedForm() {
    form.resetFields();
    const patch: { name: string; value: any }[] = [];
    if (editing) {
      const fromEdit = editValues ? editValues(editing) : {};
      fields.forEach((f) => {
        const raw = fromEdit[f.name] !== undefined ? fromEdit[f.name] : editing[f.name];
        const value = formSafeValue(f, raw);
        if (value !== undefined) patch.push({ name: f.name, value });
      });
    } else {
      fields.forEach((f) => {
        if (f.defaultValue === undefined) return;
        const value = formSafeValue(f, f.defaultValue);
        if (value !== undefined) patch.push({ name: f.name, value });
      });
    }
    if (patch.length) form.setFields(patch);
  }

  async function submit() {
    if (!fields.length) {
      setOpen(false);
      return;
    }
    const values = await form.validateFields();
    const clean: any = {};
    Object.entries(values).forEach(([k, v]) => {
      const anyV = v as any;
      clean[k] = anyV && typeof anyV.format === 'function' ? anyV.format('YYYY-MM-DD') : v;
    });
    try {
      setSaving(true);
      if (editing) {
        const payload = editPayload ? editPayload(clean, editing) : clean;
        await api(`${path}/${editing[idKey]}`, { method: 'PATCH', body: JSON.stringify(payload) });
        message.success('Updated');
      } else {
        const payload = createPayload ? createPayload(clean, { meta: meta.data }) : clean;
        await api(path, { method: 'POST', body: JSON.stringify(payload) });
        message.success('Created');
      }
      setOpen(false);
      invalidate();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function renderField(f: FieldDef) {
    const shared = { placeholder: f.placeholder, disabled: f.disabled };
    if (f.type === 'number' || f.type === 'money') {
      return <InputNumber className="w-full" prefix={f.type === 'money' ? '$' : undefined} {...shared} />;
    }
    if (f.type === 'select') {
      let options = f.options || [];
      if (f.metaKey) options = (meta.data?.[f.metaKey] || []).map((r: any) => ({ label: String(r[f.metaLabel || 'name'] ?? r.id), value: r.id }));
      if (f.selectPath) {
        const res = listCache[f.selectPath];
        options = (res || []).map((r: any) => ({ label: f.selectLabel ? f.selectLabel(r) : String(r.name ?? r.id), value: r.id }));
      }
      // Plain {label,value} only — extra keys on options can trigger form cloneDeep circular warnings.
      const safeOptions = options.map((o) => ({ label: o.label, value: o.value }));
      return <Select allowClear showSearch optionFilterProp="label" options={safeOptions} {...shared} />;
    }
    if (f.type === 'date') return <DatePicker className="w-full" style={{ width: '100%' }} {...shared} />;
    if (f.type === 'textarea') return <Input.TextArea rows={3} {...shared} />;
    if (f.type === 'json') return <Input.TextArea rows={3} placeholder={f.placeholder || '{"key": value}'} disabled={f.disabled} />;
    return <Input {...shared} />;
  }

  const canEdit = !hideEdit && fields.length > 0;

  const columnsWithActions = useMemo(() => {
    const cols = [...columns];
    if (rowActions.length || canDelete || canEdit || documentType) {
      cols.push({
        ...ACTIONS_COL,
        render: (_: any, record: any) => (
          <RowActionsMenu items={[
            ...rowActions.filter((a) => !a.show || a.show(record)).map((a) => ({
              key: a.key,
              label: a.label,
              icon: a.icon,
              danger: a.type === 'danger',
              confirm: a.confirm,
              onClick: async () => {
                try {
                  const res = await api((a.url ? a.url(record) : `${path}/${record[idKey]}`), {
                    method: a.method || 'POST',
                    body: a.body ? JSON.stringify(a.body(record)) : (a.method === 'POST' || !a.method ? '{}' : undefined),
                  });
                  if (a.onDone) a.onDone(res, record);
                  message.success(`${a.label} done`);
                  invalidate(a.extraInvalidate);
                } catch (e: any) {
                  message.error(e.message);
                }
              },
            })),
            ...(documentType ? [{ key: 'print', label: 'Print / PDF', icon: <PrinterOutlined />, onClick: () => window.open(`/documents/${documentType}/${record[idKey]}`, '_blank') }] : []),
            ...(canEdit ? [{ key: 'edit', label: 'Edit', icon: <EditOutlined />, onClick: () => openEdit(record) }] : []),
            ...(canDelete ? [{ key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true as const, confirm: 'Delete this record?', onClick: async () => {
              try { await api((deleteUrl ? deleteUrl(record) : `${path}/${record[idKey]}`), { method: 'DELETE' }); message.success('Deleted'); invalidate(); }
              catch (e: any) { message.error(e.message); }
            } }] : []),
          ]} />
        ),
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, rowActions, canDelete, canEdit, path, editing]);

  const statusOptions = props.statusOptions || (props.statusFilter
    ? [...new Set((list.data || []).map((r: any) => r[props.statusFilter as string]).filter(Boolean))].map((s) => ({ label: String(s).replace(/_/g, ' '), value: s }))
    : []);

  return (
    <>
      {props.kpis && props.kpis.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {props.kpis.map((k, i) => (
            <StatCard key={i} icon={k.icon} label={k.label} value={k.value} hint={k.hint} color={k.color} />
          ))}
        </div>
      )}
      <PageHeader
        title={title}
        subtitle={subtitle}
        extra={
          <Space>
            <Tooltip title="Refresh">
              <Button icon={<ReloadOutlined />} onClick={() => invalidate()} />
            </Tooltip>
            {!hideCreate && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{createLabel}</Button>
            )}
            {extra}
          </Space>
        }
      />
      {list.error && <Alert type="error" className="mb-4" message={(list.error as Error).message} />}
      {(q || props.statusFilter || props.dateField) && (
        <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search…"
            className="w-60 !rounded-xl"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {props.statusFilter && (
            <Select
              allowClear
              placeholder="Filter status"
              className="!min-w-[150px]"
              value={statusValue}
              onChange={setStatusValue}
              options={statusOptions}
            />
          )}
          {props.dateField && (
            <DatePicker.RangePicker className="!rounded-xl" value={dateRange} onChange={setDateRange} />
          )}
          <span className="ml-auto text-[12px] text-[#8a90ad]">{data.length} of {list.data?.length || 0} records</span>
        </div>
      )}
      {props.selectable && selected.length > 0 && (
        <div className="nex-card mb-4 px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[13px] font-medium text-[#344054]">{selected.length} selected</span>
          {canDelete && (
            <Popconfirm title={`Delete ${selected.length} selected?`} onConfirm={async () => {
              setBulkBusy(true);
              try { for (const id of selected) await api((deleteUrl ? deleteUrl({ id }) : `${path}/${id}`), { method: 'DELETE' }); message.success(`Deleted ${selected.length}`); invalidate(); setSelected([]); }
              catch (e: any) { message.error(e.message); }
              finally { setBulkBusy(false); }
            }}>
              <Button danger icon={<DeleteOutlined />} loading={bulkBusy}>Delete</Button>
            </Popconfirm>
          )}
          {(props.bulkActions || []).map((a) => (
            a.confirm
              ? <Popconfirm key={a.label} title={a.confirm} onConfirm={() => a.run(selected)}><Button type={a.type === 'danger' ? 'primary' : a.type} danger={a.type === 'danger'} icon={a.icon} loading={bulkBusy}>{a.label}</Button></Popconfirm>
              : <Button key={a.label} type={a.type === 'danger' ? 'primary' : a.type} danger={a.type === 'danger'} icon={a.icon} loading={bulkBusy} onClick={() => a.run(selected)}>{a.label}</Button>
          ))}
          <div className="ml-auto"><Button size="small" onClick={() => setSelected([])}>Clear</Button></div>
        </div>
      )}
      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <Table
          loading={list.isLoading}
          rowKey={idKey}
          dataSource={data}
          columns={columnsWithActions}
          scroll={{ x: true }}
          rowSelection={props.selectable ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) } : undefined}
          footer={props.footer ? () => props.footer : undefined}
          pagination={noPagination ? false : { pageSize: 10, showSizeChanger: false, showTotal: (t: number) => `${t} records` }}
        />
      </Card>
      {!props.useDrawer && fields.length > 0 && (
        <Modal
          title={editing ? `Edit ${title}` : `New ${createLabel}`}
          open={open}
          onCancel={() => setOpen(false)}
          onOk={submit}
          confirmLoading={saving}
          width={720}
          forceRender
          afterOpenChange={(visible) => { if (visible) seedForm(); }}
        >
          <Form form={form} layout="vertical">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              {fields.map((f) => (
                <Form.Item
                  key={f.name}
                  label={f.label}
                  name={f.name}
                  className={f.span === 2 ? 'md:col-span-2' : ''}
                  rules={f.required ? [{ required: true, message: `${f.label} is required` }] : []}
                >
                  {renderField(f)}
                </Form.Item>
              ))}
            </div>
          </Form>
        </Modal>
      )}
      {props.useDrawer && fields.length > 0 && (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          title={editing ? `Edit ${title}` : `New ${createLabel}`}
          width={700}
          forceRender
          afterOpenChange={(visible) => { if (visible) seedForm(); }}
          footer={<div className="flex items-center justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="primary" onClick={submit} loading={saving}>{editing ? editSubmitLabel : createSubmitLabel}</Button></div>}
        >
          <Form form={form} layout="vertical">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              {fields.map((f) => (
                <Form.Item
                  key={f.name}
                  label={f.label}
                  name={f.name}
                  className={f.span === 2 ? 'md:col-span-2' : ''}
                  rules={f.required ? [{ required: true, message: `${f.label} is required` }] : []}
                >
                  {renderField(f)}
                </Form.Item>
              ))}
            </div>
          </Form>
        </Drawer>
      )}
    </>
  );
}

export function statusTone(value: string): string {
  const v = (value || '').toUpperCase().replace(/_/g, ' ');
  if (v === 'DRAFT') return 'grey';
  if (/(PENDING|PROPOSAL|QUALIFIED|OPEN|UNPAID|AWAITING PAYMENT|PART.?PAID|PARTIAL|OUTSTANDING|PROCESSING|IN.?PROGRESS|SCHEDULED|SUBMITTED|ISSUED)/.test(v)) return 'amber';
  if (/(COMPLETED|POSTED|PAID|CLEARED|APPROVED|CONFIRMED|FISCALISED|RECEIVED|VERIFIED|BALANCED|CONNECTED|REFUNDED|CREDITED|ENABLED|WON|LIVE|MOCK|DELIVERED|READY|ACTIVE)/.test(v)) return 'green';
  if (/(CANCELLED|CANCELED|REJECTED|FAILED|ERROR|VOID|OVERDUE|DISABLED|INACTIVE|LOST|EXPIRED|DISPOSED)/.test(v)) return 'red';
  if (/(LOCKED|RETIRED|ARCHIVED|FROZEN)/.test(v)) return 'purple';
  return 'blue';
}

export function SoftBadge({ tone, children, dotless }: { tone: string; children: React.ReactNode; dotless?: boolean }) {
  return <span className={`nex-badge nex-badge-${tone} ${dotless ? 'nex-badge-dotless' : ''}`}>{children}</span>;
}

export function StatusTag({ value, colorMap }: { value: string; colorMap?: Record<string, string> }) {
  const map: Record<string, string> = { POSTED: 'green', PAID: 'green', COMPLETED: 'green', ACTIVE: 'green', APPROVED: 'green', CONFIRMED: 'blue', DRAFT: 'grey', OPEN: 'amber', PENDING: 'amber', LOCKED: 'purple', UNPAID: 'amber', PART_PAID: 'amber', DISPOSED: 'red', REJECTED: 'red', INACTIVE: 'grey', CLOSED: 'grey', ...(colorMap || {}) };
  const tone = map[value] || statusTone(value);
  return <SoftBadge tone={tone}>{value?.replace(/_/g, ' ')}</SoftBadge>;
}
