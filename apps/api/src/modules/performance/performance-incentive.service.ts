import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { NumberingService } from '../../core/common/numbering.service';
import { round2 } from './performance.constants';

type AnyReq = { user: { sub: string; companyId?: string } };

@Injectable()
export class PerformanceIncentiveService {
  constructor(private prisma: PrismaService, private audit: AuditService, private numbering: NumberingService) {}

  // ---------- Plans ----------
  listPlans(companyId: string) {
    return this.prisma.incentivePlan.findMany({ where: { companyId }, orderBy: { name: 'asc' }, include: { _count: { select: { performanceIncentives: true } } } });
  }

  async createPlan(req: AnyReq, dto: any) {
    const companyId = req.user.companyId!;
    const plan = await this.prisma.incentivePlan.create({
      data: {
        companyId, name: dto.name, eligibility: dto.eligibility || null, departmentId: dto.departmentId || null,
        calculation: {
          minScore: dto.minScore ?? null, maxScore: dto.maxScore ?? null, band: dto.band || null,
          calcType: dto.calcType || 'PERCENT_SALARY', percentValue: dto.percentValue ?? null, fixedAmount: dto.fixedAmount ?? null,
        } as any,
        threshold: dto.minScore ?? null, maxPayout: dto.maxPayout ?? null, payrollComponent: dto.payrollComponent || 'PERFORMANCE_BONUS',
        status: dto.status || 'ACTIVE',
      },
    });
    await this.audit.log(companyId, req.user.sub, 'INCENTIVE_PLAN_CREATED', 'IncentivePlan', plan.id, { name: dto.name });
    return plan;
  }

  async updatePlan(req: AnyReq, id: string, dto: any) {
    const companyId = req.user.companyId!;
    const plan = await this.prisma.incentivePlan.findFirst({ where: { id, companyId } });
    if (!plan) throw new NotFoundException('Incentive plan not found');
    const data: any = {};
    if (dto.name != null) data.name = dto.name;
    if (dto.eligibility !== undefined) data.eligibility = dto.eligibility;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId || null;
    if (dto.minScore != null || dto.maxScore != null || dto.band != null || dto.calcType != null || dto.percentValue != null || dto.fixedAmount != null) {
      const calc = (plan.calculation as any) || {};
      data.calculation = {
        minScore: dto.minScore ?? calc.minScore ?? null, maxScore: dto.maxScore ?? calc.maxScore ?? null,
        band: dto.band ?? calc.band ?? null, calcType: dto.calcType ?? calc.calcType ?? 'PERCENT_SALARY',
        percentValue: dto.percentValue ?? calc.percentValue ?? null, fixedAmount: dto.fixedAmount ?? calc.fixedAmount ?? null,
      };
      data.threshold = dto.minScore ?? calc.minScore ?? null;
    }
    if (dto.maxPayout !== undefined) data.maxPayout = dto.maxPayout;
    if (dto.payrollComponent != null) data.payrollComponent = dto.payrollComponent;
    if (dto.status != null) data.status = dto.status;
    await this.audit.log(companyId, req.user.sub, 'INCENTIVE_PLAN_UPDATED', 'IncentivePlan', id, { fields: Object.keys(data) });
    return this.prisma.incentivePlan.update({ where: { id }, data });
  }

  /** Evaluate the incentive band table for a score. Percent of base salary. */
  resolvePlanForScore(plans: any[], score: number): { plan: any; percentValue: number | null; fixedAmount: number | null } | null {
    for (const plan of plans) {
      const c = (plan.calculation as any) || {};
      const min = c.minScore == null ? null : Number(c.minScore);
      const max = c.maxScore == null ? null : Number(c.maxScore);
      if (min != null && score < min) continue;
      if (max != null && score > max) continue;
      return { plan, percentValue: c.percentValue != null ? Number(c.percentValue) : null, fixedAmount: c.fixedAmount != null ? Number(c.fixedAmount) : null };
    }
    return null;
  }

