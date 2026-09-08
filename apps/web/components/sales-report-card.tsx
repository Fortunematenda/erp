'use client';
import React from 'react';

export function ReportSummaryCard({ label, value, tone, valueColor }: { label: string; value: React.ReactNode; tone: string; valueColor?: string }) {
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-[#eef0f6] bg-white p-4.5 pt-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: tone }} />
      <div className="text-[13px] font-medium text-[#344054] text-left">{label}</div>
      <div className="text-[20px] font-semibold leading-[1.2] tracking-[-0.01em] mt-1" style={{ color: valueColor || '#1f2937' }}>{value}</div>
    </div>
  );
}

