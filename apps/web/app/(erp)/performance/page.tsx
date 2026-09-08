'use client';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Drawer, Dropdown, Input, InputNumber, MenuProps, Modal, Popconfirm, Progress, Select, Space, Table, Tabs, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BarChartOutlined, BugOutlined, CaretRightOutlined, CopyOutlined, DownOutlined, EditOutlined, ExportOutlined, EyeOutlined, FileDoneOutlined, PlusOutlined, ReloadOutlined, RocketOutlined, SendOutlined, StopOutlined, TeamOutlined, ThunderboltOutlined, CheckCircleOutlined, CloseOutlined } from '@ant-design/icons';
import Link from 'next/link';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { Can } from '@/components/Can';
import { SoftBadge } from '@/components/crud-page';
import { StatCard } from '@/components/stat-card';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { KpiTemplateDrawer, KpiTemplateDetailsDrawer } from '@/components/performance/kpi-template-drawer';
import { ReviewDrawer } from '@/components/performance/review-drawer';
import { CycleDrawer } from '@/components/performance/cycle-drawer';
import { IncentivePlanDrawer } from '@/components/performance/incentive-plan-drawer';

const TEMPLATE_STATUS_TONE: Record<string, string> = { DRAFT: 'grey', ACTIVE: 'green', INACTIVE: 'amber', ARCHIVED: 'purple' };
const SUB_TONE: Record<string, string> = { NOT_STARTED: 'grey', IN_PROGRESS: 'amber', SUBMITTED: 'green', OVERDUE: 'red' };
const ASSESS_STATUS_TONE: Record<string, string> = { PENDING_EMPLOYEE: 'amber', PENDING_MANAGER: 'amber', PENDING_QA: 'amber', PENDING_CALIBRATION: 'amber', PENDING_APPROVAL: 'blue', APPROVED: 'green', COMPLETED: 'green', LOCKED: 'purple' };
const INC_STATUS_TONE: Record<string, string> = { PENDING_APPROVAL: 'amber', APPROVED: 'green', REJECTED: 'red', SENT_TO_PAYROLL: 'blue', PAID: 'green' };

function deadlineTone(deadline: string | null | undefined, done: boolean, windowEnd?: string | null): { tone: string; label: string } | null {
  if (done || !deadline) return null;
  const days = dayjs(deadline).diff(dayjs(), 'day');
  if (days < 0) return { tone: 'red', label: `OVERDUE · ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}` };
  if (days <= 3) return { tone: 'amber', label: `DUE IN ${days} DAY${days === 1 ? '' : 'S'}` };
  return { tone: 'grey', label: `DUE ${fmtDate(deadline)}` };
}

