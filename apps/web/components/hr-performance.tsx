'use client';
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Alert, Button, Col, Drawer, Form, Input, Row, Select, Skeleton, Space, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, RiseOutlined, SendOutlined, SolutionOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill, DetailItem, EmptyState } from '@/components/sales-ui';
import { ReviewDrawer } from '@/components/performance/review-drawer';
import { CycleDrawer } from '@/components/performance/cycle-drawer';
import { fmtDate, fmtNumber } from '@/lib/format';

type Mode = 'EMPLOYEE' | 'MANAGER' | 'QA' | 'VIEW' | 'HR_EMPLOYEE';
const reviewModeFor = (a: any): Mode => {
  if (['APPROVED', 'COMPLETED', 'LOCKED'].includes(a.status)) return 'VIEW';
  if (a.status === 'PENDING_MANAGER') return 'MANAGER';
  if (a.status === 'PENDING_QA' || a.status === 'PENDING_CALIBRATION') return 'QA';
  return 'VIEW';
};
const bucketOf = (a: any) => {
  if (['APPROVED', 'COMPLETED', 'LOCKED'].includes(a.status)) return 'FINALISED';
  if (a.qaSubmittedAt || a.status === 'PENDING_APPROVAL' || a.status === 'PENDING_CALIBRATION') return 'QA_PENDING';
  if (a.managerSubmittedAt) return 'MANAGER_REVIEWED';
  if (a.employeeSubmittedAt) return 'SUBMITTED';
  return 'NOT_STARTED';
};
const money = (v: any) => `$${fmtNumber(v, 2)}`;

function Card({ label, value, color, onClick }: { label: string; value: React.ReactNode; color?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="nex-card border rounded-lg p-4 text-center hover:border-[#c7d2fe] transition">
      <div className="text-[12px] font-semibold text-[#64748b]">{label}</div>
      <div className="text-[20px] font-bold" style={{ color: color || '#171a2e' }}>{value}</div>
    </button>
  );
}

