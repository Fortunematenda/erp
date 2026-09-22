'use client';
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Alert, Button, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Row, Segmented,
  Select, Skeleton, Space, Switch, Table, Tabs, Tag, Tooltip, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, CloseOutlined, EditOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill, DetailItem, EmptyState } from '@/components/sales-ui';
import { EmployeeSelector } from '@/components/employee-selector';
import { RowActionsMenu, ACTIONS_COL } from '@/components/row-actions-menu';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';

const SESSION_OPTS = [{ label: 'Full day', value: 'FULL' }, { label: 'Half day AM', value: 'AM' }, { label: 'Half day PM', value: 'PM' }];
const STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'WITHDRAWN'];
const ACCRUAL = ['ANNUAL_GRANT', 'MONTHLY', 'PER_PAY_PERIOD', 'MANUAL', 'NONE'];
const CARRY = ['NONE', 'ALL', 'MAX', 'PERCENT', 'MANUAL'];

function money0(v: any) { return fmtNumber(v, 1); }

export function LeaveManagement() {
  const qc = useQueryClient();
  const [sub, setSub] = useState('requests');
  const [requestDrawer, setRequestDrawer] = useState<{ id?: string; open: boolean; presetEmployee?: string } | null>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [typeDrawer, setTypeDrawer] = useState<{ open: boolean; editing?: any; view?: boolean } | null>(null);
  const [holidayDrawer, setHolidayDrawer] = useState<{ open: boolean; editing?: any; view?: boolean } | null>(null);

  const departments = useQuery({ queryKey: ['/hr/departments'], queryFn: () => api('/hr/departments') });
  const yearsQ = useQuery({ queryKey: ['/hr/leave/years'], queryFn: () => api('/hr/leave/years') });
  const refresh = () => ['/hr/leave/requests', '/hr/leave/balances', '/hr/leave/types', '/hr/leave/holidays', '/hr/leave/calendar'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  return (
    <div className="py-2">
      <Tabs className="nexus-section-tabs" activeKey={sub} onChange={setSub} items={[
        { key: 'requests', label: 'Requests', children: <RequestsTab departments={departments.data || []} onOpen={(id) => setRequestDrawer({ id, open: true })} onNew={() => setRequestDrawer({ open: true })} /> },
        { key: 'calendar', label: 'Calendar', children: <CalendarTab departments={departments.data || []} onOpen={(id) => setRequestDrawer({ id, open: true })} /> },
        { key: 'balances', label: 'Balances', children: <BalancesTab departments={departments.data || []} years={yearsQ.data || []} onLedger={setLedger} /> },
        { key: 'types', label: 'Leave Types', children: <LeaveTypesTab onView={(t) => setTypeDrawer({ open: true, editing: t, view: true })} onEdit={(t) => setTypeDrawer({ open: true, editing: t })} onCreate={() => setTypeDrawer({ open: true })} /> },
        { key: 'holidays', label: 'Holidays', children: <HolidaysTab years={yearsQ.data || []} departments={departments.data || []} onView={(h) => setHolidayDrawer({ open: true, editing: h, view: true })} onEdit={(h) => setHolidayDrawer({ open: true, editing: h })} onCreate={() => setHolidayDrawer({ open: true })} /> },
      ]} />

      {requestDrawer?.open && (
        <LeaveRequestDrawer id={requestDrawer.id} presetEmployee={requestDrawer.presetEmployee} onClose={() => setRequestDrawer(null)} onSaved={() => { setRequestDrawer(null); refresh(); }} />
      )}
      {ledger && <LedgerDrawer data={ledger} onClose={() => setLedger(null)} />}
      {typeDrawer?.open && <LeaveTypeDrawer editing={typeDrawer.editing} view={typeDrawer.view} onClose={() => setTypeDrawer(null)} onSaved={() => { setTypeDrawer(null); refresh(); }} />}
      {holidayDrawer?.open && <HolidayDrawer editing={holidayDrawer.editing} view={holidayDrawer.view} departments={departments.data || []} onClose={() => setHolidayDrawer(null)} onSaved={() => { setHolidayDrawer(null); refresh(); }} />}
    </div>
  );
}

// ======================================================================
// Requests
// ======================================================================
function RequestsTab({ departments, onOpen, onNew }: { departments: any[]; onOpen: (id: string) => void; onNew: () => void }) {
  const [f, setF] = useState<any>({});
  const types = useQuery({ queryKey: ['/hr/leave/types'], queryFn: () => api('/hr/leave/types') });
  const params = new URLSearchParams();
  if (f.status) params.set('status', f.status);
  if (f.leaveTypeId) params.set('leaveTypeId', f.leaveTypeId);
  if (f.departmentId) params.set('departmentId', f.departmentId);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  const qs = params.toString();
  const { data = [], isLoading } = useQuery({ queryKey: ['/hr/leave/requests', qs], queryFn: () => api(`/hr/leave/requests${qs ? `?${qs}` : ''}`), placeholderData: keepPreviousData });
  const rows = (data as any[]).filter((r) => !f.search || `${r.employee?.firstName} ${r.employee?.lastName} ${r.employee?.employeeNo}`.toLowerCase().includes(f.search.toLowerCase()));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 py-3">
        <Input allowClear placeholder="Search employee..." style={{ width: 190 }} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <Select allowClear placeholder="Leave type" style={{ width: 150 }} value={f.leaveTypeId} onChange={(v) => setF({ ...f, leaveTypeId: v })} options={(types.data || []).map((t: any) => ({ label: t.name, value: t.id }))} />
        <Select allowClear placeholder="Status" style={{ width: 130 }} value={f.status} onChange={(v) => setF({ ...f, status: v })} options={STATUSES.map((s) => ({ label: s, value: s }))} />
        <Select allowClear placeholder="Department" style={{ width: 160 }} value={f.departmentId} onChange={(v) => setF({ ...f, departmentId: v })} options={departments.map((d) => ({ label: d.name, value: d.id }))} />
        <DatePicker.RangePicker onChange={(v) => setF({ ...f, from: v?.[0]?.format('YYYY-MM-DD'), to: v?.[1]?.format('YYYY-MM-DD') })} />
        <div className="ml-auto"><Can permission={['hr.leave.create', 'hr.leave.request', 'hr.leave.manage']}><Button type="primary" icon={<PlusOutlined />} onClick={onNew}>New Leave Request</Button></Can></div>
      </div>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={rows} pagination={{ pageSize: 12 }} scroll={{ x: 1100 }} columns={[
        { title: 'Employee', render: (_v, r) => <div><div className="text-[13px] font-medium text-[#171a2e]">{r.employee?.firstName} {r.employee?.lastName}</div><div className="text-[11px] text-[#94a3b8]">{r.employee?.employeeNo}{r.department ? ` · ${r.department}` : ''}</div></div>, sorter: (a: any, b: any) => `${a.employee?.firstName}`.localeCompare(`${b.employee?.firstName}`) },
        { title: 'Leave Type', render: (_v, r) => r.leaveType, width: 150 },
        { title: 'Start', dataIndex: 'startDate', width: 110, render: (v) => fmtDate(v), sorter: (a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime() },
        { title: 'End', dataIndex: 'endDate', width: 110, render: (v) => fmtDate(v) },
        { title: 'Days', dataIndex: 'days', width: 70, align: 'right', render: (v) => fmtNumber(v, 1), sorter: (a: any, b: any) => Number(a.days) - Number(b.days) },
        { title: 'Balance After', dataIndex: 'balanceAfter', width: 110, align: 'right', render: (v) => v != null ? `${money0(v)} days` : '—' },
        { title: 'Submitted', dataIndex: 'submittedAt', width: 120, render: (v) => fmtDate(v), sorter: (a: any, b: any) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime() },
        { title: 'Approver', dataIndex: 'approverName', width: 140, render: (v) => v || '—' },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusPill status={v} />, sorter: (a: any, b: any) => `${a.status}`.localeCompare(`${b.status}`) },
        { title: 'Actions', width: 90, render: (_v, r) => <Button size="small" onClick={() => onOpen(r.id)}>View</Button> },
      ] as ColumnsType<any>} />
    </div>
  );
}

