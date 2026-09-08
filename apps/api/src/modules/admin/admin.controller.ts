import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { companyIdOf, tenantIdOf } from '../../core/context';
import type { RequestUser } from '../../core/context';
import {
  BranchDto, BranchStatusDto, ConfigDto, CreateUserDto, InviteUserDto, MembershipDto,
  RevokeSessionDto, SaveConfigGroupDto, UpdateMembershipDto, UpdateUserAccessDto, UpdateUserStatusDto,
} from './admin.dto';
import { AuditService } from '../../core/common/audit.service';

@ApiTags('Administration') @ApiBearerAuth() @UseGuards(JwtAuthGuard, PermissionsGuard) @Controller('admin')
export class AdminController {
  constructor(private admin: AdminService, private prisma: PrismaService, private audit: AuditService) {}

  /** Platform admins have no session companyId — they must pass one explicitly. */
  private resolveCompanyId(req: any, queryCompanyId?: string): string {
    const user: RequestUser = req.user;
    if (queryCompanyId && user.isPlatformAdmin) return queryCompanyId;
    return companyIdOf(user);
  }

  // ----- Dashboard -----
  @Get('dashboard') @RequirePermissions('admin.users.view', 'admin.branches.view', 'admin.audit.view')
  dashboard(@Req() req: any) { return this.admin.dashboard(this.resolveCompanyId(req, req.query.companyId)); }

  @Get('access-reviews') @RequirePermissions('admin.access_reviews.view')
  accessReviews(@Req() req: any) { return this.admin.accessReviews(this.resolveCompanyId(req, req.query.companyId)); }

  // ----- Users -----
  @Get('users') @RequirePermissions('admin.users.view')
  users(@Req() req: any, @Query() q: any) { return this.admin.listUsers(this.resolveCompanyId(req, q.companyId), q); }

  @Get('users/options') @RequirePermissions('admin.users.view')
  userOptions(@Req() req: any, @Query() q: any) { return this.admin.userOptions(this.resolveCompanyId(req, q.companyId)); }

  @Get('users/:id') @RequirePermissions('admin.users.view')
  userDetail(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.admin.userDetail(this.resolveCompanyId(req, q.companyId), id); }

  @Post('users') @RequirePermissions('admin.users.manage')
  createUser(@Req() req: any, @Body() dto: CreateUserDto) { return this.admin.createUser(req.user, dto); }

  @Patch('users/:id/status') @RequirePermissions('admin.users.deactivate')
  updateUserStatus(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateUserStatusDto, @Query() q: any) {
    return this.admin.updateUserStatus(req.user, this.resolveCompanyId(req, q.companyId), id, dto);
  }

  @Patch('users/:id/access') @RequirePermissions('admin.users.manage')
  updateUserAccess(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateUserAccessDto, @Query() q: any) {
    return this.admin.updateUserAccess(req.user, this.resolveCompanyId(req, q.companyId), id, dto);
  }

  @Post('users/:id/invite') @RequirePermissions('admin.users.invite')
  invite(@Req() req: any, @Param('id') id: string, @Body() dto: InviteUserDto, @Query() q: any) {
    return this.admin.resendInvitation(req.user, this.resolveCompanyId(req, q.companyId), id);
  }

  @Post('users/:id/revoke-sessions') @RequirePermissions('admin.sessions.revoke')
  revokeSessions(@Req() req: any, @Param('id') id: string, @Body() dto: RevokeSessionDto, @Query() q: any) {
    return this.admin.revokeSessions(req.user, this.resolveCompanyId(req, q.companyId), id, dto);
  }

  // ----- Memberships -----
  @Get('memberships') @RequirePermissions('admin.memberships.view')
  memberships(@Req() req: any, @Query() q: any) { return this.admin.listMemberships(this.resolveCompanyId(req, q.companyId)); }

  @Post('memberships') @RequirePermissions('admin.memberships.manage')
  addMember(@Req() req: any, @Body() dto: MembershipDto) { return this.admin.createMembership(req.user, dto); }

  @Patch('memberships/:id') @RequirePermissions('admin.memberships.manage')
  updateMembership(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateMembershipDto, @Query() q: any) {
    return this.admin.updateMembership(req.user, this.resolveCompanyId(req, q.companyId), id, dto);
  }

  @Post('memberships/:id/deactivate') @RequirePermissions('admin.memberships.manage')
  deactivateMembership(@Req() req: any, @Param('id') id: string, @Body() dto: any, @Query() q: any) {
    return this.admin.deactivateMembership(req.user, this.resolveCompanyId(req, q.companyId), id, dto);
  }