export function HrPerformance() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [cycleId, setCycleId] = useState<string | undefined>();
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [review, setReview] = useState<{ id: string; mode: Mode } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [startQaOpen, setStartQaOpen] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [incentive, setIncentive] = useState<any>(null);

  const cycles = useQuery({ queryKey: ['/performance/cycles'], queryFn: () => api('/performance/cycles') });
  const departments = useQuery({ queryKey: ['/hr/departments'], queryFn: () => api('/hr/departments') });
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });
  const activeCycle = cycles.data?.find((c: any) => ['OPEN', 'EMPLOYEE_SUBMISSION', 'MANAGER_REVIEW', 'QA_REVIEW', 'CALIBRATION', 'APPROVAL'].includes(c.status));
  const effectiveCycle = cycleId ?? activeCycle?.id ?? cycles.data?.[0]?.id;
  const assessments = useQuery({ queryKey: ['/performance/assessments', effectiveCycle], queryFn: () => api(`/performance/assessments${effectiveCycle ? `?cycleId=${effectiveCycle}` : ''}`), placeholderData: keepPreviousData });
  const incentives = useQuery({ queryKey: ['/performance/incentives', effectiveCycle], queryFn: () => api(`/performance/incentives${effectiveCycle ? `?cycleId=${effectiveCycle}` : ''}`), placeholderData: keepPreviousData });

  const deptMap = new Map((departments.data || []).map((d: any) => [d.id, d]));
  const empMap = new Map((employees.data || []).map((e: any) => [e.id, e]));
  const refresh = () => { ['/performance/assessments', '/performance/incentives', '/performance/cycles'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };

  const all = assessments.data || [];
  const rows = all.filter((a: any) => (!departmentId || a.departmentId === departmentId) && (!statusFilter || bucketOf(a) === statusFilter));
  const counts = useMemo(() => {
    const scoped = all.filter((a: any) => !departmentId || a.departmentId === departmentId);
    const withScore = scoped.filter((a: any) => a.totalScore != null);
    const b = (k: string) => scoped.filter((a: any) => bucketOf(a) === k).length;
    return {
      due: scoped.length, submitted: scoped.filter((a: any) => a.employeeSubmittedAt).length,
      qaPending: scoped.filter((a: any) => a.managerSubmittedAt && !a.qaSubmittedAt).length,
      avg: withScore.length ? Number((withScore.reduce((s: number, a: any) => s + Number(a.totalScore), 0) / withScore.length).toFixed(1)) : null,
      NOT_STARTED: b('NOT_STARTED'), IN_PROGRESS: scoped.filter((a: any) => a.employeeSubmittedAt && !a.managerSubmittedAt && a.status !== 'PENDING_EMPLOYEE').length,
      SUBMITTED: b('SUBMITTED'), MANAGER_REVIEWED: b('MANAGER_REVIEWED'), QA_PENDING: b('QA_PENDING'), FINALISED: b('FINALISED'),
    };
  }, [all, departmentId]);

  const cycleName = cycles.data?.find((c: any) => c.id === effectiveCycle)?.name;
  const qaRows = all.filter((a: any) => a.managerSubmittedAt && !a.excludedReason && (!departmentId || a.departmentId === departmentId));

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select style={{ width: 200 }} value={effectiveCycle} onChange={setCycleId} placeholder="Performance cycle"
          options={(cycles.data || []).map((c: any) => ({ label: `${c.name} (${c.status})`, value: c.id }))} />
        <Select allowClear style={{ width: 170 }} value={departmentId} onChange={setDepartmentId} placeholder="Department"
          options={(departments.data || []).map((d: any) => ({ label: d.name, value: d.id }))} />
        <Select allowClear style={{ width: 160 }} value={statusFilter} onChange={setStatusFilter} placeholder="Workflow status"
          options={['NOT_STARTED', 'SUBMITTED', 'MANAGER_REVIEWED', 'QA_PENDING', 'FINALISED'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        <div className="ml-auto"><Space>
          <Can permission={['performance.cycles.manage', 'hr.performance.manage']}><Button icon={<SolutionOutlined />} onClick={() => setCycleOpen(true)}>Manage Cycles</Button></Can>
          <Can permission={['performance.qa.review', 'hr.performance.manage']}><Button icon={<RiseOutlined />} onClick={() => setStartQaOpen(true)}>Start QA</Button></Can>
          <Can permission={['performance.cycles.manage', 'hr.performance.manage']}><Button type="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>New Review</Button></Can>
        </Space></div>
      </div>

      <Tabs className="nexus-section-tabs" activeKey={tab} onChange={setTab} items={[
        { key: 'overview', label: 'Overview', children: (
          <div className="space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card label="Employees Due" value={counts.due} onClick={() => { setStatusFilter(undefined); setTab('reviews'); }} />
              <Card label="Submitted" value={counts.submitted} color="#16a34a" onClick={() => { setStatusFilter('SUBMITTED'); setTab('reviews'); }} />
              <Card label="QA Pending" value={counts.qaPending} color="#b45309" onClick={() => setTab('quality')} />
              <Card label="Average Score" value={counts.avg != null ? `${fmtNumber(counts.avg, 1)}%` : '—'} onClick={() => setTab('reviews')} />
            </div>
            <div className="nex-card border rounded-lg p-4">
              <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Workflow summary · {cycleName || 'No cycle'}</div>
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                {[['NOT_STARTED', 'Not Started'], ['IN_PROGRESS', 'In Progress'], ['SUBMITTED', 'Submitted'], ['MANAGER_REVIEWED', 'Manager Reviewed'], ['QA_PENDING', 'QA Pending'], ['FINALISED', 'Finalised']].map(([k, label]) => (
                  <button key={k} onClick={() => { setStatusFilter(k); setTab('reviews'); }} className="text-center py-2 rounded-lg hover:bg-[#f7f8fc]">
                    <div className="text-[12px] text-[#64748b]">{label}</div>
                    <div className="text-[18px] font-bold text-[#171a2e]">{k === 'IN_PROGRESS' ? counts.IN_PROGRESS : (counts as any)[k] ?? 0}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 text-[13px]">
              <Link href="/performance?tab=templates" className="text-[#1d5fb5] hover:underline">Manage KPI Templates</Link>
              <Link href="/performance?tab=cycles" className="text-[#1d5fb5] hover:underline">Manage Performance Cycles</Link>
            </div>
          </div>
        ) },
        { key: 'reviews', label: 'Reviews', children: <ReviewsTable rows={rows} loading={assessments.isLoading} deptMap={deptMap} onView={(a: any, mode: any) => setReview({ id: a.id, mode })} onRemind={async (a: any) => { try { await api(`/performance/assessments/${a.id}/remind`, { method: 'POST' }); message.success('Reminder sent'); } catch (e: any) { message.error(e.message); } }} onNew={() => setNewOpen(true)} /> },
        { key: 'quality', label: 'Quality Assurance', children: <QaTable rows={qaRows} loading={assessments.isLoading} deptMap={deptMap} onView={(a: any) => setReview({ id: a.id, mode: 'QA' })} /> },
        { key: 'incentives', label: 'Incentives', children: <IncentivesTable rows={incentives.data || []} loading={incentives.isLoading} onView={setIncentive} onChanged={refresh} /> },
      ]} />

      {review && <ReviewDrawer open assessmentId={review.id} mode={review.mode} onClose={() => { setReview(null); refresh(); }} />}
      {newOpen && <NewReviewDrawer cycles={cycles.data || []} departments={departments.data || []} employees={employees.data || []} defaultCycle={effectiveCycle} defaultDepartment={departmentId} onClose={() => setNewOpen(false)} onCreated={(id: any) => { setNewOpen(false); refresh(); setReview({ id, mode: 'VIEW' }); }} />}
      {startQaOpen && <StartQaDrawer rows={qaRows} deptMap={deptMap} onClose={() => setStartQaOpen(false)} onPick={(a: any) => { setStartQaOpen(false); setReview({ id: a.id, mode: 'QA' }); }} />}
      <CycleDrawer open={cycleOpen} cycleId={null} onClose={() => setCycleOpen(false)} onCreated={() => { setCycleOpen(false); refresh(); }} />
      {incentive && <IncentiveDrawer incentive={incentive} onClose={() => setIncentive(null)} onChanged={() => { setIncentive(null); refresh(); }} />}
    </div>
  );
}

// ======================================================================
function ReviewsTable({ rows, loading, deptMap, onView, onRemind, onNew }: any) {
  const cols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => <span className="text-[13px] font-medium text-[#171a2e]">{r.employee?.preferredName || `${r.employee?.firstName} ${r.employee?.lastName}`}</span>, sorter: (a: any, b: any) => `${a.employee?.firstName}`.localeCompare(`${b.employee?.firstName}`) },
    { title: 'Department', width: 150, render: (_v, r) => deptMap.get(r.departmentId)?.name || '—' },
    { title: 'Position', width: 140, render: (_v, r) => r.employee?.position || '—' },
    { title: 'Cycle', width: 130, render: (_v, r) => r.cycle?.name || 'No cycle assigned', sorter: (a: any, b: any) => `${a.cycle?.name || ''}`.localeCompare(`${b.cycle?.name || ''}`) },
    { title: 'Template', width: 160, render: (_v, r) => r.templateName || 'No template' },
    { title: 'Submission', width: 130, render: (_v, r) => r.employeeSubmittedAt ? <Tag color="green">SUBMITTED</Tag> : (r.employeeSubmissionOverdue ? <Tag color="red">OVERDUE</Tag> : <Tag color="orange">NOT SUBMITTED</Tag>) },
    { title: 'Manager Review', width: 140, render: (_v, r) => r.managerSubmittedAt ? <Tag color="green">COMPLETED</Tag> : <Tag color="orange">PENDING</Tag> },
    { title: 'QA', width: 110, render: (_v, r) => r.qaSubmittedAt ? <Tag color="green">COMPLETED</Tag> : <Tag>PENDING</Tag> },
    { title: 'Overall', dataIndex: 'totalScore', width: 90, align: 'right', render: (v) => v != null ? `${fmtNumber(v, 1)}%` : '—', sorter: (a: any, b: any) => Number(a.totalScore || 0) - Number(b.totalScore || 0) },
    { title: 'Result', dataIndex: 'result', width: 90, render: (v) => v ? <StatusPill status={v} /> : '—' },
    { title: 'Actions', width: 150, render: (_v, r) => <Space size={4}><Button size="small" onClick={() => onView(r, reviewModeFor(r))}>{['APPROVED', 'COMPLETED', 'LOCKED'].includes(r.status) ? 'View' : (r.status === 'PENDING_QA' || r.status === 'PENDING_CALIBRATION' ? 'Perform QA' : 'Open')}</Button>{!r.employeeSubmittedAt && <Can permission={['performance.cycles.manage', 'hr.performance.manage']}><Button size="small" icon={<SendOutlined />} onClick={() => onRemind(r)}>Remind</Button></Can>}</Space> },
  ];
  return <Table rowKey="id" size="small" loading={loading} dataSource={rows} columns={cols} pagination={{ pageSize: 12 }} scroll={{ x: 1400 }} locale={{ emptyText: <EmptyState title="No performance reviews found for this cycle." action={<Can permission={['performance.cycles.manage', 'hr.performance.manage']}><Button type="primary" onClick={onNew}>New Review</Button></Can>} /> }} />;
}

function QaTable({ rows, loading, deptMap, onView }: any) {
  const cols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => <span className="text-[13px] font-medium text-[#171a2e]">{r.employee?.firstName} {r.employee?.lastName}</span> },
    { title: 'Department', width: 150, render: (_v, r) => deptMap.get(r.departmentId)?.name || '—' },
    { title: 'Cycle', width: 130, render: (_v, r) => r.cycle?.name || 'No cycle assigned' },
    { title: 'Template', width: 160, render: (_v, r) => r.templateName || 'No template' },
    { title: 'Manager Score', dataIndex: 'totalScore', width: 120, align: 'right', render: (v) => v != null ? `${fmtNumber(v, 1)}%` : '—' },
    { title: 'QA Score', width: 100, align: 'right', render: (_v, r) => r.qaSubmittedAt && r.totalScore != null ? `${fmtNumber(r.totalScore, 1)}%` : '—' },
    { title: 'QA Status', width: 130, render: (_v, r) => r.qaSubmittedAt ? <Tag color="green">COMPLETED</Tag> : (r.qaReviews?.length ? <Tag color="blue">IN PROGRESS</Tag> : <Tag color="orange">PENDING</Tag>) },
    { title: 'Actions', width: 110, render: (_v, r) => <Button size="small" type={r.qaSubmittedAt ? 'default' : 'primary'} onClick={() => onView(r)}>{r.qaSubmittedAt ? 'View' : 'Perform QA'}</Button> },
  ];
  return <Table rowKey="id" size="small" loading={loading} dataSource={rows} columns={cols} pagination={{ pageSize: 12 }} scroll={{ x: 1200 }} locale={{ emptyText: <EmptyState title="No reviews are waiting for QA." /> }} />;
}

