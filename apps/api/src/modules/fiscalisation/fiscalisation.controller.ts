import { Body, BadRequestException, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { companyIdOf } from '../../core/context';
import { FiscalisationService } from './fiscalisation.service';
import { FiscalRateLimitGuard } from './fiscal-rate-limit.guard';

@ApiTags('Fiscalisation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, FiscalRateLimitGuard)
@Controller('fiscalisation')
export class FiscalisationController {
  constructor(private fiscal: FiscalisationService) {}

  private userId(req: any) { return req.user?.sub; }

  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('config') async config(@Req() req: any) {
    const profile = await this.fiscal.profile(companyIdOf(req.user));
    return { mode: (profile.environment || 'MOCK').toLowerCase(), environment: profile.environment };
  }

  // ---------- Setup profile & wizard ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('profile') profile(@Req() req: any) { return this.fiscal.profile(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Put('profile') saveProfile(@Req() req: any, @Body() body: any) { return this.fiscal.saveProfile(companyIdOf(req.user), this.userId(req), body); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('readiness') readiness(@Req() req: any, @Query('target') target?: string) { return this.fiscal.readiness(companyIdOf(req.user), (target || 'PRODUCTION').toUpperCase() as any); }

  // ---------- Taxpayer verification ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.operate') @Post('taxpayer/verify') verifyTaxpayer(@Req() req: any, @Body() body: { environment?: string }) { return this.catchProvider(() => this.fiscal.verifyTaxpayer(companyIdOf(req.user), this.userId(req), body?.environment)); }

  // ---------- Devices ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('devices') devices(@Req() req: any) { return this.fiscal.listDevices(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Post('devices') createDevice(@Req() req: any, @Body() body: any) { return this.fiscal.createDevice(companyIdOf(req.user), this.userId(req), body); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Put('devices/:id') saveDevice(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.fiscal.saveDevice(companyIdOf(req.user), this.userId(req), id, body); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.operate') @Post('devices/:id/sync-config') syncConfig(@Req() req: any, @Param('id') id: string) { return this.catchProvider(() => this.fiscal.syncConfig(companyIdOf(req.user), this.userId(req), id)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Post('devices/:id/generate-csr') generateCsr(@Req() req: any, @Param('id') id: string) { return this.fiscal.generateCsr(companyIdOf(req.user), this.userId(req), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Post('devices/:id/certificate') installCertificate(@Req() req: any, @Param('id') id: string, @Body() body: { certificatePem: string }) { return this.fiscal.installCertificate(companyIdOf(req.user), this.userId(req), id, body?.certificatePem); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Post('devices/:id/reissue-certificate') reissueCertificate(@Req() req: any, @Param('id') id: string) { return this.fiscal.reissueCertificate(companyIdOf(req.user), this.userId(req), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('classification') classification(@Req() req: any) { return this.fiscal.classification(companyIdOf(req.user)); }

  // ---------- Branch registration ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('branches') branches(@Req() req: any) { return this.fiscal.branches(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Put('branches/:id') saveBranch(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.fiscal.saveBranch(companyIdOf(req.user), this.userId(req), id, body); }

  // ---------- Tax mapping ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('tax-mappings') taxMappings(@Req() req: any) { return this.fiscal.taxMappings(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Put('tax-mappings') saveTaxMapping(@Req() req: any, @Body() body: any) { return this.fiscal.saveTaxMapping(companyIdOf(req.user), this.userId(req), body); }

  // ---------- Registration assistance & evidence ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('requests') requests(@Req() req: any) { return this.fiscal.requests(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Post('requests') saveRequest(@Req() req: any, @Body() body: any) { return this.fiscal.saveRequest(companyIdOf(req.user), this.userId(req), body?.id, body); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Post('requests/email') requestEmail(@Req() req: any, @Body() body: { assistance?: string; deviceId?: string }) { return this.fiscal.buildRequestEmail(companyIdOf(req.user), body || {}); }

  // ---------- Environment management ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Post('environment/switch') switchEnvironment(@Req() req: any, @Body() body: { target: string; reason?: string }) { return this.fiscal.switchEnvironment(companyIdOf(req.user), this.userId(req), body?.target, body?.reason || ''); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Post('production/activate') activateProduction(@Req() req: any, @Body() body: { confirm?: boolean; reason?: string }) { return this.fiscal.activateProduction(companyIdOf(req.user), this.userId(req), body || {}); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('integration-logs') integrationLogs(@Req() req: any, @Query() q: any) { return this.fiscal.integrationLogs(companyIdOf(req.user), q); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Post('reconcile') reconcile(@Req() req: any) { return this.fiscal.reconcileFiscalStatuses(companyIdOf(req.user)); }

  // ---------- Operations ----------
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('dashboard') dashboard(@Req() req: any) { return this.fiscal.dashboard(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('ready') ready(@Req() req: any) { return this.fiscal.readyQueue(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('days') days(@Req() req: any) { return this.fiscal.fiscalDays(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('days/:id') day(@Req() req: any, @Param('id') id: string) { return this.fiscal.fiscalDayDetail(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.receipts.view') @Get('receipts') receipts(@Req() req: any) { return this.fiscal.receipts(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.receipts.view') @Get('receipts/:id') receipt(@Req() req: any, @Param('id') id: string) { return this.fiscal.receiptDetail(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.receipts.view') @Get('receipts/:id/history') history(@Req() req: any, @Param('id') id: string) { return this.fiscal.retryHistory(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.reports.view') @Get('reports') reports(@Req() req: any, @Query() q: any) { return this.fiscal.reports(companyIdOf(req.user), q); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.reports.view') @Get('reconciliation') reconciliation(@Req() req: any) { return this.fiscal.reconciliation(companyIdOf(req.user)); }

  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.operate') @Post('devices/:id/register') register(@Req() req: any, @Param('id') id: string) { return this.catchProvider(() => this.fiscal.register(companyIdOf(req.user), id)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.days.open') @Post('devices/:id/open-day') open(@Req() req: any, @Param('id') id: string) { return this.fiscal.openDay(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.days.close') @Post('devices/:id/close-day') close(@Req() req: any, @Param('id') id: string) { return this.fiscal.closeDay(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.submit') @Post('devices/:id/fiscalise') async fiscalise(@Req() req: any, @Param('id') id: string, @Body() body: { invoiceId: string }) { return this.catchProvider(() => this.fiscal.fiscalise(companyIdOf(req.user), id, body.invoiceId)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.submit') @Post('devices/:id/fiscalise-credit-note') async creditNote(@Req() req: any, @Param('id') id: string, @Body() body: { creditNoteId: string }) { return this.catchProvider(() => this.fiscal.fiscaliseCreditNote(companyIdOf(req.user), id, body.creditNoteId)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.submit') @Post('devices/:id/fiscalise-debit-note') async debitNote(@Req() req: any, @Param('id') id: string, @Body() body: { debitNoteId: string }) { return this.catchProvider(() => this.fiscal.fiscaliseDebitNote(companyIdOf(req.user), id, body.debitNoteId)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.retry') @Post('retry') retry(@Req() req: any) { return this.fiscal.retryFiscalReceipts(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.configuration.manage') @Post('mock/simulate-failure') simulateFailure(@Req() req: any, @Body() body: { on?: boolean }) { this.fiscal.simulateFailure(body?.on !== false); return { ok: true, enabled: body?.on !== false }; }

  private catchProvider(fn: () => Promise<any>) {
    return fn().catch((e: any) => {
      const message = e?.message || 'Fiscalisation failed';
      throw new BadRequestException(message.includes('SIMULATED') ? 'Fiscalisation failed — the fiscal provider could not process the receipt.' : message);
    });
  }
}
