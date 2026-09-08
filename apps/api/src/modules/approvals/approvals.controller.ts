import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { ApprovalService, APPROVAL_DOC_TYPES } from './approval.service';

@ApiTags('Approvals') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('approvals')
export class ApprovalsController {
  constructor(private approvals: ApprovalService) {}

  @UseGuards(PermissionsGuard) @RequirePermissions('approvals.manage')
  @Get('workflows') workflows(@Req() req: any) { return this.approvals.listWorkflows(req.user.companyId); }

  @UseGuards(PermissionsGuard) @RequirePermissions('approvals.manage')
  @Post('workflows/:id/steps') step(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.approvals.addStep(req.user.companyId, id, body); }

  @UseGuards(PermissionsGuard) @RequirePermissions('approvals.submit')
  @Post('requests') submit(@Req() req: any, @Body() body: any) { return this.approvals.submit(req.user.companyId, req.user.sub, body); }

  @Get('requests') reqs(@Req() req: any, @Query() q: any) { return this.approvals.listRequests(req.user.companyId, { ...q, userId: req.user.sub }); }

  @UseGuards(PermissionsGuard) @RequirePermissions('approvals.approve')
  @Post('requests/:id/act') act(@Req() req: any, @Param('id') id: string, @Body() body: { action: string; comment?: string }) {
    return this.approvals.act(req.user.companyId, req.user.sub, id, body.action, body.comment);
  }

  @Get('document-types') types() { return APPROVAL_DOC_TYPES; }
}