function IncentivesTable({ rows, loading, onView, onChanged }: any) {
  async function decide(inc: any, action: 'approve' | 'reject' | 'send') {
    try {
      if (action === 'approve') await api(`/performance/incentives/${inc.id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      else if (action === 'reject') { const reason = window.prompt('Rejection reason?') || 'Rejected'; await api(`/performance/incentives/${inc.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); }
      else await api(`/performance/incentives/${inc.id}/send-to-payroll`, { method: 'POST', body: JSON.stringify({}) });
      message.success('Incentive updated'); onChanged();
    } catch (e: any) { message.error(e.message); }
  }
  const cols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => <span className="text-[13px] font-medium text-[#171a2e]">{r.employee?.firstName} {r.employee?.lastName}</span> },
    { title: 'Department', width: 140, render: (_v, r) => r.employee?.department?.name || '—' },
    { title: 'Plan', width: 190, render: (_v, r) => r.planName || 'Manual incentive' },
    { title: 'Cycle', width: 120, render: (_v, r) => r.assessment?.cycle?.name || 'No cycle assigned' },
    { title: 'Score', dataIndex: 'finalScore', width: 80, align: 'right', render: (v) => v != null ? `${fmtNumber(v, 1)}%` : '—' },
    { title: 'Proposed', dataIndex: 'amount', width: 110, align: 'right', render: (v, r) => money(v) },
    { title: 'Approved', width: 110, align: 'right', render: (_v, r) => ['APPROVED', 'SENT_TO_PAYROLL', 'PAID'].includes(r.status) ? money(r.amount) : '—' },
    { title: 'Status', dataIndex: 'status', width: 140, render: (v) => <StatusPill status={v} /> },
    { title: 'Payroll', width: 140, render: (_v, r) => r.payrollInputRef || 'Not sent' },
    { title: 'Actions', width: 190, render: (_v, r) => (
      <Space size={4}>
        <Button size="small" onClick={() => onView(r)}>View</Button>
        {r.status === 'PENDING_APPROVAL' && <Can permission={['performance.incentives.approve', 'hr.performance.manage']}><Button size="small" type="primary" onClick={() => decide(r, 'approve')}>Approve</Button></Can>}
        {['PENDING_APPROVAL', 'APPROVED'].includes(r.status) && <Can permission={['performance.incentives.approve', 'hr.performance.manage']}><Button size="small" danger onClick={() => decide(r, 'reject')}>Reject</Button></Can>}
        {r.status === 'APPROVED' && <Can permission={['performance.incentives.approve', 'hr.performance.manage']}><Button size="small" onClick={() => decide(r, 'send')}>Send to Payroll</Button></Can>}
        {['SENT_TO_PAYROLL', 'PAID'].includes(r.status) && <Link href="/hr?tab=payroll"><Button size="small">Payroll</Button></Link>}
      </Space>
    ) },
  ];
  return <Table rowKey="id" size="small" loading={loading} dataSource={rows} columns={cols} pagination={{ pageSize: 12 }} scroll={{ x: 1400 }} locale={{ emptyText: <EmptyState title="No performance incentives found." /> }} />;
}

