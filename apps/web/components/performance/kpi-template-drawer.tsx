'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tabs, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { fmtDate } from '@/lib/format';

export const MEASUREMENT_TYPES = [
  { value: 'NUMBER', label: 'Number' },
  { value: 'PERCENTAGE', label: 'Percentage' },
  { value: 'CURRENCY', label: 'Currency' },
  { value: 'COUNT', label: 'Count' },
  { value: 'DAYS', label: 'Days' },
  { value: 'HOURS', label: 'Hours' },
  { value: 'RATING_SCALE', label: 'Rating Scale' },
  { value: 'YES_NO', label: 'Yes / No' },
  { value: 'MANUAL_SCORE', label: 'Manual Score (%)' },
  { value: 'SYSTEM_METRIC', label: 'System Metric' },
];

export const KPI_DIRECTIONS = [
  { value: 'HIGHER_IS_BETTER', label: 'Higher is Better' },
  { value: 'LOWER_IS_BETTER', label: 'Lower is Better' },
  { value: 'TARGET_RANGE', label: 'Target Range' },
  { value: 'PASS_FAIL', label: 'Pass / Fail' },
];

const UNIT_BY_TYPE: Record<string, string> = { PERCENTAGE: '%', CURRENCY: '$', DAYS: 'days', HOURS: 'hours', RATING_SCALE: 'of 5' };

