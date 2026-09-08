'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Empty } from 'antd';
import { ExclamationCircleOutlined, TeamOutlined, MailOutlined, UserAddOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';

const SEVERITY = {
  high: { color: '#b91c1c', bg: '#fef2f2' },
  medium: { color: '#c2410c', bg: '#fff7ed' },
  low: { color: '#1d4ed8', bg: '#eff6ff' },
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  OFFBOARDED_ACCESS: <ExclamationCircleOutlined />,
  NO_USER: <UserAddOutlined />,
  PENDING_INVITE: <MailOutlined />,
  NO_BRANCH: <TeamOutlined />,
};

export function NeedsAttention({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ['/admin/dashboard'], queryFn: () => api('/admin/dashboard') });
  const items = dash.data?.attention || [];
  const reviews = dash.data?.reviews || [];

  function handle(r: any) {
    if (r.action === 'deactivate' && r.userId) {
      window.location.href = `#admin-user-${r.userId}`;
      onNavigate?.('users');
      return;
    }
    if (r.action === 'create_user' && r.employeeId) {
      onNavigate?.('users');
      window.dispatchEvent(new CustomEvent('admin:preselect-employee', { detail: r.employeeId }));
      return;
    }
    if (r.action === 'edit_access' && r.userId) {
      window.location.href = `#admin-user-${r.userId}`;
      onNavigate?.('users');
      return;
    }
    if (r.action === 'resend_invite' && r.userId) {
      window.location.href = `#admin-user-${r.userId}`;
      onNavigate?.('users');
      return;
    }
    onNavigate?.('users');
  }

  return (
    <div className="nex-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-slate-700 flex items-center gap-2">
          <ExclamationCircleOutlined style={{ color: '#d97706' }} />
          Needs Attention
        </div>
        <Button size="small" type="link" onClick={() => qc.invalidateQueries({ queryKey: ['/admin/dashboard'] })}>Refresh</Button>
      </div>
      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing needs attention" />
      ) : (
        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {items.map((r: any) => {
            const s = SEVERITY[r.severity as keyof typeof SEVERITY] || SEVERITY.medium;
            return (
              <button
                key={r.id}
                onClick={() => handle(reviews.find((x: any) => x.id === r.id) || r)}
                className="w-full text-left rounded-lg border border-slate-100 px-3 py-2.5 hover:border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-[13px]" style={{ color: s.color }}>{TYPE_ICON[r.type] || <ExclamationCircleOutlined />}</span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-slate-700 leading-snug">{r.title}</div>
                    {r.detail && <div className="text-[11.5px] text-slate-400 mt-0.5">{r.detail}</div>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default NeedsAttention;
