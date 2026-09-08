import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { companyIdOf } from '../../core/context';

const round2 = (n: number) => Number(n.toFixed(2));
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

@Injectable()
export class HrService {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService) {}

  private companyOf(req: any) { return companyIdOf(req.user); }

  async dayName(d: Date) { return DAYS[d.getDay()]; }

  // ---------- Work calendars ----------
  private weekendSet(weekendDays: any): Set<number> {
    const days = Array.isArray(weekendDays) && weekendDays.length ? weekendDays : ['SATURDAY', 'SUNDAY'];
    const out = new Set<number>();
    for (const d of days) { const i = DAYS.indexOf(d); if (i >= 0) out.add(i); }
    return out;
  }

  async getWorkCalendar(workCalendarId?: string | null) {
    if (workCalendarId) {
      const cal = await this.prisma.workCalendar.findUnique({ where: { id: workCalendarId } });
      if (cal) return cal;
    }
    // default: Mon-Fri
    return { weekendDays: ['SATURDAY', 'SUNDAY'] };
  }

  async getCompanyHolidays(companyId: string, start: Date, end: Date) {
    const holidays = await this.prisma.holiday.findMany({
      where: { companyId, active: true, recurring: false, date: { gte: new Date(start.getTime()), lte: new Date(end.getTime()) } },
      select: { date: true, name: true },
    });
    const set = new Set(holidays.map((h) => new Date(h.date).toISOString().slice(0, 10)));
    // recurring holidays (occur on same date every year between range)
    const rec = await this.prisma.holiday.findMany({ where: { companyId, active: true, recurring: true }, select: { date: true, name: true } });
    for (const h of rec) {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dt = new Date(d);
        if (dt.getDate() === new Date(h.date).getDate() && dt.getMonth() === new Date(h.date).getMonth()) set.add(dt.toISOString().slice(0, 10));
      }
    }
    return set;
  }

  // ---------- Leave calculation (authoritative) ----------
  async calculateLeaveDays(companyId: string, start: Date, end: Date, workCalendar?: any, halfDay?: string) {
    if (end < start) throw new BadRequestException('End date cannot be before start date');
    const cal = workCalendar || await this.getWorkCalendar();
    const weekend = this.weekendSet(cal.weekendDays);
    const holidays = await this.getCompanyHolidays(companyId, start, end);
    let days = 0;
    const workingDays: Date[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dt = new Date(d);
      const key = dt.toISOString().slice(0, 10);
      if (weekend.has(dt.getDay())) continue;
      if (holidays.has(key)) continue;
      workingDays.push(dt);
      days += 1;
    }
    let result = days;
    const half = (halfDay || 'FULL').toUpperCase();
    if (half !== 'FULL' && workingDays.length) {
      // half day applies to first working day for MORNING, last for AFTERNOON
      result = days - 0.5;
    }
    return { days: round2(result), workingDays: workingDays.map((d) => d.toISOString()), weekendCount: 0, holidayCount: 0 };
  }

  // ---------- Leave balances ----------
  async getLeaveBalances(companyId: string, employeeId: string) {
    const leaveTypes = await this.prisma.leaveType.findMany({ where: { companyId, active: true } });
    const balances = await this.prisma.leaveBalance.findMany({ where: { companyId, employeeId } });
    const approved = await this.prisma.leaveRequest.findMany({ where: { companyId, employeeId, status: 'APPROVED' }, select: { leaveType: true, leaveTypeId: true, days: true } });
    const pending = await this.prisma.leaveRequest.findMany({ where: { companyId, employeeId, status: { in: ['PENDING', 'SUBMITTED', 'PENDING_APPROVAL'] } }, select: { leaveType: true, leaveTypeId: true, days: true } });
    const map = new Map<string, { entitled: number; used: number; pending: number; available: number }>();
    for (const t of leaveTypes) {
      const bal = Number(balances.find((b) => b.leaveTypeId === t.id)?.balance || 0);
      map.set(t.id, { entitled: t.daysPerYear, used: 0, pending: 0, available: t.daysPerYear + bal });
    }
    const byType = (arr: any[]) => arr.reduce((acc, r) => {
      const key = r.leaveTypeId || r.leaveType;
      acc[key] = (acc[key] || 0) + Number(r.days);
      return acc;
    }, {} as Record<string, number>);
    for (const b of approved) { const key = (b.leaveTypeId ?? b.leaveType) as string; const entry = map.get(key); if (entry) { entry.used += Number(b.days); entry.available -= Number(b.days); } }
    for (const b of pending) { const key = (b.leaveTypeId ?? b.leaveType) as string; const entry = map.get(key); if (entry) { entry.pending += Number(b.days); entry.available -= Number(b.days); } }
    return leaveTypes.map((t) => {
      const e = map.get(t.id) || { entitled: 0, used: 0, pending: 0, available: 0 };
      return { leaveTypeId: t.id, code: t.code, name: t.name, entitled: e.entitled, used: round2(e.used), pending: round2(e.pending), available: round2(e.available) };
    });
  }

  // ---------- Compensation history ----------
  async changeCompensation(req: any, employeeId: string, dto: any) {
    const companyId = this.companyOf(req);
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!emp) throw new BadRequestException('Employee not found');
    const effDate = new Date(dto.effectiveDate);
    const hist = await this.prisma.compensationHistory.create({
      data: { companyId, employeeId, effectiveDate: effDate, baseSalary: dto.baseSalary, currency: dto.currency || emp.currency, payFrequency: dto.payFrequency || emp.payFrequency, compensationType: dto.compensationType || emp.compensationType || 'SALARIED', reason: dto.reason, approvedById: req.user.sub },
    });
    await this.prisma.employee.update({ where: { id: employeeId }, data: { basicSalary: dto.baseSalary, currency: dto.currency || emp.currency, payFrequency: dto.payFrequency || emp.payFrequency, compensationType: dto.compensationType || emp.compensationType } });
    await this.audit.log(companyId, req.user.sub, 'COMP_CHANGE', 'Employee', employeeId, { effectiveDate: dto.effectiveDate, baseSalary: dto.baseSalary, reason: dto.reason });
    return hist;
  }

  async getCompensationHistory(companyId: string, employeeId: string) {
    return this.prisma.compensationHistory.findMany({ where: { companyId, employeeId }, orderBy: { effectiveDate: 'desc' } });
  }

  // ---------- Employment history ----------
  async recordEmploymentChange(req: any, employeeId: string, data: { changeType: string; field?: string; previousValue?: string; newValue?: string; reason?: string }) {
    const companyId = this.companyOf(req);
    const hist = await this.prisma.employmentHistory.create({ data: { companyId, employeeId, effectiveDate: new Date(), changeType: data.changeType, field: data.field, previousValue: data.previousValue, newValue: data.newValue, reason: data.reason, changedById: req.user.sub } });
    await this.audit.log(companyId, req.user.sub, data.changeType, 'Employee', employeeId, { field: data.field, from: data.previousValue, to: data.newValue });
    return hist;
  }

  async getEmploymentHistory(companyId: string, employeeId: string) {
    return this.prisma.employmentHistory.findMany({ where: { companyId, employeeId }, orderBy: { effectiveDate: 'desc' } });
  }

  // ---------- Performance ----------
  async createPerformanceReview(req: any, dto: any) {
    const companyId = this.companyOf(req);
    const goals = dto.goals || [];
    const weights = goals.reduce((s: number, g: any) => s + Number(g.weight || 0), 0);
    if (goals.length && Math.abs(weights - 100) > 0.01) throw new BadRequestException('Total goal/KPI weights must equal 100%');
    const review = await this.prisma.performanceReview.create({ data: { companyId, cycleId: dto.cycleId, employeeId: dto.employeeId, reviewerId: req.user.sub, selfReview: dto.selfReview, managerReview: dto.managerReview, goals, overallRating: dto.overallRating, comments: dto.comments, status: 'OPEN' } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'PerformanceReview', review.id, { employeeId: dto.employeeId });
    return review;
  }

  async getPerformanceStatus(companyId: string, employeeId: string) {
    const cycle = await this.prisma.performanceCycle.findFirst({ where: { companyId, status: { in: ['OPEN', 'SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION'] } }, orderBy: { startDate: 'desc' } });
    const reviews = await this.prisma.performanceReview.findMany({ where: { companyId, employeeId }, include: { cycle: true }, orderBy: { createdAt: 'desc' } });
    return { currentCycle: cycle || null, reviews };
  }

  // ---------- QA ----------
  async computeQaScore(scores: any): Promise<number> {
    const entries = Array.isArray(scores) ? scores : Object.entries(scores || {}).map(([k, v]: any) => ({ score: v.score, weight: v.weight }));
    let weighted = 0, totalWeight = 0;
    for (const e of entries) {
      const w = Number(e.weight || 1);
      weighted += Number(e.score || 0) * w;
      totalWeight += w;
    }
    return totalWeight ? round2(weighted / totalWeight) : 0;
  }

  async createQaAssessment(req: any, dto: any) {
    const companyId = this.companyOf(req);
    const overall = dto.overallScore != null ? Number(dto.overallScore) : await this.computeQaScore(dto.scores);
    const assessment = await this.prisma.qaAssessment.create({ data: { companyId, templateId: dto.templateId, employeeId: dto.employeeId, reviewerId: dto.reviewerId || req.user.sub, workReference: dto.workReference, scores: dto.scores, overallScore: overall, findings: dto.findings, comments: dto.comments, correctiveActions: dto.correctiveActions } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'QaAssessment', assessment.id, { employeeId: dto.employeeId, overallScore: overall });
    return assessment;
  }

  // ---------- Incentives ----------
  async createIncentive(req: any, dto: any) {
    const companyId = this.companyOf(req);
    const incentive = await this.prisma.employeeIncentive.create({ data: { companyId, planId: dto.planId, employeeId: dto.employeeId, period: dto.period, amount: dto.amount, status: 'PROPOSED', notes: dto.notes } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'EmployeeIncentive', incentive.id, { employeeId: dto.employeeId, amount: dto.amount });
    return incentive;
  }

  async approveIncentive(req: any, id: string) {
    const companyId = this.companyOf(req);
    const inc = await this.prisma.employeeIncentive.findFirst({ where: { id, companyId } });
    if (!inc) throw new BadRequestException('Incentive not found');
    if (!['PROPOSED', 'PENDING_APPROVAL'].includes(inc.status)) throw new BadRequestException('Incentive is not awaiting approval');
    const updated = await this.prisma.employeeIncentive.update({ where: { id }, data: { status: 'APPROVED', approvedById: req.user.sub, approvedAt: new Date() } });
    await this.audit.log(companyId, req.user.sub, 'APPROVE', 'EmployeeIncentive', id, { amount: inc.amount });
    return updated;
  }

  // ---------- Attendance ----------
  async calculateAttendance(companyId: string, employeeId: string, date: Date, checkIn?: Date, checkOut?: Date, opts?: { scheduledStart?: string; scheduledEnd?: string; breakMinutes?: number; status?: string }) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, include: { workCalendar: true } });
    if (!emp) throw new BadRequestException('Employee not found');
    const cal = emp.workCalendar;
    const schedStart = opts?.scheduledStart || cal?.scheduledStart || '08:00';
    const schedEnd = opts?.scheduledEnd || cal?.scheduledEnd || '17:00';
    const breakMin = opts?.breakMinutes != null ? opts.breakMinutes : (cal?.breakMinutes ?? 0);
    const status = opts?.status || 'PRESENT';

    let workedHours = 0; let regularHours = 0; let overtimeHours = 0; let lateMinutes = 0; let earlyDeparture = 0;
    if (checkIn && checkOut) {
      const raw = (checkOut.getTime() - checkIn.getTime()) / 3600000;
      workedHours = round2(Math.max(0, raw - breakMin / 60));
      const sS = this.toMin(schedStart); const sE = this.toMin(schedEnd);
      const scheduledLenHours = Math.max(0, (sE - sS - breakMin) / 60); // net scheduled hours
      const schedEndVal = this.dateWithTime(checkOut, schedEnd);
      const schedStartVal = this.dateWithTime(checkIn, schedStart);
      if (checkIn > schedStartVal) lateMinutes = Math.round((checkIn.getTime() - schedStartVal.getTime()) / 60000);
      if (checkOut < schedEndVal) earlyDeparture = Math.round((schedEndVal.getTime() - checkOut.getTime()) / 60000);
      regularHours = round2(Math.min(workedHours, scheduledLenHours));
      overtimeHours = round2(Math.max(0, workedHours - scheduledLenHours));
    }
    return { workedHours, regularHours, overtimeHours, lateMinutes, earlyDeparture, scheduledStart: schedStart, scheduledEnd: schedEnd, breakMinutes: breakMin, status };
  }

  private toMin(t: string): number { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
  private dateWithTime(base: Date, t: string): Date { const d = new Date(base); const m = /(\d{1,2}):(\d{2})/.exec(t || ''); if (m) { d.setHours(Number(m[1]), Number(m[2]), 0, 0); } return d; }

  async getAttendanceExceptions(companyId: string) {
    const records = await this.prisma.attendance.findMany({ where: { companyId }, include: { employee: true }, orderBy: { date: 'desc' }, take: 500 });
    const ex: any[] = [];
    for (const r of records) {
      if (!r.checkIn) ex.push({ ...r, exception: 'MISSING_CLOCK_IN' });
      else if (!r.checkOut) ex.push({ ...r, exception: 'MISSING_CLOCK_OUT' });
      else if (Number(r.lateMinutes) > 0) ex.push({ ...r, exception: 'LATE_ARRIVAL' });
      else if (Number(r.overtimeHours) > 0 && !r.approved) ex.push({ ...r, exception: 'UNAPPROVED_OVERTIME' });
      else if (Number(r.earlyDeparture) > 0) ex.push({ ...r, exception: 'EARLY_DEPARTURE' });
      else if (r.status === 'ABSENT') ex.push({ ...r, exception: 'ABSENCE' });
    }
    return ex;
  }

  async attendanceSummary(companyId: string, from: Date, to: Date) {
    const records = await this.prisma.attendance.findMany({ where: { companyId, date: { gte: from, lte: to } }, include: { employee: true }, orderBy: { date: 'asc' } });
    let totalWorked = 0, totalOvertime = 0, totalRegular = 0, totalLate = 0;
    for (const r of records) {
      totalWorked += Number(r.workedHours); totalRegular += Number(r.regularHours); totalOvertime += Number(r.overtimeHours); totalLate += Number(r.lateMinutes);
    }
    const byEmployee = records.reduce((acc, r) => {
      const key = r.employeeId;
      if (!acc[key]) acc[key] = { employeeId: key, employee: r.employee, workedHours: 0, overtimeHours: 0, regularHours: 0, lateMinutes: 0, days: 0 };
      const a = acc[key];
      a.workedHours = round2(a.workedHours + Number(r.workedHours)); a.overtimeHours = round2(a.overtimeHours + Number(r.overtimeHours)); a.regularHours = round2(a.regularHours + Number(r.regularHours)); a.lateMinutes += Number(r.lateMinutes); a.days += 1;
      return acc;
    }, {} as Record<string, any>);
    return { totals: { workedHours: round2(totalWorked), regularHours: round2(totalRegular), overtimeHours: round2(totalOvertime), lateMinutes: totalLate, records: records.length }, byEmployee: Object.values(byEmployee) };
  }

  // ---------- Dashboard ----------
  async dashboard(req: any) {
    const companyId = this.companyOf(req);
    const [active, pendingLeave, currentPayroll, reviewsDue] = await Promise.all([
      this.prisma.employee.count({ where: { companyId, active: true } }),
      this.prisma.leaveRequest.count({ where: { companyId, status: { in: ['PENDING', 'SUBMITTED', 'PENDING_APPROVAL'] } } }),
      this.prisma.payrollRun.findFirst({ where: { companyId, status: { in: ['DRAFT', 'CALCULATED', 'UNDER_REVIEW', 'APPROVED'] } }, orderBy: [{ year: 'desc' }, { period: 'desc' }] }),
      this.prisma.performanceReview.count({ where: { companyId, status: { in: ['OPEN', 'SELF_REVIEW', 'MANAGER_REVIEW'] } } }),
    ]);
    return {
      active,
      pendingLeave,
      currentPayroll: currentPayroll || null,
      reviewsDue,
      grossPayroll: await this.prisma.payrollRun.aggregate({ where: { companyId }, _sum: { totalGross: true } }),
      headcountByDepartment: await this.prisma.employee.groupBy({ by: ['departmentId'], where: { companyId, active: true }, _count: true }),
    };
  }
}
