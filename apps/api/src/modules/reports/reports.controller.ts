import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { AuditService } from '../../core/common/audit.service';
import { ReportService } from './report.service';
import { companyIdOf } from '../../core/context';

@ApiTags('Reports & BI') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('reports')
export class ReportsController {
  constructor(private prisma: PrismaService, private reports: ReportService, private audit: AuditService) {}

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Get('overview') overview(@Req() req: any, @Query() q: any) { return this.reports.overview(req, q); }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Get('datasets') datasets() { return this.reports.datasets(); }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Get('branches') branches(@Req() req: any) { return this.reports.branches(companyIdOf(req.user)); }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Get('currencies') currencies(@Req() req: any) { return this.reports.currencies(companyIdOf(req.user)); }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Get('state') state(@Req() req: any) { return this.reports.getState(companyIdOf(req.user), req.user.sub); }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Post('state/favorite') favorite(@Req() req: any, @Body() b: { reportId: string }) { return this.reports.toggleFavorite(companyIdOf(req.user), req.user.sub, b.reportId); }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Post('state/recent') recent(@Req() req: any, @Body() b: { reportId: string }) { return this.reports.addRecent(companyIdOf(req.user), req.user.sub, b.reportId); }

  /** Curated dataset runner. RBAC is enforced per dataset server-side. */
  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Post('run') run(@Req() req: any, @Body() body: any) { return this.reports.run(req, body); }

  // ---------- Saved custom reports ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Get() async saved(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const rows = await this.prisma.reportDefinition.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
    // visibility: PRIVATE only owner; ROLE/COMPANY visible per membership; legacy rows (no owner) stay company-visible
    const memberships = await this.prisma.membership.findMany({ where: { userId: req.user.sub, companyId }, include: { roles: { include: { role: true } } } });
    const myRoleIds = new Set(memberships.flatMap((m) => m.roles.map((r) => r.roleId)));
    return rows.filter((r: any) => {
      if (!r.ownerId || r.visibility === 'COMPANY') return true;
      if (r.ownerId === req.user.sub) return true;
      if (r.visibility === 'ROLE' && r.sharedRoleId && myRoleIds.has(r.sharedRoleId)) return true;
      return false;
    });
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.custom.create')
  @Post() async save(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    // The dataset itself must be permitted — never let a custom report bypass RBAC.
    const ds = await this.reports.assertDatasetAccess(req, body.dataset);
    const def = await this.prisma.reportDefinition.create({
      data: {
        companyId, name: body.name || ds.label, description: body.description || null,
        dataset: body.dataset, columns: body.columns || [], filters: body.filters || {}, groupBy: body.groupBy || null,
        ownerId: req.user.sub, category: body.category || ds.area, visibility: body.visibility || 'PRIVATE',
        sharedRoleId: body.visibility === 'ROLE' ? body.sharedRoleId || null : null,
        sortBy: body.sortBy || null, sortDir: body.sortDir || null,
      },
    });
    await this.audit.log(companyId, req.user.sub, 'CUSTOM_REPORT_CREATED', 'ReportDefinition', def.id, { name: def.name, dataset: def.dataset, visibility: def.visibility });
    return def;
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.custom.create')
  @Patch(':id') async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.reportDefinition.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Report not found');
    if (existing.ownerId && existing.ownerId !== req.user.sub) {
      const perms = await this.reports.getPermissions(req);
      if (!perms.includes('*') && !perms.includes('reports.custom.share')) throw new ForbiddenException('Only the owner can edit this report');
    }
    const data: any = {};
    if (body.name != null) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.columns != null) data.columns = body.columns;
    if (body.filters != null) data.filters = body.filters;
    if (body.groupBy !== undefined) data.groupBy = body.groupBy;
    if (body.visibility != null) {
      if (body.visibility !== 'PRIVATE') {
        const perms = await this.reports.getPermissions(req);
        if (!perms.includes('*') && !perms.includes('reports.custom.share')) throw new ForbiddenException('You do not have permission to share reports');
      }
      data.visibility = body.visibility;
      data.sharedRoleId = body.visibility === 'ROLE' ? body.sharedRoleId || null : null;
    }
    const def = await this.prisma.reportDefinition.update({ where: { id }, data });
    await this.audit.log(companyId, req.user.sub, 'CUSTOM_REPORT_SHARED', 'ReportDefinition', id, { visibility: def.visibility });
    return def;
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.view')
  @Post('saved/:id/run') async runSaved(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const def = await this.prisma.reportDefinition.findFirst({ where: { id, companyId } });
    if (!def) throw new NotFoundException('Report not found');
    const f = (def.filters as any) || {};
    return this.reports.run(req, { ...f, ...body, dataset: def.dataset, groupBy: body.groupBy ?? def.groupBy, sortBy: body.sortBy ?? def.sortBy, sortDir: body.sortDir ?? def.sortDir });
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('reports.custom.create')
  @Delete(':id') async remove(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.reportDefinition.findFirst({ where: { id, companyId } });
    if (!existing) return { ok: true };
    if (existing.ownerId && existing.ownerId !== req.user.sub) throw new ForbiddenException('Only the owner can delete this report');
    await this.prisma.reportDefinition.delete({ where: { id } });
    await this.audit.log(companyId, req.user.sub, 'CUSTOM_REPORT_DELETED', 'ReportDefinition', id, { name: existing.name });
    return { ok: true };
  }
}
