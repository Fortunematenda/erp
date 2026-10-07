'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient, keepPreviousData, useIsFetching } from '@tanstack/react-query';
import { Button, Calendar, DatePicker, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, TeamOutlined, FileDoneOutlined, WalletOutlined, CheckCircleOutlined, CloseOutlined, EditOutlined, EyeOutlined, PrinterOutlined, BarChartOutlined, StopOutlined } from '@ant-design/icons';
import Link from 'next/link';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { Can } from '@/components/Can';
import { StatusPill } from '@/components/sales-ui';
import { StatCard } from '@/components/stat-card';
import { EmployeeSelector } from '@/components/employee-selector';
import { EmployeeDrawer } from '@/components/employee-drawer';
import { DepartmentDrawer, type DepartmentView } from '@/components/department-drawer';
import { LeaveManagement } from '@/components/leave-management';
import { AttendanceManagement } from '@/components/attendance-management';
import { HrPerformance } from '@/components/hr-performance';
import { PayrollManagement } from '@/components/payroll-management';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';
import { PageHeader } from '@/components/ui/page-header';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (p: number) => (p >= 1 && p <= 12 ? MONTHS[p - 1] : `Period ${p}`);
const EMPLOYMENT_TYPES = ['PERMANENT', 'FIXED_TERM', 'PART_TIME', 'TEMPORARY', 'CONTRACTOR', 'INTERN'];
const LEAVE_TYPE_OPTIONS = ['ANNUAL', 'SICK', 'STUDY', 'UNPAID', 'MATERNITY', 'PATERNITY', 'FAMILY', 'COMPASSIONATE', 'OTHER'];
const PAYROLL_STATUS_TONE: Record<string, string> = { DRAFT: 'grey', CALCULATED: 'blue', UNDER_REVIEW: 'orange', APPROVED: 'green', POSTED: 'blue', PAID: 'green', LOCKED: 'grey', CANCELLED: 'grey' };
const PAYMENT_STATUS_TONE: Record<string, string> = { UNPAID: 'grey', PARTIALLY_PAID: 'orange', PAID: 'green' };

