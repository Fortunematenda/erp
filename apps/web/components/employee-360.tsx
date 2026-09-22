'use client';
import React, { createContext, useContext, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Alert, Button, Col, DatePicker, Descriptions, Drawer, Dropdown, Empty, Form, Input, InputNumber,
  Row, Segmented, Select, Skeleton, Space, Switch, Table, Tabs, Tag, Timeline, Tooltip, Upload, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  AppstoreOutlined, AuditOutlined, BankOutlined, CalendarOutlined, CarryOutOutlined, DollarOutlined,
  DownloadOutlined, EditOutlined, FileTextOutlined, GiftOutlined, LaptopOutlined, MailOutlined, MoreOutlined,
  PlusOutlined, PrinterOutlined, ProjectOutlined, ReloadOutlined, RiseOutlined, SolutionOutlined, TeamOutlined, UploadOutlined,
  UserOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { Can, useAuthPermissions } from '@/components/Can';
import { StatusPill, DetailItem, DetailGrid, EmptyState, SummaryCard } from '@/components/sales-ui';
import { EmployeeDrawer } from '@/components/employee-drawer';
import { AddAttendanceDrawer } from '@/components/attendance-management';
import { ReviewDrawer } from '@/components/performance/review-drawer';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export type DrawerName =
  | 'edit' | 'applyLeave' | 'leaveDetail' | 'configureLeave' | 'adjustAttendance'
  | 'uploadDocument' | 'replaceDocument' | 'assignAsset' | 'returnAsset' | 'assignProject'
  | 'offboard' | 'auditDetail' | 'payrollInput' | 'payslip';

type Ctx = {
  id: string;
  employee: any;
  currency: string;
  openDrawer: (name: DrawerName, payload?: any) => void;
  goTab: (t: string) => void;
  qc: ReturnType<typeof useQueryClient>;
};
export const EmployeeCtx = createContext<Ctx | null>(null);
export function useEmp() { const c = useContext(EmployeeCtx); if (!c) throw new Error('EmployeeCtx missing'); return c; }

function money(v: any, currency = 'USD') { return fmtMoney(v, currency || 'USD'); }

export async function downloadPayslipPdf(id: string, filename: string) {
  const token = useAuth.getState().token;
  try {
    const res = await fetch(`${BASE}/documents/payslip/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('PDF could not be generated.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e: any) { message.error(e.message); }
}

function DataCard({ title, extra, children, bodyClass = 'p-5' }: { title?: string; extra?: React.ReactNode; children: React.ReactNode; bodyClass?: string }) {
  return (
    <div className="nex-card overflow-hidden">
      {title && <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#eef0f6]"><div className="text-[13px] font-semibold text-[#171a2e]">{title}</div>{extra}</div>}
      <div className={bodyClass}>{children}</div>
    </div>
  );
}

function MiniCard({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return (
    <div className="nex-card p-4">
      <div className="text-[12px] font-semibold text-[#64748b]">{label}</div>
      <div className="text-[18px] font-bold mt-1 truncate" style={{ color: color || '#171a2e' }}>{value}</div>
      {hint && <div className="text-[11px] text-[#98A2B3] mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

// ======================================================================
// Header
// ======================================================================
export function Employee360Header({ employee, onOpenDrawer }: { employee: any; onOpenDrawer: (n: DrawerName, p?: any) => void }) {
  const { goTab } = useEmp();
  const router = useRouter();
  const e = employee;
  const name = e?.preferredName || `${e?.firstName || ''} ${e?.lastName || ''}`.trim();
  const manager = e?.manager ? `${e.manager.firstName} ${e.manager.lastName}` : '—';

  const moreItems = [
    { key: 'applyLeave', icon: <CalendarOutlined />, label: 'Apply Leave' },
    { key: 'adjustAttendance', icon: <CarryOutOutlined />, label: 'Record Attendance' },
    { key: 'perf', icon: <RiseOutlined />, label: 'Start Performance Review' },
    { key: 'qa', icon: <SolutionOutlined />, label: 'Perform QA' },
    { key: 'uploadDocument', icon: <UploadOutlined />, label: 'Upload Document' },
    { key: 'assignAsset', icon: <LaptopOutlined />, label: 'Assign Asset' },
    { key: 'assignProject', icon: <ProjectOutlined />, label: 'Assign Project' },
    { key: 'payslips', icon: <DollarOutlined />, label: 'View Payslips' },
    { type: 'divider' as const },
    { key: 'offboard', icon: <WarningOutlined />, label: 'Offboard Employee', danger: true },
  ];

  function onMenu(key: string) {
    if (key === 'perf') { router.push(`/performance?tab=assessments&employeeId=${e.id}`); return; }
    if (key === 'qa') { router.push(`/performance?tab=assessments&employeeId=${e.id}&qa=1`); return; }
    if (key === 'payslips') { goTab('payroll'); return; }
    onOpenDrawer(key as DrawerName);
  }

  return (
    <div className="nex-card p-6 mb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-[22px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg,#003366,#1d5fb5)' }}>
            {(e?.firstName || '?').charAt(0)}{(e?.lastName || '').charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[21px] font-bold text-[#171a2e]">{name}</span>
              <StatusPill status={e?.employmentStatus || e?.status} />
            </div>
            <div className="text-[13px] text-[#64748b] mt-0.5">{e?.employeeNo} · {e?.position || 'No role'} · {e?.department?.name || 'No department'}</div>
            <div className="text-[13px] text-[#64748b]">{e?.department?.branch?.name || e?.branch?.name || '—'}</div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1 mt-3 text-[12.5px]">
              <div><span className="text-[#94a3b8]">Work email </span><span className="text-[#344054]">{e?.workEmail || e?.email || '—'}</span></div>
              <div><span className="text-[#94a3b8]">Phone </span><span className="text-[#344054]">{e?.mobile || e?.phone || '—'}</span></div>
              <div><span className="text-[#94a3b8]">Manager </span><span className="text-[#344054]">{manager}</span></div>
              <div><span className="text-[#94a3b8]">Department </span><span className="text-[#344054]">{e?.department?.name || '—'}</span></div>
              <div><span className="text-[#94a3b8]">Primary branch </span><span className="text-[#344054]">{e?.department?.branch?.name || '—'}</span></div>
              <div><span className="text-[#94a3b8]">Employment type </span><span className="text-[#344054]">{(e?.contractType || '').replace(/_/g, ' ') || '—'}</span></div>
            </div>
          </div>
        </div>
        <Space>
          <Can permission={['hr.employees.manage']}><Button icon={<EditOutlined />} onClick={() => onOpenDrawer('edit')}>Edit</Button></Can>
          <Dropdown menu={{ items: moreItems, onClick: ({ key }) => onMenu(key) }} trigger={['click']}>
            <Button icon={<MoreOutlined />}>More</Button>
          </Dropdown>
        </Space>
      </div>
    </div>
  );
}

// ======================================================================
// Overview
// ======================================================================
export function OverviewTab() {
  const { id, currency, goTab, openDrawer } = useEmp();
  const { data, isLoading } = useQuery({ queryKey: ['emp-360', id], queryFn: () => api(`/hr/employees/${id}/360`) });
  if (isLoading) return <Skeleton active />;
  const e = data?.employee;
  const s = data?.summary || {};
  const activity = data?.activity || [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniCard label="Employment" value={<StatusPill status={s.employment?.status} />} hint={`Started ${fmtDate(s.employment?.started)}`} />
        <MiniCard label="Leave" value={`${fmtNumber(s.leave?.available, 1)} days available`} hint={`${s.leave?.pending || 0} pending request(s)`} />
        <MiniCard label="Performance" value={s.performance?.score != null ? `${fmtNumber(s.performance.score, 1)}%` : '—'} hint={s.performance?.band || s.performance?.cycle || 'No approved cycle'} />
        <MiniCard label="Payroll" value={money(s.payroll?.basicSalary, s.payroll?.currency)} hint={s.payroll?.lastPaid ? `Last paid ${s.payroll.lastPaid.period}/${s.payroll.lastPaid.year}` : 'No payslip yet'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <DataCard title="Employee information">
            <Row gutter={[16, 0]}>
              <Col xs={24} md={12}>
                <DetailItem label="Full name" value={`${e?.firstName} ${e?.middleName || ''} ${e?.lastName}`.replace(/\s+/g, ' ')} />
                <DetailItem label="Employee number" value={e?.employeeNo} />
                <DetailItem label="Date of birth" value={fmtDate(e?.dateOfBirth)} />
                <DetailItem label="Gender" value={e?.gender} />
                <DetailItem label="Nationality" value={e?.nationality} />
                <DetailItem label="ID / Passport" value={e?.idNumber} />
              </Col>
              <Col xs={24} md={12}>
                <DetailItem label="Work email" value={e?.workEmail || e?.email} />
                <DetailItem label="Personal email" value={e?.personalEmail} />
                <DetailItem label="Mobile" value={e?.mobile || e?.phone} />
                <DetailItem label="Address" value={[e?.addressLine1, e?.city, e?.country].filter(Boolean).join(', ')} />
                <DetailItem label="Job title" value={e?.position} />
                <DetailItem label="Department" value={e?.department?.name} />
              </Col>
            </Row>
          </DataCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <DataCard title="Organisation">
              <DetailItem label="Branch" value={e?.department?.branch?.name} />
              <DetailItem label="Department" value={e?.department?.name} />
              <DetailItem label="Manager" value={e?.manager ? `${e.manager.firstName} ${e.manager.lastName}` : '—'} />
              <DetailItem label="Work calendar" value={e?.workCalendar?.name} />
              <DetailItem label="Employment type" value={(e?.contractType || '').replace(/_/g, ' ')} />
            </DataCard>
            <DataCard title="NexusERP user account">
              {e?.userAccount ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><StatusPill status={e.userAccount.status} /><span className="text-[13px] text-[#344054]">{e.userAccount.email}</span></div>
                  <DetailItem label="Roles" value={e.userAccount.roles.join(', ') || '—'} />
                  <Can permission="admin.users.view"><Link href="/administration/security"><Button size="small">View user</Button></Link></Can>
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="text-[13px] text-[#64748b] mb-3">No NexusERP user account</div>
                  <Can permission={['admin.users.manage', 'hr.employees.manage']}><Button type="primary" size="small" icon={<UserOutlined />} onClick={() => openDrawer('edit')}>Create user</Button></Can>
                </div>
              )}
            </DataCard>
          </div>
        </div>

        <div className="space-y-5">
          <DataCard title="Needs attention" bodyClass="p-4">
            {(data?.needsAttention || []).length ? (
              <div className="space-y-2">
                {data!.needsAttention.map((n: any, i: number) => (
                  <button key={i} onClick={() => goTab(n.tab)} className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-[#f7f8fc] border border-[#eef0f6]">
                    <WarningOutlined className="mt-0.5" style={{ color: n.severity === 'critical' ? '#dc2626' : n.severity === 'warning' ? '#d97706' : '#1d5fb5' }} />
                    <span className="text-[13px] text-[#344054]">{n.title}</span>
                  </button>
                ))}
              </div>
            ) : <div className="text-[13px] text-[#94a3b8] text-center py-4">Nothing needs attention.</div>}
          </DataCard>

          <DataCard title="Recent activity" bodyClass="p-4">
            {activity.length ? (
              <Timeline items={activity.map((a: any) => ({ children: (<div><div className="text-[12px] text-[#94a3b8]">{fmtDate(a.at)}</div><div className="text-[13px] text-[#344054]">{a.description}</div></div>) }))} />
            ) : <div className="text-[13px] text-[#94a3b8] text-center py-4">No recent activity.</div>}
          </DataCard>
        </div>
      </div>
    </div>
  );
}

// ======================================================================
// Employment
// ======================================================================
export function EmploymentTab() {
  const { id, employee, openDrawer } = useEmp();
  const { data: history = [] } = useQuery({ queryKey: ['emp-employment-history', id], queryFn: () => api(`/hr/employees/${id}/employment-history`) });
  const { data: comp = [] } = useQuery({ queryKey: ['emp-comp', id], queryFn: () => api(`/hr/employees/${id}/compensation-history`) });
  const e = employee;
  const cols: ColumnsType<any> = [
    { title: 'Effective date', dataIndex: 'effectiveDate', render: (v) => fmtDate(v), width: 130 },
    { title: 'Change', dataIndex: 'changeType', render: (v) => <StatusPill status={v} /> },
    { title: 'Field', dataIndex: 'field' },
    { title: 'Previous', dataIndex: 'previousValue' },
    { title: 'New', dataIndex: 'newValue' },
    { title: 'Reason', dataIndex: 'reason' },
  ];
  return (
    <div className="space-y-5">
      <DataCard title="Current employment" extra={<Can permission="hr.employees.manage"><Button size="small" icon={<EditOutlined />} onClick={() => openDrawer('edit')}>Edit employment</Button></Can>}>
        <Row gutter={[16, 0]}>
          <Col xs={24} md={12}>
            <DetailItem label="Employee number" value={e?.employeeNo} />
            <DetailItem label="Employment status" value={e?.employmentStatus || e?.status} />
            <DetailItem label="Employment type" value={(e?.contractType || '').replace(/_/g, ' ')} />
            <DetailItem label="Hire date" value={fmtDate(e?.hireDate)} />
            <DetailItem label="Probation end" value={fmtDate(e?.probationEndDate)} />
          </Col>
          <Col xs={24} md={12}>
            <DetailItem label="Department" value={e?.department?.name} />
            <DetailItem label="Job title" value={e?.position} />
            <DetailItem label="Manager" value={e?.manager ? `${e.manager.firstName} ${e.manager.lastName}` : '—'} />
            <DetailItem label="Branch" value={e?.department?.branch?.name} />
            <DetailItem label="Work location" value={e?.city} />
          </Col>
        </Row>
      </DataCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DataCard title="Compensation summary">
          <DetailItem label="Basic salary" value={money(e?.basicSalary, e?.currency)} />
          <DetailItem label="Currency" value={e?.currency} />
          <DetailItem label="Pay frequency" value={e?.payFrequency} />
          <DetailItem label="Compensation type" value={e?.compensationType} />
        </DataCard>
        <DataCard title="Compensation history" bodyClass="p-0">
          <Table rowKey="id" size="small" dataSource={comp} pagination={false} columns={[
            { title: 'Effective', dataIndex: 'effectiveDate', render: (v) => fmtDate(v) },
            { title: 'Base', dataIndex: 'baseSalary', render: (v) => money(v, e?.currency) },
            { title: 'Reason', dataIndex: 'reason' },
          ] as ColumnsType<any>} />
        </DataCard>
      </div>

      <DataCard title="Employment history" bodyClass="p-0">
        <Table rowKey="id" size="small" dataSource={history} columns={cols} pagination={{ pageSize: 10 }} locale={{ emptyText: <EmptyState title="No employment changes recorded." /> }} />
      </DataCard>
    </div>
  );
}

// ======================================================================
// Leave
// ======================================================================
export function LeaveTab() {
  const { id, openDrawer, qc } = useEmp();
  const [month, setMonth] = useState(dayjs());
  const [year, setYear] = useState<number | undefined>();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [view, setView] = useState<'requests' | 'calendar' | 'team'>('requests');
  const { data, isLoading } = useQuery({ queryKey: ['emp-leave-ws', id, month.format('YYYY-MM')], queryFn: () => api(`/hr/employees/${id}/leave-workspace?month=${month.toISOString()}`) });

  if (isLoading) return <Skeleton active />;
  const balances = data?.balances || [];
  const requests = (data?.requests || []).filter((r: any) =>
    (!year || new Date(r.startDate).getFullYear() === year) &&
    (!typeFilter || r.leaveTypeId === typeFilter || r.leaveType === typeFilter) &&
    (!statusFilter || r.status === statusFilter));

  async function setStatus(leaveId: string, status: string) {
    try { await api(`/hr/employees/${id}/leave/${leaveId}/status`, { method: 'POST', body: JSON.stringify({ status }) }); message.success(`Leave ${status.toLowerCase()}`); qc.invalidateQueries({ queryKey: ['emp-leave-ws'] }); qc.invalidateQueries({ queryKey: ['emp-360', id] }); }
    catch (e: any) { message.error(e.message); }
  }

  const cols: ColumnsType<any> = [
    { title: 'Type', dataIndex: 'leaveType', render: (v, r) => r.leaveTypeRef?.name || v },
    { title: 'Start', dataIndex: 'startDate', render: (v) => fmtDate(v) },
    { title: 'End', dataIndex: 'endDate', render: (v) => fmtDate(v) },
    { title: 'Working days', dataIndex: 'days', align: 'right', render: (v, r) => <span>{fmtNumber(v, 1)}{r.halfDay && r.halfDay !== 'FULL' ? ` (${r.halfDay.toLowerCase()})` : ''}</span> },
    { title: 'Submitted by', dataIndex: 'createdBy', render: () => 'HR' },
    { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
    { title: 'Approver', render: (_v, r) => r.approverName || (r.approver ? `${r.approver.firstName} ${r.approver.lastName}` : '—') },
    { title: 'Actions', width: 150, render: (_v, r) => (
      <Space size={4}>
        <Button size="small" onClick={() => openDrawer('leaveDetail', r)}>View</Button>
        <Can permission={['hr.leave.approve', 'hr.leave.manage']}>
          {['PENDING', 'SUBMITTED', 'PENDING_APPROVAL'].includes(r.status) && <Button size="small" type="primary" onClick={() => setStatus(r.id, 'APPROVED')}>Approve</Button>}
        </Can>
        <Can permission={['hr.leave.approve', 'hr.leave.manage']}>
          {['PENDING', 'SUBMITTED', 'PENDING_APPROVAL'].includes(r.status) && <Button size="small" danger onClick={() => setStatus(r.id, 'REJECTED')}>Reject</Button>}
        </Can>
      </Space>
    ) },
  ];

  const calEvents = [
    ...(data?.calendar || []).map((r: any) => ({ date: r.startDate, end: r.endDate, status: r.status, type: r.leaveTypeRef?.name || r.leaveType, label: `${r.leaveTypeRef?.name || r.leaveType}` })),
  ];
  const holidays = data?.holidays || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          {(balances || []).map((b: any) => <MiniCard key={b.leaveTypeId} label={b.name} value={`${fmtNumber(b.available, 1)} days`} hint={`Entitled ${fmtNumber(b.entitled, 0)} · Used ${fmtNumber(b.used, 1)} · Pending ${fmtNumber(b.pending, 1)}`} />)}
          {!balances.length && <div className="nex-card p-4 text-[13px] text-[#64748b]">Leave balances have not been configured for this employee. <Can permission="hr.leave.manage"><Button size="small" type="link" onClick={() => openDrawer('configureLeave')}>Configure Leave</Button></Can></div>}
        </div>
        <Space>
          <Can permission={['hr.leave.create_for_employee', 'hr.leave.manage', 'hr.leave.request']}><Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer('applyLeave')}>Apply Leave</Button></Can>
          <Segmented value={view} onChange={(v) => setView(v as any)} options={[{ label: 'Requests', value: 'requests' }, { label: 'Calendar', value: 'calendar' }, { label: 'Department', value: 'team' }]} />
        </Space>
      </div>

      {view === 'requests' && (
        <DataCard title="Leave requests" extra={
          <Space>
            <Select allowClear placeholder="Year" style={{ width: 100 }} value={year} onChange={setYear} options={[2024, 2025, 2026, 2027].map((y) => ({ label: String(y), value: y }))} />
            <Select allowClear placeholder="Type" style={{ width: 140 }} value={typeFilter} onChange={setTypeFilter} options={(data?.leaveTypes || []).map((t: any) => ({ label: t.name, value: t.id }))} />
            <Select allowClear placeholder="Status" style={{ width: 130 }} value={statusFilter} onChange={setStatusFilter} options={['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => ({ label: s, value: s }))} />
          </Space>
        } bodyClass="p-0">
          <Table rowKey="id" size="small" dataSource={requests} columns={cols} pagination={{ pageSize: 10 }} locale={{ emptyText: <EmptyState title="No leave requests for this employee." action={<Can permission={['hr.leave.create_for_employee', 'hr.leave.manage']}><Button type="primary" onClick={() => openDrawer('applyLeave')}>Apply Leave</Button></Can>} /> }} />
        </DataCard>
      )}

      {view === 'calendar' && (
        <DataCard title={`Leave calendar — ${month.format('MMMM YYYY')}`} extra={<Space><Button size="small" onClick={() => setMonth(month.subtract(1, 'month'))}>Prev</Button><Button size="small" onClick={() => setMonth(dayjs())}>Today</Button><Button size="small" onClick={() => setMonth(month.add(1, 'month'))}>Next</Button></Space>}>
          <CalendarMonth month={month} events={calEvents} holidays={holidays} />
          <div className="flex gap-4 mt-3 text-[12px]">
            <span><Tag color="green">Approved</Tag></span>
            <span><Tag color="orange">Pending</Tag></span>
            <span><Tag color="default">Public holiday</Tag></span>
          </div>
        </DataCard>
      )}

      {view === 'team' && (
        <DataCard title="Department calendar — overlapping leave" bodyClass="p-0">
          <Table rowKey="id" size="small" pagination={false} dataSource={data?.departmentCalendar || []} columns={[
            { title: 'Employee', render: (_v, r) => `${r.employee?.firstName || ''} ${r.employee?.lastName || ''} (${r.employee?.employeeNo || ''})` },
            { title: 'Type', render: (_v, r) => r.leaveTypeRef?.name || r.leaveType },
            { title: 'Start', dataIndex: 'startDate', render: (v) => fmtDate(v) },
            { title: 'End', dataIndex: 'endDate', render: (v) => fmtDate(v) },
            { title: 'Days', dataIndex: 'days', align: 'right' },
            { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
          ] as ColumnsType<any>} />
        </DataCard>
      )}
    </div>
  );
}

function CalendarMonth({ month, events, holidays }: { month: dayjs.Dayjs; events: any[]; holidays: any[] }) {
  const start = month.startOf('month');
  const daysInMonth = month.daysInMonth();
  const offset = start.day();
  const cells: (dayjs.Dayjs | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(month.date(d));
  function dayEvents(day: dayjs.Dayjs) {
    return events.filter((e) => { const s = dayjs(e.date).startOf('day'); const en = dayjs(e.end).endOf('day'); return day.isAfter(s.subtract(1, 'day')) && day.isBefore(en.add(1, 'day')); });
  }
  function isHoliday(day: dayjs.Dayjs) { return holidays.some((h) => dayjs(h.date).isSame(day, 'day')); }
  return (
    <div className="grid grid-cols-7 gap-1">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="text-[11px] font-semibold text-[#94a3b8] text-center py-1">{d}</div>)}
      {cells.map((day, i) => (
        <div key={i} className={`min-h-[64px] rounded-md border p-1.5 ${day ? 'bg-white border-[#eef0f6]' : 'bg-transparent border-transparent'}`}>
          {day && <div className={`text-[11px] mb-1 ${isHoliday(day) ? 'text-[#94a3b8]' : 'text-[#344054]'}`}>{day.date()}</div>}
          {day && isHoliday(day) && <div className="text-[10px] px-1 rounded bg-[#f1f5f9] text-[#64748b] truncate">Holiday</div>}
          {day && dayEvents(day).map((e, j) => (
            <div key={j} className={`text-[10px] px-1 rounded truncate mt-0.5 ${e.status === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{e.type}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ======================================================================
// Attendance
// ======================================================================
export function AttendanceTab() {
  const { id, openDrawer, qc } = useEmp();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [addAtt, setAddAtt] = useState(false);
  const qs = `from=${range[0].toISOString()}&to=${range[1].toISOString()}`;
  const { data, isLoading } = useQuery({ queryKey: ['emp-att-ws', id, qs], queryFn: () => api(`/hr/employees/${id}/attendance-workspace?${qs}`) });
  if (isLoading) return <Skeleton active />;
  const s = data?.summary || {};
  const rows = (data?.records || []).filter((r: any) => !statusFilter || r.status === statusFilter);

  async function approve(row: any) {
    try { await api(`/hr/attendance/${row.id}/approve`, { method: 'POST', body: JSON.stringify({ approved: true }) }); message.success('Attendance approved'); qc.invalidateQueries({ queryKey: ['emp-att-ws'] }); }
    catch (e: any) { message.error(e.message); }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MiniCard label="Present days" value={s.presentDays ?? 0} />
        <MiniCard label="Absent days" value={s.absentDays ?? 0} />
        <MiniCard label="Late arrivals" value={s.lateArrivals ?? 0} />
        <MiniCard label="Overtime" value={`${fmtNumber(s.overtimeHours, 1)} h`} />
        <MiniCard label="Attendance %" value={`${fmtNumber(s.attendancePct, 1)}%`} color={(s.attendancePct ?? 0) >= 90 ? '#16a34a' : (s.attendancePct ?? 0) >= 70 ? '#d97706' : '#dc2626'} />
      </div>
      <DataCard title="Attendance records" extra={
        <Space>
          <DatePicker.RangePicker value={range} onChange={(v) => v && setRange(v as any)} />
          <Select allowClear placeholder="Status" style={{ width: 130 }} value={statusFilter} onChange={setStatusFilter} options={['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY'].map((x) => ({ label: x, value: x }))} />
          <Can permission="hr.attendance.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => setAddAtt(true)}>Add Attendance</Button></Can>
          <Can permission={['hr.attendance.adjust', 'hr.attendance.manage']}><Button icon={<EditOutlined />} onClick={() => openDrawer('adjustAttendance')}>Adjust Attendance</Button></Can>
        </Space>
      } bodyClass="p-0">
        <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 12 }} locale={{ emptyText: <EmptyState title="No attendance records for this period." /> }} columns={[
          { title: 'Date', dataIndex: 'date', render: (v) => fmtDate(v) },
          { title: 'Clock in', dataIndex: 'checkIn', render: (v) => v ? dayjs(v).format('HH:mm') : '—' },
          { title: 'Clock out', dataIndex: 'checkOut', render: (v) => v ? dayjs(v).format('HH:mm') : '—' },
          { title: 'Hours', dataIndex: 'workedHours', align: 'right', render: (v) => fmtNumber(v, 1) },
          { title: 'Overtime', dataIndex: 'overtimeHours', align: 'right', render: (v) => fmtNumber(v, 1) },
          { title: 'Status', dataIndex: 'status', render: (v, r) => r.onLeave ? <Tag color="blue">ON LEAVE</Tag> : <StatusPill status={v} /> },
          { title: 'Source', dataIndex: 'source' },
          { title: 'Actions', width: 120, render: (_v, r) => (
            <Space size={4}>
              <Can permission={['hr.attendance.adjust', 'hr.attendance.manage']}><Button size="small" onClick={() => openDrawer('adjustAttendance', r)}>Adjust</Button></Can>
              {!r.approved && toNumLocal(r.overtimeHours) > 0 && <Can permission={['hr.attendance.manage']}><Button size="small" type="primary" onClick={() => approve(r)}>Approve OT</Button></Can>}
            </Space>
          ) },
        ] as ColumnsType<any>} />
      </DataCard>
      {addAtt && <AddAttendanceDrawer presetEmployee={id} onClose={() => setAddAtt(false)} onSaved={() => { setAddAtt(false); qc.invalidateQueries({ queryKey: ['emp-att-ws'] }); qc.invalidateQueries({ queryKey: ['/hr/attendance'] }); qc.invalidateQueries({ queryKey: ['/hr/attendance/summary'] }); }} />}
    </div>
  );
}
function toNumLocal(v: any) { return Number(v || 0); }

// ======================================================================
// Performance
// ======================================================================
export function PerformanceTab() {
  const { id, openDrawer, qc } = useEmp();
  const { data, isLoading } = useQuery({ queryKey: ['emp-perf-ws', id], queryFn: () => api(`/hr/employees/${id}/performance-workspace`) });
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState<'EMPLOYEE' | 'MANAGER' | 'QA' | 'VIEW' | 'HR_EMPLOYEE'>('VIEW');
  if (isLoading) return <Skeleton active />;
  const a = data?.currentAssessment;
  const history = data?.history || [];
  const template = data?.template;
  const missing = a && !a.employeeSubmittedAt;
  const completed = !!a && ['APPROVED', 'COMPLETED', 'LOCKED'].includes(a.status);
  const active = !!a && !completed;
  const latestApproved = history.find((h: any) => h.score != null) || null;
  const resultToShow = completed
    ? { id: a!.id, score: a!.totalScore, result: a!.result, band: a!.band, qa: !!a!.qaSubmittedAt, approvedAt: a!.approvedAt, cycle: data?.currentCycle?.name }
    : latestApproved
      ? { id: latestApproved.id, score: latestApproved.score, result: latestApproved.result, band: latestApproved.band, qa: ['APPROVED', 'COMPLETED', 'LOCKED'].includes(latestApproved.status), approvedAt: null, cycle: latestApproved.cycle }
      : null;

  function openReview(asmtId: string, mode: 'EMPLOYEE' | 'MANAGER' | 'QA' | 'VIEW' | 'HR_EMPLOYEE' = 'VIEW') { setReviewMode(mode); setReviewId(asmtId); }

  async function remind() {
    try { await api(`/hr/employees/${id}/performance/remind`, { method: 'POST', body: JSON.stringify({}) }); message.success('Reminder sent'); }
    catch (e: any) { message.error(e.message); }
  }

  // HR action depends on where the active assessment is in its workflow.
  function primaryAction() {
    if (!a) return null;
    if (completed) return <Button size="small" type="primary" onClick={() => openReview(a.id, 'VIEW')}>View Result</Button>;
    switch (a.status) {
      case 'PENDING_MANAGER': return <Can permission={['performance.manager.review', 'hr.performance.manage']}><Button size="small" type="primary" onClick={() => openReview(a.id, 'MANAGER')}>Continue Assessment</Button></Can>;
      case 'PENDING_QA': return <Can permission={['performance.qa.review', 'hr.performance.manage']}><Button size="small" type="primary" onClick={() => openReview(a.id, 'QA')}>Perform QA</Button></Can>;
      case 'PENDING_CALIBRATION': return <Can permission={['performance.calibration.manage', 'hr.performance.manage']}><Button size="small" type="primary" onClick={() => openReview(a.id, 'QA')}>Calibrate</Button></Can>;
      case 'PENDING_APPROVAL': return <Can permission={['performance.approve', 'hr.performance.manage']}><Button size="small" type="primary" onClick={() => openReview(a.id, 'VIEW')}>Review &amp; Approve</Button></Can>;
      default: return <Button size="small" type="primary" onClick={() => openReview(a.id, 'VIEW')}>Open Assessment</Button>;
    }
  }

  const kpiCols: ColumnsType<any> = [
    { title: 'KPI', dataIndex: 'name', render: (v, r) => (<div><div className="font-medium">{v}</div>{r.critical && <Tag color="red" className="!mt-1">Critical</Tag>}</div>) },
    { title: 'Weight', dataIndex: 'weight', align: 'right', render: (v) => `${fmtNumber(v, 0)}%` },
    { title: 'Target', dataIndex: 'targetValue', render: (v, r) => v != null ? `${fmtNumber(v, 2)}${r.unit ? ` ${r.unit}` : ''}` : (r.targetText || '—') },
    { title: 'Actual', render: (_v, r) => { const actual = r.qaActual ?? r.managerActual ?? r.actualValue; return actual != null ? `${fmtNumber(actual, 2)}${r.unit ? ` ${r.unit}` : ''}` : '—'; } },
    { title: 'Achievement', dataIndex: 'achievement', align: 'right', render: (v) => v != null ? `${fmtNumber(v, 1)}%` : '—' },
    { title: 'Score', dataIndex: 'effectiveScore', align: 'right', render: (v) => v != null ? fmtNumber(v, 2) : '—' },
    { title: 'Status', render: (_v, r) => r.critical && Number(r.achievement) < 100 ? <Tag color="red">Below target</Tag> : (r.effectiveScore != null ? <Tag color="green">Scored</Tag> : <Tag>Pending</Tag>) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MiniCard label="Current cycle" value={data?.currentCycle?.name || 'No active cycle'} />
        <MiniCard label="Employee submission" value={a ? (a.employeeSubmittedAt ? 'SUBMITTED' : missing ? 'MISSING' : 'PENDING') : '—'} color={missing ? '#dc2626' : undefined} />
        <MiniCard label="Manager review" value={a ? (a.managerSubmittedAt ? 'COMPLETED' : 'PENDING') : '—'} />
        <MiniCard label="QA" value={a ? (a.qaSubmittedAt ? 'COMPLETED' : (a.qaReviews?.length ? 'IN PROGRESS' : 'PENDING')) : '—'} />
        <MiniCard label="Current score" value={a?.totalScore != null ? `${fmtNumber(a.totalScore, 1)}%` : '—'} hint={a?.band || ''} />
      </div>

      {missing && (
        <Alert type="warning" showIcon message="KPI SUBMISSION MISSING" description={data?.currentCycle?.employeeDeadline ? `Overdue since ${fmtDate(data.currentCycle.employeeDeadline)}` : 'The employee has not submitted this cycle.'} action={<Space><Can permission={['performance.cycles.manage', 'hr.performance.manage']}><Button size="small" onClick={remind}>Remind Employee</Button></Can>{a && <Button size="small" type="primary" onClick={() => openReview(a.id, 'VIEW')}>Open Assessment</Button>}</Space>} />
      )}

      {!data?.currentCycle && !history.length && <EmptyState title="No performance assessments have been created yet." />}

      {!template && data?.currentCycle && (
        <Alert type="info" showIcon message={data.currentCycle.departmentId ? `No active KPI template is configured for ${employeeDeptName(id)}` : 'No active KPI template is configured for this department.'} action={<Can permission="performance.templates.manage"><Link href="/performance?tab=templates"><Button size="small">Configure Department KPIs</Button></Link></Can>} />
      )}

      {resultToShow && (
        <DataCard title={`Latest performance result${resultToShow.cycle ? ` — ${resultToShow.cycle}` : ''}`} extra={<Button size="small" type="primary" onClick={() => openReview(resultToShow.id, 'VIEW')}>View Result</Button>}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MiniCard label="Final score" value={resultToShow.score != null ? `${fmtNumber(resultToShow.score, 1)}%` : '—'} />
            <MiniCard label="Result" value={resultToShow.result || '—'} color={resultToShow.result === 'PASS' ? '#16a34a' : resultToShow.result === 'FAIL' ? '#dc2626' : undefined} />
            <MiniCard label="Performance band" value={resultToShow.band || '—'} />
            <MiniCard label="QA" value={resultToShow.qa ? 'COMPLETED' : 'PENDING'} hint={resultToShow.approvedAt ? `Approved ${fmtDate(resultToShow.approvedAt)}` : ''} />
          </div>
        </DataCard>
      )}

      {a && (
        <DataCard title={`KPI assessment — ${data?.currentCycle?.name || ''}`} extra={
          active ? <Space>
            <Button size="small" onClick={() => openReview(a.id, 'VIEW')}>Open Assessment</Button>
            {!a.employeeSubmittedAt && <Can permission="hr.performance.manage"><Button size="small" onClick={() => openReview(a.id, 'HR_EMPLOYEE')}>Submit KPI (on behalf)</Button></Can>}
            {primaryAction()}
          </Space> : null
        } bodyClass="p-0">
          <Table rowKey="id" size="small" dataSource={a.kpis || []} columns={kpiCols} pagination={false} expandable={{ expandedRowRender: (r) => (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <DetailItem label="Description" value={r.description} />
              <DetailItem label="Employee comment" value={r.employeeComment} />
              <DetailItem label="Manager comment" value={r.managerComment} />
              <DetailItem label="QA comment" value={r.qaComment} />
              <DetailItem label="Evidence" value={r.employeeEvidence || r.managerEvidence || r.qaEvidence} />
              <DetailItem label="Scoring" value={r.scoringMethod} />
            </div>
          ) }} />
        </DataCard>
      )}

      <DataCard title="Performance history" bodyClass="p-0">
        <Table rowKey="id" size="small" dataSource={history} pagination={{ pageSize: 8 }} columns={[
          { title: 'Cycle', dataIndex: 'cycle' },
          { title: 'Period', render: (_v, r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}` },
          { title: 'Score', dataIndex: 'score', align: 'right', render: (v) => v != null ? `${fmtNumber(v, 1)}%` : '—' },
          { title: 'Result', dataIndex: 'result', render: (v) => v ? <StatusPill status={v} /> : '—' },
          { title: 'Band', dataIndex: 'band' },
          { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
          { title: 'Actions', width: 90, render: (_v, r) => <Button size="small" onClick={() => openReview(r.id, 'VIEW')}>View</Button> },
        ] as ColumnsType<any>} locale={{ emptyText: <EmptyState title="No performance assessments have been created yet." /> }} />
      </DataCard>

      {(data?.qaAssessments || []).length > 0 && (
        <DataCard title="QA assessments" bodyClass="p-0">
          <Table rowKey="id" size="small" dataSource={data!.qaAssessments} pagination={false} columns={[
            { title: 'Template', render: (_v, r) => r.template?.name || '—' },
            { title: 'Score', dataIndex: 'overallScore', align: 'right', render: (v) => v != null ? `${fmtNumber(v, 1)}%` : '—' },
            { title: 'Findings', dataIndex: 'findings' },
            { title: 'Date', dataIndex: 'createdAt', render: (v) => fmtDate(v) },
          ] as ColumnsType<any>} />
        </DataCard>
      )}

      <ReviewDrawer open={!!reviewId} assessmentId={reviewId} mode={reviewMode} onClose={() => { setReviewId(null); qc.invalidateQueries({ queryKey: ['emp-perf-ws', id] }); qc.invalidateQueries({ queryKey: ['emp-360', id] }); }} />
    </div>
  );
}
function employeeDeptName(_id: string) { return 'this department'; }

// ======================================================================
// Incentives
// ======================================================================
export function IncentivesTab() {
  const { id, qc, goTab } = useEmp();
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ['emp-incentives', id], queryFn: () => api(`/hr/employees/${id}/incentives`) });
  const [addOpen, setAddOpen] = useState(false);
  if (isLoading) return <Skeleton active />;
  const s = data?.summary || {};
  const rows = data?.incentives || [];

  async function decide(inc: any, action: 'approve' | 'reject') {
    try {
      if (action === 'approve') await api(`/hr/employees/${id}/incentives/${inc.id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      else { const reason = window.prompt('Rejection reason?') || 'Rejected'; await api(`/hr/employees/${id}/incentives/${inc.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); }
      message.success(`Incentive ${action}d`); qc.invalidateQueries({ queryKey: ['emp-incentives', id] }); qc.invalidateQueries({ queryKey: ['emp-360', id] });
    } catch (e: any) { message.error(e.message); }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniCard label="Proposed" value={money(s.proposed, s.currency)} />
        <MiniCard label="Approved" value={money(s.approved, s.currency)} color="#16a34a" />
        <MiniCard label="Paid" value={money(s.paid, s.currency)} />
        <MiniCard label="YTD incentives" value={money(s.ytd, s.currency)} />
      </div>
      <DataCard title="Incentives" extra={
        <Can permission={['performance.incentives.propose', 'hr.performance.manage']}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add Incentive</Button>
        </Can>
      } bodyClass="p-0">
        <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 10 }} locale={{ emptyText: <EmptyState title="No incentives recorded for this employee." description="Propose an incentive from an approved performance assessment, or add an approved bonus/commission." action={<Can permission={['performance.incentives.propose', 'hr.performance.manage']}><Button type="primary" onClick={() => setAddOpen(true)}>Add Incentive</Button></Can>} /> }} columns={[
          { title: 'Reference', dataIndex: 'reference', render: (v) => <span className="font-medium">{v}</span> },
          { title: 'Source', render: (_v, r) => r.source === 'PERFORMANCE' ? 'Performance' : (r.kind || 'Other').replace(/_/g, ' ') },
          { title: 'Cycle', render: (_v, r) => r.cycle || '—' },
          { title: 'Score', dataIndex: 'finalScore', align: 'right', render: (v) => v != null ? `${fmtNumber(v, 1)}%` : '—' },
          { title: 'Plan', dataIndex: 'planName' },
          { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v, r) => money(v, r.currency) },
          { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
          { title: 'Payroll run', dataIndex: 'payrollInputRef' },
          { title: 'Actions', width: 170, render: (_v, r) => (
            <Space size={4}>
              {r.assessmentId && <Button size="small" onClick={() => router.push(`/performance?tab=assessments&assessment=${r.assessmentId}`)}>View</Button>}
              {['PENDING_APPROVAL', 'PROPOSED'].includes(r.status) && <Can permission={['performance.incentives.approve', 'hr.performance.manage']}><Button size="small" type="primary" onClick={() => decide(r, 'approve')}>Approve</Button></Can>}
              {['PENDING_APPROVAL', 'PROPOSED', 'APPROVED'].includes(r.status) && <Can permission={['performance.incentives.approve', 'hr.performance.manage']}><Button size="small" danger onClick={() => decide(r, 'reject')}>Reject</Button></Can>}
              {r.status === 'APPROVED' && r.source === 'PERFORMANCE' && <Button size="small" onClick={() => goTab('payroll')}>Payroll</Button>}
            </Space>
          ) },
        ] as ColumnsType<any>} />
      </DataCard>
      <AddIncentiveDrawer id={id} open={addOpen} eligible={data?.eligibleAssessments || []} plans={data?.plans || []} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['emp-incentives', id] }); qc.invalidateQueries({ queryKey: ['emp-360', id] }); }} />
    </div>
  );
}

function AddIncentiveDrawer({ id, open, eligible, plans, onClose, onSaved }: { id: string; open: boolean; eligible: any[]; plans: any[]; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [linkPerf, setLinkPerf] = useState(eligible.length > 0);
  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    const body = { amount: v.amount, planId: v.planId, period: v.period, notes: v.notes, assessmentId: linkPerf ? v.assessmentId : undefined };
    try { await api(`/hr/employees/${id}/incentives`, { method: 'POST', body: JSON.stringify(body) }); message.success('Incentive created'); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer title="Add incentive" width={480} open={open} onClose={onClose} destroyOnHidden
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Create incentive</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ linkPerf: eligible.length > 0 }}>
        <Form.Item label="Link to an approved performance assessment" name="linkPerf" valuePropName="checked"><Switch onChange={setLinkPerf} /></Form.Item>
        {linkPerf && (
          <Form.Item name="assessmentId" label="Performance assessment" rules={[{ required: true, message: 'Select an approved assessment' }]}>
            {eligible.length
              ? <Select options={eligible.map((a) => ({ label: `${a.cycle || 'Cycle'} · ${a.score != null ? `${fmtNumber(a.score, 1)}%` : 'no score'}${a.band ? ` · ${a.band}` : ''}`, value: a.id }))} />
              : <div className="text-[12px] text-[#b45309]">No approved assessment without an incentive is available. Turn off the link to add a bonus/commission instead.</div>}
          </Form.Item>
        )}
        <Form.Item name="planId" label="Incentive plan (optional)"><Select allowClear options={plans.map((p) => ({ label: `${p.name} (${(p.type || 'BONUS').replace(/_/g, ' ')})`, value: p.id }))} /></Form.Item>
        <Form.Item name="amount" label="Amount" rules={[{ required: true, message: 'Enter an amount' }]}><InputNumber min={0.01} className="w-full" /></Form.Item>
        <Form.Item name="period" label="Period"><Input placeholder="e.g. 2026 Q3" /></Form.Item>
        <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
        <div className="text-[12px] text-[#94a3b8]">Performance-linked incentives require an authorized approval before they are sent to payroll.</div>
      </Form>
    </Drawer>
  );
}

// ======================================================================
// Payroll
// ======================================================================
export function PayrollTab() {
  const { id, currency, openDrawer } = useEmp();
  const { data, isLoading } = useQuery({ queryKey: ['emp-payroll-ws', id], queryFn: () => api(`/hr/employees/${id}/payroll-workspace`) });
  if (isLoading) return <Skeleton active />;
  const d = data?.details || {};
  const rows = data?.payslips || [];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniCard label="Basic salary" value={money(d.basicSalary, d.currency)} />
        <MiniCard label="Current net pay" value={rows[0] ? money(rows[0].netPay, d.currency) : '—'} />
        <MiniCard label="YTD gross" value={money(data?.ytd?.gross, d.currency)} />
        <MiniCard label="YTD net" value={money(data?.ytd?.net, d.currency)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DataCard title="Payroll details">
          <DetailItem label="Pay frequency" value={d.payFrequency} />
          <DetailItem label="Basic salary" value={money(d.basicSalary, d.currency)} />
          <DetailItem label="Currency" value={d.currency} />
          <DetailItem label="Compensation type" value={d.compensationType} />
          <DetailItem label="Bank" value={d.bank?.bankName} />
          <DetailItem label="Account" value={d.bank?.accountNumberMasked} />
          <DetailItem label="Account name" value={d.bank?.accountName} />
          <DetailItem label="Tax profile" value={d.taxDetails ? JSON.stringify(d.taxDetails) : '—'} />
        </DataCard>

        <DataCard title="Current payroll inputs">
          {(data?.inputs || []).length ? (data!.inputs as any[]).map((i, k) => (
            <div key={k} className="flex items-center justify-between border-b border-[#f0f1f6] last:border-0 py-2.5">
              <div><div className="text-[13px] text-[#344054]">{i.label}</div><div className="text-[11px] text-[#94a3b8]">Source: {i.source}{i.sourceRef ? ` · ${i.sourceRef}` : ''}</div></div>
              <div className="text-[13px] font-semibold text-[#171a2e]">{i.unit ? `${fmtNumber(i.amount, 1)} ${i.unit}` : money(i.amount, d.currency)}</div>
            </div>
          )) : <div className="text-[13px] text-[#94a3b8] py-4 text-center">No current payroll inputs.</div>}
        </DataCard>
      </div>

      <StatutoryProfileCard id={id} />

      <DataCard title="Payroll history" bodyClass="p-0">
        <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 10 }} locale={{ emptyText: <EmptyState title="No payroll history available." /> }} columns={[
          { title: 'Period', render: (_v, r) => `${r.payrollRun?.period}/${r.payrollRun?.year}` },
          { title: 'Gross', dataIndex: 'grossPay', align: 'right', render: (v) => money(v, d.currency) },
          { title: 'Deductions', align: 'right', render: (_v, r) => money(toNumLocal(r.payeTax) + toNumLocal(r.nssaDeduction) + toNumLocal(r.otherDeductions), d.currency) },
          { title: 'Net', dataIndex: 'netPay', align: 'right', render: (v) => <span className="font-semibold">{money(v, d.currency)}</span> },
          { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
          { title: 'Paid date', render: (_v, r) => fmtDate(r.payrollRun?.payDate || r.publishedAt) },
          { title: 'Payslip', render: (_v, r) => <Button size="small" onClick={() => openDrawer('payslip', r)}>View</Button> },
          { title: 'Actions', width: 150, render: (_v, r) => (
            <Space size={4}>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadPayslipPdf(r.id, `Payslip_${r.employeeId}_${r.payrollRun?.period}_${r.payrollRun?.year}.pdf`)}>PDF</Button>
              <Button size="small" icon={<MailOutlined />} onClick={() => message.info('Use Payslips → Email to send the payslip.')}>Email</Button>
            </Space>
          ) },
        ] as ColumnsType<any>} />
      </DataCard>
    </div>
  );
}

// ======================================================================
// Documents
// ======================================================================
const DOC_CATEGORIES = ['EMPLOYMENT_CONTRACT', 'ID_PASSPORT', 'TAX', 'QUALIFICATION', 'CERTIFICATION', 'PERFORMANCE', 'DISCIPLINARY', 'PAYROLL', 'MEDICAL_LEAVE', 'OTHER'];

export function DocumentsTab() {
  const { id, openDrawer, qc } = useEmp();
  const [category, setCategory] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const { data = [], isLoading } = useQuery({ queryKey: ['emp-docs', id], queryFn: () => api(`/hr/employees/${id}/documents`) });
  if (isLoading) return <Skeleton active />;
  const rows = (data as any[]).filter((d) => (!category || d.category === category) && (!status || d.expiryStatus === status));

  async function archive(doc: any) {
    try { await api(`/hr/employees/${id}/documents/${doc.id}`, { method: 'DELETE' }); message.success('Document archived'); qc.invalidateQueries({ queryKey: ['emp-docs', id] }); }
    catch (e: any) { message.error(e.message); }
  }

  return (
    <DataCard title="Documents" extra={
      <Space>
        <Select allowClear placeholder="Category" style={{ width: 180 }} value={category} onChange={setCategory} options={DOC_CATEGORIES.map((c) => ({ label: c.replace(/_/g, ' '), value: c }))} />
        <Select allowClear placeholder="Status" style={{ width: 140 }} value={status} onChange={setStatus} options={['VALID', 'EXPIRING_SOON', 'EXPIRED', 'ARCHIVED'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <Can permission={['hr.documents.upload', 'hr.employees.manage']}><Button type="primary" icon={<UploadOutlined />} onClick={() => openDrawer('uploadDocument')}>Upload Document</Button></Can>
      </Space>
    } bodyClass="p-0">
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 10 }} locale={{ emptyText: <EmptyState title="No employee documents uploaded." action={<Can permission={['hr.documents.upload', 'hr.employees.manage']}><Button type="primary" onClick={() => openDrawer('uploadDocument')}>Upload Document</Button></Can>} /> }} columns={[
        { title: 'Document', render: (_v, r) => (<div><div className="font-medium">{r.title}</div><div className="text-[11px] text-[#94a3b8]">{r.fileName || '—'}{r.version > 1 ? ` · v${r.version}` : ''}</div></div>) },
        { title: 'Category', dataIndex: 'category', render: (v) => (v || '').replace(/_/g, ' ') },
        { title: 'Uploaded', dataIndex: 'createdAt', render: (v) => fmtDate(v) },
        { title: 'Expiry', dataIndex: 'expiryDate', render: (v) => fmtDate(v) },
        { title: 'Status', dataIndex: 'expiryStatus', render: (v) => <StatusPill status={v} /> },
        { title: 'Confidential', dataIndex: 'confidential', render: (v) => v ? <Tag color="red">Confidential</Tag> : '—' },
        { title: 'Actions', width: 220, render: (_v, r) => (
          <Space size={4}>
            {r.dataUrl && <Button size="small" onClick={() => { const a = document.createElement('a'); a.href = r.dataUrl; a.download = r.fileName || r.title; a.click(); }}>Download</Button>}
            <Can permission={['hr.documents.upload', 'hr.employees.manage']}><Button size="small" onClick={() => openDrawer('replaceDocument', r)}>Replace</Button></Can>
            <Can permission={['hr.documents.upload', 'hr.employees.manage']}>{r.status !== 'ARCHIVED' && <Button size="small" danger onClick={() => archive(r)}>Archive</Button>}</Can>
          </Space>
        ) },
      ] as ColumnsType<any>} />
    </DataCard>
  );
}

// ======================================================================
// Assets
// ======================================================================
export function AssetsTab() {
  const { id, openDrawer, qc } = useEmp();
  const { data = [], isLoading } = useQuery({ queryKey: ['emp-assets', id], queryFn: () => api(`/hr/employees/${id}/assets`) });
  if (isLoading) return <Skeleton active />;
  const rows = data as any[];
  return (
    <DataCard title="Assigned assets" extra={<Can permission={['assets.assign', 'assets.manage']}><Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer('assignAsset')}>Assign Asset</Button></Can>} bodyClass="p-0">
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 10 }} locale={{ emptyText: <EmptyState title="No assets currently assigned." action={<Can permission={['assets.assign', 'assets.manage']}><Button type="primary" onClick={() => openDrawer('assignAsset')}>Assign Asset</Button></Can>} /> }} columns={[
        { title: 'Asset #', render: (_v, r) => r.asset?.assetNo },
        { title: 'Asset', render: (_v, r) => r.asset?.name },
        { title: 'Category', render: (_v, r) => r.asset?.category },
        { title: 'Assigned date', dataIndex: 'assignedDate', render: (v) => fmtDate(v) },
        { title: 'Condition', dataIndex: 'condition' },
        { title: 'Location', dataIndex: 'location' },
        { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
        { title: 'Actions', width: 130, render: (_v, r) => (
          r.status === 'ASSIGNED' ? <Can permission={['assets.return', 'assets.manage']}><Button size="small" onClick={() => openDrawer('returnAsset', r)}>Return</Button></Can> : <span className="text-[12px] text-[#94a3b8]">Returned {fmtDate(r.returnedDate)}</span>
        ) },
      ] as ColumnsType<any>} />
    </DataCard>
  );
}

// ======================================================================
// Projects
// ======================================================================
export function ProjectsTab() {
  const { id, openDrawer, qc } = useEmp();
  const { data, isLoading } = useQuery({ queryKey: ['emp-projects', id], queryFn: () => api(`/hr/employees/${id}/projects`) });
  if (isLoading) return <Skeleton active />;
  const s = data?.summary || {};
  const rows = data?.memberships || [];

  async function endMember(m: any) {
    try { await api(`/hr/project-members/${m.id}/end`, { method: 'PATCH', body: JSON.stringify({}) }); message.success('Project membership ended'); qc.invalidateQueries({ queryKey: ['emp-projects', id] }); }
    catch (e: any) { message.error(e.message); }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniCard label="Active projects" value={s.activeProjects ?? 0} />
        <MiniCard label="Open tasks" value={s.openTasks ?? 0} />
        <MiniCard label="Overdue tasks" value={s.overdueTasks ?? 0} color={(s.overdueTasks ?? 0) > 0 ? '#dc2626' : undefined} />
        <MiniCard label="Billable hours" value={fmtNumber(s.billableHours, 1)} />
      </div>
      <DataCard title="Project assignments" extra={<Can permission="projects.assign_employee"><Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer('assignProject')}>Assign to Project</Button></Can>} bodyClass="p-0">
        <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 10 }} locale={{ emptyText: <EmptyState title="This employee is not assigned to any projects." action={<Can permission="projects.assign_employee"><Button type="primary" onClick={() => openDrawer('assignProject')}>Assign to Project</Button></Can>} /> }} columns={[
          { title: 'Project', render: (_v, r) => <Link href={`/projects/${r.projectId}`} className="font-medium text-[#1d5fb5]">{r.project?.name}</Link> },
          { title: 'Role', dataIndex: 'role' },
          { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
          { title: 'Tasks', render: (_v, r) => r.project?.tasks?.length || 0 },
          { title: 'Due date', render: (_v, r) => fmtDate(r.endDate) },
          { title: 'Hours', dataIndex: 'hours', align: 'right', render: (v) => fmtNumber(v, 1) },
          { title: 'Actions', width: 130, render: (_v, r) => (<Space size={4}><Link href={`/projects/${r.projectId}`}><Button size="small">Open</Button></Link>{r.status === 'ACTIVE' && <Can permission="projects.assign_employee"><Button size="small" danger onClick={() => endMember(r)}>End</Button></Can>}</Space>) },
        ] as ColumnsType<any>} expandable={{ expandedRowRender: (r) => (
          <Table rowKey="id" size="small" pagination={false} dataSource={r.project?.tasks || []} columns={[
            { title: 'Task', dataIndex: 'title' },
            { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
            { title: 'Progress', dataIndex: 'progress', render: (v) => `${v || 0}%` },
            { title: 'Due date', dataIndex: 'dueDate', render: (v) => fmtDate(v) },
          ] as ColumnsType<any>} />
        ) }} />
      </DataCard>
    </div>
  );
}

// ======================================================================
// Audit
// ======================================================================
export function AuditTab() {
  const { id, openDrawer } = useEmp();
  const [module, setModule] = useState<string | undefined>();
  const [action, setAction] = useState<string | undefined>();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const params = new URLSearchParams();
  if (module) params.set('module', module);
  if (action) params.set('action', action);
  if (range) { params.set('from', String(range[0].valueOf())); params.set('to', String(range[1].valueOf())); }
  const qs = params.toString();
  const { data, isLoading } = useQuery({ queryKey: ['emp-audit', id, qs], queryFn: () => api(`/hr/employees/${id}/audit${qs ? `?${qs}` : ''}`) });
  if (isLoading) return <Skeleton active />;
  const rows = data?.logs || [];
  return (
    <DataCard title="Audit trail" extra={
      <Space>
        <Select allowClear placeholder="Module" style={{ width: 150 }} value={module} onChange={setModule} options={(data?.modules || []).map((m: string) => ({ label: m, value: m }))} />
        <Select allowClear placeholder="Action" style={{ width: 150 }} value={action} onChange={setAction} options={Array.from(new Set(rows.map((r: any) => r.action))).map((a: any) => ({ label: a, value: a }))} />
        <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as any)} />
      </Space>
    } bodyClass="p-0">
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 12 }} locale={{ emptyText: <EmptyState title="No audit activity for this employee." /> }} columns={[
        { title: 'Date / time', dataIndex: 'createdAt', render: (v) => fmtDateTime(v), width: 150 },
        { title: 'Module', render: (_v, r) => r.module || r.entityType },
        { title: 'Action', dataIndex: 'action', render: (v) => <StatusPill status={v} /> },
        { title: 'Description', render: (_v, r) => r.entityType },
        { title: 'Changed by', render: (_v, r) => r.user ? `${r.user.firstName} ${r.user.lastName}` : 'System' },
        { title: 'Result', dataIndex: 'result', render: (v) => v ? <StatusPill status={v} /> : '—' },
        { title: 'Actions', width: 80, render: (_v, r) => <Button size="small" onClick={() => openDrawer('auditDetail', r)}>View</Button> },
      ] as ColumnsType<any>} />
    </DataCard>
  );
}

// ======================================================================
// Drawers
// ======================================================================
export function Employee360Drawers({ drawer, close, employee, refetchAll }: { drawer: { name: DrawerName; payload?: any } | null; close: () => void; employee: any; refetchAll: () => void }) {
  const id = employee?.id;
  const qc = useQueryClient();
  const name = drawer?.name;
  const payload = drawer?.payload;
  const done = (msg: string) => { message.success(msg); close(); refetchAll(); };

  if (name === 'edit') return <EmployeeDrawer open onClose={close} onSaved={() => done('Employee updated')} editing={employee} />;

  if (name === 'applyLeave') return <ApplyLeaveDrawer id={id} onClose={close} onSaved={() => done('Leave request submitted')} />;
  if (name === 'leaveDetail') return <LeaveDetailDrawer id={id} leave={payload} onClose={close} />;
  if (name === 'configureLeave') return <ConfigureLeaveDrawer id={id} onClose={close} onSaved={() => done('Leave balance configured')} />;
  if (name === 'adjustAttendance') return <AdjustAttendanceDrawer id={id} record={payload} onClose={close} onSaved={() => done('Attendance updated')} />;
  if (name === 'uploadDocument') return <DocumentDrawer id={id} onClose={close} onSaved={() => done('Document uploaded')} />;
  if (name === 'replaceDocument') return <DocumentDrawer id={id} replace={payload} onClose={close} onSaved={() => done('Document replaced')} />;
  if (name === 'assignAsset') return <AssignAssetDrawer id={id} onClose={close} onSaved={() => done('Asset assigned')} />;
  if (name === 'returnAsset') return <ReturnAssetDrawer id={id} assignment={payload} onClose={close} onSaved={() => done('Asset returned')} />;
  if (name === 'assignProject') return <AssignProjectDrawer id={id} onClose={close} onSaved={() => done('Assigned to project')} />;
  if (name === 'offboard') return <OffboardDrawer id={id} onClose={close} onSaved={() => done('Employee offboarded')} />;
  if (name === 'auditDetail') return <AuditDetailDrawer log={payload} onClose={close} />;
  if (name === 'payslip') return <PayslipDrawer payslip={payload} onClose={close} />;
  return null;
}

function ApplyLeaveDrawer({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [preview, setPreview] = useState<{ days: number; workingDays: string[] } | null>(null);
  const { data: ws } = useQuery({ queryKey: ['emp-leave-ws', id], queryFn: () => api(`/hr/employees/${id}/leave-workspace`) });
  const [saving, setSaving] = useState(false);

  async function recalc() {
    const v = form.getFieldsValue();
    if (!v.startDate || !v.endDate) return;
    try {
      const r = await api(`/hr/employees/${id}/leave-preview`, { method: 'POST', body: JSON.stringify({ startDate: v.startDate.format('YYYY-MM-DD'), endDate: v.endDate.format('YYYY-MM-DD'), halfDay: v.halfDay }) });
      setPreview(r);
    } catch { setPreview(null); }
  }

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await api(`/hr/employees/${id}/leave`, { method: 'POST', body: JSON.stringify({ leaveTypeId: v.leaveTypeId, leaveType: v.leaveType, startDate: v.startDate.format('YYYY-MM-DD'), endDate: v.endDate.format('YYYY-MM-DD'), halfDay: v.halfDay, reason: v.reason, approverId: v.approverId }) });
      onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Drawer title="Apply Leave (on behalf of employee)" width={560} open onClose={onClose} destroyOnClose
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Submit Leave Request</Button></div>}>
      <div className="mb-4 p-3 rounded-lg bg-[#f7f8fc] text-[13px]">
        <div className="font-semibold text-[#171a2e]">{employeeNameLabel(ws, id)}</div>
        <div className="text-[#64748b]">Employee is preselected (read only).</div>
      </div>
      <Form form={form} layout="vertical" onValuesChange={recalc} initialValues={{ halfDay: 'FULL', leaveTypeId: ws?.leaveTypes?.[0]?.id }}>
        <Form.Item name="leaveTypeId" label="Leave Type" rules={[{ required: true }]}>
          <Select options={(ws?.leaveTypes || []).map((t: any) => ({ label: `${t.name} (${t.code})`, value: t.id }))} onChange={(v) => { const t = (ws?.leaveTypes || []).find((x: any) => x.id === v); form.setFieldValue('leaveType', t?.code); }} />
        </Form.Item>
        <Form.Item name="leaveType" hidden><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="startDate" label="Start Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item name="endDate" label="End Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item></Col>
        </Row>
        <Form.Item name="halfDay" label="Half Day"><Select options={[{ label: 'Full day', value: 'FULL' }, { label: 'Morning', value: 'MORNING' }, { label: 'Afternoon', value: 'AFTERNOON' }]} /></Form.Item>
        <Form.Item name="reason" label="Reason"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="approverId" label="Approver"><Select allowClear options={(ws?.leaveTypes ? [] : [])} placeholder="Optional" /></Form.Item>
        <div className="p-3 rounded-lg border border-[#eef0f6] text-[13px]">
          <div className="flex justify-between"><span className="text-[#64748b]">Calculated working days</span><span className="font-semibold">{preview ? fmtNumber(preview.days, 1) : '—'}</span></div>
          <div className="flex justify-between mt-1"><span className="text-[#64748b]">Weekends & holidays excluded</span><span>{preview?.workingDays?.length ?? '—'} working day(s)</span></div>
        </div>
      </Form>
    </Drawer>
  );
}
function employeeNameLabel(ws: any, _id: string) { return ws?.requests?.[0]?.employee ? `${ws.requests[0].employee.firstName} ${ws.requests[0].employee.lastName}` : 'Current employee'; }

function LeaveDetailDrawer({ id, leave, onClose }: { id: string; leave: any; onClose: () => void }) {
  if (!leave) return null;
  return (
    <Drawer title="Leave details" width={480} open onClose={onClose}>
      <DetailItem label="Type" value={leave.leaveTypeRef?.name || leave.leaveType} />
      <DetailItem label="Start" value={fmtDate(leave.startDate)} />
      <DetailItem label="End" value={fmtDate(leave.endDate)} />
      <DetailItem label="Working days" value={fmtNumber(leave.days, 1)} />
      <DetailItem label="Half day" value={leave.halfDay} />
      <DetailItem label="Status" value={<StatusPill status={leave.status} />} />
      <DetailItem label="Reason" value={leave.reason} />
      <DetailItem label="Approver" value={leave.approverName || (leave.approver ? `${leave.approver.firstName} ${leave.approver.lastName}` : (leave.approvedByUser || '—'))} />
      <DetailItem label="Approved at" value={leave.approvedAt ? fmtDateTime(leave.approvedAt) : '—'} />
      <DetailItem label="Comments" value={leave.comments} />
    </Drawer>
  );
}

function ConfigureLeaveDrawer({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { data: types = [], isLoading } = useQuery({ queryKey: ['leave-types'], queryFn: () => api('/hr/leave-types') });
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ntCode, setNtCode] = useState('');
  const [ntName, setNtName] = useState('');
  const [ntDays, setNtDays] = useState<number>(20);

  async function createType() {
    if (!ntCode.trim() || !ntName.trim()) { message.warning('Leave type code and name are required'); return; }
    try {
      const created = await api('/hr/leave-types', { method: 'POST', body: JSON.stringify({ code: ntCode.trim().toUpperCase(), name: ntName.trim(), daysPerYear: Number(ntDays) || 0 }) });
      message.success('Leave type created');
      await qc.invalidateQueries({ queryKey: ['leave-types'] });
      if (created?.id) form.setFieldValue('leaveTypeId', created.id);
      setAdding(false); setNtCode(''); setNtName(''); setNtDays(20);
    } catch (e: any) { message.error(e.message); }
  }

  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try { await api(`/hr/employees/${id}/leave-balances/configure`, { method: 'POST', body: JSON.stringify(v) }); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer title="Configure leave balance" width={480} open onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save</Button></div>}>
      <Form form={form} layout="vertical">
        <Form.Item name="leaveTypeId" label="Leave type" rules={[{ required: true, message: 'Select or add a leave type' }]}>
          <Select
            loading={isLoading}
            placeholder={types.length ? 'Select leave type' : 'No leave types yet — add one below'}
            options={(types as any[]).map((t) => ({ label: `${t.name} (${t.code})`, value: t.id }))}
            popupRender={(menu) => (
              <>
                {menu}
                <div className="border-t border-[#eef0f6] my-1" />
                <Button type="text" size="small" block icon={<PlusOutlined />} onClick={() => setAdding((a) => !a)}>Add leave type</Button>
              </>
            )}
          />
        </Form.Item>

        {(adding || !types.length) && (
          <div className="p-3 mb-3 rounded-lg border border-[#eef0f6] bg-[#f9fafc]">
            <div className="text-[12px] font-semibold text-[#475060] mb-2">New leave type</div>
            <Row gutter={8}>
              <Col span={8}><Input placeholder="Code" value={ntCode} onChange={(e) => setNtCode(e.target.value)} /></Col>
              <Col span={10}><Input placeholder="Name" value={ntName} onChange={(e) => setNtName(e.target.value)} /></Col>
              <Col span={6}><InputNumber className="w-full" min={0} placeholder="Days" value={ntDays} onChange={(v) => setNtDays(Number(v || 0))} /></Col>
            </Row>
            <div className="mt-2 flex justify-end"><Button size="small" type="primary" onClick={createType}>Create leave type</Button></div>
          </div>
        )}

        <Form.Item name="balance" label="Additional balance (days)" rules={[{ required: true }]}><InputNumber className="w-full" /></Form.Item>
        <div className="text-[12px] text-[#94a3b8]">The configured balance is added on top of the leave type's annual entitlement.</div>
      </Form>
    </Drawer>
  );
}

function AdjustAttendanceDrawer({ id, record, onClose, onSaved }: { id: string; record?: any; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try {
      await api(`/hr/employees/${id}/attendance-adjust`, { method: 'POST', body: JSON.stringify({ date: v.date.format('YYYY-MM-DD'), checkIn: v.checkIn?.format('YYYY-MM-DDTHH:mm:ss'), checkOut: v.checkOut?.format('YYYY-MM-DDTHH:mm:ss'), status: v.status, reason: v.reason, note: v.note }) });
      onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer title="Adjust attendance" width={520} open onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save correction</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ date: record ? dayjs(record.date) : dayjs(), checkIn: record?.checkIn ? dayjs(record.checkIn) : undefined, checkOut: record?.checkOut ? dayjs(record.checkOut) : undefined, status: record?.status || 'PRESENT' }}>
        <Form.Item name="date" label="Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="checkIn" label="Corrected Clock In"><DatePicker showTime className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item name="checkOut" label="Corrected Clock Out"><DatePicker showTime className="w-full" /></Form.Item></Col>
        </Row>
        <Form.Item name="status" label="Status"><Select options={['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY'].map((s) => ({ label: s, value: s }))} /></Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true, message: 'Reason is required and will be audited' }]}><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="note" label="Note"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function DocumentDrawer({ id, replace, onClose, onSaved }: { id: string; replace?: any; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [file, setFile] = useState<{ dataUrl: string; name: string; mime: string; size: number } | null>(null);
  const [saving, setSaving] = useState(false);
  function readFile(f: any) {
    const reader = new FileReader();
    reader.onload = () => setFile({ dataUrl: String(reader.result), name: f.name, mime: f.type, size: f.size });
    reader.readAsDataURL(f);
    return false;
  }
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    const body = { category: v.category, title: v.title, issueDate: v.issueDate?.format('YYYY-MM-DD'), expiryDate: v.expiryDate?.format('YYYY-MM-DD'), description: v.description, confidential: v.confidential, fileName: file?.name, mime: file?.mime, size: file?.size, dataUrl: file?.dataUrl };
    try {
      if (replace) await api(`/hr/employees/${id}/documents/${replace.id}/replace`, { method: 'POST', body: JSON.stringify(body) });
      else await api(`/hr/employees/${id}/documents`, { method: 'POST', body: JSON.stringify(body) });
      onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer title={replace ? 'Replace document (new version)' : 'Upload document'} width={520} open onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ category: replace?.category || 'EMPLOYMENT_CONTRACT', title: replace?.title, confidential: replace?.confidential }}>
        <Form.Item name="category" label="Document Type" rules={[{ required: true }]}><Select options={DOC_CATEGORIES.map((c) => ({ label: c.replace(/_/g, ' '), value: c }))} /></Form.Item>
        <Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="File" required>
          <Upload beforeUpload={readFile} maxCount={1}><Button icon={<UploadOutlined />}>Select file</Button></Upload>
          {file && <div className="text-[12px] text-[#64748b] mt-1">{file.name}</div>}
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="issueDate" label="Issue Date"><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item name="expiryDate" label="Expiry Date"><DatePicker className="w-full" /></Form.Item></Col>
        </Row>
        <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="confidential" label="Confidential" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
  );
}

function AssignAssetDrawer({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const { data: assets = [] } = useQuery({ queryKey: ['assets-available'], queryFn: () => api('/hr/assets/available') });
  const [saving, setSaving] = useState(false);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try { await api(`/hr/employees/${id}/assets`, { method: 'POST', body: JSON.stringify({ ...v, assignedDate: v.assignedDate?.format('YYYY-MM-DD') }) }); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer title="Assign asset" width={480} open onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Assign</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ assignedDate: dayjs(), condition: 'GOOD' }}>
        <Form.Item name="assetId" label="Asset" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(assets as any[]).map((a) => ({ label: `${a.assetNo} · ${a.name}`, value: a.id }))} /></Form.Item>
        <Form.Item name="assignedDate" label="Assignment Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
        <Form.Item name="condition" label="Condition at assignment"><Select options={['NEW', 'GOOD', 'FAIR', 'POOR'].map((c) => ({ label: c, value: c }))} /></Form.Item>
        <Form.Item name="location" label="Location"><Input /></Form.Item>
        <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="acknowledged" label="Acknowledgement received" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
  );
}

function ReturnAssetDrawer({ id, assignment, onClose, onSaved }: { id: string; assignment: any; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try { await api(`/hr/employees/${id}/assets/${assignment.id}/return`, { method: 'POST', body: JSON.stringify({ condition: v.condition, location: v.location, notes: v.notes, returnedDate: v.returnedDate?.format('YYYY-MM-DD') }) }); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer title={`Return asset — ${assignment?.asset?.assetNo || ''}`} width={460} open onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Return asset</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ returnedDate: dayjs(), condition: 'GOOD' }}>
        <Form.Item name="returnedDate" label="Return Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
        <Form.Item name="condition" label="Condition"><Select options={['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'].map((c) => ({ label: c, value: c }))} /></Form.Item>
        <Form.Item name="location" label="Location"><Input /></Form.Item>
        <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function AssignProjectDrawer({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const { data: projects = [] } = useQuery({ queryKey: ['projects-available', id], queryFn: () => api(`/hr/projects/available?employeeId=${id}`) });
  const [saving, setSaving] = useState(false);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try { await api(`/hr/employees/${id}/projects`, { method: 'POST', body: JSON.stringify({ ...v, startDate: v.startDate?.format('YYYY-MM-DD'), endDate: v.endDate?.format('YYYY-MM-DD') }) }); onSaved(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer title="Assign to project" width={480} open onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Assign</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ allocationPct: 100, billable: true, role: 'Member' }}>
        <Form.Item name="projectId" label="Project" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(projects as any[]).map((p) => ({ label: p.name, value: p.id }))} /></Form.Item>
        <Form.Item name="role" label="Role"><Select options={['Member', 'Project Manager', 'Assignee', 'Resource', 'Reviewer'].map((r) => ({ label: r, value: r }))} /></Form.Item>
        <Form.Item name="allocationPct" label="Allocation %"><InputNumber min={1} max={100} className="w-full" /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="startDate" label="Start Date"><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item name="endDate" label="End Date"><DatePicker className="w-full" /></Form.Item></Col>
        </Row>
        <Form.Item name="billable" label="Billable" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
  );
}

function OffboardDrawer({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['emp-offboard', id], queryFn: () => api(`/hr/employees/${id}/offboarding-checklist`) });
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try {
      await api(`/hr/employees/${id}/offboard-with-check`, { method: 'POST', body: JSON.stringify({ reason: v.reason, terminationDate: v.terminationDate?.format('YYYY-MM-DD'), force: !!data?.blockers?.length }) });
      onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer title="Offboard employee" width={560} open onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button danger type="primary" loading={saving} onClick={submit}>Offboard</Button></div>}>
      {isLoading ? <Skeleton active /> : (
        <>
          {(data?.blockers || []).length > 0 && <Alert type="warning" showIcon className="mb-4" message="Unresolved dependencies" description={<ul className="list-disc pl-4">{(data!.blockers as string[]).map((b, i) => <li key={i}>{b}</li>)}</ul>} />}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <MiniCard label="Assigned assets" value={data?.assets?.length || 0} />
            <MiniCard label="Active projects" value={data?.projects?.length || 0} />
            <MiniCard label="Pending leave" value={data?.leave?.length || 0} />
            <MiniCard label="Leave available" value={`${fmtNumber(data?.leaveAvailable, 1)} d`} />
          </div>
          <div className="space-y-2 mb-4">
            <div className="text-[13px] text-[#344054]">Assets: <Link href={`/hr/employees/${id}?tab=assets`}>Review assets</Link></div>
            <div className="text-[13px] text-[#344054]">Projects: <Link href={`/hr/employees/${id}?tab=projects`}>Review projects</Link></div>
            <div className="text-[13px] text-[#344054]">Leave: <Link href={`/hr/employees/${id}?tab=leave`}>Review leave</Link></div>
            <div className="text-[13px] text-[#344054]">User account: {data?.userAccount ? <>{data.userAccount.status} · <Link href="/administration/security">Review access</Link></> : 'None'}</div>
          </div>
          <Form form={form} layout="vertical" initialValues={{ terminationDate: dayjs() }}>
            <Form.Item name="terminationDate" label="Last Working Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
            <Form.Item name="reason" label="Reason" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          </Form>
        </>
      )}
    </Drawer>
  );
}

function StatutoryProfileCard({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['emp-statutory', id], queryFn: () => api(`/hr/employees/${id}/statutory-profile`) });
  const [busy, setBusy] = useState<string | null>(null);
  if (isLoading || !data) return <DataCard title="Statutory profile"><Skeleton active paragraph={{ rows: 2 }} /></DataCard>;
  async function toggle(code: string, exempt: boolean) {
    setBusy(code);
    const codes = (data.rules || []).filter((r: any) => (r.code === code ? !exempt : r.exempt)).map((r: any) => r.code);
    try {
      await api(`/hr/employees/${id}/statutory-exemptions`, { method: 'POST', body: JSON.stringify({ codes, reason: 'Updated from employee payroll profile' }) });
      message.success('Statutory exemptions updated'); qc.invalidateQueries({ queryKey: ['emp-statutory', id] });
    } catch (e: any) { message.error(e.message); } finally { setBusy(null); }
  }
  return (
    <DataCard title="Statutory profile" extra={<span className="text-[12px] text-[#94a3b8]">Rules resolved from company payroll country</span>}>
      {(data.rules || []).length ? (data.rules as any[]).map((r) => (
        <div key={r.code} className="flex items-center justify-between py-2 border-b border-[#f0f1f6] last:border-0">
          <div><div className="text-[13px] text-[#344054] font-medium">{r.name} <span className="text-[11px] text-[#94a3b8]">{r.code}</span></div><div className="text-[11px] text-[#94a3b8]">{(r.ruleType || '').replace(/_/g, ' ')}</div></div>
          <div className="flex items-center gap-3">
            {r.applies && !r.exempt ? <Tag color="green">ACTIVE</Tag> : <Tag>Not applicable</Tag>}
            <Can permission={['payroll.settings.statutory.manage', 'payroll.process']}>
              <Tooltip title={r.exempt ? 'Exempt' : 'Applied'}><Switch size="small" checked={!r.exempt} loading={busy === r.code} onChange={(checked) => toggle(r.code, !checked)} /></Tooltip>
            </Can>
          </div>
        </div>
      )) : <div className="text-[13px] text-[#94a3b8] py-3">No statutory rules configured for this payroll country.</div>}
    </DataCard>
  );
}

function PayslipDrawer({ payslip, onClose }: { payslip: any; onClose: () => void }) {
  const qc = useQueryClient();
  if (!payslip) return null;
  const p = payslip;
  const monthName = (n: number) => new Date(2000, (Number(n) || 1) - 1, 1).toLocaleString('en-US', { month: 'long' });
  const deductions = toNumLocal(p.payeTax) + toNumLocal(p.nssaDeduction) + toNumLocal(p.otherDeductions);
  async function publish() {
    try { await api(`/hr/payslips/${p.id}/publish`, { method: 'POST' }); message.success('Payslip published'); qc.invalidateQueries({ queryKey: ['emp-payroll-ws'] }); onClose(); }
    catch (e: any) { message.error(e.message); }
  }
  return (
    <Drawer open onClose={onClose} width={560} title="Payslip" destroyOnHidden
      extra={<Space size="small">
        {p.status !== 'VOID' && <Can permission="payroll.payslips.publish"><Button size="small" disabled={p.status === 'PUBLISHED'} onClick={publish}>Publish</Button></Can>}
        <Button size="small" icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadPayslipPdf(p.id, `Payslip_${p.employeeId}_${p.payrollRun?.period}_${p.payrollRun?.year}.pdf`)}>PDF</Button>
        <Button size="small" onClick={onClose}>Close</Button>
      </Space>}>
      <div id="payslip-print">
        <div className="print-note no-print text-[12px] text-[#64748b] mb-3 bg-[#f8fafc] border border-[#e6e9f2] rounded px-3 py-2">Use Print to save as PDF, or click PDF to download the generated payslip.</div>
        <div className="border border-[#e6e9f2] rounded-lg overflow-hidden">
          <div className="px-5 py-4 bg-[#0b2a4a] text-white">
            <div className="text-[16px] font-bold">NexusERP</div>
            <div className="text-[12px] text-white/70">Payslip · {monthName(p.payrollRun?.period)} {p.payrollRun?.year}</div>
          </div>
          <div className="px-5 py-4 border-b border-[#e6e9f2] grid grid-cols-2 gap-3">
            <div>
              <div className="text-[12px] text-[#64748b]">Employee</div>
              <div className="text-[14px] font-semibold text-[#171a2e]">{p.employee?.firstName} {p.employee?.lastName}</div>
              <div className="text-[12px] text-[#64748b]">{p.employee?.employeeNo}</div>
            </div>
            <div>
              <div className="text-[12px] text-[#64748b]">Department</div>
              <div className="text-[14px] text-[#171a2e]">{p.employee?.department?.name || '—'}</div>
              <div className="text-[12px] text-[#64748b]">Pay date {fmtDate(p.payrollRun?.payDate)}</div>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b] mb-2">Earnings</div>
            <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">Base salary</span><span className="font-medium text-[#171a2e]">{money(p.basicSalary, p.employee?.currency)}</span></div>
            {toNumLocal(p.bonusAmount) > 0 && (
              <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]">
                <span className="text-[#344054]">Performance Bonus<br /><span className="text-[11px] text-[#1d5fb5]">{(p.bonusReferences || []).map((b: any) => `${b.reference} · ${b.cycle}`).join(', ')}</span></span>
                <span className="font-medium text-[#171a2e]">{money(p.bonusAmount, p.employee?.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">Gross pay</span><span className="font-medium text-[#171a2e]">{money(p.grossPay, p.employee?.currency)}</span></div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b] mt-5 mb-2">Deductions</div>
            <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">PAYE tax</span><span>{money(p.payeTax, p.employee?.currency)}</span></div>
            <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">NSSA (employee)</span><span>{money(p.nssaDeduction, p.employee?.currency)}</span></div>
            <div className="flex justify-between text-[13px] py-2 border-b border-[#f0f1f6]"><span className="text-[#344054]">Other deductions</span><span>{money(p.otherDeductions, p.employee?.currency)}</span></div>
            <div className="flex justify-between text-[13px] py-2"><span className="text-[#344054]">Total deductions</span><span className="font-medium">{money(deductions, p.employee?.currency)}</span></div>
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#e6e9f2]">
              <span className="text-[15px] font-semibold text-[#171a2e]">NET PAY</span>
              <span className="text-[22px] font-bold text-[#0b2a4a]">{money(p.netPay, p.employee?.currency)}</span>
            </div>
            <div className="mt-3 text-[12px] text-[#64748b]">Status: {p.status}{p.publishedAt ? ` · Published ${fmtDate(p.publishedAt)}` : ''}</div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function AuditDetailDrawer({ log, onClose }: { log: any; onClose: () => void }) {
  if (!log) return null;
  return (
    <Drawer title="Audit detail" width={520} open onClose={onClose}>
      <DetailItem label="Date" value={fmtDateTime(log.createdAt)} />
      <DetailItem label="Action" value={log.action} />
      <DetailItem label="User" value={log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'} />
      <DetailItem label="Module" value={log.module || log.entityType} />
      <DetailItem label="Record" value={`${log.entityType} ${log.entityId || ''}`} />
      <DetailItem label="Result" value={log.result} />
      <DetailItem label="Reason" value={log.reason} />
      <DetailItem label="Correlation ID" value={log.correlationId} />
      <div className="mt-3">
        <div className="text-[12px] font-semibold text-[#64748b] mb-1">Metadata</div>
        <pre className="text-[11px] bg-[#f7f8fc] p-3 rounded-lg overflow-auto max-h-64">{JSON.stringify(log.metadata || {}, null, 2)}</pre>
      </div>
    </Drawer>
  );
}
