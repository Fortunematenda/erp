import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { round2 } from './performance.constants';

@Injectable()
export class PerformanceDashboardService {
  constructor(private prisma: PrismaService) {}

  async dashboard(companyId: string, departmentId?: string) {
    const now = new Date();
    const activeCycle = await this.prisma.performanceCycle.findFirst({
      where: { companyId, status: { in: ['OPEN', 'EMPLOYEE_SUBMISSION', 'MANAGER_REVIEW', 'QA_REVIEW', 'CALIBRATION', 'APPROVAL'] } },
      orderBy: { periodStart: 'desc' },
    });

    const assessments = await this.prisma.employeePerformanceAssessment.findMany({
      where: { companyId, ...(activeCycle ? { cycleId: activeCycle.id } : {}), ...(departmentId ? { departmentId } : {}), excludedReason: null },
      include: { employee: { include: { department: true } }, cycle: true, kpis: { select: { effectiveScore: true, achievement: true } } },
    });

    const due = assessments.filter((a) => !a.excludedReason);
    const submitted = due.filter((a) => a.employeeSubmittedAt);
    const managerDone = due.filter((a) => a.managerSubmittedAt);
    const qaDone = due.filter((a) => a.qaSubmittedAt);
    const scored = due.filter((a) => a.totalScore != null);
    const passed = scored.filter((a) => a.result === 'PASS');
    const approved = due.filter((a) => ['APPROVED', 'COMPLETED', 'LOCKED'].includes(a.status));
    const nowMs = now.getTime();

    const overdueEmployees = due.filter((a) => !a.employeeSubmittedAt && new Date(a.cycle.employeeDeadline).getTime() < nowMs);
    const overdueManagers = due.filter((a) => a.employeeSubmittedAt && !a.managerSubmittedAt && new Date(a.cycle.managerDeadline).getTime() < nowMs);
    const overdueQa = due.filter((a) => a.managerSubmittedAt && !a.qaSubmittedAt && a.cycle.qaDeadline && new Date(a.cycle.qaDeadline).getTime() < nowMs);

    const avgScore = scored.length ? round2(scored.reduce((s, a) => s + Number(a.totalScore), 0) / scored.length) : null;
    const pendingIncentives = await this.prisma.performanceIncentive.count({ where: { companyId, status: 'PENDING_APPROVAL' } });
    const approvedIncentives = await this.prisma.performanceIncentive.count({ where: { companyId, status: { in: ['APPROVED', 'SENT_TO_PAYROLL', 'PAID'] }, ...(departmentId ? { employee: { departmentId } } : {}) } });

    // countdown for the active window
    let window: any = null;
    if (activeCycle) {
      const stages: { key: string; label: string; from: Date; to: Date }[] = [
        { key: 'EMPLOYEE_SUBMISSION', label: 'Employee submission', from: new Date(activeCycle.submissionOpens), to: new Date(activeCycle.employeeDeadline) },
        { key: 'MANAGER_REVIEW', label: 'Manager review', from: new Date(activeCycle.employeeDeadline), to: new Date(activeCycle.managerDeadline) },
        ...(activeCycle.qaDeadline ? [{ key: 'QA_REVIEW', label: 'QA review', from: new Date(activeCycle.employeeDeadline), to: new Date(activeCycle.qaDeadline) }] : []),
        ...(activeCycle.approvalDeadline ? [{ key: 'APPROVAL', label: 'Final approval', from: new Date(activeCycle.managerDeadline), to: new Date(activeCycle.approvalDeadline) }] : []),
      ];
      const current = stages.find((s) => now >= s.from && now <= s.to) || (now < stages[0]?.from ? stages[0] : null);
      const next = stages.find((s) => s.from > now);
      const target = current || next;
      const days = target ? Math.ceil((target.to.getTime() - nowMs) / 86400000) : null;
      window = {
        stage: current?.key || next?.key || 'CLOSED', label: target?.label, closes: target?.to, daysLeft: days,
        overdue: current ? false : nowMs > (stages[stages.length - 1]?.to.getTime() || 0),
      };
    }

    return {
      activeCycle: activeCycle ? { id: activeCycle.id, name: activeCycle.name, status: activeCycle.status, periodStart: activeCycle.periodStart, periodEnd: activeCycle.periodEnd, employeeDeadline: activeCycle.employeeDeadline, managerDeadline: activeCycle.managerDeadline, qaDeadline: activeCycle.qaDeadline, approvalDeadline: activeCycle.approvalDeadline } : null,
      window,
      counts: {
        employeesDue: due.length,
        submitted: submitted.length,
        missing: due.length - submitted.length,
        managerPending: due.length - managerDone.length,
        qaPending: managerDone.length - qaDone.length,
        pendingApproval: qaDone.filter((a) => ['PENDING_APPROVAL', 'PENDING_CALIBRATION'].includes(a.status)).length,
        approved: approved.length,
        overdueEmployees: overdueEmployees.length,
        overdueManagers: overdueManagers.length,
        overdueQa: overdueQa.length,
        avgScore,
        passed: passed.length,
        needsImprovement: scored.filter((a) => a.result === 'FAIL').length,
        approvedIncentives,
        pendingIncentives,
      },
    };
  }

