'use client';
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, Row, Select, Skeleton, Space,
  Table, Tabs, Tag, Tooltip, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined, EditOutlined, PlusOutlined, SendOutlined, TeamOutlined } from '@ant-design/icons';
import Link from 'next/link';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill, DetailItem, EmptyState } from '@/components/sales-ui';
import { KpiTemplateDrawer } from '@/components/performance/kpi-template-drawer';
import { ReviewDrawer } from '@/components/performance/review-drawer';
import { fmtDate, fmtNumber } from '@/lib/format';

export type DepartmentView = 'OVERVIEW' | 'EMPLOYEES' | 'KPI_TEMPLATES' | 'PERFORMANCE';

function reviewModeFor(a: any): 'MANAGER' | 'QA' | 'VIEW' {
  if (['APPROVED', 'COMPLETED', 'LOCKED'].includes(a.status)) return 'VIEW';
  if (a.status === 'PENDING_MANAGER') return 'MANAGER';
  if (a.status === 'PENDING_QA' || a.status === 'PENDING_CALIBRATION') return 'QA';
  return 'VIEW';
}

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="nex-card border rounded-lg p-3.5 text-center">
      <div className="text-[12px] font-semibold text-[#64748b]">{label}</div>
      <div className="text-[19px] font-bold mt-0.5" style={{ color: color || '#171a2e' }}>{value}</div>
    </div>
  );
}

