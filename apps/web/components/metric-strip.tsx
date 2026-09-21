'use client';
import React from 'react';

export type MetricItem = {
  label: string;
  value: React.ReactNode;
  color?: string;
  onClick?: () => void;
};

/** Compact horizontal KPI strip — centered label/value pairs with uniform amount sizing. */
export function MetricStrip({ items, className = '' }: { items: MetricItem[]; className?: string }) {
  return (
    <div className={`nex-card px-4 py-3 flex flex-wrap gap-3 !rounded-xl ${className}`.trim()}>
      {items.map((k) => {
        const body = (
          <>
            <div className="text-[11px] text-[#64748b] leading-tight">{k.label}</div>
            <div className="text-[13px] font-semibold leading-tight mt-0.5 tabular-nums" style={{ color: k.color || '#171a2e' }}>{k.value}</div>
          </>
        );
        return k.onClick ? (
          <button key={k.label} type="button" onClick={k.onClick} className="flex-1 min-w-[76px] text-center px-1 bg-transparent border-0 cursor-pointer p-0">
            {body}
          </button>
        ) : (
          <div key={k.label} className="flex-1 min-w-[76px] text-center px-1">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Single metric cell for custom layouts (same typography as MetricStrip). */
export function MetricCell({ label, value, color, className = '' }: { label: string; value: React.ReactNode; color?: string; className?: string }) {
  return (
    <div className={`text-center px-1 ${className}`.trim()}>
      <div className="text-[11px] text-[#64748b] leading-tight">{label}</div>
      <div className="text-[13px] font-semibold leading-tight mt-0.5 tabular-nums" style={{ color: color || '#171a2e' }}>{value}</div>
    </div>
  );
}