  list(companyId: string, filters: { status?: string; cycleId?: string }) {
    return this.prisma.performanceIncentive.findMany({
      where: { companyId, ...(filters.status ? { status: { in: String(filters.status).split(',') } } : {}), ...(filters.cycleId ? { assessment: { cycleId: filters.cycleId } } : {}) },
      include: { employee: { include: { department: true } }, assessment: { include: { cycle: { select: { name: true } } } }, plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Run incentive eligibility for a cycle: for every APPROVED assessment,
   * propose an incentive from the matching plan (never pays directly).
   */
  async runEligibility(req: AnyReq, cycleId: string) {
    const companyId = req.user.companyId!;
    const approved = await this.prisma.employeePerformanceAssessment.findMany({
      where: { companyId, cycleId, status: { in: ['APPROVED', 'COMPLETED', 'LOCKED'] }, excludedReason: null, totalScore: { not: null } },
      include: { employee: { include: { department: true } }, incentive: true, cycle: true },
    });
    const plans = await this.prisma.incentivePlan.findMany({ where: { companyId, status: 'ACTIVE' } });
    const created: any[] = [];
    const skipped: { employee: string; reason: string }[] = [];

    for (const a of approved) {
      if (a.incentive) { skipped.push({ employee: `${a.employee.firstName} ${a.employee.lastName}`, reason: 'Incentive already proposed' }); continue; }
      const score = Number(a.totalScore!);
      const match = this.resolvePlanForScore(plans, score);
      if (!match) { skipped.push({ employee: `${a.employee.firstName} ${a.employee.lastName}`, reason: `No incentive plan matches score ${score}%` }); continue; }
      if (match.plan.departmentId && a.employee.departmentId !== match.plan.departmentId) { skipped.push({ employee: `${a.employee.firstName} ${a.employee.lastName}`, reason: 'Plan scoped to another department' }); continue; }

      let amount = 0;
      const c = match.plan.calculation as any;
      if (c?.calcType === 'PERCENT_SALARY') amount = round2((Number(a.employee.basicSalary) * Number(c.percentValue || 0)) / 100);
      else if (c?.calcType === 'FIXED') amount = round2(Number(c.fixedAmount || 0));
      else if (c?.calcType === 'CUSTOM') amount = 0; // approved amount entered at approval time
      if (match.plan.maxPayout && amount > Number(match.plan.maxPayout)) amount = round2(Number(match.plan.maxPayout));

      const reference = await this.numbering.next(companyId, 'INC');
      const inc = await this.prisma.performanceIncentive.create({
        data: {
          companyId, reference, assessmentId: a.id, employeeId: a.employeeId, planId: match.plan.id, planName: match.plan.name,
          finalScore: score, band: a.band, calculationType: c?.calcType || 'PERCENT_SALARY', percentValue: match.percentValue,
          amount, currency: a.employee.currency || 'USD', status: 'PENDING_APPROVAL',
        },
      });
      created.push(inc);
      await this.audit.log(companyId, req.user.sub, 'INCENTIVE_PROPOSED', 'PerformanceIncentive', inc.id, { reference, employeeId: a.employeeId, score, amount });
    }
    return { proposed: created.length, proposals: created, skipped };
  }

  /** Custom approved amount (PERCENT/override) before approval. */
  async setAmount(req: AnyReq, id: string, amount: number, notes?: string) {
    const companyId = req.user.companyId!;
    const inc = await this.prisma.performanceIncentive.findFirst({ where: { id, companyId } });
    if (!inc) throw new NotFoundException('Incentive not found');
    if (inc.status !== 'PENDING_APPROVAL') throw new BadRequestException('Only pending incentives can be adjusted');
    await this.prisma.performanceIncentive.update({ where: { id }, data: { amount: round2(amount), ...(notes ? { assessment: undefined as any } : {}) } });
    await this.audit.log(companyId, req.user.sub, 'INCENTIVE_AMOUNT_UPDATED', 'PerformanceIncentive', id, { from: inc.amount, to: round2(amount), notes });
    return this.prisma.performanceIncentive.findUnique({ where: { id }, include: { employee: true, assessment: { include: { cycle: true } }, plan: true } });
  }

  async approve(req: AnyReq, id: string, dto: { comment?: string }) {
    const companyId = req.user.companyId!;
    const inc = await this.prisma.performanceIncentive.findFirst({ where: { id, companyId }, include: { employee: true, assessment: { include: { cycle: true } } } });
    if (!inc) throw new NotFoundException('Incentive not found');
    if (inc.status !== 'PENDING_APPROVAL') throw new BadRequestException('Incentive is not awaiting approval');
    if (Number(inc.amount) <= 0) throw new BadRequestException('Set a positive incentive amount before approval');
    await this.prisma.performanceIncentive.update({ where: { id }, data: { status: 'APPROVED', approvedById: req.user.sub, approvedAt: new Date() } });
    await this.audit.log(companyId, req.user.sub, 'INCENTIVE_APPROVED', 'PerformanceIncentive', id, { reference: inc.reference, amount: inc.amount, comment: dto.comment });
    return this.prisma.performanceIncentive.findUnique({ where: { id }, include: { employee: true, assessment: { include: { cycle: true } }, plan: true } });
  }

  async reject(req: AnyReq, id: string, reason: string) {
    const companyId = req.user.companyId!;
    const inc = await this.prisma.performanceIncentive.findFirst({ where: { id, companyId } });
    if (!inc) throw new NotFoundException('Incentive not found');
    if (!['PENDING_APPROVAL', 'APPROVED'].includes(inc.status)) throw new BadRequestException('Incentive can no longer be rejected');
    await this.prisma.performanceIncentive.update({ where: { id }, data: { status: 'REJECTED', rejectionReason: reason } });
    await this.audit.log(companyId, req.user.sub, 'INCENTIVE_REJECTED', 'PerformanceIncentive', id, { reference: inc.reference, reason });
    return this.prisma.performanceIncentive.findUnique({ where: { id } });
  }
}