export function DepartmentDrawer({ open, departmentId, initialView = 'OVERVIEW', initialSub, onClose, onChanged }: {
  open: boolean; departmentId: string | null; initialView?: DepartmentView; initialSub?: string; onClose: () => void; onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<DepartmentView>(initialView);
  const [sub, setSub] = useState<{ type: string; payload?: any } | null>(null);

  React.useEffect(() => { if (open) { setTab(initialView); setSub(initialSub ? { type: initialSub } : null); } }, [open, departmentId, initialView, initialSub]);

  const overview = useQuery({ queryKey: ['dept-360', departmentId], queryFn: () => api(`/hr/departments/${departmentId}/360`), enabled: open && !!departmentId });

  const d = overview.data;
  const close = () => { setSub(null); onClose(); };
  const changed = () => { qc.invalidateQueries({ queryKey: ['dept-360', departmentId] }); qc.invalidateQueries({ queryKey: ['/hr/departments'] }); onChanged?.(); };

  const title = d ? (
    <div>
      <div className="text-[17px] font-bold text-[#171a2e] flex items-center gap-2">{d.department.name} <StatusPill status={d.department.status} /></div>
      <div className="text-[12px] text-[#64748b] font-normal">{d.department.code} · {d.department.branch || '—'} · {d.summary.employees} employee{d.summary.employees === 1 ? '' : 's'}</div>
    </div>
  ) : 'Department';

  return (
    <>
      <Drawer open={open} onClose={close} width="min(1050px, 97vw)" destroyOnHidden title={title}
        extra={d ? <Can permission="hr.employees.manage"><Button size="small" icon={<EditOutlined />} onClick={() => setSub({ type: 'EDIT' })}>Edit</Button></Can> : null}>
        {overview.isLoading ? <Skeleton active /> : overview.isError ? (
          <div className="text-center py-12"><div className="text-[13px] text-[#64748b] mb-3">Unable to load department.</div><Button onClick={() => overview.refetch()}>Retry</Button></div>
        ) : (
          <Tabs activeKey={tab} onChange={(k) => setTab(k as DepartmentView)} items={[
            { key: 'OVERVIEW', label: 'Overview', children: <OverviewView id={departmentId!} data={d} onAction={(t) => setSub(t)} /> },
            { key: 'EMPLOYEES', label: 'Employees', children: <EmployeesView id={departmentId!} onView={(empId) => setSub({ type: 'EMPLOYEE', payload: empId })} onAssign={() => setSub({ type: 'ASSIGN' })} /> },
            { key: 'KPI_TEMPLATES', label: 'KPI Templates', children: <KpiTemplatesView id={departmentId!} onView={(tid) => setSub({ type: 'KPI_DETAIL', payload: tid })} onCreate={() => setSub({ type: 'KPI_CREATE' })} onEdit={(tpl) => setSub({ type: 'KPI_EDIT', payload: tpl })} onChanged={changed} /> },
            { key: 'PERFORMANCE', label: 'Performance', children: <PerformanceView id={departmentId!} onReview={(a) => setSub({ type: 'ASSESSMENT', payload: a })} /> },
          ]} />
        )}
      </Drawer>

      {sub?.type === 'EDIT' && departmentId && (
        <EditDepartmentDrawer id={departmentId} department={d?.department} onClose={() => setSub(null)} onSaved={() => { setSub(null); changed(); }} />
      )}
      {sub?.type === 'ASSIGN' && departmentId && (
        <AssignEmployeeDrawer id={departmentId} onClose={() => setSub(null)} onSaved={() => { setSub(null); changed(); }} />
      )}
      {sub?.type === 'EMPLOYEE' && sub.payload && (
        <EmployeeMiniDrawer employeeId={sub.payload} departmentName={d?.department?.name} onClose={() => setSub(null)} />
      )}
      {sub?.type === 'KPI_DETAIL' && departmentId && sub.payload && (
        <KpiDetailDrawer id={departmentId} templateId={sub.payload} onClose={() => setSub(null)} />
      )}
      {(sub?.type === 'KPI_CREATE' || sub?.type === 'KPI_EDIT') && departmentId && (
        <KpiTemplateDrawer open onClose={() => setSub(null)} editing={sub.type === 'KPI_EDIT' ? sub.payload : undefined} defaultDepartmentId={departmentId} />
      )}
      {sub?.type === 'ASSESSMENT' && sub.payload && (
        <ReviewDrawer open assessmentId={sub.payload.id} mode={reviewModeFor(sub.payload)} onClose={() => { setSub(null); qc.invalidateQueries({ queryKey: ['dept-performance', departmentId] }); qc.invalidateQueries({ queryKey: ['dept-360', departmentId] }); }} />
      )}
    </>
  );
}

// ======================================================================
// Overview
// ======================================================================
function OverviewView({ id, data, onAction }: { id: string; data: any; onAction: (s: { type: string }) => void }) {
  if (!data) return <Skeleton active />;
  const dep = data.department; const s = data.summary;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Employees" value={s.employees} />
        <Stat label="Active" value={s.active} color="#16a34a" />
        <Stat label="On leave" value={s.onLeave} />
        <Stat label="Current cycle" value={s.currentCycle || '—'} />
      </div>
      <div className="nex-card border rounded-lg p-5">
        <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Department information</div>
        <Row gutter={[16, 0]}>
          <Col xs={24} md={12}>
            <DetailItem label="Name" value={dep.name} />
            <DetailItem label="Code" value={dep.code} />
            <DetailItem label="Branch" value={dep.branch} />
          </Col>
          <Col xs={24} md={12}>
            <DetailItem label="Status" value={<StatusPill status={dep.status} />} />
            <DetailItem label="Active KPI template" value={s.activeTemplate ? `${s.activeTemplate.name} v${s.activeTemplate.version} (${s.activeTemplate.kpiCount} KPIs)` : 'None configured'} />
            <DetailItem label="Employees" value={`${s.employees} total · ${s.active} active · ${s.onLeave} on leave`} />
          </Col>
        </Row>
        <Space className="mt-4">
          <Can permission="hr.employees.manage"><Button size="small" icon={<EditOutlined />} onClick={() => onAction({ type: 'EDIT' })}>Edit Department</Button></Can>
          <Can permission="hr.employees.manage"><Button size="small" icon={<PlusOutlined />} onClick={() => onAction({ type: 'ASSIGN' })}>Assign Employee</Button></Can>
          <Can permission={['performance.templates.manage', 'hr.performance.manage']}><Button size="small" icon={<PlusOutlined />} onClick={() => onAction({ type: 'KPI_CREATE' })}>Manage KPI Template</Button></Can>
        </Space>
      </div>
    </div>
  );
}

