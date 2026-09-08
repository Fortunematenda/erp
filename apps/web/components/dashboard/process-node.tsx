'use client';
import Link from 'next/link';
import { Tooltip } from 'antd';

// A single module node: icon above a compact label. No description. Clickable.
// `tooltip` shows the full name on hover/focus when the visible label is short.
export function ProcessNode({ label, icon, href, accent = '#003366', tooltip }: { label: string; icon: React.ReactNode; href: string; accent?: string; tooltip?: string }) {
  return (
    <Tooltip title={tooltip || `Open ${label}`}>
      <Link href={href} className="nex-process-node">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[15px] shrink-0" style={{ background: `${accent}14`, color: accent }}>{icon}</span>
        <span className="nex-process-node-label text-[12px] font-medium text-[#1f2937] leading-tight whitespace-nowrap">{label}</span>
      </Link>
    </Tooltip>
  );
}
