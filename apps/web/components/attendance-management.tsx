'use client';
import React, { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Alert, Button, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Skeleton, Space, Table,
  Tag, TimePicker, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, CloseOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill, DetailItem, EmptyState } from '@/components/sales-ui';
import { RowActionsMenu, ACTIONS_COL } from '@/components/row-actions-menu';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';

const STATUSES = [
  { label: 'Present', value: 'PRESENT' }, { label: 'Absent', value: 'ABSENT' }, { label: 'On Leave', value: 'LEAVE' },
  { label: 'Remote', value: 'REMOTE' }, { label: 'Off Day', value: 'OFF_DAY' }, { label: 'Holiday', value: 'HOLIDAY' },
  { label: 'Sick', value: 'SICK' }, { label: 'Partial Day', value: 'PARTIAL_DAY' },
];
const statusLabel = (s: string) => (s === 'LEAVE' ? 'ON LEAVE' : (s || '').replace(/_/g, ' '));

function toHM(v: any) { return v ? dayjs(v).format('HH:mm') : '—'; }

export function AttendanceManagement() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<any>({});
  const [addOpen, setAddOpen] = useState<{ open: boolean; record?: any; presetEmployee?: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const departments = useQuery({ queryKey: ['/hr/departments'], queryFn: () => api('/hr/departments') });
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });
  const attendance = useQuery({ queryKey: ['/hr/attendance'], queryFn: () => api('/hr/attendance'), placeholderData: keepPreviousData });
  const summary = useQuery({ queryKey: ['/hr/attendance/summary'], queryFn: () => api('/hr/attendance/summary'), placeholderData: keepPreviousData });
  const exceptions = useQuery({ queryKey: ['/hr/attendance/exceptions'], queryFn: () => api('/hr/attendance/exceptions'), placeholderData: keepPreviousData });

  const empMap = new Map((employees.data || []).map((e: any) => [e.id, e]));
  const refresh = () => ['/hr/attendance', '/hr/attendance/summary', '/hr/attendance/exceptions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const rows = (attendance.data || []).filter((r: any) => {
    if (filters.departmentId) { const e: any = empMap.get(r.employeeId); if (e?.departmentId !== filters.departmentId) return false; }
    if (filters.status && r.status !== filters.status) return false;
    if (filters.approval === 'APPROVED' && !r.approved) return false;
    if (filters.approval === 'PENDING' && r.approved) return false;
    if (filters.exception) {
      const ex = exceptionTypeFor(r);
      if (ex !== filters.exception) return false;
    }
    if (filters.search) { const e: any = empMap.get(r.employeeId); const q = filters.search.toLowerCase(); if (!`${e?.firstName} ${e?.lastName} ${e?.employeeNo}`.toLowerCase().includes(q)) return false; }
    if (filters.from && new Date(r.date) < new Date(filters.from)) return false;
    if (filters.to && new Date(r.date) > new Date(filters.to)) return false;
    return true;
  });

  const t = summary.data?.totals || {};

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Kpi label="Records" value={t.records ?? 0} onClick={() => setFilters({})} />
        <Kpi label="Worked hours" value={`${fmtNumber(t.workedHours, 1)}h`} onClick={() => setFilters({})} />
        <Kpi label="Overtime" value={`${fmtNumber(t.overtimeHours, 1)}h`} color="#e11d48" onClick={() => setFilters({ exception: 'UNAPPROVED_OVERTIME' })} />
        <Kpi label="Exceptions" value={(exceptions.data || []).length} color="#b45309" onClick={() => setFilters({ exception: 'LATE_ARRIVAL' })} />
      </div>

      <div className="mb-4">
        <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Exceptions</div>
        <div className="flex flex-wrap gap-2">
          {(exceptions.data || []).slice(0, 10).map((x: any) => (
            <button key={x.id} onClick={() => setFilters({ exception: x.exception, search: `${x.employee?.firstName || ''} ${x.employee?.lastName || ''}`.trim() })} className="text-[12px] px-2.5 py-1.5 rounded-full bg-[#fff7ed] text-[#b45309] font-medium border border-[#fed7aa]">
              {x.exception.replace(/_/g, ' ')} · {x.employee?.firstName} {x.employee?.lastName}
            </button>
          ))}
          {!exceptions.data?.length && <span className="text-[13px] text-[#94a3b8]">No exceptions detected.</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 py-3">
        <Input allowClear placeholder="Search employee..." style={{ width: 180 }} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        <DatePicker.RangePicker onChange={(v) => setFilters({ ...filters, from: v?.[0]?.format('YYYY-MM-DD'), to: v?.[1]?.format('YYYY-MM-DD') })} />
        <Select allowClear placeholder="Department" style={{ width: 160 }} value={filters.departmentId} onChange={(v) => setFilters({ ...filters, departmentId: v })} options={(departments.data || []).map((d: any) => ({ label: d.name, value: d.id }))} />
        <Select allowClear placeholder="Status" style={{ width: 140 }} value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} options={STATUSES} />
        <Select allowClear placeholder="Approval" style={{ width: 140 }} value={filters.approval} onChange={(v) => setFilters({ ...filters, approval: v })} options={[{ label: 'Approved', value: 'APPROVED' }, { label: 'Pending', value: 'PENDING' }]} />
        <Select allowClear placeholder="Exception" style={{ width: 170 }} value={filters.exception} onChange={(v) => setFilters({ ...filters, exception: v })} options={['LATE_ARRIVAL', 'EARLY_DEPARTURE', 'UNAPPROVED_OVERTIME', 'MISSING_CLOCK_IN', 'MISSING_CLOCK_OUT'].map((x) => ({ label: x.replace(/_/g, ' '), value: x }))} />
        <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        <div className="ml-auto"><Can permission={['hr.attendance.manage']}><Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen({ open: true })}>Add Attendance</Button></Can></div>
      </div>

      <Table rowKey="id" size="small" loading={attendance.isLoading} dataSource={rows} pagination={{ pageSize: 12 }} scroll={{ x: 1200 }} columns={[
        { title: 'Date', dataIndex: 'date', width: 120, render: (v) => fmtDate(v) },
        { title: 'Employee', render: (_v, r) => { const e: any = empMap.get(r.employeeId); return <div><div className="text-[13px] font-medium text-[#171a2e]">{e?.firstName} {e?.lastName}</div><div className="text-[11px] text-[#94a3b8]">{e?.employeeNo}</div></div>; } },
        { title: 'Clock In', dataIndex: 'checkIn', width: 90, render: (v) => toHM(v) },
        { title: 'Clock Out', dataIndex: 'checkOut', width: 90, render: (v) => toHM(v) },
        { title: 'Worked', dataIndex: 'workedHours', width: 80, align: 'right', render: (v) => `${fmtNumber(v, 1)}h` },
        { title: 'Regular', dataIndex: 'regularHours', width: 80, align: 'right', render: (v) => `${fmtNumber(v, 1)}h` },
        { title: 'OT', dataIndex: 'overtimeHours', width: 70, align: 'right', render: (v) => Number(v) > 0 ? <span className="text-[#e11d48] font-medium">{fmtNumber(v, 1)}h</span> : '—' },
        { title: 'Late', dataIndex: 'lateMinutes', width: 70, align: 'right', render: (v) => Number(v) > 0 ? <span className="text-[#b45309]">{fmtNumber(v, 0)}m</span> : '—' },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusPill status={v} /> },
        { title: 'Approval', dataIndex: 'approved', width: 110, render: (v, r) => Number(r.overtimeHours) > 0 ? (v ? <StatusPill status="APPROVED" /> : <StatusPill status="PENDING" />) : <span className="text-[12px] text-[#94a3b8]">—</span> },
        { ...ACTIONS_COL, width: 90, render: (_v, r) => <Button size="small" onClick={() => setDetailId(r.id)}>View</Button> },
      ] as ColumnsType<any>} />

      {addOpen?.open && <AddAttendanceDrawer record={addOpen.record} presetEmployee={addOpen.presetEmployee} onClose={() => setAddOpen(null)} onSaved={() => { setAddOpen(null); refresh(); }} />}
      {detailId && <AttendanceDetailDrawer id={detailId} onClose={() => setDetailId(null)} onEdit={(rec) => { setDetailId(null); setAddOpen({ open: true, record: rec }); }} onChanged={refresh} />}
    </div>
  );
}