// ======================================================================
function NewReviewDrawer({ cycles, departments, employees, defaultCycle, defaultDepartment, onClose, onCreated }: any) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [deptId, setDeptId] = useState<string | undefined>(defaultDepartment);
  const [existing, setExisting] = useState<any>(null);
  const activeCycle = cycles.find((c: any) => ['OPEN', 'EMPLOYEE_SUBMISSION', 'MANAGER_REVIEW', 'QA_REVIEW', 'CALIBRATION', 'APPROVAL'].includes(c.status));
  const deptEmployees = employees.filter((e: any) => e.active && (!deptId || e.departmentId === deptId));
  async function submit() {
    const v = await form.validateFields(); setExisting(null); setSaving(true);
    try { const a = await api('/performance/assessments', { method: 'POST', body: JSON.stringify({ cycleId: v.cycleId, employeeId: v.employeeId, managerId: v.managerId }) }); message.success('Performance review created'); onCreated(a.id); }
    catch (e: any) {
      const m = e.message || '';
      if (m.toLowerCase().includes('already exists')) setExisting({ message: m });
      else message.error(m);
    } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={560} destroyOnHidden title="New Performance Review"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Create Review</Button></div>}>
      {existing && <Alert className="mb-3" type="warning" showIcon message="Review already exists" description={<>{existing.message} <a className="text-[#1d5fb5]">Open the existing review from the Reviews tab.</a></>} />}
      <Form form={form} layout="vertical" initialValues={{ cycleId: defaultCycle || activeCycle?.id, departmentId: defaultDepartment }}>
        <Form.Item name="cycleId" label="Performance Cycle" rules={[{ required: true }]}><Select options={cycles.map((c: any) => ({ label: `${c.name} (${c.status})`, value: c.id }))} /></Form.Item>
        <Form.Item name="departmentId" label="Department" rules={[{ required: true }]}>
          <Select options={departments.map((d: any) => ({ label: d.name, value: d.id }))} onChange={(v) => { setDeptId(v); form.setFieldValue('employeeId', undefined); form.setFieldValue('managerId', undefined); }} />
        </Form.Item>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" disabled={!deptId} placeholder={deptId ? 'Select employee' : 'Select a department first'}
            options={deptEmployees.map((e: any) => ({ label: `${e.firstName} ${e.lastName} · ${e.employeeNo}`, value: e.id }))}
            onChange={(v) => { const e = employees.find((x: any) => x.id === v); form.setFieldValue('managerId', e?.managerId || undefined); }} />
        </Form.Item>
        <Form.Item name="managerId" label="Reviewer / Manager" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" options={deptEmployees.map((e: any) => ({ label: `${e.firstName} ${e.lastName} · ${e.employeeNo}`, value: e.id }))} />
        </Form.Item>
        <div className="text-[12px] text-[#94a3b8]">The KPI template is resolved automatically from the employee's department (role-specific template preferred) and snapshotted into the review.</div>
      </Form>
    </Drawer>
  );
}