  @Delete('memberships/:id') @RequirePermissions('admin.memberships.manage')
  async deleteMembership(@Req() req: any, @Param('id') id: string, @Query() q: any) {
    const companyId = this.resolveCompanyId(req, q.companyId);
    await this.admin.deactivateMembership(req.user, companyId, id, { reason: 'Membership removed' });
    return { ok: true };
  }

  // ----- Branches -----
  @Get('branches') @RequirePermissions('admin.branches.view')
  branches(@Req() req: any, @Query() q: any) { return this.admin.listBranches(this.resolveCompanyId(req, q.companyId)); }

  @Get('branches/:id') @RequirePermissions('admin.branches.view')
  branchDetail(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.admin.branchDetail(this.resolveCompanyId(req, q.companyId), id); }

  @Post('branches') @RequirePermissions('admin.branches.manage')
  createBranch(@Req() req: any, @Body() dto: BranchDto) { return this.admin.createBranch(req.user, companyIdOf(req.user), dto); }

  @Patch('branches/:id') @RequirePermissions('admin.branches.manage')
  updateBranch(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<BranchDto>, @Query() q: any) {
    return this.admin.updateBranch(req.user, this.resolveCompanyId(req, q.companyId), id, dto);
  }

  @Post('branches/:id/status') @RequirePermissions('admin.branches.manage')
  branchStatus(@Req() req: any, @Param('id') id: string, @Body() dto: BranchStatusDto, @Query() q: any) {
    return this.admin.setBranchActive(req.user, this.resolveCompanyId(req, q.companyId), id, dto);
  }

  // ----- Audit logs -----
  @Get('audit-logs') @RequirePermissions('admin.audit.view')
  auditLogs(@Req() req: any, @Query() q: any) { return this.admin.listAudit(this.resolveCompanyId(req, q.companyId), q); }

  @Get('audit-logs/:id') @RequirePermissions('admin.audit.view')
  auditDetail(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.admin.auditDetail(this.resolveCompanyId(req, q.companyId), id); }

  @Get('audit-logs/export/csv') @RequirePermissions('admin.audit.export')
  async auditExport(@Req() req: any, @Query() q: any, @Res() res: Response) {
    const csv = await this.admin.exportAuditCsv(this.resolveCompanyId(req, q.companyId), q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    return res.send(csv);
  }

  // ----- System config -----
  @Get('config') @RequirePermissions('admin.config.view')
  config(@Req() req: any, @Query() q: any) { return this.admin.getConfig(this.resolveCompanyId(req, q.companyId)); }

  @Get('config/schema') @RequirePermissions('admin.config.view')
  configSchema() { return this.admin.configSchema(); }

  @Put('config/:group') @RequirePermissions('admin.config.manage')
  saveConfigGroup(@Req() req: any, @Param('group') group: string, @Body() dto: SaveConfigGroupDto, @Query() q: any) {
    return this.admin.saveConfigGroup(req.user, this.resolveCompanyId(req, q.companyId), group, dto);
  }

  @Post('config') @RequirePermissions('admin.config.manage')
  async createConfig(@Req() req: any, @Body() dto: ConfigDto) {
    const companyId = companyIdOf(req.user);
    if (!dto.key) throw new BadRequestException('Key is required');
    const config = await this.prisma.systemConfig.upsert({
      where: { companyId_key: { companyId, key: dto.key } },
      update: { value: dto.value, description: dto.description },
      create: { companyId, key: dto.key, value: dto.value, description: dto.description },
    });
    await this.audit.log(companyId, req.user.sub, 'CONFIG_UPDATED', 'SystemConfig', config.id, { module: 'admin', result: 'SUCCESS', metadata: { key: dto.key } });
    return config;
  }

  @Delete('config/:id') @RequirePermissions('admin.config.manage')
  async deleteConfig(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    await this.prisma.systemConfig.deleteMany({ where: { id, companyId } });
    return { ok: true };
  }

  // ----- Legacy summary for the Reports module -----
  @Get('report') @RequirePermissions('admin.users.view', 'admin.branches.view', 'admin.audit.view')
  async report(@Req() req: any, @Query() q: any) {
    const companyId = this.resolveCompanyId(req, q.companyId);
    const [users, branches, auditCount] = await Promise.all([
      this.prisma.membership.count({ where: { companyId } }),
      this.prisma.branch.count({ where: { companyId } }),
      this.prisma.auditLog.count({ where: { companyId } }),
    ]);
    return { users, branches, auditCount };
  }

  // ----- Employees without user accounts -----
  @Get('employees-without-user') @RequirePermissions('admin.users.view')
  employeesWithoutUser(@Req() req: any, @Query() q: any) {
    const companyId = this.resolveCompanyId(req, q.companyId);
    return this.prisma.employee.findMany({
      where: { companyId, active: true, user: { is: null } },
      include: { department: true },
      orderBy: { firstName: 'asc' },
      take: 200,
    });
  }
}