// ======================================================================
// Leave request drawer (view + actions)
// ======================================================================
function LeaveRequestDrawer({ id, presetEmployee, onClose, onSaved }: { id?: string; presetEmployee?: string; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'VIEW' | 'NEW'>(id ? 'VIEW' : 'NEW');
  const detail = useQuery({ queryKey: ['/hr/leave/requests', id], queryFn: () => api(`/hr/leave/requests/${id}`), enabled: mode === 'VIEW' && !!id });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const d = detail.data;
  const req = d?.request;
  async function act(action: string, body?: any) {
    try {
      await api(`/hr/leave/requests/${id}/${action}`, { method: 'POST', body: JSON.stringify(body || {}) });
      message.success(`Leave ${action}d`); onSaved();
    } catch (e: any) { message.error(e.message); }
  }

  if (mode === 'NEW') return <LeaveRequestFormDrawer presetEmployee={presetEmployee} onClose={onClose} onSaved={onSaved} />;
  if (!req) return <Drawer open onClose={onClose} width={820} title="Leave request">{detail.isLoading ? <Skeleton active /> : <Empty description="Not found" />}</Drawer>;

  const b = d.balance;
  const canApprove = ['PENDING', 'SUBMITTED', 'PENDING_APPROVAL', 'DRAFT'].includes(req.status);
  const canCancel = ['PENDING', 'APPROVED', 'SUBMITTED', 'PENDING_APPROVAL', 'DRAFT'].includes(req.status);
  const canEdit = ['PENDING', 'DRAFT', 'SUBMITTED', 'PENDING_APPROVAL'].includes(req.status);

  return (
    <Drawer open onClose={onClose} width={820} destroyOnHidden
      title={<div><div className="text-[16px] font-bold text-[#171a2e]">{req.leaveTypeRef?.name || req.leaveType}</div><div className="text-[12px] text-[#64748b] font-normal">{req.employee?.firstName} {req.employee?.lastName} · {req.employee?.employeeNo}</div></div>}
      extra={<Space size="small">
        <StatusPill status={req.status} />
        {canEdit && <Can permission={['hr.leave.edit', 'hr.leave.manage']}><Button size="small" icon={<EditOutlined />} onClick={() => setMode('NEW')}>Edit</Button></Can>}
        {canApprove && <Can permission={['hr.leave.approve', 'hr.leave.manage']}><Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => act('approve')}>Approve</Button></Can>}
        {canApprove && <Can permission={['hr.leave.reject', 'hr.leave.approve', 'hr.leave.manage']}><Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejectOpen(true)}>Reject</Button></Can>}
        {canCancel && <Can permission={['hr.leave.cancel', 'hr.leave.manage']}><Button size="small" onClick={() => act('cancel', { reason: 'Cancelled by HR' })}>Cancel</Button></Can>}
      </Space>}>
      <div className="space-y-4">
        <Section title="Request">
          <DetailItem label="Employee" value={`${req.employee?.firstName} ${req.employee?.lastName}`} />
          <DetailItem label="Department" value={req.employee?.department?.name} />
          <DetailItem label="Branch" value={req.employee?.department?.branch?.name} />
          <DetailItem label="Leave type" value={req.leaveTypeRef?.name || req.leaveType} />
          <DetailItem label="Start date" value={`${fmtDate(req.startDate)} (${req.startSession})`} />
          <DetailItem label="End date" value={`${fmtDate(req.endDate)} (${req.endSession})`} />
          <DetailItem label="Weekend treatment" value={req.includeWeekends ? 'Include weekends' : 'Exclude non-working weekends'} />
          <DetailItem label="Holiday treatment" value={req.includeHolidays ? 'Include public holidays' : 'Exclude public holidays'} />
        </Section>
        <Section title="Leave calculation">
          <DetailItem label="Calendar days" value={req.calendarDays} />
          <DetailItem label="Non-working weekend days" value={req.weekendDays} />
          <DetailItem label="Public holidays" value={req.holidayDays} />
          <DetailItem label="Working leave days" value={<span className="font-semibold">{fmtNumber(req.days, 1)}</span>} />
        </Section>
        {b && (
          <Section title="Balance">
            <DetailItem label="Opening balance (available)" value={`${fmtNumber(b.available, 1)} days`} />
            <DetailItem label="Approved / used" value={`${fmtNumber(b.used, 1)} days`} />
            <DetailItem label="Pending" value={`${fmtNumber(b.pending, 1)} days`} />
            <DetailItem label="Balance after" value={req.balanceAfter != null ? `${fmtNumber(req.balanceAfter, 1)} days` : '—'} />
          </Section>
        )}
        <Section title="Approval">
          <DetailItem label="Submitted by" value={req.requestedById ? 'HR / Employee' : '—'} />
          <DetailItem label="Submitted at" value={fmtDateTime(req.createdAt)} />
          <DetailItem label="Approver" value={d.approverName || '—'} />
          <DetailItem label="Approved / rejected at" value={req.approvedAt ? fmtDateTime(req.approvedAt) : '—'} />
          <DetailItem label="Comment / reason" value={req.rejectionReason || req.comments} />
        </Section>
        <Section title="Reason / Attachment">
          <DetailItem label="Reason" value={req.reason} />
          <DetailItem label="Attachment" value={req.attachment ? <a href={req.attachment} target="_blank" rel="noreferrer">View attachment</a> : '—'} />
        </Section>
        <Section title="Audit">
          {(d.audit || []).map((a: any, i: number) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-[#f0f1f6] last:border-0 text-[13px]">
              <span className="text-[#344054]">{a.action.replace(/_/g, ' ')} · {a.user}</span>
              <span className="text-[#94a3b8] text-[12px]">{fmtDateTime(a.at)}</span>
            </div>
          ))}
          {!d.audit?.length && <div className="text-[13px] text-[#94a3b8] py-2">No audit entries.</div>}
        </Section>
      </div>

      <Drawer open={rejectOpen} onClose={() => setRejectOpen(false)} width={420} title="Reject leave request"
        footer={<div className="flex justify-end gap-2"><Button onClick={() => setRejectOpen(false)}>Cancel</Button><Button danger type="primary" onClick={() => act('reject', { reason })}>Reject</Button></div>}>
        <div className="text-[13px] text-[#64748b] mb-2">A reason is required and will be shared with the employee.</div>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rejection reason *" />
      </Drawer>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="nex-card border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-[#f7f8fc] text-[13px] font-semibold text-[#171a2e] border-b border-[#eef0f6]">{title}</div>
      <div className="p-2">{children}</div>
    </div>
  );
}