function StartQaDrawer({ rows, deptMap, onClose, onPick }: any) {
  const [dept, setDept] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const filtered = rows.filter((r: any) => (!dept || r.departmentId === dept) && (!search || `${r.employee?.firstName} ${r.employee?.lastName} ${r.employee?.employeeNo}`.toLowerCase().includes(search.toLowerCase())));
  return (
    <Drawer open onClose={onClose} width={640} title="Start Quality Assurance">
      <div className="text-[13px] text-[#64748b] mb-3">Only reviews with a completed manager review are eligible for QA.</div>
      <div className="flex gap-2 mb-3">
        <Input allowClear placeholder="Search employee..." style={{ width: 220 }} onChange={(e) => setSearch(e.target.value)} />
        <Select allowClear placeholder="Department" style={{ width: 180 }} value={dept} onChange={setDept} options={Array.from(new Map(rows.map((r: any) => [r.departmentId, deptMap.get(r.departmentId)?.name])).entries()).filter(([id]) => id).map(([id, name]) => ({ label: name, value: id }))} />
      </div>
      <Table rowKey="id" size="small" dataSource={filtered} pagination={{ pageSize: 8 }} columns={[
        { title: 'Employee', render: (_v, r) => `${r.employee?.firstName} ${r.employee?.lastName}` },
        { title: 'Department', render: (_v, r) => deptMap.get(r.departmentId)?.name || '—' },
        { title: 'Manager Score', dataIndex: 'totalScore', align: 'right', render: (v) => v != null ? `${fmtNumber(v, 1)}%` : '—' },
        { title: 'QA Status', render: (_v, r) => r.qaSubmittedAt ? <Tag color="green">COMPLETED</Tag> : <Tag color="orange">PENDING</Tag> },
        { title: 'Actions', width: 110, render: (_v, r) => <Button size="small" type="primary" onClick={() => onPick(r)}>Start QA</Button> },
      ] as ColumnsType<any>} locale={{ emptyText: <EmptyState title="No reviews are waiting for QA." /> }} />
    </Drawer>
  );
}

