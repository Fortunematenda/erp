import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const ACTIVE_CYCLE_STATUSES = ['OPEN', 'EMPLOYEE_SUBMISSION', 'MANAGER_REVIEW', 'QA_REVIEW', 'CALIBRATION', 'APPROVAL'];

/**
 * Shared performance-completion logic. Dashboard counters and the filtered
 * Assessments list both call these methods so counts always reconcile.
 */
@Injectable()
export class PerformanceCompletionService {
  constructor(private prisma: PrismaService) {}

  async activeCycle(companyId: string, cycleId?: string) {
    if (cycleId) return this.prisma.performanceCycle.findFirst({ where: { id: cycleId, companyId } });
    return this.prisma.performanceCycle.findFirst({ where: { companyId, status: { in: ACTIVE_CYCLE_STATUSES } }, orderBy: { periodStart: 'desc' } });
  }

  private async eligibleEmployees(companyId: string, departmentId?: string) {
    return this.prisma.employee.findMany({
      where: { companyId, active: true, departmentId: { not: null }, ...(departmentId ? { departmentId } : {}) },
      include: { department: true },
      orderBy: { firstName: 'asc' },
    });
  }

  async resolveTemplate(companyId: string, departmentId: string, jobRole?: string | null) {
    if (jobRole) {
      const role = await this.prisma.kpiTemplate.findFirst({ where: { companyId, departmentId, jobRole: { equals: jobRole, mode: 'insensitive' }, status: 'ACTIVE' } });
      if (role) return role;
    }
    return this.prisma.kpiTemplate.findFirst({ where: { companyId, departmentId, jobRole: null, status: 'ACTIVE' } });
  }

  /** Eligible employees with no assessment row, or an assessment that has not been submitted. */
  async getMissingSubmissions(companyId: string, cycleId?: string, departmentId?: string) {
    const cycle = await this.activeCycle(companyId, cycleId);
    if (!cycle) return [];
    const employees = await this.eligibleEmployees(companyId, departmentId);
    const assessments = await this.prisma.employeePerformanceAssessment.findMany({
      where: { companyId, cycleId: cycle.id, excludedReason: null, employeeId: { in: employees.map((e) => e.id) } },
    });
    const byEmp = new Map(assessments.map((a) => [a.employeeId, a]));
    const now = new Date();
    const rows: any[] = [];
    for (const e of employees) {
      const a = byEmp.get(e.id);
      if (a && a.employeeSubmittedAt) continue; // already submitted — not missing
      rows.push({
        id: a?.id || null, assessmentId: a?.id || null, missingAssessment: !a,
        employeeId: e.id, departmentId: e.departmentId,
        employee: { id: e.id, firstName: e.firstName, lastName: e.lastName, preferredName: e.preferredName, employeeNo: e.employeeNo, position: e.position, department: e.department },
        cycle: { id: cycle.id, name: cycle.name, employeeDeadline: cycle.employeeDeadline, managerDeadline: cycle.managerDeadline, qaDeadline: cycle.qaDeadline },
        templateName: a?.templateName || null, status: a?.status || 'NOT_STARTED',
        employeeSubmittedAt: null, managerSubmittedAt: null, qaSubmittedAt: null, totalScore: null, result: null, band: null,
        employeeSubmissionOverdue: !!cycle.employeeDeadline && new Date(cycle.employeeDeadline) < now,
        issue: 'MISSING_SUBMISSION',
      });
    }
    return rows;
  }

  /** Eligible employees for whom no active KPI template can be resolved (role-specific then department). */
  async getMissingTemplate(companyId: string, cycleId?: string, departmentId?: string) {
    const cycle = await this.activeCycle(companyId, cycleId);
    const employees = await this.eligibleEmployees(companyId, departmentId);
    const templates = await this.prisma.kpiTemplate.findMany({ where: { companyId, status: 'ACTIVE' } });
    const rows: any[] = [];
    for (const e of employees) {
      const covered = templates.some((t) => t.departmentId === e.departmentId && (!t.jobRole || (e.position && t.jobRole.toLowerCase() === e.position.toLowerCase())));
      if (covered) continue;
      rows.push({
        id: null, assessmentId: null, missingAssessment: true, missingTemplate: true,
        employeeId: e.id, departmentId: e.departmentId,
        employee: { id: e.id, firstName: e.firstName, lastName: e.lastName, preferredName: e.preferredName, employeeNo: e.employeeNo, position: e.position, department: e.department },
        cycle: cycle ? { id: cycle.id, name: cycle.name, employeeDeadline: cycle.employeeDeadline, managerDeadline: cycle.managerDeadline, qaDeadline: cycle.qaDeadline } : null,
        templateName: null, status: 'NO_TEMPLATE',
        employeeSubmittedAt: null, managerSubmittedAt: null, qaSubmittedAt: null, totalScore: null, result: null, band: null,
        employeeSubmissionOverdue: false, issue: 'NO_ACTIVE_TEMPLATE',
      });
    }
    return rows;
  }

  /** Counts used by both the dashboard and the filtered list. */
  async counts(companyId: string, departmentId?: string) {
    const cycle = await this.activeCycle(companyId);
    if (!cycle) return { employeesDue: 0, submitted: 0, missing: 0, missingTemplate: 0, cycleId: null };
    const employees = await this.eligibleEmployees(companyId, departmentId);
    const assessments = await this.prisma.employeePerformanceAssessment.findMany({ where: { companyId, cycleId: cycle.id, excludedReason: null, employeeId: { in: employees.map((e) => e.id) } } });
    const submitted = assessments.filter((a) => a.employeeSubmittedAt).length;
    const missing = await this.getMissingSubmissions(companyId, cycle.id, departmentId);
    const missingTemplate = await this.getMissingTemplate(companyId, cycle.id, departmentId);
    return { employeesDue: submitted + missing.length, submitted, missing: missing.length, missingTemplate: missingTemplate.length, cycleId: cycle.id };
  }
}
