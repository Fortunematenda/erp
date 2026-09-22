'use client';
import { StatutoryRulesManager } from '@/components/payroll-management';

export default function PayrollRulesPage() {
  return (
    <div className="nex-fade">
      <div className="mb-5">
        <h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Payroll Rules (Statutory)</h1>
        <p className="text-[13px] text-[#64748b] mt-1">Effective-dated statutory rules used by payroll. Configure PAYE tax bands, NSSA / pension / medical contributions and GL mapping using structured fields — no JSON required.</p>
      </div>
      <div className="nex-card p-4">
        <StatutoryRulesManager />
      </div>
    </div>
  );
}