function Kpi({ label, value, color, onClick }: { label: string; value: React.ReactNode; color?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="nex-card border rounded-lg p-4 text-center hover:border-[#c7d2fe] transition">
      <div className="text-[12px] font-semibold text-[#64748b]">{label}</div>
      <div className="text-[22px] font-bold" style={{ color: color || '#171a2e' }}>{value}</div>
    </button>
  );
}

function exceptionTypeFor(r: any): string | null {
  if (!r.checkIn) return 'MISSING_CLOCK_IN';
  if (!r.checkOut) return 'MISSING_CLOCK_OUT';
  if (Number(r.lateMinutes) > 0) return 'LATE_ARRIVAL';
  if (Number(r.overtimeHours) > 0 && !r.approved) return 'UNAPPROVED_OVERTIME';
  if (Number(r.earlyDeparture) > 0) return 'EARLY_DEPARTURE';
  if (r.status === 'ABSENT') return 'ABSENCE';
  return null;
}

// ======================================================================
// Add / Edit attendance drawer
// ======================================================================
export function AddAttendanceDrawer({ record, presetEmployee, onClose, onSaved }: { record?: any; presetEmployee?: string; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [pre, setPre] = useState<any>(null);
  const [calc, setCalc] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const editing = !!record;
  const employees = useQuery({ queryKey: ['/hr/employees'], queryFn: () => api('/hr/employees') });

  const initial = record ? {
    employeeId: record.employeeId, date: dayjs(record.date), status: record.status || 'PRESENT',
    checkIn: record.checkIn ? dayjs(record.checkIn) : undefined, checkOut: record.checkOut ? dayjs(record.checkOut) : undefined,
    breakMinutes: record.breakMinutes ?? 60, reason: record.note || '',
  } : { employeeId: presetEmployee, date: dayjs(), status: 'PRESENT', breakMinutes: 60 };

  async function preflight() {
    const v = form.getFieldsValue();
    if (!v.employeeId || !v.date) return;
    try {
      const res = await api('/hr/attendance/preflight', { method: 'POST', body: JSON.stringify({
        employeeId: v.employeeId, date: v.date.format('YYYY-MM-DD'),
        checkIn: v.checkIn ? `${v.date.format('YYYY-MM-DD')}T${v.checkIn.format('HH:mm')}:00` : undefined,
        checkOut: v.checkOut ? `${v.date.format('YYYY-MM-DD')}T${v.checkOut.format('HH:mm')}:00` : undefined,
        breakMinutes: v.breakMinutes, status: v.status,
      }) });
      setPre(res); setCalc(res.calculation);
      if (res.existing && !editing) form.setFieldValue('status', res.leave ? 'LEAVE' : form.getFieldValue('status'));
    } catch (e: any) { message.error(e.message); }
  }

  async function submit() {
    const v = await form.validateFields(); setSaving(true);
    try {
      if (editing) {
        await api(`/hr/attendance/${record.id}`, { method: 'PATCH', body: JSON.stringify({
          date: v.date.format('YYYY-MM-DD'), status: v.status, breakMinutes: v.breakMinutes, reason: v.reason,
          checkIn: v.checkIn ? `${v.date.format('YYYY-MM-DD')}T${v.checkIn.format('HH:mm')}:00` : undefined,
          checkOut: v.checkOut ? `${v.date.format('YYYY-MM-DD')}T${v.checkOut.format('HH:mm')}:00` : undefined,
        }) });
        message.success('Attendance updated');
      } else {
        await api('/hr/attendance', { method: 'POST', body: JSON.stringify({
          employeeId: v.employeeId, date: v.date.format('YYYY-MM-DD'), status: v.status, breakMinutes: v.breakMinutes, reason: v.reason,
          checkIn: v.checkIn ? `${v.date.format('YYYY-MM-DD')}T${v.checkIn.format('HH:mm')}:00` : undefined,
          checkOut: v.checkOut ? `${v.date.format('YYYY-MM-DD')}T${v.checkOut.format('HH:mm')}:00` : undefined,
          override: !!v.override,
        }) });
        message.success('Attendance recorded');
      }
      onSaved();
    } catch (e: any) {
      if (e.message?.toLowerCase().includes('already exists') && pre?.existing) message.error(`${e.message} View existing record first.`);
      else message.error(e.message);
    } finally { setSaving(false); }
  }

  return (
    <Drawer open onClose={onClose} width={780} destroyOnHidden title={editing ? 'Edit Attendance' : 'New Attendance'}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={saving} onClick={submit}>{editing ? 'Save Changes' : 'Save Attendance'}</Button></div>}>
      <Form form={form} layout="vertical" initialValues={initial} onValuesChange={preflight}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true, message: 'Select an employee' }]}>
          <Select showSearch optionFilterProp="label" disabled={editing} placeholder="Search name, employee #, department"
            options={(employees.data || []).filter((e: any) => e.active || e.id === initial.employeeId).map((e: any) => ({ label: `${e.firstName} ${e.lastName} · ${e.employeeNo}${e.position ? ` · ${e.position}` : ''}`, value: e.id }))} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="date" label="Date" rules={[{ required: true }]}><DatePicker className="w-full" disabledDate={(d) => d && d.isAfter(dayjs(), 'day')} /></Form.Item></Col>
          <Col span={8}><Form.Item name="status" label="Attendance Status" rules={[{ required: true }]}><Select options={STATUSES} /></Form.Item></Col>
          <Col span={8}><Form.Item name="breakMinutes" label="Break Duration (min)"><InputNumber min={0} className="w-full" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="checkIn" label="Clock In"><TimePicker format="HH:mm" className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item name="checkOut" label="Clock Out"><TimePicker format="HH:mm" className="w-full" /></Form.Item></Col>
        </Row>

        {pre && (
          <>
            <div className="nex-card border rounded-lg p-4 mb-3">
              <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Work schedule</div>
              <div className="grid grid-cols-2 gap-x-6">
                <DetailItem label="Schedule" value={`${pre.schedule?.scheduledStart} – ${pre.schedule?.scheduledEnd}`} />
                <DetailItem label="Expected break" value={`${pre.schedule?.breakMinutes} min`} />
                <DetailItem label="Work calendar" value={pre.schedule?.calendar} />
                <DetailItem label="Expected hours" value={`${fmtNumber((toMin(pre.schedule?.scheduledStart) - toMin(pre.schedule?.scheduledEnd)) / -60 - (pre.schedule?.breakMinutes || 0) / 60, 1)}h`} />
              </div>
            </div>
            {pre.holiday && <Alert className="mb-3" type="info" showIcon message={`Public Holiday — ${pre.holiday.name}`} />}
            {pre.nonWorkingDay && <Alert className="mb-3" type="warning" showIcon message="Scheduled non-working day" description="Attendance can still be recorded if the employee worked; overtime rules apply." />}
            {pre.leave && <Alert className="mb-3" type="warning" showIcon message="Approved leave exists for this employee on this date." description={`${pre.leave.type} · ${pre.leave.days} day(s) (${pre.leave.reference}). Default the status to ON LEAVE.`} />}
            {pre.existing && !editing && <Alert className="mb-3" type="error" showIcon message="Attendance already exists for this employee on this date." description="Turn on Override to replace it, or close and view the existing record." />}
          </>
        )}

        {calc && (
          <div className="nex-card border rounded-lg p-4 mb-3">
            <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Calculated hours</div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
              <div><div className="text-[12px] text-[#64748b]">Worked</div><div className="text-[18px] font-bold">{fmtNumber(calc.workedHours, 1)}h</div></div>
              <div><div className="text-[12px] text-[#64748b]">Regular</div><div className="text-[18px] font-bold">{fmtNumber(calc.regularHours, 1)}h</div></div>
              <div><div className="text-[12px] text-[#64748b]">Overtime</div><div className="text-[18px] font-bold text-[#e11d48]">{fmtNumber(calc.overtimeHours, 1)}h</div></div>
              <div><div className="text-[12px] text-[#64748b]">Late</div><div className="text-[18px] font-bold text-[#b45309]">{fmtNumber(calc.lateMinutes, 0)}m</div></div>
            </div>
            <div className="text-[12px] text-[#94a3b8] mt-2">Early departure: {fmtNumber(calc.earlyDeparture, 0)}m · Potential overtime requires approval before payroll.</div>
          </div>
        )}

        <Form.Item name="reason" label="Reason for Manual Entry" rules={[{ required: true, message: 'A reason is required and will be audited' }]}><Input.TextArea rows={2} /></Form.Item>
        {pre?.existing && !editing && <Form.Item name="override" valuePropName="checked"><label className="text-[13px]"><input type="checkbox" className="accent-[#003366] mr-2" />Override existing record</label></Form.Item>}
      </Form>
    </Drawer>
  );
}

