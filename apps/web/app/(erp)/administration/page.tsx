'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Tabs, Tag } from 'antd';
import {
  ApartmentOutlined, FileSearchOutlined, SafetyCertificateOutlined, UserOutlined,
  ExclamationCircleOutlined, TeamOutlined, MailOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { api } from '@/lib/api';
import { StatCard } from '@/components/stat-card';
import { PageHeader } from '@/components/page';
import { Can } from '@/components/Can';
import { UsersTab } from '@/components/administration/users-tab';
import { MembershipsTab } from '@/components/administration/memberships-tab';
import { BranchesTab } from '@/components/administration/branches-tab';
import { AuditTab } from '@/components/administration/audit-tab';
import { ConfigTab } from '@/components/administration/config-tab';
import { NeedsAttention } from '@/components/administration/needs-attention';
import { HelpTooltip } from '@/components/administration/shared';

export default function Administration() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('users');
  const dash = useQuery({ queryKey: ['/admin/dashboard'], queryFn: () => api('/admin/dashboard') });
  const k = dash.data?.kpis || {};

  // Deep-link support: #admin-user-<id> opens the users tab (detail drawer is
  // driven by the row's View button for now).
  useEffect(() => {
    const onHash = () => { if (window.location.hash.startsWith('#admin-user-')) setTab('users'); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const items = [
    { key: 'users', label: 'Users', children: <Can permission="admin.users.view" fallback={<AccessDenied />}><UsersTab /></Can> },
    { key: 'memberships', label: 'Memberships', children: <Can permission="admin.memberships.view" fallback={<AccessDenied />}><MembershipsTab /></Can> },
    { key: 'branches', label: 'Branches', children: <Can permission="admin.branches.view" fallback={<AccessDenied />}><BranchesTab /></Can> },
    { key: 'audit', label: 'Audit Logs', children: <Can permission="admin.audit.view" fallback={<AccessDenied />}><AuditTab /></Can> },
    { key: 'config', label: 'Configuration', children: <Can permission="admin.config.view" fallback={<AccessDenied />}><ConfigTab /></Can> },
  ];

  return (
    <div className="nex-fade">
      <PageHeader
        title="Administration"
        subtitle="Users, access, branches and system configuration"
        extra={<Button icon={<ReloadOutlined />} onClick={() => { qc.invalidateQueries({ queryKey: ['/admin/dashboard'] }); }}>Refresh</Button>}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard icon={<UserOutlined />} label="Active Users" value={k.activeUsers ?? '—'} hint={`${k.inactiveUsers ?? 0} inactive / locked`} />
        <StatCard icon={<ApartmentOutlined />} label="Active Branches" value={k.branches ?? '—'} hint="Company locations" />
        <StatCard icon={<ExclamationCircleOutlined />} label="Access Reviews" value={k.reviewCount ?? '—'} hint={`${k.attentionCount ?? 0} attention item(s)`} />
        <StatCard icon={<FileSearchOutlined />} label="Audit Events Today" value={k.auditToday ?? '—'} hint="Recorded actions" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <div className="xl:col-span-2">
          <Card className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
            <Tabs items={items} activeKey={tab} onChange={setTab} destroyOnHidden />
          </Card>
        </div>
        <div>
          <NeedsAttention onNavigate={setTab} />
        </div>
      </div>
    </div>
  );
}

function AccessDenied() {
  return <div className="py-14 text-center text-slate-400">You do not have permission to view this section.</div>;
}
