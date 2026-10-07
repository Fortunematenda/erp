'use client';

import type { ReactNode } from 'react';

/** Page frame. Gutters come from `.erp-page` on the shell. */
export function ERPPageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`nex-fade ${className || ''}`}>{children}</div>;
}

export function ERPPageHeader({
  title,
  description,
  subtitle,
  actions,
  extra,
  breadcrumb,
  contextMenu,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** @deprecated use description */
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** @deprecated use actions */
  extra?: ReactNode;
  breadcrumb?: ReactNode;
  contextMenu?: ReactNode;
  className?: string;
}) {
  const sub = description ?? subtitle;
  const right = actions ?? extra;
  return (
    <header className={`flex flex-wrap items-start justify-between gap-3 mb-5 ${className || ''}`}>
      <div className="min-w-0">
        {breadcrumb ? <div className="text-[12px] text-[var(--text-faint)] mb-1">{breadcrumb}</div> : null}
        <h1 className="m-0 text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--foreground)]">{title}</h1>
        {sub ? <p className="m-0 mt-1 text-[13px] text-[var(--text-muted)]">{sub}</p> : null}
      </div>
      {(right || contextMenu) ? <div className="flex items-center gap-2 shrink-0">{right}{contextMenu}</div> : null}
    </header>
  );
}

export function ERPSectionHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
      <div>
        <h2 className="m-0 text-[15px] font-semibold text-[var(--foreground)]">{title}</h2>
        {description ? <p className="m-0 mt-0.5 text-[12px] text-[var(--text-muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
