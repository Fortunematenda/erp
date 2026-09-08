import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { round2, DEFAULT_BANDS } from './performance.constants';

type AnyReq = { user: { sub: string; companyId?: string } };

@Injectable()
export class KpiTemplateService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(companyId: string, filters: { departmentId?: string; status?: string; search?: string }) {
    const where: any = { companyId };
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.status) where.status = filters.status;
    if (filters.search) where.OR = [{ name: { contains: filters.search, mode: 'insensitive' } }, { jobRole: { contains: filters.search, mode: 'insensitive' } }];
    return this.prisma.kpiTemplate.findMany({
      where,
      include: {
        department: true,
        versions: { orderBy: { version: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Latest version's KPI list for the table. */
  currentVersion(t: any) {
    return t.versions?.find((v: any) => v.version === t.currentVersion) || t.versions?.[0] || null;
  }

  async get(companyId: string, id: string) {
    const t = await this.prisma.kpiTemplate.findFirst({
      where: { id, companyId },
      include: {
        department: true,
        versions: { orderBy: { version: 'desc' }, include: { kpis: { include: { category: true }, orderBy: { position: 'asc' } } } },
      },
    });
    if (!t) throw new NotFoundException('KPI template not found');
    return t;
  }

  async usageStats(companyId: string, id: string) {
    const versions = await this.prisma.kpiTemplateVersion.findMany({ where: { templateId: id, companyId }, select: { id: true } });
    const versionIds = versions.map((v) => v.id);
    const activeVersion = await this.prisma.kpiTemplateVersion.findFirst({ where: { templateId: id, companyId, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
    const [activeEmployees, activeAssessments, historical] = await Promise.all([
      activeVersion ? this.prisma.employee.count({ where: { companyId, active: true, departmentId: (await this.prisma.kpiTemplate.findFirst({ where: { id } }))?.departmentId } }) : 0,
      activeVersion ? this.prisma.employeePerformanceAssessment.count({ where: { companyId, versionId: activeVersion.id, status: { in: ['PENDING_EMPLOYEE', 'PENDING_MANAGER', 'PENDING_QA', 'PENDING_CALIBRATION', 'PENDING_APPROVAL'] } } }) : 0,
      versionIds.length ? this.prisma.employeePerformanceAssessment.count({ where: { companyId, versionId: { in: versionIds }, status: { in: ['APPROVED', 'COMPLETED', 'LOCKED'] } } }) : 0,
    ]);
    return { activeEmployees, currentAssessments: activeAssessments, historicalReviews: historical };
  }

  /** Weight total of a version's KPIs — must be exactly 100 to activate. */
  private async versionWeightTotal(versionId: string): Promise<number> {
    const kpis = await this.prisma.kpiDefinition.findMany({ where: { versionId }, select: { weight: true } });
    return round2(kpis.reduce((s, k) => s + Number(k.weight), 0));
  }

  async create(req: AnyReq, dto: any) {
    const companyId = req.user.companyId!;
    if (!dto.departmentId) throw new BadRequestException('Department is required — select an HR department record');
    const dept = await this.prisma.department.findFirst({ where: { id: dto.departmentId, branch: { companyId } } });
    if (!dept) throw new BadRequestException('Department not found in your company');
    const template = await this.prisma.kpiTemplate.create({
      data: {
        companyId,
        departmentId: dto.departmentId,
        jobRole: dto.jobRole || null,
        name: dto.name,
        description: dto.description || null,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        passMark: dto.passMark ?? 70,
        maxAchievement: dto.maxAchievement ?? 120,
        criticalMin: dto.criticalMin ?? null,
        selfAssessment: !!dto.selfAssessment,
        qaRequired: dto.qaRequired ?? true,
        managerQaDistinct: dto.managerQaDistinct ?? true,
        status: 'DRAFT',
        createdBy: req.user.sub,
      },
    });
    // initial version shell
    await this.prisma.kpiTemplateVersion.create({
      data: {
        companyId,
        templateId: template.id,
        version: 1,
        name: dto.name,
        description: dto.description || null,
        passMark: dto.passMark ?? 70,
        maxAchievement: dto.maxAchievement ?? 120,
        criticalMin: dto.criticalMin ?? null,
        selfAssessment: !!dto.selfAssessment,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        status: 'ACTIVE',
      },
    });
    if (dto.kpis?.length) await this.replaceKpis(companyId, template.id, 1, dto.kpis);
    await this.seedCompanyBandsIfEmpty(companyId);
    await this.audit.log(companyId, req.user.sub, 'KPI_TEMPLATE_CREATED', 'KpiTemplate', template.id, { name: dto.name, departmentId: dto.departmentId, jobRole: dto.jobRole || 'All Roles' });
    return this.get(companyId, template.id);
  }

  async update(req: AnyReq, id: string, dto: any) {
    const companyId = req.user.companyId!;
    const t = await this.prisma.kpiTemplate.findFirst({ where: { id, companyId }, include: { versions: { orderBy: { version: 'desc' } } } });
    if (!t) throw new NotFoundException('KPI template not found');
    const currentVersion = t.versions.find((v) => v.version === t.currentVersion) || t.versions[0];
    const activeVersion = t.versions.find((v) => v.status === 'ACTIVE' && v.version === t.currentVersion);
    // Has the template already been used by real assessments?
    const usedCount = await this.prisma.employeePerformanceAssessment.count({ where: { companyId, versionId: { in: t.versions.map((v) => v.id) } } });

    const templateChanged = dto.name != null && dto.name !== t.name;
    const kpisChanged = Array.isArray(dto.kpis) && this.kpisDiffer(currentVersion, dto.kpis);
    const scoringChanged = (dto.passMark != null && Number(dto.passMark) !== Number(currentVersion.passMark))
      || (dto.maxAchievement != null && Number(dto.maxAchievement) !== Number(currentVersion.maxAchievement))
      || (dto.selfAssessment != null && !!dto.selfAssessment !== !!currentVersion.selfAssessment);

    // VERSIONING RULE: editing an ACTIVE template that assessments depend on
    // creates a new version; historical assessments remain on the old version.
    const needsNewVersion = (usedCount > 0) && (templateChanged || kpisChanged || scoringChanged) && t.status === 'ACTIVE';

    if (needsNewVersion) {
      const newVersionNo = t.currentVersion + 1;
      await this.prisma.kpiTemplateVersion.update({ where: { id: activeVersion!.id }, data: { status: 'SUPERSEDED', effectiveTo: new Date() } });
      const kpis = kpisChanged ? dto.kpis : await this.prisma.kpiDefinition.findMany({ where: { versionId: currentVersion.id }, orderBy: { position: 'asc' } });
      await this.prisma.kpiTemplateVersion.create({
        data: {
          companyId,
          templateId: t.id,
          version: newVersionNo,
          name: dto.name ?? t.name,
          description: dto.description ?? t.description,
          passMark: dto.passMark != null ? dto.passMark : currentVersion.passMark,
          maxAchievement: dto.maxAchievement != null ? dto.maxAchievement : currentVersion.maxAchievement,
          criticalMin: dto.criticalMin != null ? dto.criticalMin : currentVersion.criticalMin,
          selfAssessment: dto.selfAssessment != null ? !!dto.selfAssessment : currentVersion.selfAssessment,
          status: 'ACTIVE',
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          kpis: {
            create: kpis.map((k: any, i: number) => ({
              companyId, code: k.code || `KPI-${i + 1}`, name: k.name, description: k.description || '',
              categoryId: k.categoryId || null, categoryLabel: k.categoryLabel || null,
              weight: k.weight, measurementType: k.measurementType || 'NUMBER', direction: k.direction || 'HIGHER_IS_BETTER',
              scoringMethod: k.scoringMethod || 'PROPORTIONAL', targetType: k.targetType || 'NUMBER',
              targetValue: k.targetValue != null && k.targetValue !== '' ? k.targetValue : null,
              targetText: k.targetText || null, unit: k.unit || null,
              dataSource: k.dataSource || null, dataSourceLabel: k.dataSourceLabel || null,
              critical: !!k.critical, position: k.position ?? i,
              minimumAcceptable: k.minimumAcceptable ?? null, stretchTarget: k.stretchTarget ?? null,
              evidenceRequired: !!k.evidenceRequired, employeeCommentRequired: !!k.employeeCommentRequired, reviewerCommentRequired: !!k.reviewerCommentRequired,
            })),
          },
        },
      });
      await this.prisma.kpiTemplate.update({ where: { id: t.id }, data: { currentVersion: newVersionNo, ...(dto.name ? { name: dto.name } : {}), ...(dto.description !== undefined ? { description: dto.description } : {}), ...(dto.passMark != null ? { passMark: dto.passMark } : {}), ...(dto.maxAchievement != null ? { maxAchievement: dto.maxAchievement } : {}), ...(dto.criticalMin !== undefined ? { criticalMin: dto.criticalMin } : {}), ...(dto.selfAssessment != null ? { selfAssessment: !!dto.selfAssessment } : {}) } });
      await this.audit.log(companyId, req.user.sub, 'TEMPLATE_VERSION_CREATED', 'KpiTemplate', t.id, { newVersion: newVersionNo, previousVersion: t.currentVersion, reason: 'Template edited while active with existing assessments' });
      return this.get(companyId, id);
    }

    // Not in use (or not ACTIVE): edit in place.
    const data: any = {};
    if (dto.name != null) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.departmentId != null) data.departmentId = dto.departmentId;
    if (dto.jobRole !== undefined) data.jobRole = dto.jobRole || null;
    if (dto.effectiveFrom != null) data.effectiveFrom = new Date(dto.effectiveFrom);
    if (dto.effectiveTo !== undefined) data.effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (dto.passMark != null) data.passMark = dto.passMark;
    if (dto.maxAchievement != null) data.maxAchievement = dto.maxAchievement;
    if (dto.criticalMin !== undefined) data.criticalMin = dto.criticalMin;
    if (dto.selfAssessment != null) data.selfAssessment = !!dto.selfAssessment;
    if (dto.qaRequired != null) data.qaRequired = !!dto.qaRequired;
    if (dto.managerQaDistinct != null) data.managerQaDistinct = !!dto.managerQaDistinct;
    await this.prisma.kpiTemplate.update({ where: { id: t.id }, data });
    if (currentVersion) {
      const vData: any = {};
      if (dto.name != null) vData.name = dto.name;
      if (dto.description !== undefined) vData.description = dto.description;
      if (dto.passMark != null) vData.passMark = dto.passMark;
      if (dto.maxAchievement != null) vData.maxAchievement = dto.maxAchievement;
      if (dto.selfAssessment != null) vData.selfAssessment = !!dto.selfAssessment;
      if (Object.keys(vData).length) await this.prisma.kpiTemplateVersion.update({ where: { id: currentVersion.id }, data: vData });
    }
    if (Array.isArray(dto.kpis) && currentVersion) {
      await this.replaceKpis(companyId, t.id, t.currentVersion, dto.kpis);
    }
    await this.audit.log(companyId, req.user.sub, 'KPI_TEMPLATE_UPDATED', 'KpiTemplate', t.id, { fields: Object.keys(data), kpisReplaced: Array.isArray(dto.kpis) });
    return this.get(companyId, id);
  }

  private kpisDiffer(version: any, kpis: any[]): boolean {
    const existing = (version?.kpis || []).map((k: any) => ({ code: k.code, name: k.name, weight: Number(k.weight), measurementType: k.measurementType, direction: k.direction, targetValue: k.targetValue == null ? null : Number(k.targetValue), targetText: k.targetText, dataSource: k.dataSource, critical: k.critical }));
    const incoming = kpis.map((k: any) => ({ code: k.code, name: k.name, weight: Number(k.weight), measurementType: k.measurementType, direction: k.direction, targetValue: k.targetValue == null || k.targetValue === '' ? null : Number(k.targetValue), targetText: k.targetText, dataSource: k.dataSource, critical: !!k.critical }));
    if (existing.length !== incoming.length) return true;
    for (let i = 0; i < existing.length; i++) {
      const a = existing[i], b = incoming[i];
      if (a.code !== b.code || a.name !== b.name || a.weight !== b.weight || a.measurementType !== b.measurementType || a.direction !== b.direction || a.targetValue !== b.targetValue || a.targetText !== b.targetText || a.dataSource !== b.dataSource || a.critical !== b.critical) return true;
    }
    return false;
  }

  private async replaceKpis(companyId: string, templateId: string, versionNo: number, kpis: any[]) {
    const version = await this.prisma.kpiTemplateVersion.findFirst({ where: { templateId, version: versionNo, companyId } });
    if (!version) throw new BadRequestException('Template version not found');
    await this.prisma.kpiDefinition.deleteMany({ where: { versionId: version.id } });
    if (!kpis.length) return;
    await this.prisma.kpiDefinition.createMany({
      data: kpis.map((k: any, i: number) => ({
        companyId, versionId: version.id, code: k.code || `KPI-${i + 1}`, name: k.name, description: k.description || '',
        categoryId: k.categoryId || null, categoryLabel: k.categoryLabel || null,
        weight: k.weight, measurementType: k.measurementType || 'NUMBER', direction: k.direction || 'HIGHER_IS_BETTER',
        scoringMethod: k.scoringMethod || 'PROPORTIONAL', targetType: k.targetType || 'NUMBER',
        targetValue: k.targetValue != null && k.targetValue !== '' ? k.targetValue : null,
        targetText: k.targetText || null, unit: k.unit || null,
        dataSource: k.dataSource || null, dataSourceLabel: k.dataSourceLabel || null,
        critical: !!k.critical, position: k.position ?? i,
        minimumAcceptable: k.minimumAcceptable ?? null, stretchTarget: k.stretchTarget ?? null,
        evidenceRequired: !!k.evidenceRequired, employeeCommentRequired: !!k.employeeCommentRequired, reviewerCommentRequired: !!k.reviewerCommentRequired,
      })),
    });
  }

  async activate(req: AnyReq, id: string) {
    const companyId = req.user.companyId!;
    const t = await this.get(companyId, id);
    const version = t.versions.find((v: any) => v.version === t.currentVersion);
    if (!version) throw new BadRequestException('Template has no version');
    const total = await this.versionWeightTotal(version.id);
    if (Math.abs(total - 100) > 0.001) throw new BadRequestException(`Cannot activate: KPI weights must total 100% (currently ${total}%)`);
    const kpis = await this.prisma.kpiDefinition.findMany({ where: { versionId: version.id } });
    if (!kpis.length) throw new BadRequestException('Cannot activate a template without KPIs');
    for (const k of kpis) {
      if (k.targetValue == null && !k.targetText && k.measurementType !== 'MANUAL_SCORE') throw new BadRequestException(`KPI "${k.name}" has no target`);
    }
    // Ambiguity guard: only one active template per department (+ optional role).
    const clash = await this.prisma.kpiTemplate.findFirst({
      where: { companyId, departmentId: t.departmentId, jobRole: t.jobRole ?? null, status: 'ACTIVE', id: { not: id } },
    });
    if (clash) throw new BadRequestException(`Another active template already covers this department${t.jobRole ? ' and role' : ''}: "${clash.name}". Deactivate it first to avoid ambiguous assignment.`);
    await this.prisma.kpiTemplate.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit.log(companyId, req.user.sub, 'TEMPLATE_ACTIVATED', 'KpiTemplate', id, { version: t.currentVersion });
    return this.get(companyId, id);
  }

  async setStatus(req: AnyReq, id: string, status: string) {
    const companyId = req.user.companyId!;
    const t = await this.prisma.kpiTemplate.findFirst({ where: { id, companyId } });
    if (!t) throw new NotFoundException('KPI template not found');
    if (!['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(status)) throw new BadRequestException('Invalid status');
    if (t.status === 'ACTIVE' && status !== 'INACTIVE' && status !== 'ARCHIVED') throw new BadRequestException('Deactivate the template first');
    if (status === 'ARCHIVED') {
      const used = await this.prisma.employeePerformanceAssessment.count({ where: { companyId, version: { templateId: id } } });
      if (!used) {
        await this.prisma.kpiTemplate.delete({ where: { id } }); // never used — safe to remove entirely
        await this.audit.log(companyId, req.user.sub, 'KPI_TEMPLATE_DELETED', 'KpiTemplate', id, { name: t.name });
        return { ok: true, deleted: true };
      }
    }
    await this.prisma.kpiTemplate.update({ where: { id }, data: { status } });
    await this.audit.log(companyId, req.user.sub, 'KPI_TEMPLATE_STATUS', 'KpiTemplate', id, { status });
    return this.get(companyId, id);
  }

  /** Duplicate template (e.g. 2026 → 2027) with a fresh DRAFT version 1. */
  async duplicate(req: AnyReq, id: string, name?: string) {
    const companyId = req.user.companyId!;
    const t = await this.get(companyId, id);
    const version = t.versions.find((v: any) => v.version === t.currentVersion);
    const copy = await this.prisma.kpiTemplate.create({
      data: {
        companyId, departmentId: t.departmentId, jobRole: t.jobRole, name: name || `${t.name} (Copy)`,
        description: t.description, effectiveFrom: new Date(), passMark: t.passMark, maxAchievement: t.maxAchievement,
        criticalMin: t.criticalMin, selfAssessment: t.selfAssessment, qaRequired: t.qaRequired, managerQaDistinct: t.managerQaDistinct,
        status: 'DRAFT', createdBy: req.user.sub,
      },
    });
    await this.prisma.kpiTemplateVersion.create({
      data: {
        companyId, templateId: copy.id, version: 1, name: name || `${t.name} (Copy)`, description: t.description,
        passMark: version?.passMark || t.passMark, maxAchievement: version?.maxAchievement || t.maxAchievement, criticalMin: version?.criticalMin,
        selfAssessment: version?.selfAssessment || t.selfAssessment, status: 'ACTIVE', effectiveFrom: new Date(),
        kpis: { create: (version?.kpis || []).map((k: any, i: number) => ({
          companyId, code: k.code, name: k.name, description: k.description, categoryId: k.categoryId, categoryLabel: k.categoryLabel,
          weight: k.weight, measurementType: k.measurementType, direction: k.direction, scoringMethod: k.scoringMethod, targetType: k.targetType,
          targetValue: k.targetValue, targetText: k.targetText, unit: k.unit, dataSource: k.dataSource, dataSourceLabel: k.dataSourceLabel,
          critical: k.critical, position: i, minimumAcceptable: k.minimumAcceptable, stretchTarget: k.stretchTarget,
          evidenceRequired: k.evidenceRequired, employeeCommentRequired: k.employeeCommentRequired, reviewerCommentRequired: k.reviewerCommentRequired,
        })) },
      },
    });
    await this.audit.log(companyId, req.user.sub, 'KPI_TEMPLATE_DUPLICATED', 'KpiTemplate', copy.id, { source: id, name: copy.name });
    return this.get(companyId, copy.id);
  }

  async categories(companyId: string) {
    return this.prisma.kpiCategory.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } });
  }

  async createCategory(req: AnyReq, dto: { name: string; color?: string }) {
    const companyId = req.user.companyId!;
    const name = String(dto.name || '').trim();
    if (!name) throw new BadRequestException('Category name is required');
    const existing = await this.prisma.kpiCategory.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' } } });
    if (existing) return existing;
    const cat = await this.prisma.kpiCategory.create({ data: { companyId, name, color: dto.color || null } });
    await this.audit.log(companyId, req.user.sub, 'KPI_CATEGORY_CREATED', 'KpiCategory', cat.id, { name });
    return cat;
  }

  async setBands(req: AnyReq, dto: { templateId?: string; bands: { label: string; minScore: number; maxScore: number; color?: string }[] }) {
    const companyId = req.user.companyId!;
    await this.prisma.performanceBand.deleteMany({ where: { companyId, templateId: dto.templateId ?? null } });
    if (dto.bands?.length) {
      await this.prisma.performanceBand.createMany({ data: dto.bands.map((b, i) => ({ companyId, templateId: dto.templateId ?? null, label: b.label, minScore: b.minScore, maxScore: b.maxScore, color: b.color || null, position: i + 1 })) });
    }
    await this.audit.log(companyId, req.user.sub, 'PERFORMANCE_BANDS_UPDATED', dto.templateId ? 'KpiTemplate' : 'Company', dto.templateId ?? companyId, { count: dto.bands?.length || 0 });
    return this.getBands(companyId, dto.templateId);
  }

  async getBands(companyId: string, templateId?: string | null) {
    if (templateId) {
      const own = await this.prisma.performanceBand.findMany({ where: { companyId, templateId }, orderBy: { position: 'asc' } });
      if (own.length) return own;
    }
    const company = await this.prisma.performanceBand.findMany({ where: { companyId, templateId: null }, orderBy: { position: 'asc' } });
    if (company.length) return company;
    return DEFAULT_BANDS.map((b) => ({ ...b, id: null, companyId, templateId: null }));
  }

  private async seedCompanyBandsIfEmpty(companyId: string) {
    const count = await this.prisma.performanceBand.count({ where: { companyId } });
    if (count === 0) {
      await this.prisma.performanceBand.createMany({ data: DEFAULT_BANDS.map((b) => ({ companyId, templateId: null, label: b.label, minScore: b.minScore, maxScore: b.maxScore, color: b.color, position: b.position })) });
    }
  }
}
