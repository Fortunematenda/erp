import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { CYCLE_STATUSES } from './performance.constants';

type AnyReq = { user: { sub: string; companyId?: string } };

@Injectable()
export class PerformanceCycleService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list(companyId: string) {
    return this.prisma.performanceCycle.findMany({
      where: { companyId },
      include: { _count: { select: { assessments: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const c = await this.prisma.performanceCycle.findFirst({
      where: { id, companyId },
      include: {
        _count: { select: { assessments: true } },
        assessments: { select: { id: true, status: true, employeeId: true, departmentId: true, totalScore: true, result: true, employeeSubmissionOverdue: true } },
      },
    });
    if (!c) throw new NotFoundException('Cycle not found');
    const deptIds = (c.departmentIds as string[]) || [];
    const departments = deptIds.length ? await this.prisma.department.findMany({ where: { id: { in: deptIds } }, include: { branch: true } }) : [];
    return { ...c, departments };
  }

  async create(req: AnyReq, dto: any) {
    const companyId = req.user.companyId!;
    const start = new Date(dto.periodStart), end = new Date(dto.periodEnd);
    if (end < start) throw new BadRequestException('Performance period end date must be after the start date');
    const opens = new Date(dto.submissionOpens);
    const empDeadline = new Date(dto.employeeDeadline);
    const mgrDeadline = new Date(dto.managerDeadline);
    if (mgrDeadline < empDeadline) throw new BadRequestException('Manager review deadline must be on/after the employee submission deadline');
    const cycle = await this.prisma.performanceCycle.create({
      data: {
        companyId, name: dto.name, cycleType: dto.cycleType || 'QUARTERLY', description: dto.description || null,
        periodStart: start, periodEnd: end, startDate: start, endDate: end,
        submissionOpens: opens, employeeDeadline: empDeadline, managerDeadline: mgrDeadline,
        qaDeadline: dto.qaDeadline ? new Date(dto.qaDeadline) : null, approvalDeadline: dto.approvalDeadline ? new Date(dto.approvalDeadline) : null,
        includeNewHires: dto.includeNewHires || 'NO', departmentIds: dto.departmentIds?.length ? dto.departmentIds : null,
        employeeIds: dto.employeeIds?.length ? dto.employeeIds : null, status: 'DRAFT', createdBy: req.user.sub,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'CYCLE_CREATED', 'PerformanceCycle', cycle.id, { name: dto.name });
    return this.get(companyId, cycle.id);
  }

  async update(req: AnyReq, id: string, dto: any) {
    const companyId = req.user.companyId!;
    const c = await this.prisma.performanceCycle.findFirst({ where: { id, companyId } });
    if (!c) throw new NotFoundException('Cycle not found');
    if (!['DRAFT', 'SCHEDULED'].includes(c.status)) throw new BadRequestException('Only DRAFT or SCHEDULED cycles can be edited');
    const data: any = {};
    if (dto.name != null) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.cycleType != null) data.cycleType = dto.cycleType;
    if (dto.periodStart) { data.periodStart = new Date(dto.periodStart); data.startDate = new Date(dto.periodStart); }
    if (dto.periodEnd) { data.periodEnd = new Date(dto.periodEnd); data.endDate = new Date(dto.periodEnd); }
    if (dto.submissionOpens) data.submissionOpens = new Date(dto.submissionOpens);
    if (dto.employeeDeadline) data.employeeDeadline = new Date(dto.employeeDeadline);
    if (dto.managerDeadline) data.managerDeadline = new Date(dto.managerDeadline);
    if (dto.qaDeadline !== undefined) data.qaDeadline = dto.qaDeadline ? new Date(dto.qaDeadline) : null;
    if (dto.approvalDeadline !== undefined) data.approvalDeadline = dto.approvalDeadline ? new Date(dto.approvalDeadline) : null;
    if (dto.includeNewHires != null) data.includeNewHires = dto.includeNewHires;
    if (dto.departmentIds !== undefined) data.departmentIds = dto.departmentIds?.length ? dto.departmentIds : null;
    if (dto.employeeIds !== undefined) data.employeeIds = dto.employeeIds?.length ? dto.employeeIds : null;
    await this.prisma.performanceCycle.update({ where: { id }, data });
    await this.audit.log(companyId, req.user.sub, 'CYCLE_UPDATED', 'PerformanceCycle', id, { fields: Object.keys(data) });
    return this.get(companyId, id);
  }

  async setStatus(req: AnyReq, id: string, status: string) {
    const companyId = req.user.companyId!;
    const c = await this.prisma.performanceCycle.findFirst({ where: { id, companyId } });
    if (!c) throw new NotFoundException('Cycle not found');
    if (!CYCLE_STATUSES.includes(status as any)) throw new BadRequestException('Invalid cycle status');
    const data: any = { status };
    if (status === 'LOCKED') { data.lockedAt = new Date(); await this.lockAssessments(companyId, id); }
    if (status === 'COMPLETED') data.completedAt = new Date();
    await this.prisma.performanceCycle.update({ where: { id }, data });
    await this.audit.log(companyId, req.user.sub, status === 'LOCKED' ? 'CYCLE_LOCKED' : 'CYCLE_STATUS', 'PerformanceCycle', id, { status });
    return this.get(companyId, id);
  }

  private async lockAssessments(companyId: string, cycleId: string) {
    await this.prisma.employeePerformanceAssessment.updateMany({ where: { companyId, cycleId, status: { in: ['APPROVED', 'COMPLETED'] } }, data: { status: 'LOCKED', lockedAt: new Date() } });
  }

  // ---------- Assignment resolution ----------

  /**
   * Precedence: role-specific template (same department + jobRole) →
   * department default (jobRole null). Only ACTIVE templates qualify.
   */
  async resolveTemplate(companyId: string, departmentId: string, jobRole: string | null) {
    if (jobRole) {
      const role = await this.prisma.kpiTemplate.findFirst({
        where: { companyId, departmentId, jobRole: { equals: jobRole, mode: 'insensitive' }, status: 'ACTIVE' },
        orderBy: { currentVersion: 'desc' },
      });
      if (role) {
        const v = await this.prisma.kpiTemplateVersion.findFirst({ where: { templateId: role.id, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
        if (v) return { template: role, version: v };
      }
    }
    const dept = await this.prisma.kpiTemplate.findFirst({
      where: { companyId, departmentId, jobRole: null, status: 'ACTIVE' },
      orderBy: { currentVersion: 'desc' },
    });
    if (dept) {
      const v = await this.prisma.kpiTemplateVersion.findFirst({ where: { templateId: dept.id, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
      if (v) return { template: dept, version: v };
    }
    return null;
  }

  /** Eligible employees for a cycle: active, matching department scope, hired before/at period end. */
  async eligibleEmployees(cycle: any) {
    const deptIds = (cycle.departmentIds as string[]) || [];
    const explicit = (cycle.employeeIds as string[]) || [];
    const where: any = { companyId: cycle.companyId, active: true, employmentStatus: { not: 'TERMINATED' } };
    if (deptIds.length) where.departmentId = { in: deptIds };
    if (explicit.length) where.id = { in: explicit };
    else if (cycle.includeNewHires === 'NO') where.hireDate = { lte: new Date(cycle.periodStart) };
    return this.prisma.employee.findMany({ where, include: { department: true, user: { select: { id: true } } }, orderBy: [{ departmentId: 'asc' }, { firstName: 'asc' }] });
  }

  /** OPEN the cycle: resolve eligible employees, resolve templates, snapshot KPIs. */
  async open(req: AnyReq, id: string) {
    const companyId = req.user.companyId!;
    const cycle = await this.prisma.performanceCycle.findFirst({ where: { id, companyId } });
    if (!cycle) throw new NotFoundException('Cycle not found');
    if (!['DRAFT', 'SCHEDULED'].includes(cycle.status)) throw new BadRequestException('Cycle already opened');

    const employees = await this.eligibleEmployees(cycle);
    if (!employees.length) throw new BadRequestException('No eligible employees match this cycle scope');

    // resolve template per (department, jobRole) once
    const resolutionCache = new Map<string, { template: any; version: any } | null>();
    const missing: { employeeId: string; employeeNo: string; name: string; department: string }[] = [];
    let created = 0;

    for (const emp of employees) {
      if (!emp.departmentId) { missing.push(this.missingEntry(emp, 'No department')); continue; }
      const key = `${emp.departmentId}::${emp.position || ''}`;
      if (!resolutionCache.has(key)) resolutionCache.set(key, await this.resolveTemplate(companyId, emp.departmentId, emp.position || null));
      const resolved = resolutionCache.get(key);
      if (!resolved) { missing.push(this.missingEntry(emp, 'No active KPI template')); continue; }

      // New hires proration
      let prorationFactor: number | null = null;
      if (cycle.includeNewHires === 'PRORATED' && new Date(emp.hireDate) > new Date(cycle.periodStart)) {
        const totalDays = Math.max(1, Math.ceil((new Date(cycle.periodEnd).getTime() - new Date(cycle.periodStart).getTime()) / 86400000));
        const workedDays = Math.max(0, Math.ceil((new Date(cycle.periodEnd).getTime() - new Date(emp.hireDate).getTime()) / 86400000));
        prorationFactor = Math.min(1, workedDays / totalDays);
      }

      const existing = await this.prisma.employeePerformanceAssessment.findUnique({ where: { cycleId_employeeId: { cycleId: cycle.id, employeeId: emp.id } } });
      if (existing) {
        // Never silently replace an existing snapshot (department changes mid-cycle, reopens, etc.)
        continue;
      }

      const kpiDefs = await this.prisma.kpiDefinition.findMany({ where: { versionId: resolved.version.id }, orderBy: { position: 'asc' } });
      await this.prisma.employeePerformanceAssessment.create({
        data: {
          companyId, cycleId: cycle.id, employeeId: emp.id, departmentId: emp.departmentId, managerId: emp.managerId || null,
          versionId: resolved.version.id, templateName: resolved.template.name, status: 'PENDING_EMPLOYEE',
          prorationFactor, kpis: {
            create: kpiDefs.map((k) => ({
              companyId, kpiDefinitionId: k.id, code: k.code, name: k.name, description: k.description,
              categoryLabel: k.categoryLabel || k.categoryId || null, weight: k.weight, measurementType: k.measurementType,
              direction: k.direction, scoringMethod: k.scoringMethod, targetType: k.targetType,
              targetValue: k.targetValue, targetText: k.targetText, unit: k.unit, dataSource: k.dataSource,
              dataSourceLabel: k.dataSourceLabel, critical: k.critical, position: k.position, systemDerived: !!k.dataSource,
            })),
          },
        },
      });
      created += 1;
    }

    const status = 'OPEN';
    await this.prisma.performanceCycle.update({ where: { id: cycle.id }, data: { status, openedAt: new Date() } });
    await this.audit.log(companyId, req.user.sub, 'CYCLE_OPENED', 'PerformanceCycle', cycle.id, { employeesAssigned: created, missingTemplates: missing.length });
    if (missing.length) {
      await this.audit.log(companyId, req.user.sub, 'KPI_TEMPLATE_MISSING', 'PerformanceCycle', cycle.id, { missing });
      // notify HR admins
      await this.prisma.performanceNotification.createMany({
        data: [{ companyId, type: 'KPI_TEMPLATE_MISSING', title: 'KPI Template Missing', body: `${missing.length} employee(s) could not be assigned for cycle "${cycle.name}" — no active KPI template for their department/role.`, link: `/performance?tab=cycles&id=${cycle.id}` }],
      });
    }
    return { created, missing, cycle: await this.get(companyId, cycle.id) };
  }

  private missingEntry(emp: any, reason: string) {
    return { employeeId: emp.id, employeeNo: emp.employeeNo, name: `${emp.firstName} ${emp.lastName}`, department: emp.department?.name || reason };
  }

  /**
   * Department changed mid-cycle: HR explicitly chooses Keep Existing KPIs
   * (audit only) or Reassign KPIs (new snapshot from the new department template).
   */
  async handleDepartmentMove(req: AnyReq, assessmentId: string, decision: 'KEEP_EXISTING' | 'REASSIGN', reason?: string) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id: assessmentId, companyId }, include: { employee: { include: { department: true } } } });
    if (!a) throw new NotFoundException('Assessment not found');
    if (['LOCKED'].includes(a.status)) throw new BadRequestException('Assessment is locked');
    if (decision === 'KEEP_EXISTING') {
      await this.audit.log(companyId, req.user.sub, 'ASSESSMENT_KEEP_EXISTING_KPIs', 'EmployeePerformanceAssessment', a.id, { department: a.employee.department?.name, reason });
      return this.assessmentDetail(companyId, a.id);
    }
    if (!a.employee.departmentId) throw new BadRequestException('Employee has no department to resolve a template from');
    const resolved = await this.resolveTemplate(companyId, a.employee.departmentId, a.employee.position || null);
    if (!resolved) throw new BadRequestException('No active KPI template for the employee\'s new department/role');
    await this.prisma.employeePerformanceKpi.deleteMany({ where: { assessmentId: a.id } });
    const kpiDefs = await this.prisma.kpiDefinition.findMany({ where: { versionId: resolved.version.id }, orderBy: { position: 'asc' } });
    await this.prisma.employeePerformanceAssessment.update({
      where: { id: a.id },
      data: {
        departmentId: a.employee.departmentId, managerId: a.employee.managerId || null, versionId: resolved.version.id,
        templateName: resolved.template.name, status: 'PENDING_EMPLOYEE', employeeSubmittedAt: null, managerSubmittedAt: null, qaSubmittedAt: null,
        totalScore: null, result: null, band: null,
        kpis: { create: kpiDefs.map((k) => ({ companyId, kpiDefinitionId: k.id, code: k.code, name: k.name, description: k.description, categoryLabel: k.categoryLabel, weight: k.weight, measurementType: k.measurementType, direction: k.direction, scoringMethod: k.scoringMethod, targetType: k.targetType, targetValue: k.targetValue, targetText: k.targetText, unit: k.unit, dataSource: k.dataSource, dataSourceLabel: k.dataSourceLabel, critical: k.critical, position: k.position, systemDerived: !!k.dataSource })) },
      },
    });
    await this.audit.log(companyId, req.user.sub, 'ASSESSMENT_REASSIGNED_KPIs', 'EmployeePerformanceAssessment', a.id, { newTemplate: resolved.template.name, newVersion: resolved.version.version, reason });
    return this.assessmentDetail(companyId, a.id);
  }

  /** Explicitly regenerate a DRAFT assessment snapshot (HR action). */
  async regenerate(req: AnyReq, assessmentId: string) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id: assessmentId, companyId } });
    if (!a) throw new NotFoundException('Assessment not found');
    if (a.status !== 'PENDING_EMPLOYEE') throw new BadRequestException('Only assessments not yet submitted can be regenerated');
    const emp = await this.prisma.employee.findFirst({ where: { id: a.employeeId } });
    if (!emp?.departmentId) throw new BadRequestException('Employee has no department');
    const resolved = await this.resolveTemplate(companyId, emp.departmentId, emp.position || null);
    if (!resolved) throw new BadRequestException('No active KPI template for this department/role');
    await this.prisma.employeePerformanceKpi.deleteMany({ where: { assessmentId: a.id } });
    const kpiDefs = await this.prisma.kpiDefinition.findMany({ where: { versionId: resolved.version.id }, orderBy: { position: 'asc' } });
    await this.prisma.employeePerformanceAssessment.update({
      where: { id: a.id },
      data: {
        versionId: resolved.version.id, templateName: resolved.template.name, departmentId: emp.departmentId, managerId: emp.managerId || null,
        kpis: { create: kpiDefs.map((k) => ({ companyId, kpiDefinitionId: k.id, code: k.code, name: k.name, description: k.description, categoryLabel: k.categoryLabel, weight: k.weight, measurementType: k.measurementType, direction: k.direction, scoringMethod: k.scoringMethod, targetType: k.targetType, targetValue: k.targetValue, targetText: k.targetText, unit: k.unit, dataSource: k.dataSource, dataSourceLabel: k.dataSourceLabel, critical: k.critical, position: k.position, systemDerived: !!k.dataSource })) },
      },
    });
    await this.audit.log(companyId, req.user.sub, 'ASSESSMENT_REGENERATED', 'EmployeePerformanceAssessment', a.id, { template: resolved.template.name, version: resolved.version.version });
    return this.assessmentDetail(companyId, a.id);
  }

  async assessmentDetail(companyId: string, id: string) {
    return this.prisma.employeePerformanceAssessment.findFirst({
      where: { id, companyId },
      include: {
        employee: { include: { department: true, user: { select: { id: true } } } },
        cycle: true,
        version: { include: { template: true } },
        kpis: { orderBy: { position: 'asc' } },
        qaReviews: { include: {} },
        incentive: true,
      },
    });
  }

  /** Terminated mid-cycle: complete or exclude with reason (never silent delete). */
  async handleEmploymentEnd(req: AnyReq, assessmentId: string, decision: 'COMPLETE' | 'EXCLUDE', reason: string) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id: assessmentId, companyId } });
    if (!a) throw new NotFoundException('Assessment not found');
    if (decision === 'EXCLUDE') {
      await this.prisma.employeePerformanceAssessment.update({ where: { id: a.id }, data: { excludedReason: reason || 'Excluded from cycle by HR', status: 'LOCKED', lockedAt: new Date() } });
    } else {
      await this.prisma.employeePerformanceAssessment.update({ where: { id: a.id }, data: { employmentEndedDuring: true, status: a.status === 'PENDING_EMPLOYEE' ? 'PENDING_MANAGER' : a.status } });
    }
    await this.audit.log(companyId, req.user.sub, decision === 'EXCLUDE' ? 'ASSESSMENT_EXCLUDED' : 'ASSESSMENT_COMPLETED_TERMINATED', 'EmployeePerformanceAssessment', a.id, { reason });
    return this.assessmentDetail(companyId, a.id);
  }
}