export default function PerformancePage() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const meta = useMeta();
  const [tab, setTab] = useState(params.get('tab') || 'dashboard');
  const [tplDrawer, setTplDrawer] = useState(false);
  const [editingTpl, setEditingTpl] = useState<any>(null);
  const [tplDetailsId, setTplDetailsId] = useState<string | null>(params.get('departmentId'));
  const [cycleDrawer, setCycleDrawer] = useState(false);
  const [editingCycleId, setEditingCycleId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState<any>('VIEW');
  const [planDrawer, setPlanDrawer] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [fDept, setFDept] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fCycle, setFCycle] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [missingDept, setMissingDept] = useState<{ departmentId: string } | null>(null);

  const dash = useQuery({ queryKey: ['/performance/dashboard', fDept], queryFn: () => api(`/performance/dashboard${fDept ? `?departmentId=${fDept}` : ''}`) });
  const attention = useQuery({ queryKey: ['/performance/needs-attention'], queryFn: () => api('/performance/needs-attention') });
  const templates = useQuery({ queryKey: ['/performance/kpi-templates'], queryFn: () => api('/performance/kpi-templates') });
  const cycles = useQuery({ queryKey: ['/performance/cycles'], queryFn: () => api('/performance/cycles') });
  const assessments = useQuery({ queryKey: ['/performance/assessments', fCycle], queryFn: () => api(`/performance/assessments${fCycle ? `?cycleId=${fCycle}` : ''}`) });
  const incentives = useQuery({ queryKey: ['/performance/incentives'], queryFn: () => api('/performance/incentives') });
  const plans = useQuery({ queryKey: ['/performance/incentive-plans'], queryFn: () => api('/performance/incentive-plans') });
  const bands = useQuery({ queryKey: ['/performance/bands'], queryFn: () => api('/performance/bands') });
  const repDept = useQuery({ queryKey: ['perf-rep-dept', fCycle], queryFn: () => api(`/performance/reports/by-department${fCycle ? `?cycleId=${fCycle}` : ''}`), enabled: tab === 'reports' });
  const repKpi = useQuery({ queryKey: ['perf-rep-kpi', fCycle], queryFn: () => api(`/performance/reports/kpi-results${fCycle ? `?cycleId=${fCycle}` : ''}`), enabled: tab === 'reports' });
  const repBands = useQuery({ queryKey: ['perf-rep-bands', fCycle], queryFn: () => api(`/performance/reports/bands${fCycle ? `?cycleId=${fCycle}` : ''}`), enabled: tab === 'reports' });
  const repInc = useQuery({ queryKey: ['perf-rep-inc', fCycle], queryFn: () => api(`/performance/reports/incentives${fCycle ? `?cycleId=${fCycle}` : ''}`), enabled: tab === 'reports' });

  function refresh() {
    ['/performance/dashboard', '/performance/needs-attention', '/performance/kpi-templates', '/performance/cycles', '/performance/assessments', '/performance/incentives', '/performance/incentive-plans'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }

  const d = dash.data;
  const c = d?.counts || {};

  // ---------- Template actions ----------
  async function activateTpl(id: string) { try { await api(`/performance/kpi-templates/${id}/activate`, { method: 'POST' }); message.success('Template activated'); refresh(); } catch (e: any) { message.error(e.message); } }
  async function duplicateTpl(t: any) { try { const copy = await api(`/performance/kpi-templates/${t.id}/duplicate`, { method: 'POST', body: JSON.stringify({ name: `${t.name} (Copy)` }) }); message.success('Duplicated as DRAFT'); refresh(); setEditingTpl(copy); setTplDrawer(true); } catch (e: any) { message.error(e.message); } }

  // ---------- Templates table ----------
  const tplCols: ColumnsType<any> = [
    { title: 'Template', render: (_v, r) => <a className="text-[13px] font-medium text-[#1d5fb5]" onClick={() => setTplDetailsId(r.id)}>{r.name}</a> },
    { title: 'Department', render: (_v, r) => r.department?.name || '—' },
    { title: 'Job Role', width: 130, render: (_v, r) => r.jobRole || 'All Roles' },
    { title: 'KPIs', width: 70, align: 'right', render: (_v, r) => (r.versions?.find((v: any) => v.version === r.currentVersion)?.kpis?.length ?? '—') },
    { title: 'Total Weight', width: 95, align: 'right', render: (_v, r) => {
      const vs = r.versions?.find((v: any) => v.version === r.currentVersion);
      const total = (vs?.kpis || []).reduce((s: number, k: any) => s + Number(k.weight), 0);
      return <span className={Math.abs(total - 100) < 0.001 ? 'text-[#16a34a] font-semibold' : 'text-[#dc2626] font-semibold'}>{total}%</span>;
    } },
    { title: 'Pass Mark', width: 90, align: 'right', render: (_v, r) => `${Number(r.passMark)}%` },
    { title: 'Version', width: 70, render: (_v, r) => `v${r.currentVersion}` },
    { title: 'Status', width: 100, render: (_v, r) => <SoftBadge tone={TEMPLATE_STATUS_TONE[r.status]} dotless>{r.status}</SoftBadge> },
    { title: 'Last Updated', width: 110, render: (_v, r) => fmtDate(r.updatedAt) },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'view', label: 'View details', icon: <EyeOutlined />, onClick: () => setTplDetailsId(r.id) },
        { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: 'performance.templates.manage', onClick: () => { setEditingTpl(r); setTplDrawer(true); } },
        { key: 'dup', label: 'Duplicate template', icon: <CopyOutlined />, permission: 'performance.templates.manage', onClick: () => duplicateTpl(r) },
        { key: 'act', label: 'Activate', icon: <CaretRightOutlined />, hidden: r.status !== 'DRAFT', permission: 'performance.templates.manage', onClick: () => activateTpl(r.id) },
        { key: 'deact', label: 'Deactivate', icon: <StopOutlined />, hidden: r.status !== 'ACTIVE', permission: 'performance.templates.manage', onClick: async () => { try { await api(`/performance/kpi-templates/${r.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'INACTIVE' }) }); message.success('Deactivated'); refresh(); } catch (e: any) { message.error(e.message); } } },
        { key: 'arch', label: 'Archive', icon: <StopOutlined />, danger: true, hidden: r.status === 'ARCHIVED', permission: 'performance.templates.manage', onClick: async () => { try { await api(`/performance/kpi-templates/${r.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'ARCHIVED' }) }); message.success('Template archived — historical assessments preserved'); refresh(); } catch (e: any) { message.error(e.message); } } },
      ]} />
    ) },
  ];

  const filteredTemplates = useMemo(() => (templates.data || []).filter((t: any) => {
    if (fDept && t.departmentId !== fDept) return false;
    if (fStatus && t.status !== fStatus) return false;
    if (fSearch && !t.name.toLowerCase().includes(fSearch.toLowerCase())) return false;
    return true;
  }), [templates.data, fDept, fStatus, fSearch]);

  // ---------- Cycles table ----------
  const cycleCols: ColumnsType<any> = [
    { title: 'Cycle', render: (_v, r) => (<><a className="text-[13px] font-medium text-[#1d5fb5]" onClick={() => { setEditingCycleId(r.id); setCycleDrawer(true); }}>{r.name}</a><div className="text-[12px] text-[#94a3b8]">{r.cycleType.replace(/_/g, ' ')} · {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</div></>) },
    { title: 'Submission window', render: (_v, r) => <span className="text-[12px]">{fmtDate(r.submissionOpens)} → {fmtDate(r.employeeDeadline)}</span> },
    { title: 'Manager deadline', width: 120, render: (_v, r) => fmtDate(r.managerDeadline) },
    { title: 'QA deadline', width: 110, render: (_v, r) => fmtDate(r.qaDeadline) || '—' },
    { title: 'Approval', width: 110, render: (_v, r) => fmtDate(r.approvalDeadline) || '—' },
    { title: 'Assessments', width: 105, align: 'right', render: (_v, r) => r._count?.assessments ?? 0 },
    { title: 'Status', width: 130, render: (_v, r) => <SoftBadge tone={r.status === 'LOCKED' ? 'purple' : r.status === 'COMPLETED' ? 'green' : r.status === 'DRAFT' ? 'grey' : 'amber'} dotless>{r.status.replace(/_/g, ' ')}</SoftBadge> },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'open', label: 'Open', icon: <CaretRightOutlined />, hidden: !['DRAFT', 'SCHEDULED'].includes(r.status), permission: 'performance.cycles.manage', onClick: async () => { try { const res = await api(`/performance/cycles/${r.id}/open`, { method: 'POST' }); message.success(`${res.created} assessment(s) created${res.missing.length ? ` · ${res.missing.length} missing KPI template` : ''}`); refresh(); } catch (e: any) { message.error(e.message); } } },
        { key: 'manage', label: 'Manage', icon: <EditOutlined />, permission: 'performance.cycles.manage', onClick: () => { setEditingCycleId(r.id); setCycleDrawer(true); } },
      ]} />
    ) },
  ];

  // ---------- Assessments table ----------
  const asmtCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => (
      <><Link href={`/hr/employees/${r.employeeId}`} className="text-[13px] font-medium text-[#171a2e] hover:text-[#1d5fb5] hover:underline">{r.employee?.preferredName || `${r.employee?.firstName} ${r.employee?.lastName}`}</Link>
      <div className="text-[11px] text-[#94a3b8]">{r.employee?.employeeNo}</div></>
    ) },
    { title: 'Department', width: 120, render: (_v, r) => r.employee?.department?.name || '—' },
    { title: 'Job Role', width: 130, render: (_v, r) => r.employee?.position || '—' },
    { title: 'Cycle', width: 130, render: (_v, r) => r.cycle?.name },
    { title: 'Template', width: 130, render: (_v, r) => <span className="text-[12px]">{r.templateName} v{r.version?.version}</span> },
    { title: 'Employee Submission', width: 165, render: (_v, r) => {
      const o = deadlineTone(r.cycle?.employeeDeadline, !!r.employeeSubmittedAt);
      return r.excludedReason ? <SoftBadge tone="purple" dotless>EXCLUDED</SoftBadge> : r.employeeSubmittedAt ? <SoftBadge tone="green" dotless>SUBMITTED</SoftBadge> : o ? <Tooltip title={`Deadline ${fmtDate(r.cycle?.employeeDeadline)}`}><SoftBadge tone={o.tone} dotless>{o.label}</SoftBadge></Tooltip> : <SoftBadge tone="grey" dotless>NOT SUBMITTED</SoftBadge>;
    } },
    { title: 'Manager Review', width: 140, render: (_v, r) => {
      const o = r.employeeSubmittedAt ? deadlineTone(r.cycle?.managerDeadline, !!r.managerSubmittedAt) : null;
      return r.managerSubmittedAt ? <SoftBadge tone="green" dotless>SUBMITTED</SoftBadge> : o ? <SoftBadge tone={o.tone} dotless>{o.label}</SoftBadge> : <SoftBadge tone="grey" dotless>—</SoftBadge>;
    } },
    { title: 'QA', width: 110, render: (_v, r) => r.qaSubmittedAt ? <SoftBadge tone="green" dotless>SUBMITTED</SoftBadge> : r.managerSubmittedAt ? <SoftBadge tone="amber" dotless>PENDING</SoftBadge> : <SoftBadge tone="grey" dotless>—</SoftBadge> },
    { title: 'Score', width: 85, align: 'right', render: (_v, r) => r.totalScore != null ? <span className="font-bold text-[#171a2e]">{Number(r.totalScore).toFixed(1)}%</span> : '—' },
    { title: 'Result', width: 90, render: (_v, r) => r.result ? <SoftBadge tone={r.result === 'PASS' ? 'green' : 'red'} dotless>{r.result}</SoftBadge> : '—' },
    { title: 'Status', width: 150, render: (_v, r) => <SoftBadge tone={ASSESS_STATUS_TONE[r.status]} dotless>{r.status.replace(/_/g, ' ')}</SoftBadge> },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => { setReviewId(r.id); setReviewMode('VIEW'); } },
        { key: 'assess', label: 'Assess', icon: <FileDoneOutlined />, hidden: !(!r.employeeSubmittedAt && (modeOf(r) === 'EMPLOYEE')), onClick: () => { setReviewId(r.id); setReviewMode('EMPLOYEE'); } },
        { key: 'review', label: 'Review', icon: <FileDoneOutlined />, hidden: !(r.employeeSubmittedAt && !r.managerSubmittedAt && modeOf(r) === 'MANAGER'), onClick: () => { setReviewId(r.id); setReviewMode('MANAGER'); } },
        { key: 'remind', label: 'Send reminder', icon: <SendOutlined />, hidden: !!r.employeeSubmittedAt, permission: 'performance.cycles.manage', onClick: async () => { try { await api(`/performance/assessments/${r.id}/remind`, { method: 'POST' }); message.success('Reminder sent'); } catch (e: any) { message.error(e.message); } } },
      ]} />
    ) },
  ];

  function modeOf(r: any) {
    // For the demo/HR view: managers and QA reviewers get action buttons by permission (server enforces the real rule).
    return 'VIEW';
  }

  const filteredAssessments = useMemo(() => (assessments.data || []).filter((r: any) => {
    if (fDept && r.departmentId !== fDept) return false;
    if (fStatus && r.status !== fStatus) return false;
    if (fSearch && !`${r.employee?.firstName} ${r.employee?.lastName} ${r.employee?.employeeNo}`.toLowerCase().includes(fSearch.toLowerCase())) return false;
    return true;
  }), [assessments.data, fDept, fStatus, fSearch]);

  // ---------- Incentives table ----------
  const incCols: ColumnsType<any> = [
    { title: 'Reference', width: 120, render: (_v, r) => <span className="font-mono text-[12px] text-[#1d5fb5] font-semibold">{r.reference}</span> },
    { title: 'Employee', render: (_v, r) => `${r.employee?.firstName} ${r.employee?.lastName}` },
    { title: 'Cycle', render: (_v, r) => r.assessment?.cycle?.name },
    { title: 'Score', width: 80, align: 'right', render: (_v, r) => `${Number(r.finalScore).toFixed(1)}%` },
    { title: 'Band', width: 160, render: (_v, r) => r.band || '—' },
    { title: 'Plan', width: 150, render: (_v, r) => r.planName },
    { title: 'Proposed', width: 100, align: 'right', render: (_v, r) => <span className="font-bold">{fmtMoney(r.amount)}</span> },
    { title: 'Status', width: 150, render: (_v, r) => <SoftBadge tone={INC_STATUS_TONE[r.status]} dotless>{r.status.replace(/_/g, ' ')}</SoftBadge> },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'approve', label: 'Approve', icon: <CheckCircleOutlined />, hidden: r.status !== 'PENDING_APPROVAL', permission: 'performance.incentives.approve', onClick: async () => { try { await api(`/performance/incentives/${r.id}/approve`, { method: 'POST', body: JSON.stringify({}) }); message.success(`Incentive ${r.reference} approved — available to payroll`); refresh(); } catch (e: any) { message.error(e.message); } } },
        { key: 'reject', label: 'Reject', icon: <CloseOutlined />, danger: true, hidden: r.status !== 'PENDING_APPROVAL', permission: 'performance.incentives.approve', confirm: 'Reject this incentive proposal?', onClick: async () => { try { await api(`/performance/incentives/${r.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'Rejected by reviewer' }) }); refresh(); } catch (e: any) { message.error(e.message); } } },
      ]} />
    ) },
  ];

  // ---------- Plans table ----------
  const planCols: ColumnsType<any> = [
    { title: 'Plan', render: (_v, r) => <span className="font-medium text-[13px]">{r.name}</span> },
    { title: 'Score band', width: 130, render: (_v, r) => { const c2 = r.calculation || {}; return c2.minScore != null || c2.maxScore != null ? `${c2.minScore ?? 0}% – ${c2.maxScore ?? '∞'}%` : 'Any'; } },
    { title: 'Calculation', width: 170, render: (_v, r) => { const c2 = r.calculation || {}; return c2.calcType === 'PERCENT_SALARY' ? `${Number(c2.percentValue)}% of base salary` : c2.calcType === 'FIXED' ? `Fixed ${fmtMoney(c2.fixedAmount)}` : 'Custom amount'; } },
    { title: 'Max payout', width: 110, align: 'right', render: (_v, r) => r.maxPayout ? fmtMoney(r.maxPayout) : '—' },
    { title: 'Incentives', width: 90, align: 'right', render: (_v, r) => r._count?.performanceIncentives ?? 0 },
    { title: 'Status', width: 100, render: (_v, r) => <SoftBadge tone={r.status === 'ACTIVE' ? 'green' : 'grey'} dotless>{r.status}</SoftBadge> },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: 'performance.incentives.propose', onClick: () => { setEditingPlan(r); setPlanDrawer(true); } },
      ]} />
    ) },
  ];

  const qaQueue = useMemo(() => (assessments.data || []).filter((r: any) => r.managerSubmittedAt && !r.qaSubmittedAt && !r.excludedReason), [assessments.data]);

  const qaCols = [
    { title: 'Employee', render: (_v: any, r: any) => `${r.employee?.firstName} ${r.employee?.lastName}` },
    { title: 'Department', render: (_v: any, r: any) => r.employee?.department?.name || '—' },
    { title: 'Cycle', render: (_v: any, r: any) => r.cycle?.name },
    { title: 'Manager Review', width: 130, render: () => <SoftBadge tone="green" dotless>SUBMITTED</SoftBadge> },
    { title: 'QA', width: 130, render: (_v: any, r: any) => deadlineTone(r.cycle?.qaDeadline, false) ? <SoftBadge tone={deadlineTone(r.cycle?.qaDeadline, false)!.tone} dotless>{deadlineTone(r.cycle?.qaDeadline, false)!.label}</SoftBadge> : <SoftBadge tone="amber" dotless>AWAITING QA</SoftBadge> },
    { title: 'Score so far', width: 100, align: 'right', render: (_v: any, r: any) => r.totalScore != null ? `${Number(r.totalScore).toFixed(1)}%` : '—' },
    { ...ACTIONS_COL, render: (_v: any, r: any) => (
      <RowActionsMenu items={[
        { key: 'qa', label: 'QA Review', icon: <EyeOutlined />, permission: 'performance.qa.review', onClick: () => { setReviewId(r.id); setReviewMode('QA'); } },
      ]} />
    ) },
  ];

  const attentionItems = attention.data || [];

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-5">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Performance & Quality Assurance</h1><p className="text-[13px] text-[#64748b] mt-1">KPI templates, assessment cycles, QA reviews and incentives</p></div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
          <Can permission="performance.templates.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingTpl(null); setTplDrawer(true); }}>KPI Template</Button></Can>
        </Space>
      </div>

      <div className="nex-card mb-5">
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'dashboard', label: 'Dashboard', children: (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Select allowClear placeholder="All departments" style={{ width: 200 }} value={fDept || undefined} onChange={(v) => { setFDept(v || ''); qc.invalidateQueries({ queryKey: ['/performance/dashboard'] }); }} options={(meta.data?.departments || []).map((o: any) => ({ label: o.name, value: o.id }))} />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <StatCard icon={<ThunderboltOutlined />} label="Active Cycle" value={d?.activeCycle?.name || 'None'} hint={d?.activeCycle ? `${fmtDate(d.activeCycle.periodStart)} – ${fmtDate(d.activeCycle.periodEnd)}` : 'Create a cycle to begin'} />
                <StatCard icon={<TeamOutlined />} label="Employees Due" value={c.employeesDue ?? 0} hint="Eligible in active cycle" />
                <StatCard icon={<FileDoneOutlined />} label="Submitted" value={c.submitted ?? 0} hint={`${c.managerPending ?? 0} awaiting manager review`} />
                <StatCard icon={<BugOutlined />} label="Pending / Overdue" value={(c.missing ?? 0) + (c.overdueEmployees ?? 0) + (c.overdueManagers ?? 0)} hint={`${c.missing ?? 0} missing · ${c.overdueEmployees ?? 0} employee overdue`} />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatCard icon={<BarChartOutlined />} label="Average Score" value={c.avgScore != null ? `${Number(c.avgScore).toFixed(1)}%` : '—'} hint={`${c.approved ?? 0} approved results`} />
                <StatCard icon={<FileDoneOutlined />} label="Passed" value={c.passed ?? 0} hint={`${c.needsImprovement ?? 0} needs improvement`} />
                <StatCard icon={<BugOutlined />} label="Needs Improvement" value={c.needsImprovement ?? 0} hint="FAIL results" />
                <StatCard icon={<RocketOutlined />} label="Approved Incentives" value={c.approvedIncentives ?? 0} hint={`${c.pendingIncentives ?? 0} awaiting approval`} />
              </div>

              {d?.window && (
                <div className="rounded-lg border border-[#e6e9f2] bg-[#f8fafc] px-4 py-3 mb-6 flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold text-[#171a2e]">Active window: {d.window.label || d.window.stage.replace(/_/g, ' ')}</div>
                    <div className="text-[12px] text-[#64748b]">{d.window.closes ? `Closes ${fmtDate(d.window.closes)}` : ''}</div>
                  </div>
                  <div className={`text-[14px] font-bold ${d.window.daysLeft != null && d.window.daysLeft < 0 ? 'text-[#dc2626]' : d.window.daysLeft != null && d.window.daysLeft <= 3 ? 'text-[#b45309]' : 'text-[#16a34a]'}`}>
                    {d.window.daysLeft != null ? (d.window.daysLeft < 0 ? `overdue by ${Math.abs(d.window.daysLeft)} day${Math.abs(d.window.daysLeft) === 1 ? '' : 's'}` : `closes in ${d.window.daysLeft} day${d.window.daysLeft === 1 ? '' : 's'}`) : 'closed'}
                  </div>
                </div>
              )}

              <div className="text-[15px] font-bold text-[#171a2e] mb-3">Needs Attention</div>
              <div className="space-y-2">
                {attentionItems.map((item: any, i: number) => (
                  <a key={i} className="flex items-center justify-between rounded-lg border px-4 py-3 hover:shadow-sm transition-shadow cursor-pointer"
                    style={{ borderColor: item.severity === 'HIGH' ? '#fecaca' : '#fde68a', background: item.severity === 'HIGH' ? '#fef2f2' : '#fffbeb' }}
                    href={item.link}>
                    <span className="text-[13px]" style={{ color: item.severity === 'HIGH' ? '#b91c1c' : '#92400e' }}>{item.text}</span>
                    <span className="text-[12px] font-semibold">Open →</span>
                  </a>
                ))}
                {!attentionItems.length && <div className="text-[13px] text-[#94a3b8] py-3">Nothing needs attention — all submissions, reviews and approvals are on track.</div>}
              </div>

              {d?.activeCycle && (
                <div className="mt-6">
                  <div className="text-[15px] font-bold text-[#171a2e] mb-3">Completion — {d.activeCycle.name}</div>
                  <div className="flex items-center gap-6">
                    <div className="text-center"><div className="text-[12px] text-[#64748b]">Submitted</div><div className="text-[22px] font-bold text-[#16a34a]">{c.submitted ?? 0} / {c.employeesDue ?? 0}</div></div>
                    <div className="text-center"><a className="text-center cursor-pointer" onClick={() => { setTab('assessments'); setFStatus(''); }}><div className="text-[12px] text-[#64748b]">Missing</div><div className="text-[22px] font-bold text-[#dc2626] underline">{c.missing ?? 0}</div></a></div>
                    <div className="flex-1 max-w-xs"><Progress percent={c.employeesDue ? Math.round(((c.submitted ?? 0) / c.employeesDue) * 100) : 0} /></div>
                  </div>
                </div>
              )}
            </div>
          ) },

          { key: 'templates', label: 'KPI Templates', children: (
            <div>
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <Input allowClear placeholder="Search templates..." value={fSearch} onChange={(e) => setFSearch(e.target.value)} style={{ width: 200 }} />
                <Select allowClear placeholder="Department" style={{ width: 170 }} value={fDept || undefined} onChange={(v) => setFDept(v || '')} options={(meta.data?.departments || []).map((o: any) => ({ label: o.name, value: o.id }))} />
                <Select allowClear placeholder="Status" style={{ width: 130 }} value={fStatus || undefined} onChange={(v) => setFStatus(v || '')} options={['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'].map((s) => ({ label: s, value: s }))} />
                <div className="ml-auto"><Can permission="performance.templates.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingTpl(null); setTplDrawer(true); }}>+ KPI Template</Button></Can></div>
              </div>
              <Table rowKey="id" loading={templates.isLoading} dataSource={filteredTemplates} columns={tplCols} pagination={{ pageSize: 10 }} />
            </div>
          ) },

          { key: 'cycles', label: 'Cycles', children: (
            <div>
              <div className="px-4 py-3 flex justify-between">
                <span className="text-[13px] text-[#64748b]">Every assessment belongs to a cycle with clear submission windows. Opening a cycle snapshots the resolved KPI template per employee — later template changes never alter the snapshot.</span>
                <Can permission="performance.cycles.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingCycleId(null); setCycleDrawer(true); }}>+ Performance Cycle</Button></Can>
              </div>
              <Table rowKey="id" loading={cycles.isLoading} dataSource={cycles.data || []} columns={cycleCols} pagination={false} />
            </div>
          ) },

          { key: 'assessments', label: 'Assessments', children: (
            <div>
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <Select allowClear placeholder="Cycle" style={{ width: 210 }} value={fCycle || undefined} onChange={(v) => setFCycle(v || '')} options={(cycles.data || []).map((o: any) => ({ label: o.name, value: o.id }))} />
                <Select allowClear placeholder="Department" style={{ width: 160 }} value={fDept || undefined} onChange={(v) => setFDept(v || '')} options={(meta.data?.departments || []).map((o: any) => ({ label: o.name, value: o.id }))} />
                <Select allowClear placeholder="Status" style={{ width: 170 }} value={fStatus || undefined} onChange={(v) => setFStatus(v || '')} options={Object.keys(ASSESS_STATUS_TONE).map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
                <Input allowClear placeholder="Search employee..." value={fSearch} onChange={(e) => setFSearch(e.target.value)} style={{ width: 190 }} />
              </div>
              <Table rowKey="id" loading={assessments.isLoading} dataSource={filteredAssessments} columns={asmtCols} pagination={{ pageSize: 12 }} scroll={{ x: 1400 }} />
            </div>
          ) },

          { key: 'qa', label: 'Quality Assurance', children: (
            <div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-[13px] text-[#64748b]">QA reviewers verify evidence, system metrics and manager ratings. Score adjustments require a reason and are audited.</span>
              </div>
              <Table rowKey="id" loading={assessments.isLoading} dataSource={qaQueue} pagination={{ pageSize: 12 }} columns={qaCols as ColumnsType<any>} />
            </div>
          ) },

          { key: 'incentives', label: 'Incentives', children: (
            <div>
              <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-2">
                  <Select allowClear placeholder="Status" style={{ width: 180 }} value={undefined} onChange={() => {}} options={['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT_TO_PAYROLL'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
                </div>
                <Space>
                  <Can permission="performance.incentives.view">
                    <Button onClick={async () => { const active = (cycles.data || []).find((x: any) => ['OPEN', 'APPROVAL', 'COMPLETED'].includes(x.status)); if (!active) { message.error('Open or complete a cycle first'); return; } try { const r = await api(`/performance/cycles/${active.id}/run-incentive-eligibility`, { method: 'POST' }); message.success(`${r.proposed} proposal(s) created from ${active.name}`); refresh(); } catch (e: any) { message.error(e.message); } }} icon={<RocketOutlined />}>Run eligibility (active cycle)</Button>
                  </Can>
                  <Can permission="performance.incentives.propose"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingPlan(null); setPlanDrawer(true); }}>+ Incentive Plan</Button></Can>
                </Space>
              </div>
              <div className="px-4 pb-2 text-[15px] font-bold text-[#171a2e]">Proposals</div>
              <Table rowKey="id" loading={incentives.isLoading} dataSource={incentives.data || []} columns={incCols} pagination={{ pageSize: 10 }} />
              <div className="px-4 pt-4 pb-2 text-[15px] font-bold text-[#171a2e]">Plans</div>
              <Table rowKey="id" loading={plans.isLoading} dataSource={plans.data || []} columns={planCols} pagination={false} />
            </div>
          ) },

          { key: 'reports', label: 'Reports', children: (
            <div className="p-4 space-y-6">
              <div className="flex items-center gap-2">
                <Select allowClear placeholder="All cycles" style={{ width: 220 }} value={fCycle || undefined} onChange={(v) => setFCycle(v || '')} options={(cycles.data || []).map((o: any) => ({ label: o.name, value: o.id }))} />
                <Button icon={<ExportOutlined />} onClick={() => window.print()}>Print / Export</Button>
              </div>
              <div>
                <div className="text-[15px] font-bold text-[#171a2e] mb-2">Performance by Department</div>
                <Table rowKey="department" size="small" dataSource={repDept.data || []} pagination={false} columns={[
                  { title: 'Department', dataIndex: 'department' }, { title: 'Approved', width: 90, align: 'right', dataIndex: 'approved' },
                  { title: 'Average Score', width: 120, align: 'right', render: (_v: any, r: any) => r.averageScore != null ? `${r.averageScore}%` : '—' },
                  { title: 'Pass Rate', width: 100, align: 'right', render: (_v: any, r: any) => r.passRate != null ? `${r.passRate}%` : '—' },
                ] as ColumnsType<any>} />
              </div>
              <div>
                <div className="text-[15px] font-bold text-[#171a2e] mb-2">Performance Bands</div>
                <Table rowKey={(r: any) => `${r.band}-${r.result}`} size="small" dataSource={repBands.data || []} pagination={false} columns={[
                  { title: 'Band', dataIndex: 'band' }, { title: 'Result', dataIndex: 'result', render: (v: any) => v ? <SoftBadge tone={v === 'PASS' ? 'green' : 'red'} dotless>{v}</SoftBadge> : '—' }, { title: 'Employees', width: 110, align: 'right', dataIndex: 'count' },
                ] as ColumnsType<any>} />
              </div>
              <div>
                <div className="text-[15px] font-bold text-[#171a2e] mb-2">KPI Results</div>
                <Table rowKey="kpi" size="small" dataSource={repKpi.data || []} pagination={false} columns={[
                  { title: 'KPI', dataIndex: 'kpi' }, { title: 'Employees', width: 100, align: 'right', dataIndex: 'employees' },
                  { title: 'Average Achievement', width: 160, align: 'right', render: (_v: any, r: any) => r.averageAchievement != null ? `${r.averageAchievement}%` : '—' },
                  { title: 'At/Above Target', width: 130, align: 'right', render: (_v: any, r: any) => r.atOrAboveTarget != null ? `${r.atOrAboveTarget}%` : '—' },
                ] as ColumnsType<any>} />
              </div>
              <div>
                <div className="text-[15px] font-bold text-[#171a2e] mb-2">Incentives</div>
                <Table rowKey="reference" size="small" dataSource={repInc.data || []} pagination={false} columns={[
                  { title: 'Reference', dataIndex: 'reference' }, { title: 'Employee', dataIndex: 'employee' }, { title: 'Cycle', dataIndex: 'cycle' },
                  { title: 'Score', width: 80, align: 'right', render: (_v: any, r: any) => `${Number(r.score).toFixed(1)}%` },
                  { title: 'Plan', dataIndex: 'plan' }, { title: 'Amount', width: 100, align: 'right', render: (_v: any, r: any) => fmtMoney(r.amount) },
                  { title: 'Status', width: 140, render: (_v: any, r: any) => <SoftBadge tone={INC_STATUS_TONE[r.status]} dotless>{r.status.replace(/_/g, ' ')}</SoftBadge> },
                ] as ColumnsType<any>} />
              </div>
            </div>
          ) },
        ]} />
      </div>

      {/* Drawers */}
      <KpiTemplateDrawer open={tplDrawer} onClose={() => setTplDrawer(false)} editing={editingTpl} defaultDepartmentId={missingDept?.departmentId} />
      <KpiTemplateDetailsDrawer open={!!tplDetailsId} onClose={() => setTplDetailsId(null)} template={tplDetailsId ? { id: tplDetailsId } : null} onEdit={(t: any) => { setEditingTpl(t); setTplDrawer(true); setTplDetailsId(null); }} />
      <CycleDrawer open={cycleDrawer} onClose={() => setCycleDrawer(false)} cycleId={editingCycleId} onCreated={() => refresh()} />
      <ReviewDrawer open={!!reviewId} onClose={() => setReviewId(null)} assessmentId={reviewId} mode={reviewMode} />
      <IncentivePlanDrawer open={planDrawer} onClose={() => setPlanDrawer(false)} editing={editingPlan} />
    </div>
  );
}
