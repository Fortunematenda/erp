import { Body, BadRequestException, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { companyIdOf } from '../../core/context';
import { FiscalisationService } from './fiscalisation.service';

@ApiTags('Fiscalisation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscalisation')
export class FiscalisationController {
  constructor(private fiscal: FiscalisationService) {}

  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('config') config() { return { mode: (process.env.ZIMRA_MODE || 'mock').toLowerCase() }; }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('devices') devices(@Req() req: any) { return this.fiscal.listDevices(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('dashboard') dashboard(@Req() req: any) { return this.fiscal.dashboard(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('ready') ready(@Req() req: any) { return this.fiscal.readyQueue(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('days') days(@Req() req: any) { return this.fiscal.fiscalDays(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.view') @Get('days/:id') day(@Req() req: any, @Param('id') id: string) { return this.fiscal.fiscalDayDetail(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.receipts.view') @Get('receipts') receipts(@Req() req: any) { return this.fiscal.receipts(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.receipts.view') @Get('receipts/:id') receipt(@Req() req: any, @Param('id') id: string) { return this.fiscal.receiptDetail(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.receipts.view') @Get('receipts/:id/history') history(@Req() req: any, @Param('id') id: string) { return this.fiscal.retryHistory(companyIdOf(req.user), id); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.reports.view') @Get('reports') reports(@Req() req: any, @Query() q: any) { return this.fiscal.reports(companyIdOf(req.user), q); }
  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.reports.view') @Get('reconciliation') reconciliation(@Req() req: any) { return this.fiscal.reconciliation(companyIdOf(req.user)); }

  @UseGuards(PermissionsGuard) @RequirePermissions('fiscalisation.operate') @Post('devices/:id/register') register(@Req() req: any, @Param('id') id: string) { return this.fiscal.register(companyIdOf(req.user), id); }
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