// ======================================================================
// Employees
// ======================================================================
function EmployeesView({ id, onView, onAssign }: { id: string; onView: (empId: string) => void; onAssign: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['dept-employees', id], queryFn: () => api(`/hr/departments/${id}/employees`) });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [position, setPosition] = useState<string | undefined>();
  const rows = data?.employees || [];
  const positions = useMemo(() => Array.from(new Set(rows.map((r: any) => r.position).filter(Boolean))), [rows]);
  const filtered = rows.filter((r: any) => {
    if (status && r.employmentStatus !== status) return false;
    if (position && r.position !== position) return false;
    if (search && !`${r.firstName} ${r.lastName} ${r.employeeNo} ${r.workEmail}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  if (isLoading) return <Skeleton active />;
  if (isError) return <div className="text-center py-10"><div className="text-[13px] text-[#64748b] mb-3">Unable to load department employees.</div><Button onClick={() => refetch()}>Retry</Button></div>;
  const active = rows.filter((r: any) => r.employmentStatus === 'ACTIVE').length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Employees" value={rows.length} />
        <Stat label="Active" value={active} color="#16a34a" />
        <Stat label="Other status" value={rows.length - active} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input allowClear placeholder="Search employee..." style={{ width: 200 }} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select allowClear placeholder="Employment status" style={{ width: 160 }} value={status} onChange={setStatus} options={['ACTIVE', 'PROBATION', 'ON_LEAVE', 'TERMINATED'].map((x) => ({ label: x.replace(/_/g, ' '), value: x }))} />
        <Select allowClear placeholder="Job position" style={{ width: 170 }} value={position} onChange={setPosition} options={positions.map((p: any) => ({ label: p, value: p }))} />
        <div className="ml-auto"><Can permission="hr.employees.manage"><Button type="primary" icon={<PlusOutlined />} onClick={onAssign}>Assign Employee</Button></Can></div>
      </div>
      <Table rowKey="id" size="small" dataSource={filtered} pagination={{ pageSize: 10 }} locale={{ emptyText: <EmptyState title="No employees are assigned to this department." action={<Can permission="hr.employees.manage"><Button type="primary" onClick={onAssign}>Assign Employee</Button></Can>} /> }} columns={[
        { title: 'Employee', render: (_v, r) => (<div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0" style={{ background: '#003366' }}>{(r.firstName || '?').charAt(0)}{(r.lastName || '').charAt(0)}</div><div><div className="text-[13px] font-medium text-[#171a2e]">{r.preferredName || `${r.firstName} ${r.lastName}`}</div><div className="text-[11px] text-[#94a3b8]">{r.workEmail || '—'}</div></div></div>) },
        { title: 'Employee #', dataIndex: 'employeeNo', width: 110 },
        { title: 'Position', dataIndex: 'position', width: 150, render: (v) => v || '—' },
        { title: 'Manager', dataIndex: 'manager', width: 140, render: (v) => v || '—' },
        { title: 'Branch', dataIndex: 'branch', width: 130 },
        { title: 'Status', dataIndex: 'employmentStatus', width: 110, render: (v) => <StatusPill status={v} /> },
        { title: 'Actions', width: 80, render: (_v, r) => <Button size="small" onClick={() => onView(r.id)}>View</Button> },
      ] as ColumnsType<any>} />
    </div>
  );
}

// ======================================================================
// KPI Templates
// ======================================================================
function KpiTemplatesView({ id, onView, onCreate, onEdit, onChanged }: { id: string; onView: (tid: string) => void; onCreate: () => void; onEdit: (tpl: any) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['dept-kpi', id], queryFn: () => api(`/hr/departments/${id}/kpi-templates`) });
  const full = useQuery({ queryKey: ['/performance/kpi-templates'], queryFn: () => api('/performance/kpi-templates') });
  if (isLoading) return <Skeleton active />;
  if (isError) return <div className="text-center py-10"><div className="text-[13px] text-[#64748b] mb-3">Unable to load KPI templates.</div><Button onClick={() => refetch()}>Retry</Button></div>;
  const rows = data?.templates || [];
  const active = data?.active;

  async function act(tpl: any, action: string) {
    try {
      if (action === 'duplicate') await api(`/performance/kpi-templates/${tpl.id}/duplicate`, { method: 'POST', body: JSON.stringify({}) });
      else if (action === 'activate') await api(`/performance/kpi-templates/${tpl.id}/activate`, { method: 'POST' });
      else if (action === 'archive') await api(`/performance/kpi-templates/${tpl.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'ARCHIVED' }) });
      message.success('KPI template updated');
      qc.invalidateQueries({ queryKey: ['dept-kpi', id] }); qc.invalidateQueries({ queryKey: ['/performance/kpi-templates'] }); qc.invalidateQueries({ queryKey: ['dept-360', id] }); onChanged();
    } catch (e: any) { message.error(e.message); }
  }

  return (
    <div className="space-y-4">
      {active && (
        <div className="nex-card border rounded-lg p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Active template" value={<span className="text-[14px]">{active.name} v{active.version}</span>} />
          <Stat label="KPIs" value={active.kpiCount} />
          <Stat label="Total weight" value={`${fmtNumber(active.totalWeight, 0)}%`} color={Math.abs(active.totalWeight - 100) < 0.01 ? '#16a34a' : '#dc2626'} />
          <Stat label="Pass mark" value={`${fmtNumber(active.passMark, 0)}%`} />
        </div>
      )}
      <div className="flex justify-end"><Can permission={['performance.templates.manage', 'hr.performance.manage']}><Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>KPI Template</Button></Can></div>
      <Table rowKey="id" size="small" dataSource={rows} pagination={false} locale={{ emptyText: <EmptyState title="No KPI template is configured for this department." action={<Can permission={['performance.templates.manage', 'hr.performance.manage']}><Button type="primary" onClick={onCreate}>Create KPI Template</Button></Can>} /> }} columns={[
        { title: 'Template', dataIndex: 'name' },
        { title: 'Version', dataIndex: 'version', width: 80, render: (v) => `v${v}` },
        { title: 'Role', dataIndex: 'jobRole', width: 120, render: (v) => v || 'All roles' },
        { title: 'KPIs', dataIndex: 'kpiCount', width: 70, align: 'right' },
        { title: 'Weight', dataIndex: 'totalWeight', width: 80, align: 'right', render: (v) => `${fmtNumber(v, 0)}%` },
        { title: 'Pass mark', dataIndex: 'passMark', width: 90, align: 'right', render: (v) => `${fmtNumber(v, 0)}%` },
        { title: 'Effective from', dataIndex: 'effectiveFrom', width: 120, render: (v) => fmtDate(v) },
        { title: 'Status', dataIndex: 'status', width: 100, render: (v) => <StatusPill status={v} /> },
        { title: 'Actions', width: 200, render: (_v, r) => (
          <Space size={4}>
            <Button size="small" onClick={() => onView(r.id)}>View</Button>
            {['DRAFT', 'INACTIVE'].includes(r.status) && <Can permission="performance.templates.manage"><Button size="small" onClick={() => { const t = (full.data || []).find((x: any) => x.id === r.id); onEdit(t || r); }}>Edit</Button></Can>}
            {r.status === 'DRAFT' && <Can permission="performance.templates.manage"><Button size="small" type="primary" onClick={() => act(r, 'activate')}>Activate</Button></Can>}
            <Can permission="performance.templates.manage"><Button size="small" onClick={() => act(r, 'duplicate')}>Duplicate</Button></Can>
            {r.status !== 'ARCHIVED' && <Can permission="performance.templates.manage"><Button size="small" danger onClick={() => act(r, 'archive')}>Archive</Button></Can>}
          </Space>
        ) },
      ] as ColumnsType<any>} />
    </div>
  );
}

