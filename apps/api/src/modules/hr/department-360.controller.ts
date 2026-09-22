import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { Department360Service } from './department-360.service';

/**
 * Department 360 — powers the HR Departments contextual drawer. All routes are
 * company-scoped and delegate to the authoritative HR / Performance models.
 */
@ApiTags('HR & Payroll') @ApiBearerAuth() @UseGuards(JwtAuthGuard, PermissionsGuard) @Controller('hr')
export class Department360Controller {
  constructor(private svc: Department360Service) {}

  @RequirePermissions('hr.employees.view', 'performance.templates.view', 'performance.cycles.view')
  @Get('departments/:id/360')
  overview(@Req() req: any, @Param('id') id: string) { return this.svc.overview(req, id); }

  @RequirePermissions('hr.employees.view')
  @Get('departments/:id/employees')
  employees(@Req() req: any, @Param('id') id: string) { return this.svc.employees(req, id); }

  @RequirePermissions('performance.templates.view', 'hr.employees.view')
  @Get('departments/:id/kpi-templates')
  kpiTemplates(@Req() req: any, @Param('id') id: string) { return this.svc.kpiTemplates(req, id); }

  @RequirePermissions('performance.templates.view', 'hr.employees.view')
  @Get('departments/:id/kpi-templates/:templateId')
  templateDetail(@Req() req: any, @Param('id') id: string, @Param('templateId') templateId: string) { return this.svc.templateDetail(req, id, templateId); }

  @RequirePermissions('performance.cycles.view', 'hr.employees.view')
  @Get('departments/:id/performance')
  performance(@Req() req: any, @Param('id') id: string, @Query('cycleId') cycleId?: string) { return this.svc.performance(req, id, cycleId); }

  @RequirePermissions('hr.employees.manage')
  @Get('departments/:id/assignable-employees')
  assignable(@Req() req: any, @Param('id') id: string) { return this.svc.assignableEmployees(req, id); }

  @RequirePermissions('hr.employees.manage')
  @Post('departments/:id/assign-employee')
  assign(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.assignEmployee(req, id, dto); }
}