  async needsAttention(companyId: string) {
    const now = new Date();
    const nowMs = now.getTime();
    const items: any[] = [];

    const activeCycle = await this.prisma.performanceCycle.findFirst({ where: { companyId, status: { in: ['OPEN', 'EMPLOYEE_SUBMISSION', 'MANAGER_REVIEW', 'QA_REVIEW', 'CALIBRATION', 'APPROVAL'] } }, orderBy: { periodStart: 'desc' } });
    const scope = activeCycle ? { cycleId: activeCycle.id } : {};
    const assessments = await this.prisma.employeePerformanceAssessment.findMany({ where: { companyId, ...scope, excludedReason: null }, include: { employee: { include: { department: true } }, cycle: true } });

    const notSubmitted = assessments.filter((a) => !a.employeeSubmittedAt);
    if (notSubmitted.length) items.push({ key: 'NOT_SUBMITTED', severity: 'HIGH', text: `${notSubmitted.length} employee(s) have not submitted their KPI assessment`, link: '/performance?tab=assessments&missing=1', count: notSubmitted.length });
    const mgrOverdue = assessments.filter((a) => a.employeeSubmittedAt && !a.managerSubmittedAt && new Date(a.cycle.managerDeadline).getTime() < nowMs);
    if (mgrOverdue.length) items.push({ key: 'MANAGER_OVERDUE', severity: 'HIGH', text: `${mgrOverdue.length} manager review(s) overdue`, link: '/performance?tab=assessments&managerOverdue=1', count: mgrOverdue.length });
    const qaPending = assessments.filter((a) => a.managerSubmittedAt && !a.qaSubmittedAt && a.status === 'PENDING_QA');
    if (qaPending.length) items.push({ key: 'QA_PENDING', severity: 'MEDIUM', text: `${qaPending.length} QA review(s) awaiting action`, link: '/performance?tab=qa', count: qaPending.length });
    const approvals = assessments.filter((a) => a.status === 'PENDING_APPROVAL');
    if (approvals.length) items.push({ key: 'APPROVALS', severity: 'MEDIUM', text: `${approvals.length} performance result(s) awaiting final approval`, link: '/performance?tab=assessments&status=PENDING_APPROVAL', count: approvals.length });

    const pendingIncentives = await this.prisma.performanceIncentive.count({ where: { companyId, status: 'PENDING_APPROVAL' } });
    if (pendingIncentives) items.push({ key: 'INCENTIVES', severity: 'MEDIUM', text: `${pendingIncentives} incentive proposal(s) require approval`, link: '/performance?tab=incentives&status=PENDING_APPROVAL', count: pendingIncentives });

    // departments with no KPI template for the active cycle
    const employees = await this.prisma.employee.findMany({ where: { companyId, active: true, departmentId: { not: null } }, include: { department: true } });
    const templates = await this.prisma.kpiTemplate.findMany({ where: { companyId, status: 'ACTIVE' } });
    const deptMap = new Map<string, number>();
    for (const e of employees) {
      const covered = templates.some((t) => t.departmentId === e.departmentId && (!t.jobRole || (e.position && t.jobRole.toLowerCase() === e.position.toLowerCase())));
      if (!covered) deptMap.set(e.departmentId!, (deptMap.get(e.departmentId!) || 0) + 1);
    }
    for (const [deptId, count] of deptMap) {
      const dept = employees.find((e) => e.departmentId === deptId)?.department;
      items.push({ key: 'MISSING_TEMPLATE', severity: 'HIGH', departmentId: deptId, text: `${dept?.name || 'Department'}: ${count} employee(s) with no active KPI template`, link: `/performance?tab=templates&departmentId=${deptId}`, count });
    }

    const criticalFailed = assessments.filter((a) => a.criticalNotMet && ['PENDING_QA', 'PENDING_APPROVAL'].includes(a.status));
    if (criticalFailed.length) items.push({ key: 'CRITICAL_KPI', severity: 'HIGH', text: `${criticalFailed.length} assessment(s) with a critical KPI not met — authorized review required`, link: '/performance?tab=assessments&critical=1', count: criticalFailed.length });

    return items;
  }

