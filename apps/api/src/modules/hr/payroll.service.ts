import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { companyIdOf } from '../../core/context';

const round2 = (n: number) => Number((Number(n) || 0).toFixed(2));
const toNum = (v: any) => Number(v || 0);
const monthRange = (year: number, period: number) => ({ start: new Date(Date.UTC(year, period - 1, 1)), end: new Date(Date.UTC(year, period, 0, 23, 59, 59)) });

/**
 * Payroll inputs, run details, validation and payment status. Consumes
 * authoritative records from Attendance, Leave, Performance and Employee.
 */
@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ---------- Inputs ----------
  async listInputs(req: any, q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId };
    if (q?.year) where.year = Number(q.year);
    if (q?.period) where.period = Number(q.period);
    if (q?.employeeId) where.employeeId = q.employeeId;
    if (q?.status) where.status = q.status;
    const rows = await this.prisma.payrollInput.findMany({ where, orderBy: [{ year: 'desc' }, { period: 'desc' }, { createdAt: 'desc' }], take: 500 });
    const empIds = Array.from(new Set(rows.map((r) => r.employeeId)));
    const employees = empIds.length ? await this.prisma.employee.findMany({ where: { id: { in: empIds }, companyId }, include: { department: true } }) : [];
    const map = new Map(employees.map((e) => [e.id, e]));
    return rows.map((r) => ({ ...r, quantity: toNum(r.quantity), rate: r.rate != null ? toNum(r.rate) : null, amount: toNum(r.amount), employee: map.get(r.employeeId) || null }));
  }

  /** Aggregate approved overtime, unpaid leave and performance incentives into idempotent PayrollInput rows. */
  async syncInputs(req: any, q: { year: number; period: number }) {
    const companyId = companyIdOf(req.user);
    const year = Number(q.year); const period = Number(q.period);
    if (!year || !period) throw new BadRequestException('year and period are required');
    const { start, end } = monthRange(year, period);
    const employees = await this.prisma.employee.findMany({ where: { companyId }, select: { id: true, basicSalary: true, currency: true } });
    const basicOf = new Map(employees.map((e) => [e.id, toNum(e.basicSalary)]));
    let created = 0;

    // Approved overtime (only approved records may pay).
    const ot = await this.prisma.attendance.findMany({ where: { companyId, approved: true, overtimeHours: { gt: 0 }, date: { gte: start, lte: end } } });
    for (const a of ot) {
      const hours = toNum(a.overtimeHours);
      if (!hours) continue;
      const hourly = round2((basicOf.get(a.employeeId) || 0) / 176);
      const rate = round2(hourly * 1.5);
      created += await this.upsertInput(companyId, { employeeId: a.employeeId, period, year, category: 'OVERTIME', code: 'OVERTIME', description: `${hours} approved hour(s)`, quantity: hours, unit: 'hours', rate, amount: round2(hours * rate), source: 'SYSTEM', sourceType: 'ATTENDANCE', sourceId: a.id, sourceKey: `OT:${a.id}` });
    }

    // Unpaid leave deduction (paid leave does not reduce salary).
    const leaves = await this.prisma.leaveRequest.findMany({ where: { companyId, status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } }, include: { leaveTypeRef: true } });
    for (const l of leaves) {
      if (l.leaveTypeRef?.paid !== false) continue;
      const days = toNum(l.days);
      if (!days) continue;
      const daily = round2((basicOf.get(l.employeeId) || 0) / 22);
      created += await this.upsertInput(companyId, { employeeId: l.employeeId, period, year, category: 'DEDUCTION', code: 'UNPAID_LEAVE', description: `${days} unpaid leave day(s)`, quantity: days, unit: 'days', rate: daily, amount: -round2(days * daily), source: 'SYSTEM', sourceType: 'LEAVE', sourceId: l.id, sourceKey: `UL:${l.id}` });
    }

    // Performance incentives approved/sent for the cycle period.
    const incs = await this.prisma.performanceIncentive.findMany({ where: { companyId, status: { in: ['APPROVED', 'SENT_TO_PAYROLL'] } }, include: { assessment: { include: { cycle: true } } } });
    for (const inc of incs) {
      const pe = inc.assessment?.cycle?.periodEnd ? new Date(inc.assessment.cycle.periodEnd) : null;
      if (!pe || pe.getUTCFullYear() !== year || pe.getUTCMonth() + 1 !== period) continue;
      created += await this.upsertInput(companyId, { employeeId: inc.employeeId, period, year, category: 'BONUS', code: 'PERFORMANCE_BONUS', description: `${inc.reference} · ${inc.planName}`, quantity: 1, rate: null, amount: round2(toNum(inc.amount)), source: 'SYSTEM', sourceType: 'INCENTIVE', sourceId: inc.id, sourceKey: `INC:${inc.id}` });
    }

    await this.audit.log(companyId, req.user.sub, 'PAYROLL_INPUTS_SYNCED', 'PayrollInput', `${year}-${period}`, { module: 'hr', result: 'SUCCESS', metadata: { year, period, created } });
    return { created, year, period };
  }

  private async upsertInput(companyId: string, data: any): Promise<number> {
    const existing = await this.prisma.payrollInput.findFirst({ where: { companyId, sourceKey: data.sourceKey } });
    if (existing) return 0;
    await this.prisma.payrollInput.create({ data: { companyId, ...data } });
    return 1;
  }

  async createInput(req: any, dto: any) {
    const companyId = companyIdOf(req.user);
    if (!dto.employeeId || !dto.period || !dto.year || !dto.code) throw new BadRequestException('Employee, period, year and code are required');
    if (!dto.reason) throw new BadRequestException('A reason is required for manual payroll inputs');
    const amount = Number(dto.amount ?? (Number(dto.quantity || 0) * Number(dto.rate || 0)));
    if (!amount) throw new BadRequestException('A non-zero amount is required');
    const input = await this.prisma.payrollInput.create({
      data: {
        companyId, employeeId: dto.employeeId, period: Number(dto.period), year: Number(dto.year),
        category: dto.category || (amount < 0 ? 'DEDUCTION' : 'EARNING'), code: dto.code, description: dto.description,
        quantity: Number(dto.quantity || 0), unit: dto.unit, rate: dto.rate != null ? Number(dto.rate) : null, amount: round2(amount),
        source: 'MANUAL', sourceType: 'MANUAL', sourceKey: `MAN:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'APPROVED', reason: dto.reason, createdById: req.user.sub,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'PAYROLL_INPUT_CREATED', 'PayrollInput', input.id, { module: 'hr', result: 'SUCCESS', reason: dto.reason, metadata: { employeeId: dto.employeeId, code: dto.code, amount: round2(amount) } });
    return input;
  }

  async voidInput(req: any, id: string, reason?: string) {
    const companyId = companyIdOf(req.user);
    const input = await this.prisma.payrollInput.findFirst({ where: { id, companyId } });
    if (!input) throw new NotFoundException('Payroll input not found');
    if (input.source === 'SYSTEM') throw new BadRequestException('System-generated inputs cannot be voided; correct the source record instead');
    await this.prisma.payrollInput.update({ where: { id }, data: { status: 'VOID', reason: reason || input.reason } });
    await this.audit.log(companyId, req.user.sub, 'PAYROLL_INPUT_CHANGED', 'PayrollInput', id, { module: 'hr', result: 'SUCCESS', reason, metadata: { before: input.status, after: 'VOID' } });
    return { ok: true };
  }

  // ---------- Run detail / validation / summary ----------
  async runDetail(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const run = await this.prisma.payrollRun.findFirst({ where: { id, companyId }, include: { payslips: { include: { employee: { include: { department: true } } } } } });
    if (!run) throw new NotFoundException('Payroll run not found');
    const inputs = await this.prisma.payrollInput.findMany({ where: { companyId, year: run.year, period: run.period }, orderBy: { createdAt: 'desc' } });
    const journal = await this.prisma.journalEntry.findFirst({ where: { companyId, sourceType: 'PAYROLL', sourceId: run.id }, include: { lines: true } });
    const audit = await this.prisma.auditLog.findMany({ where: { companyId, entityType: 'PayrollRun', entityId: run.id }, orderBy: { createdAt: 'asc' }, include: { user: { select: { firstName: true, lastName: true } } } });
    return {
      run: { ...run, totalGross: toNum(run.totalGross), totalDeductions: toNum(run.totalDeductions), totalNet: toNum(run.totalNet), employerCost: toNum(run.employerCost), payslipCount: run.payslips.length },
      payslips: run.payslips.map((p) => ({ ...p, basicSalary: toNum(p.basicSalary), grossPay: toNum(p.grossPay), payeTax: toNum(p.payeTax), nssaDeduction: toNum(p.nssaDeduction), otherDeductions: toNum(p.otherDeductions), netPay: toNum(p.netPay), employeeNssa: toNum(p.employeeNssa), employerNssa: toNum(p.employerNssa), bonusAmount: toNum(p.bonusAmount) })),
      inputs: inputs.map((i) => ({ ...i, quantity: toNum(i.quantity), amount: toNum(i.amount), rate: i.rate != null ? toNum(i.rate) : null })),
      journal: journal ? { id: journal.id, number: journal.number, date: journal.date, lines: journal.lines.map((l) => ({ accountId: l.accountId, debit: toNum(l.debit), credit: toNum(l.credit), description: l.description })) } : null,
      validation: await this.validate(companyId, run),
      audit: audit.map((a) => ({ at: a.createdAt, action: a.action, user: a.user ? `${a.user.firstName} ${a.user.lastName}` : 'System', reason: a.reason, metadata: a.metadata })),
    };
  }

  async validate(companyId: string, run: any) {
    const exceptions: any[] = [];
    const employees = await this.prisma.employee.findMany({ where: { companyId, active: true } });
    for (const e of employees) {
      if (toNum(e.basicSalary) <= 0) exceptions.push({ severity: 'BLOCKING', employee: `${e.firstName} ${e.lastName}`, employeeId: e.id, exception: 'Missing basic salary', source: 'Employee', blocking: true, fix: 'EMPLOYEE' });
      const bank: any = e.bankDetails || {};
      if (!bank.accountNumber && !bank.accountNo) exceptions.push({ severity: 'WARNING', employee: `${e.firstName} ${e.lastName}`, employeeId: e.id, exception: 'No bank/payment method configured', source: 'Employee', blocking: false, fix: 'EMPLOYEE' });
    }
    const payslips = await this.prisma.payslip.findMany({ where: { payrollRunId: run.id } });
    for (const p of payslips) {
      if (toNum(p.netPay) < 0) exceptions.push({ severity: 'BLOCKING', employeeId: p.employeeId, exception: 'Negative net pay', source: 'Payroll', blocking: true, fix: 'PAYROLL' });
    }
    const { start, end } = monthRange(run.year, run.period);
    const unapprovedOt = await this.prisma.attendance.count({ where: { companyId, approved: false, overtimeHours: { gt: 0 }, date: { gte: start, lte: end } } });
    if (unapprovedOt) exceptions.push({ severity: 'WARNING', exception: `${unapprovedOt} unapproved overtime record(s) will not be paid`, source: 'Attendance', blocking: false, fix: 'ATTENDANCE' });
    const pendingInc = await this.prisma.performanceIncentive.count({ where: { companyId, status: 'APPROVED' } });
    if (pendingInc) exceptions.push({ severity: 'WARNING', exception: `${pendingInc} approved incentive(s) not yet sent to payroll`, source: 'Performance', blocking: false, fix: 'PERFORMANCE' });
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { companyId, periodNumber: run.period, year: { year: run.year } } });
    if (period?.status === 'CLOSED') exceptions.push({ severity: 'BLOCKING', exception: `Financial period ${run.period}/${run.year} is closed`, source: 'Finance', blocking: true, fix: 'PERIOD' });
    return { exceptions, blocking: exceptions.filter((e) => e.blocking).length, warnings: exceptions.filter((e) => !e.blocking).length };
  }

  async runValidation(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const run = await this.prisma.payrollRun.findFirst({ where: { id, companyId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    return this.validate(companyId, run);
  }

  async summary(req: any) {
    const companyId = companyIdOf(req.user);
    const runs = await this.prisma.payrollRun.findMany({ where: { companyId }, orderBy: [{ year: 'desc' }, { period: 'desc' }] });
    const current = runs[0] || null;
    const unpaid = runs.filter((r) => r.paymentStatus !== 'PAID');
    return {
      current: current ? { period: current.period, year: current.year, status: current.status } : null,
      totalGross: round2(runs.reduce((s, r) => s + toNum(r.totalGross), 0)),
      totalNet: round2(runs.reduce((s, r) => s + toNum(r.totalNet), 0)),
      unpaidNet: round2(unpaid.reduce((s, r) => s + toNum(r.totalNet), 0)),
      runs: runs.length,
    };
  }

  // ---------- Statutory rules (per-employee resolution) ----------
  /** Rules applicable to an employee on a date, respecting company payroll country + exemptions. */
  async resolveApplicableRules(companyId: string, employee: any, date: Date) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { payrollCountry: true } });
    const country = company?.payrollCountry || 'ZW';
    const exemptions: string[] = Array.isArray(employee?.statutoryExemptions) ? (employee.statutoryExemptions as string[]) : [];
    const rules = await this.prisma.statutoryRule.findMany({
      where: { country, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
      orderBy: { validFrom: 'desc' },
    });
    const byCode = new Map<string, any>();
    for (const r of rules) if (!byCode.has(r.code)) byCode.set(r.code, r);
    return Array.from(byCode.values()).filter((r) => !exemptions.includes(r.code));
  }

  private amountFor(rule: any, base: number, side: 'employee' | 'employer'): number {
    const rate = toNum(side === 'employee' ? rule.employeeRate : rule.employerRate);
    const cfg: any = rule.configuration || {};
    const method = rule.calculationMethod || 'PERCENTAGE';
    let amount = 0;
    if (method === 'FIXED') amount = toNum(cfg.fixedAmount);
    else if (method === 'PROGRESSIVE') {
      for (const b of cfg.brackets || []) {
        const from = toNum(b.from); const to = b.to == null ? Infinity : toNum(b.to);
        if (base > from) amount += (Math.min(base, to) - from) * toNum(b.rate);
      }
    } else if (method === 'THRESHOLD_PERCENTAGE') {
      amount = Math.max(0, base - toNum(cfg.threshold)) * rate;
    } else {
      const cap = toNum(rule.maxInsurableEarnings);
      const capped = cap > 0 ? Math.min(base, cap) : base;
      amount = capped * rate;
    }
    const min = toNum(side === 'employee' ? rule.employeeMin : rule.employerMin);
    const max = toNum(side === 'employee' ? rule.employeeMax : rule.employerMax);
    if (min > 0) amount = Math.max(amount, min);
    if (max > 0) amount = Math.min(amount, max);
    return round2(amount);
  }

  /** Compute all applicable statutory deductions/contributions for one employee. */
  async computeStatutory(companyId: string, employee: any, gross: number, date: Date) {
    const rules = await this.resolveApplicableRules(companyId, employee, date);
    const basic = toNum(employee?.basicSalary);
    const lines: any[] = [];
    let paye = 0, employeeNssa = 0, employerNssa = 0, otherEmployee = 0, otherEmployer = 0;
    for (const r of rules) {
      const base = r.calculationBase === 'BASIC' ? basic : gross; // GROSS / TAXABLE / PENSIONABLE default to gross
      const emp = r.employeeEnabled ? this.amountFor(r, base, 'employee') : 0;
      const empr = r.employerEnabled ? this.amountFor(r, base, 'employer') : 0;
      if (!emp && !empr) continue;
      lines.push({ code: r.code, name: r.name, ruleType: r.ruleType, employee: emp, employer: empr, employeeGlAccount: r.employeeGlAccount, employerLiabilityGlAccount: r.employerLiabilityGlAccount, employerExpenseGlAccount: r.employerExpenseGlAccount });
      if (r.code === 'PAYE' || r.ruleType === 'INCOME_TAX') paye += emp;
      else if (r.code === 'NSSA' || r.ruleType === 'SOCIAL_SECURITY') { employeeNssa += emp; employerNssa += empr; }
      else { otherEmployee += emp; otherEmployer += empr; }
    }
    return {
      paye: round2(paye), employeeNssa: round2(employeeNssa), employerNssa: round2(employerNssa),
      otherEmployee: round2(otherEmployee), otherEmployer: round2(otherEmployer),
      employeeTotal: round2(paye + employeeNssa + otherEmployee), employerTotal: round2(employerNssa + otherEmployer), lines,
      payeConfigured: rules.some((r) => r.code === 'PAYE' || r.ruleType === 'INCOME_TAX'),
    };
  }

  // ---------- Company payroll profile ----------
  async companyPayrollProfile(req: any) {
    const companyId = companyIdOf(req.user);
    const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, legalName: true, payrollCountry: true, payrollCurrency: true, baseCurrency: true } });
    return c;
  }

  async updateCompanyPayrollProfile(req: any, dto: { payrollCountry?: string; payrollCurrency?: string }) {
    const companyId = companyIdOf(req.user);
    const c = await this.prisma.company.update({ where: { id: companyId }, data: { payrollCountry: dto.payrollCountry, payrollCurrency: dto.payrollCurrency } });
    await this.audit.log(companyId, req.user.sub, 'PAYROLL_COMPANY_PROFILE_UPDATED', 'Company', companyId, { module: 'hr', result: 'SUCCESS', metadata: { payrollCountry: c.payrollCountry, payrollCurrency: c.payrollCurrency } });
    return c;
  }

  // ---------- Employee statutory profile ----------
  async employeeStatutoryProfile(req: any, employeeId: string) {
    const companyId = companyIdOf(req.user);
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');
    const exemptions: string[] = Array.isArray(employee.statutoryExemptions) ? (employee.statutoryExemptions as string[]) : [];
    const rules = await this.resolveApplicableRules(companyId, { ...employee, statutoryExemptions: [] }, new Date());
    const all = await this.prisma.statutoryRule.findMany({ where: { country: (await this.prisma.company.findUnique({ where: { id: companyId }, select: { payrollCountry: true } }))?.payrollCountry || 'ZW' }, orderBy: { code: 'asc' } });
    const byCode = new Map<string, any>();
    for (const r of all) if (!byCode.has(r.code)) byCode.set(r.code, r);
    return {
      employee: { id: employee.id, employeeNo: employee.employeeNo, name: `${employee.firstName} ${employee.lastName}` },
      rules: Array.from(byCode.values()).map((r) => ({ code: r.code, name: r.name, ruleType: r.ruleType, exempt: exemptions.includes(r.code), applies: !exemptions.includes(r.code) && rules.some((x) => x.code === r.code) })),
      exemptions,
    };
  }

  async setEmployeeExemptions(req: any, employeeId: string, codes: string[], reason?: string) {
    const companyId = companyIdOf(req.user);
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');
    await this.prisma.employee.update({ where: { id: employeeId }, data: { statutoryExemptions: Array.isArray(codes) ? codes : [] } });
    await this.audit.log(companyId, req.user.sub, 'PAYROLL_EXEMPTION_CHANGED', 'Employee', employeeId, { module: 'hr', result: 'SUCCESS', reason, metadata: { before: employee.statutoryExemptions, after: codes } });
    return this.employeeStatutoryProfile(req, employeeId);
  }

  // ---------- Payment ----------
  async recordPayment(req: any, id: string, dto: { payDate?: string; method?: string; reference?: string; note?: string }) {
    const companyId = companyIdOf(req.user);
    const run = await this.prisma.payrollRun.findFirst({ where: { id, companyId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (!['PROCESSED', 'FINALISED', 'LOCKED'].includes(run.status)) throw new BadRequestException('Payroll must be processed/finalised before recording a payment');
    if (run.paymentStatus === 'PAID') throw new BadRequestException('Payroll is already marked as paid');
    await this.prisma.payrollRun.update({ where: { id }, data: { paymentStatus: 'PAID', payDate: dto.payDate ? new Date(dto.payDate) : run.payDate, notes: dto.note ?? run.notes } });
    await this.audit.log(companyId, req.user.sub, 'PAYROLL_PAYMENT_CONFIRMED', 'PayrollRun', id, { module: 'hr', result: 'SUCCESS', reason: dto.note, metadata: { method: dto.method || 'BANK', reference: dto.reference, amount: toNum(run.totalNet) } });
    return this.prisma.payrollRun.findUnique({ where: { id } });
  }
}
