'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Col, Descriptions, Row, Skeleton, Space, Table, Tabs, Tag, message } from 'antd';
import { ArrowLeftOutlined, EditOutlined, MoreOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { StatusPill, DetailItem } from '@/components/sales-ui';
import { EmployeeDrawer } from '@/components/employee-drawer';
import { fmtDate, fmtMoney } from '@/lib/format';

const PAYROLL_TABS = [{ key: 'payroll', label: 'Current compensation' }, { key: 'history', label: 'Compensation history' }];

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const qc = useQueryClient();
  const emp = useQuery({ queryKey: ['/hr/employees', id], queryFn: () => api(`/hr/employees/${id}`) });
  const leaves = useQuery({ queryKey: ['emp-leaves', id], queryFn: () => api('/hr/leave-requests') });
  const attendance = useQuery({ queryKey: ['emp-attendance', id], queryFn: () => api('/hr/attendance') });
  const balances = useQuery({ queryKey: ['emp-balances', id], queryFn: () => api(`/hr/employees/${id}/leave-balances`) });
  const performance = useQuery({ queryKey: ['emp-perf', id], queryFn: () => api(`/hr/employees/${id}/performance`) });
  const compHistory = useQuery({ queryKey: ['emp-comp', id], queryFn: () => api(`/hr/employees/${id}/compensation-history`) });
  const [editOpen, setEditOpen] = useState(false);

  if (emp.isLoading) return <div className="nex-card p-6"><Skeleton active /></div>;
  const e = emp.data;

  async function offboard() {
    try { await api(`/hr/employees/${id}/offboard`, { method: 'POST', body: JSON.stringify({ reason: 'Offboarded' }) }); message.success('Employee offboarded'); qc.invalidateQueries({ queryKey: ['/hr/employees'] }); qc.invalidateQueries({ queryKey: ['/hr/employees', id] }); }
    catch (err: any) { message.error(err.message); }
  }

  const payCols: ColumnsType<any> = [
    { title: 'Effective', dataIndex: 'effectiveDate', render: (v) => fmtDate(v) },
    { title: 'Base', dataIndex: 'baseSalary', render: (v) => fmtMoney(v) },
    { title: 'Currency', dataIndex: 'currency', width: 90 },
    { title: 'Frequency', dataIndex: 'payFrequency', width: 110 },
    { title: 'Reason', dataIndex: 'reason' },
  ];

  const empLeaveCols: ColumnsType<any> = [
    { title: 'Type', dataIndex: 'leaveType' },
    { title: 'Start', dataIndex: 'startDate', render: (v) => fmtDate(v) },
    { title: 'End', dataIndex: 'endDate', render: (v) => fmtDate(v) },
    { title: 'Days', dataIndex: 'days', align: 'right' },
    { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
  ];
  const empAttCols: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'date', render: (v) => fmtDate(v) },
    { title: 'Status', dataIndex: 'status', render: (v) => <StatusPill status={v} /> },
    { title: 'Check in', dataIndex: 'checkIn', render: (v) => (v ? fmtDate(v) : '-') },
    { title: 'Check out', dataIndex: 'checkOut', render: (v) => (v ? fmtDate(v) : '-') },
    { title: 'Note', dataIndex: 'note' },
  ];

  const myLeaves = (leaves.data || []).filter((l: any) => l.employeeId === id);
  const myAtt = (attendance.data || []).filter((a: any) => a.employeeId === id);
  const perf = performance.data;
  const reviewRows = perf?.reviews || [];

  return (
    <div className="nex-fade">
      <div className="flex items-center gap-2 mb-5">
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.back()}>Employees</Button>
      </div>
      <div className="nex-card p-6 mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-[20px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg,#003366,#1d5fb5)' }}>{(e?.firstName || '?').charAt(0)}{(e?.lastName || '').charAt(0)}</div>
            <div>
              <div className="text-[20px] font-bold text-[#171a2e]">{e?.preferredName || `${e?.firstName} ${e?.lastName}`}</div>
              <div className="text-[13px] text-[#64748b]">{e?.employeeNo} · {e?.position || 'No role'} · {e?.department?.name || 'No department'}</div>
              <div className="mt-1.5"><StatusPill status={e?.status || e?.employmentStatus} /></div>
            </div>
          </div>
          <Space>
            <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>Edit</Button>
            <Button icon={<MoreOutlined />} onClick={offboard}>Offboard</Button>
          </Space>
        </div>
      </div>

      <Tabs defaultActiveKey="overview" items={[
        { key: 'overview', label: 'Overview', children: (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="nex-card p-0 overflow-hidden">
              <div className="text-[13px] font-semibold text-[#171a2e] px-5 py-4 border-b">Employee</div>
              <div className="p-5 space-y-2">
                <DetailItem label="Employee number" value={e?.employeeNo} />
                <DetailItem label="Job title" value={e?.position} />
                <DetailItem label="Department" value={e?.department?.name} />
                <DetailItem label="Employment type" value={e?.contractType?.replace(/_/g, ' ')} />
                <DetailItem label="Start date" value={fmtDate(e?.hireDate)} />
                <DetailItem label="Work email" value={e?.workEmail || e?.email} />
                <DetailItem label="Mobile" value={e?.mobile} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div className="nex-card p-4"><div className="text-[12px] font-semibold text-[#64748b]">Leave balance</div><div className="text-[22px] font-bold text-[#171a2e] mt-1">{(balances.data || []).reduce((s: number, b: any) => s + Number(b.available), 0) || 0}d</div></div>
              <div className="nex-card p-4"><div className="text-[12px] font-semibold text-[#64748b]">Performance</div><div className="text-[22px] font-bold text-[#171a2e] mt-1">{perf?.currentCycle?.name || 'No active cycle'}</div></div>
              <div className="nex-card p-4"><div className="text-[12px] font-semibold text-[#64748b]">QA result</div><div className="text-[22px] font-bold text-[#171a2e] mt-1">{reviewRows.length ? '—' : 'No QA'}</div></div>
              <div className="nex-card p-4"><div className="text-[12px] font-semibold text-[#64748b]">Leave requests</div><div className="text-[22px] font-bold text-[#171a2e] mt-1">{myLeaves.length}</div></div>
            </div>
          </div>
        ) },
        { key: 'employment', label: 'Employment', children: (
          <div className="nex-card p-5">
            <DetailItem label="Employment type" value={e?.contractType?.replace(/_/g, ' ')} />
            <DetailItem label="Employment status" value={e?.employmentStatus} />
            <DetailItem label="Start date" value={fmtDate(e?.hireDate)} />
            <DetailItem label="Probation end" value={fmtDate(e?.probationEndDate)} />
            <DetailItem label="Contract end" value={fmtDate(e?.contractEndDate)} />
            <DetailItem label="Work calendar" value={e?.workCalendar?.name} />
          </div>
        ) },
        { key: 'leave', label: 'Leave', children: (
          <div className="nex-card">
            <div className="space-y-2 px-5 pt-4 pb-1">
              {(balances.data || []).map((b: any) => <div key={b.leaveTypeId} className="flex items-center justify-between text-[13px] py-1.5 border-b border-[#f0f1f6] last:border-0"><span className="text-[#344054] font-medium">{b.name}</span><span className="text-[#64748b]">Entitled {b.entitled} · Used {b.used} · Pending {b.pending} · <span className="text-[#171a2e] font-semibold">Available {b.available}</span></span></div>)}
              {!balances.data?.length && <div className="text-[13px] text-[#94a3b8] py-4">No leave balances configured.</div>}
            </div>
            <div className="px-5 pb-4"><Table rowKey="id" size="small" dataSource={myLeaves} columns={empLeaveCols} pagination={false} /></div>
          </div>
        ) },
        { key: 'attendance', label: 'Attendance', children: (
          <div className="nex-card p-4"><Table rowKey="id" size="small" dataSource={myAtt} columns={empAttCols} pagination={false} /></div>
        ) },
        { key: 'performance', label: 'Performance', children: <EmployeePerformanceTab employeeId={id} perf={perf} reviewRows={reviewRows} /> },
        { key: 'payroll', label: 'Payroll', children: (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="nex-card p-5">
              <DetailItem label="Base salary" value={fmtMoney(e?.basicSalary)} />
              <DetailItem label="Currency" value={e?.currency} />
              <DetailItem label="Pay frequency" value={e?.payFrequency} />
              <DetailItem label="Compensation type" value={e?.compensationType} />
            </div>
            <div className="nex-card p-4"><Table rowKey="id" size="small" dataSource={compHistory.data || []} columns={payCols} pagination={false} /></div>
          </div>
        ) },
        { key: 'documents', label: 'Documents', children: (
          <div className="nex-card p-5"><div className="text-[13px] text-[#94a3b8]">Employee documents will appear here (Employment contract, ID, qualifications, certificates, tax documents).</div></div>
        ) },
        { key: 'assets', label: 'Assets', children: (
          <div className="nex-card p-5"><div className="text-[13px] text-[#94a3b8]">Assigned assets will appear here.</div></div>
        ) },
        { key: 'projects', label: 'Projects', children: (
          <div className="nex-card p-5"><div className="text-[13px] text-[#94a3b8]">Project assignments will appear here.</div></div>
        ) },
        { key: 'audit', label: 'Audit', children: (
          <div className="nex-card p-5"><div className="text-[13px] text-[#94a3b8]">Employee audit history will appear here.</div></div>
        ) },
      ]} />
      <EmployeeDrawer open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['/hr/employees'] })} editing={e} />
    </div>
  );
}

