import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { Employee360Service } from './employee-360.service';

/**
 * Employee 360 endpoints. Every route is company-scoped and delegates to the
 * authoritative module services/models (leave, attendance, performance,
 * incentives, payroll, documents, assets, projects, audit).
 */
@ApiTags('HR & Payroll') @ApiBearerAuth() @UseGuards(JwtAuthGuard, PermissionsGuard) @Controller('hr')
export class Employee360Controller {
  constructor(private svc: Employee360Service) {}

  @RequirePermissions('hr.employees.view')
  @Get('employees/:id/360')
  overview(@Req() req: any, @Param('id') id: string) { return this.svc.overview(req, id); }

  // ----- Leave -----
  @RequirePermissions('hr.leave.view', 'hr.employees.view')
  @Get('employees/:id/leave-workspace')
  leaveWorkspace(@Req() req: any, @Param('id') id: string, @Query('month') month?: string) { return this.svc.leaveWorkspace(req, id, month); }

  @RequirePermissions('hr.leave.create_for_employee', 'hr.leave.manage', 'hr.leave.request')
  @Post('employees/:id/leave-preview')
  previewLeave(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.previewLeave(req, id, dto); }

  @RequirePermissions('hr.leave.create_for_employee', 'hr.leave.manage', 'hr.leave.request')
  @Post('employees/:id/leave')
  applyLeave(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.applyLeave(req, id, dto); }

  @RequirePermissions('hr.leave.approve', 'hr.leave.manage')
  @Post('employees/:id/leave/:leaveId/status')
  leaveStatus(@Req() req: any, @Param('id') id: string, @Param('leaveId') leaveId: string, @Body() body: { status: string; comments?: string }) {
    return this.svc.setLeaveStatus(req, id, leaveId, body.status, body.comments);
  }

  @RequirePermissions('hr.leave.manage')
  @Post('employees/:id/leave-balances/configure')
  configureBalance(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.svc.configureLeaveBalance(req, id, body); }

  // ----- Attendance -----
  @RequirePermissions('hr.attendance.view', 'hr.employees.view')
  @Get('employees/:id/attendance-workspace')
  attendanceWorkspace(@Req() req: any, @Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.attendanceWorkspace(req, id, from, to); }

  @RequirePermissions('hr.attendance.adjust', 'hr.attendance.manage')
  @Post('employees/:id/attendance-adjust')
  adjustAttendance(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.adjustAttendance(req, id, dto); }

  // ----- Performance -----
  @RequirePermissions('performance.cycles.view', 'performance.team.view', 'performance.qa.view', 'hr.performance.manage', 'hr.employees.view')
  @Get('employees/:id/performance-workspace')
  performanceWorkspace(@Req() req: any, @Param('id') id: string) { return this.svc.performanceWorkspace(req, id); }

  @RequirePermissions('performance.cycles.manage', 'hr.performance.manage')
  @Post('employees/:id/performance/remind')
  remind(@Req() req: any, @Param('id') id: string) { return this.svc.remindKpi(req, id); }

  // ----- Incentives -----
  @RequirePermissions('performance.incentives.view', 'hr.employees.view')
  @Get('employees/:id/incentives')
  incentives(@Req() req: any, @Param('id') id: string) { return this.svc.incentivesForEmployee(req, id); }

  @RequirePermissions('performance.incentives.propose', 'hr.performance.manage')
  @Post('employees/:id/incentives')
  createIncentive(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.createEmployeeIncentive(req, id, dto); }

  @RequirePermissions('performance.incentives.approve', 'hr.performance.manage')
  @Post('employees/:id/incentives/:incentiveId/approve')
  approveIncentive(@Req() req: any, @Param('id') id: string, @Param('incentiveId') incentiveId: string) { return this.svc.setIncentiveStatus(req, id, incentiveId, 'approve'); }

  @RequirePermissions('performance.incentives.approve', 'hr.performance.manage')
  @Post('employees/:id/incentives/:incentiveId/reject')
  rejectIncentive(@Req() req: any, @Param('id') id: string, @Param('incentiveId') incentiveId: string, @Body() body: any) { return this.svc.setIncentiveStatus(req, id, incentiveId, 'reject', body?.reason); }

  // ----- Payroll -----
  @RequirePermissions('payroll.view', 'payroll.view_compensation')
  @Get('employees/:id/payroll-workspace')
  payrollWorkspace(@Req() req: any, @Param('id') id: string) { return this.svc.payrollWorkspace(req, id); }

