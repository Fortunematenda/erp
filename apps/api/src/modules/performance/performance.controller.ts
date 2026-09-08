import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { companyIdOf } from '../../core/context';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KpiTemplateService } from './kpi-template.service';
import { PerformanceCycleService } from './performance-cycle.service';
import { PerformanceAssessmentService } from './performance-assessment.service';
import { PerformanceIncentiveService } from './performance-incentive.service';
import { PerformanceDashboardService } from './performance-dashboard.service';

@ApiTags('Performance Management') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('performance')
export class PerformanceController {
  constructor(
    private prisma: PrismaService,
    private templates: KpiTemplateService,
    private cycles: PerformanceCycleService,
    private assessments: PerformanceAssessmentService,
    private incentives: PerformanceIncentiveService,
    private dashboard: PerformanceDashboardService,
  ) {}

  // ---------- Dashboard ----------
  @Get('dashboard') dashboardData(@Req() req: any, @Query('departmentId') departmentId?: string) {
    return this.dashboard.dashboard(companyIdOf(req.user), departmentId || undefined);
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.view', 'performance.templates.view', 'performance.qa.view', 'performance.reports.view')
  @Get('needs-attention') needsAttention(@Req() req: any) { return this.dashboard.needsAttention(companyIdOf(req.user)); }

  // ---------- KPI Templates ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.view')
  @Get('kpi-templates') listTemplates(@Req() req: any, @Query() q: any) { return this.templates.list(companyIdOf(req.user), q); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.view')
  @Get('kpi-templates/:id') template(@Req() req: any, @Param('id') id: string) { return this.templates.get(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.view')
  @Get('kpi-templates/:id/usage') usage(@Req() req: any, @Param('id') id: string) { return this.templates.usageStats(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.manage')
  @Post('kpi-templates') createTemplate(@Req() req: any, @Body() dto: any) { return this.templates.create(req, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.manage')
  @Patch('kpi-templates/:id') updateTemplate(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.templates.update(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.manage')
  @Post('kpi-templates/:id/activate') activateTemplate(@Req() req: any, @Param('id') id: string) { return this.templates.activate(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.manage')
  @Post('kpi-templates/:id/status') templateStatus(@Req() req: any, @Param('id') id: string, @Body() b: { status: string }) { return this.templates.setStatus(req, id, b.status); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.manage')
  @Post('kpi-templates/:id/duplicate') duplicateTemplate(@Req() req: any, @Param('id') id: string, @Body() b: { name?: string }) { return this.templates.duplicate(req, id, b.name); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.view')
  @Get('kpi-categories') categories(@Req() req: any) { return this.templates.categories(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.manage')
  @Post('kpi-categories') createCategory(@Req() req: any, @Body() b: { name: string; color?: string }) { return this.templates.createCategory(req, b); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.view')
  @Get('bands') bands(@Req() req: any, @Query('templateId') templateId?: string) { return this.templates.getBands(companyIdOf(req.user), templateId); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.templates.manage')
  @Post('bands') setBands(@Req() req: any, @Body() b: any) { return this.templates.setBands(req, b); }

  // ---------- Cycles ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.view')
  @Get('cycles') listCycles(@Req() req: any) { return this.cycles.list(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.view')
  @Get('cycles/:id') cycle(@Req() req: any, @Param('id') id: string) { return this.cycles.get(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage')
  @Post('cycles') createCycle(@Req() req: any, @Body() dto: any) { return this.cycles.create(req, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage')
  @Patch('cycles/:id') updateCycle(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.cycles.update(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage')
  @Post('cycles/:id/status') cycleStatus(@Req() req: any, @Param('id') id: string, @Body() b: { status: string }) { return this.cycles.setStatus(req, id, b.status); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage')
  @Post('cycles/:id/open') openCycle(@Req() req: any, @Param('id') id: string) { return this.cycles.open(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage')
  @Post('assessments/:id/department-move') departmentMove(@Req() req: any, @Param('id') id: string, @Body() b: { decision: 'KEEP_EXISTING' | 'REASSIGN'; reason?: string }) { return this.cycles.handleDepartmentMove(req, id, b.decision, b.reason); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage')
  @Post('assessments/:id/regenerate') regenerate(@Req() req: any, @Param('id') id: string) { return this.cycles.regenerate(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage')
  @Post('assessments/:id/employment-end') employmentEnd(@Req() req: any, @Param('id') id: string, @Body() b: { decision: 'COMPLETE' | 'EXCLUDE'; reason: string }) { return this.cycles.handleEmploymentEnd(req, id, b.decision, b.reason); }

  // ---------- Assessments ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.self.view', 'performance.team.view', 'performance.qa.view', 'performance.cycles.view')
  @Get('assessments') assessmentList(@Req() req: any, @Query() q: any) { return this.assessments.list(companyIdOf(req.user), q); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.self.view', 'performance.team.view', 'performance.qa.view', 'performance.cycles.view')
  @Get('assessments/:id') assessment(@Req() req: any, @Param('id') id: string) { return this.assessments.detail(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.self.view', 'performance.team.view', 'performance.qa.view', 'performance.cycles.view')
  @Get('assessments/:id/audit') async assessmentAudit(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const detail = await this.assessments.detail(req, id);
    const kpiIds = detail.kpis.map((k: any) => k.id);
    return this.prisma.auditLog.findMany({
      where: { companyId, OR: [{ entityType: 'EmployeePerformanceAssessment', entityId: id }, ...(kpiIds.length ? [{ entityType: 'EmployeePerformanceKpi', entityId: { in: kpiIds } }] : [])] },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.self.submit')
  @Post('assessments/:id/employee-submit') employeeSubmit(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.assessments.employeeSubmit(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.manager.review')
  @Post('assessments/:id/manager-review') managerReview(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.assessments.managerReview(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.qa.review')
  @Post('assessments/:id/qa-start') qaStart(@Req() req: any, @Param('id') id: string) { return this.assessments.qaStart(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.qa.review')
  @Post('assessments/:id/qa-adjust') qaAdjust(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.assessments.qaAdjust(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.qa.review')
  @Post('assessments/:id/qa-submit') qaSubmit(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.assessments.qaSubmit(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.calibration.manage')
  @Post('assessments/:id/calibrate') calibrate(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.assessments.calibrate(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.approve')
  @Post('assessments/:id/approve') approve(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.assessments.approve(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.approve')
  @Post('assessments/:id/lock') lock(@Req() req: any, @Param('id') id: string) { return this.assessments.lock(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.approve')
  @Post('assessments/:id/reopen') reopen(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.assessments.reopen(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.self.view')
  @Post('assessments/:id/acknowledge') acknowledge(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.assessments.acknowledge(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage', 'performance.qa.view')
  @Post('assessments/:id/send-acknowledgement') sendAck(@Req() req: any, @Param('id') id: string) { return this.assessments.sendForAcknowledgement(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage', 'performance.manager.review')
  @Post('assessments/:id/remind') remind(@Req() req: any, @Param('id') id: string) { return this.assessments.remind(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage')
  @Post('cycles/:id/remind-missing') remindMissing(@Req() req: any, @Param('id') id: string) { return this.assessments.remindMissing(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.view')
  @Post('assessments/:id/refresh-system-kpis') refreshSystem(@Req() req: any, @Param('id') id: string) { return this.assessments.refreshSystemKpis(companyIdOf(req.user), id).then(() => this.assessments.detail(req, id)); }

  // ---------- Employee history ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.self.view', 'performance.team.view', 'performance.qa.view')
  @Get('employees/:id/history') employeeHistory(@Req() req: any, @Param('id') id: string) { return this.assessments.employeeHistory(companyIdOf(req.user), id); }

  // ---------- Development plans ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.manage', 'performance.manager.review')
  @Post('development-plans') createDevPlan(@Req() req: any, @Body() dto: any) { return this.assessments.createDevelopmentPlan(req, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.cycles.view', 'performance.team.view')
  @Get('development-plans') devPlans(@Req() req: any, @Query('employeeId') employeeId?: string) { return this.assessments.listDevelopmentPlans(companyIdOf(req.user), employeeId || undefined); }

  // ---------- Incentives ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.incentives.view')
  @Get('incentive-plans') plans(@Req() req: any) { return this.incentives.listPlans(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.incentives.propose')
  @Post('incentive-plans') createPlan(@Req() req: any, @Body() dto: any) { return this.incentives.createPlan(req, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.incentives.propose')
  @Patch('incentive-plans/:id') updatePlan(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.incentives.updatePlan(req, id, dto); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.incentives.view')
  @Get('incentives') listIncentives(@Req() req: any, @Query() q: any) { return this.incentives.list(companyIdOf(req.user), q); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.incentives.propose')
  @Post('cycles/:id/run-incentive-eligibility') runEligibility(@Req() req: any, @Param('id') id: string) { return this.incentives.runEligibility(req, id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.incentives.propose')
  @Post('incentives/:id/amount') setAmount(@Req() req: any, @Param('id') id: string, @Body() b: { amount: number; notes?: string }) { return this.incentives.setAmount(req, id, b.amount, b.notes); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.incentives.approve')
  @Post('incentives/:id/approve') approveIncentive(@Req() req: any, @Param('id') id: string, @Body() b: any) { return this.incentives.approve(req, id, b); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.incentives.approve')
  @Post('incentives/:id/reject') rejectIncentive(@Req() req: any, @Param('id') id: string, @Body() b: { reason: string }) { return this.incentives.reject(req, id, b.reason); }

  // ---------- Reports ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.reports.view', 'performance.cycles.view')
  @Get('reports/completion') reportCompletion(@Req() req: any, @Query('cycleId') cycleId: string) { return this.dashboard.completionReport(companyIdOf(req.user), cycleId); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.reports.view', 'performance.cycles.view')
  @Get('reports/by-department') reportByDepartment(@Req() req: any, @Query('cycleId') cycleId?: string) { return this.dashboard.byDepartmentReport(companyIdOf(req.user), cycleId || undefined); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.reports.view', 'performance.cycles.view')
  @Get('reports/kpi-results') reportKpiResults(@Req() req: any, @Query('cycleId') cycleId?: string) { return this.dashboard.kpiResultsReport(companyIdOf(req.user), cycleId || undefined); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.reports.view', 'performance.cycles.view')
  @Get('reports/bands') reportBands(@Req() req: any, @Query('cycleId') cycleId?: string) { return this.dashboard.bandsReport(companyIdOf(req.user), cycleId || undefined); }
  @UseGuards(PermissionsGuard) @RequirePermissions('performance.reports.view', 'performance.incentives.view')
  @Get('reports/incentives') reportIncentives(@Req() req: any, @Query('cycleId') cycleId?: string) { return this.dashboard.incentiveReport(companyIdOf(req.user), cycleId || undefined); }

  // ---------- Notifications ----------
  @Get('notifications') notifications(@Req() req: any) {
    return this.prisma.performanceNotification.findMany({ where: { companyId: companyIdOf(req.user), userId: req.user.sub }, orderBy: { createdAt: 'desc' }, take: 50 });
  }
  @Post('notifications/:id/read') markRead(@Req() req: any, @Param('id') id: string) {
    return this.prisma.performanceNotification.updateMany({ where: { id, companyId: companyIdOf(req.user), userId: req.user.sub }, data: { readAt: new Date() } });
  }
}