function KpiDetailDrawer({ id, templateId, onClose }: { id: string; templateId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['dept-kpi-detail', id, templateId], queryFn: () => api(`/hr/departments/${id}/kpi-templates/${templateId}`) });
  return (
    <Drawer open onClose={onClose} width="min(850px, 95vw)" title={data ? `${data.name} v${data.version}` : 'KPI Template'}>
      {isLoading || !data ? <Skeleton active /> : (
        <div className="space-y-4">
          <div className="nex-card border rounded-lg p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Version" value={`v${data.version}`} />
            <Stat label="KPIs" value={data.kpis.length} />
            <Stat label="Pass mark" value={`${fmtNumber(data.passMark, 0)}%`} />
            <Stat label="Status" value={<StatusPill status={data.status} />} />
          </div>
          <div className="nex-card border rounded-lg p-4">
            <DetailItem label="Department" value={data.departmentName || '—'} />
            <DetailItem label="Job role" value={data.jobRole || 'All roles'} />
            <DetailItem label="Effective from" value={fmtDate(data.effectiveFrom)} />
            <DetailItem label="Effective to" value={fmtDate(data.effectiveTo)} />
          </div>
          <Table rowKey="id" size="small" dataSource={data.kpis} pagination={false} columns={[
            { title: 'KPI', dataIndex: 'name', render: (v, r) => (<div><div className="font-medium">{v}</div><div className="text-[11px] text-[#94a3b8]">{r.code}</div></div>) },
            { title: 'Category', dataIndex: 'category', width: 120, render: (v) => v || '—' },
            { title: 'Weight', dataIndex: 'weight', width: 80, align: 'right', render: (v) => `${fmtNumber(v, 0)}%` },
            { title: 'Target', width: 110, align: 'right', render: (_v, r) => r.target != null ? `${fmtNumber(r.target, 0)}${r.unit ? ` ${r.unit}` : ''}` : '—' },
            { title: 'Measurement', dataIndex: 'measurementType', width: 130, render: (v) => (v || '').replace(/_/g, ' ') },
            { title: 'Data source', dataIndex: 'dataSourceLabel', width: 150, render: (v, r) => v || r.dataSource || '—' },
          ] as ColumnsType<any>} />
        </div>
      )}
    </Drawer>
  );
}

