import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { companyIdOf, tenantIdOf } from '../../core/context';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { AdaptersService } from './adapters.service';
import { IntegrationsService } from './integrations.service';

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private adapters: AdaptersService, private integrations: IntegrationsService) {}

  // ---------- Legacy connection registry (unchanged behaviour) ----------
  @RequirePermissions('integrations.view')
  @Get() list(@Req() req: any) { return this.integrations.listConnections(companyIdOf(req.user)); }

  // Provider modes (which backend each adapter is wired to)
  @RequirePermissions('integrations.view')
  @Get('providers') providers() { return this.adapters.providers(); }

  // ---------- Control Centre ----------
  @RequirePermissions('integrations.view')
  @Get('status') status(@Req() req: any) { return this.integrations.status(companyIdOf(req.user), tenantIdOf(req.user)); }

  @RequirePermissions('integrations.health.run')
  @Post('health') refresh(@Req() req: any) { return this.integrations.refreshHealth(companyIdOf(req.user), req.user?.sub); }

  @RequirePermissions('integrations.health.run')
  @Post('health/:type') health(@Req() req: any, @Param('type') type: string) { return this.integrations.runHealthCheck(companyIdOf(req.user), type, req.user?.sub); }

  @RequirePermissions('integrations.view')
  @Get('health/history') healthHistory(@Req() req: any, @Query('type') type?: string, @Query('take') take?: string) { return this.integrations.healthHistory(companyIdOf(req.user), type, Number(take) || 50); }

  @RequirePermissions('integrations.view')
  @Get('config/:type') configSchema(@Req() req: any, @Param('type') type: string) { return this.integrations.configSchema(companyIdOf(req.user), type); }

  @RequirePermissions('integrations.configure')
  @Post('config/:type') saveConfig(@Req() req: any, @Param('type') type: string, @Body() body: any) { return this.integrations.saveConfig(companyIdOf(req.user), type, body, req.user?.sub); }

  @RequirePermissions('integrations.health.run')
  @Post('config/:type/test') testConfig(@Req() req: any, @Param('type') type: string) { return this.integrations.testConfig(companyIdOf(req.user), type, req.user?.sub); }

  @RequirePermissions('integrations.view')
  @Get('attention') attention(@Req() req: any) { return this.integrations.attention(companyIdOf(req.user)); }

  @RequirePermissions('integrations.view')
  @Get('activity') activity(@Req() req: any, @Query('type') type?: string, @Query('take') take?: string) { return this.integrations.activity(companyIdOf(req.user), type, Number(take) || 100); }

  @RequirePermissions('integrations.logs.view')
  @Get('logs') logs(@Req() req: any, @Query('type') type?: string, @Query('take') take?: string) { return this.integrations.technicalLogs(companyIdOf(req.user), type, Number(take) || 100); }

  @RequirePermissions('integrations.view')
  @Get('queue/jobs') queueJobs(@Req() req: any, @Query('status') status?: string, @Query('take') take?: string) { return this.integrations.queueJobs(companyIdOf(req.user), status, Number(take) || 100); }

  @RequirePermissions('integrations.queue.retry')
  @Post('queue/jobs/:id/retry') retryJob(@Req() req: any, @Param('id') id: string) { return this.integrations.retryJob(companyIdOf(req.user), id, req.user?.sub); }

  @RequirePermissions('integrations.queue.retry')
  @Post('queue/jobs/:id/discard') discardJob(@Req() req: any, @Param('id') id: string) { return this.integrations.discardJob(companyIdOf(req.user), id, req.user?.sub); }

  @RequirePermissions('integrations.view')
  @Get('messages') messages(@Req() req: any, @Query('channel') channel?: string, @Query('take') take?: string) { return this.integrations.messageLogs(companyIdOf(req.user), channel, Number(take) || 100); }

  @RequirePermissions('integrations.webhooks.view')
  @Get('webhooks/events') webhookEvents(@Req() req: any, @Query('status') status?: string, @Query('take') take?: string) { return this.integrations.webhookEvents(companyIdOf(req.user), status, Number(take) || 100); }

  @RequirePermissions('integrations.webhooks.view')
  @Get('webhooks/events/:id') webhookDetail(@Req() req: any, @Param('id') id: string) { return this.integrations.webhookEventDetail(companyIdOf(req.user), id); }

  // ---------- Diagnostics (developer tools — permission-gated) ----------
  @RequirePermissions('integrations.diagnostics')
  @Post('diagnostics/:action') diagnostics(@Req() req: any, @Param('action') action: string) { return this.integrations.diagnostics(companyIdOf(req.user), action, req.user?.sub); }

  // ---------- Legacy payments (kept for backward compatibility) ----------
  @RequirePermissions('integrations.payment.test')
  @Post('payments') charge(@Req() req: any, @Body() body: any) { return this.adapters.charge({ ...body, companyId: companyIdOf(req.user) }); }
  @RequirePermissions('integrations.payment.test')
  @Get('payments/:reference') paymentStatus(@Param('reference') reference: string) { return this.adapters.paymentStatus(reference); }

  // ---------- Legacy object storage ----------
  @RequirePermissions('integrations.storage.test')
  @Post('storage/upload') upload(@Body() body: { key: string; dataUrl: string; mime?: string }) { return this.adapters.upload(body.key, body.dataUrl, body.mime); }
  @RequirePermissions('integrations.storage.test')
  @Get('storage/:key') async download(@Req() req: any, @Param('key') key: string, @Res() res: any) { const buf = await this.adapters.download(key); res.set({ 'Content-Type': 'application/octet-stream' }); res.send(buf); }

  // ---------- Legacy messaging (kept for backward compatibility) ----------
  @RequirePermissions('integrations.messaging.test')
  @Post('messages/send') sendMessage(@Req() req: any, @Body() body: any) { return this.integrations.sendMessage(companyIdOf(req.user), body, req.user?.sub); }

  // ---------- Legacy queue (kept for backward compatibility) ----------
  @RequirePermissions('integrations.queue.retry')
  @Post('queue') enqueue(@Req() req: any, @Body() body: { type: string; payload: any; sourceModule?: string }) { return this.integrations.enqueueJob(companyIdOf(req.user), body.type, body.payload, body.sourceModule, req.user?.sub); }

  // ---------- Usage metering + billing (unchanged behaviour) ----------
  @RequirePermissions('integrations.view')
  @Post('usage') usage(@Req() req: any, @Body() body: { metric: string; value: number; period?: string }) { return this.adapters.recordUsage(tenantIdOf(req.user), body.metric, Number(body.value || 0), body.period || new Date().toISOString().slice(0, 7)); }
  @RequirePermissions('integrations.view')
  @Get('usage') usageList(@Req() req: any) { return this.adapters.usage(tenantIdOf(req.user)); }
  @RequirePermissions('integrations.view')
  @Get('billing') billing(@Req() req: any) { return this.adapters.billing(tenantIdOf(req.user)); }
}