// ---------- Template Drawer (create / edit) ----------
export function KpiTemplateDrawer({ open, onClose, editing, defaultDepartmentId }: { open: boolean; onClose: () => void; editing?: any; defaultDepartmentId?: string }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [lines, setLines] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const cats = useQuery({ queryKey: ['/performance/kpi-categories'], queryFn: () => api('/performance/kpi-categories'), enabled: open });
  const sources = useMemo(() => [
    { value: 'SALES_POSTED', label: 'Sales → Posted Sales' },
    { value: 'SALES_COLLECTED', label: 'Sales → Collected Revenue' },
    { value: 'SALES_NEW_CUSTOMERS', label: 'Sales → New Customers' },
    { value: 'CRM_WON_OPPORTUNITIES', label: 'CRM → Won Opportunities' },
    { value: 'CRM_WON_VALUE', label: 'CRM → Won Opportunity Value' },
    { value: 'ATTENDANCE_PCT', label: 'Attendance → Attendance %' },
    { value: 'ATTENDANCE_LATE', label: 'Attendance → Late Arrivals' },
    { value: 'ATTENDANCE_ABSENCE', label: 'Attendance → Absence Days' },
    { value: 'ATTENDANCE_OVERTIME', label: 'Attendance → Approved Overtime' },
    { value: 'QA_AVERAGE_SCORE', label: 'QA → Average QA Score' },
    { value: 'QA_FAILED_REVIEWS', label: 'QA → Failed QA Reviews' },
  ], []);
  const SOURCE_TOOLTIPS: Record<string, string> = {
    SALES_POSTED: 'Automatically totals posted sales invoice amounts assigned to this employee (by salesperson name) during the selected performance period. Draft and void invoices are excluded.',
    SALES_COLLECTED: 'Automatically totals payments received on this employee\'s posted invoices during the performance period.',
    SALES_NEW_CUSTOMERS: 'Counts customers with posted invoices assigned to this employee during the period.',
    CRM_WON_OPPORTUNITIES: 'Counts opportunities won during the period that are assigned to this employee.',
    CRM_WON_VALUE: 'Totals won opportunity value assigned to this employee during the period.',
    ATTENDANCE_PCT: 'Computes present days ÷ expected working days (excl. weekends and holidays) during the period.',
    ATTENDANCE_LATE: 'Counts attendance records with a late arrival during the period. Lower is better.',
    ATTENDANCE_ABSENCE: 'Counts unapproved absence days during the period. Lower is better.',
    ATTENDANCE_OVERTIME: 'Totals approved overtime hours recorded during the period.',
    QA_AVERAGE_SCORE: 'Averages the employee\'s QA assessment scores recorded during the period.',
    QA_FAILED_REVIEWS: 'Counts QA assessments below their pass threshold during the period. Lower is better.',
  };

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const version = editing.versions?.find((v: any) => v.version === editing.currentVersion) || editing.versions?.[0];
      form.setFieldsValue({
        name: editing.name, description: editing.description, departmentId: editing.departmentId, jobRole: editing.jobRole,
        effectiveFrom: editing.effectiveFrom ? form_date(editing.effectiveFrom) : undefined, effectiveTo: editing.effectiveTo ? form_date(editing.effectiveTo) : undefined,
        passMark: Number(editing.passMark), maxAchievement: Number(editing.maxAchievement), criticalMin: editing.criticalMin ? Number(editing.criticalMin) : undefined,
        selfAssessment: editing.selfAssessment, qaRequired: editing.qaRequired, managerQaDistinct: editing.managerQaDistinct,
      });
      setLines((version?.kpis || []).map((k: any) => ({ ...k, weight: Number(k.weight), targetValue: k.targetValue == null ? undefined : Number(k.targetValue) })));
    } else {
      form.resetFields();
      form.setFieldsValue({ departmentId: defaultDepartmentId, passMark: 70, maxAchievement: 120, qaRequired: true, managerQaDistinct: true, selfAssessment: false });
      setLines([]);
    }
  }, [open, editing]);

  const roleOptions = useMemo(() => {
    const positions = new Set<string>((meta.data?.employees || []).map((e: any) => e.position).filter(Boolean));
    return [{ label: 'All Roles', value: '' }, ...[...positions].sort().map((p) => ({ label: p, value: p }))];
  }, [meta.data]);

  const totalWeight = lines.reduce((s, l) => s + Number(l.weight || 0), 0);

  function addLine() { setLines((ls) => [...ls, { name: '', description: '', weight: 10, measurementType: 'NUMBER', direction: 'HIGHER_IS_BETTER', targetType: 'NUMBER', critical: false, evidenceRequired: false, employeeCommentRequired: false, reviewerCommentRequired: false, scoringMethod: 'PROPORTIONAL' }]); }
  function updLine(i: number, patch: any) { setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }
  function rmLine(i: number) { setLines((ls) => ls.filter((_, idx) => idx !== i)); }

  async function save() {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    if (!lines.length) { message.error('Add at least one KPI line'); return; }
    if (Math.abs(totalWeight - 100) > 0.001) { message.error(`KPI weights must total 100% (currently ${totalWeight}%)`); return; }
    for (const l of lines) {
      if (!l.name?.trim() || !l.description?.trim()) { message.error('Every KPI needs a name and description'); return; }
      if (l.measurementType !== 'MANUAL_SCORE' && l.targetValue == null && !l.targetText) { message.error(`KPI "${l.name}" needs a target`); return; }
    }
    setSaving(true);
    try {
      const payload = { ...v, effectiveFrom: v.effectiveFrom?.format('YYYY-MM-DD'), effectiveTo: v.effectiveTo?.format('YYYY-MM-DD') || null, jobRole: v.jobRole || null, criticalMin: v.criticalMin ?? null, kpis: lines.map((l, i) => ({ ...l, position: i, categoryLabel: l.categoryLabel, dataSource: l.dataSource || null })) };
      if (editing) await api(`/performance/kpi-templates/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/performance/kpi-templates', { method: 'POST', body: JSON.stringify(payload) });
      message.success(editing ? 'KPI template updated' : 'KPI template created as DRAFT — activate when ready');
      qc.invalidateQueries({ queryKey: ['/performance/kpi-templates'] });
      onClose();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  async function addCategory(name: string) {
    if (!name?.trim()) return;
    try { await api('/performance/kpi-categories', { method: 'POST', body: JSON.stringify({ name }) }); cats.refetch(); message.success('Category added'); } catch (e: any) { message.error(e.message); }
  }

  const catOptions = (cats.data || []).map((c: any) => ({ label: c.name, value: c.id }));

  return (
    <Drawer open={open} onClose={onClose} width="min(880px, 96vw)" title={editing ? `Edit KPI Template — ${editing.name}` : 'New KPI Template'} destroyOnHidden
      extra={<Space><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={save}>{editing ? 'Save changes' : 'Create template'}</Button></Space>}>
      <Form form={form} layout="vertical">
        <div className="text-[13px] font-semibold text-[#171a2e] mt-1 mb-3">Template Information</div>
        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item label="Template name" name="name" rules={[{ required: true }]} className="col-span-2"><Input placeholder="e.g. Sales Department Performance" /></Form.Item>
          <Form.Item label="Description" name="description" className="col-span-2"><Input.TextArea rows={2} /></Form.Item>
        </div>
        <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Assignment</div>
        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item label="Department" name="departmentId" rules={[{ required: true, message: 'Select the HR department' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Select department" options={(meta.data?.departments || []).map((d: any) => ({ label: d.name, value: d.id }))} />
          </Form.Item>
          <Form.Item label="Job Role / Position" name="jobRole" tooltip="Leave as All Roles for the department default. A role-specific template overrides it for those employees.">
            <Select showSearch optionFilterProp="label" allowClear placeholder="All Roles" options={roleOptions} />
          </Form.Item>
          <Form.Item label="Effective from" name="effectiveFrom" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Effective to" name="effectiveTo"><DatePicker className="w-full" /></Form.Item>
        </div>
        <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Scoring</div>
        <div className="grid grid-cols-3 gap-x-4">
          <Form.Item label="Pass mark %" name="passMark" rules={[{ required: true }]}><InputNumber min={0} max={100} className="w-full" /></Form.Item>
          <Form.Item label="Maximum achievement %" name="maxAchievement" tooltip="Caps a single KPI's achievement (e.g. 120%) so one KPI cannot dominate"><InputNumber min={100} max={200} className="w-full" /></Form.Item>
          <Form.Item label="Critical KPI minimum %" name="criticalMin" tooltip="Assessments with a critical KPI below this are flagged for authorized review"><InputNumber min={0} max={100} className="w-full" /></Form.Item>
          <Form.Item label="Employee self-assessment" name="selfAssessment" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item label="QA review required" name="qaRequired" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item label="QA reviewer ≠ manager" name="managerQaDistinct" valuePropName="checked"><Switch /></Form.Item>
        </div>

        <div className="flex items-center justify-between mt-2 mb-3">
          <div className="text-[13px] font-semibold text-[#171a2e]">KPIs</div>
          <div className={`text-[13px] font-semibold ${Math.abs(totalWeight - 100) < 0.001 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>Total weight: {totalWeight}%</div>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="border border-[#e6e9f2] rounded-lg p-3 mb-3 bg-[#fafbfe]">
            <div className="grid grid-cols-12 gap-x-3 gap-y-1">
              <div className="col-span-2"><label className="text-[12px] text-[#64748b]">KPI Code</label><Input size="small" value={l.code} onChange={(e) => updLine(i, { code: e.target.value })} placeholder="Auto" /></div>
              <div className="col-span-5"><label className="text-[12px] text-[#64748b]">KPI Name *</label><Input size="small" value={l.name} onChange={(e) => updLine(i, { name: e.target.value })} placeholder="e.g. Monthly Sales Revenue" /></div>
              <div className="col-span-3">
                <label className="text-[12px] text-[#64748b]">Category</label>
                <Select size="small" allowClear value={l.categoryId} onChange={(v) => updLine(i, { categoryId: v })} options={catOptions} popupRender={(menu) => (<><div className="p-1">{menu}</div><div className="flex gap-1 p-2 border-t"><Input size="small" id={`ncat-${i}`} placeholder="New category" /><Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => addCategory((document.getElementById(`ncat-${i}`) as HTMLInputElement)?.value)} /></div></>)} />
              </div>
              <div className="col-span-2"><label className="text-[12px] text-[#64748b]">Weight % *</label><InputNumber size="small" min={0} max={100} value={l.weight} onChange={(v) => updLine(i, { weight: v })} className="w-full" /></div>
              <div className="col-span-3">
                <label className="text-[12px] text-[#64748b]">Measurement Type *</label>
                <Select size="small" value={l.measurementType} onChange={(v) => updLine(i, { measurementType: v, unit: UNIT_BY_TYPE[v] ?? l.unit, targetType: v === 'RATING_SCALE' ? 'RATING' : v === 'YES_NO' ? 'YES' : 'NUMBER', scoringMethod: v === 'MANUAL_SCORE' ? 'MANUAL' : v === 'YES_NO' ? 'BINARY' : l.scoringMethod })} options={MEASUREMENT_TYPES} />
              </div>
              <div className="col-span-3">
                <label className="text-[12px] text-[#64748b]">Direction *</label>
                <Select size="small" value={l.direction} onChange={(v) => updLine(i, { direction: v })} options={KPI_DIRECTIONS} />
              </div>
              <div className="col-span-3">
                <label className="text-[12px] text-[#64748b]">Target * {l.direction === 'TARGET_RANGE' ? '(max)' : ''}</label>
                {l.measurementType === 'YES_NO' ? <Select size="small" value={l.targetText || 'YES'} onChange={(v) => updLine(i, { targetText: v })} options={[{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }]} /> :
                  l.measurementType === 'MANUAL_SCORE' ? <Input size="small" disabled placeholder="Score entered during review" /> :
                    <InputNumber size="small" className="w-full" value={l.targetValue} onChange={(v) => updLine(i, { targetValue: v })} />}
              </div>
              <div className="col-span-2"><label className="text-[12px] text-[#64748b]">Unit</label><Input size="small" value={l.unit} onChange={(e) => updLine(i, { unit: e.target.value })} placeholder="$ / % / days" /></div>
              <div className="col-span-1 flex items-end justify-end"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => rmLine(i)} /></div>
              <div className="col-span-12">
                <label className="text-[12px] text-[#64748b]">Description *</label>
                <Input size="small" value={l.description} onChange={(e) => updLine(i, { description: e.target.value })} placeholder="What exactly is measured and how" />
              </div>
              <div className="col-span-6">
                <label className="text-[12px] text-[#64748b] flex items-center gap-1">Data Source {l.dataSource && <Tooltip title={SOURCE_TOOLTIPS[l.dataSource] || ''}><InfoCircleOutlined className="text-[#1d5fb5]" /></Tooltip>}</label>
                <Select size="small" allowClear value={l.dataSource} onChange={(v) => updLine(i, { dataSource: v, systemDerived: !!v })} placeholder="Manual assessment" options={sources} />
              </div>
              <div className="col-span-3"><label className="text-[12px] text-[#64748b]">Minimum acceptable</label><InputNumber size="small" className="w-full" value={l.minimumAcceptable} onChange={(v) => updLine(i, { minimumAcceptable: v })} /></div>
              <div className="col-span-3"><label className="text-[12px] text-[#64748b]">Stretch target</label><InputNumber size="small" className="w-full" value={l.stretchTarget} onChange={(v) => updLine(i, { stretchTarget: v })} /></div>
              <div className="col-span-12 flex flex-wrap gap-4 pt-1">
                <label className="text-[12px] text-[#344054] flex items-center gap-1.5"><Switch size="small" checked={l.critical} onChange={(v) => updLine(i, { critical: v })} />Critical KPI</label>
                <label className="text-[12px] text-[#344054] flex items-center gap-1.5"><Switch size="small" checked={l.evidenceRequired} onChange={(v) => updLine(i, { evidenceRequired: v })} />Evidence required</label>
                <label className="text-[12px] text-[#344054] flex items-center gap-1.5"><Switch size="small" checked={l.employeeCommentRequired} onChange={(v) => updLine(i, { employeeCommentRequired: v })} />Employee comment required</label>
                <label className="text-[12px] text-[#344054] flex items-center gap-1.5"><Switch size="small" checked={l.reviewerCommentRequired} onChange={(v) => updLine(i, { reviewerCommentRequired: v })} />Reviewer comment required</label>
              </div>
            </div>
          </div>
        ))}
        <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine}>Add KPI line</Button>
      </Form>
    </Drawer>
  );
}