export default function Hr() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const router = useRouter();
  const fetching = useIsFetching();
  const dash = useQuery({ queryKey: ['/hr/dashboard'], queryFn: () => api('/hr/dashboard'), placeholderData: keepPreviousData });
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees'), placeholderData: keepPreviousData });
  const departments = useQuery({ queryKey: ['/hr/departments'], queryFn: () => api('/hr/departments'), placeholderData: keepPreviousData });
  const leaveRequests = useQuery({ queryKey: ['/hr/leave-requests'], queryFn: () => api('/hr/leave-requests'), placeholderData: keepPreviousData });
  const leaveBalances = useQuery({ queryKey: ['/hr/leave-balances'], queryFn: () => api('/hr/leave-balances'), placeholderData: keepPreviousData });
  const leaveTypes = useQuery({ queryKey: ['/hr/leave-types'], queryFn: () => api('/hr/leave-types'), placeholderData: keepPreviousData });
  const holidays = useQuery({ queryKey: ['/hr/holidays'], queryFn: () => api('/hr/holidays'), placeholderData: keepPreviousData });
  const attendance = useQuery({ queryKey: ['/hr/attendance'], queryFn: () => api('/hr/attendance'), placeholderData: keepPreviousData });
  const attSummary = useQuery({ queryKey: ['/hr/attendance/summary'], queryFn: () => api('/hr/attendance/summary'), placeholderData: keepPreviousData });
  const attExceptions = useQuery({ queryKey: ['/hr/attendance/exceptions'], queryFn: () => api('/hr/attendance/exceptions'), placeholderData: keepPreviousData });
  const payrollRuns = useQuery({ queryKey: ['/hr/payroll-runs'], queryFn: () => api('/hr/payroll-runs'), placeholderData: keepPreviousData });
  const payslipsQ = useQuery({ queryKey: ['/hr/payslips'], queryFn: () => api('/hr/payslips'), placeholderData: keepPreviousData });
  const perfReviews = useQuery({ queryKey: ['/hr/performance-reviews'], queryFn: () => api('/hr/performance-reviews') });
  const qaAssessments = useQuery({ queryKey: ['/hr/qa-assessments'], queryFn: () => api('/hr/qa-assessments') });
  const incentives = useQuery({ queryKey: ['/hr/employee-incentives'], queryFn: () => api('/hr/employee-incentives') });

  const [tab, setTab] = useState(params.get('tab') || 'employees');
  const [empDrawer, setEmpDrawer] = useState(false);
  const [editingEmp, setEditingEmp] = useState<any>(null);
  const [leaveTab, setLeaveTab] = useState('requests');
  const [calMonth, setCalMonth] = useState(dayjs());
  const [fDepart, setFDepart] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fType, setFType] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<any>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [previewPay, setPreviewPay] = useState<any>(null);
  const [deptDrawer, setDeptDrawer] = useState<{ id: string; view: DepartmentView; sub?: string } | null>(null);
  const [leaveForm] = Form.useForm();
  const [deptForm] = Form.useForm();
  const [holidayForm] = Form.useForm();
  const [payrollForm] = Form.useForm();

  const d = dash.data || {};
  const meta = useMeta();

  // Deep links (e.g. from the Departments tab actions) preselect the employee department filter.
  useEffect(() => {
    const dept = params.get('departmentId');
    if (dept) setFDepart(dept);
  }, [params]);

  // Deep link a specific payslip (e.g. from the Employee 360 Payroll tab): /hr?tab=payslips&payslip=<id>
  useEffect(() => {
    const pid = params.get('payslip');
    if (!pid) return;
    setTab('payslips');
    const list = payslipsQ.data || [];
    const found = list.find((p: any) => p.id === pid);
    if (found) setPreviewPay(found);
  }, [params, payslipsQ.data]);

  function refresh() {
    ['/hr/employees', '/hr/departments', '/hr/leave-requests', '/hr/leave-balances', '/hr/leave-types', '/hr/holidays', '/hr/attendance', '/hr/attendance/summary', '/hr/attendance/exceptions', '/hr/payroll-runs', '/hr/payslips', '/hr/performance-reviews', '/hr/qa-assessments', '/hr/employee-incentives'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }

  // ---------- Employees ----------
  const filteredEmps = useMemo(() => (employees.data || []).filter((e: any) => {
    if (fDepart && e.departmentId !== fDepart) return false;
    if (fStatus && (e.status || e.employmentStatus) !== fStatus) return false;
    if (fType && e.contractType !== fType) return false;
    if (fSearch) { const q = fSearch.toLowerCase(); if (!`${e.firstName} ${e.lastName} ${e.email}`.toLowerCase().includes(q)) return false; }
    return true;
  }), [employees.data, fDepart, fStatus, fType, fSearch]);

  const empCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => (
      <Link href={`/hr/employees/${r.id}`} className="flex items-center gap-2.5 group">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg,#003366,#1d5fb5)' }}>{(r.firstName || '?').charAt(0)}{(r.lastName || '').charAt(0)}</div>
        <div className="min-w-0"><div className="text-[13px] font-medium text-[#171a2e] group-hover:text-[#1d5fb5] group-hover:underline">{r.preferredName || `${r.firstName} ${r.lastName}`}</div><div className="text-[12px] text-[#94a3b8] truncate">{r.workEmail || r.email}</div></div>
      </Link>
    ) },
    { title: 'Employee #', dataIndex: 'employeeNo', width: 120, render: (v) => <span className="text-[12px] text-[#64748b]">{v}</span> },
    { title: 'Job Title', dataIndex: 'position', width: 150, render: (v) => v || '—' },
    { title: 'Department', width: 140, render: (_v, r) => r.department?.name || '—' },
    { title: 'Employment Type', dataIndex: 'contractType', width: 130, render: (v) => v?.replace(/_/g, ' ') || '—' },
    { title: 'Status', dataIndex: 'status', width: 100, render: (v, r) => <StatusPill status={v || r.employmentStatus} /> },
    { title: 'Start Date', dataIndex: 'hireDate', width: 110, render: (v) => <span className="text-[12px] text-[#64748b]">{fmtDate(v)}</span> },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => router.push(`/hr/employees/${r.id}`) },
      ]} />
    ) },
  ];

  const deptCols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 110 },
    { title: 'Department', dataIndex: 'name', render: (v, r) => <a className="text-[13px] font-medium text-[#171a2e] hover:text-[#1d5fb5] hover:underline" onClick={() => setDeptDrawer({ id: r.id, view: 'OVERVIEW' })}>{v}</a> },
    { title: 'Branch', render: (_v, r) => r.branch?.name || '—' },
    { title: 'Employees', width: 100, align: 'right', render: (_v, r) => (employees.data || []).filter((e: any) => e.departmentId === r.id).length },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: 'hr.employees.manage', onClick: () => setDeptDrawer({ id: r.id, view: 'OVERVIEW', sub: 'EDIT' }) },
        { key: 'employees', label: 'View Employees', icon: <TeamOutlined />, permission: 'hr.employees.view', onClick: () => setDeptDrawer({ id: r.id, view: 'EMPLOYEES' }) },
        { key: 'kpi', label: 'KPI Templates', icon: <BarChartOutlined />, permission: ['performance.templates.view', 'hr.employees.view'], onClick: () => setDeptDrawer({ id: r.id, view: 'KPI_TEMPLATES' }) },
        { key: 'perf', label: 'Performance', icon: <FileDoneOutlined />, permission: ['performance.cycles.view', 'hr.employees.view'], onClick: () => setDeptDrawer({ id: r.id, view: 'PERFORMANCE' }) },
      ]} />
    ) },
  ];

  const leaveCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => `${r.employee?.firstName} ${r.employee?.lastName}` },
    { title: 'Type', dataIndex: 'leaveType', width: 110 },
    { title: 'Start', dataIndex: 'startDate', width: 110, render: (v) => fmtDate(v) },
    { title: 'End', dataIndex: 'endDate', width: 110, render: (v) => fmtDate(v) },
    { title: 'Days', dataIndex: 'days', width: 80, align: 'right' },
    { title: 'Status', dataIndex: 'status', width: 120, render: (v) => <StatusPill status={v} /> },
    { ...ACTIONS_COL, render: (_v, r: any) => (
      <RowActionsMenu items={[
        { key: 'approve', label: 'Approve', icon: <CheckCircleOutlined />, hidden: !['PENDING', 'SUBMITTED', 'PENDING_APPROVAL'].includes(r.status), permission: 'hr.leave.approve', onClick: () => api(`/hr/leave-requests/${r.id}/approve`, { method: 'POST' }).then(() => { message.success('Approved'); refresh(); }).catch((e) => message.error(e.message)) },
        { key: 'reject', label: 'Reject', icon: <CloseOutlined />, danger: true, hidden: !['PENDING', 'SUBMITTED', 'PENDING_APPROVAL'].includes(r.status), permission: 'hr.leave.approve', onClick: () => api(`/hr/leave-requests/${r.id}/reject`, { method: 'POST' }).then(() => { message.success('Rejected'); refresh(); }).catch((e) => message.error(e.message)) },
      ]} />
    ) },
  ];

  const leaveTypesCols: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 110 },
    { title: 'Name', dataIndex: 'name' },
    { title: 'Days / Year', dataIndex: 'daysPerYear', width: 110, align: 'right' },
    { title: 'Max carry over', render: (_v, r) => r.policy ? Number(r.policy.maxCarryOver) : 0 },
    { title: 'Active', dataIndex: 'active', width: 90, render: (v) => <StatusPill status={v ? 'ACTIVE' : 'INACTIVE'} /> },
  ];

  const holidayCols: ColumnsType<any> = [
    { title: 'Holiday', dataIndex: 'name' },
    { title: 'Date', dataIndex: 'date', render: (v) => fmtDate(v) },
    { title: 'Branch', render: (_v, r) => r.branch?.name || 'All' },
    { title: 'Recurring', dataIndex: 'recurring', width: 110, render: (v) => (v ? 'Yes' : 'No') },
  ];

  const attCols: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'date', width: 120, render: (v) => fmtDate(v) },
    { title: 'Employee', render: (_v, r) => `${r.employee?.firstName} ${r.employee?.lastName}` },
    { title: 'In', dataIndex: 'checkIn', width: 80, render: (v) => (v ? dayjs(v).format('HH:mm') : '-') },
    { title: 'Out', dataIndex: 'checkOut', width: 80, render: (v) => (v ? dayjs(v).format('HH:mm') : '-') },
    { title: 'Worked', dataIndex: 'workedHours', width: 90, align: 'right', render: (v) => (v != null ? `${Number(v)}h` : '-') },
    { title: 'Regular', dataIndex: 'regularHours', width: 90, align: 'right', render: (v) => (v != null ? `${Number(v)}h` : '-') },
    { title: 'OT', dataIndex: 'overtimeHours', width: 80, align: 'right', render: (v) => (Number(v) > 0 ? <span className="text-[#e11d48] font-medium">{Number(v)}h</span> : '-') },
    { title: 'Late', dataIndex: 'lateMinutes', width: 80, align: 'right', render: (v) => (Number(v) > 0 ? <span className="text-[#b45309]">{Number(v)}m</span> : '-') },
    { title: 'Status', dataIndex: 'status', width: 100, render: (v) => <StatusPill status={v} /> },
    { title: 'Approved', dataIndex: 'approved', width: 100, render: (v, r) => r.approved ? <StatusPill status="APPROVED" /> : (Number(r.overtimeHours) > 0 ? <Can permission="hr.attendance.manage"><Button size="small" onClick={() => api(`/hr/attendance/${r.id}/approve`, { method: 'POST' }).then(() => { message.success('Approved'); refresh(); }).catch((e) => message.error(e.message))}>Approve OT</Button></Can> : <StatusPill status="PENDING" />) },
  ];

  const perfCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => `${r.employee?.firstName} ${r.employee?.lastName}` },
    { title: 'Cycle', render: (_v, r) => r.cycle?.name || '—' },
    { title: 'Overall', dataIndex: 'overallRating', width: 100, align: 'right', render: (v) => v ?? '—' },
    { title: 'Status', dataIndex: 'status', width: 150, render: (v) => <StatusPill status={v} /> },
  ];
  const qaCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => `${r.employee?.firstName} ${r.employee?.lastName}` },
    { title: 'Overall', dataIndex: 'overallScore', width: 100, align: 'right', render: (v) => (v != null ? `${v}%` : '—') },
    { title: 'Template', render: (_v, r) => r.template?.name || '—' },
    { title: 'Date', dataIndex: 'createdAt', width: 120, render: (v) => fmtDate(v) },
  ];
  const incCols: ColumnsType<any> = [
    { title: 'Employee', render: (_v, r) => `${r.employee?.firstName} ${r.employee?.lastName}` },
    { title: 'Plan', render: (_v, r) => r.plan?.name || '—' },
    { title: 'Period', dataIndex: 'period', width: 110 },
    { title: 'Amount', dataIndex: 'amount', width: 110, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Status', dataIndex: 'status', width: 130, render: (v) => <StatusPill status={v} /> },
    { ...ACTIONS_COL, render: (_v, r: any) => (
      <RowActionsMenu items={[
        { key: 'approve', label: 'Approve', icon: <CheckCircleOutlined />, hidden: !['PROPOSED', 'PENDING_APPROVAL'].includes(r.status), permission: 'hr.performance.manage', onClick: () => api(`/hr/employee-incentives/${r.id}/approve`, { method: 'POST' }).then(() => { message.success('Approved'); refresh(); }).catch((e) => message.error(e.message)) },
      ]} />
    ) },
  ];

  const payrollCols: ColumnsType<any> = [
    { title: 'Period', render: (_v, r) => <div><div className="font-medium text-[#171a2e]">{monthName(r.period)} {r.year}</div>{r.payDate && <div className="text-[11px] text-[#94a3b8]">Pay date {fmtDate(r.payDate)}</div>}</div> },
    { title: 'Employees', dataIndex: 'employeeCount', width: 100, align: 'right', render: (v, r) => v ?? r._count?.payslips ?? 0 },
    { title: 'Gross', dataIndex: 'totalGross', width: 110, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Deductions', dataIndex: 'totalDeductions', width: 110, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Net', dataIndex: 'totalNet', width: 110, align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Payroll Status', dataIndex: 'status', width: 120, render: (v) => <StatusPill status={v} tone={PAYROLL_STATUS_TONE[v]} /> },
    { title: 'Payment', dataIndex: 'paymentStatus', width: 120, render: (v) => <StatusPill status={v} tone={PAYMENT_STATUS_TONE[v]} /> },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'process', label: 'Process', icon: <FileDoneOutlined />, hidden: r.status !== 'DRAFT', permission: 'payroll.process', onClick: () => api(`/hr/payroll-runs/${r.id}/process`, { method: 'POST' }).then(() => { message.success('Processed'); refresh(); }).catch((e) => message.error(e.message)) },
        { key: 'lock', label: 'Lock', icon: <StopOutlined />, hidden: r.status !== 'PROCESSED', onClick: () => api(`/hr/payroll-runs/${r.id}/lock`, { method: 'POST' }).then(() => { message.success('Locked'); refresh(); }).catch((e) => message.error(e.message)) },
      ]} />
    ) },
  ];

  const payslipCols: ColumnsType<any> = [
    { title: 'Payslip', render: (_v, r) => `${r.employee?.firstName} ${r.employee?.lastName}` },
    { title: 'Period', render: (_v, r) => `${monthName(r.payrollRun?.period)} ${r.payrollRun?.year}` },
    { title: 'Gross', dataIndex: 'grossPay', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Deductions', render: (_v, r) => fmtMoney(Number(r.payeTax || 0) + Number(r.nssaDeduction || 0) + Number(r.otherDeductions || 0)) },
    { title: 'Net', dataIndex: 'netPay', align: 'right', render: (v) => fmtMoney(v) },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusPill status={v} /> },
    { ...ACTIONS_COL, render: (_v, r) => (
      <RowActionsMenu items={[
        { key: 'preview', label: 'Preview', icon: <EyeOutlined />, onClick: () => setPreviewPay(r) },
      ]} />
    ) },
  ];

  const allPayslips = payslipsQ.data || [];
  const calHolidays = (holidays.data || []).map((h: any) => dayjs(h.date).format('YYYY-MM-DD'));
  const calRequests = (leaveRequests.data || []).filter((l: any) => dayjs(l.startDate).isSame(calMonth, 'month'));

  // modal submit handlers
  async function submitLeave() { const v = await leaveForm.validateFields().catch(() => null); if (!v) return; try { await api('/hr/leave-requests', { method: 'POST', body: JSON.stringify({ employeeId: v.employeeId, leaveType: v.leaveType, startDate: v.startDate.format('YYYY-MM-DD'), endDate: v.endDate.format('YYYY-MM-DD'), halfDay: v.halfDay, reason: v.reason }) }); message.success('Leave requested — days auto-calculated'); setLeaveOpen(false); leaveForm.resetFields(); refresh(); } catch (e: any) { message.error(e.message); } }
  async function submitDept() {
    const v = await deptForm.validateFields().catch(() => null); if (!v) return;
    try {
      if (editingDept) await api(`/hr/departments/${editingDept.id}`, { method: 'PATCH', body: JSON.stringify({ name: v.name }) });
      else await api('/hr/departments', { method: 'POST', body: JSON.stringify(v) });
      message.success(editingDept ? 'Department updated' : 'Department created');
      setDeptOpen(false); setEditingDept(null); deptForm.resetFields(); refresh();
    } catch (e: any) { message.error(e.message); }
  }
  async function submitHoliday() { const v = await holidayForm.validateFields().catch(() => null); if (!v) return; try { await api('/hr/holidays', { method: 'POST', body: JSON.stringify({ name: v.name, date: v.date.format('YYYY-MM-DD'), recurring: v.recurring }) }); message.success('Holiday added'); setHolidayOpen(false); holidayForm.resetFields(); refresh(); } catch (e: any) { message.error(e.message); } }
  async function submitPayroll() { const v = await payrollForm.validateFields().catch(() => null); if (!v) return; try { await api('/hr/payroll-runs', { method: 'POST', body: JSON.stringify({ period: v.period, year: v.year }) }); message.success('Payroll run created'); setPayrollOpen(false); payrollForm.resetFields(); refresh(); } catch (e: any) { message.error(e.message); } }
  async function publishPayslip() { if (!previewPay) return; try { await api(`/hr/payslips/${previewPay.id}/publish`, { method: 'POST' }); message.success('Payslip published'); qc.invalidateQueries({ queryKey: ['/hr/payslips'] }); setPreviewPay((p: any) => ({ ...p, status: 'PUBLISHED' })); } catch (e: any) { message.error(e.message); } }

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-5">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">HR & Payroll</h1><p className="text-[13px] text-[#64748b] mt-1">Employees, leave, attendance, performance and payroll</p></div>
        <Space>
          <Link href="/performance"><Button type="primary" ghost>Performance & QA Module</Button></Link>
          <Button icon={<ReloadOutlined />} loading={fetching > 0} onClick={refresh}>Refresh</Button>
        </Space>
      </div>

      {tab === 'employees' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard icon={<TeamOutlined />} label="Active Employees" value={d.active ?? 0} hint="Active workforce" />
          <StatCard icon={<FileDoneOutlined />} label="Pending Leave" value={d.pendingLeave ?? 0} hint="Awaiting decision" />
          <StatCard icon={<WalletOutlined />} label="Current Payroll" value={d.currentPayroll ? `${monthName(d.currentPayroll.period)} ${d.currentPayroll.year}` : 'None'} hint="Latest run" />
          <StatCard icon={<CheckCircleOutlined />} label="Performance Reviews" value={d.reviewsDue ?? 0} hint="In progress" />
        </div>
      )}

      <div className="nex-card">
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'employees', label: 'Employees', children: (
            <div>
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <Input allowClear placeholder="Search employees..." value={fSearch} onChange={(e) => setFSearch(e.target.value)} style={{ width: 220 }} />
                <Select allowClear placeholder="Department" style={{ width: 160 }} value={fDepart || undefined} onChange={(v) => setFDepart(v || '')} options={(departments.data || []).map((o: any) => ({ label: o.name, value: o.id }))} />
                <Select allowClear placeholder="Employment type" style={{ width: 150 }} value={fType || undefined} onChange={(v) => setFType(v || '')} options={EMPLOYMENT_TYPES.map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} />
                <Select allowClear placeholder="Status" style={{ width: 130 }} value={fStatus || undefined} onChange={(v) => setFStatus(v || '')} options={['ACTIVE', 'PROBATION', 'ON_LEAVE', 'TERMINATED'].map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} />
                <div className="ml-auto"><Can permission="hr.employees.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingEmp(null); setEmpDrawer(true); }}>Employee</Button></Can></div>
              </div>
              <Table rowKey="id" loading={employees.isLoading} dataSource={filteredEmps} columns={empCols} pagination={{ pageSize: 12 }} />
            </div>
          ) },
          { key: 'departments', label: 'Departments', children: (
            <div><div className="px-4 py-3"><Can permission="hr.employees.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingDept(null); deptForm.resetFields(); setDeptOpen(true); }}>Department</Button></Can></div><Table rowKey="id" loading={departments.isLoading} dataSource={departments.data || []} columns={deptCols} pagination={false} /></div>
          ) },
          { key: 'leave', label: 'Leave', children: <LeaveManagement /> },
          { key: 'attendance', label: 'Attendance', children: <AttendanceManagement /> },
          { key: 'performance', label: 'Performance', children: <HrPerformance /> },
          { key: 'payroll', label: 'Payroll', children: <PayrollManagement /> },
          { key: 'payslips', label: 'Payslips', children: <div className="p-4"><Table rowKey="id" size="small" loading={payslipsQ.isLoading} dataSource={allPayslips} columns={payslipCols} pagination={false} /></div> },
        ]} />
      </div>

      <EmployeeDrawer open={empDrawer} onClose={() => setEmpDrawer(false)} onSaved={refresh} editing={editingEmp} />

      <DepartmentDrawer open={!!deptDrawer} departmentId={deptDrawer?.id || null} initialView={deptDrawer?.view} initialSub={deptDrawer?.sub} onClose={() => setDeptDrawer(null)} onChanged={refresh} />

      <Modal open={leaveOpen} title="New leave request" onCancel={() => setLeaveOpen(false)} onOk={submitLeave} okText="Submit request" destroyOnHidden>
        <Form form={leaveForm} layout="vertical" className="mt-2">
          <Form.Item label="Employee" name="employeeId" rules={[{ required: true }]}><EmployeeSelector /></Form.Item>
          <Form.Item label="Leave type" name="leaveType" initialValue="ANNUAL"><Select options={LEAVE_TYPE_OPTIONS.map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} /></Form.Item>
          <div className="grid grid-cols-2 gap-x-3">
            <Form.Item label="Start date" name="startDate" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="End date" name="endDate" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
          </div>
          <Form.Item label="Half day" name="halfDay" initialValue="FULL"><Select options={[{ label: 'Full day', value: 'FULL' }, { label: 'Morning half', value: 'MORNING' }, { label: 'Afternoon half', value: 'AFTERNOON' }]} /></Form.Item>
          <Form.Item label="Reason" name="reason"><Input.TextArea rows={2} /></Form.Item>
          <div className="text-[12px] text-[#64748b]">Leave days are calculated automatically from work calendar, excluding weekends and public holidays.</div>
        </Form>
      </Modal>

      <Modal open={deptOpen} title={editingDept ? `Edit department — ${editingDept.name}` : 'New department'} onCancel={() => { setDeptOpen(false); setEditingDept(null); }} onOk={submitDept} okText={editingDept ? 'Save' : 'Create'} destroyOnHidden>
        <Form form={deptForm} layout="vertical" className="mt-2">
          <Form.Item label="Branch" name="branchId" rules={[{ required: true }]}><Select allowClear placeholder="Select branch" disabled={!!editingDept} options={(meta.data?.branches || []).map((o: any) => ({ label: o.name, value: o.id }))} /></Form.Item>
          <Form.Item label="Code" name="code"><Input disabled={!!editingDept} /></Form.Item>
          <Form.Item label="Name" name="name" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal open={holidayOpen} title="Add holiday" onCancel={() => setHolidayOpen(false)} onOk={submitHoliday} okText="Add" destroyOnHidden>
        <Form form={holidayForm} layout="vertical" className="mt-2">
          <Form.Item label="Holiday name" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Date" name="date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
          <Form.Item label="Recurring yearly" name="recurring" valuePropName="checked"><input type="checkbox" className="accent-[#003366] mr-2" />Recurs every year</Form.Item>
        </Form>
      </Modal>

      <Modal open={payrollOpen} title="New payroll run" onCancel={() => setPayrollOpen(false)} onOk={submitPayroll} okText="Create" destroyOnHidden>
        <Form form={payrollForm} layout="vertical" className="mt-2">
          <Form.Item label="Payroll month" name="period" rules={[{ required: true }]}><Select options={MONTHS.map((m, i) => ({ label: m, value: i + 1 }))} /></Form.Item>
          <Form.Item label="Year" name="year" rules={[{ required: true }]} initialValue={new Date().getFullYear()}><InputNumber min={2000} max={2100} className="w-full" /></Form.Item>
        </Form>
      </Modal>

      <Drawer open={!!previewPay} onClose={() => setPreviewPay(null)} width={560} title="Payslip" destroyOnHidden
        extra={<Space size="small">{previewPay && previewPay.status !== 'VOID' && <Can permission="payroll.payslips.publish"><Button size="small" disabled={previewPay.status === 'PUBLISHED'} onClick={publishPayslip}>Publish</Button></Can>}<Button size="small" icon={<PrinterOutlined />} onClick={() => window.print()}>Print / PDF</Button><Button size="small" onClick={() => setPreviewPay(null)}>Close</Button></Space>}>
        {previewPay && (
          <div id="payslip-print">
            <div className="print-note no-print text-[12px] text-[#64748b] mb-3 bg-[#f8fafc] border border-[#e6e9f2] rounded px-3 py-2">Use your browser's Print dialog and choose "Save as PDF" to download this payslip.</div>
            <div className="border border-[#e6e9f2] rounded-lg overflow-hidden">
              <div className="px-5 py-4 bg-[#0b2a4a] text-white">
                <div className="text-[16px] font-bold">NexusERP</div>
                <div className="text-[12px] text-white/70">Payslip · {monthName(previewPay.payrollRun?.period)} {previewPay.payrollRun?.year}</div>
              </div>
              <div className="px-5 py-4 border-b border-[#e6e9f2] grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[12px] text-[#64748b]">Employee</div>
                  <div className="text-[14px] font-semibold text-[#171a2e]">{previewPay.employee?.firstName} {previewPay.employee?.lastName}</div>
                  <div className="text-[12px] text-[#64748b]">{previewPay.employee?.employeeNo}</div>
                </div>
                <div>
                  <div className="text-[12px] text-[#64748b]">Department</div>
                  <div className="text-[14px] text-[#171a2e]">{previewPay.employee?.department?.name || '—'}</div>
                  <div className="text-[12px] text-[#64748b]">Pay date {fmtDate(previewPay.payrollRun?.payDate)}</div>
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b] mb-2">Earnings</div>
                <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">Base salary</span><span className="font-medium text-[#171a2e]">{fmtMoney(previewPay.basicSalary)}</span></div>
                {Number(previewPay.bonusAmount || 0) > 0 && (
                  <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]">
                    <span className="text-[#344054]">Performance Bonus<br /><span className="text-[11px] text-[#1d5fb5]">{(previewPay.bonusReferences || []).map((b: any) => `${b.reference} · ${b.cycle}`).join(', ')}</span></span>
                    <span className="font-medium text-[#171a2e]">{fmtMoney(previewPay.bonusAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">Gross pay</span><span className="font-medium text-[#171a2e]">{fmtMoney(previewPay.grossPay)}</span></div>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b] mt-5 mb-2">Deductions</div>
                <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">PAYE tax</span><span>{fmtMoney(previewPay.payeTax)}</span></div>
                <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">NSSA (employee)</span><span>{fmtMoney(previewPay.nssaDeduction)}</span></div>
                <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">Other deductions</span><span>{fmtMoney(previewPay.otherDeductions)}</span></div>
                <div className="flex justify-between text-[13px] py-2"><span className="text-[#344054]">Total deductions</span><span className="font-medium">{fmtMoney(Number(previewPay.payeTax || 0) + Number(previewPay.nssaDeduction || 0) + Number(previewPay.otherDeductions || 0))}</span></div>
                <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#e6e9f2]">
                  <span className="text-[15px] font-semibold text-[#171a2e]">NET PAY</span>
                  <span className="text-[22px] font-bold text-[#0b2a4a]">{fmtMoney(previewPay.netPay)}</span>
                </div>
                <div className="flex justify-between text-[12px] text-[#64748b] mt-3 pt-2 border-t border-[#f0f1f6]"><span>Employer NSSA</span><span>{fmtMoney(previewPay.employerNssa)}</span></div>
                <div className="flex justify-between text-[12px] text-[#64748b] py-1"><span>Status</span><span><StatusPill status={previewPay.status} /></span></div>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
