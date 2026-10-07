'use client';

import type { ReactNode } from 'react';
import { Button, Empty, Result } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { notify } from '@/lib/notify';

export function ERPEmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-12 px-4">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null} />
      <div className="text-[15px] font-semibold text-[var(--foreground)] mt-1">{title}</div>
      {description ? <div className="text-[13px] text-[var(--text-muted)] mt-1 max-w-sm mx-auto">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ERPErrorState({ title = 'Unable to load this page', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="nex-card p-8 text-center">
      <Result
        status="error"
        title={<span className="text-[16px]">{title}</span>}
        subTitle={message ? <span className="text-[13px]">{message}</span> : undefined}
        extra={onRetry ? <Button icon={<ReloadOutlined />} onClick={onRetry}>Retry</Button> : undefined}
      />
    </div>
  );
}

export function ERPPageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="py-16 text-center text-[13px] text-[var(--text-muted)]" role="status">
      {label}
    </div>
  );
}

/** Sonner is the only toast system. */
export const ERPNotification = notify;