// ======================================================================
// Performance
// ======================================================================
function PerformanceView({ id, onReview }: { id: string; onReview: (a: any) => void }) {
  const qc = useQueryClient();
  const [cycleId, setCycleId] = useState<string | undefined>();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['dept-performance', id, cycleId], queryFn: () => api(`/hr/departments/${id}/performance${cycleId ? `?cycleId=${cycleId}` : ''}`) });
  const [subStatus, setSubStatus] = useState<string | undefined>();
  const [qaStatus, setQaStatus] = useState<string | undefined>();
  const [result, setResult] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  if (isLoading) return <Skeleton active />;
  if (isError) return <div className="text-center py-10"><div className="text-[13px] text-[#64748b] mb-3">Unable to load department performance.</div><Button onClick={() => refetch()}>Retry</Button></div>;
  const s = data?.summary || {};
  const rows = (data?.assessments || []).filter((a: any) => {
    if (subStatus === 'SUBMITTED' && !a.employeeSubmitted) return false;
    if (subStatus === 'NOT_SUBMITTED' && a.employeeSubmitted) return false;
    if (qaStatus === 'PENDING' && a.qaSubmitted) return false;
    if (qaStatus === 'COMPLETED' && !a.qaSubmitted) return false;
    if (result && a.result !== result) return false;
    if (search && !`${a.employee?.firstName} ${a.employee?.lastName} ${a.employee?.employeeNo}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function remind(a: any) {
    try { await api(`/performance/assessments/${a.id}/remind`, { method: 'POST' }); message.success('Reminder sent'); }
    catch (e: any) { message.error(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[#64748b]">Cycle</span>
        <Select style={{ width: 220 }} value={data?.currentCycle?.id} onChange={setCycleId} options={(data?.cycles || []).map((c: any) => ({ label: `${c.name} (${c.status})`, value: c.id }))} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Employees" value={s.employees ?? 0} />
        <Stat label="Submitted" value={s.submitted ?? 0} color="#16a34a" />
        <Stat label="Missing" value={s.missing ?? 0} color={(s.missing ?? 0) > 0 ? '#dc2626' : undefined} />
        <Stat label="Average score" value={s.averageScore != null ? `${fmtNumber(s.averageScore, 1)}%` : '—'} />
        <Stat label="Passed" value={s.passed ?? 0} color="#16a34a" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input allowClear placeholder="Search employee..." style={{ width: 190 }} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select allowClear placeholder="Submission" style={{ width: 150 }} value={subStatus} onChange={setSubStatus} options={[{ label: 'SUBMITTED', value: 'SUBMITTED' }, { label: 'NOT SUBMITTED', value: 'NOT_SUBMITTED' }]} />
        <Select allowClear placeholder="QA status" style={{ width: 140 }} value={qaStatus} onChange={setQaStatus} options={[{ label: 'PENDING', value: 'PENDING' }, { label: 'COMPLETED', value: 'COMPLETED' }]} />
        <Select allowClear placeholder="Result" style={{ width: 120 }} value={result} onChange={setResult} options={['PASS', 'FAIL'].map((x) => ({ label: x, value: x }))} />
      </div>
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 10 }} locale={{ emptyText: <EmptyState title="No performance assessments found for the selected cycle." /> }} columns={[
        { title: 'Employee', render: (_v, r) => <span className="text-[13px] font-medium text-[#171a2e]">{r.employee?.preferredName || `${r.employee?.firstName} ${r.employee?.lastName}`}</span> },
        { title: 'Position', dataIndex: 'position', width: 140, render: (v) => v || '—' },
        { title: 'KPI Template', dataIndex: 'templateName', width: 170, render: (v, r) => `${v || '—'}${r.templateVersion ? ` v${r.templateVersion}` : ''}` },
        { title: 'Submission', width: 130, render: (_v, r) => r.employeeSubmitted ? <Tag color="green">SUBMITTED</Tag> : (r.overdue ? <Tag color="red">OVERDUE · {r.daysOverdue}d</Tag> : <Tag color="orange">NOT SUBMITTED</Tag>) },
        { title: 'Manager review', width: 130, render: (_v, r) => r.managerSubmitted ? <Tag color="green">COMPLETED</Tag> : <Tag color="orange">PENDING</Tag> },
        { title: 'QA', width: 100, render: (_v, r) => r.qaSubmitted ? <Tag color="green">COMPLETED</Tag> : <Tag>PENDING</Tag> },
        { title: 'Score', dataIndex: 'score', width: 90, align: 'right', render: (v) => v != null ? `${fmtNumber(v, 1)}%` : '—' },
        { title: 'Result', dataIndex: 'result', width: 90, render: (v) => v ? <StatusPill status={v} /> : '—' },
        { title: 'Actions', width: 190, render: (_v, r) => (
          <Space size={4}>
            <Button size="small" onClick={() => onReview(r)}>{r.status === 'PENDING_QA' || r.status === 'PENDING_CALIBRATION' ? 'Perform QA' : 'Review'}</Button>
            {!r.employeeSubmitted && <Can permission={['performance.cycles.manage', 'hr.performance.manage']}><Button size="small" icon={<SendOutlined />} onClick={() => remind(r)}>Remind</Button></Can>}
          </Space>
        ) },
      ] as ColumnsType<any>} />
    </div>
  );
}

// ======================================================================
// Nested drawers
// ======================================================================
function EditDepartmentDrawer({ id, department, onClose, onSaved }: { id: string; department: any; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [branches, setBranches] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  React.useEffect(() => { api('/companies/meta').then((m: any) => setBranches(m?.branches || [])).catch(() => {}); }, []);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try { await api(`/hr/departments/${id}`, { method: 'PATCH', body: JSON.stringify({ name: v.name, code: v.code, branchId: v.branchId }) }); message.success('Department updated'); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={480} title={`Edit department${department?.name ? ` — ${department.name}` : ''}`}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save Changes</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ name: department?.name, code: department?.code, branchId: department?.branchId }}>
        <Form.Item name="name" label="Department Name" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="code" label="Department Code" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="branchId" label="Branch" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={branches.map((b) => ({ label: b.name, value: b.id }))} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function AssignEmployeeDrawer({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const { data: employees = [] } = useQuery({ queryKey: ['dept-assignable', id], queryFn: () => api(`/hr/departments/${id}/assignable-employees`) });
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try { await api(`/hr/departments/${id}/assign-employee`, { method: 'POST', body: JSON.stringify({ employeeId: v.employeeId, position: v.position, effectiveDate: v.effectiveDate?.format('YYYY-MM-DD'), reason: v.reason }) }); message.success('Employee assigned'); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={460} title="Assign employee to department"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Assign</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ effectiveDate: dayjs() }}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(employees as any[]).map((e) => ({ label: `${e.name} (${e.employeeNo})${e.currentDepartment ? ` · ${e.currentDepartment}` : ''}`, value: e.id }))} /></Form.Item>
        <Form.Item name="position" label="Position"><Input placeholder="Optional job title" /></Form.Item>
        <Form.Item name="effectiveDate" label="Effective Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
        <Form.Item name="reason" label="Reason"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function EmployeeMiniDrawer({ employeeId, departmentName, onClose }: { employeeId: string; departmentName?: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['emp-360', employeeId], queryFn: () => api(`/hr/employees/${employeeId}/360`) });
  const e = data?.employee; const s = data?.summary;
  return (
    <Drawer open onClose={onClose} width="min(680px, 95vw)" title={e ? `${e.preferredName || `${e.firstName} ${e.lastName}`}` : 'Employee'}
      extra={<Link href={`/hr/employees/${employeeId}`}><Button size="small">Open Full Profile</Button></Link>}>
      <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={onClose} className="!px-0 mb-3">Back to {departmentName || 'Department'} Employees</Button>
      {isLoading || !e ? <Skeleton active /> : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-[16px] font-bold" style={{ background: '#003366' }}>{(e.firstName || '?').charAt(0)}{(e.lastName || '').charAt(0)}</div>
            <div><div className="text-[15px] font-bold text-[#171a2e]">{e.preferredName || `${e.firstName} ${e.lastName}`}</div><div className="text-[12px] text-[#64748b]">{e.employeeNo} · {e.position || '—'} · {e.department?.name || '—'}</div><StatusPill status={e.employmentStatus || e.status} /></div>
          </div>
          <div className="nex-card border rounded-lg p-4">
            <DetailItem label="Work email" value={e.workEmail || e.email} />
            <DetailItem label="Mobile" value={e.mobile || e.phone} />
            <DetailItem label="Manager" value={e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : '—'} />
            <DetailItem label="Branch" value={e.department?.branch?.name} />
            <DetailItem label="Employment type" value={(e.contractType || '').replace(/_/g, ' ')} />
            <DetailItem label="Hire date" value={fmtDate(e.hireDate)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Leave available" value={`${fmtNumber(s?.leave?.available, 1)}d`} />
            <Stat label="Performance" value={s?.performance?.score != null ? `${fmtNumber(s.performance.score, 1)}%` : '—'} />
            <Stat label="Basic salary" value={s?.payroll?.basicSalary != null ? `${e.currency} ${fmtNumber(s.payroll.basicSalary, 0)}` : '—'} />
          </div>
        </div>
      )}
    </Drawer>
  );
}
