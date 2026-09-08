import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { AttendanceDto, CompensationDto, EmployeeDto, IncentiveDto, LeaveDto, PayrollRunDto, PerformanceReviewDto, QaAssessmentDto, QaTemplateDto, StatutoryDto } from './hr.dto';
import { ApplicationDto, CandidateDto, DeclineDto, HireCandidateDto, InterviewDto, MoveStageDto, OfferDto, RejectApplicationDto, RequisitionDto, ScorecardDto, VacancyDto } from './recruitment.dto';
import { RecruitmentService } from './recruitment.service';
import { HrService } from './hr.service';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { PostingService } from '../finance/posting.service';
import { StatusDto } from '../sales/sales.dto';

const round2 = (n: number) => Number(n.toFixed(2));

@ApiTags('HR & Payroll') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('hr')
export class HrController {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService, private posting: PostingService, private recruitment: RecruitmentService, private hr: HrService) {}

  // ----- Employees -----
  @Get('employees') employees(@Req() req: any) {
    return this.prisma.employee.findMany({ where: { companyId: companyIdOf(req.user) }, include: { department: true, workCalendar: true } });
  }
  @Get('employees/:id') employeeDetail(@Req() req: any, @Param('id') id: string) {
    return this.prisma.employee.findFirst({ where: { id, companyId: companyIdOf(req.user) }, include: { department: true, workCalendar: true, leaveBalances: { include: { leaveType: true } }, employeeBenefits: { include: { plan: true } } } });
  }
  @Post('employees') async createEmployee(@Req() req: any, @Body() dto: EmployeeDto) {
    const companyId = companyIdOf(req.user);
    const employeeNo = dto.employeeNo || await this.numbering.next(companyId, 'EMP');
    const data: any = { companyId, departmentId: dto.departmentId, employeeNo, firstName: dto.firstName, middleName: dto.middleName, lastName: dto.lastName, preferredName: dto.preferredName, email: dto.email, workEmail: dto.workEmail, personalEmail: dto.personalEmail, phone: dto.phone, mobile: dto.mobile, hireDate: new Date(dto.hireDate), dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined, idType: dto.idType, idNumber: dto.idNumber, gender: dto.gender, nationality: dto.nationality, addressLine1: dto.addressLine1, addressLine2: dto.addressLine2, city: dto.city, province: dto.province, postalCode: dto.postalCode, country: dto.country, basicSalary: Number(dto.basicSalary), currency: dto.currency || 'USD', active: dto.active ?? true, position: dto.position, managerId: dto.managerId, contractType: dto.contractType, status: dto.status ?? 'ACTIVE', employmentStatus: dto.employmentStatus || 'ACTIVE', workCalendarId: dto.workCalendarId, probationEndDate: dto.probationEndDate ? new Date(dto.probationEndDate) : undefined, contractEndDate: dto.contractEndDate ? new Date(dto.contractEndDate) : undefined, payFrequency: dto.payFrequency || 'MONTHLY', compensationType: dto.compensationType || 'SALARIED', bankDetails: dto.bankDetails as any, taxDetails: dto.taxDetails as any, emergencyContact: dto.emergencyContact as any, allowances: dto.allowances as any, deductions: dto.deductions as any };
    const employee = await this.prisma.employee.create({ data });
    await this.prisma.compensationHistory.create({ data: { companyId, employeeId: employee.id, effectiveDate: new Date(dto.hireDate), baseSalary: Number(dto.basicSalary), currency: dto.currency || 'USD', payFrequency: dto.payFrequency || 'MONTHLY', compensationType: dto.compensationType || 'SALARIED', reason: 'Initial compensation', approvedById: req.user.sub } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Employee', employee.id, { employeeNo });
    return employee;
  }
  @Patch('employees/:id') updateEmployee(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<EmployeeDto>) {
    const data: any = { ...dto };
    if (dto.hireDate) data.hireDate = new Date(dto.hireDate);
    if (dto.dateOfBirth) data.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.probationEndDate) data.probationEndDate = new Date(dto.probationEndDate);
    if (dto.contractEndDate) data.contractEndDate = new Date(dto.contractEndDate);
    return this.prisma.employee.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @Post('employees/:id/offboard') async offboardEmployee(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string; terminationDate?: string }) {
    const companyId = companyIdOf(req.user);
    const emp = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!emp) throw new BadRequestException('Employee not found');
    await this.prisma.employee.update({ where: { id }, data: { active: false, status: 'TERMINATED', employmentStatus: 'TERMINATED', contractEndDate: body.terminationDate ? new Date(body.terminationDate) : new Date() } });
    await this.audit.log(companyId, req.user.sub, 'OFFBOARD', 'Employee', id, { reason: body.reason, terminationDate: body.terminationDate });
    return { ok: true };
  }
  @Get('employees/:id/compensation-history') compensationHistory(@Req() req: any, @Param('id') id: string) { return this.hr.getCompensationHistory(companyIdOf(req.user), id); }
  @Get('employees/:id/employment-history') employmentHistory(@Req() req: any, @Param('id') id: string) { return this.hr.getEmploymentHistory(companyIdOf(req.user), id); }
  @Get('employees/:id/leave-balances') employeeLeaveBalances(@Req() req: any, @Param('id') id: string) { return this.hr.getLeaveBalances(companyIdOf(req.user), id); }

  // ----- Departments -----
  @Get('departments') departments(@Req() req: any) {
    return this.prisma.department.findMany({ where: { branch: { companyId: companyIdOf(req.user) } }, include: { branch: true } });
  }
  @Post('departments') async createDepartment(@Req() req: any, @Body() dto: { branchId: string; name: string; code?: string }) {
    const companyId = companyIdOf(req.user);
    const branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, companyId } });
    if (!branch) throw new BadRequestException('Branch not found');
    const code = dto.code || await this.numbering.next(companyId, 'DEPT');
    const dept = await this.prisma.department.create({ data: { branchId: dto.branchId, name: dto.name, code } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Department', dept.id, { code });
    return dept;
  }
  @Patch('departments/:id') updateDepartment(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<{ name: string }>) {
    return this.prisma.department.updateMany({ where: { id, branch: { companyId: companyIdOf(req.user) } }, data: dto });
  }

  // ----- Leave -----
  @Get('leave-requests') leaveRequests(@Req() req: any) {
    return this.prisma.leaveRequest.findMany({ where: { companyId: companyIdOf(req.user) }, include: { employee: true, approver: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('leave-requests') async createLeave(@Req() req: any, @Body() dto: LeaveDto) {
    const companyId = companyIdOf(req.user);
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId } });
    if (!employee) throw new BadRequestException('Employee not found');
    const start = new Date(dto.startDate); const end = new Date(dto.endDate);
    const cal = employee.workCalendarId ? await this.prisma.workCalendar.findUnique({ where: { id: employee.workCalendarId } }) : null;
    const { days } = await this.hr.calculateLeaveDays(companyId, start, end, cal, dto.halfDay);
    if (days <= 0) throw new BadRequestException('Selected range contains no working days after excluding weekends and holidays');
    const leave = await this.prisma.leaveRequest.create({ data: { companyId, employeeId: dto.employeeId, leaveType: dto.leaveType || 'ANNUAL', leaveTypeId: dto.leaveTypeId, startDate: start, endDate: end, days, halfDay: dto.halfDay || 'FULL', workCalendarId: employee.workCalendarId, reason: dto.reason, attachment: dto.attachment, approverId: dto.approverId } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'LeaveRequest', leave.id, { days });
    return leave;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('hr.leave.approve')
  @Post('leave-requests/:id/status') updateLeaveStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    const companyId = companyIdOf(req.user);
    return this.prisma.leaveRequest.updateMany({ where: { id, companyId }, data: { status: dto.status, approvedBy: dto.status === 'APPROVED' ? req.user.sub : undefined, approvedAt: dto.status === 'APPROVED' ? new Date() : undefined } });
  }
  @Post('leave-requests/:id/approve') async approveLeaveReq(@Req() req: any, @Param('id') id: string, @Body() dto: { comments?: string }) {
    const companyId = companyIdOf(req.user);
    const leave = await this.prisma.leaveRequest.findFirst({ where: { id, companyId }, include: { employee: true } });
    if (!leave) throw new BadRequestException('Leave request not found');
    await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'APPROVED', approvedBy: req.user.sub, approvedAt: new Date(), comments: dto.comments } });
    await this.audit.log(companyId, req.user.sub, 'APPROVE', 'LeaveRequest', id, { days: Number(leave.days) });
    return { ok: true };
  }
  @Post('leave-requests/:id/reject') async rejectLeaveReq(@Req() req: any, @Param('id') id: string, @Body() dto: { comments?: string }) {
    const companyId = companyIdOf(req.user);
    const leave = await this.prisma.leaveRequest.findFirst({ where: { id, companyId } });
    if (!leave) throw new BadRequestException('Leave request not found');
    await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'REJECTED', approvedBy: req.user.sub, approvedAt: new Date(), comments: dto.comments } });
    await this.audit.log(companyId, req.user.sub, 'REJECT', 'LeaveRequest', id);
    return { ok: true };
  }
  @Delete('leave-requests/:id') async deleteLeave(@Req() req: any, @Param('id') id: string) {
    await this.prisma.leaveRequest.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Attendance -----
  @Get('attendance') attendance(@Req() req: any) {
    return this.prisma.attendance.findMany({ where: { companyId: companyIdOf(req.user) }, include: { employee: true }, orderBy: { date: 'desc' }, take: 300 });
  }
  @Get('attendance/exceptions') attendanceExceptions(@Req() req: any) { return this.hr.getAttendanceExceptions(companyIdOf(req.user)); }
  @Get('attendance/summary') attendanceSummary(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const companyId = companyIdOf(req.user);
    const start = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = to ? new Date(to) : new Date();
    return this.hr.attendanceSummary(companyId, start, end);
  }
  @Post('attendance') async createAttendance(@Req() req: any, @Body() dto: AttendanceDto) {
    const companyId = companyIdOf(req.user);
    const date = new Date(dto.date);
    const checkIn = dto.checkIn ? new Date(dto.checkIn) : undefined;
    const checkOut = dto.checkOut ? new Date(dto.checkOut) : undefined;
    if (dto.checkIn && isNaN(checkIn!.getTime())) throw new BadRequestException('Invalid check-in time');
    const calc = await this.hr.calculateAttendance(companyId, dto.employeeId, date, checkIn, checkOut, { status: dto.status });
    const record = await this.prisma.attendance.upsert({
      where: { companyId_employeeId_date: { companyId, employeeId: dto.employeeId, date } },
      update: { status: dto.status || 'PRESENT', checkIn, checkOut, scheduledStart: calc.scheduledStart, scheduledEnd: calc.scheduledEnd, breakMinutes: calc.breakMinutes, workedHours: calc.workedHours, regularHours: calc.regularHours, overtimeHours: calc.overtimeHours, lateMinutes: calc.lateMinutes, earlyDeparture: calc.earlyDeparture, note: dto.note, source: 'MANUAL' },
      create: { companyId, employeeId: dto.employeeId, date, status: dto.status || 'PRESENT', checkIn, checkOut, scheduledStart: calc.scheduledStart, scheduledEnd: calc.scheduledEnd, breakMinutes: calc.breakMinutes, workedHours: calc.workedHours, regularHours: calc.regularHours, overtimeHours: calc.overtimeHours, lateMinutes: calc.lateMinutes, earlyDeparture: calc.earlyDeparture, note: dto.note, source: 'MANUAL' },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Attendance', record.id, { date: dto.date, workedHours: calc.workedHours });
    return record;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('hr.attendance.manage')
  @Patch('attendance/:id') updateAttendance(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<AttendanceDto>) {
    const data: any = { ...dto };
    if (dto.checkIn) data.checkIn = new Date(dto.checkIn);
    if (dto.checkOut) data.checkOut = new Date(dto.checkOut);
    return this.prisma.attendance.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('hr.attendance.manage')
  @Post('attendance/:id/approve') approveAttendance(@Req() req: any, @Param('id') id: string, @Body() dto: { approved?: boolean; note?: string }) {
    const companyId = companyIdOf(req.user);
    return this.prisma.attendance.updateMany({ where: { id, companyId }, data: { approved: dto.approved ?? true, approvedBy: req.user.sub, note: dto.note } });
  }

  // ----- Payroll -----
  @Get('payroll-runs') payrollRuns(@Req() req: any) {
    return this.prisma.payrollRun.findMany({ where: { companyId: companyIdOf(req.user) }, orderBy: [{ year: 'desc' }, { period: 'desc' }], include: { _count: { select: { payslips: true } } } });
  }
  @Post('payroll-runs') async createPayrollRun(@Req() req: any, @Body() dto: PayrollRunDto) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.payrollRun.findUnique({ where: { companyId_period_year: { companyId, period: dto.period, year: dto.year } } });
    if (existing) throw new BadRequestException('Payroll run already exists for this period');
    const run = await this.prisma.payrollRun.create({ data: { companyId, period: dto.period, year: dto.year, payDate: dto.payDate ? new Date(dto.payDate) : undefined } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'PayrollRun', run.id, { period: dto.period, year: dto.year });
    return run;
  }
  @UseGuards(PermissionsGuard)
  @RequirePermissions('payroll.process')
  @Post('payroll-runs/:id/process') async processPayroll(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const run = await this.prisma.payrollRun.findFirst({ where: { id, companyId } });
    if (!run) throw new BadRequestException('Payroll run not found');
    if (run.status === 'LOCKED') throw new BadRequestException('Payroll run is locked');
    const employees = await this.prisma.employee.findMany({ where: { companyId, active: true } });
    if (!employees.length) throw new BadRequestException('No active employees');
    // Approved performance incentives assigned to this payroll month become payslip inputs (source: INC reference). Never duplicated:
    // incentives already attached to THIS run are re-included on reprocess; incentives attached to any other run are excluded.
    const runRef = `PAYROLL-${run.year}-${run.period}`;
    const approvedIncentives = await this.prisma.performanceIncentive.findMany({
      where: { companyId, OR: [{ status: 'APPROVED' }, { status: { in: ['SENT_TO_PAYROLL', 'PAID'] }, payrollInputRef: runRef }] },
    });
    const byEmployee = new Map<string, any[]>();
    for (const inc of approvedIncentives) {
      const assessment = await this.prisma.employeePerformanceAssessment.findUnique({ where: { id: inc.assessmentId }, include: { cycle: true } });
      const ref = inc.payrollInputRef || inc.reference;
      // Assignment: incentive approved before this run, not yet attached to another run.
      if (assessment) {
        const periodEnd = new Date(assessment.cycle.periodEnd);
        const periodMonth = periodEnd.getMonth() + 1;
        const periodYear = periodEnd.getFullYear();
        if (periodMonth !== run.period || periodYear !== run.year) continue;
      }
      const list = byEmployee.get(inc.employeeId) || [];
      list.push(inc);
      byEmployee.set(inc.employeeId, list);
    }
    let totalGross = 0, totalDeductions = 0, totalNet = 0, totalEmployerNssa = 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.payslip.deleteMany({ where: { payrollRunId: run.id } });
      for (const e of employees) {
        const incentives = byEmployee.get(e.id) || [];
        const bonusTotal = incentives.reduce((s, i) => s + Number(i.amount), 0);
        const allowances = { ...((e.allowances as any) || {}) };
        if (incentives.length) allowances['Performance Bonus'] = Number((allowances['Performance Bonus'] || 0)) + bonusTotal;
        const allowanceTotal = Object.values(allowances).reduce((s: number, v: any) => s + Number(v || 0), 0);
        const otherDeductionsRaw = (e.deductions as any) || {};
        const otherDeductions = Object.values(otherDeductionsRaw).reduce((s: number, v: any) => s + Number(v || 0), 0);
        const gross = Number(e.basicSalary) + allowanceTotal;
        const stat = await this.statutory(companyId, gross, new Date(run.year, run.period - 1, 28));
        const net = gross - stat.paye - stat.employeeNssa - otherDeductions;
        totalGross += gross; totalDeductions += stat.paye + stat.employeeNssa + otherDeductions; totalNet += net; totalEmployerNssa += stat.employerNssa;
        const bonusRefs = incentives.map((i) => ({ reference: i.reference, amount: Number(i.amount), assessmentId: i.assessmentId, score: Number(i.finalScore), cycle: i.planName }));
        await tx.payslip.create({ data: { payrollRunId: run.id, employeeId: e.id, basicSalary: round2(Number(e.basicSalary)), grossPay: round2(gross), payeTax: stat.paye, nssaDeduction: stat.employeeNssa, otherDeductions: round2(otherDeductions), netPay: round2(net), employeeNssa: stat.employeeNssa, employerNssa: stat.employerNssa, allowances, deductions: otherDeductionsRaw, bonusAmount: round2(bonusTotal), bonusReferences: bonusRefs.length ? bonusRefs : undefined } });
        for (const inc of incentives) {
          await tx.performanceIncentive.update({ where: { id: inc.id }, data: { status: 'SENT_TO_PAYROLL', payrollInputRef: `PAYROLL-${run.year}-${run.period}`, paidAt: null } });
        }
      }
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'PROCESSED', processedAt: new Date(), employeeCount: employees.length, totalGross: round2(totalGross), totalDeductions: round2(totalDeductions), totalNet: round2(totalNet) } });
    });
    await this.prisma.performanceIncentive.updateMany({ where: { companyId, status: 'SENT_TO_PAYROLL', payrollInputRef: `PAYROLL-${run.year}-${run.period}` }, data: { paidAt: new Date() } });
    await this.posting.postJournal(companyId, {
      date: new Date(run.year, run.period - 1, 28), description: `Payroll ${run.period}/${run.year}`, reference: `PR-${run.year}-${run.period}`, sourceType: 'PAYROLL', sourceId: run.id,
      lines: [
        { code: '6000', debit: round2(totalGross + totalEmployerNssa), credit: 0, description: 'Payroll expense (incl. employer NSSA)' },
        { code: '1000', debit: 0, credit: round2(totalNet), description: 'Net pay' },
        ...(round2(totalDeductions + totalEmployerNssa) > 0 ? [{ code: '2000', debit: 0, credit: round2(totalDeductions + totalEmployerNssa), description: 'Statutory deductions payable' }] : []),
      ],
    });
    await this.audit.log(companyId, req.user.sub, 'PROCESS', 'PayrollRun', run.id, { period: run.period, year: run.year });
    return this.prisma.payrollRun.findUnique({ where: { id: run.id }, include: { payslips: { include: { employee: true } } } });
  }
  @Post('payroll-runs/:id/lock') lockPayroll(@Req() req: any, @Param('id') id: string) {
    return this.prisma.payrollRun.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { status: 'LOCKED' } });
  }
  @Get('payroll-runs/:id/payslips') payslips(@Req() req: any, @Param('id') id: string) {
    return this.prisma.payslip.findMany({ where: { payrollRun: { id, companyId: companyIdOf(req.user) } }, include: { employee: true } });
  }
  @Get('payslips') allPayslips(@Req() req: any) {
    return this.prisma.payslip.findMany({ where: { payrollRun: { companyId: companyIdOf(req.user) } }, include: { employee: { include: { department: true } }, payrollRun: true }, orderBy: { id: 'desc' } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('payroll.payslips.publish')
  @Post('payslips/:id/publish') async publishPayslip(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const ps = await this.prisma.payslip.findFirst({ where: { id, payrollRun: { companyId } } });
    if (!ps) throw new BadRequestException('Payslip not found');
    if (ps.status === 'VOID') throw new BadRequestException('Cannot publish a void payslip');
    const updated = await this.prisma.payslip.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: ps.publishedAt || new Date() } });
    await this.audit.log(companyId, req.user.sub, 'PUBLISH', 'Payslip', id);
    return updated;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('payroll.payslips.publish')
  @Post('payslips/:id/void') async voidPayslip(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const ps = await this.prisma.payslip.findFirst({ where: { id, payrollRun: { companyId } } });
    if (!ps) throw new BadRequestException('Payslip not found');
    if (ps.status === 'VOID') throw new BadRequestException('Payslip is already void');
    const updated = await this.prisma.payslip.update({ where: { id }, data: { status: 'VOID' } });
    await this.audit.log(companyId, req.user.sub, 'VOID', 'Payslip', id);
    return updated;
  }

  // ----- Statutory rules -----
  @Get('statutory-rules') rules() { return this.prisma.statutoryRule.findMany({ where: { active: true }, orderBy: { validFrom: 'desc' } }); }
  @Post('statutory-rules') async createRule(@Body() dto: StatutoryDto) {
    const rule = await this.prisma.statutoryRule.create({ data: { country: dto.country, authority: dto.authority, code: dto.code, name: dto.name, validFrom: new Date(dto.validFrom), validTo: dto.validTo ? new Date(dto.validTo) : undefined, configuration: dto.configuration } });
    return rule;
  }
  @Patch('statutory-rules/:id') updateRule(@Param('id') id: string, @Body() dto: Partial<StatutoryDto>) {
    const data: any = { ...dto };
    if (dto.validFrom) data.validFrom = new Date(dto.validFrom);
    if (dto.validTo) data.validTo = new Date(dto.validTo);
    return this.prisma.statutoryRule.update({ where: { id }, data });
  }

  @Get('hr-report') async hrReport(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const [total, departments, byDept, payrollCost] = await Promise.all([
      this.prisma.employee.count({ where: { companyId, active: true } }),
      this.prisma.department.count({ where: { branch: { companyId } } }),
      this.prisma.employee.groupBy({ by: ['departmentId'], where: { companyId, active: true }, _count: true }),
      this.prisma.employee.aggregate({ where: { companyId, active: true }, _sum: { basicSalary: true } }),
    ]);
    return { total, departments, byDept, monthlyPayrollCost: Number(payrollCost._sum.basicSalary || 0) };
  }

  private async statutory(companyId: string, gross: number, date: Date) {
    const rules = await this.prisma.statutoryRule.findMany({ where: { active: true, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] } });
    const payeRule = rules.find((r) => r.code === 'PAYE');
    if (!payeRule) throw new BadRequestException('PAYE statutory rule is not configured. Configure it under HR → Payroll Rules before processing payroll.');
    let paye = 0;
    const brackets: any[] = (payeRule.configuration as any)?.brackets || [];
    for (const b of brackets) {
      const from = Number(b.from || 0);
      const to = b.to == null ? Infinity : Number(b.to);
      if (gross > from) paye += (Math.min(gross, to) - from) * Number(b.rate || 0);
    }
    const nssaRule = rules.find((r) => r.code === 'NSSA');
    const cfg: any = (nssaRule?.configuration as any) || {};
    const nssaBase = nssaRule ? Math.min(gross, Number(cfg.cap || 0)) : 0;
    return { paye: round2(paye), employeeNssa: round2(nssaBase * Number(cfg.employeePct || 0)), employerNssa: round2(nssaBase * Number(cfg.employerPct || 0)) };
  }

  // ----- Statutory & payroll rules -----
  @UseGuards(PermissionsGuard) @RequirePermissions('payroll.view')
  @Get('statutory-rules') statutoryRules() {
    return this.prisma.statutoryRule.findMany({ orderBy: { validFrom: 'desc' } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('payroll.process')
  @Post('statutory-rules') async createStatutory(@Req() req: any, @Body() body: any) {
    return this.prisma.statutoryRule.create({ data: { country: body.country || 'ZW', authority: body.authority || 'ZIMRA', code: body.code, name: body.name, validFrom: body.validFrom ? new Date(body.validFrom) : new Date(), validTo: body.validTo ? new Date(body.validTo) : undefined, configuration: body.configuration || {} } });
  }

  // ----- Recruitment -----
  @Get('recruitment/dashboard') dashboard(@Req() req: any) { return this.recruitment.dashboard(req); }

  // Requisitions
  @Get('recruitment/requisitions') requisitions(@Req() req: any) {
    return this.prisma.recruitmentRequisition.findMany({ where: { companyId: companyIdOf(req.user) }, include: { department: true, branch: true, hiredManager: true, vacancies: true, activities: { orderBy: { at: 'desc' } } }, orderBy: { createdAt: 'desc' } });
  }
  @Get('recruitment/requisitions/:id') requisition(@Req() req: any, @Param('id') id: string) {
    return this.prisma.recruitmentRequisition.findFirst({ where: { id, companyId: companyIdOf(req.user) }, include: { department: true, branch: true, hiredManager: true, requestedBy: true, project: true, vacancies: true, activities: { orderBy: { at: 'desc' } } } });
  }
  @Post('recruitment/requisitions') createRequisition(@Req() req: any, @Body() dto: RequisitionDto) { return this.recruitment.createRequisition(req, dto); }
  @Patch('recruitment/requisitions/:id') updateRequisition(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<RequisitionDto>) {
    const data: any = { ...dto };
    if (dto.targetStartDate) data.targetStartDate = new Date(dto.targetStartDate);
    if (dto.salaryMin != null) data.salaryMin = Number(dto.salaryMin);
    if (dto.salaryMax != null) data.salaryMax = Number(dto.salaryMax);
    return this.prisma.recruitmentRequisition.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @Post('recruitment/requisitions/:id/submit') submitRequisition(@Req() req: any, @Param('id') id: string) { return this.recruitment.submitRequisition(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('recruitment.requisitions.approve')
  @Post('recruitment/requisitions/:id/approve') approveRequisition(@Req() req: any, @Param('id') id: string) { return this.recruitment.approveRequisition(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('recruitment.requisitions.approve')
  @Post('recruitment/requisitions/:id/reject') rejectRequisition(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) { return this.recruitment.rejectRequisition(req, id, body?.reason || ''); }

  // Vacancies
  @Get('recruitment/vacancies') vacancies(@Req() req: any) {
    return this.prisma.jobVacancy.findMany({ where: { companyId: companyIdOf(req.user) }, include: { department: true, branch: true, hiringManager: true, recruiter: true, requisition: true, _count: { select: { applications: true } } }, orderBy: { postedAt: 'desc' } });
  }
  @Get('recruitment/vacancies/:id') vacancy(@Req() req: any, @Param('id') id: string) {
    return this.prisma.jobVacancy.findFirst({ where: { id, companyId: companyIdOf(req.user) }, include: { department: true, branch: true, hiringManager: true, recruiter: true, requisition: true, applications: { include: { candidate: true } }, assessments: true } });
  }
  @Post('recruitment/vacancies') async createVacancy(@Req() req: any, @Body() dto: VacancyDto) {
    const companyId = companyIdOf(req.user);
    const vacancyNo = dto.vacancyNo || await this.numbering.next(companyId, 'VAC');
    let data: any = { ...dto, companyId, vacancyNo };
    if (dto.targetStartDate) data.targetStartDate = new Date(dto.targetStartDate);
    if (dto.closingDate) data.closingDate = new Date(dto.closingDate);
    if (dto.salaryMin != null) data.salaryMin = Number(dto.salaryMin);
    if (dto.salaryMax != null) data.salaryMax = Number(dto.salaryMax);
    const vac = await this.prisma.jobVacancy.create({ data });
    if (dto.requisitionId) await this.prisma.recruitmentRequisition.update({ where: { id: dto.requisitionId }, data: { status: 'APPROVED' } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'JobVacancy', vac.id, { vacancyNo });
    return vac;
  }
  @Patch('recruitment/vacancies/:id') updateVacancy(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<VacancyDto>) {
    const data: any = { ...dto };
    if (dto.targetStartDate) data.targetStartDate = new Date(dto.targetStartDate);
    if (dto.closingDate) data.closingDate = new Date(dto.closingDate);
    if (dto.salaryMin != null) data.salaryMin = Number(dto.salaryMin);
    if (dto.salaryMax != null) data.salaryMax = Number(dto.salaryMax);
    return this.prisma.jobVacancy.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }

  // Candidates (structured, no raw JSON)
  @Get('recruitment/candidates') candidates(@Req() req: any) {
    return this.prisma.candidate.findMany({ where: { companyId: companyIdOf(req.user) }, include: { applications: { include: { vacancy: true } }, talentPool: true, employee: true }, orderBy: { createdAt: 'desc' } });
  }
  @Get('recruitment/candidates/:id') candidate(@Req() req: any, @Param('id') id: string) {
    return this.prisma.candidate.findFirst({ where: { id, companyId: companyIdOf(req.user) }, include: { applications: { include: { vacancy: true } }, documents: true, activities: { orderBy: { at: 'desc' } }, employee: true, talentPool: true } });
  }
  @Post('recruitment/candidates') async createCandidate(@Req() req: any, @Body() dto: CandidateDto) {
    const companyId = companyIdOf(req.user);
    const name = dto.name || `${dto.firstName} ${dto.lastName}`.trim();
    const candidateNo = dto.candidateNo || await this.numbering.next(companyId, 'CAN');
    const existing = await this.prisma.candidate.findFirst({ where: { companyId, email: dto.email } });
    const cand = await this.prisma.candidate.create({
      data: { companyId, candidateNo, firstName: dto.firstName, lastName: dto.lastName, name, email: dto.email, phone: dto.phone, mobile: dto.mobile, location: dto.location, currentPosition: dto.currentPosition, currentEmployer: dto.currentEmployer, yearsExperience: dto.yearsExperience, noticePeriod: dto.noticePeriod, expectedCompensation: dto.expectedCompensation, currency: dto.currency || 'USD', availability: dto.availability, source: dto.source, referralId: dto.referralId, agencyId: dto.agencyId, skills: dto.skills, education: dto.education, experience: dto.experience, certifications: dto.certifications, languages: dto.languages, portfolio: dto.portfolio, resumeUrl: dto.resumeUrl, notes: dto.notes, status: dto.status || 'LEAD', talentPoolId: dto.talentPoolId, activities: { create: { companyId, type: 'CANDIDATE_CREATED', message: `Candidate ${candidateNo} created`, actorId: req.user.sub } } },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Candidate', cand.id, { candidateNo });
    return { ...cand, duplicatedEmail: !!existing };
  }
  @Patch('recruitment/candidates/:id') updateCandidate(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<CandidateDto>) {
    const data: any = { ...dto };
    if (dto.firstName && dto.lastName) data.name = `${dto.firstName} ${dto.lastName}`.trim();
    if (dto.expectedCompensation != null) data.expectedCompensation = Number(dto.expectedCompensation);
    return this.prisma.candidate.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }

  // Applications
  @Get('recruitment/applications') applications(@Req() req: any) {
    return this.prisma.jobApplication.findMany({ where: { companyId: companyIdOf(req.user) }, include: { vacancy: true, candidate: true, owner: true, interviews: { orderBy: { scheduledAt: 'desc' } }, offer: true, stageHistory: { orderBy: { at: 'asc' } } }, orderBy: { appliedAt: 'desc' } });
  }
  @Get('recruitment/applications/:id') applicationDetail(@Req() req: any, @Param('id') id: string) {
    return this.prisma.jobApplication.findFirst({ where: { id, companyId: companyIdOf(req.user) }, include: { vacancy: true, candidate: true, owner: true, interviews: { include: { scorecards: true } }, offer: true, assessments: true, activities: { orderBy: { at: 'desc' } }, stageHistory: { orderBy: { at: 'asc' } } } });
  }
  @Post('recruitment/applications') async createApplication(@Req() req: any, @Body() dto: ApplicationDto) {
    const companyId = companyIdOf(req.user);
    const dup = await this.prisma.jobApplication.findFirst({ where: { companyId, vacancyId: dto.vacancyId, candidateId: dto.candidateId, status: { in: ['ACTIVE', 'APPLIED', 'INTERVIEW', 'OFFER'] } } });
    if (dup) throw new BadRequestException('This candidate already has an active application for this vacancy.');
    const applicationNo = dto.applicationNo || await this.numbering.next(companyId, 'APP');
    return this.prisma.jobApplication.create({ data: { companyId, applicationNo, vacancyId: dto.vacancyId, candidateId: dto.candidateId, ownerId: dto.ownerId, source: dto.source, notes: dto.notes, stage: 'APPLIED', status: 'ACTIVE', activities: { create: { companyId, type: 'APPLICATION_RECEIVED', message: `Application ${applicationNo} received`, actorId: req.user.sub } } } });
  }
  @Patch('recruitment/applications/:id') updateApplication(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.prisma.jobApplication.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { ...body } });
  }
  @Post('recruitment/applications/:id/stage') moveStage(@Req() req: any, @Param('id') id: string, @Body() dto: MoveStageDto) { return this.recruitment.moveStage(req, id, dto.stage, dto.comment); }
  @Post('recruitment/applications/:id/reject') rejectApplication(@Req() req: any, @Param('id') id: string, @Body() dto: RejectApplicationDto) {
    return this.recruitment.moveStage(req, id, 'REJECTED', `${dto.reason}${dto.notes ? ` — ${dto.notes}` : ''}`);
  }
  @Post('recruitment/applications/:id/withdraw') withdrawApplication(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.prisma.jobApplication.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { status: 'WITHDRAWN' } });
  }

  // Interviews
  @Get('recruitment/interviews') interviews(@Req() req: any) {
    return this.prisma.interview.findMany({ where: { companyId: companyIdOf(req.user) }, include: { application: { include: { candidate: true, vacancy: true } }, scorecards: true }, orderBy: { scheduledAt: 'desc' } });
  }
  @Post('recruitment/interviews') async createInterview(@Req() req: any, @Body() dto: InterviewDto) {
    const companyId = companyIdOf(req.user);
    const interviewNo = dto.interviewNo || await this.numbering.next(companyId, 'INT');
    const interview = await this.prisma.interview.create({ data: { companyId, interviewNo, applicationId: dto.applicationId, interviewType: dto.interviewType || 'HR', status: dto.status || 'SCHEDULED', scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined, startTime: dto.startTime, endTime: dto.endTime, timezone: dto.timezone, location: dto.location, interviewers: dto.interviewers, agenda: dto.agenda, notes: dto.notes, result: dto.result, decision: dto.decision } });
    if (dto.applicationId) await this.prisma.recruitmentActivity.create({ data: { companyId, applicationId: dto.applicationId, type: 'INTERVIEW_SCHEDULED', message: `Interview ${interviewNo} scheduled`, actorId: req.user.sub } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Interview', interview.id, { interviewNo });
    return interview;
  }
  @Patch('recruitment/interviews/:id') updateInterview(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<InterviewDto>) {
    const data: any = { ...dto };
    delete data.interviewers;
    if (dto.scheduledAt) data.scheduledAt = new Date(dto.scheduledAt);
    return this.prisma.interview.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @Post('recruitment/interviews/:id/scorecard') async addScorecard(@Req() req: any, @Param('id') id: string, @Body() dto: ScorecardDto) {
    const companyId = companyIdOf(req.user);
    return this.prisma.interviewScorecard.create({ data: { companyId, interviewId: id, reviewerId: dto.reviewerId, competencies: dto.competencies, overall: dto.overall, recommendation: dto.recommendation, comments: dto.comments } });
  }

  // Assessments
  @Get('recruitment/assessments') assessments(@Req() req: any) {
    return this.prisma.assessment.findMany({ where: { companyId: companyIdOf(req.user) }, include: { application: { include: { candidate: true, vacancy: true } } }, orderBy: { assignedAt: 'desc' } });
  }
  @Post('recruitment/assessments') async createAssessment(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.assessment.create({ data: { companyId, applicationId: body.applicationId, candidateId: body.candidateId, vacancyId: body.vacancyId, assessmentType: body.assessmentType || 'TECHNICAL', dueAt: body.dueAt ? new Date(body.dueAt) : undefined, completedAt: body.completedAt ? new Date(body.completedAt) : undefined, evaluatorId: body.evaluatorId, score: body.score, criteria: body.criteria, result: body.result, attachmentUrl: body.attachmentUrl, notes: body.notes } });
  }

  // Offers
  @Get('recruitment/offers') offers(@Req() req: any) {
    return this.prisma.offer.findMany({ where: { companyId: companyIdOf(req.user) }, include: { application: { include: { candidate: true, vacancy: true } }, department: true, manager: true }, orderBy: { offeredAt: 'desc' } });
  }
  @Post('recruitment/offers') createOffer(@Req() req: any, @Body() dto: OfferDto) { return this.recruitment.createOffer(req, dto); }
  @Patch('recruitment/offers/:id') updateOffer(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<OfferDto>) {
    const data: any = { ...dto };
    delete data.applicationId; delete data.baseSalary;
    if (dto.baseSalary != null) data.baseSalary = Number(dto.baseSalary);
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.expiryDate) data.expiryDate = new Date(dto.expiryDate);
    return this.prisma.offer.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('recruitment.offers.create')
  @Post('recruitment/offers/:id/submit') submitOffer(@Req() req: any, @Param('id') id: string) { return this.recruitment.submitOfferApproval(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('recruitment.offers.approve')
  @Post('recruitment/offers/:id/approve') approveOffer(@Req() req: any, @Param('id') id: string) { return this.recruitment.approveOffer(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('recruitment.offers.send')
  @Post('recruitment/offers/:id/send') sendOffer(@Req() req: any, @Param('id') id: string) { return this.recruitment.sendOffer(req, id); }
  @Post('recruitment/offers/:id/accept') acceptOffer(@Req() req: any, @Param('id') id: string) { return this.recruitment.acceptOffer(req, id); }
  @Post('recruitment/offers/:id/decline') declineOffer(@Req() req: any, @Param('id') id: string, @Body() dto: DeclineDto) { return this.recruitment.declineOffer(req, id, dto.reason); }
  @UseGuards(PermissionsGuard) @RequirePermissions('recruitment.offers.create')
  @Post('recruitment/offers/:id/withdraw') withdrawOffer(@Req() req: any, @Param('id') id: string) { return this.recruitment.withdrawOffer(req, id); }

  // Hire / conversion
  @UseGuards(PermissionsGuard) @RequirePermissions('recruitment.hire')
  @Post('recruitment/applications/:id/hire') hireCandidate(@Req() req: any, @Param('id') id: string, @Body() dto: HireCandidateDto) { return this.recruitment.hireCandidate(req, id, dto); }

  // Talent pools
  @Get('recruitment/talent-pools') talentPools(@Req() req: any) {
    return this.prisma.talentPool.findMany({ where: { companyId: companyIdOf(req.user) }, include: { _count: { select: { candidates: true } } } });
  }
  @Post('recruitment/talent-pools') createTalentPool(@Req() req: any, @Body() body: { name: string; description?: string }) {
    return this.prisma.talentPool.create({ data: { companyId: companyIdOf(req.user), name: body.name, description: body.description } });
  }
  @Patch('recruitment/candidates/:id/pool') setCandidatePool(@Req() req: any, @Param('id') id: string, @Body() body: { talentPoolId?: string }) {
    return this.prisma.candidate.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { talentPoolId: body.talentPoolId } });
  }

  // Candidate documents
  @Post('recruitment/candidates/:id/documents') addCandidateDocument(@Req() req: any, @Param('id') id: string, @Body() body: { documentType?: string; name?: string; url?: string }) {
    return this.prisma.candidateDocument.create({ data: { companyId: companyIdOf(req.user), candidateId: id, documentType: body.documentType || 'RESUME', name: body.name || 'Document', url: body.url } });
  }

  // ----- Onboarding -----
  @Get('onboarding-templates') onboardingTemplates(@Req() req: any) { return this.prisma.onboardingTemplate.findMany({ where: { companyId: companyIdOf(req.user) }, include: { tasks: true } }); }
  @Post('onboarding-templates') createOnboardingTemplate(@Req() req: any, @Body() body: any) {
    return this.prisma.onboardingTemplate.create({ data: { companyId: companyIdOf(req.user), name: body.name, tasks: { create: (body.tasks || []).map((t: any) => ({ title: t.title, dueInDays: Number(t.dueInDays || 0) })) } }, include: { tasks: true } });
  }
  @Get('employee-onboardings') employeeOnboardings(@Req() req: any) { return this.prisma.employeeOnboarding.findMany({ where: { companyId: companyIdOf(req.user) }, include: { employee: true, template: { include: { tasks: true } } }, orderBy: { startedAt: 'desc' } }); }
  @Post('employees/:id/onboarding') startOnboarding(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.employeeOnboarding.upsert({ where: { employeeId: id }, update: { templateId: body.templateId, status: 'IN_PROGRESS' }, create: { companyId, employeeId: id, templateId: body.templateId } });
  }
  @Patch('employee-onboardings/:id') updateOnboarding(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.prisma.employeeOnboarding.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { status: body.status, taskStatus: body.taskStatus, completedAt: body.status === 'COMPLETED' ? new Date() : undefined } });
  }

  // ----- Leave -----
  @Get('leave-types') leaveTypes(@Req() req: any) { return this.prisma.leaveType.findMany({ where: { companyId: companyIdOf(req.user) }, include: { policy: true } }); }
  @Post('leave-types') createLeaveType(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.leaveType.create({ data: { companyId, code: body.code, name: body.name, daysPerYear: Number(body.daysPerYear || 20), active: body.active ?? true, policy: body.policy ? { create: { companyId, maxCarryOver: Number(body.policy.maxCarryOver || 0), accrualPerMonth: Number(body.policy.accrualPerMonth || 0) } } : undefined } });
  }
  @Get('leave-policies') leavePolicies(@Req() req: any) { return this.prisma.leavePolicy.findMany({ where: { companyId: companyIdOf(req.user) }, include: { leaveType: true } }); }
  @Get('leave-balances') leaveBalances(@Req() req: any) { return this.prisma.leaveBalance.findMany({ where: { companyId: companyIdOf(req.user) }, include: { employee: true, leaveType: true } }); }
  @Post('leave-balances/accrue') accrueLeave(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.leaveBalance.upsert({ where: { companyId_employeeId_leaveTypeId: { companyId, employeeId: body.employeeId, leaveTypeId: body.leaveTypeId } }, update: { balance: { increment: Number(body.days || 0) } }, create: { companyId, employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, balance: Number(body.days || 0) } });
  }
  @Post('leave-requests/:id/status') approveLeave(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.leaveRequest.updateMany({ where: { id, companyId }, data: { status: body.status, approvedBy: req.user.sub, approvedAt: new Date() } });
  }

  // ----- Benefits -----
  @Get('benefit-plans') benefitPlans(@Req() req: any) { return this.prisma.benefitPlan.findMany({ where: { companyId: companyIdOf(req.user) } }); }
  @Post('benefit-plans') createBenefitPlan(@Req() req: any, @Body() body: any) { return this.prisma.benefitPlan.create({ data: { companyId: companyIdOf(req.user), name: body.name, type: body.type || 'MEDICAL', taxable: body.taxable ?? false, employerContribution: Number(body.employerContribution || 0) } }); }
  @Get('employee-benefits') employeeBenefits(@Req() req: any) { return this.prisma.employeeBenefit.findMany({ where: { companyId: companyIdOf(req.user) }, include: { employee: true, plan: true } }); }
  @Post('employee-benefits') createEmployeeBenefit(@Req() req: any, @Body() body: any) { return this.prisma.employeeBenefit.create({ data: { companyId: companyIdOf(req.user), employeeId: body.employeeId, planId: body.planId, amount: Number(body.amount || 0) } }); }

  // ----- Leave calendar / holidays / work calendars -----
  @Get('leave-requests/calendar') async leaveCalendar(@Req() req: any, @Query('month') month?: string) {
    const companyId = companyIdOf(req.user);
    const base = month ? new Date(month) : new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    const [requests, holidays] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where: { companyId, status: { in: ['APPROVED', 'PENDING', 'SUBMITTED', 'PENDING_APPROVAL'] }, startDate: { lte: end }, endDate: { gte: start } }, include: { employee: true } }),
      this.prisma.holiday.findMany({ where: { companyId, active: true, date: { gte: start, lte: end } } }),
    ]);
    return { month: base.toISOString(), requests, holidays };
  }
  @Get('work-calendars') workCalendars(@Req() req: any) { return this.prisma.workCalendar.findMany({ where: { companyId: companyIdOf(req.user) } }); }
  @Post('work-calendars') createWorkCalendar(@Req() req: any, @Body() body: any) {
    return this.prisma.workCalendar.create({ data: { companyId: companyIdOf(req.user), name: body.name, description: body.description, weekendDays: body.weekendDays || ['SATURDAY', 'SUNDAY'] } });
  }
  @Get('holidays') holidays(@Req() req: any) { return this.prisma.holiday.findMany({ where: { companyId: companyIdOf(req.user) }, include: { branch: true }, orderBy: { date: 'asc' } }); }
  @Post('holidays') createHoliday(@Req() req: any, @Body() body: any) {
    return this.prisma.holiday.create({ data: { companyId: companyIdOf(req.user), name: body.name, date: new Date(body.date), branchId: body.branchId, country: body.country, region: body.region, recurring: !!body.recurring } });
  }
  @Delete('holidays/:id') deleteHoliday(@Req() req: any, @Param('id') id: string) {
    return this.prisma.holiday.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
  }

  // ----- Compensation -----
  @UseGuards(PermissionsGuard) @RequirePermissions('payroll.view_compensation')
  @Post('employees/:id/compensation') changeCompensation(@Req() req: any, @Param('id') id: string, @Body() dto: CompensationDto) { return this.hr.changeCompensation(req, id, dto); }

  // ----- Employment history -----
  @Post('employees/:id/employment-change') employmentChange(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.hr.recordEmploymentChange(req, id, body); }

  // ----- Performance -----
  @Get('performance-cycles') performanceCycles(@Req() req: any) { return this.prisma.performanceCycle.findMany({ where: { companyId: companyIdOf(req.user) }, orderBy: { createdAt: 'desc' } }); }
  @Post('performance-cycles') createPerformanceCycle(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const start = new Date(body.startDate); const end = new Date(body.endDate);
    return this.prisma.performanceCycle.create({ data: { companyId, name: body.name, periodType: body.periodType || 'QUARTERLY', cycleType: body.periodType || 'QUARTERLY', periodStart: start, periodEnd: end, startDate: start, endDate: end, submissionOpens: start, employeeDeadline: end, managerDeadline: end, status: 'DRAFT' } });
  }
  @Get('performance-reviews') performanceReviews(@Req() req: any) {
    return this.prisma.performanceReview.findMany({ where: { companyId: companyIdOf(req.user) }, include: { employee: true, cycle: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('performance-reviews') createPerformanceReview(@Req() req: any, @Body() dto: PerformanceReviewDto) { return this.hr.createPerformanceReview(req, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('hr.performance.manage')
  @Post('performance-reviews/:id/status') updatePerformanceStatus(@Req() req: any, @Param('id') id: string, @Body() body: { status?: string; overallRating?: number; calibration?: string }) {
    return this.prisma.performanceReview.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { status: body.status, overallRating: body.overallRating, calibration: body.calibration } });
  }
  @Get('employees/:id/performance') employeePerformance(@Req() req: any, @Param('id') id: string) { return this.hr.getPerformanceStatus(companyIdOf(req.user), id); }

  // ----- Quality Assurance -----
  @Get('qa-templates') qaTemplates(@Req() req: any) { return this.prisma.qaTemplate.findMany({ where: { companyId: companyIdOf(req.user) } }); }
  @Post('qa-templates') createQaTemplate(@Req() req: any, @Body() dto: QaTemplateDto) {
    return this.prisma.qaTemplate.create({ data: { companyId: companyIdOf(req.user), name: dto.name, departmentId: dto.departmentId, jobRole: dto.jobRole, frequency: dto.frequency || 'MONTHLY', passThreshold: dto.passThreshold || 70, criteria: dto.criteria } });
  }
  @Get('qa-assessments') qaAssessments(@Req() req: any) {
    return this.prisma.qaAssessment.findMany({ where: { companyId: companyIdOf(req.user) }, include: { employee: true, template: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('qa-assessments') createQaAssessment(@Req() req: any, @Body() dto: QaAssessmentDto) { return this.hr.createQaAssessment(req, dto); }

  // ----- Incentives -----
  @Get('incentive-plans') incentivePlans(@Req() req: any) { return this.prisma.incentivePlan.findMany({ where: { companyId: companyIdOf(req.user) } }); }
  @Post('incentive-plans') createIncentivePlan(@Req() req: any, @Body() body: any) {
    return this.prisma.incentivePlan.create({ data: { companyId: companyIdOf(req.user), name: body.name, eligibility: body.eligibility, departmentId: body.departmentId, threshold: body.threshold, calculation: body.calculation, maxPayout: body.maxPayout, payrollComponent: body.payrollComponent || 'BONUS' } });
  }
  @Get('employee-incentives') employeeIncentives(@Req() req: any) {
    return this.prisma.employeeIncentive.findMany({ where: { companyId: companyIdOf(req.user) }, include: { employee: true, plan: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('employee-incentives') createIncentive(@Req() req: any, @Body() dto: IncentiveDto) { return this.hr.createIncentive(req, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('hr.performance.manage')
  @Post('employee-incentives/:id/approve') approveIncentive(@Req() req: any, @Param('id') id: string) { return this.hr.approveIncentive(req, id); }
  @Patch('employee-incentives/:id') updateIncentiveStatus(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.prisma.employeeIncentive.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: body });
  }

  // ----- HR dashboard -----
  @Get('dashboard') hrDashboard(@Req() req: any) { return this.hr.dashboard(req); }
}