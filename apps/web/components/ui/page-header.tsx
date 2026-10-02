'use client';
import type { ReactNode } from 'react';

/** Standard ERP page header: title, short description, right-aligned actions. */
export function PageHeader({ title, description, actions, contextMenu, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; contextMenu?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 mb-5 ${className || ''}`}>
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-[13px] text-[#64748b] mt-1">{description}</p>}
      </div>
      {(actions || contextMenu) && <div className="flex items-center gap-2 shrink-0">{actions}{contextMenu}</div>}
    </div>
  );
}
