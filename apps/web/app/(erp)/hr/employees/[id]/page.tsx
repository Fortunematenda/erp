'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Skeleton, Tabs, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import {
  AuditTab, AssetsTab, AttendanceTab, DocumentsTab, Employee360Drawers, Employee360Header,
  EmployeeCtx, EmploymentTab, IncentivesTab, LeaveTab, OverviewTab, PayrollTab, PerformanceTab, ProjectsTab,
  type DrawerName,
} from '@/components/employee-360';

const TABS = ['overview', 'employment', 'leave', 'attendance', 'performance', 'incentives', 'payroll', 'documents', 'assets', 'projects', 'audit'];

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const id = String(params?.id || '');
  const tab = search.get('tab') || 'overview';
  const [drawer, setDrawer] = useState<{ name: DrawerName; payload?: any } | null>(null);

  const emp = useQuery({ queryKey: ['/hr/employees', id], queryFn: () => api(`/hr/employees/${id}`) });
  const counts = useQuery({ queryKey: ['emp-360', id], queryFn: () => api(`/hr/employees/${id}/360`) });

  const goTab = useCallback((t: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    router.replace(`${url.pathname}?${url.searchParams.toString()}`);
  }, [router]);

  useEffect(() => { if (!TABS.includes(tab)) goTab('overview'); }, [tab, goTab]);

  const refetchAll = useCallback(() => {
    ['/hr/employees', 'emp-360', 'emp-leave-ws', 'emp-att-ws', 'emp-perf-ws', 'emp-incentives', 'emp-payroll-ws', 'emp-docs', 'emp-assets', 'emp-projects', 'emp-audit', 'emp-employment-history', 'emp-comp'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }, [qc]);

  if (emp.isLoading) return <div className="nex-card p-6"><Skeleton active /></div>;
  const e = emp.data;
  if (!e) return <div className="nex-card p-6">Employee not found.</div>;
  const c = counts.data?.counts || {};

  const openDrawer = (name: DrawerName, payload?: any) => setDrawer({ name, payload });

  const items = [
    { key: 'overview', label: 'Overview', children: <OverviewTab /> },
    { key: 'employment', label: 'Employment', children: <EmploymentTab /> },
    { key: 'leave', label: c.leave ? `Leave (${c.leave})` : 'Leave', children: <LeaveTab /> },
    { key: 'attendance', label: 'Attendance', children: <AttendanceTab /> },
    { key: 'performance', label: 'Performance', children: <PerformanceTab /> },
    { key: 'incentives', label: c.incentives ? `Incentives (${c.incentives})` : 'Incentives', children: <IncentivesTab /> },
    { key: 'payroll', label: 'Payroll', children: (
      <Can permission={['payroll.view', 'payroll.view_compensation']} fallback={<div className="nex-card p-8 text-center text-[13px] text-[#64748b]">Payroll — Restricted. You do not have permission to view compensation for this employee.</div>}>
        <PayrollTab />
      </Can>
    ) },
    { key: 'documents', label: c.documents ? `Documents (${c.documents})` : 'Documents', children: <DocumentsTab /> },
    { key: 'assets', label: c.assets ? `Assets (${c.assets})` : 'Assets', children: <AssetsTab /> },
    { key: 'projects', label: c.projects ? `Projects (${c.projects})` : 'Projects', children: <ProjectsTab /> },
    { key: 'audit', label: 'Audit', children: <AuditTab /> },
  ];

  const ctx = { id, employee: { ...e, manager: counts.data?.employee?.manager, userAccount: counts.data?.employee?.userAccount }, currency: e.currency || 'USD', openDrawer, goTab, qc };

  return (
    <div className="nex-fade">
      <div className="flex items-center gap-2 mb-5">
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/hr?tab=employees')}>Employees</Button>
      </div>

      <EmployeeCtx.Provider value={ctx}>
        <Employee360Header employee={ctx.employee} onOpenDrawer={openDrawer} />
        <Tabs activeKey={tab} onChange={goTab} items={items} destroyOnHidden={false} />
        <Employee360Drawers drawer={drawer} close={() => setDrawer(null)} employee={e} refetchAll={refetchAll} />
      </EmployeeCtx.Provider>
    </div>
  );
}
