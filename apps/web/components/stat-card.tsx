'use client';

export function StatCard({ icon, label, value, hint, color, gradient }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string; color?: string; gradient?: string }) {
  return (
    <div className="nex-stat nex-card-hover" style={{ background: gradient || '#fff' }}>
      <div className="flex items-center gap-4">
        <div className="nex-stat-icon" style={gradient ? { backgroundImage: gradient } : color ? { background: color } : {}}>{icon}</div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[#64748b] truncate">{label}</div>
          <div className="text-[24px] font-bold text-[#171a2e] leading-tight truncate mt-0.5">{value}</div>
          {hint && <div className="text-[12px] text-[#94a3b8] mt-1 truncate">{hint}</div>}
        </div>
      </div>
    </div>
  );
}