function EmployeePerformanceTab({ employeeId, perf, reviewRows }: { employeeId: string; perf: any; reviewRows: any[] }) {
  const history = useQuery({ queryKey: ['perf-history', employeeId], queryFn: () => api(`/performance/employees/${employeeId}/history`) });
  const rows = history.data || [];
  const current = rows[0];
  const approved = rows.filter((r: any) => r.score != null);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <PerfCard label="Current Cycle" value={current?.cycle || perf?.currentCycle?.name || 'No active cycle'} />
        <PerfCard label="Current Score" value={current?.score != null ? `${Number(current.score).toFixed(1)}%` : '—'} />
        <PerfCard label="Submission Status" value={current ? (current.kpiCompletion === 100 ? 'SUBMITTED' : 'IN PROGRESS') : '—'} />
        <PerfCard label="Final Result" value={current?.result || '—'} color={current?.result === 'PASS' ? '#16a34a' : current?.result === 'FAIL' ? '#dc2626' : undefined} />
        <PerfCard label="Band" value={current?.band || '—'} />
      </div>

      {approved.length > 1 && (
        <div className="nex-card border rounded-lg p-4">
          <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Performance Trend (approved results)</div>
          <div className="flex items-end gap-3 h-28">
            {[...approved].reverse().map((r: any) => (
              <div key={r.id} className="flex flex-col items-center gap-1 flex-1 max-w-16">
                <div className="text-[11px] font-semibold text-[#171a2e]">{Number(r.score).toFixed(0)}%</div>
                <div className="w-full rounded-t" style={{ height: `${Math.max(6, Math.min(100, Number(r.score)) * 0.8)}px`, background: Number(r.score) >= 70 ? 'linear-gradient(180deg,#1d5fb5,#003366)' : '#dc2626' }} />
                <div className="text-[10px] text-[#94a3b8] truncate w-full text-center">{r.cycle}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="nex-card p-0 overflow-hidden">
        <div className="text-[13px] font-semibold text-[#171a2e] px-5 py-4 border-b">Assessment History</div>
        <Table rowKey="id" size="small" dataSource={rows} pagination={false} columns={[
          { title: 'Cycle', dataIndex: 'cycle' },
          { title: 'Template', dataIndex: 'templateName' },
          { title: 'Score', width: 90, align: 'right', render: (_v: any, r: any) => r.score != null ? <span className="font-semibold">{Number(r.score).toFixed(1)}%</span> : '—' },
          { title: 'KPI Completion', width: 120, align: 'right', render: (_v: any, r: any) => `${r.kpiCompletion ?? 0}%` },
          { title: 'Result', width: 90, render: (_v: any, r: any) => r.result ? <StatusPill status={r.result} /> : '—' },
          { title: 'Status', width: 140, render: (_v: any, r: any) => <StatusPill status={r.status} /> },
          { title: 'Actions', width: 90, align: 'right', render: () => <Link href={`/performance?tab=assessments`}><Button size="small">Open</Button></Link> },
        ] as ColumnsType<any>} />
      </div>
      {reviewRows?.length > 0 && (
        <div className="nex-card p-5">
          <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Legacy reviews</div>
          {reviewRows.map((r: any) => <div key={r.id} className="mt-2 border-t border-[#f0f1f6] pt-2"><DetailItem label="Cycle" value={r.cycle?.name} /><DetailItem label="Overall" value={r.overallRating} /><DetailItem label="Status" value={r.status} /></div>)}
        </div>
      )}
    </div>
  );
}

function PerfCard({ label, value, color }: { label: string; value: any; color?: string }) {
  return <div className="nex-card border rounded-lg p-4 text-center"><div className="text-[12px] font-semibold text-[#64748b]">{label}</div><div className="text-[16px] font-bold text-[#171a2e] mt-1 truncate" style={color ? { color } : undefined}>{value}</div></div>;
}
