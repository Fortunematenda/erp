import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { PayrollService } from './payroll.service';

@ApiTags('HR & Payroll') @ApiBearerAuth() @UseGuards(JwtAuthGuard, PermissionsGuard) @Controller('hr')
export class PayrollController {
  constructor(private svc: PayrollService) {}

  @RequirePermissions('payroll.view')
  @Get('payroll-summary') summary(@Req() req: any) { return this.svc.summary(req); }

  @RequirePermissions('payroll.view')
  @Get('payroll-inputs') inputs(@Req() req: any, @Query() q: any) { return this.svc.listInputs(req, q); }
  @RequirePermissions('payroll.process', 'payroll.create')
  @Post('payroll-inputs/sync') sync(@Req() req: any, @Body() body: any) { return this.svc.syncInputs(req, body); }
  @RequirePermissions('payroll.process', 'payroll.create')
  @Post('payroll-inputs') createInput(@Req() req: any, @Body() dto: any) { return this.svc.createInput(req, dto); }
  @RequirePermissions('payroll.process', 'payroll.create')
  @Post('payroll-inputs/:id/void') voidInput(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.svc.voidInput(req, id, body?.reason); }

  @RequirePermissions('payroll.view')
  @Get('payroll-runs/:id/detail') detail(@Req() req: any, @Param('id') id: string) { return this.svc.runDetail(req, id); }
  @RequirePermissions('payroll.view')
  @Get('payroll-runs/:id/validation') validation(@Req() req: any, @Param('id') id: string) { return this.svc.runValidation(req, id); }
  @RequirePermissions('payroll.process', 'payroll.pay')
  @Post('payroll-runs/:id/payment') payment(@Req() req: any, @Param('id') id: string, @Body() dto: any) { return this.svc.recordPayment(req, id, dto); }

  @RequirePermissions('payroll.view')
  @Get('payroll-settings/company') companyProfile(@Req() req: any) { return this.svc.companyPayrollProfile(req); }
  @RequirePermissions('payroll.settings.statutory.manage', 'payroll.process')
  @Patch('payroll-settings/company') updateCompanyProfile(@Req() req: any, @Body() dto: any) { return this.svc.updateCompanyPayrollProfile(req, dto); }
  @RequirePermissions('payroll.view')
  @Get('employees/:id/statutory-profile') statutoryProfile(@Req() req: any, @Param('id') id: string) { return this.svc.employeeStatutoryProfile(req, id); }
  @RequirePermissions('payroll.settings.statutory.manage', 'payroll.process')
  @Post('employees/:id/statutory-exemptions') setExemptions(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.svc.setEmployeeExemptions(req, id, body?.codes || [], body?.reason); }
}
