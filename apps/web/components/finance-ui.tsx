'use client';
import React from 'react';

export function FinanceSummaryCard({ label, value, valueColor = '#2563eb', subtitle }: { label: string; value: React.ReactNode; valueColor?: string; subtitle?: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-white p-4 pt-5" style={{ border: '1px solid #e9edf2', borderTop: `3px solid ${valueColor}` }}>
      <div className="text-[11px] font-medium text-[#667085] text-left">{label}</div>
      <div className="text-[13px] font-semibold leading-tight mt-0.5 tabular-nums" style={{ color: valueColor }}>{value}</div>
      {subtitle && <div className="text-[12px] text-[#98A2B3] mt-0.5">{subtitle}</div>}
    </div>
  );
}

