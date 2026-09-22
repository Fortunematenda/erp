import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { HrService } from './hr.service';
import { PermissionService } from '../auth/permission.service';
import { companyIdOf } from '../../core/context';

const round2 = (n: number) => Number((Number(n) || 0).toFixed(2));
const toNum = (v: any) => Number(v || 0);
const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/**
 * Employee 360 — an employee-centred aggregation view over the authoritative
 * NexusERP modules (Leave, Attendance, Performance, Incentives, Payroll,
 * Documents, Assets, Projects, Audit). It never duplicates business data; it
 * only reads and writes through the owning module's models.
 */
@Injectable()
export class Employee360Service {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService, private hr: HrService, private permissions: PermissionService) {}

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  private async employeeOrThrow(companyId: string, id: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { id, companyId },
      include: { department: { include: { branch: true } }, workCalendar: true },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  private async managerOf(companyId: string, managerId?: string | null) {
    if (!managerId) return null;
    return this.prisma.employee.findFirst({ where: { id: managerId, companyId }, select: { id: true, firstName: true, lastName: true, employeeNo: true, position: true } });
  }

  private maskAccount(value?: string | null) {
    if (!value) return null;
    const s = String(value);
    return s.length <= 4 ? `•••• ${s}` : `•••• ${s.slice(-4)}`;
  }

  private async notify(companyId: string, opts: { userId?: string | null; employeeId?: string | null; type: string; title: string; body?: string; link?: string }) {
    try {
      await this.prisma.performanceNotification.create({ data: { companyId, userId: opts.userId || null, employeeId: opts.employeeId || null, type: opts.type, title: opts.title, body: opts.body, link: opts.link } });
    } catch { /* notifications must never break the flow */ }
  }

  // ------------------------------------------------------------------
  // Overview
  // ------------------------------------------------------------------
  async overview(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const emp = await this.employeeOrThrow(companyId, id);
    const [balances, leaves, attendance, perf, payslips, compHistory, incentives, documents, assets, projects, user, manager] = await Promise.all([
      this.hr.getLeaveBalances(companyId, id),
      this.prisma.leaveRequest.findMany({ where: { companyId, employeeId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.attendance.findMany({ where: { companyId, employeeId: id }, orderBy: { date: 'desc' }, take: 120 }),
      this.performanceWorkspace(req, id),
      this.prisma.payslip.findMany({ where: { employeeId: id, payrollRun: { companyId } }, include: { payrollRun: true }, orderBy: { id: 'desc' }, take: 12 }),
      this.prisma.compensationHistory.findMany({ where: { companyId, employeeId: id }, orderBy: { effectiveDate: 'desc' } }),
      this.prisma.performanceIncentive.findMany({ where: { companyId, employeeId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.employeeDocument.findMany({ where: { companyId, employeeId: id, status: 'VALID' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.assetAssignment.findMany({ where: { companyId, employeeId: id, status: 'ASSIGNED' }, include: { asset: true } }),
      this.prisma.projectMember.findMany({ where: { companyId, employeeId: id, status: 'ACTIVE' }, include: { project: { include: { tasks: true } } } }),
      this.prisma.user.findFirst({ where: { employeeId: id, memberships: { some: { companyId } } }, include: { memberships: { where: { companyId }, include: { roles: { include: { role: true } } } } } }),
      this.managerOf(companyId, emp.managerId),
    ]);

    const leaveAvailable = balances.reduce((s: number, b: any) => s + toNum(b.available), 0);
    const pendingLeave = leaves.filter((l) => ['PENDING', 'SUBMITTED', 'PENDING_APPROVAL'].includes(l.status));
    const currentAssessment = perf.currentAssessment;
    const latestPayslip = payslips[0] || null;
    const latestApproved = perf.history.find((h: any) => h.score != null) || null;

    const now = new Date();
    const expiringDocs = documents.filter((d) => d.expiryDate && (new Date(d.expiryDate).getTime() - now.getTime()) / 86400000 <= 30);
    const overdueKpi = currentAssessment ? (currentAssessment.employeeSubmittedAt == null && currentAssessment.cycle?.employeeDeadline && new Date(currentAssessment.cycle.employeeDeadline) < now) : false;
    const missingKpi = currentAssessment ? currentAssessment.employeeSubmittedAt == null : (perf.currentCycle != null);
    const maintenanceDue = assets.filter((a: any) => a.asset?.status === 'IN_MAINTENANCE').length;

    const needsAttention: any[] = [];
    if (pendingLeave.length) needsAttention.push({ type: 'LEAVE_PENDING', severity: 'warning', title: `${pendingLeave.length} leave request${pendingLeave.length > 1 ? 's' : ''} awaiting approval`, tab: 'leave', ref: pendingLeave[0].id });
    if (overdueKpi) needsAttention.push({ type: 'KPI_OVERDUE', severity: 'critical', title: 'KPI submission overdue', tab: 'performance' });
    else if (missingKpi) needsAttention.push({ type: 'KPI_MISSING', severity: 'warning', title: 'KPI submission missing', tab: 'performance' });
    if (expiringDocs.length) needsAttention.push({ type: 'DOC_EXPIRING', severity: 'warning', title: `${expiringDocs.length} document${expiringDocs.length > 1 ? 's' : ''} expiring soon`, tab: 'documents', ref: expiringDocs[0].id });
    if (maintenanceDue) needsAttention.push({ type: 'ASSET_MAINTENANCE', severity: 'info', title: 'Assigned asset maintenance due', tab: 'assets' });
    if (!emp.basicSalary || toNum(emp.basicSalary) <= 0) needsAttention.push({ type: 'PAYROLL_INCOMPLETE', severity: 'warning', title: 'Payroll information incomplete', tab: 'payroll' });
    if (currentAssessment && !currentAssessment.managerSubmittedAt && currentAssessment.employeeSubmittedAt) needsAttention.push({ type: 'MANAGER_REVIEW_DUE', severity: 'info', title: 'Manager review pending', tab: 'performance' });

    const activity = await this.recentActivity(companyId, id, 8);

    return {
      employee: {
        ...emp,
        manager,
        userAccount: user ? { id: user.id, email: user.email, status: user.status, roles: user.memberships.flatMap((m) => m.roles.map((r) => r.role.name)) } : null,
      },
      summary: {
        employment: { status: emp.employmentStatus || emp.status, started: emp.hireDate, type: emp.contractType },
        leave: { available: round2(leaveAvailable), pending: pendingLeave.length },
        performance: { score: latestApproved?.score ?? null, band: latestApproved?.band ?? null, cycle: latestApproved?.cycle ?? perf.currentCycle?.name ?? null },
        payroll: { basicSalary: toNum(emp.basicSalary), currency: emp.currency, lastPaid: latestPayslip ? { period: latestPayslip.payrollRun.period, year: latestPayslip.payrollRun.year, net: toNum(latestPayslip.netPay) } : null },
      },
      balances,
      counts: { leave: leaves.length, documents: documents.length, assets: assets.length, projects: projects.length, incentives: incentives.length },
      needsAttention,
      activity,
    };
  }

  private async recentActivity(companyId: string, id: string, take: number) {
    const logs = await this.prisma.auditLog.findMany({
      where: { companyId, OR: [{ entityType: 'Employee', entityId: id }, { metadata: { path: ['employeeId'], equals: id } }] },
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    return logs.map((l) => ({ id: l.id, at: l.createdAt, module: l.module || l.entityType, action: l.action, description: this.describeAudit(l), user: l.user }));
  }

  private describeAudit(l: any) {
    const who = l.user ? `${l.user.firstName} ${l.user.lastName}` : 'System';
    return `${l.entityType}${l.entityId ? ` ${String(l.entityId).slice(0, 8)}` : ''} · ${l.action} by ${who}`;
  }

  // ------------------------------------------------------------------
  // Leave
  // ------------------------------------------------------------------
  async leaveWorkspace(req: any, id: string, month?: string) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    const base = month ? new Date(month) : new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    const [balances, requests, leaveTypes, holidays, calendar] = await Promise.all([
      this.hr.getLeaveBalances(companyId, id),
      this.prisma.leaveRequest.findMany({ where: { companyId, employeeId: id }, include: { approver: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.leaveType.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.holiday.findMany({ where: { companyId, active: true, date: { gte: start, lte: end } } }),
      this.prisma.leaveRequest.findMany({ where: { companyId, employeeId: id, status: { in: ['APPROVED', 'PENDING', 'SUBMITTED', 'PENDING_APPROVAL'] }, startDate: { lte: end }, endDate: { gte: start } } }),
    ]);
    const department = await this.prisma.employee.findFirst({ where: { id, companyId }, select: { departmentId: true } });
    const departmentCalendar = department?.departmentId
      ? await this.prisma.leaveRequest.findMany({ where: { companyId, status: { in: ['APPROVED', 'PENDING'] }, startDate: { lte: end }, endDate: { gte: start }, employee: { departmentId: department.departmentId } }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } } })
      : [];
    // Resolve the approver to the actual login user who actioned the request (approvedBy is a User id).
    const approverIds = Array.from(new Set(requests.map((r) => r.approvedBy).filter(Boolean))) as string[];
    const approverUsers = approverIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
      : [];
    const approverMap = new Map(approverUsers.map((u) => [u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email]));
    const enrichedRequests = requests.map((r) => {
      const approverName = (r.approver ? `${r.approver.firstName} ${r.approver.lastName}`.trim() : '') || (r.approvedBy ? approverMap.get(r.approvedBy) || '' : '');
      return { ...r, approvedByUser: r.approvedBy ? approverMap.get(r.approvedBy) || null : null, approverName: approverName || null };
    });
    return { balances, requests: enrichedRequests, leaveTypes, holidays, calendar, departmentCalendar, month: base.toISOString() };
  }

  async previewLeave(req: any, id: string, dto: { startDate: string; endDate: string; halfDay?: string }) {
    const companyId = companyIdOf(req.user);
    const emp = await this.employeeOrThrow(companyId, id);
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException('Invalid date range');
    const { days, workingDays } = await this.hr.calculateLeaveDays(companyId, start, end, emp.workCalendar, dto.halfDay);
    const balances = await this.hr.getLeaveBalances(companyId, id);
    return { days, workingDays, balances };
  }

  async applyLeave(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const emp = await this.employeeOrThrow(companyId, id);
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException('Invalid date range');
    const { days, workingDays } = await this.hr.calculateLeaveDays(companyId, start, end, emp.workCalendar, dto.halfDay);
    if (days <= 0) throw new BadRequestException('Selected range contains no working days after excluding weekends and holidays');
    const leave = await this.prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId: id,
        leaveType: typeof dto.leaveType === 'string' && dto.leaveType ? dto.leaveType : 'ANNUAL',
        leaveTypeId: dto.leaveTypeId,
        startDate: start,
        endDate: end,
        days,
        halfDay: dto.halfDay || 'FULL',
        workCalendarId: emp.workCalendarId,
        reason: dto.reason,
        attachment: dto.attachment,
        approverId: dto.approverId,
        status: dto.submit === false ? 'DRAFT' : 'PENDING',
      },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'LeaveRequest', leave.id, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: id, days, onBehalf: true } });
    await this.notify(companyId, { employeeId: id, type: 'LEAVE_SUBMITTED', title: 'Leave request submitted', body: `${days} day(s) ${dto.leaveType || 'ANNUAL'} leave`, link: `/hr/employees/${id}?tab=leave` });
    return { ...leave, workingDays };
  }

  async setLeaveStatus(req: any, id: string, leaveId: string, status: string, comments?: string) {
    const companyId = companyIdOf(req.user);
    const leave = await this.prisma.leaveRequest.findFirst({ where: { id: leaveId, companyId, employeeId: id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    const data: any = { status };
    if (status === 'APPROVED') {
      data.approvedBy = req.user.sub; data.approvedAt = new Date();
      // Record the approver as the logged-in user's linked employee where available.
      const me = await this.prisma.user.findUnique({ where: { id: req.user.sub }, select: { employeeId: true } });
      if (me?.employeeId) data.approverId = me.employeeId;
    }
    if (comments != null) data.comments = comments;
    const updated = await this.prisma.leaveRequest.update({ where: { id: leaveId }, data });
    await this.audit.log(companyId, req.user.sub, status === 'APPROVED' ? 'APPROVE' : status === 'REJECTED' ? 'REJECT' : status, 'LeaveRequest', leaveId, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: id, days: toNum(leave.days) } });
    await this.notify(companyId, { employeeId: id, type: `LEAVE_${status}`, title: `Leave ${status.toLowerCase()}`, body: `${toNum(leave.days)} day(s)`, link: `/hr/employees/${id}?tab=leave` });
    return updated;
  }

  async configureLeaveBalance(req: any, id: string, dto: { leaveTypeId: string; balance: number }) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    if (!dto.leaveTypeId) throw new BadRequestException('leaveTypeId is required');
    const bal = await this.prisma.leaveBalance.upsert({
      where: { companyId_employeeId_leaveTypeId: { companyId, employeeId: id, leaveTypeId: dto.leaveTypeId } },
      update: { balance: toNum(dto.balance) },
      create: { companyId, employeeId: id, leaveTypeId: dto.leaveTypeId, balance: toNum(dto.balance) },
    });
    await this.audit.log(companyId, req.user.sub, 'CONFIGURE', 'LeaveBalance', bal.id, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: id, leaveTypeId: dto.leaveTypeId, balance: toNum(dto.balance) } });
    return bal;
  }

  // ------------------------------------------------------------------
  // Attendance
  // ------------------------------------------------------------------
  async attendanceWorkspace(req: any, id: string, from?: string, to?: string) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getFullYear(), end.getMonth(), 1);
    const [records, leaves] = await Promise.all([
      this.prisma.attendance.findMany({ where: { companyId, employeeId: id, date: { gte: start, lte: end } }, orderBy: { date: 'desc' } }),
      this.prisma.leaveRequest.findMany({ where: { companyId, employeeId: id, status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } } }),
    ]);
    const leaveDays = new Set<string>();
    for (const l of leaves) {
      for (let d = new Date(l.startDate); d <= new Date(l.endDate); d.setDate(d.getDate() + 1)) leaveDays.add(dayKey(d));
    }
    const rows = records.map((r) => ({ ...r, onLeave: leaveDays.has(dayKey(r.date)) }));
    const present = rows.filter((r) => r.checkIn || r.status === 'PRESENT').length;
    const absent = rows.filter((r) => r.status === 'ABSENT' && !r.onLeave).length;
    const late = rows.filter((r) => toNum(r.lateMinutes) > 0).length;
    const overtime = rows.reduce((s, r) => s + toNum(r.overtimeHours), 0);
    const workingRecords = rows.filter((r) => !r.onLeave).length;
    const attendancePct = workingRecords ? round2((present / workingRecords) * 100) : 0;
    return {
      records: rows,
      summary: { presentDays: present, absentDays: absent, lateArrivals: late, overtimeHours: round2(overtime), attendancePct, records: rows.length },
      range: { from: start.toISOString(), to: end.toISOString() },
    };
  }

  async adjustAttendance(req: any, id: string, dto: { date: string; checkIn?: string; checkOut?: string; status?: string; reason: string; note?: string }) {
    const companyId = companyIdOf(req.user);
    const emp = await this.employeeOrThrow(companyId, id);
    if (!dto.reason) throw new BadRequestException('A reason is required for attendance corrections');
    const date = new Date(dto.date);
    if (isNaN(date.getTime())) throw new BadRequestException('Invalid date');
    const existing = await this.prisma.attendance.findFirst({ where: { companyId, employeeId: id, date } });
    const checkIn = dto.checkIn ? new Date(dto.checkIn) : existing?.checkIn || undefined;
    const checkOut = dto.checkOut ? new Date(dto.checkOut) : existing?.checkOut || undefined;
    const calc = await this.hr.calculateAttendance(companyId, id, date, checkIn, checkOut, { status: dto.status || existing?.status || 'PRESENT' });
    const before = existing ? { checkIn: existing.checkIn, checkOut: existing.checkOut, workedHours: toNum(existing.workedHours) } : null;
    const record = await this.prisma.attendance.upsert({
      where: { companyId_employeeId_date: { companyId, employeeId: id, date } },
      update: { status: dto.status || existing?.status || 'PRESENT', checkIn, checkOut, scheduledStart: calc.scheduledStart, scheduledEnd: calc.scheduledEnd, breakMinutes: calc.breakMinutes, workedHours: calc.workedHours, regularHours: calc.regularHours, overtimeHours: calc.overtimeHours, lateMinutes: calc.lateMinutes, earlyDeparture: calc.earlyDeparture, note: dto.note, source: 'CORRECTION', approved: true, approvedBy: req.user.sub },
      create: { companyId, employeeId: id, date, status: dto.status || 'PRESENT', checkIn, checkOut, scheduledStart: calc.scheduledStart, scheduledEnd: calc.scheduledEnd, breakMinutes: calc.breakMinutes, workedHours: calc.workedHours, regularHours: calc.regularHours, overtimeHours: calc.overtimeHours, lateMinutes: calc.lateMinutes, earlyDeparture: calc.earlyDeparture, note: dto.note, source: 'CORRECTION', approved: true, approvedBy: req.user.sub },
    });
    await this.audit.log(companyId, req.user.sub, 'ADJUST', 'Attendance', record.id, { module: 'hr', result: 'SUCCESS', reason: dto.reason, metadata: { employeeId: id, before, after: { checkIn, checkOut, workedHours: calc.workedHours } } });
    return record;
  }

  // ------------------------------------------------------------------
  // Performance
  // ------------------------------------------------------------------
  async performanceWorkspace(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const emp = await this.employeeOrThrow(companyId, id);
    const activeStatuses = ['OPEN', 'EMPLOYEE_SUBMISSION', 'MANAGER_REVIEW', 'QA_REVIEW', 'CALIBRATION', 'APPROVAL'];
    const cycle = await this.prisma.performanceCycle.findFirst({ where: { companyId, status: { in: activeStatuses } }, orderBy: { periodStart: 'desc' } });
    const assessments = await this.prisma.employeePerformanceAssessment.findMany({
      where: { companyId, employeeId: id },
      include: { cycle: true, incentive: true, kpis: { orderBy: { position: 'asc' } }, qaReviews: true },
      orderBy: { createdAt: 'desc' },
    });
    const currentAssessment = cycle ? assessments.find((a) => a.cycleId === cycle.id) || null : assessments[0] || null;
    const departmentId = emp.departmentId;
    const template = departmentId
      ? await this.prisma.kpiTemplate.findFirst({
          where: { companyId, departmentId, status: 'ACTIVE' },
          include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { kpis: { orderBy: { position: 'asc' } } } } },
        })
      : null;
    const qaAssessments = await this.prisma.qaAssessment.findMany({ where: { companyId, employeeId: id }, include: { template: true }, orderBy: { createdAt: 'desc' } });
    const history = await this.prisma.employeePerformanceAssessment.findMany({ where: { companyId, employeeId: id }, include: { cycle: true, kpis: true }, orderBy: { createdAt: 'desc' } });
    return {
      currentCycle: cycle || null,
      currentAssessment,
      assessments,
      template: template ? { id: template.id, name: template.name, departmentId: template.departmentId, jobRole: template.jobRole, passMark: toNum(template.passMark), qaRequired: template.qaRequired, version: template.versions[0] ? { id: template.versions[0].id, version: template.versions[0].version, kpis: template.versions[0].kpis } : null } : null,
      qaAssessments,
      history: history.map((a) => ({ id: a.id, cycle: a.cycle?.name, cycleId: a.cycleId, periodStart: a.cycle?.periodStart, periodEnd: a.cycle?.periodEnd, status: a.status, score: a.totalScore != null ? toNum(a.totalScore) : null, result: a.result, band: a.band, kpiCompletion: a.kpis?.length ? Math.round((a.kpis.filter((k) => k.effectiveScore != null || k.employeeScore != null).length / a.kpis.length) * 100) : 0, templateName: a.templateName })),
      employeeDeadline: currentAssessment ? cycle?.employeeDeadline : undefined,
    };
  }

  async remindKpi(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const emp = await this.employeeOrThrow(companyId, id);
    const user = await this.prisma.user.findFirst({ where: { employeeId: id } });
    await this.notify(companyId, { userId: user?.id, employeeId: id, type: 'SUBMISSION_REMINDER', title: 'KPI submission reminder', body: 'Please complete your performance KPI submission.', link: `/hr/employees/${id}?tab=performance` });
    await this.audit.log(companyId, req.user.sub, 'REMIND', 'EmployeePerformanceAssessment', undefined, { module: 'performance', result: 'SUCCESS', metadata: { employeeId: id } });
    return { ok: true, reminded: !!user };
  }

  // ------------------------------------------------------------------
  // Incentives
  // ------------------------------------------------------------------
  async incentivesForEmployee(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    const [perf, other, approvedAssessments, plans] = await Promise.all([
      this.prisma.performanceIncentive.findMany({ where: { companyId, employeeId: id }, include: { assessment: { include: { cycle: true } }, plan: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.employeeIncentive.findMany({ where: { companyId, employeeId: id }, include: { plan: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.employeePerformanceAssessment.findMany({ where: { companyId, employeeId: id, status: { in: ['APPROVED', 'COMPLETED', 'LOCKED'] }, totalScore: { not: null } }, include: { cycle: true, incentive: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.incentivePlan.findMany({ where: { companyId, status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
    ]);
    const performance = perf.map((p) => ({
      id: p.id, reference: p.reference, source: 'PERFORMANCE', kind: 'PERFORMANCE_BONUS', planId: p.planId, planName: p.planName,
      amount: p.amount, currency: p.currency, status: p.status, payrollInputRef: p.payrollInputRef, paidAt: p.paidAt,
      finalScore: p.finalScore, band: p.band, assessmentId: p.assessmentId, cycle: p.assessment?.cycle?.name, createdAt: p.createdAt, rejectionReason: p.rejectionReason,
    }));
    const others = other.map((o) => ({
      id: o.id, reference: `OI-${o.id.slice(0, 8).toUpperCase()}`, source: 'OTHER', kind: o.plan?.payrollComponent || 'BONUS', planId: o.planId, planName: o.plan?.name || 'Other incentive',
      amount: o.amount, currency: 'USD', status: o.status, payrollInputRef: null, paidAt: o.paidAt,
      finalScore: null, band: null, assessmentId: null, cycle: o.period || null, createdAt: o.createdAt, notes: o.notes,
    }));
    const incentives = [...performance, ...others].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const ytd = incentives.filter((i) => new Date(i.createdAt).getFullYear() === new Date().getFullYear());
    const sum = (arr: any[]) => round2(arr.reduce((s, i) => s + toNum(i.amount), 0));
    const isProposed = (s: string) => ['PENDING_APPROVAL', 'PROPOSED'].includes(s);
    const isApproved = (s: string) => s === 'APPROVED';
    const isPaid = (i: any) => ['SENT_TO_PAYROLL', 'PAID'].includes(i.status) || !!i.paidAt;
    return {
      incentives,
      summary: {
        proposed: sum(incentives.filter((i) => isProposed(i.status))),
        approved: sum(incentives.filter((i) => isApproved(i.status))),
        paid: sum(incentives.filter(isPaid)),
        ytd: sum(ytd),
        currency: incentives[0]?.currency || 'USD',
      },
      eligibleAssessments: approvedAssessments.filter((a) => !a.incentive).map((a) => ({ id: a.id, cycle: a.cycle?.name, score: a.totalScore != null ? toNum(a.totalScore) : null, band: a.band })),
      plans: plans.map((p) => ({ id: p.id, name: p.name, type: p.payrollComponent || 'BONUS' })),
    };
  }

  async createEmployeeIncentive(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const emp = await this.employeeOrThrow(companyId, id);
    const amount = toNum(dto.amount);
    if (amount <= 0) throw new BadRequestException('A positive incentive amount is required');
    if (dto.assessmentId) {
      // Performance-linked incentive: created from an approved assessment, never auto-paid.
      const assessment = await this.prisma.employeePerformanceAssessment.findFirst({ where: { id: dto.assessmentId, companyId, employeeId: id }, include: { cycle: true, incentive: true } });
      if (!assessment) throw new NotFoundException('Performance assessment not found');
      if (!['APPROVED', 'COMPLETED', 'LOCKED'].includes(assessment.status)) throw new BadRequestException('Only an approved performance assessment can generate an incentive');
      if (assessment.incentive) throw new BadRequestException('An incentive already exists for this assessment');
      const plan = dto.planId ? await this.prisma.incentivePlan.findFirst({ where: { id: dto.planId, companyId } }) : null;
      const reference = await this.numbering.next(companyId, 'INC');
      const inc = await this.prisma.performanceIncentive.create({
        data: {
          companyId, reference, assessmentId: assessment.id, employeeId: id,
          planId: plan?.id, planName: plan?.name || dto.planName || 'Performance bonus',
          finalScore: assessment.totalScore ?? 0, band: assessment.band,
          calculationType: plan ? 'CUSTOM' : 'FIXED', amount, currency: emp.currency || 'USD', status: 'PENDING_APPROVAL',
        },
      });
      await this.audit.log(companyId, req.user.sub, 'INCENTIVE_CREATED', 'PerformanceIncentive', inc.id, { module: 'performance', result: 'SUCCESS', metadata: { employeeId: id, amount, assessmentId: assessment.id, onBehalf: true } });
      return inc;
    }
    // Other approved incentive (bonus / commission / allowance) recorded in HR.
    const inc = await this.prisma.employeeIncentive.create({ data: { companyId, employeeId: id, planId: dto.planId, period: dto.period, amount, status: 'PROPOSED', notes: dto.notes } });
    await this.audit.log(companyId, req.user.sub, 'INCENTIVE_CREATED', 'EmployeeIncentive', inc.id, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: id, amount, type: dto.planId ? 'PLAN' : 'OTHER' } });
    return inc;
  }

  async setIncentiveStatus(req: any, id: string, incentiveId: string, action: 'approve' | 'reject', reason?: string) {
    const companyId = companyIdOf(req.user);
    const perf = await this.prisma.performanceIncentive.findFirst({ where: { id: incentiveId, companyId, employeeId: id } });
    if (perf) {
      if (action === 'approve') {
        if (perf.status !== 'PENDING_APPROVAL') throw new BadRequestException('Incentive is not awaiting approval');
        const updated = await this.prisma.performanceIncentive.update({ where: { id: incentiveId }, data: { status: 'APPROVED', approvedById: req.user.sub, approvedAt: new Date() } });
        await this.audit.log(companyId, req.user.sub, 'INCENTIVE_APPROVED', 'PerformanceIncentive', incentiveId, { module: 'performance', result: 'SUCCESS', metadata: { employeeId: id, amount: toNum(perf.amount) } });
        return updated;
      }
      const updated = await this.prisma.performanceIncentive.update({ where: { id: incentiveId }, data: { status: 'REJECTED', rejectionReason: reason } });
      await this.audit.log(companyId, req.user.sub, 'INCENTIVE_REJECTED', 'PerformanceIncentive', incentiveId, { module: 'performance', result: 'SUCCESS', reason, metadata: { employeeId: id } });
      return updated;
    }
    const other = await this.prisma.employeeIncentive.findFirst({ where: { id: incentiveId, companyId, employeeId: id } });
    if (!other) throw new NotFoundException('Incentive not found');
    const updated = await this.prisma.employeeIncentive.update({ where: { id: incentiveId }, data: action === 'approve' ? { status: 'APPROVED', approvedById: req.user.sub, approvedAt: new Date() } : { status: 'REJECTED', notes: reason || other.notes } });
    await this.audit.log(companyId, req.user.sub, action === 'approve' ? 'INCENTIVE_APPROVED' : 'INCENTIVE_REJECTED', 'EmployeeIncentive', incentiveId, { module: 'hr', result: 'SUCCESS', reason, metadata: { employeeId: id, amount: toNum(other.amount) } });
    return updated;
  }

  // ------------------------------------------------------------------
  // Payroll
  // ------------------------------------------------------------------
  async payrollWorkspace(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const emp = await this.employeeOrThrow(companyId, id);
    const [payslips, compHistory, incentives, overtime, unpaidLeave] = await Promise.all([
      this.prisma.payslip.findMany({ where: { employeeId: id, payrollRun: { companyId } }, include: { payrollRun: true }, orderBy: { id: 'desc' } }),
      this.prisma.compensationHistory.findMany({ where: { companyId, employeeId: id }, orderBy: { effectiveDate: 'desc' } }),
      this.prisma.performanceIncentive.findMany({ where: { companyId, employeeId: id, status: { in: ['APPROVED', 'SENT_TO_PAYROLL', 'PAID'] } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.attendance.aggregate({ where: { companyId, employeeId: id, approved: true }, _sum: { overtimeHours: true } }),
      this.prisma.leaveRequest.findMany({ where: { companyId, employeeId: id, status: 'APPROVED', leaveType: { in: ['UNPAID', 'UNPAID_LEAVE'] } } }),
    ]);
    const year = new Date().getFullYear();
    const ytdRows = payslips.filter((p) => p.payrollRun.year === year);
    const bank: any = emp.bankDetails || {};
    const inputs = [
      { label: 'Basic Salary', amount: toNum(emp.basicSalary), source: 'Employee record', sourceRef: emp.employeeNo },
      ...incentives.map((i) => ({ label: 'Performance Bonus', amount: toNum(i.amount), source: i.reference, sourceRef: i.reference, assessmentId: i.assessmentId, status: i.status })),
      ...(toNum(overtime._sum.overtimeHours) > 0 ? [{ label: 'Approved Overtime', amount: toNum(overtime._sum.overtimeHours), source: 'Attendance (approved)', sourceRef: `${round2(toNum(overtime._sum.overtimeHours))} hours`, unit: 'hours' }] : []),
      ...unpaidLeave.map((l) => ({ label: 'Unpaid Leave', amount: toNum(l.days), source: 'Leave (approved)', sourceRef: `${toNum(l.days)} days`, unit: 'days' })),
    ];
    return {
      payslips,
      compHistory,
      ytd: { gross: round2(ytdRows.reduce((s, p) => s + toNum(p.grossPay), 0)), net: round2(ytdRows.reduce((s, p) => s + toNum(p.netPay), 0)) },
      details: {
        payFrequency: emp.payFrequency,
        basicSalary: toNum(emp.basicSalary),
        currency: emp.currency,
        compensationType: emp.compensationType,
        bank: { bankName: bank.bankName || bank.bank, accountName: bank.accountName, accountNumberMasked: this.maskAccount(bank.accountNumber || bank.accountNo), branch: bank.branch },
        taxDetails: emp.taxDetails,
      },
      inputs,
    };
  }

  // ------------------------------------------------------------------
  // Documents
  // ------------------------------------------------------------------
  private docStatus(d: any) {
    if (d.status === 'ARCHIVED') return 'ARCHIVED';
    if (!d.expiryDate) return 'VALID';
    const days = (new Date(d.expiryDate).getTime() - Date.now()) / 86400000;
    if (days < 0) return 'EXPIRED';
    if (days <= 30) return 'EXPIRING_SOON';
    return 'VALID';
  }

  async documentsForEmployee(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    const canSeeConfidential = await this.permissions.hasAny(req.user, ['hr.documents.confidential.view', 'hr.employees.manage']).catch(() => false);
    const where: any = { companyId, employeeId: id };
    if (!canSeeConfidential) where.confidential = false;
    const docs = await this.prisma.employeeDocument.findMany({ where, orderBy: [{ title: 'asc' }, { version: 'desc' }] });
    return docs.map((d) => ({ ...d, expiryStatus: this.docStatus(d) }));
  }

  async createDocument(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    if (!dto.title) throw new BadRequestException('Document title is required');
    const doc = await this.prisma.employeeDocument.create({
      data: {
        companyId,
        employeeId: id,
        category: dto.category || 'OTHER',
        title: dto.title,
        fileName: dto.fileName,
        mime: dto.mime,
        size: toNum(dto.size),
        dataUrl: dto.dataUrl,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        description: dto.description,
        confidential: !!dto.confidential,
        uploadedById: req.user.sub,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'UPLOAD', 'EmployeeDocument', doc.id, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: id, category: doc.category, title: doc.title, confidential: doc.confidential } });
    await this.notify(companyId, { employeeId: id, type: 'DOCUMENT_UPLOADED', title: 'Document uploaded', body: doc.title, link: `/hr/employees/${id}?tab=documents` });
    return { ...doc, expiryStatus: this.docStatus(doc) };
  }

  async updateDocument(req: any, id: string, docId: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.employeeDocument.findFirst({ where: { id: docId, companyId, employeeId: id } });
    if (!existing) throw new NotFoundException('Document not found');
    const data: any = { ...dto };
    delete data.id; delete data.version; delete data.parentId;
    if (dto.issueDate) data.issueDate = new Date(dto.issueDate);
    if (dto.expiryDate) data.expiryDate = new Date(dto.expiryDate);
    const doc = await this.prisma.employeeDocument.update({ where: { id: docId }, data });
    await this.audit.log(companyId, req.user.sub, 'UPDATE', 'EmployeeDocument', docId, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: id } });
    return { ...doc, expiryStatus: this.docStatus(doc) };
  }

  async replaceDocument(req: any, id: string, docId: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.employeeDocument.findFirst({ where: { id: docId, companyId, employeeId: id } });
    if (!existing) throw new NotFoundException('Document not found');
    const rootId = existing.parentId || existing.id;
    const latest = await this.prisma.employeeDocument.findFirst({ where: { companyId, OR: [{ id: rootId }, { parentId: rootId }] }, orderBy: { version: 'desc' } });
    const nextVersion = (latest?.version || existing.version) + 1;
    const doc = await this.prisma.employeeDocument.create({
      data: {
        companyId,
        employeeId: id,
        category: existing.category,
        title: dto.title || existing.title,
        fileName: dto.fileName,
        mime: dto.mime,
        size: toNum(dto.size),
        dataUrl: dto.dataUrl,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : existing.issueDate,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : existing.expiryDate,
        description: dto.description ?? existing.description,
        confidential: existing.confidential,
        version: nextVersion,
        parentId: rootId,
        uploadedById: req.user.sub,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'REPLACE', 'EmployeeDocument', doc.id, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: id, previousId: docId, version: nextVersion } });
    return { ...doc, expiryStatus: this.docStatus(doc) };
  }

  async archiveDocument(req: any, id: string, docId: string) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.employeeDocument.findFirst({ where: { id: docId, companyId, employeeId: id } });
    if (!existing) throw new NotFoundException('Document not found');
    const doc = await this.prisma.employeeDocument.update({ where: { id: docId }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    await this.audit.log(companyId, req.user.sub, 'ARCHIVE', 'EmployeeDocument', docId, { module: 'hr', result: 'SUCCESS', metadata: { employeeId: id } });
    return { ...doc, expiryStatus: this.docStatus(doc) };
  }

  // ------------------------------------------------------------------
  // Assets
  // ------------------------------------------------------------------
  async assetsForEmployee(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    const assignments = await this.prisma.assetAssignment.findMany({ where: { companyId, employeeId: id }, include: { asset: true }, orderBy: { assignedDate: 'desc' } });
    return assignments;
  }

  async availableAssets(req: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.asset.findMany({
      where: { companyId, status: { not: 'DISPOSED' }, assignments: { none: { status: 'ASSIGNED' } } },
      orderBy: { name: 'asc' },
    });
  }

  async assignAsset(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    if (!dto.assetId) throw new BadRequestException('assetId is required');
    const asset = await this.prisma.asset.findFirst({ where: { id: dto.assetId, companyId } });
    if (!asset) throw new NotFoundException('Asset not found');
    const active = await this.prisma.assetAssignment.findFirst({ where: { companyId, assetId: dto.assetId, status: 'ASSIGNED' } });
    if (active) throw new BadRequestException('Asset is already assigned');
    const assignment = await this.prisma.assetAssignment.create({
      data: { companyId, assetId: dto.assetId, employeeId: id, assignedDate: dto.assignedDate ? new Date(dto.assignedDate) : new Date(), condition: dto.condition, location: dto.location, notes: dto.notes, acknowledged: !!dto.acknowledged, assignedById: req.user.sub },
      include: { asset: true },
    });
    await this.audit.log(companyId, req.user.sub, 'ASSIGN', 'AssetAssignment', assignment.id, { module: 'assets', result: 'SUCCESS', metadata: { employeeId: id, assetId: dto.assetId, assetNo: asset.assetNo } });
    await this.notify(companyId, { employeeId: id, type: 'ASSET_ASSIGNED', title: 'Asset assigned', body: `${asset.assetNo} · ${asset.name}`, link: `/hr/employees/${id}?tab=assets` });
    return assignment;
  }

  async returnAsset(req: any, id: string, assignmentId: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const assignment = await this.prisma.assetAssignment.findFirst({ where: { id: assignmentId, companyId, employeeId: id } });
    if (!assignment) throw new NotFoundException('Asset assignment not found');
    if (assignment.status === 'RETURNED') throw new BadRequestException('Asset already returned');
    const updated = await this.prisma.assetAssignment.update({
      where: { id: assignmentId },
      data: { status: 'RETURNED', returnedDate: dto.returnedDate ? new Date(dto.returnedDate) : new Date(), returnCondition: dto.condition, returnLocation: dto.location, returnNotes: dto.notes, returnedById: req.user.sub },
      include: { asset: true },
    });
    await this.audit.log(companyId, req.user.sub, 'RETURN', 'AssetAssignment', assignmentId, { module: 'assets', result: 'SUCCESS', metadata: { employeeId: id, assetId: assignment.assetId } });
    return updated;
  }

  // ------------------------------------------------------------------
  // Projects
  // ------------------------------------------------------------------
  async projectsForEmployee(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    const memberships = await this.prisma.projectMember.findMany({ where: { companyId, employeeId: id }, include: { project: { include: { tasks: true, customer: true } } }, orderBy: { createdAt: 'desc' } });
    const timesheets = await this.prisma.timesheet.findMany({ where: { companyId, employeeId: id }, include: { project: true } });
    const hoursByProject = timesheets.reduce((acc, t) => { acc[t.projectId] = round2((acc[t.projectId] || 0) + toNum(t.hours)); return acc; }, {} as Record<string, number>);
    const billableHours = round2(timesheets.filter((t) => t.billable).reduce((s, t) => s + toNum(t.hours), 0));
    const activeMemberships = memberships.filter((m) => m.status === 'ACTIVE');
    const openTasks = memberships.reduce((s, m) => s + m.project.tasks.filter((t) => t.status !== 'Done' && t.status !== 'COMPLETED').length, 0);
    const overdueTasks = memberships.reduce((s, m) => s + m.project.tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'Done' && t.status !== 'COMPLETED').length, 0);
    return {
      memberships: memberships.map((m) => ({ ...m, hours: hoursByProject[m.projectId] || 0 })),
      summary: { activeProjects: activeMemberships.length, openTasks, overdueTasks, billableHours },
    };
  }

  async availableProjects(req: any, employeeId?: string) {
    const companyId = companyIdOf(req.user);
    const projects = await this.prisma.project.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
    if (!employeeId) return projects;
    const memberships = await this.prisma.projectMember.findMany({ where: { companyId, employeeId, status: 'ACTIVE' }, select: { projectId: true } });
    const taken = new Set(memberships.map((m) => m.projectId));
    return projects.filter((p) => !taken.has(p.id));
  }

  async assignProject(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    if (!dto.projectId) throw new BadRequestException('projectId is required');
    const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, companyId } });
    if (!project) throw new NotFoundException('Project not found');
    const member = await this.prisma.projectMember.upsert({
      where: { projectId_employeeId: { projectId: dto.projectId, employeeId: id } },
      update: { role: dto.role, allocationPct: toNum(dto.allocationPct) || 100, startDate: dto.startDate ? new Date(dto.startDate) : undefined, endDate: dto.endDate ? new Date(dto.endDate) : undefined, billable: dto.billable ?? true, status: 'ACTIVE', notes: dto.notes },
      create: { companyId, projectId: dto.projectId, employeeId: id, role: dto.role || 'Member', allocationPct: toNum(dto.allocationPct) || 100, startDate: dto.startDate ? new Date(dto.startDate) : undefined, endDate: dto.endDate ? new Date(dto.endDate) : undefined, billable: dto.billable ?? true, notes: dto.notes },
      include: { project: true },
    });
    await this.audit.log(companyId, req.user.sub, 'ASSIGN', 'ProjectMember', member.id, { module: 'projects', result: 'SUCCESS', metadata: { employeeId: id, projectId: dto.projectId, role: member.role } });
    await this.notify(companyId, { employeeId: id, type: 'PROJECT_ASSIGNED', title: 'Assigned to project', body: project.name, link: `/hr/employees/${id}?tab=projects` });
    return member;
  }

  async endProjectMembership(req: any, memberId: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const member = await this.prisma.projectMember.findFirst({ where: { id: memberId, companyId } });
    if (!member) throw new NotFoundException('Project membership not found');
    const updated = await this.prisma.projectMember.update({ where: { id: memberId }, data: { status: 'ENDED', endDate: dto?.endDate ? new Date(dto.endDate) : new Date() } });
    await this.audit.log(companyId, req.user.sub, 'UNASSIGN', 'ProjectMember', memberId, { module: 'projects', result: 'SUCCESS', metadata: { employeeId: member.employeeId, projectId: member.projectId } });
    return updated;
  }

  async projectTasks(req: any, id: string, projectId: string) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, include: { tasks: { orderBy: { createdAt: 'desc' } } } });
    if (!project) throw new NotFoundException('Project not found');
    return project.tasks;
  }

  // ------------------------------------------------------------------
  // Audit
  // ------------------------------------------------------------------
  async auditForEmployee(req: any, id: string, q: any) {
    const companyId = companyIdOf(req.user);
    await this.employeeOrThrow(companyId, id);
    const where: any = { companyId, OR: [{ entityType: 'Employee', entityId: id }, { metadata: { path: ['employeeId'], equals: id } }] };
    if (q?.module) where.module = q.module;
    if (q?.action) where.action = q.action;
    if (q?.from || q?.to) { where.createdAt = {}; if (q.from) where.createdAt.gte = new Date(Number(q.from) || q.from); if (q.to) where.createdAt.lte = new Date(Number(q.to) || q.to); }
    const logs = await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } });
    const modules = Array.from(new Set(logs.map((l) => l.module || l.entityType)));
    return { logs, modules };
  }

  // ------------------------------------------------------------------
  // Offboarding
  // ------------------------------------------------------------------
  async offboardingChecklist(req: any, id: string) {
    const companyId = companyIdOf(req.user);
    const emp = await this.employeeOrThrow(companyId, id);
    const [assets, projects, leave, balances, payslips, documents, user] = await Promise.all([
      this.prisma.assetAssignment.findMany({ where: { companyId, employeeId: id, status: 'ASSIGNED' }, include: { asset: true } }),
      this.prisma.projectMember.findMany({ where: { companyId, employeeId: id, status: 'ACTIVE' }, include: { project: true } }),
      this.prisma.leaveRequest.findMany({ where: { companyId, employeeId: id, status: { in: ['PENDING', 'SUBMITTED', 'PENDING_APPROVAL'] } } }),
      this.hr.getLeaveBalances(companyId, id),
      this.prisma.payslip.findMany({ where: { employeeId: id, payrollRun: { companyId } }, include: { payrollRun: true } }),
      this.prisma.employeeDocument.count({ where: { companyId, employeeId: id, status: 'VALID' } }),
      this.prisma.user.findFirst({ where: { employeeId: id, memberships: { some: { companyId } } } }),
    ]);
    const leaveAvailable = balances.reduce((s: number, b: any) => s + toNum(b.available), 0);
    const blockers: string[] = [];
    if (assets.length) blockers.push(`${assets.length} asset(s) must be returned`);
    if (projects.length) blockers.push(`${projects.length} active project membership(s)`);
    if (leave.length) blockers.push(`${leave.length} pending leave request(s)`);
    return {
      employee: { id: emp.id, employeeNo: emp.employeeNo, name: `${emp.firstName} ${emp.lastName}` },
      assets, projects, leave, balances,
      leaveAvailable: round2(leaveAvailable),
      documents,
      payroll: { payslipCount: payslips.length, lastPaid: payslips[0] ? `${payslips[0].payrollRun.period}/${payslips[0].payrollRun.year}` : null },
      userAccount: user ? { id: user.id, email: user.email, status: user.status } : null,
      blockers,
    };
  }

  async createUserAccount(req: any, id: string, dto: any) {
    const companyId = companyIdOf(req.user);
    const tenantId = req.user.tenantId;
    const emp = await this.employeeOrThrow(companyId, id);
    if (!tenantId) throw new BadRequestException('Tenant context required');
    const existing = await this.prisma.user.findFirst({ where: { employeeId: id } });
    if (existing) throw new BadRequestException('Employee already has a user account');
    const email = dto?.email || emp.workEmail || emp.email;
    if (!email) throw new BadRequestException('An email is required to create a user account');
    const bcrypt = await import('bcryptjs');
    const tempPassword = dto?.password || Math.random().toString(36).slice(-10) + 'A1!';
    const passwordHash = await bcrypt.default.hash(tempPassword, 12);
    const user = await this.prisma.user.create({ data: { email, passwordHash, firstName: emp.firstName, lastName: emp.lastName, employeeId: id } });
    await this.prisma.membership.create({ data: { userId: user.id, tenantId, companyId, role: dto?.role || 'EMPLOYEE' } });
    await this.audit.log(companyId, req.user.sub, 'CREATE_USER', 'Employee', id, { module: 'admin', result: 'SUCCESS', metadata: { userId: user.id, email } });
    return { user: { id: user.id, email: user.email }, temporaryPassword: dto?.password ? undefined : tempPassword };
  }

  // ------------------------------------------------------------------
  // Offboard (enhanced with dependency warning)
  // ------------------------------------------------------------------
  async offboard(req: any, id: string, body: { reason?: string; terminationDate?: string; force?: boolean }) {
    const companyId = companyIdOf(req.user);
    const checklist = await this.offboardingChecklist(req, id);
    if (checklist.blockers.length && !body?.force) {
      throw new BadRequestException({ message: 'Offboarding has unresolved dependencies', blockers: checklist.blockers });
    }
    await this.prisma.employee.update({ where: { id }, data: { active: false, status: 'TERMINATED', employmentStatus: 'TERMINATED', contractEndDate: body?.terminationDate ? new Date(body.terminationDate) : new Date() } });
    await this.audit.log(companyId, req.user.sub, 'OFFBOARD', 'Employee', id, { module: 'hr', result: 'SUCCESS', reason: body?.reason, metadata: { employeeId: id, blockers: checklist.blockers } });
    return { ok: true };
  }
}
