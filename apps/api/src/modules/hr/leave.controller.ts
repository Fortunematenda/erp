import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { LeaveService } from './leave.service';

@ApiTags('HR & Payroll') @ApiBearerAuth() @UseGuards(JwtAuthGuard, PermissionsGuard) @Controller('hr/leave')
export class LeaveController {
  constructor(private svc: LeaveService) {}

  @RequirePermissions('hr.leave.view')
  @Get('financial-year') financialYear(@Req() req: any) { return this.svc.currentFinancialYear(req.user.companyId); }
  @RequirePermissions('hr.leave.view')
  @Get('years') years(@Req() req: any) { return this.svc.leaveYears(req.user.companyId); }

  // Requests
  @RequirePermissions('hr.leave.view')
  @Get('requests') listRequests(@Req() req: any, @Query() q: any) { return this.svc.listRequests(req, q); }
  @RequirePermissions('hr.leave.view')
  @Get('requests/:id') requestDetail(@Req() req: any, @Param('id') id: string) { return this.svc.requestDetail(req, id); }
  @RequirePermissions('hr.leave.view')
  @Post('calculate') calculate(@Req() req: any, @Body() dto: any) { return this.svc.calculate(req.user.companyId, dto); }
  @RequirePermissions('hr.leave.create', 'hr.leave.request', 'hr.leave.manage')
  @Post('requests') createRequest(@Req() req: any, @Body() dto: any) { return this.svc.createRequest(req, dto); }
  @RequirePermissions('hr.leave.edit', 'hr.leave.manage')
  @Patch('requests/:id') updateRequest(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.updateRequest(req, id, dto); }
  @RequirePermissions('hr.leave.approve', 'hr.leave.manage')
  @Post('requests/:id/approve') approve(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.svc.approve(req, id, body?.comment); }
  @RequirePermissions('hr.leave.reject', 'hr.leave.approve', 'hr.leave.manage')
  @Post('requests/:id/reject') reject(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.svc.reject(req, id, body?.reason); }
  @RequirePermissions('hr.leave.cancel', 'hr.leave.manage')
  @Post('requests/:id/cancel') cancel(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.svc.cancel(req, id, body?.reason); }

  // Balances
  @RequirePermissions('hr.leave.balance.view', 'hr.leave.view')
  @Get('balances') balanceReport(@Req() req: any, @Query() q: any) { return this.svc.balanceReport(req, q); }
  @RequirePermissions('hr.leave.balance.view', 'hr.leave.view')
  @Get('balances/:employeeId/:leaveTypeId/ledger') ledger(@Req() req: any, @Param('employeeId') employeeId: string, @Param('leaveTypeId') leaveTypeId: string, @Query('year') year?: string) { return this.svc.balanceLedger(req, employeeId, leaveTypeId, year ? Number(year) : undefined); }
  @RequirePermissions('hr.leave.balance.adjust', 'hr.leave.manage')
  @Post('balances/adjust') adjust(@Req() req: any, @Body() dto: any) { return this.svc.adjustBalance(req, dto); }

  // Leave types
  @RequirePermissions('hr.leave.type.view', 'hr.leave.view')
  @Get('types') listTypes(@Req() req: any) { return this.svc.listLeaveTypes(req); }
  @RequirePermissions('hr.leave.type.manage', 'hr.leave.manage')
  @Post('types') createType(@Req() req: any, @Body() dto: any) { return this.svc.createLeaveType(req, dto); }
  @RequirePermissions('hr.leave.type.manage', 'hr.leave.manage')
  @Patch('types/:id') updateType(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.updateLeaveType(req, id, dto); }
  @RequirePermissions('hr.leave.type.manage', 'hr.leave.manage')
  @Post('types/:id/active') setTypeActive(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.svc.setLeaveTypeActive(req, id, body?.active !== false); }
  @RequirePermissions('hr.leave.type.manage', 'hr.leave.manage')
  @Post('types/:id/duplicate') duplicateType(@Req() req: any, @Param('id') id: string) { return this.svc.duplicateLeaveType(req, id); }

  // Holidays
  @RequirePermissions('hr.holiday.view', 'hr.leave.view')
  @Get('holidays') listHolidays(@Req() req: any, @Query() q: any) { return this.svc.listHolidays(req, q); }
  @RequirePermissions('hr.holiday.manage', 'hr.leave.manage')
  @Post('holidays') createHoliday(@Req() req: any, @Body() dto: any) { return this.svc.createHoliday(req, dto); }
  @RequirePermissions('hr.holiday.manage', 'hr.leave.manage')
  @Patch('holidays/:id') updateHoliday(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.updateHoliday(req, id, dto); }
  @RequirePermissions('hr.holiday.manage', 'hr.leave.manage')
  @Post('holidays/:id/active') setHolidayActive(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.svc.setHolidayActive(req, id, body?.active !== false); }

  // Calendar
  @RequirePermissions('hr.leave.view')
  @Get('calendar') calendar(@Req() req: any, @Query() q: any) { return this.svc.calendar(req, q); }

  // Rollover
  @RequirePermissions('hr.leave.rollover.manage', 'hr.leave.manage')
  @Get('rollover/preview') rolloverPreview(@Req() req: any, @Query('fromYear') fromYear: string, @Query('toYear') toYear: string) { return this.svc.rolloverPreview(req, Number(fromYear), Number(toYear)); }
  @RequirePermissions('hr.leave.rollover.manage', 'hr.leave.manage')
  @Post('rollover/process') rolloverProcess(@Req() req: any, @Body() body: any) { return this.svc.rolloverProcess(req, Number(body.fromYear), Number(body.toYear)); }
}
