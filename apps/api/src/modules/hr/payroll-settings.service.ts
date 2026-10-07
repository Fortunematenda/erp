import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { companyIdOf } from '../../core/context';

const round2 = (n: number) => Number((Number(n) || 0).toFixed(2));
const toNum = (v: any) => Number(v || 0);
const SAFE_FIELDS = ['description', 'name', 'notes'];

/**
 * Statutory rule configuration: CRUD, effective-dated versioning, activation,
 * usage and audit. Historical rules used by processed payroll are never mutated.
 */
@Injectable()
export class PayrollSettingsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private computeStatus(r: any, now = new Date()) {
    if (r.status === 'DRAFT' || r.status === 'INACTIVE') return r.status;
    if (new Date(r.validFrom) > now) return 'SCHEDULED';
    if (r.validTo && new Date(r.validTo) < now) return 'EXPIRED';
    return 'ACTIVE';
  }

  private serialize(r: any) {
    return {
      ...r,
      employeeRate: r.employeeRate != null ? toNum(r.employeeRate) : null,
      employerRate: r.employerRate != null ? toNum(r.employerRate) : null,
      employeeMin: r.employeeMin != null ? toNum(r.employeeMin) : null,
      employeeMax: r.employeeMax != null ? toNum(r.employeeMax) : null,
      employerMin: r.employerMin != null ? toNum(r.employerMin) : null,
      employerMax: r.employerMax != null ? toNum(r.employerMax) : null,
      maxInsurableEarnings: r.maxInsurableEarnings != null ? toNum(r.maxInsurableEarnings) : null,
      bands: (r.configuration as any)?.brackets || [],
      computedStatus: this.computeStatus(r),
    };
  }

  async list(req: any, q: any) {
    const where: any = {};
    if (q?.authority) where.authority = q.authority;
    if (q?.ruleType) where.ruleType = q.ruleType;
    if (q?.country) where.country = q.country;
    const rows = await this.prisma.statutoryRule.findMany({ where, orderBy: [{ code: 'asc' }, { version: 'desc' }] });
    let out = rows.map((r) => this.serialize(r));
    if (q?.status) out = out.filter((r) => r.computedStatus === q.status);
    if (q?.search) { const s = String(q.search).toLowerCase(); out = out.filter((r) => `${r.code} ${r.name} ${r.authority}`.toLowerCase().includes(s)); }
    return out;
  }

  async get(req: any, id: string) {
    const r = await this.prisma.statutoryRule.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Statutory rule not found');
    const audit = await this.prisma.auditLog.findMany({ where: { entityType: 'StatutoryRule', entityId: id }, orderBy: { createdAt: 'desc' }, take: 50, include: { user: { select: { firstName: true, lastName: true } } } });
    return { rule: this.serialize(r), audit: audit.map((a) => ({ at: a.createdAt, action: a.action, user: a.user ? `${a.user.firstName} ${a.user.lastName}` : 'System', reason: a.reason, metadata: a.metadata })) };
  }

  private buildConfig(dto: any) {
    const cfg: any = {};
    if (dto.calculationMethod === 'PROGRESSIVE' || (Array.isArray(dto.bands) && dto.bands.length)) cfg.brackets = (dto.bands || []).map((b: any) => ({ from: toNum(b.from), to: b.to === '' || b.to == null ? null : toNum(b.to), rate: toNum(b.rate) }));
    if (dto.maxInsurableEarnings != null) cfg.cap = toNum(dto.maxInsurableEarnings);
    if (dto.employeeRate != null) cfg.employeePct = toNum(dto.employeeRate);
    if (dto.employerRate != null) cfg.employerPct = toNum(dto.employerRate);
    if (dto.calculationBase) cfg.base = dto.calculationBase;
    return cfg;
  }

  private toData(dto: any, userId: string) {
    return {
      country: dto.country || 'ZW', authority: dto.authority, code: String(dto.code || '').toUpperCase(), name: dto.name,
      validFrom: new Date(dto.validFrom), validTo: dto.validTo ? new Date(dto.validTo) : null,
      configuration: this.buildConfig(dto), active: dto.active ?? true,
      ruleType: dto.ruleType || 'OTHER_DEDUCTION', description: dto.description, version: dto.version ? Number(dto.version) : 1,
      calculationMethod: dto.calculationMethod || 'PERCENTAGE', calculationBase: dto.calculationBase || 'GROSS',
      employeeEnabled: dto.employeeEnabled ?? true, employerEnabled: dto.employerEnabled ?? false,
      employeeRate: dto.employeeRate != null ? toNum(dto.employeeRate) : null, employerRate: dto.employerRate != null ? toNum(dto.employerRate) : null,
      employeeMin: dto.employeeMin != null ? toNum(dto.employeeMin) : null, employeeMax: dto.employeeMax != null ? toNum(dto.employeeMax) : null,
      employerMin: dto.employerMin != null ? toNum(dto.employerMin) : null, employerMax: dto.employerMax != null ? toNum(dto.employerMax) : null,
      maxInsurableEarnings: dto.maxInsurableEarnings != null ? toNum(dto.maxInsurableEarnings) : null,
      currency: dto.currency || 'USD', roundingRule: dto.roundingRule || 'NEAREST_CENT', payrollFrequency: dto.payrollFrequency || 'MONTHLY',
      employeeGlAccount: dto.employeeGlAccount, employerLiabilityGlAccount: dto.employerLiabilityGlAccount, employerExpenseGlAccount: dto.employerExpenseGlAccount,
      applicability: dto.applicability || undefined, status: dto.status || 'DRAFT', notes: dto.notes, updatedById: userId,
    };
  }

  private async assertNoOverlap(code: string, validFrom: Date, validTo: Date | null, excludeId?: string) {
    const rows = await this.prisma.statutoryRule.findMany({ where: { code, status: { in: ['ACTIVE', 'SCHEDULED', 'DRAFT'] } } });
    for (const r of rows) {
      if (excludeId && r.id === excludeId) continue;
      const rFrom = new Date(r.validFrom).getTime();
      const rTo = r.validTo ? new Date(r.validTo).getTime() : Infinity;
      const nFrom = validFrom.getTime();
      const nTo = validTo ? validTo.getTime() : Infinity;
      if (nFrom <= rTo && nTo >= rFrom) throw new BadRequestException({ message: `An active ${code} rule already covers this effective period.`, existingId: r.id, code: 'RULE_OVERLAP' });
    }
  }

  async create(req: any, dto: any) {
    if (!dto.code || !dto.name || !dto.authority || !dto.validFrom) throw new BadRequestException('Code, name, authority and valid from are required');
    const data = this.toData(dto, req.user.sub);
    const version = await this.prisma.statutoryRule.count({ where: { code: data.code } });
    data.version = version + 1;
    const rule = await this.prisma.statutoryRule.create({ data });
    await this.audit.log(companyIdOf(req.user), req.user.sub, 'RULE_CREATED', 'StatutoryRule', rule.id, { module: 'hr', result: 'SUCCESS', metadata: { code: rule.code, version: rule.version } });
    return this.serialize(rule);
  }

  async update(req: any, id: string, dto: any) {
    const existing = await this.prisma.statutoryRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Statutory rule not found');
    const used = await this.isUsedByFinalizedPayroll(existing);
    const data: any = {};
    if (used) {
      // Only safe metadata may change once historical payroll used the rule.
      for (const f of SAFE_FIELDS) if (dto[f] !== undefined) data[f] = dto[f];
      data.updatedById = req.user.sub;
    } else {
      Object.assign(data, this.toData(dto, req.user.sub));
      delete data.version;
      if (data.validFrom && (dto.code || dto.validFrom || dto.validTo !== undefined)) await this.assertNoOverlap(data.code || existing.code, new Date(data.validFrom), data.validTo ? new Date(data.validTo) : null, id);
    }
    const rule = await this.prisma.statutoryRule.update({ where: { id }, data });
    await this.audit.log(companyIdOf(req.user), req.user.sub, used ? 'RULE_UPDATED' : 'RULE_UPDATED', 'StatutoryRule', id, { module: 'hr', result: 'SUCCESS', metadata: { before: existing, after: data, restricted: used } });
    return this.serialize(rule);
  }

  async newVersion(req: any, id: string, dto: any) {
    const existing = await this.prisma.statutoryRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Statutory rule not found');
    const validFrom = new Date(dto.validFrom);
    if (isNaN(validFrom.getTime())) throw new BadRequestException('A valid new effective date is required');
    const dayBefore = new Date(validFrom.getTime() - 86400000);
    await this.assertNoOverlap(existing.code, validFrom, dto.validTo ? new Date(dto.validTo) : null, id);
    const base = { ...existing, ...dto } as any;
    const data = this.toData({ ...base, version: existing.version + 1, validFrom: dto.validFrom, validTo: dto.validTo ?? null, status: dto.status || 'SCHEDULED' }, req.user.sub);
    data.version = existing.version + 1;
    await this.prisma.$transaction([
      this.prisma.statutoryRule.update({ where: { id }, data: { validTo: dayBefore, active: false, status: 'INACTIVE', updatedById: req.user.sub } }),
      this.prisma.statutoryRule.create({ data }),
    ]);
    const created = await this.prisma.statutoryRule.findFirst({ where: { code: existing.code, version: existing.version + 1 }, orderBy: { createdAt: 'desc' } });
    await this.audit.log(companyIdOf(req.user), req.user.sub, 'RULE_VERSION_CREATED', 'StatutoryRule', created!.id, { module: 'hr', result: 'SUCCESS', metadata: { code: existing.code, fromVersion: existing.version, toVersion: existing.version + 1 } });
    return this.serialize(created!);
  }

  private validateForActivation(r: any) {
    const missing: string[] = [];
    if (!r.name) missing.push('Name');
    if (!r.authority) missing.push('Authority');
    if (!r.validFrom) missing.push('Valid from');
    if (r.calculationMethod === 'PROGRESSIVE' && !((r.configuration as any)?.brackets || []).length) missing.push('Progressive bands');
    if (r.calculationMethod === 'PERCENTAGE' && r.employeeRate == null && r.employerRate == null) missing.push('Rate');
    if (!r.currency) missing.push('Currency');
    if (r.employeeEnabled && !r.employeeGlAccount) missing.push('Employee GL account');
    if (missing.length) throw new BadRequestException(`Cannot activate: ${missing.join(', ')} required`);
  }

  async activate(req: any, id: string) {
    const r = await this.prisma.statutoryRule.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Statutory rule not found');
    this.validateForActivation(r);
    await this.assertNoOverlap(r.code, new Date(r.validFrom), r.validTo ? new Date(r.validTo) : null, id);
    const status = new Date(r.validFrom) > new Date() ? 'SCHEDULED' : 'ACTIVE';
    const updated = await this.prisma.statutoryRule.update({ where: { id }, data: { status, active: true, updatedById: req.user.sub } });
    await this.audit.log(companyIdOf(req.user), req.user.sub, 'RULE_ACTIVATED', 'StatutoryRule', id, { module: 'hr', result: 'SUCCESS', metadata: { code: r.code, version: r.version } });
    return this.serialize(updated);
  }

  async deactivate(req: any, id: string, dto: { effectiveEndDate?: string; reason?: string }) {
    const r = await this.prisma.statutoryRule.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Statutory rule not found');
    if (!dto.reason) throw new BadRequestException('A reason is required to deactivate a statutory rule');
    const updated = await this.prisma.statutoryRule.update({ where: { id }, data: { status: 'INACTIVE', active: false, validTo: dto.effectiveEndDate ? new Date(dto.effectiveEndDate) : r.validTo, updatedById: req.user.sub } });
    await this.audit.log(companyIdOf(req.user), req.user.sub, 'RULE_DEACTIVATED', 'StatutoryRule', id, { module: 'hr', result: 'SUCCESS', reason: dto.reason, metadata: { effectiveEndDate: dto.effectiveEndDate } });
    return this.serialize(updated);
  }

  private async isUsedByFinalizedPayroll(rule: any): Promise<boolean> {
    const start = new Date(rule.validFrom); const end = rule.validTo ? new Date(rule.validTo) : new Date(2999, 0, 1);
    const count = await this.prisma.payrollRun.count({ where: { status: { in: ['PROCESSED', 'LOCKED', 'FINALISED'] }, payslips: { some: {} } } });
    if (!count) return false;
    const runs = await this.prisma.payrollRun.findMany({ where: { status: { in: ['PROCESSED', 'LOCKED', 'FINALISED'] } }, select: { year: true, period: true } });
    return runs.some((r) => { const d = new Date(Date.UTC(r.year, r.period - 1, 28)); return d >= start && d <= end; });
  }

  async usage(req: any, id: string) {
    const r = await this.prisma.statutoryRule.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Statutory rule not found');
    const start = new Date(r.validFrom); const end = r.validTo ? new Date(r.validTo) : new Date(2999, 0, 1);
    const runs = await this.prisma.payrollRun.findMany({ where: { status: { in: ['PROCESSED', 'LOCKED', 'FINALISED'] } }, orderBy: [{ year: 'desc' }, { period: 'desc' }] });
    const inRange = runs.filter((x) => { const d = new Date(Date.UTC(x.year, x.period - 1, 28)); return d >= start && d <= end; });
    const runIds = inRange.map((x) => x.id);
    const payslips = runIds.length ? await this.prisma.payslip.findMany({ where: { payrollRunId: { in: runIds } } }) : [];
    return {
      rule: { code: r.code, name: r.name, version: r.version },
      payrollRuns: inRange.length,
      lastUsed: inRange[0] ? { period: inRange[0].period, year: inRange[0].year } : null,
      employees: new Set(payslips.map((p) => p.employeeId)).size,
      totalEmployeeDeduction: round2(payslips.reduce((s, p) => s + toNum(p.payeTax) + toNum(p.nssaDeduction), 0)),
      totalEmployerContribution: round2(payslips.reduce((s, p) => s + toNum(p.employerNssa), 0)),
    };
  }
}
