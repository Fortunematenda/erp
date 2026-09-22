import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { companyIdOf } from '../../core/context';

const round2 = (n: number) => Number((Number(n) || 0).toFixed(2));
const toNum = (v: any) => Number(v || 0);
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const dateOnly = (d: Date | string) => { const x = new Date(d); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())); };
const key = (d: Date | string) => dateOnly(d).toISOString().slice(0, 10);
const ACTIVE_LEAVE_STATUSES = ['PENDING', 'APPROVED', 'SUBMITTED', 'PENDING_APPROVAL', 'DRAFT'];

/**
 * Authoritative leave calculation, balance and workflow service. All leave
 * numbers (request, calendar, balance, employee details) must come from here.
 */
@Injectable()
export class LeaveService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ---------- Financial year (single source of truth = Finance) ----------
  async currentFinancialYear(companyId: string) {
    const years = await this.prisma.financialYear.findMany({ where: { companyId }, include: { periods: { orderBy: { periodNumber: 'asc' } } }, orderBy: { year: 'desc' } });
    if (!years.length) {
      const y = new Date().getFullYear();
      return { id: null, year: y, label: `FY${y}`, startDate: new Date(Date.UTC(y, 0, 1)), endDate: new Date(Date.UTC(y, 11, 31)) };
    }
    const today = new Date();
    const current = years.find((y) => y.periods.some((p) => new Date(p.startDate) <= today && new Date(p.endDate) >= today)) || years[0];
    const starts = current.periods.map((p) => new Date(p.startDate).getTime());
    const ends = current.periods.map((p) => new Date(p.endDate).getTime());
    const startDate = starts.length ? new Date(Math.min(...starts)) : new Date(Date.UTC(current.year, 0, 1));
    const endDate = ends.length ? new Date(Math.max(...ends)) : new Date(Date.UTC(current.year, 11, 31));
    return { id: current.id, year: current.year, label: `FY${current.year}`, startDate, endDate };
  }

  async leaveYears(companyId: string) {
    const years = await this.prisma.financialYear.findMany({ where: { companyId }, include: { periods: { orderBy: { periodNumber: 'asc' } } }, orderBy: { year: 'desc' } });
    if (!years.length) { const y = new Date().getFullYear(); return [{ year: y, label: `FY${y}` }]; }
    return years.map((y) => ({ year: y.year, label: `FY${y.year}`, startDate: y.periods[0]?.startDate, endDate: y.periods[y.periods.length - 1]?.endDate }));
  }

  private yearOf(d: Date | string, fy: { startDate: Date; endDate: Date; year: number }) {
    const t = dateOnly(d).getTime();
    if (t < dateOnly(fy.startDate).getTime()) return fy.year - 1;
    if (t > dateOnly(fy.endDate).getTime()) return fy.year + 1;
    return fy.year;
  }

  // ---------- Work calendar + holidays ----------
  private weekendSet(weekendDays: any): Set<number> {
    const days = Array.isArray(weekendDays) && weekendDays.length ? weekendDays : ['SATURDAY', 'SUNDAY'];
    const out = new Set<number>();
    for (const d of days) { const i = DAYS.indexOf(d); if (i >= 0) out.add(i); }
    return out;
  }

  /** Expand holidays (incl. recurring + observed) applicable to the employee. */
  async resolveHolidays(companyId: string, employee: any, start: Date, end: Date): Promise<Map<string, any>> {
    const branchId = employee?.department?.branchId || null;
    const calendarId = employee?.workCalendarId || null;
    const holidays = await this.prisma.holiday.findMany({ where: { companyId, active: true } });
    const map = new Map<string, any>();
    const inRange = (d: Date) => dateOnly(d) >= dateOnly(start) && dateOnly(d) <= dateOnly(end);
    const applies = (h: any) => {
      if (h.scope === 'BRANCH') return !!branchId && h.branchId === branchId;
      if (h.scope === 'CALENDAR') return !!calendarId && h.calendarId === calendarId;
      return true;
    };
    for (const h of holidays) {
      if (!applies(h)) continue;
      const recurring = h.recurring || h.recurrence === 'YEARLY';
      if (recurring) {
        const base = new Date(h.date);
        for (let y = start.getUTCFullYear() - 1; y <= end.getUTCFullYear() + 1; y++) {
          const occ = new Date(Date.UTC(y, base.getUTCMonth(), base.getUTCDate()));
          if (inRange(occ)) map.set(key(occ), { ...h, occurrence: occ });
        }
      } else if (inRange(h.date)) {
        map.set(key(h.date), h);
      }
      if (h.observedDate && inRange(h.observedDate)) map.set(key(h.observedDate), { ...h, observed: true });
    }
    return map;
  }

  // ---------- Unified calculation ----------
  async calculate(companyId: string, dto: { employeeId: string; leaveTypeId?: string; startDate: string; endDate: string; startSession?: string; endSession?: string; includeWeekends?: boolean; includeHolidays?: boolean }) {
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId }, include: { workCalendar: true, department: true } });
    if (!employee) throw new NotFoundException('Employee not found');
    const leaveType = dto.leaveTypeId ? await this.prisma.leaveType.findFirst({ where: { id: dto.leaveTypeId, companyId } }) : null;
    const start = dateOnly(dto.startDate); const end = dateOnly(dto.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException('Invalid date range');
    if (end < start) throw new BadRequestException('End date cannot be before start date');

    const includeWeekends = dto.includeWeekends ?? (leaveType?.weekendPolicy === 'INCLUDE');
    const includeHolidays = dto.includeHolidays ?? (leaveType?.holidayPolicy === 'INCLUDE');
    const weekend = this.weekendSet(employee.workCalendar?.weekendDays);
    const holidays = await this.resolveHolidays(companyId, employee, start, end);

    let calendarDays = 0, weekendDays = 0, holidayDays = 0, workingDays = 0;
    const chargeableDates: string[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dt = new Date(d); calendarDays++;
      const isWeekend = weekend.has(dt.getUTCDay());
      const isHoliday = holidays.has(key(dt));
      if (isWeekend && !includeWeekends) { weekendDays++; continue; }
      if (isHoliday && !includeHolidays) { holidayDays++; continue; }
      workingDays++; chargeableDates.push(key(dt));
    }

    const startSession = (dto.startSession || 'FULL').toUpperCase();
    const endSession = (dto.endSession || 'FULL').toUpperCase();
    let halfDayAdjustment = 0;
    const startKey = key(start); const endKey = key(end);
    const startCounted = chargeableDates.includes(startKey);
    const endCounted = chargeableDates.includes(endKey);
    if (startKey === endKey) {
      if (startCounted && ((startSession !== 'FULL') !== (endSession !== 'FULL'))) halfDayAdjustment = 0.5;
    } else {
      if (startCounted && startSession !== 'FULL') halfDayAdjustment += 0.5;
      if (endCounted && endSession !== 'FULL') halfDayAdjustment += 0.5;
    }
    const chargeableLeaveDays = round2(Math.max(0, workingDays - halfDayAdjustment));
    return {
      employeeId: employee.id, leaveTypeId: leaveType?.id || null,
      startDate: start, endDate: end, startSession, endSession, includeWeekends, includeHolidays,
      calendarDays, weekendDays, holidayDays, workingDays,
      halfDayAdjustment: round2(halfDayAdjustment), chargeableLeaveDays,
      holidays: Array.from(holidays.values()).map((h) => ({ name: h.name, date: h.occurrence || h.date, observed: !!h.observed })),
      workCalendar: employee.workCalendar?.name || 'Default (Mon–Fri)',
      nonWorkingDays: Array.from(weekend).map((i) => DAYS[i]),
    };
  }

  // ---------- Overlap ----------
  async findOverlaps(companyId: string, employeeId: string, start: Date, end: Date, excludeId?: string) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        companyId, employeeId,
        status: { in: ACTIVE_LEAVE_STATUSES },
        startDate: { lte: end }, endDate: { gte: start },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      include: { leaveTypeRef: { select: { name: true, code: true } } },
      orderBy: { startDate: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, status: r.status, startDate: r.startDate, endDate: r.endDate, days: toNum(r.days), leaveType: r.leaveTypeRef?.name || r.leaveType }));
  }

  // ---------- Balance ----------
  async getBalance(companyId: string, employeeId: string, leaveTypeId: string, year: number) {
    const leaveType = await this.prisma.leaveType.findFirst({ where: { id: leaveTypeId, companyId } });
    if (!leaveType) throw new NotFoundException('Leave type not found');
    const bal = await this.prisma.leaveBalance.findFirst({ where: { companyId, employeeId, leaveTypeId } });
    const adjustments = await this.prisma.leaveBalanceTransaction.aggregate({
      where: { companyId, employeeId, leaveTypeId, year, type: { in: ['ADJUSTMENT', 'ACCRUAL', 'EXPIRY', 'PAYOUT'] } },
      _sum: { change: true },
    });
    const yearFilter = await this.yearRange(companyId, year);
    const [approved, pending] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where: { companyId, employeeId, leaveTypeId, status: 'APPROVED', startDate: { gte: yearFilter.start, lte: yearFilter.end } }, select: { days: true } }),
      this.prisma.leaveRequest.findMany({ where: { companyId, employeeId, leaveTypeId, status: { in: ['PENDING', 'SUBMITTED', 'PENDING_APPROVAL'] }, startDate: { gte: yearFilter.start, lte: yearFilter.end } }, select: { days: true } }),
    ]);
    const entitlement = leaveType.accrualMethod === 'NONE' ? 0 : toNum(leaveType.daysPerYear);
    const carryForward = toNum(bal?.carryForward);
    const used = round2(approved.reduce((s, r) => s + toNum(r.days), 0));
    const pendingDays = round2(pending.reduce((s, r) => s + toNum(r.days), 0));
    const adjustmentTotal = round2(toNum(adjustments._sum.change));
    const available = round2(entitlement + carryForward + adjustmentTotal - used);
    return {
      leaveTypeId, leaveType: leaveType.name, code: leaveType.code, paid: leaveType.paid, year,
      entitlement, carryForward, accrued: 0, adjustments: adjustmentTotal, used, pending: pendingDays,
      available, projected: round2(available - pendingDays),
      allowNegativeBalance: leaveType.allowNegativeBalance, negativeBalancePolicy: leaveType.negativeBalancePolicy,
    };
  }

  private async yearRange(companyId: string, year: number) {
    const fy = await this.prisma.financialYear.findFirst({ where: { companyId, year }, include: { periods: true } });
    if (fy && fy.periods.length) {
      const starts = fy.periods.map((p) => new Date(p.startDate).getTime());
      const ends = fy.periods.map((p) => new Date(p.endDate).getTime());
      return { start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) };
    }
    return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) };
  }

  // ---------- Requests ----------
  async listRequests(req: any, q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId };
    if (q?.status) where.status = q.status;
    if (q?.leaveTypeId) where.leaveTypeId = q.leaveTypeId;
    if (q?.employeeId) where.employeeId = q.employeeId;
    if (q?.departmentId) where.employee = { departmentId: q.departmentId };
    if (q?.from || q?.to) { where.startDate = {}; if (q.from) where.startDate.gte = new Date(q.from); if (q.to) where.startDate.lte = new Date(q.to); }
    const rows = await this.prisma.leaveRequest.findMany({
      where,
      include: { employee: { include: { department: true } }, leaveTypeRef: true, approver: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const approverIds = Array.from(new Set(rows.map((r) => r.approvedBy).filter(Boolean))) as string[];
    const users = approverIds.length ? await this.prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const umap = new Map(users.map((u) => [u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email]));
    return rows.map((r) => ({
      id: r.id, employeeId: r.employeeId, employee: r.employee, department: r.employee?.department?.name || null,
      leaveTypeId: r.leaveTypeId, leaveType: r.leaveTypeRef?.name || r.leaveType, code: r.leaveTypeRef?.code,
      startDate: r.startDate, endDate: r.endDate, startSession: r.startSession, endSession: r.endSession,
      days: toNum(r.days), calendarDays: r.calendarDays != null ? toNum(r.calendarDays) : null, weekendDays: r.weekendDays != null ? toNum(r.weekendDays) : null, holidayDays: r.holidayDays != null ? toNum(r.holidayDays) : null,
      status: r.status, balanceAfter: r.balanceAfter != null ? toNum(r.balanceAfter) : null,
      submittedAt: r.createdAt, approvedAt: r.approvedAt,
      approverName: (r.approver ? `${r.approver.firstName} ${r.approver.lastName}` : '') || (r.approvedBy ? umap.get(r.approvedBy) || '' : '') || null,
      reason: r.reason, rejectionReason: r.rejectionReason, includeWeekends: r.includeWeekends, includeHolidays: r.includeHolidays,
    }));
  }

  async requestDetail(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const r = await this.prisma.leaveRequest.findFirst({
      where: { id, companyId },
      include: { employee: { include: { department: { include: { branch: true } } } }, leaveTypeRef: true, approver: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!r) throw new NotFoundException('Leave request not found');
    const fy = await this.currentFinancialYear(companyId);
    const year = r.year ?? this.yearOf(r.startDate, fy);
    const balance = r.leaveTypeId ? await this.getBalance(companyId, r.employeeId, r.leaveTypeId, year) : null;
    const approvals = await this.prisma.auditLog.findMany({ where: { companyId, entityType: 'LeaveRequest', entityId: id }, orderBy: { createdAt: 'asc' }, include: { user: { select: { firstName: true, lastName: true } } } });
    const approverUser = r.approvedBy ? await this.prisma.user.findUnique({ where: { id: r.approvedBy }, select: { firstName: true, lastName: true, email: true } }) : null;
    return {
      request: {
        ...r, days: toNum(r.days), calendarDays: r.calendarDays != null ? toNum(r.calendarDays) : null,
        weekendDays: r.weekendDays != null ? toNum(r.weekendDays) : null, holidayDays: r.holidayDays != null ? toNum(r.holidayDays) : null,
        balanceAfter: r.balanceAfter != null ? toNum(r.balanceAfter) : null, year,
      },
      employee: r.employee, leaveType: r.leaveTypeRef,
      approverName: (r.approver ? `${r.approver.firstName} ${r.approver.lastName}` : '') || (approverUser ? `${approverUser.firstName} ${approverUser.lastName}` : null),
      balance,
      audit: approvals.map((a) => ({ at: a.createdAt, action: a.action, user: a.user ? `${a.user.firstName} ${a.user.lastName}` : 'System', reason: a.reason, metadata: a.metadata })),
    };
  }

  async createRequest(req: any, dto: any) {
    const companyId = companyIdOf(req.user);
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');
    const leaveType = await this.prisma.leaveType.findFirst({ where: { id: dto.leaveTypeId, companyId } });
    if (!leaveType) throw new BadRequestException('A valid leave type is required');
    const calc = await this.calculate(companyId, { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, startDate: dto.startDate, endDate: dto.endDate, startSession: dto.startSession, endSession: dto.endSession, includeWeekends: dto.includeWeekends, includeHolidays: dto.includeHolidays });
    if (calc.chargeableLeaveDays <= 0) throw new BadRequestException('Selected range contains no chargeable working days');

    // Validation: minimum notice, max consecutive, attachment.
    const today = dateOnly(new Date());
    if (leaveType.minNoticeDays && calc.startDate.getTime() - today.getTime() < leaveType.minNoticeDays * 86400000) throw new BadRequestException(`This leave type requires at least ${leaveType.minNoticeDays} day(s) notice`);
    if (leaveType.maxConsecutiveDays && calc.chargeableLeaveDays > leaveType.maxConsecutiveDays) throw new BadRequestException(`Maximum consecutive days for this leave type is ${leaveType.maxConsecutiveDays}`);
    if (leaveType.requiresAttachment && !dto.attachment) throw new BadRequestException('An attachment is required for this leave type');
    if (leaveType.attachmentAfterDays && calc.chargeableLeaveDays > leaveType.attachmentAfterDays && !dto.attachment) throw new BadRequestException(`An attachment is required for leave longer than ${leaveType.attachmentAfterDays} day(s)`);

    const overlaps = await this.findOverlaps(companyId, dto.employeeId, calc.startDate, calc.endDate);
    if (overlaps.length) {
      const o = overlaps[0];
      throw new BadRequestException({ message: `${o.status === 'APPROVED' ? 'This employee already has approved leave' : 'An existing pending leave request overlaps this period'} from ${key(o.startDate)} to ${key(o.endDate)}. The new leave request overlaps an existing leave period.`, overlaps, code: 'LEAVE_OVERLAP' });
    }

    const fy = await this.currentFinancialYear(companyId);
    const year = this.yearOf(calc.startDate, fy);
    const balance = await this.getBalance(companyId, dto.employeeId, dto.leaveTypeId, year);
    if (balance.available - calc.chargeableLeaveDays < 0 && leaveType.negativeBalancePolicy === 'BLOCK') {
      throw new BadRequestException(`Insufficient balance. Available ${balance.available} day(s), requested ${calc.chargeableLeaveDays} day(s).`);
    }

    const status = dto.submit === false ? 'DRAFT' : 'PENDING';
    const created = await this.prisma.leaveRequest.create({
      data: {
        companyId, employeeId: dto.employeeId, leaveType: leaveType.code, leaveTypeId: leaveType.id,
        startDate: calc.startDate, endDate: calc.endDate, startSession: calc.startSession, endSession: calc.endSession,
        includeWeekends: calc.includeWeekends, includeHolidays: calc.includeHolidays,
        calendarDays: calc.calendarDays, weekendDays: calc.weekendDays, holidayDays: calc.holidayDays,
        days: calc.chargeableLeaveDays, year, halfDay: calc.startSession === 'FULL' && calc.endSession === 'FULL' ? 'FULL' : 'PARTIAL',
        workCalendarId: employee.workCalendarId, reason: dto.reason, attachment: dto.attachment,
        approverId: dto.approverId, requestedById: req.user.sub, status,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'LEAVE_REQUEST_CREATED', 'LeaveRequest', created.id, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: dto.employeeId, days: calc.chargeableLeaveDays, year, onBehalf: dto.employeeId !== req.user.employeeId } });
    await this.notify(companyId, { employeeId: dto.employeeId, type: 'LEAVE_SUBMITTED', title: 'Leave request submitted', body: `${calc.chargeableLeaveDays} day(s) ${leaveType.name}`, link: `/hr?tab=leave` });
    return { request: created, calculation: calc, balance: { ...balance, projected: round2(balance.available - calc.chargeableLeaveDays) } };
  }

  async updateRequest(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.leaveRequest.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Leave request not found');
    if (!['DRAFT', 'PENDING', 'SUBMITTED', 'PENDING_APPROVAL'].includes(existing.status)) throw new BadRequestException('Only pending requests can be edited');
    const calc = await this.calculate(companyId, { employeeId: existing.employeeId, leaveTypeId: dto.leaveTypeId || existing.leaveTypeId || undefined, startDate: dto.startDate || key(existing.startDate), endDate: dto.endDate || key(existing.endDate), startSession: dto.startSession ?? existing.startSession, endSession: dto.endSession ?? existing.endSession, includeWeekends: dto.includeWeekends ?? existing.includeWeekends, includeHolidays: dto.includeHolidays ?? existing.includeHolidays });
    const overlaps = await this.findOverlaps(companyId, existing.employeeId, calc.startDate, calc.endDate, id);
    if (overlaps.length) throw new BadRequestException({ message: 'The updated dates overlap an existing leave period.', overlaps, code: 'LEAVE_OVERLAP' });
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        leaveTypeId: dto.leaveTypeId || existing.leaveTypeId, startDate: calc.startDate, endDate: calc.endDate,
        startSession: calc.startSession, endSession: calc.endSession, includeWeekends: calc.includeWeekends, includeHolidays: calc.includeHolidays,
        calendarDays: calc.calendarDays, weekendDays: calc.weekendDays, holidayDays: calc.holidayDays, days: calc.chargeableLeaveDays,
        reason: dto.reason ?? existing.reason, attachment: dto.attachment ?? existing.attachment, approverId: dto.approverId ?? existing.approverId,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'LEAVE_REQUEST_UPDATED', 'LeaveRequest', id, { module: 'hr', result: 'SUCCESS', metadata: { before: { days: toNum(existing.days), start: existing.startDate, end: existing.endDate }, after: { days: calc.chargeableLeaveDays, start: calc.startDate, end: calc.endDate } } });
    return updated;
  }

  async approve(req: any, id: string, comment?: string) {
    const companyId = companyIdOf(req.user);
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, companyId }, include: { leaveTypeRef: true } });
    if (!r) throw new NotFoundException('Leave request not found');
    if (r.status === 'APPROVED') throw new BadRequestException('Leave request is already approved');
    if (['CANCELLED', 'REJECTED', 'WITHDRAWN'].includes(r.status)) throw new BadRequestException('This request can no longer be approved');
    const overlaps = await this.findOverlaps(companyId, r.employeeId, r.startDate, r.endDate, id);
    if (overlaps.length) throw new BadRequestException({ message: 'Approval blocked: another leave period overlaps this request.', overlaps, code: 'LEAVE_OVERLAP' });
    const fy = await this.currentFinancialYear(companyId);
    const year = r.year ?? this.yearOf(r.startDate, fy);
    const balance = r.leaveTypeId ? await this.getBalance(companyId, r.employeeId, r.leaveTypeId, year) : null;
    if (balance && balance.available - toNum(r.days) < 0 && r.leaveTypeRef?.negativeBalancePolicy === 'BLOCK') {
      throw new BadRequestException(`Insufficient balance. Available ${balance.available}, requested ${toNum(r.days)}.`);
    }
    const balanceAfter = balance ? round2(balance.available - toNum(r.days)) : null;
    const me = await this.prisma.user.findUnique({ where: { id: req.user.sub }, select: { employeeId: true } });
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: req.user.sub, approvedAt: new Date(), approverId: me?.employeeId || r.approverId, balanceAfter, comments: comment ?? r.comments, year },
    });
    if (r.leaveTypeId) await this.ledger(companyId, r.employeeId, r.leaveTypeId, year, 'APPROVED_LEAVE', `LV-${id.slice(0, 8).toUpperCase()}`, -toNum(r.days), balanceAfter ?? 0, req.user.sub);
    await this.syncAttendance(companyId, r, true);
    await this.audit.log(companyId, req.user.sub, 'LEAVE_APPROVED', 'LeaveRequest', id, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: r.employeeId, days: toNum(r.days), balanceAfter } });
    await this.notify(companyId, { employeeId: r.employeeId, type: 'LEAVE_APPROVED', title: 'Leave approved', body: `${toNum(r.days)} day(s) approved`, link: `/hr?tab=leave` });
    return { ...updated, balanceAfter };
  }

  async reject(req: any, id: string, reason: string) {
    const companyId = companyIdOf(req.user);
    if (!reason) throw new BadRequestException('A rejection reason is required');
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, companyId } });
    if (!r) throw new NotFoundException('Leave request not found');
    if (!['PENDING', 'SUBMITTED', 'PENDING_APPROVAL', 'DRAFT'].includes(r.status)) throw new BadRequestException('This request can no longer be rejected');
    const updated = await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'REJECTED', approvedBy: req.user.sub, approvedAt: new Date(), rejectionReason: reason } });
    await this.audit.log(companyId, req.user.sub, 'LEAVE_REJECTED', 'LeaveRequest', id, { module: 'hr', result: 'SUCCESS', reason, metadata: { employeeId: r.employeeId } });
    await this.notify(companyId, { employeeId: r.employeeId, type: 'LEAVE_REJECTED', title: 'Leave rejected', body: reason, link: `/hr?tab=leave` });
    return updated;
  }

  async cancel(req: any, id: string, reason?: string) {
    const companyId = companyIdOf(req.user);
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, companyId } });
    if (!r) throw new NotFoundException('Leave request not found');
    if (['CANCELLED', 'REJECTED', 'WITHDRAWN'].includes(r.status)) throw new BadRequestException('Request is already closed');
    const wasApproved = r.status === 'APPROVED';
    const updated = await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', cancelledBy: req.user.sub, cancelledAt: new Date(), rejectionReason: reason ?? r.rejectionReason } });
    if (wasApproved && r.leaveTypeId) {
      const fy = await this.currentFinancialYear(companyId);
      const year = r.year ?? this.yearOf(r.startDate, fy);
      const balance = await this.getBalance(companyId, r.employeeId, r.leaveTypeId, year);
      await this.ledger(companyId, r.employeeId, r.leaveTypeId, year, 'LEAVE_REVERSAL', `LV-${id.slice(0, 8).toUpperCase()}`, toNum(r.days), balance.available, req.user.sub);
      await this.syncAttendance(companyId, r, false);
    }
    await this.audit.log(companyId, req.user.sub, 'LEAVE_CANCELLED', 'LeaveRequest', id, { module: 'hr', result: 'SUCCESS', reason, metadata: { employeeId: r.employeeId, wasApproved } });
    await this.notify(companyId, { employeeId: r.employeeId, type: 'LEAVE_CANCELLED', title: 'Leave cancelled', body: reason, link: `/hr?tab=leave` });
    return updated;
  }

  /** Create / remove ON LEAVE attendance rows for the working days of an approved request. */
  private async syncAttendance(companyId: string, r: any, add: boolean) {
    const employee = await this.prisma.employee.findFirst({ where: { id: r.employeeId, companyId }, include: { workCalendar: true, department: true } });
    if (!employee) return;
    const weekend = this.weekendSet(employee.workCalendar?.weekendDays);
    const holidays = await this.resolveHolidays(companyId, employee, new Date(r.startDate), new Date(r.endDate));
    for (let d = new Date(dateOnly(r.startDate)); d <= dateOnly(r.endDate); d.setUTCDate(d.getUTCDate() + 1)) {
      if (weekend.has(d.getUTCDay())) continue;
      if (holidays.has(key(d)) && !r.includeHolidays) continue;
      const date = new Date(d);
      if (add) {
        await this.prisma.attendance.upsert({
          where: { companyId_employeeId_date: { companyId, employeeId: r.employeeId, date } },
          update: { status: 'LEAVE', source: 'LEAVE', note: `Leave LV-${r.id.slice(0, 8).toUpperCase()}` },
          create: { companyId, employeeId: r.employeeId, date, status: 'LEAVE', source: 'LEAVE', note: `Leave LV-${r.id.slice(0, 8).toUpperCase()}` },
        });
      } else {
        await this.prisma.attendance.deleteMany({ where: { companyId, employeeId: r.employeeId, date, source: 'LEAVE' } });
      }
    }
  }

  private async ledger(companyId: string, employeeId: string, leaveTypeId: string, year: number, type: string, reference: string, change: number, balanceAfter: number, userId?: string) {
    await this.prisma.leaveBalanceTransaction.create({ data: { companyId, employeeId, leaveTypeId, year, type, reference, change, balanceAfter, effectiveDate: new Date(), createdById: userId } });
    await this.prisma.leaveBalance.upsert({
      where: { companyId_employeeId_leaveTypeId: { companyId, employeeId, leaveTypeId } },
      update: { balance: balanceAfter, year },
      create: { companyId, employeeId, leaveTypeId, balance: balanceAfter, year },
    });
  }

  // ---------- Balances report + ledger ----------
  async balanceReport(req: any, q: any) {
    const companyId = companyIdOf(req.user);
    const fy = await this.currentFinancialYear(companyId);
    const year = q?.year ? Number(q.year) : fy.year;
    const employees = await this.prisma.employee.findMany({ where: { companyId, active: true, ...(q?.departmentId ? { departmentId: q.departmentId } : {}) }, include: { department: true } });
    const leaveTypes = await this.prisma.leaveType.findMany({ where: { companyId, active: true, ...(q?.leaveTypeId ? { id: q.leaveTypeId } : {}) } });
    const rows: any[] = [];
    for (const e of employees) {
      for (const t of leaveTypes) {
        const b = await this.getBalance(companyId, e.id, t.id, year);
        if (b.entitlement === 0 && b.used === 0 && b.pending === 0 && b.carryForward === 0) continue;
        rows.push({ employeeId: e.id, employee: `${e.firstName} ${e.lastName}`.trim(), employeeNo: e.employeeNo, department: e.department?.name || null, ...b });
      }
    }
    return { year, financialYear: fy, rows };
  }

  async balanceLedger(req: any, employeeId: string, leaveTypeId: string, year?: number) {
    const companyId = companyIdOf(req.user);
    const fy = await this.currentFinancialYear(companyId);
    const y = year ? Number(year) : fy.year;
    const [transactions, balance] = await Promise.all([
      this.prisma.leaveBalanceTransaction.findMany({ where: { companyId, employeeId, leaveTypeId, year: y }, orderBy: { createdAt: 'asc' } }),
      this.getBalance(companyId, employeeId, leaveTypeId, y),
    ]);
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { firstName: true, lastName: true, employeeNo: true } });
    return { employee, balance, transactions: transactions.map((t) => ({ ...t, change: toNum(t.change), balanceAfter: toNum(t.balanceAfter) })) };
  }

  async adjustBalance(req: any, dto: any) {
    const companyId = companyIdOf(req.user);
    if (!dto.reason) throw new BadRequestException('A reason is required for balance adjustments');
    const change = Number(dto.change);
    if (!change) throw new BadRequestException('Adjustment must be a non-zero number');
    const fy = await this.currentFinancialYear(companyId);
    const year = dto.year ? Number(dto.year) : fy.year;
    const balance = await this.getBalance(companyId, dto.employeeId, dto.leaveTypeId, year);
    const after = round2(balance.available + change);
    await this.ledger(companyId, dto.employeeId, dto.leaveTypeId, year, 'ADJUSTMENT', dto.reference || 'ADJ', change, after, req.user.sub);
    await this.audit.log(companyId, req.user.sub, 'LEAVE_BALANCE_ADJUSTED', 'LeaveBalance', `${dto.employeeId}:${dto.leaveTypeId}`, { module: 'hr', result: 'SUCCESS', reason: dto.reason, metadata: { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year, change, before: balance.available, after } });
    return { ...balance, available: after, projected: round2(after - balance.pending) };
  }

  // ---------- Leave types ----------
  async listLeaveTypes(req: any) {
    const companyId = companyIdOf(req.user);
    const types = await this.prisma.leaveType.findMany({ where: { companyId }, include: { policy: true }, orderBy: { name: 'asc' } });
    return types.map((t) => ({
      ...t, daysPerYear: t.daysPerYear,
      carryForwardMax: t.carryForwardMax != null ? toNum(t.carryForwardMax) : null,
      carryForwardPercent: t.carryForwardPercent != null ? toNum(t.carryForwardPercent) : null,
      maxCarryOver: t.policy ? toNum(t.policy.maxCarryOver) : 0, accrualPerMonth: t.policy ? toNum(t.policy.accrualPerMonth) : 0,
    }));
  }

  async createLeaveType(req: any, dto: any) {
    const companyId = companyIdOf(req.user);
    if (!dto.code || !dto.name) throw new BadRequestException('Code and name are required');
    const type = await this.prisma.leaveType.create({
      data: {
        companyId, code: String(dto.code).toUpperCase(), name: dto.name, daysPerYear: Number(dto.daysPerYear ?? 20), active: dto.active ?? true,
        description: dto.description, paid: dto.paid ?? true, entitlementUnit: dto.entitlementUnit || 'DAYS', accrualMethod: dto.accrualMethod || 'ANNUAL_GRANT',
        leaveYearBasis: dto.leaveYearBasis || 'FINANCIAL_YEAR', weekendPolicy: dto.weekendPolicy || 'EXCLUDE', holidayPolicy: dto.holidayPolicy || 'EXCLUDE',
        allowHalfDay: dto.allowHalfDay ?? true, allowNegativeBalance: dto.allowNegativeBalance ?? false, negativeBalancePolicy: dto.negativeBalancePolicy || (dto.allowNegativeBalance ? 'ALLOW' : 'BLOCK'),
        minNoticeDays: Number(dto.minNoticeDays ?? 0), maxConsecutiveDays: dto.maxConsecutiveDays ? Number(dto.maxConsecutiveDays) : null,
        carryForwardPolicy: dto.carryForwardPolicy || 'NONE', carryForwardMax: dto.carryForwardMax != null ? Number(dto.carryForwardMax) : null,
        carryForwardPercent: dto.carryForwardPercent != null ? Number(dto.carryForwardPercent) : null, carryForwardExpiryMonths: dto.carryForwardExpiryMonths ? Number(dto.carryForwardExpiryMonths) : null,
        requiresAttachment: dto.requiresAttachment ?? false, attachmentAfterDays: dto.attachmentAfterDays ? Number(dto.attachmentAfterDays) : null,
        approvalWorkflow: dto.approvalWorkflow || 'SINGLE',
      },
    });
    await this.audit.log(companyId, req.user.sub, 'LEAVE_TYPE_CREATED', 'LeaveType', type.id, { module: 'hr', result: 'SUCCESS', metadata: { code: type.code } });
    return type;
  }

  async updateLeaveType(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.leaveType.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Leave type not found');
    const data: any = { ...dto };
    for (const f of ['daysPerYear', 'minNoticeDays']) if (data[f] != null) data[f] = Number(data[f]);
    for (const f of ['maxConsecutiveDays', 'attachmentAfterDays', 'carryForwardExpiryMonths']) if (data[f] != null) data[f] = Number(data[f]);
    for (const f of ['carryForwardMax', 'carryForwardPercent']) if (data[f] != null) data[f] = Number(data[f]);
    delete data.id; delete data.companyId; delete data.policy;
    const updated = await this.prisma.leaveType.update({ where: { id }, data });
    await this.audit.log(companyId, req.user.sub, 'LEAVE_TYPE_UPDATED', 'LeaveType', id, { module: 'hr', result: 'SUCCESS', metadata: { before: existing, after: data } });
    return updated;
  }

  async setLeaveTypeActive(req: any, id: string, active: boolean) {
    const companyId = companyIdOf(req.user);
    const updated = await this.prisma.leaveType.updateMany({ where: { id, companyId }, data: { active } });
    await this.audit.log(companyId, req.user.sub, 'LEAVE_TYPE_UPDATED', 'LeaveType', id, { module: 'hr', result: 'SUCCESS', metadata: { active } });
    return updated;
  }

  async duplicateLeaveType(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const t = await this.prisma.leaveType.findFirst({ where: { id, companyId } });
    if (!t) throw new NotFoundException('Leave type not found');
    const { id: _id, code, name, ...rest } = t as any;
    let newCode = `${code}_COPY`; let n = 1;
    while (await this.prisma.leaveType.findFirst({ where: { companyId, code: newCode } })) { newCode = `${code}_COPY${++n}`; }
    const copy = await this.prisma.leaveType.create({ data: { ...rest, code: newCode, name: `${name} (Copy)`, active: false } });
    await this.audit.log(companyId, req.user.sub, 'LEAVE_TYPE_CREATED', 'LeaveType', copy.id, { module: 'hr', result: 'SUCCESS', metadata: { duplicatedFrom: id } });
    return copy;
  }

  // ---------- Holidays ----------
  async listHolidays(req: any, q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId };
    if (q?.branchId) where.OR = [{ branchId: q.branchId }, { branchId: null }];
    const rows = await this.prisma.holiday.findMany({ where, include: { branch: true }, orderBy: { date: 'asc' } });
    const year = q?.year ? Number(q.year) : null;
    if (!year) return rows;
    const start = new Date(Date.UTC(year - 1, 0, 1)); const end = new Date(Date.UTC(year + 1, 11, 31));
    const out: any[] = [];
    for (const h of rows) {
      if (h.recurring || h.recurrence === 'YEARLY') {
        const base = new Date(h.date);
        const occ = new Date(Date.UTC(year, base.getUTCMonth(), base.getUTCDate()));
        out.push({ ...h, occurrenceDate: occ, observed: h.observedDate });
      } else {
        out.push({ ...h, occurrenceDate: h.date });
      }
    }
    return out.filter((h) => new Date(h.occurrenceDate).getUTCFullYear() === year || (!h.recurring && new Date(h.date).getUTCFullYear() === year));
  }

  async createHoliday(req: any, dto: any) {
    const companyId = companyIdOf(req.user);
    if (!dto.name || !dto.date) throw new BadRequestException('Name and date are required');
    const recurring = dto.recurring ?? (dto.recurrence === 'YEARLY');
    const date = new Date(dto.date);
    const h = await this.prisma.holiday.create({
      data: {
        companyId, name: dto.name, date, branchId: dto.branchId || null, country: dto.country, region: dto.region, recurring,
        type: dto.type || 'PUBLIC', recurrence: recurring ? 'YEARLY' : (dto.recurrence || 'NONE'),
        recurrenceMonth: recurring ? date.getUTCMonth() + 1 : null, recurrenceDay: recurring ? date.getUTCDate() : null,
        observedDate: dto.observedDate ? new Date(dto.observedDate) : null, observedRule: dto.observedRule || 'NONE',
        paid: dto.paid ?? true, scope: dto.scope || (dto.branchId ? 'BRANCH' : 'COMPANY'), calendarId: dto.calendarId || null, active: dto.active ?? true,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'HOLIDAY_CREATED', 'Holiday', h.id, { module: 'hr', result: 'SUCCESS', metadata: { name: h.name, date } });
    return h;
  }

  async updateHoliday(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.holiday.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Holiday not found');
    const data: any = { ...dto };
    if (dto.date) data.date = new Date(dto.date);
    if (dto.observedDate) data.observedDate = new Date(dto.observedDate);
    if (data.recurring != null) data.recurrence = data.recurring ? 'YEARLY' : 'NONE';
    delete data.id; delete data.companyId;
    const updated = await this.prisma.holiday.update({ where: { id }, data });
    await this.audit.log(companyId, req.user.sub, 'HOLIDAY_UPDATED', 'Holiday', id, { module: 'hr', result: 'SUCCESS', metadata: { before: existing, after: data } });
    return updated;
  }

  async setHolidayActive(req: any, id: string, active: boolean) {
    const companyId = companyIdOf(req.user);
    const updated = await this.prisma.holiday.updateMany({ where: { id, companyId }, data: { active } });
    await this.audit.log(companyId, req.user.sub, 'HOLIDAY_UPDATED', 'Holiday', id, { module: 'hr', result: 'SUCCESS', metadata: { active } });
    return updated;
  }

  // ---------- Calendar ----------
  async calendar(req: any, q: any) {
    const companyId = companyIdOf(req.user);
    const base = q?.month ? new Date(q.month) : new Date();
    const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
    const where: any = { companyId, status: { in: ['APPROVED', 'PENDING', 'SUBMITTED', 'PENDING_APPROVAL'] }, startDate: { lte: end }, endDate: { gte: start } };
    if (q?.departmentId) where.employee = { departmentId: q.departmentId };
    if (q?.employeeId) where.employeeId = q.employeeId;
    if (q?.leaveTypeId) where.leaveTypeId = q.leaveTypeId;
    if (q?.status) where.status = q.status;
    const [requests, holidays] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, department: { select: { name: true } } } }, leaveTypeRef: { select: { name: true, code: true } } } }),
      this.prisma.holiday.findMany({ where: { companyId, active: true } }),
    ]);
    const holidayOcc = holidays.filter((h) => (h.recurring || h.recurrence === 'YEARLY') ? new Date(Date.UTC(start.getUTCFullYear(), new Date(h.date).getUTCMonth(), new Date(h.date).getUTCDate())) : h.date)
      .filter((h) => new Date(h.date).getUTCMonth() === base.getUTCMonth() || (h.recurring && true));
    return { month: base.toISOString(), requests, holidays };
  }

  // ---------- Year-end rollover ----------
  async rolloverPreview(req: any, fromYear: number, toYear: number) {
    const companyId = companyIdOf(req.user);
    const employees = await this.prisma.employee.findMany({ where: { companyId, active: true } });
    const types = await this.prisma.leaveType.findMany({ where: { companyId, active: true, accrualMethod: { not: 'NONE' } } });
    const rows: any[] = [];
    for (const e of employees) {
      for (const t of types) {
        const b = await this.getBalance(companyId, e.id, t.id, fromYear);
        if (b.entitlement === 0 && b.used === 0 && b.carryForward === 0) continue;
        const available = Math.max(0, b.available);
        let carryForward = 0;
        if (t.carryForwardPolicy === 'ALL') carryForward = available;
        else if (t.carryForwardPolicy === 'MAX') carryForward = Math.min(available, toNum(t.carryForwardMax));
        else if (t.carryForwardPolicy === 'PERCENT') carryForward = round2((available * toNum(t.carryForwardPercent)) / 100);
        const expire = round2(Math.max(0, available - carryForward));
        const newEntitlement = toNum(t.daysPerYear);
        rows.push({ employeeId: e.id, employee: `${e.firstName} ${e.lastName}`.trim(), employeeNo: e.employeeNo, leaveTypeId: t.id, leaveType: t.name, available: round2(available), carryForward: round2(carryForward), expire, newEntitlement, openingNewBalance: round2(carryForward + newEntitlement), policy: t.carryForwardPolicy });
      }
    }
    const alreadyProcessed = await this.prisma.leaveBalanceTransaction.count({ where: { companyId, year: toYear, type: 'ENTITLEMENT' } });
    return { fromYear, toYear, rows, alreadyProcessed: alreadyProcessed > 0 };
  }

  async rolloverProcess(req: any, fromYear: number, toYear: number) {
    const companyId = companyIdOf(req.user);
    const preview = await this.rolloverPreview(req, fromYear, toYear);
    if (preview.alreadyProcessed) throw new BadRequestException(`Rollover ${fromYear} → ${toYear} has already been processed`);
    let processed = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const r of preview.rows) {
        const existing = await tx.leaveBalanceTransaction.count({ where: { companyId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: toYear, type: 'ENTITLEMENT' } });
        if (existing) continue;
        const afterEntitlement = round2(r.newEntitlement);
        await tx.leaveBalanceTransaction.create({ data: { companyId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: toYear, type: 'ENTITLEMENT', reference: `FY${toYear}`, change: r.newEntitlement, balanceAfter: afterEntitlement, effectiveDate: new Date(), createdById: req.user.sub } });
        if (r.carryForward) await tx.leaveBalanceTransaction.create({ data: { companyId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: toYear, type: 'CARRY_FORWARD', reference: `FY${fromYear}→FY${toYear}`, change: r.carryForward, balanceAfter: round2(afterEntitlement + r.carryForward), effectiveDate: new Date(), createdById: req.user.sub } });
        if (r.expire) await tx.leaveBalanceTransaction.create({ data: { companyId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: fromYear, type: 'EXPIRY', reference: `FY${fromYear}`, change: -r.expire, balanceAfter: round2(r.available - r.expire), effectiveDate: new Date(), createdById: req.user.sub } });
        await tx.leaveBalance.upsert({ where: { companyId_employeeId_leaveTypeId: { companyId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId } }, update: { carryForward: r.carryForward, year: toYear, balance: r.openingNewBalance }, create: { companyId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, carryForward: r.carryForward, year: toYear, balance: r.openingNewBalance } });
        processed++;
      }
    });
    await this.audit.log(companyId, req.user.sub, 'LEAVE_YEAR_ROLLOVER', 'LeaveYear', `${fromYear}->${toYear}`, { module: 'hr', result: 'SUCCESS', metadata: { processed } });
    await this.notify(companyId, { type: 'LEAVE_ROLLOVER', title: `Leave year rollover FY${fromYear} → FY${toYear} complete`, body: `${processed} balance(s) rolled over`, link: '/hr?tab=leave' });
    return { processed, fromYear, toYear };
  }

  // ---------- Notifications ----------
  private async notify(companyId: string, opts: { userId?: string | null; employeeId?: string | null; type: string; title: string; body?: string; link?: string }) {
    try {
      const userId = opts.userId || (opts.employeeId ? (await this.prisma.user.findFirst({ where: { employeeId: opts.employeeId }, select: { id: true } }))?.id : undefined);
      await this.prisma.performanceNotification.create({ data: { companyId, userId: userId || null, employeeId: opts.employeeId || null, type: opts.type, title: opts.title, body: opts.body, link: opts.link } });
    } catch { /* never break the flow */ }
  }
}