// ======================================================================
// New / edit leave request
// ======================================================================
function LeaveRequestFormDrawer({ presetEmployee, onClose, onSaved }: { presetEmployee?: string; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [calc, setCalc] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [overlaps, setOverlaps] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const types = useQuery({ queryKey: ['/hr/leave/types'], queryFn: () => api('/hr/leave/types') });
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });
  const [empId, setEmpId] = useState<string | undefined>(presetEmployee);
  const [typeId, setTypeId] = useState<string | undefined>();
  const type = (types.data || []).find((t: any) => t.id === typeId);

  async function recalc() {
    const v = form.getFieldsValue();
    if (!v.employeeId || !v.leaveTypeId || !v.startDate || !v.endDate) { setCalc(null); return; }
    try {
      const res = await api('/hr/leave/calculate', { method: 'POST', body: JSON.stringify({ employeeId: v.employeeId, leaveTypeId: v.leaveTypeId, startDate: v.startDate.format('YYYY-MM-DD'), endDate: v.endDate.format('YYYY-MM-DD'), startSession: v.startSession, endSession: v.endSession, includeWeekends: v.includeWeekends, includeHolidays: v.includeHolidays }) });
      setCalc(res);
      const bal = await api(`/hr/leave/balances/${v.employeeId}/${v.leaveTypeId}/ledger`).catch(() => null);
      setBalance(bal?.balance || null);
    } catch (e: any) { message.error(e.message); setCalc(null); }
  }

  async function submit() {
    const v = await form.validateFields();
    setSaving(true); setOverlaps([]);
    try {
      await api('/hr/leave/requests', { method: 'POST', body: JSON.stringify({ employeeId: v.employeeId, leaveTypeId: v.leaveTypeId, startDate: v.startDate.format('YYYY-MM-DD'), endDate: v.endDate.format('YYYY-MM-DD'), startSession: v.startSession, endSession: v.endSession, includeWeekends: v.includeWeekends, includeHolidays: v.includeHolidays, reason: v.reason, attachment: v.attachment }) });
      message.success('Leave request submitted'); onSaved();
    } catch (e: any) {
      const msg = e.message || '';
      if (msg.toLowerCase().includes('overlap')) { setOverlaps([{ message: msg }]); }
      message.error(msg);
    } finally { setSaving(false); }
  }

  return (
    <Drawer open onClose={onClose} width={760} destroyOnHidden title="New Leave Request"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Submit Leave Request</Button></div>}>
      <Form form={form} layout="vertical" initialValues={{ startSession: 'FULL', endSession: 'FULL', includeWeekends: false, includeHolidays: false, employeeId: presetEmployee }} onValuesChange={recalc}>
        <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Employee</div>
        <Form.Item name="employeeId" rules={[{ required: true, message: 'Select an employee' }]}>
          <Select showSearch optionFilterProp="label" disabled={!!presetEmployee} placeholder="Search name, employee #, department"
            onChange={(v) => setEmpId(v)}
            options={(employees.data || []).filter((e: any) => e.active).map((e: any) => ({ label: `${e.firstName} ${e.lastName} · ${e.employeeNo}${e.position ? ` · ${e.position}` : ''}`, value: e.id }))} />
        </Form.Item>
        <div className="text-[13px] font-semibold text-[#171a2e] mb-2 mt-2">Leave details</div>
        <Form.Item name="leaveTypeId" label="Leave Type" rules={[{ required: true }]}>
          <Select onChange={(v) => setTypeId(v)} options={(types.data || []).filter((t: any) => t.active).map((t: any) => ({ label: `${t.name} (${t.code})`, value: t.id }))} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="startDate" label="Start Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item name="endDate" label="End Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="startSession" label="Start Day"><Select options={SESSION_OPTS} /></Form.Item></Col>
          <Col span={12}><Form.Item name="endSession" label="End Day"><Select options={SESSION_OPTS} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="includeWeekends" label="Weekend Treatment" valuePropName="checked"><Switch checkedChildren="Include weekends" unCheckedChildren="Exclude weekends" /></Form.Item></Col>
          <Col span={12}><Form.Item name="includeHolidays" label="Holiday Treatment" valuePropName="checked"><Switch checkedChildren="Include holidays" unCheckedChildren="Exclude holidays" /></Form.Item></Col>
        </Row>

        <div className="nex-card border rounded-lg p-4 my-2">
          <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Leave calculation</div>
          {calc ? (
            <>
              <div className="grid grid-cols-2 gap-x-6">
                <DetailItem label="Calendar days" value={calc.calendarDays} />
                <DetailItem label="Non-working weekend days" value={calc.weekendDays} />
                <DetailItem label="Public holidays" value={calc.holidayDays} />
                <DetailItem label="Half day adjustment" value={calc.halfDayAdjustment} />
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-[#eef0f6]">
                <span className="text-[14px] font-semibold text-[#171a2e]">Leave Days Charged</span>
                <span className="text-[20px] font-bold text-[#0b2a4a]">{fmtNumber(calc.chargeableLeaveDays, 1)}</span>
              </div>
              <div className="text-[12px] text-[#94a3b8] mt-1">Work calendar: {calc.workCalendar} · Non-working: {(calc.nonWorkingDays || []).join(', ') || '—'}</div>
            </>
          ) : <div className="text-[13px] text-[#94a3b8]">Select employee, leave type and dates to calculate.</div>}
        </div>

        {balance && (
          <div className="nex-card border rounded-lg p-4 mb-2">
            <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Balance impact</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-[12px] text-[#64748b]">Available before</div><div className="text-[18px] font-bold text-[#171a2e]">{fmtNumber(balance.available, 1)}</div></div>
              <div><div className="text-[12px] text-[#64748b]">Requested</div><div className="text-[18px] font-bold text-[#171a2e]">{calc ? fmtNumber(calc.chargeableLeaveDays, 1) : '—'}</div></div>
              <div><div className="text-[12px] text-[#64748b]">Projected balance</div><div className="text-[18px] font-bold" style={{ color: calc && balance.available - calc.chargeableLeaveDays < 0 ? '#dc2626' : '#16a34a' }}>{calc ? fmtNumber(balance.available - calc.chargeableLeaveDays, 1) : '—'}</div></div>
            </div>
            {type && <div className="text-[12px] text-[#94a3b8] mt-2">Negative balance policy: {type.negativeBalancePolicy}{!type.paid ? ' · Unpaid leave' : ' · Paid leave'}</div>}
          </div>
        )}

        {overlaps.length > 0 && <Alert type="error" showIcon className="mb-2" message="Overlapping leave" description={overlaps[0].message} />}

        <Form.Item name="reason" label="Reason"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="attachment" label="Attachment (URL)"><Input placeholder="Optional link to supporting document" /></Form.Item>
      </Form>
    </Drawer>
  );
}

