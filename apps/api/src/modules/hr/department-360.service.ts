import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { companyIdOf } from '../../core/context';

const round2 = (n: number) => Number((Number(n) || 0).toFixed(2));
const toNum = (v: any) => Number(v || 0);

/**
 * Department 360 — a department-centred aggregation over the authoritative HR,
 * Performance and KPI Template modules. Read/write through existing models only.
 */
@Injectable()
export class Department360Service {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async departmentOrThrow(companyId: string, id: string) {
    const dept = await this.prisma.department.findFirst({
      where: { id, branch: { companyId } },
      include: { branch: true },
    });
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  private activeCycleStatuses = ['OPEN', 'EMPLOYEE_SUBMISSION', 'MANAGER_REVIEW', 'QA_REVIEW', 'CALIBRATION', 'APPROVAL'];

  async overview(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const dept = await this.departmentOrThrow(companyId, id);
    const today = new Date();
    const [employees, onLeave, cycle, template] = await Promise.all([
      this.prisma.employee.findMany({ where: { companyId, departmentId: id }, select: { id: true, active: true, managerId: true } }),
      this.prisma.leaveRequest.findMany({ where: { companyId, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today }, employee: { departmentId: id } }, select: { employeeId: true } }),
      this.prisma.performanceCycle.findFirst({ where: { companyId, status: { in: this.activeCycleStatuses } }, orderBy: { periodStart: 'desc' } }),
      this.prisma.kpiTemplate.findFirst({ where: { companyId, departmentId: id, status: 'ACTIVE' }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { kpis: true } } } }),
    ]);
    const manager = employees.find((e) => e.managerId === e.id);
    return {
      department: { id: dept.id, name: dept.name, code: dept.code, branch: dept.branch?.name, branchId: dept.branchId, status: dept.branch?.active === false ? 'INACTIVE' : 'ACTIVE' },
      summary: {
        employees: employees.length,
        active: employees.filter((e) => e.active).length,
        onLeave: new Set(onLeave.map((l) => l.employeeId)).size,
        currentCycle: cycle?.name || null,
        currentCycleId: cycle?.id || null,
        activeTemplate: template ? { id: template.id, name: template.name, version: template.versions[0]?.version || 1, kpiCount: template.versions[0]?.kpis?.length || 0, passMark: toNum(template.versions[0]?.passMark ?? template.passMark), status: template.status } : null,
      },
    };
  }

  async employees(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const dept = await this.departmentOrThrow(companyId, id);
    const list = await this.prisma.employee.findMany({
      where: { companyId, departmentId: id },
      orderBy: [{ active: 'desc' }, { firstName: 'asc' }],
    });
    const managerIds = Array.from(new Set(list.map((e) => e.managerId).filter(Boolean))) as string[];
    const managers = managerIds.length ? await this.prisma.employee.findMany({ where: { id: { in: managerIds }, companyId }, select: { id: true, firstName: true, lastName: true, employeeNo: true } }) : [];
    const managerMap = new Map(managers.map((m) => [m.id, `${m.firstName} ${m.lastName}`.trim()]));
    const rows = list.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, firstName: e.firstName, lastName: e.lastName, preferredName: e.preferredName,
      position: e.position, employmentStatus: e.employmentStatus || e.status, contractType: e.contractType,
      workEmail: e.workEmail || e.email, hireDate: e.hireDate, active: e.active,
      manager: e.managerId ? managerMap.get(e.managerId) || null : null,
      branch: dept.branch?.name || null,
    }));
    return { department: { id: dept.id, name: dept.name, code: dept.code, branch: dept.branch?.name }, employees: rows };
  }

  async kpiTemplates(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const dept = await this.departmentOrThrow(companyId, id);
    const templates = await this.prisma.kpiTemplate.findMany({
      where: { companyId, departmentId: id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { kpis: true } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    const rows = templates.map((t) => {
      const v = t.versions[0];
      const weight = v?.kpis?.reduce((s, k) => s + toNum(k.weight), 0) || 0;
      return {
        id: t.id, name: t.name, departmentId: t.departmentId, jobRole: t.jobRole,
        version: v?.version || t.currentVersion, versionId: v?.id, kpiCount: v?.kpis?.length || 0,
        totalWeight: round2(weight), passMark: toNum(v?.passMark ?? t.passMark), maxAchievement: toNum(v?.maxAchievement ?? t.maxAchievement),
        effectiveFrom: v?.effectiveFrom || t.effectiveFrom, effectiveTo: v?.effectiveTo || t.effectiveTo,
        status: t.status, qaRequired: t.qaRequired, selfAssessment: t.selfAssessment,
      };
    });
    const active = rows.find((r) => r.status === 'ACTIVE') || null;
    return { department: { id: dept.id, name: dept.name, code: dept.code, branch: dept.branch?.name }, templates: rows, active };
  }

  async templateDetail(req: any, id: string, templateId: string) {
    const companyId = companyIdOf(req.user);
    const dept = await this.departmentOrThrow(companyId, id);
    const t = await this.prisma.kpiTemplate.findFirst({
      where: { id: templateId, companyId, departmentId: id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { kpis: { include: { category: true }, orderBy: { position: 'asc' } } } } },
    });
    if (!t) throw new NotFoundException('KPI template not found');
    const v = t.versions[0];
    return {
      id: t.id, name: t.name, departmentId: t.departmentId, departmentName: dept.name, jobRole: t.jobRole, status: t.status,
      version: v?.version || t.currentVersion, effectiveFrom: v?.effectiveFrom, effectiveTo: v?.effectiveTo,
      passMark: toNum(v?.passMark ?? t.passMark), maxAchievement: toNum(v?.maxAchievement ?? t.maxAchievement),
      qaRequired: t.qaRequired, selfAssessment: t.selfAssessment,
      kpis: (v?.kpis || []).map((k) => ({
        id: k.id, code: k.code, name: k.name, description: k.description, category: k.category?.name || k.categoryLabel,
        weight: toNum(k.weight), target: k.targetText || (k.targetValue != null ? toNum(k.targetValue) : null), unit: k.unit,
        measurementType: k.measurementType, dataSource: k.dataSource, dataSourceLabel: k.dataSourceLabel, scoringMethod: k.scoringMethod, critical: k.critical,
      })),
    };
  }

  async performance(req: any, id: string, cycleId?: string) {
    const companyId = companyIdOf(req.user);
    const dept = await this.departmentOrThrow(companyId, id);
    const cycles = await this.prisma.performanceCycle.findMany({ where: { companyId }, orderBy: { periodStart: 'desc' } });
    const cycle = cycleId ? cycles.find((c) => c.id === cycleId) || null : (cycles.find((c) => this.activeCycleStatuses.includes(c.status)) || cycles[0] || null);
    if (!cycle) return { department: { id: dept.id, name: dept.name, code: dept.code, branch: dept.branch?.name }, cycles, currentCycle: null, summary: { employees: 0, submitted: 0, missing: 0, averageScore: null, passed: 0, needsImprovement: 0 }, assessments: [] };
    // Department membership uses the assessment's department snapshot so historical cycles keep their original department.
    const assessments = await this.prisma.employeePerformanceAssessment.findMany({
      where: { companyId, cycleId: cycle.id, departmentId: id },
      include: { employee: { select: { id: true, firstName: true, lastName: true, preferredName: true, employeeNo: true, position: true } }, version: { include: { template: true } }, incentive: true, qaReviews: true, kpis: true },
      orderBy: { employee: { firstName: 'asc' } },
    });
    const withScore = assessments.filter((a) => a.totalScore != null);
    const passMark = toNum(assessments[0]?.version?.passMark ?? 70);
    const rows = assessments.map((a) => {
      const kpiCompletion = a.kpis.length ? Math.round((a.kpis.filter((k) => k.effectiveScore != null || k.employeeScore != null).length / a.kpis.length) * 100) : 0;
      const overdue = !a.employeeSubmittedAt && cycle.employeeDeadline && new Date(cycle.employeeDeadline) < new Date();
      const daysOverdue = overdue ? Math.ceil((Date.now() - new Date(cycle.employeeDeadline).getTime()) / 86400000) : 0;
      return {
        id: a.id, employeeId: a.employeeId, employee: a.employee, position: a.employee?.position,
        templateName: a.templateName, templateVersion: a.version?.version, status: a.status,
        employeeSubmitted: !!a.employeeSubmittedAt, managerSubmitted: !!a.managerSubmittedAt, qaSubmitted: !!a.qaSubmittedAt,
        overdue, daysOverdue, kpiCompletion,
        score: a.totalScore != null ? toNum(a.totalScore) : null, result: a.result, band: a.band,
      };
    });
    return {
      department: { id: dept.id, name: dept.name, code: dept.code, branch: dept.branch?.name },
      cycles: cycles.map((c) => ({ id: c.id, name: c.name, status: c.status, periodStart: c.periodStart, periodEnd: c.periodEnd, employeeDeadline: c.employeeDeadline })),
      currentCycle: { id: cycle.id, name: cycle.name, status: cycle.status, employeeDeadline: cycle.employeeDeadline },
      summary: {
        employees: assessments.length,
        submitted: assessments.filter((a) => a.employeeSubmittedAt).length,
        missing: assessments.filter((a) => !a.employeeSubmittedAt).length,
        averageScore: withScore.length ? round2(withScore.reduce((s, a) => s + toNum(a.totalScore), 0) / withScore.length) : null,
        passed: assessments.filter((a) => a.result === 'PASS').length,
        needsImprovement: assessments.filter((a) => a.totalScore != null && toNum(a.totalScore) < passMark).length,
      },
      assessments: rows,
    };
  }

  async assignEmployee(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const dept = await this.departmentOrThrow(companyId, id);
    if (!dto.employeeId) throw new BadRequestException('employeeId is required');
    const emp = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId }, include: { department: true } });
    if (!emp) throw new NotFoundException('Employee not found');
    if (emp.departmentId === id) throw new BadRequestException('Employee is already in this department');
    const prevName = emp.department?.name || null;
    await this.prisma.employee.update({ where: { id: emp.id }, data: { departmentId: id, ...(dto.position ? { position: dto.position } : {}), ...(dto.managerId !== undefined ? { managerId: dto.managerId } : {}) } });
    await this.prisma.employmentHistory.create({
      data: {
        companyId, employeeId: emp.id, effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
        changeType: 'DEPARTMENT_TRANSFER', field: 'departmentId', previousValue: prevName, newValue: dept.name,
        reason: dto.reason || 'Assigned via department drawer', changedById: req.user.sub,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'ASSIGN', 'Department', id, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: emp.id, from: prevName, to: dept.name } });
    return { ok: true };
  }

  // Employees not currently in this department (for the assign picker).
  async assignableEmployees(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    await this.departmentOrThrow(companyId, id);
    const list = await this.prisma.employee.findMany({ where: { companyId, active: true, OR: [{ departmentId: null }, { departmentId: { not: id } }] }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true, employeeNo: true, position: true, department: { select: { name: true } } } });
    return list.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), employeeNo: e.employeeNo, position: e.position, currentDepartment: e.department?.name || null }));
  }
}