function IncentiveDrawer({ incentive, onClose, onChanged }: any) {
  const r = incentive;
  async function act(action: 'approve' | 'reject' | 'send') {
    try {
      if (action === 'approve') await api(`/performance/incentives/${r.id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      else if (action === 'reject') { const reason = window.prompt('Rejection reason?') || 'Rejected'; await api(`/performance/incentives/${r.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); }
      else await api(`/performance/incentives/${r.id}/send-to-payroll`, { method: 'POST', body: JSON.stringify({}) });
      message.success('Incentive updated'); onChanged();
    } catch (e: any) { message.error(e.message); }
  }
  return (
    <Drawer open onClose={onClose} width={560} title={`Incentive ${r.reference || ''}`}
      extra={<StatusPill status={r.status} />}
      footer={<div className="flex justify-end gap-2">
        {r.status === 'PENDING_APPROVAL' && <Can permission={['performance.incentives.approve', 'hr.performance.manage']}><Button type="primary" onClick={() => act('approve')}>Approve</Button></Can>}
        {['PENDING_APPROVAL', 'APPROVED'].includes(r.status) && <Can permission={['performance.incentives.approve', 'hr.performance.manage']}><Button danger onClick={() => act('reject')}>Reject</Button></Can>}
        {r.status === 'APPROVED' && <Can permission={['performance.incentives.approve', 'hr.performance.manage']}><Button type="primary" onClick={() => act('send')}>Send to Payroll</Button></Can>}
        <Button onClick={onClose}>Close</Button>
      </div>}>
      <Section title="Employee"><DetailItem label="Employee" value={`${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`} /><DetailItem label="Department" value={r.employee?.department?.name} /></Section>
      <Section title="Performance source"><DetailItem label="Cycle" value={r.assessment?.cycle?.name || 'No cycle assigned'} /><DetailItem label="Final score" value={r.finalScore != null ? `${fmtNumber(r.finalScore, 1)}%` : '—'} /><DetailItem label="Performance band" value={r.band} /></Section>
      <Section title="Plan & calculation"><DetailItem label="Incentive plan" value={r.planName || 'Manual incentive'} /><DetailItem label="Rule used" value={r.calculationType?.replace(/_/g, ' ')} /><DetailItem label="Proposed amount" value={money(r.amount)} /><DetailItem label="Approved amount" value={['APPROVED', 'SENT_TO_PAYROLL', 'PAID'].includes(r.status) ? money(r.amount) : '—'} /></Section>
      <Section title="Approval"><DetailItem label="Approved by" value={r.approvedById || '—'} /><DetailItem label="Approved at" value={r.approvedAt ? fmtDate(r.approvedAt) : '—'} /><DetailItem label="Rejection reason" value={r.rejectionReason} /></Section>
      <Section title="Payroll"><DetailItem label="Payroll run" value={r.payrollInputRef || 'Not sent'} /><DetailItem label="Paid at" value={r.paidAt ? fmtDate(r.paidAt) : '—'} /></Section>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="nex-card border rounded-lg overflow-hidden mb-3">
      <div className="px-4 py-2.5 bg-[#f7f8fc] text-[13px] font-semibold text-[#171a2e] border-b border-[#eef0f6]">{title}</div>
      <div className="p-2">{children}</div>
    </div>
  );
}