// ======================================================================
// Balances
// ======================================================================
function BalancesTab({ departments, years, onLedger }: { departments: any[]; years: any[]; onLedger: (d: any) => void }) {
  const [year, setYear] = useState<number | undefined>(years[0]?.year);
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [leaveTypeId, setLeaveTypeId] = useState<string | undefined>();
  const types = useQuery({ queryKey: ['/hr/leave/types'], queryFn: () => api('/hr/leave/types') });
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (departmentId) params.set('departmentId', departmentId);
  if (leaveTypeId) params.set('leaveTypeId', leaveTypeId);
  const qs = params.toString();
  const { data, isLoading } = useQuery({ queryKey: ['/hr/leave/balances', qs], queryFn: () => api(`/hr/leave/balances${qs ? `?${qs}` : ''}`), placeholderData: keepPreviousData });
  const rows = data?.rows || [];

  async function openLedger(r: any) {
    try { const d = await api(`/hr/leave/balances/${r.employeeId}/${r.leaveTypeId}/ledger?year=${r.year}`); onLedger(d); }
    catch (e: any) { message.error(e.message); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 py-3">
        <Select style={{ width: 130 }} value={year} onChange={setYear} placeholder="Leave year" options={years.map((y: any) => ({ label: y.label, value: y.year }))} />
        <Select allowClear style={{ width: 170 }} value={departmentId} onChange={setDepartmentId} placeholder="Department" options={departments.map((d) => ({ label: d.name, value: d.id }))} />
        <Select allowClear style={{ width: 170 }} value={leaveTypeId} onChange={setLeaveTypeId} placeholder="Leave type" options={(types.data || []).map((t: any) => ({ label: t.name, value: t.id }))} />
      </div>
      <Table rowKey={(r: any) => `${r.employeeId}-${r.leaveTypeId}`} size="small" loading={isLoading} dataSource={rows} pagination={{ pageSize: 12 }} scroll={{ x: 1000 }} columns={[
        { title: 'Employee', render: (_v, r) => <div><div className="text-[13px] font-medium text-[#171a2e]">{r.employee}</div><div className="text-[11px] text-[#94a3b8]">{r.employeeNo}{r.department ? ` · ${r.department}` : ''}</div></div> },
        { title: 'Leave Type', dataIndex: 'leaveType', width: 150 },
        { title: 'Entitlement', dataIndex: 'entitlement', width: 100, align: 'right', render: (v) => fmtNumber(v, 1) },
        { title: 'Carry Fwd', dataIndex: 'carryForward', width: 90, align: 'right', render: (v) => fmtNumber(v, 1) },
        { title: 'Accrued', dataIndex: 'accrued', width: 80, align: 'right', render: (v) => fmtNumber(v, 1) },
        { title: 'Adjustments', dataIndex: 'adjustments', width: 100, align: 'right', render: (v) => fmtNumber(v, 1) },
        { title: 'Used', dataIndex: 'used', width: 70, align: 'right', render: (v) => fmtNumber(v, 1) },
        { title: 'Pending', dataIndex: 'pending', width: 80, align: 'right', render: (v) => fmtNumber(v, 1) },
        { title: 'Available', dataIndex: 'available', width: 100, align: 'right', render: (v, r) => <a className="font-semibold" onClick={() => openLedger(r)}>{fmtNumber(v, 1)}</a> },
        { title: 'Leave Year', dataIndex: 'year', width: 90, render: (v) => `FY${v}` },
        { title: 'Actions', width: 90, render: (_v, r) => <Button size="small" onClick={() => openLedger(r)}>Ledger</Button> },
      ] as ColumnsType<any>} locale={{ emptyText: <EmptyState title="No leave balances for the selected filters." /> }} />
    </div>
  );
}

function LedgerDrawer({ data, onClose }: { data: any; onClose: () => void }) {
  const b = data.balance;
  return (
    <Drawer open onClose={onClose} width={720} title={`${data.employee?.firstName} ${data.employee?.lastName} · ${b?.leaveType} · FY${b?.year}`}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="nex-card border rounded-lg p-3 text-center"><div className="text-[12px] text-[#64748b]">Entitlement</div><div className="text-[18px] font-bold">{fmtNumber(b.entitlement, 1)}</div></div>
        <div className="nex-card border rounded-lg p-3 text-center"><div className="text-[12px] text-[#64748b]">Carry forward</div><div className="text-[18px] font-bold">{fmtNumber(b.carryForward, 1)}</div></div>
        <div className="nex-card border rounded-lg p-3 text-center"><div className="text-[12px] text-[#64748b]">Used</div><div className="text-[18px] font-bold">{fmtNumber(b.used, 1)}</div></div>
        <div className="nex-card border rounded-lg p-3 text-center"><div className="text-[12px] text-[#64748b]">Available</div><div className="text-[18px] font-bold text-[#16a34a]">{fmtNumber(b.available, 1)}</div></div>
      </div>
      <div className="text-[12px] text-[#94a3b8] mb-3">Pending {fmtNumber(b.pending, 1)} · Projected available {fmtNumber(b.projected, 1)}</div>
      <Table rowKey="id" size="small" dataSource={data.transactions} pagination={false} columns={[
        { title: 'Date', dataIndex: 'effectiveDate', render: (v) => fmtDate(v) },
        { title: 'Type', dataIndex: 'type', render: (v) => <StatusPill status={v} /> },
        { title: 'Reference', dataIndex: 'reference', render: (v) => v || '—' },
        { title: 'Change', dataIndex: 'change', align: 'right', render: (v) => <span style={{ color: Number(v) < 0 ? '#dc2626' : '#16a34a' }}>{Number(v) > 0 ? '+' : ''}{fmtNumber(v, 1)}</span> },
        { title: 'Balance', dataIndex: 'balanceAfter', align: 'right', render: (v) => fmtNumber(v, 1) },
      ] as ColumnsType<any>} locale={{ emptyText: <EmptyState title="No balance transactions yet." /> }} />
    </Drawer>
  );
}

// ======================================================================
// Leave Types
// ======================================================================
function LeaveTypesTab({ onView, onEdit, onCreate }: { onView: (t: any) => void; onEdit: (t: any) => void; onCreate: () => void }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['/hr/leave/types'], queryFn: () => api('/hr/leave/types') });
  async function act(t: any, action: string) {
    try {
      if (action === 'duplicate') await api(`/hr/leave/types/${t.id}/duplicate`, { method: 'POST' });
      else await api(`/hr/leave/types/${t.id}/active`, { method: 'POST', body: JSON.stringify({ active: !t.active }) });
      message.success('Leave type updated'); qc.invalidateQueries({ queryKey: ['/hr/leave/types'] });
    } catch (e: any) { message.error(e.message); }
  }
  return (
    <div>
      <div className="flex justify-end py-3"><Can permission={['hr.leave.type.manage', 'hr.leave.manage']}><Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>Leave Type</Button></Can></div>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={false} scroll={{ x: 1100 }} columns={[
        { title: 'Code', dataIndex: 'code', width: 100 },
        { title: 'Leave Type', dataIndex: 'name', render: (v, r) => <a className="text-[13px] font-medium" onClick={() => onView(r)}>{v}</a> },
        { title: 'Entitlement', dataIndex: 'daysPerYear', width: 120, align: 'right', render: (v) => `${v} days/year` },
        { title: 'Accrual', dataIndex: 'accrualMethod', width: 130, render: (v) => (v || '').replace(/_/g, ' ') },
        { title: 'Weekend', dataIndex: 'weekendPolicy', width: 100, render: (v) => v === 'INCLUDE' ? 'Include' : 'Exclude' },
        { title: 'Holidays', dataIndex: 'holidayPolicy', width: 100, render: (v) => v === 'INCLUDE' ? 'Include' : 'Exclude' },
        { title: 'Carry Forward', width: 130, render: (_v, r) => r.carryForwardPolicy === 'NONE' ? 'None' : r.carryForwardPolicy === 'MAX' ? `Max ${fmtNumber(r.carryForwardMax, 0)} days` : r.carryForwardPolicy === 'PERCENT' ? `${fmtNumber(r.carryForwardPercent, 0)}%` : r.carryForwardPolicy },
        { title: 'Paid', dataIndex: 'paid', width: 80, render: (v) => <Tag color={v ? 'green' : 'orange'}>{v ? 'PAID' : 'UNPAID'}</Tag> },
        { title: 'Status', dataIndex: 'active', width: 100, render: (v) => <StatusPill status={v ? 'ACTIVE' : 'INACTIVE'} /> },
        { ...ACTIONS_COL, render: (_v, r) => (
          <RowActionsMenu items={[
            { key: 'view', label: 'View', onClick: () => onView(r) },
            { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: ['hr.leave.type.manage', 'hr.leave.manage'], onClick: () => onEdit(r) },
            { key: 'dup', label: 'Duplicate', permission: ['hr.leave.type.manage', 'hr.leave.manage'], onClick: () => act(r, 'duplicate') },
            { key: 'deact', label: r.active ? 'Deactivate' : 'Activate', icon: <StopOutlined />, danger: r.active, permission: ['hr.leave.type.manage', 'hr.leave.manage'], onClick: () => act(r, r.active ? 'deactivate' : 'activate') },
          ]} />
        ) },
      ] as ColumnsType<any>} />
    </div>
  );
}

