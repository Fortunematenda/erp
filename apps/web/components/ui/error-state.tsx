'use client';
import { Button } from 'antd';
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons';

/** Consistent error state with an optional Retry action. */
export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="nex-card p-8 text-center">
      <div className="w-11 h-11 rounded-xl bg-[#fdeceb] text-[#dc2626] flex items-center justify-center mx-auto mb-3"><WarningOutlined /></div>
      <div className="text-[15px] font-semibold text-[#171a2e]">{title}</div>
      {message && <div className="text-[13px] text-[#64748b] mt-1 max-w-md mx-auto break-words">{message}</div>}
      {onRetry && <Button className="mt-4" icon={<ReloadOutlined />} onClick={onRetry}>Retry</Button>}
    </div>
  );
}