  // ---------- Reports ----------
  async completionReport(companyId: string, cycleId: string) {
    const rows = await this.prisma.employeePerformanceAssessment.findMany({ where: { companyId, cycleId, excludedReason: null }, include: { employee: { include: { department: true } }, cycle: true } });
    return rows.map((a) => ({
      employeeId: a.employeeId, employee: `${a.employee.firstName} ${a.employee.lastName}`, employeeNo: a.employee.employeeNo,
      department: a.employee.department?.name, manager: a.managerId, status: a.status,
      employeeSubmission: a.employeeSubmittedAt ? 'SUBMITTED' : 'NOT_SUBMITTED', submittedAt: a.employeeSubmittedAt,
      managerReview: a.managerSubmittedAt ? 'SUBMITTED' : 'NOT_SUBMITTED', qa: a.qaSubmittedAt ? 'SUBMITTED' : 'NOT_SUBMITTED',
      daysOverdue: !a.employeeSubmittedAt && new Date(a.cycle.employeeDeadline) < new Date() ? Math.max(0, Math.ceil((Date.now() - new Date(a.cycle.employeeDeadline).getTime()) / 86400000)) : 0,
    }));
  }

  async byDepartmentReport(companyId: string, cycleId?: string) {
    const rows = await this.prisma.employeePerformanceAssessment.findMany({
      where: { companyId, ...(cycleId ? { cycleId } : {}), excludedReason: null, status: { in: ['APPROVED', 'COMPLETED', 'LOCKED'] } },
      include: { employee: { include: { department: true } } },
    });
    const map = new Map<string, { department: string; employees: number; scores: number[]; passed: number; total: number }>();
    for (const r of rows) {
      const key = r.departmentId || 'none';
      if (!map.has(key)) map.set(key, { department: r.employee.department?.name || '—', employees: 0, scores: [], passed: 0, total: 0 });
      const e = map.get(key)!;
      e.scores.push(Number(r.totalScore || 0));
      e.total += 1;
      if (r.result === 'PASS') e.passed += 1;
    }
    for (const e of map.values()) e.employees = e.total;
    return [...map.values()].map((e) => ({ department: e.department, employees: e.employees, averageScore: e.scores.length ? round2(e.scores.reduce((s, v) => s + v, 0) / e.scores.length) : null, passRate: e.total ? round2((e.passed / e.total) * 100) : null, approved: e.total }));
  }

  async kpiResultsReport(companyId: string, cycleId?: string) {
    const assessments = await this.prisma.employeePerformanceAssessment.findMany({
      where: { companyId, ...(cycleId ? { cycleId } : {}), status: { in: ['APPROVED', 'COMPLETED', 'LOCKED'] }, excludedReason: null },
      select: { kpis: { select: { code: true, name: true, effectiveScore: true, achievement: true } } },
    });
    const map = new Map<string, { kpi: string; achievements: number[]; count: number; passed: number }>();
    for (const a of assessments) {
      for (const k of a.kpis) {
        if (k.effectiveScore == null) continue;
        if (!map.has(k.code)) map.set(k.code, { kpi: k.name, achievements: [], count: 0, passed: 0 });
        const e = map.get(k.code)!;
        e.achievements.push(Number(k.effectiveScore));
        e.count += 1;
        if (Number(k.effectiveScore) >= 100) e.passed += 1;
      }
    }
    return [...map.values()].map((e) => ({ kpi: e.kpi, employees: e.count, averageAchievement: e.achievements.length ? round2(e.achievements.reduce((s, v) => s + v, 0) / e.achievements.length) : null, atOrAboveTarget: e.count ? round2((e.passed / e.count) * 100) : null }));
  }

  async bandsReport(companyId: string, cycleId?: string) {
    const rows = await this.prisma.employeePerformanceAssessment.groupBy({
      by: ['band', 'result'], where: { companyId, ...(cycleId ? { cycleId } : {}), status: { in: ['APPROVED', 'COMPLETED', 'LOCKED'] }, excludedReason: null, band: { not: null } }, _count: true,
    });
    return rows.map((r) => ({ band: r.band, result: r.result, count: r._count }));
  }

  async incentiveReport(companyId: string, cycleId?: string) {
    const rows = await this.prisma.performanceIncentive.findMany({
      where: { companyId, ...(cycleId ? { assessment: { cycleId } } : {}) },
      include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } }, assessment: { include: { cycle: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      reference: r.reference, employee: `${r.employee.firstName} ${r.employee.lastName}`, employeeNo: r.employee.employeeNo,
      cycle: r.assessment?.cycle?.name, score: r.finalScore, band: r.band, plan: r.planName, amount: r.amount, currency: r.currency,
      status: r.status, approvedAt: r.approvedAt, paidAt: r.paidAt, payrollInputRef: r.payrollInputRef,
    }));
  }
}
