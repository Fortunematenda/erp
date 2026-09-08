import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { PermissionService } from '../auth/permission.service';
import { PerformanceCalculationService } from './performance-calculation.service';
import { SystemKpiSourceService } from './system-kpi-source.service';
import { KpiTemplateService } from './kpi-template.service';
import { round2 } from './performance.constants';

type AnyReq = any;

@Injectable()
export class PerformanceAssessmentService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private calc: PerformanceCalculationService,
    private systemSource: SystemKpiSourceService,
    private templates: KpiTemplateService,
    private permissions: PermissionService,
  ) {}

  private async userPermissions(req: AnyReq): Promise<string[]> {
    if (req.user?.isPlatformAdmin) return ['*'];
    try { return await this.permissions.getPermissions(req.user); } catch { return []; }
  }

  private has(perms: string[], ...codes: string[]): boolean {
    if (perms.includes('*')) return true;
    return codes.some((c) => perms.includes(c));
  }

  /** Row-level visibility per RBAC/privacy rules. */
  async assertCanView(req: AnyReq, assessment: any) {
    const perms = await this.userPermissions(req);
    // HR/admin scopes see all assessments in the company.
    if (this.has(perms, 'performance.qa.view', 'performance.templates.manage', 'performance.cycles.manage', 'performance.reports.view', 'hr.performance.manage')) return;
    if (assessment.employeeId) {
      const own = await this.prisma.employee.findFirst({ where: { id: assessment.employeeId, user: { id: req.user.sub } } });
      if (own) return;
    }
    if (this.has(perms, 'performance.team.view') && assessment.managerId) {
      const mgr = await this.prisma.employee.findFirst({ where: { id: assessment.managerId, user: { id: req.user.sub } } });
      if (mgr) return;
    }
    if (this.has(perms, 'performance.qa.review')) {
      const assigned = await this.prisma.performanceQaReview.findFirst({ where: { assessmentId: assessment.id, reviewerId: req.user.sub } });
      if (assigned) return;
    }
    throw new ForbiddenException('You do not have access to this performance assessment');
  }

  async list(companyId: string, filters: any) {
    const where: any = { companyId };
    if (filters.cycleId) where.cycleId = filters.cycleId;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.status) where.status = { in: String(filters.status).split(',') };
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.managerId) where.managerId = filters.managerId;
    if (filters.missingSubmission === 'true') where.employeeSubmittedAt = null;
    if (filters.result) where.result = filters.result;
    const rows = await this.prisma.employeePerformanceAssessment.findMany({
      where,
      include: {
        employee: { include: { department: true } },
        cycle: { select: { id: true, name: true, employeeDeadline: true, managerDeadline: true, qaDeadline: true, status: true } },
        version: { select: { version: true, template: { select: { name: true, passMark: true, selfAssessment: true } } } },
        kpis: { select: { id: true, effectiveScore: true, achievement: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    // overdue flags (operational, computed live)
    const now = new Date();
    return rows.map((a: any) => {
      const empOverdue = !a.employeeSubmittedAt && a.cycle.employeeDeadline && now > new Date(a.cycle.employeeDeadline) && !['LOCKED', 'COMPLETED'].includes(a.status) && !a.excludedReason;
      const mgrOverdue = !!a.employeeSubmittedAt && !a.managerSubmittedAt && a.cycle.managerDeadline && now > new Date(a.cycle.managerDeadline);
      const qaOverdue = !!a.managerSubmittedAt && !a.qaSubmittedAt && a.cycle.qaDeadline && now > new Date(a.cycle.qaDeadline);
      return { ...a, employeeSubmissionOverdue: empOverdue, managerReviewOverdue: mgrOverdue, qaReviewOverdue: qaOverdue };
    });
  }

  async detail(req: AnyReq, id: string) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({
      where: { id, companyId },
      include: {
        employee: { include: { department: true, user: { select: { id: true, email: true } } } },
        cycle: true,
        version: { include: { template: true } },
        kpis: { orderBy: { position: 'asc' } },
        qaReviews: { orderBy: { createdAt: 'asc' } },
        incentive: true,
      },
    });
    if (!a) throw new NotFoundException('Assessment not found');
    await this.assertCanView(req, a);
    return a;
  }

  /** Refresh system-derived actuals for an assessment's KPIs. */
  async refreshSystemKpis(companyId: string, assessmentId: string) {
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id: assessmentId, companyId }, include: { employee: true, cycle: true, kpis: true } });
    if (!a) throw new NotFoundException('Assessment not found');
    for (const kpi of a.kpis.filter((k) => k.dataSource)) {
      const res = await this.systemSource.resolve(companyId, kpi.dataSource!, a.employee, new Date(a.cycle.periodStart), new Date(a.cycle.periodEnd));
      if (res && res.value != null) {
        await this.prisma.employeePerformanceKpi.update({ where: { id: kpi.id }, data: { actualValue: res.value, systemDerived: true } });
      }
    }
    await this.recalculate(companyId, assessmentId);
  }

  /** Recompute achievements, weighted scores, completion, overall, pass/fail, band. */
  async recalculate(companyId: string, assessmentId: string) {
    const a = await this.prisma.employeePerformanceAssessment.findFirst({
      where: { id: assessmentId, companyId },
      include: { version: { include: { template: true } }, kpis: { orderBy: { position: 'asc' } } },
    });
    if (!a) throw new NotFoundException('Assessment not found');

    const bands = await this.templates.getBands(companyId, a.version.templateId);
    const cap = Number(a.version.maxAchievement) || 120;
    let weightedTotal = 0;
    let completionCount = 0;

    for (const kpi of a.kpis) {
      const snapshot = {
        weight: Number(kpi.weight), measurementType: kpi.measurementType, direction: kpi.direction, scoringMethod: kpi.scoringMethod,
        targetValue: kpi.targetValue == null ? null : Number(kpi.targetValue), targetText: kpi.targetText, minScore: null,
        dataSource: kpi.dataSource,
      };
      // Effective actual: QA > manager > employee/system
      const actual = kpi.qaActual ?? kpi.managerActual ?? kpi.actualValue;
      const entered = kpi.qaScore ?? kpi.managerScore ?? kpi.employeeScore; // manual entry override (percent)
      const { achievement, capped } = this.calc.calculateAchievement(snapshot, actual == null ? null : Number(actual), entered == null ? null : Number(entered), cap);
      const eff = achievement != null ? achievement : (entered != null ? Math.min(cap, Number(entered)) : null);
      const weighted = this.calc.calculateWeightedScore(eff, Number(kpi.weight));
      if (eff != null) completionCount += 1;
      await this.prisma.employeePerformanceKpi.update({
        where: { id: kpi.id },
        data: { achievement: eff, capped, weightedScore: weighted, effectiveScore: eff },
      });
      if (weighted != null) weightedTotal += weighted;
    }

    const overall = round2(weightedTotal);
    const completion = a.kpis.length ? round2((completionCount / a.kpis.length) * 100) : 0;
    const result = this.calc.resolvePassFail(overall, Number(a.version.passMark));
    const band = this.calc.resolvePerformanceBand(overall, bands as any);
    await this.prisma.employeePerformanceAssessment.update({
      where: { id: a.id },
      data: { totalScore: overall, result, band, criticalNotMet: a.kpis.some((k) => k.critical && k.effectiveScore != null && Number(k.effectiveScore) < Number(a.version.criticalMin ?? 80)) },
    });
    return { overall, completion, result, band };
  }

  private async assertNotLocked(a: any) {
    if (a.status === 'LOCKED') throw new BadRequestException('This assessment is locked. Use the controlled correction flow to reopen it.');
  }

  // ---------- Employee self-assessment ----------
  async employeeSubmit(req: AnyReq, id: string, dto: any) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({
      where: { id, companyId },
      include: { employee: { include: { department: true, user: { select: { id: true } } } }, cycle: true, version: { include: { template: true } }, kpis: true },
    });
    if (!a) throw new NotFoundException('Assessment not found');
    await this.assertNotLocked(a);
    const isSelf = !!a.employee.user && a.employee.user.id === req.user.sub;
    if (!isSelf) throw new ForbiddenException('Only the assessed employee can submit their self assessment');
    if (a.employeeSubmittedAt) throw new BadRequestException('Self assessment already submitted');

    for (const line of dto.kpis || []) {
      const kpi = a.kpis.find((k: any) => k.id === line.kpiId);
      if (!kpi) continue;
      const data: any = { employeeComment: line.comment ?? undefined, employeeEvidence: line.evidence ?? undefined, employeeSubmittedAt: new Date() };
      if (line.actual !== undefined && !kpi.systemDerived) {
        data.actualValue = line.actual === '' || line.actual == null ? null : line.actual;
        data.actualText = line.actualText ?? null;
      }
      if (kpi.scoringMethod === 'MANUAL' && line.score != null) data.employeeScore = line.score;
      await this.prisma.employeePerformanceKpi.update({ where: { id: kpi.id }, data });
    }
    await this.refreshSystemKpis(companyId, id);

    // Completeness validation before submission
    const kpis = await this.prisma.employeePerformanceKpi.findMany({ where: { assessmentId: id } });
    const missing: string[] = [];
    for (const k of kpis) {
      const filled = k.actualValue != null || k.actualText || k.employeeScore != null || (k.systemDerived && k.actualValue != null);
      if (!filled) missing.push(`${k.name}: actual result`);
      if (k.employeeCommentRequired && !k.employeeComment) missing.push(`${k.name}: comment`);
      if (k.evidenceRequired && !k.employeeEvidence) missing.push(`${k.name}: evidence`);
    }
    if (missing.length) throw new BadRequestException(`Assessment incomplete — ${Math.round(((kpis.length - missing.length) / kpis.length) * 100)}% complete. Missing: ${missing.slice(0, 6).join('; ')}${missing.length > 6 ? '…' : ''}`);

    await this.prisma.employeePerformanceAssessment.update({ where: { id }, data: { employeeSubmittedAt: new Date(), status: a.version.selfAssessment === false ? 'PENDING_MANAGER' : 'PENDING_MANAGER' } });
    await this.audit.log(companyId, req.user.sub, 'EMPLOYEE_SUBMITTED', 'EmployeePerformanceAssessment', id, { employeeId: a.employeeId });
    await this.notifyManager(companyId, a);
    return this.detail(req, id);
  }

  private async notifyManager(companyId: string, a: any) {
    if (!a.managerId) return;
    const mgr = await this.prisma.employee.findFirst({ where: { id: a.managerId }, include: { user: true } });
    if (!mgr?.user) return;
    await this.prisma.performanceNotification.create({ data: { companyId, userId: mgr.user.id, employeeId: a.employeeId, type: 'MANAGER_REVIEW_DUE', title: 'Performance review awaiting your assessment', body: `${a.employee.firstName} ${a.employee.lastName} submitted their KPI assessment for "${a.cycle.name}".`, link: `/performance?assessment=${a.id}` } });
  }

  // ---------- Manager review ----------
  async managerReview(req: AnyReq, id: string, dto: any) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({
      where: { id, companyId },
      include: { employee: { include: { user: true } }, cycle: true, kpis: true },
    });
    if (!a) throw new NotFoundException('Assessment not found');
    await this.assertNotLocked(a);
    // The direct manager records the review; HR admins with manager-review permission may also act.
    const perms = await this.userPermissions(req);
    const isManager = !!(a.managerId && (await this.prisma.employee.findFirst({ where: { id: a.managerId, user: { id: req.user.sub } } })));
    if (!isManager && !this.has(perms, 'hr.performance.manage')) throw new ForbiddenException('Only the direct manager can record this review');
    if (!a.employeeSubmittedAt) throw new BadRequestException('Employee has not submitted their assessment yet');

    for (const line of dto.kpis || []) {
      const kpi = a.kpis.find((k: any) => k.id === line.kpiId);
      if (!kpi) continue;
      const data: any = { managerComment: line.comment ?? undefined, managerEvidence: line.evidence ?? undefined, managerSubmittedAt: new Date() };
      if (line.actual !== undefined && line.actual !== '') data.managerActual = line.actual;
      if (line.score !== undefined && line.score !== '') data.managerScore = line.score;
      await this.prisma.employeePerformanceKpi.update({ where: { id: kpi.id }, data });
    }
    await this.recalculate(companyId, id);
    await this.prisma.employeePerformanceAssessment.update({ where: { id }, data: { managerSubmittedAt: new Date(), status: 'PENDING_QA' } });
    await this.audit.log(companyId, req.user.sub, 'MANAGER_SUBMITTED', 'EmployeePerformanceAssessment', id, {});
    // QA assignment: if the template requires the QA reviewer to differ from the
    // manager, leave assignment to HR (notification only). Otherwise the manager may QA.
    const tplVersion = await this.prisma.kpiTemplateVersion.findUnique({ where: { id: a.versionId }, include: { template: true } });
    const qaRequired = tplVersion?.template?.qaRequired !== false;
    const managerQaDistinct = tplVersion?.template?.managerQaDistinct !== false;
    if (qaRequired && !managerQaDistinct) {
      await this.prisma.performanceQaReview.create({ data: { companyId, assessmentId: id, reviewerId: req.user.sub, status: 'IN_PROGRESS' } });
    }
    // notify QA-capable users
    await this.prisma.performanceNotification.createMany({ data: { companyId, type: 'QA_REVIEW_DUE', title: 'QA review required', body: `Manager review completed for ${a.employee.firstName} ${a.employee.lastName} (${a.cycle.name}).`, link: `/performance?assessment=${id}` } as any });
    return this.detail(req, id);
  }

  // ---------- QA review ----------
  async qaStart(req: AnyReq, id: string) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId }, include: { employee: true } });
    if (!a) throw new NotFoundException('Assessment not found');
    await this.assertNotLocked(a);
    const existing = await this.prisma.performanceQaReview.findFirst({ where: { assessmentId: id, reviewerId: req.user.sub, status: 'IN_PROGRESS' } });
    if (!existing) await this.prisma.performanceQaReview.create({ data: { companyId, assessmentId: id, reviewerId: req.user.sub, status: 'IN_PROGRESS' } });
    await this.audit.log(companyId, req.user.sub, 'QA_STARTED', 'EmployeePerformanceAssessment', id, {});
    return this.detail(req, id);
  }

  /** QA adjustment — requires reason, audited with before/after. */
  async qaAdjust(req: AnyReq, id: string, dto: { kpiId: string; score?: number; actual?: number; comment?: string; reason: string }) {
    const companyId = req.user.companyId!;
    if (!dto.reason || !dto.reason.trim()) throw new BadRequestException('A reason is mandatory when adjusting a KPI score');
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId }, include: { kpis: true } });
    if (!a) throw new NotFoundException('Assessment not found');
    await this.assertNotLocked(a);
    const kpi = a.kpis.find((k: any) => k.id === dto.kpiId);
    if (!kpi) throw new BadRequestException('KPI not found on this assessment');
    // ensure a QA review record exists for this reviewer
    let review = await this.prisma.performanceQaReview.findFirst({ where: { assessmentId: id, reviewerId: req.user.sub, status: 'IN_PROGRESS' } });
    if (!review) review = await this.prisma.performanceQaReview.create({ data: { companyId, assessmentId: id, reviewerId: req.user.sub, status: 'IN_PROGRESS' } });

    const before = { effectiveScore: kpi.effectiveScore, managerScore: kpi.managerScore, actual: kpi.qaActual ?? kpi.managerActual ?? kpi.actualValue };
    const data: any = { qaComment: dto.comment ?? kpi.qaComment, qaSubmittedAt: new Date() };
    if (dto.score != null) data.qaScore = dto.score;
    if (dto.actual != null) data.qaActual = dto.actual;
    await this.prisma.employeePerformanceKpi.update({ where: { id: kpi.id }, data });
    await this.recalculate(companyId, id);
    const kpiAfter = await this.prisma.employeePerformanceKpi.findUnique({ where: { id: kpi.id } });

    // audit entry with before/after/reason/user
    await this.audit.log(companyId, req.user.sub, 'QA_ADJUSTED_KPI', 'EmployeePerformanceKpi', kpi.id, {
      assessmentId: id, kpi: kpi.name,
      before: { effectiveScore: before.effectiveScore, managerScore: before.managerScore, actual: before.actual },
      after: { effectiveScore: kpiAfter!.effectiveScore, qaScore: kpiAfter!.qaScore, qaActual: kpiAfter!.qaActual },
      reason: dto.reason,
    });
    // record in QA review adjustments
    if (review) {
      const adj = (review.adjustments as any[]) || [];
      adj.push({ kpiId: kpi.id, kpi: kpi.name, from: before.effectiveScore, to: kpiAfter!.effectiveScore, reason: dto.reason, at: new Date().toISOString() });
      await this.prisma.performanceQaReview.update({ where: { id: review.id }, data: { adjustments: adj } });
    }
    return this.detail(req, id);
  }

  async qaSubmit(req: AnyReq, id: string, dto: { comment?: string }) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId }, include: { kpis: true } });
    if (!a) throw new NotFoundException('Assessment not found');
    await this.assertNotLocked(a);
    const review = await this.prisma.performanceQaReview.findFirst({ where: { assessmentId: id, reviewerId: req.user.sub, status: 'IN_PROGRESS' } });
    if (!review) throw new BadRequestException('Start the QA review before submitting');
    await this.prisma.performanceQaReview.update({ where: { id: review.id }, data: { status: 'SUBMITTED', comment: dto.comment, submittedAt: new Date() } });
    await this.recalculate(companyId, id);
    await this.prisma.employeePerformanceAssessment.update({ where: { id }, data: { qaSubmittedAt: new Date(), status: 'PENDING_APPROVAL' } });
    await this.audit.log(companyId, req.user.sub, 'QA_SUBMITTED', 'EmployeePerformanceAssessment', id, { comment: dto.comment });
    return this.detail(req, id);
  }

  // ---------- Calibration ----------
  async calibrate(req: AnyReq, id: string, dto: { score?: number; comment?: string; reason: string }) {
    const companyId = req.user.companyId!;
    if (!dto.reason?.trim()) throw new BadRequestException('Reason is required for calibration adjustments');
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId }, include: { kpis: true } });
    if (!a) throw new NotFoundException('Assessment not found');
    await this.assertNotLocked(a);
    const before = a.totalScore;
    if (dto.score != null) {
      // apply calibration as proportional scaling of effective scores to reach target overall
      const currentOverall = Number(a.totalScore || 0);
      if (currentOverall > 0) {
        const factor = Number(dto.score) / currentOverall;
        for (const k of a.kpis) {
          if (k.effectiveScore != null) {
            const capped = Math.min(200, Number(k.effectiveScore) * factor);
            await this.prisma.employeePerformanceKpi.update({ where: { id: k.id }, data: { effectiveScore: round2(capped) } });
          }
        }
      }
      await this.recalculate(companyId, id);
    }
    const after = (await this.prisma.employeePerformanceAssessment.findUnique({ where: { id } }))!.totalScore;
    await this.audit.log(companyId, req.user.sub, 'CALIBRATION_CHANGED_SCORE', 'EmployeePerformanceAssessment', id, { before, after, reason: dto.reason, comment: dto.comment });
    return this.detail(req, id);
  }

  // ---------- Final approval ----------
  async approve(req: AnyReq, id: string, dto: { comment?: string }) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId }, include: { kpis: true, cycle: true, version: { include: { template: true } } } });
    if (!a) throw new NotFoundException('Assessment not found');
    await this.assertNotLocked(a);
    if (!['PENDING_QA', 'PENDING_CALIBRATION', 'PENDING_APPROVAL'].includes(a.status)) throw new BadRequestException(`Assessment is ${a.status} — only pending results can be approved`);
    if (!a.managerSubmittedAt) throw new BadRequestException('Manager review must be submitted before approval');
    // QA stage must be completed when the template requires a QA review.
    if (a.version.template?.qaRequired !== false && !a.qaSubmittedAt) {
      throw new BadRequestException('QA review must be submitted before final approval');
    }
    if (a.kpis.some((k: any) => k.effectiveScore == null)) throw new BadRequestException('All KPIs must be assessed before approval');

    // Critical KPI gate: flagged for authorized human review, never auto-actioned.
    if (a.criticalNotMet) {
      const perms = await this.userPermissions(req);
      if (!this.has(perms, 'performance.approve', 'hr.performance.manage')) {
        throw new ForbiddenException('Critical KPI not met — final approval requires an authorized HR reviewer');
      }
    }

    await this.recalculate(companyId, id);
    const final = await this.prisma.employeePerformanceAssessment.findUnique({ where: { id }, include: { version: true, employee: { include: { user: { select: { id: true } } } }, kpis: true } });
    await this.prisma.employeePerformanceAssessment.update({ where: { id }, data: { approvedAt: new Date(), status: 'APPROVED' } });
    await this.audit.log(companyId, req.user.sub, 'PERFORMANCE_APPROVED', 'EmployeePerformanceAssessment', id, { score: final!.totalScore, result: final!.result, band: final!.band, comment: dto.comment });
    // notify employee
    if (final!.employee?.user) {
      await this.prisma.performanceNotification.create({ data: { companyId, userId: final!.employee.user.id, type: 'PERFORMANCE_APPROVED', title: 'Your performance result is approved', body: `${a.cycle.name}: ${Number(final!.totalScore).toFixed(1)}% — ${final!.result}`, link: `/performance?assessment=${id}` } });
    }
    return this.detail(req, id);
  }

  // ---------- Lock / reopen ----------
  async lock(req: AnyReq, id: string) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId } });
    if (!a) throw new NotFoundException('Assessment not found');
    if (!['APPROVED', 'COMPLETED'].includes(a.status)) throw new BadRequestException('Only approved assessments can be locked');
    await this.prisma.employeePerformanceAssessment.update({ where: { id }, data: { status: 'LOCKED', lockedAt: new Date() } });
    await this.audit.log(companyId, req.user.sub, 'PERFORMANCE_LOCKED', 'EmployeePerformanceAssessment', id, {});
    return this.detail(req, id);
  }

  async reopen(req: AnyReq, id: string, dto: { reason: string }) {
    const companyId = req.user.companyId!;
    if (!dto.reason?.trim()) throw new BadRequestException('A reason is required to reopen a locked assessment');
    const perms = await this.userPermissions(req);
    if (!this.has(perms, 'performance.approve', 'hr.performance.manage')) throw new ForbiddenException('Only authorized HR users can reopen locked assessments');
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId }, include: { cycle: true } });
    if (!a) throw new NotFoundException('Assessment not found');
    if (a.cycle.status === 'LOCKED') throw new BadRequestException('The cycle is locked — reopen the cycle first');
    await this.prisma.employeePerformanceAssessment.update({ where: { id }, data: { status: 'PENDING_QA', lockedAt: null } });
    await this.audit.log(companyId, req.user.sub, 'PERFORMANCE_REOPENED', 'EmployeePerformanceAssessment', id, { reason: dto.reason });
    return this.detail(req, id);
  }

  // ---------- Employee acknowledgement ----------
  async acknowledge(req: AnyReq, id: string, dto: { comment?: string }) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId }, include: { employee: { include: { user: true } } } });
    if (!a) throw new NotFoundException('Assessment not found');
    const isSelf = a.employee?.user?.id === req.user.sub;
    const perms = req.user['permissions'] || [];
    if (!isSelf && !perms.includes('performance.self.view')) throw new ForbiddenException('Only the employee can acknowledge their result');
    await this.prisma.employeePerformanceAssessment.update({ where: { id }, data: { acknowledgementStatus: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgementComment: dto.comment } });
    await this.audit.log(companyId, req.user.sub, 'PERFORMANCE_ACKNOWLEDGED', 'EmployeePerformanceAssessment', id, { comment: dto.comment });
    return this.detail(req, id);
  }

  async sendForAcknowledgement(req: AnyReq, id: string) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId }, include: { employee: { include: { user: true } }, cycle: true } });
    if (!a) throw new NotFoundException('Assessment not found');
    if (!['APPROVED', 'COMPLETED', 'LOCKED'].includes(a.status)) throw new BadRequestException('Send for acknowledgement after final approval');
    if (a.employee?.user) {
      await this.prisma.performanceNotification.create({ data: { companyId, userId: a.employee.user.id, type: 'ACKNOWLEDGEMENT_REQUEST', title: 'Please acknowledge your performance result', body: `${a.cycle.name}: review and acknowledge your final result. Acknowledgement does not necessarily mean agreement — you may add a comment.`, link: `/performance?assessment=${id}` } });
    }
    await this.prisma.employeePerformanceAssessment.update({ where: { id }, data: { acknowledgementStatus: 'PENDING' } });
    await this.audit.log(companyId, req.user.sub, 'ACKNOWLEDGEMENT_SENT', 'EmployeePerformanceAssessment', id, {});
    return this.detail(req, id);
  }

  // ---------- Reminders ----------
  async remind(req: AnyReq, id: string) {
    const companyId = req.user.companyId!;
    const a = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id, companyId }, include: { employee: { include: { user: true } }, cycle: true } });
    if (!a) throw new NotFoundException('Assessment not found');
    if (a.employee?.user) {
      await this.prisma.performanceNotification.create({ data: { companyId, userId: a.employee.user.id, employeeId: a.employeeId, type: 'SUBMISSION_REMINDER', title: 'Your KPI assessment is due', body: `Cycle "${a.cycle.name}" — please submit before ${new Date(a.cycle.employeeDeadline).toLocaleDateString()}.`, link: `/performance?assessment=${id}` } });
    }
    await this.audit.log(companyId, req.user.sub, 'REMINDER_SENT', 'EmployeePerformanceAssessment', id, { to: 'employee' });
    return { ok: true };
  }

  async remindMissing(req: AnyReq, cycleId: string) {
    const companyId = req.user.companyId!;
    const rows = await this.list(companyId, { cycleId });
    const missing = rows.filter((r: any) => !r.employeeSubmittedAt && !r.excludedReason);
    let sent = 0;
    for (const r of missing) {
      try { await this.remind(req, r.id); sent += 1; } catch { /* keep going */ }
    }
    return { sent, missing: missing.length };
  }

  // ---------- Development plan ----------
  async createDevelopmentPlan(req: AnyReq, dto: any) {
    const companyId = req.user.companyId!;
    const plan = await this.prisma.developmentPlan.create({
      data: {
        companyId, employeeId: dto.employeeId, assessmentId: dto.assessmentId || null,
        objective: dto.objective, action: dto.action || null, owner: dto.owner || null,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null, training: dto.training || null,
        notes: dto.notes || null, createdById: req.user.sub,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'DEVELOPMENT_PLAN_CREATED', 'DevelopmentPlan', plan.id, { employeeId: dto.employeeId });
    return plan;
  }

  async listDevelopmentPlans(companyId: string, employeeId?: string) {
    return this.prisma.developmentPlan.findMany({ where: { companyId, ...(employeeId ? { employeeId } : {}) }, include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } }, orderBy: { createdAt: 'desc' } });
  }

  /** Employee performance history for the employee details page. */
  async employeeHistory(companyId: string, employeeId: string) {
    const rows = await this.prisma.employeePerformanceAssessment.findMany({
      where: { companyId, employeeId },
      include: { cycle: { select: { name: true, periodStart: true, periodEnd: true } }, kpis: { select: { effectiveScore: true } } },
      orderBy: { cycle: { periodStart: 'desc' } },
    });
    return rows.map((a: any) => ({
      id: a.id, cycle: a.cycle?.name, periodStart: a.cycle?.periodStart, periodEnd: a.cycle?.periodEnd,
      status: a.status, score: a.totalScore, result: a.result, band: a.band, kpiCompletion: a.kpis.length ? Math.round((a.kpis.filter((k: any) => k.effectiveScore != null).length / a.kpis.length) * 100) : 0,
      templateName: a.templateName,
    }));
  }
}