  // ----- Documents -----
  @RequirePermissions('hr.documents.view', 'hr.employees.view')
  @Get('employees/:id/documents')
  documents(@Req() req: any, @Param('id') id: string) { return this.svc.documentsForEmployee(req, id); }

  @RequirePermissions('hr.documents.upload', 'hr.employees.manage')
  @Post('employees/:id/documents')
  createDocument(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.createDocument(req, id, dto); }

  @RequirePermissions('hr.documents.upload', 'hr.employees.manage')
  @Patch('employees/:id/documents/:docId')
  updateDocument(@Req() req: any, @Param('id') id: string, @Param('docId') docId: string, @Body() dto: any) { return this.svc.updateDocument(req, id, docId, dto); }

  @RequirePermissions('hr.documents.upload', 'hr.employees.manage')
  @Post('employees/:id/documents/:docId/replace')
  replaceDocument(@Req() req: any, @Param('id') id: string, @Param('docId') docId: string, @Body() dto: any) { return this.svc.replaceDocument(req, id, docId, dto); }

  @RequirePermissions('hr.documents.upload', 'hr.employees.manage')
  @Delete('employees/:id/documents/:docId')
  archiveDocument(@Req() req: any, @Param('id') id: string, @Param('docId') docId: string) { return this.svc.archiveDocument(req, id, docId); }

  // ----- Assets -----
  @RequirePermissions('assets.view', 'hr.employees.view')
  @Get('employees/:id/assets')
  assets(@Req() req: any, @Param('id') id: string) { return this.svc.assetsForEmployee(req, id); }

  @RequirePermissions('assets.assign', 'assets.manage')
  @Get('assets/available')
  availableAssets(@Req() req: any) { return this.svc.availableAssets(req); }

  @RequirePermissions('assets.assign', 'assets.manage')
  @Post('employees/:id/assets')
  assignAsset(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.assignAsset(req, id, dto); }

  @RequirePermissions('assets.return', 'assets.manage')
  @Post('employees/:id/assets/:assignmentId/return')
  returnAsset(@Req() req: any, @Param('id') id: string, @Param('assignmentId') assignmentId: string, @Body() dto: any) { return this.svc.returnAsset(req, id, assignmentId, dto); }

  // ----- Projects -----
  @RequirePermissions('projects.assign_employee', 'hr.employees.view')
  @Get('employees/:id/projects')
  projects(@Req() req: any, @Param('id') id: string) { return this.svc.projectsForEmployee(req, id); }

  @RequirePermissions('projects.assign_employee', 'hr.employees.view')
  @Get('projects/available')
  availableProjects(@Req() req: any, @Query('employeeId') employeeId?: string) { return this.svc.availableProjects(req, employeeId); }

  @RequirePermissions('projects.assign_employee')
  @Post('employees/:id/projects')
  assignProject(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.assignProject(req, id, dto); }

  @RequirePermissions('projects.assign_employee')
  @Patch('project-members/:memberId/end')
  endMembership(@Req() req: any, @Param('memberId') memberId: string, @Body() dto: any) { return this.svc.endProjectMembership(req, memberId, dto); }

  @RequirePermissions('projects.assign_employee', 'hr.employees.view')
  @Get('employees/:id/projects/:projectId/tasks')
  projectTasks(@Req() req: any, @Param('id') id: string, @Param('projectId') projectId: string) { return this.svc.projectTasks(req, id, projectId); }

  // ----- Audit -----
  @RequirePermissions('hr.audit.view', 'admin.audit.view', 'hr.employees.view')
  @Get('employees/:id/audit')
  audit(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.svc.auditForEmployee(req, id, q); }

  // ----- Offboarding / user account -----
  @RequirePermissions('hr.employees.view', 'hr.offboard')
  @Get('employees/:id/offboarding-checklist')
  checklist(@Req() req: any, @Param('id') id: string) { return this.svc.offboardingChecklist(req, id); }

  @RequirePermissions('admin.users.manage', 'hr.employees.manage')
  @Post('employees/:id/user-account')
  createUserAccount(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.createUserAccount(req, id, dto); }

  @RequirePermissions('hr.offboard', 'hr.employees.manage')
  @Post('employees/:id/offboard-with-check')
  offboard(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.svc.offboard(req, id, body); }
}
