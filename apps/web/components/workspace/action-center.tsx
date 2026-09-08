'use client';
import { useMemo, useState } from 'react';
import { Badge, Button, Empty, Popover, Skeleton, Tooltip } from 'antd';
import { BellOutlined, CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined, ReloadOutlined, RightOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

type ActionItem = {
  id: string;
  kind: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  description?: string | null;
  href: string;
  createdAt?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
};

const tone: Record<ActionItem['severity'], { bg: string; fg: string; icon: React.ReactNode }> = {
  critical: { bg: '#fff1f0', fg: '#cf1322', icon: <ExclamationCircleOutlined /> },
  warning: { bg: '#fff7e6', fg: '#d46b08', icon: <WarningOutlined /> },
  info: { bg: '#e6f4ff', fg: '#0958d9', icon: <ClockCircleOutlined /> },
  success: { bg: '#f6ffed', fg: '#389e0d', icon: <CheckCircleOutlined /> },
};

function timeLabel(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.round(Math.abs(diff) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export function ActionCenter() {
  const router = useRouter();
  const qc = useQueryClient();
  const companyId = useAuth((s) => s.activeCompanyId);
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['workspace-action-center', companyId],
    queryFn: () => api('/workspace/action-center'),
    enabled: !!companyId,
    refetchInterval: 60000,
    staleTime: 20000,
  });
  const data = query.data || { count: 0, counts: {}, items: [] };
  const items: ActionItem[] = data.items || [];
  const displayCount = Math.min(Number(data.count || 0), 99);
  const summary = useMemo(() => {
    const c = data.counts || {};
    return [
      c.overdueInvoices ? `${c.overdueInvoices} overdue` : null,
      c.approvals ? `${c.approvals} approvals` : null,
      c.fiscalFailures ? `${c.fiscalFailures} fiscal` : null,
      c.lowStock ? `${c.lowStock} stock` : null,
    ].filter(Boolean).join(' · ');
  }, [data.counts]);

  async function openItem(item: ActionItem) {
    if (item.sourceType === 'PerformanceNotification' && item.sourceId) {
      await api(`/performance/notifications/${item.sourceId}/read`, { method: 'POST' }).catch(() => null);
      qc.invalidateQueries({ queryKey: ['workspace-action-center'] });
    }
    setOpen(false);
    router.push(item.href);
  }

  const content = (
    <div className="w-[420px] max-w-[88vw]">
      <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#eef1f6]">
        <div>
          <div className="text-[15px] font-bold text-[#171a2e]">Action centre</div>
          <div className="text-[11.5px] text-[#7c8499] mt-0.5">{summary || 'No urgent business actions'}</div>
        </div>
        <Tooltip title="Refresh">
          <Button size="small" type="text" icon={<ReloadOutlined spin={query.isFetching} />} onClick={() => query.refetch()} />
        </Tooltip>
      </div>

      <div className="max-h-[470px] overflow-y-auto -mx-2 px-2 pt-2">
        {query.isLoading ? <Skeleton active paragraph={{ rows: 5 }} /> : items.length === 0 ? (
          <div className="py-8"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing needs your attention" /></div>
        ) : items.map((item) => {
          const t = tone[item.severity] || tone.info;
          return (
            <button key={item.id} onClick={() => openItem(item)} className="w-full text-left flex items-start gap-3 rounded-xl px-3 py-3 hover:bg-[#f7f9fd] transition-colors cursor-pointer group">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-[15px]" style={{ background: t.bg, color: t.fg }}>{t.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#252a3d] truncate flex-1">{item.title}</span>
                  <span className="text-[10.5px] text-[#9aa1b2] shrink-0">{timeLabel(item.createdAt)}</span>
                </span>
                {item.description && <span className="block text-[11.5px] text-[#6f778b] mt-1 leading-relaxed line-clamp-2">{item.description}</span>}
              </span>
              <RightOutlined className="text-[10px] text-[#b4bac8] mt-3 group-hover:text-[#003366]" />
            </button>
          );
        })}
      </div>

      <div className="pt-3 mt-2 border-t border-[#eef1f6] flex items-center justify-between">
        <span className="text-[11px] text-[#8a90a3]">Live from sales, approvals, inventory, HR & fiscalisation</span>
        <Button type="link" size="small" onClick={() => { setOpen(false); router.push('/dashboard'); }}>Open dashboard</Button>
      </div>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} arrow={false}>
      <Button
        type="text"
        className="nex-notif-btn"
        aria-label="Open action centre"
        icon={<Badge count={displayCount} overflowCount={99} size="small" offset={[-2, 4]} style={{ background: displayCount ? '#dc2626' : '#003366', boxShadow: '0 0 0 2px #fff' }}><BellOutlined /></Badge>}
      />
    </Popover>
  );
}