function LeaveTypeDrawer({ editing, view, onClose, onSaved }: { editing?: any; view?: boolean; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(!!view);
  const t = editing;
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try {
      if (t?.id) await api(`/hr/leave/types/${t.id}`, { method: 'PATCH', body: JSON.stringify(v) });
      else await api('/hr/leave/types', { method: 'POST', body: JSON.stringify(v) });
      message.success('Leave type saved'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={620} destroyOnHidden title={t ? `${t.name} (${t.code})` : 'New Leave Type'}
      extra={readOnly && <Can permission={['hr.leave.type.manage', 'hr.leave.manage']}><Button size="small" icon={<EditOutlined />} onClick={() => setReadOnly(false)}>Edit</Button></Can>}
      footer={!readOnly && <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save</Button></div>}>
      <Form form={form} layout="vertical" disabled={readOnly} initialValues={t ? {
        code: t.code, name: t.name, description: t.description, daysPerYear: t.daysPerYear, paid: t.paid, accrualMethod: t.accrualMethod,
        weekendPolicy: t.weekendPolicy, holidayPolicy: t.holidayPolicy, allowHalfDay: t.allowHalfDay, allowNegativeBalance: t.allowNegativeBalance,
        negativeBalancePolicy: t.negativeBalancePolicy, minNoticeDays: t.minNoticeDays, maxConsecutiveDays: t.maxConsecutiveDays,
        carryForwardPolicy: t.carryForwardPolicy, carryForwardMax: t.carryForwardMax, carryForwardPercent: t.carryForwardPercent,
        carryForwardExpiryMonths: t.carryForwardExpiryMonths, requiresAttachment: t.requiresAttachment, attachmentAfterDays: t.attachmentAfterDays,
        approvalWorkflow: t.approvalWorkflow, active: t.active,
      } : { paid: true, accrualMethod: 'ANNUAL_GRANT', weekendPolicy: 'EXCLUDE', holidayPolicy: 'EXCLUDE', allowHalfDay: true, negativeBalancePolicy: 'BLOCK', carryForwardPolicy: 'NONE', daysPerYear: 20, active: true }}>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="code" label="Code" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={16}><Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="paid" label="Paid / Unpaid" valuePropName="checked"><Switch checkedChildren="PAID" unCheckedChildren="UNPAID" /></Form.Item></Col>
          <Col span={8}><Form.Item name="daysPerYear" label="Annual Entitlement (days)"><InputNumber min={0} className="w-full" /></Form.Item></Col>
          <Col span={8}><Form.Item name="accrualMethod" label="Accrual Method"><Select options={ACCRUAL.map((a) => ({ label: a.replace(/_/g, ' '), value: a }))} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="weekendPolicy" label="Weekend Policy"><Select options={[{ label: 'Exclude weekends', value: 'EXCLUDE' }, { label: 'Include weekends', value: 'INCLUDE' }]} /></Form.Item></Col>
          <Col span={8}><Form.Item name="holidayPolicy" label="Holiday Policy"><Select options={[{ label: 'Exclude holidays', value: 'EXCLUDE' }, { label: 'Include holidays', value: 'INCLUDE' }]} /></Form.Item></Col>
          <Col span={8}><Form.Item name="allowHalfDay" label="Allow Half Day" valuePropName="checked"><Switch /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="negativeBalancePolicy" label="Negative Balance"><Select options={[{ label: 'Do not allow', value: 'BLOCK' }, { label: 'Allow with approval', value: 'APPROVAL' }, { label: 'Allow negative', value: 'ALLOW' }]} /></Form.Item></Col>
          <Col span={8}><Form.Item name="minNoticeDays" label="Minimum Notice (days)"><InputNumber min={0} className="w-full" /></Form.Item></Col>
          <Col span={8}><Form.Item name="maxConsecutiveDays" label="Max Consecutive Days"><InputNumber min={0} className="w-full" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="carryForwardPolicy" label="Carry Forward Policy"><Select options={CARRY.map((c) => ({ label: c.replace(/_/g, ' '), value: c }))} /></Form.Item></Col>
          <Col span={8}><Form.Item name="carryForwardMax" label="Carry Forward Max (days)"><InputNumber min={0} className="w-full" /></Form.Item></Col>
          <Col span={8}><Form.Item name="carryForwardPercent" label="Carry Forward %"><InputNumber min={0} max={100} className="w-full" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="carryForwardExpiryMonths" label="Carry Forward Expiry (months)"><InputNumber min={0} className="w-full" /></Form.Item></Col>
          <Col span={8}><Form.Item name="requiresAttachment" label="Requires Attachment" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col span={8}><Form.Item name="attachmentAfterDays" label="Attachment After (days)"><InputNumber min={0} className="w-full" /></Form.Item></Col>
        </Row>
        <Form.Item name="active" label="Status" valuePropName="checked"><Switch checkedChildren="ACTIVE" unCheckedChildren="INACTIVE" /></Form.Item>
      </Form>
    </Drawer>
  );
}

// ======================================================================
// Holidays
// ======================================================================
function HolidaysTab({ years, departments, onView, onEdit, onCreate }: { years: any[]; departments: any[]; onView: (h: any) => void; onEdit: (h: any) => void; onCreate: () => void }) {
  const qc = useQueryClient();
  const [year, setYear] = useState<number | undefined>(years[0]?.year || new Date().getFullYear());
  const [branchId, setBranchId] = useState<string | undefined>();
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (branchId) params.set('branchId', branchId);
  const { data = [], isLoading } = useQuery({ queryKey: ['/hr/leave/holidays', year, branchId], queryFn: () => api(`/hr/leave/holidays?${params.toString()}`), placeholderData: keepPreviousData });
  async function deactivate(h: any) {
    try { await api(`/hr/leave/holidays/${h.id}/active`, { method: 'POST', body: JSON.stringify({ active: !h.active }) }); message.success('Holiday updated'); qc.invalidateQueries({ queryKey: ['/hr/leave/holidays'] }); }
    catch (e: any) { message.error(e.message); }
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 py-3">
        <Select style={{ width: 130 }} value={year} onChange={setYear} options={years.map((y: any) => ({ label: y.label, value: y.year }))} />
        <Select allowClear style={{ width: 180 }} value={branchId} onChange={setBranchId} placeholder="Branch / calendar" options={departments.map((d: any) => ({ label: d.branch?.name || d.name, value: d.branchId })).filter((o: any, i: number, a: any[]) => o.value && a.findIndex((x) => x.value === o.value) === i)} />
        <div className="ml-auto"><Can permission={['hr.holiday.manage', 'hr.leave.manage']}><Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>Holiday</Button></Can></div>
      </div>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={false} scroll={{ x: 1000 }} columns={[
        { title: 'Holiday', dataIndex: 'name', render: (v, r) => <a className="text-[13px] font-medium" onClick={() => onView(r)}>{v}</a> },
        { title: 'Date', render: (_v, r) => fmtDate(r.occurrenceDate || r.date), width: 120 },
        { title: 'Type', dataIndex: 'type', width: 110, render: (v) => (v || 'PUBLIC').replace(/_/g, ' ') },
        { title: 'Recurrence', width: 120, render: (_v, r) => (r.recurring || r.recurrence === 'YEARLY') ? 'Every Year' : 'One-time' },
        { title: 'Calendar / Branch', width: 160, render: (_v, r) => r.branch?.name || (r.scope === 'CALENDAR' ? 'Work calendar' : 'Company Wide') },
        { title: 'Observed', width: 120, render: (_v, r) => r.observedDate ? fmtDate(r.observedDate) : '—' },
        { title: 'Status', dataIndex: 'active', width: 100, render: (v) => <StatusPill status={v ? 'ACTIVE' : 'INACTIVE'} /> },
        { ...ACTIONS_COL, render: (_v, r) => (
          <RowActionsMenu items={[
            { key: 'view', label: 'View', onClick: () => onView(r) },
            { key: 'edit', label: 'Edit', icon: <EditOutlined />, permission: ['hr.holiday.manage', 'hr.leave.manage'], onClick: () => onEdit(r) },
            { key: 'deact', label: r.active ? 'Deactivate' : 'Activate', danger: r.active, permission: ['hr.holiday.manage', 'hr.leave.manage'], onClick: () => deactivate(r) },
          ]} />
        ) },
      ] as ColumnsType<any>} locale={{ emptyText: <EmptyState title="No holidays for the selected year." action={<Can permission={['hr.holiday.manage', 'hr.leave.manage']}><Button type="primary" onClick={onCreate}>Add Holiday</Button></Can>} /> }} />
    </div>
  );
}

function HolidayDrawer({ editing, view, departments, onClose, onSaved }: { editing?: any; view?: boolean; departments: any[]; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(!!view);
  const h = editing;
  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    const body = { ...v, date: v.date?.format('YYYY-MM-DD'), observedDate: v.observedDate?.format('YYYY-MM-DD') };
    try {
      if (h?.id) await api(`/hr/leave/holidays/${h.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/hr/leave/holidays', { method: 'POST', body: JSON.stringify(body) });
      message.success('Holiday saved'); onSaved();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer open onClose={onClose} width={560} destroyOnHidden title={h ? h.name : 'Add Holiday'}
      extra={readOnly && <Can permission={['hr.holiday.manage', 'hr.leave.manage']}><Button size="small" icon={<EditOutlined />} onClick={() => setReadOnly(false)}>Edit</Button></Can>}
      footer={!readOnly && <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>Save</Button></div>}>
      <Form form={form} layout="vertical" disabled={readOnly} initialValues={h ? {
        name: h.name, date: dayjs(h.occurrenceDate || h.date), type: h.type || 'PUBLIC', recurring: h.recurring || h.recurrence === 'YEARLY',
        observedDate: h.observedDate ? dayjs(h.observedDate) : undefined, observedRule: h.observedRule || 'NONE', country: h.country, region: h.region,
        branchId: h.branchId, scope: h.scope || 'COMPANY', paid: h.paid ?? true, active: h.active ?? true,
      } : { type: 'PUBLIC', recurring: false, observedRule: 'NONE', scope: 'COMPANY', paid: true, active: true }}>
        <Form.Item name="name" label="Holiday Name" rules={[{ required: true }]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="date" label="Date" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item name="type" label="Holiday Type"><Select options={['PUBLIC', 'COMPANY', 'BRANCH', 'REGIONAL'].map((x) => ({ label: x.replace(/_/g, ' '), value: x }))} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="recurring" label="Recurring (yearly)" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col span={12}><Form.Item name="paid" label="Paid Holiday" valuePropName="checked"><Switch /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="observedDate" label="Observed Date"><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item name="observedRule" label="Observed Rule"><Select options={[{ label: 'None', value: 'NONE' }, { label: 'Next working day', value: 'NEXT_WORKING_DAY' }]} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="scope" label="Calendar Scope"><Select options={[{ label: 'Company wide', value: 'COMPANY' }, { label: 'Branch', value: 'BRANCH' }, { label: 'Work calendar', value: 'CALENDAR' }]} /></Form.Item></Col>
          <Col span={12}><Form.Item name="branchId" label="Branch (optional)"><Select allowClear options={departments.map((d: any) => ({ label: d.branch?.name || d.name, value: d.branchId })).filter((o: any) => o.value)} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="country" label="Country"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="region" label="Region"><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="active" label="Status" valuePropName="checked"><Switch checkedChildren="ACTIVE" unCheckedChildren="INACTIVE" /></Form.Item>
      </Form>
    </Drawer>
  );
}

// ======================================================================
// Calendar
// ======================================================================
function CalendarTab({ departments, onOpen }: { departments: any[]; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(dayjs());
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const params = new URLSearchParams({ month: month.toISOString() });
  if (departmentId) params.set('departmentId', departmentId);
  const { data, isLoading } = useQuery({ queryKey: ['/hr/leave/calendar', month.format('YYYY-MM'), departmentId], queryFn: () => api(`/hr/leave/calendar?${params.toString()}`) });
  const requests = data?.requests || [];
  const holidays = data?.holidays || [];
  const start = month.startOf('month');
  const offset = start.day();
  const daysInMonth = month.daysInMonth();
  const cells: (dayjs.Dayjs | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(month.date(d));
  function dayRequests(day: dayjs.Dayjs) {
    return requests.filter((r: any) => day.isAfter(dayjs(r.startDate).subtract(1, 'day')) && day.isBefore(dayjs(r.endDate).add(1, 'day')));
  }
  function isHoliday(day: dayjs.Dayjs) {
    return holidays.some((h: any) => {
      const base = dayjs(h.date);
      if (h.recurring || h.recurrence === 'YEARLY') return base.month() === day.month() && base.date() === day.date();
      return base.isSame(day, 'day');
    });
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 py-3">
        <Button onClick={() => setMonth(month.subtract(1, 'month'))}>Prev</Button>
        <span className="text-[14px] font-semibold text-[#171a2e]">{month.format('MMMM YYYY')}</span>
        <Button onClick={() => setMonth(dayjs())}>Today</Button>
        <Button onClick={() => setMonth(month.add(1, 'month'))}>Next</Button>
        <Select allowClear placeholder="Department" style={{ width: 170 }} value={departmentId} onChange={setDepartmentId} options={departments.map((d) => ({ label: d.name, value: d.id }))} />
        <div className="ml-auto flex gap-3 text-[12px]"><span><Tag color="green">Approved</Tag></span><span><Tag color="orange">Pending</Tag></span><span><Tag color="blue">Holiday</Tag></span></div>
      </div>
      {isLoading ? <Skeleton active /> : (
        <div className="grid grid-cols-7 gap-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="text-[11px] font-semibold text-[#94a3b8] text-center py-1">{d}</div>)}
          {cells.map((day, i) => (
            <div key={i} className={`min-h-[84px] rounded-md border p-1.5 ${day ? 'bg-white border-[#eef0f6]' : 'border-transparent'}`}>
              {day && <div className="text-[11px] text-[#344054] mb-1">{day.date()}</div>}
              {day && isHoliday(day) && <div className="text-[10px] px-1 rounded bg-[#eff6ff] text-[#1d4ed8] truncate mb-0.5">Holiday</div>}
              {day && dayRequests(day).slice(0, 3).map((r: any) => (
                <div key={r.id} onClick={() => onOpen(r.id)} className={`text-[10px] px-1 rounded truncate mt-0.5 cursor-pointer ${r.status === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                  {r.employee?.firstName} · {r.leaveTypeRef?.code || ''}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