function form_date(v: any) { const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; }

// ---------- Template details drawer ----------
export function KpiTemplateDetailsDrawer({ open, onClose, template, onEdit }: { open: boolean; onClose: () => void; template: any; onEdit: (t: any) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const id = template?.id;
  const detail = useQuery({ queryKey: ['/performance/kpi-templates', id], queryFn: () => api(`/performance/kpi-templates/${id}`), enabled: open && !!id });
  const usage = useQuery({ queryKey: ['/performance/kpi-templates', id, 'usage'], queryFn: () => api(`/performance/kpi-templates/${id}/usage`), enabled: open && !!id });
  const t = detail.data;

  async function activate() { try { await api(`/performance/kpi-templates/${id}/activate`, { method: 'POST' }); message.success('Template activated'); qc.invalidateQueries({ queryKey: ['/performance/kpi-templates'] }); } catch (e: any) { message.error(e.message); } }
  async function setStatus(status: string) { try { await api(`/performance/kpi-templates/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); message.success(`Template ${status.toLowerCase()}`); qc.invalidateQueries({ queryKey: ['/performance/kpi-templates'] }); onClose(); } catch (e: any) { message.error(e.message); } }
  async function duplicate() { try { const copy = await api(`/performance/kpi-templates/${id}/duplicate`, { method: 'POST', body: JSON.stringify({}) }); message.success('Template duplicated as DRAFT'); qc.invalidateQueries({ queryKey: ['/performance/kpi-templates'] }); onClose(); onEdit(copy); } catch (e: any) { message.error(e.message); } }

  const version = t?.versions?.find((v: any) => v.version === t.currentVersion) || t?.versions?.[0];

  const kpiCols: ColumnsType<any> = [
    { title: 'KPI', render: (_v, r) => <div><div className="font-medium text-[13px] text-[#171a2e]">{r.name}{r.critical && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#fef2f2] text-[#dc2626] font-semibold">CRITICAL</span>}</div><div className="text-[12px] text-[#64748b]">{r.code}</div></div> },
    { title: 'Category', render: (_v, r) => r.category?.name || r.categoryLabel || '—', width: 130 },
    { title: 'Weight', width: 80, align: 'right', render: (_v, r) => `${Number(r.weight)}%` },
    { title: 'Measurement', render: (_v, r) => MEASUREMENT_TYPES.find((m) => m.value === r.measurementType)?.label || r.measurementType, width: 120 },
    { title: 'Direction', render: (_v, r) => KPI_DIRECTIONS.find((d) => d.value === r.direction)?.label, width: 130 },
    { title: 'Target', align: 'right', render: (_v, r) => (r.targetText || (r.targetValue != null ? `${Number(r.targetValue)}${r.unit ? ` ${r.unit}` : ''}` : '—')), width: 110 },
    { title: 'Source', render: (_v, r) => r.dataSource ? <Tooltip title="System-derived KPI"><span className="text-[#1d5fb5]">ⓘ {r.dataSourceLabel || r.dataSource}</span></Tooltip> : <span className="text-[#64748b]">Manual</span>, width: 140 },
  ] as ColumnsType<any>;

  return (
    <Drawer open={open} onClose={onClose} width="min(920px, 96vw)" title={t ? `${t.name} · v${t.currentVersion}` : 'KPI Template'} destroyOnHidden
      extra={t && (
        <Space>
          <CanTplManage>
            {t.status === 'DRAFT' && <Button type="primary" onClick={activate}>Activate</Button>}
            {t.status === 'ACTIVE' && <Button onClick={() => setStatus('INACTIVE')}>Deactivate</Button>}
            {(t.status === 'ACTIVE' || t.status === 'INACTIVE') && <Popconfirm title="Archive this template? Historical assessments are preserved." onConfirm={() => setStatus('ARCHIVED')}><Button danger>Archive</Button></Popconfirm>}
            <Button onClick={duplicate}>Duplicate</Button>
            <Button type="primary" ghost onClick={() => onEdit(t)}>Edit</Button>
          </CanTplManage>
        </Space>
      )}>
      {t && (
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'overview', label: 'Overview', children: (
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <Row label="Department" value={t.department?.name} /><Row label="Job Role" value={t.jobRole || 'All Roles'} />
                <Row label="Status" value={t.status} /><Row label="Version" value={`v${t.currentVersion}`} />
                <Row label="Effective from" value={fmtDate(t.effectiveFrom)} /><Row label="Effective to" value={fmtDate(t.effectiveTo)} />
              </div>
              <div className="space-y-2">
                <Row label="Pass mark" value={`${Number(t.passMark)}%`} /><Row label="Max achievement" value={`${Number(t.maxAchievement)}%`} />
                <Row label="Critical KPI minimum" value={t.criticalMin ? `${Number(t.criticalMin)}%` : '—'} />
                <Row label="Self assessment" value={t.selfAssessment ? 'Enabled' : 'Disabled'} /><Row label="QA review" value={t.qaRequired ? (t.managerQaDistinct ? 'Required (independent reviewer)' : 'Required') : 'Not required'} />
              </div>
            </div>
          ) },
          { key: 'kpis', label: `KPIs (${version?.kpis?.length || 0})`, children: (
            <>
              <div className={`text-[13px] font-semibold mb-2 ${Math.abs((version?.kpis || []).reduce((s: number, k: any) => s + Number(k.weight), 0) - 100) < 0.001 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>Total weight: {(version?.kpis || []).reduce((s: number, k: any) => s + Number(k.weight), 0)}%</div>
              <Table rowKey="id" size="small" dataSource={version?.kpis || []} columns={kpiCols} pagination={false} />
            </>
          ) },
          { key: 'versions', label: `Versions (${t.versions?.length || 0})`, children: (
            <Table rowKey="id" size="small" dataSource={t.versions || []} pagination={false} columns={[
              { title: 'Version', render: (_v: any, r: any) => `v${r.version}` + (r.version === t.currentVersion ? ' (current)' : ''), width: 120 },
              { title: 'Name', dataIndex: 'name' }, { title: 'Status', dataIndex: 'status', width: 120 },
              { title: 'KPIs', width: 80, render: (_v: any, r: any) => r.kpis?.length },
              { title: 'Pass mark', width: 90, render: (_v: any, r: any) => `${Number(r.passMark)}%` },
              { title: 'Effective from', dataIndex: 'effectiveFrom', width: 120, render: (v: any) => fmtDate(v) },
            ] as ColumnsType<any>} />
          ) },
          { key: 'usage', label: 'Usage', children: (
            <div className="grid grid-cols-3 gap-4">
              <UsageCard label="Active employees" value={usage.data?.activeEmployees} />
              <UsageCard label="Current assessments" value={usage.data?.currentAssessments} />
              <UsageCard label="Completed historical reviews" value={usage.data?.historicalReviews} />
            </div>
          ) },
          { key: 'audit', label: 'Audit', children: <div className="text-[13px] text-[#64748b]">Audit entries for this template appear in Administration → Audit with entity type <code>KpiTemplate</code> (created, updated, version created, activated, duplicated).</div> },
        ]} />
      )}
    </Drawer>
  );
}

import { Can } from '@/components/Can';
function CanTplManage({ children }: { children: React.ReactNode }) { return <Can permission="performance.templates.manage">{children}</Can>; }

function Row({ label, value }: { label: string; value: any }) {
  return <div className="flex justify-between text-[13px] border-b border-[#f0f1f6] py-1.5"><span className="text-[#64748b]">{label}</span><span className="font-medium text-[#171a2e]">{value || '—'}</span></div>;
}
function UsageCard({ label, value }: { label: string; value?: number }) {
  return <div className="nex-card border rounded-lg p-4 text-center"><div className="text-[12px] font-semibold text-[#64748b]">{label}</div><div className="text-[22px] font-bold text-[#171a2e] mt-1">{value ?? '…'}</div></div>;
}