function toMin(t?: string) { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }

// ======================================================================
// Attendance details drawer
// ======================================================================
function AttendanceDetailDrawer({ id, onClose, onEdit, onChanged }: { id: string; onClose: () => void; onEdit: (rec: any) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['/hr/attendance', id], queryFn: () => api(`/hr/attendance/${id}`) });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const r = data?.record;
  const e = data?.employee;

  async function act(approved: boolean, noteText?: string) {
    try { await api(`/hr/attendance/${id}/approve`, { method: 'POST', body: JSON.stringify({ approved, note: noteText }) }); message.success(approved ? 'Overtime approved' : 'Overtime rejected'); onChanged(); qc.invalidateQueries({ queryKey: ['/hr/attendance', id] }); onClose(); }
    catch (err: any) { message.error(err.message); }
  }

  return (
    <Drawer open onClose={onClose} width={780} destroyOnHidden
      title={r ? <div><div className="text-[16px] font-bold text-[#171a2e]">Attendance Details</div><div className="text-[12px] text-[#64748b] font-normal">{e?.firstName} {e?.lastName} · {fmtDate(r.date)}</div></div> : 'Attendance Details'}
      extra={r && <Space size="small"><StatusPill status={r.status} />{Number(r.overtimeHours) > 0 && <StatusPill status={r.approved ? 'APPROVED' : 'PENDING'} />}<Can permission="hr.attendance.manage"><Button size="small" icon={<EditOutlined />} onClick={() => onEdit(r)}>Edit</Button></Can></Space>}>
      {isLoading || !r ? <Skeleton active /> : (
        <div className="space-y-4">
          <Section title="Attendance">
            <DetailItem label="Employee" value={`${e?.firstName} ${e?.lastName}`} />
            <DetailItem label="Employee #" value={e?.employeeNo} />
            <DetailItem label="Department" value={e?.department?.name} />
            <DetailItem label="Branch" value={e?.department?.branch?.name} />
            <DetailItem label="Date" value={fmtDate(r.date)} />
            <DetailItem label="Clock in" value={toHM(r.checkIn)} />
            <DetailItem label="Clock out" value={toHM(r.checkOut)} />
            <DetailItem label="Break" value={`${r.breakMinutes} min`} />
            <DetailItem label="Attendance status" value={statusLabel(r.status)} />
            <DetailItem label="Approval status" value={Number(r.overtimeHours) > 0 ? (r.approved ? 'APPROVED' : 'PENDING') : '—'} />
            <DetailItem label="Source" value={r.source} />
            <DetailItem label="Created at" value={fmtDateTime(r.createdAt)} />
            <DetailItem label="Notes / reason" value={r.note} />
          </Section>

          <Section title="Schedule">
            <DetailItem label="Scheduled start" value={r.scheduledStart} />
            <DetailItem label="Scheduled end" value={r.scheduledEnd} />
            <DetailItem label="Expected break" value={`${r.breakMinutes} min`} />
          </Section>

          <Section title="Hours">
            <DetailItem label="Worked hours" value={`${fmtNumber(r.workedHours, 1)}h`} />
            <DetailItem label="Regular hours" value={`${fmtNumber(r.regularHours, 1)}h`} />
            <DetailItem label="Overtime" value={`${fmtNumber(r.overtimeHours, 1)}h`} />
            <DetailItem label="Late" value={`${fmtNumber(r.lateMinutes, 0)} min`} />
            <DetailItem label="Early departure" value={`${fmtNumber(r.earlyDeparture, 0)} min`} />
          </Section>

          <Section title="Exceptions">
            {data.exceptions?.length ? data.exceptions.map((x: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-[#f0f1f6] last:border-0 text-[13px]">
                <span className="text-[#344054]">{x.type.replace(/_/g, ' ')}</span>
                <span className="text-[#64748b]">{x.minutes ? `${x.minutes} min` : x.hours ? `${fmtNumber(x.hours, 1)}h` : ''}</span>
              </div>
            )) : <div className="text-[13px] text-[#94a3b8] py-2">No attendance exceptions.</div>}
          </Section>

          {Number(r.overtimeHours) > 0 && (
            <Section title="Overtime">
              <DetailItem label="Detected OT" value={`${fmtNumber(r.overtimeHours, 1)}h`} />
              <DetailItem label="Approved OT" value={r.approved ? `${fmtNumber(r.overtimeHours, 1)}h` : '0h'} />
              <DetailItem label="Status" value={r.approved ? 'APPROVED' : 'PENDING'} />
              <DetailItem label="Payroll" value={data.payrollStatus ? (data.payrollStatus.included ? `Included in ${data.payrollStatus.reference}` : 'Not yet processed') : '—'} />
              {!r.approved && <div className="flex gap-2 mt-3"><Can permission="hr.attendance.manage"><Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => act(true)}>Approve Overtime</Button></Can><Can permission="hr.attendance.manage"><Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejectOpen(true)}>Reject Overtime</Button></Can></div>}
            </Section>
          )}

          <Section title="Linked records">
            {data.linkedLeave ? (
              <div className="py-1.5 text-[13px]"><div className="text-[#344054]">Leave Request {data.linkedLeave.reference}</div><div className="text-[#64748b]">{data.linkedLeave.type} · {fmtNumber(data.linkedLeave.days, 1)} day(s)</div></div>
            ) : <div className="text-[13px] text-[#94a3b8] py-2">No linked leave.</div>}
            {data.holiday && <div className="py-1.5 text-[13px] text-[#1d4ed8]">Holiday · {data.holiday.name}</div>}
          </Section>

          <Section title="Audit">
            {data.audit?.length ? data.audit.map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-[#f0f1f6] last:border-0 text-[13px]">
                <span className="text-[#344054]">{a.action.replace(/_/g, ' ')} · {a.user}{a.reason ? ` · ${a.reason}` : ''}</span>
                <span className="text-[#94a3b8] text-[12px]">{fmtDateTime(a.at)}</span>
              </div>
            )) : <div className="text-[13px] text-[#94a3b8] py-2">No audit entries.</div>}
          </Section>
        </div>
      )}
      <Drawer open={rejectOpen} onClose={() => setRejectOpen(false)} width={400} title="Reject overtime"
        footer={<div className="flex justify-end gap-2"><Button onClick={() => setRejectOpen(false)}>Cancel</Button><Button danger type="primary" onClick={() => act(false, note)}>Reject</Button></div>}>
        <Input.TextArea rows={3} placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
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
