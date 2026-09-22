import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { PayrollSettingsService } from './payroll-settings.service';

@ApiTags('HR & Payroll') @ApiBearerAuth() @UseGuards(JwtAuthGuard, PermissionsGuard) @Controller('hr/payroll-settings')
export class PayrollSettingsController {
  constructor(private svc: PayrollSettingsService) {}

  @RequirePermissions('payroll.view')
  @Get('statutory-rules') list(@Req() req: any, @Query() q: any) { return this.svc.list(req, q); }
  @RequirePermissions('payroll.view')
  @Get('statutory-rules/:id') get(@Req() req: any, @Param('id') id: string) { return this.svc.get(req, id); }
  @RequirePermissions('payroll.settings.statutory.manage', 'payroll.process')
  @Post('statutory-rules') create(@Req() req: any, @Body() dto: any) { return this.svc.create(req, dto); }
  @RequirePermissions('payroll.settings.statutory.manage', 'payroll.process')
  @Patch('statutory-rules/:id') update(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.update(req, id, dto); }
  @RequirePermissions('payroll.settings.statutory.manage', 'payroll.process')
  @Post('statutory-rules/:id/new-version') newVersion(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.newVersion(req, id, dto); }
  @RequirePermissions('payroll.settings.statutory.manage', 'payroll.process')
  @Post('statutory-rules/:id/activate') activate(@Req() req: any, @Param('id') id: string) { return this.svc.activate(req, id); }
  @RequirePermissions('payroll.settings.statutory.manage', 'payroll.process')
  @Post('statutory-rules/:id/deactivate') deactivate(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.deactivate(req, id, dto); }
  @RequirePermissions('payroll.view')
  @Get('statutory-rules/:id/usage') usage(@Req() req: any, @Param('id') id: string) { return this.svc.usage(req, id); }
}
