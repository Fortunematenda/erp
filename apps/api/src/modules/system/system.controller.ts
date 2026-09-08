import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SystemService } from './system.service';
import { BackupService } from './backup.service';
import { JobsService } from './jobs.service';

@ApiTags('System')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('system')
export class SystemController {
  constructor(private system: SystemService, private backup: BackupService, private jobs: JobsService, private prisma: PrismaService) {}

  // ----- Preferences -----
  @Get('preferences') preferences(@Req() req: any) { return this.system.getPreferences(companyIdOf(req.user)); }
  @Post('preferences') async savePreferences(@Req() req: any, @Body() body: any) { return this.system.savePreferences(companyIdOf(req.user), body); }

  // ----- Numbering -----
  @Get('numbering') numbering(@Req() req: any) { return this.system.numberingConfigs(companyIdOf(req.user)); }
  @Put('numbering/:prefix') setNumbering(@Req() req: any, @Param('prefix') prefix: string, @Body() body: any) { return this.system.setNumbering(companyIdOf(req.user), prefix, body); }
  @Delete('numbering/:prefix') resetNumbering(@Req() req: any, @Param('prefix') prefix: string) { return this.system.resetNumbering(companyIdOf(req.user), prefix); }

  // ----- Jobs -----
  @Get('jobs') jobsList() { return this.jobs.list(); }
  @Put('jobs/:id') updateJob(@Param('id') id: string, @Body() body: any) { return this.jobs.update(id, body); }
  @Post('jobs/:id/run') runJob(@Param('id') id: string) { return this.jobs.runNow(id); }

  // ----- Backups (restore requires platform admin) -----
  @Get('metrics') async metrics() {
    const [users, companies, journals, invoices, receipts, auditLogs, backups, jobs] = await Promise.all([
      this.prisma.user.count(), this.prisma.company.count(), this.prisma.journalEntry.count(), this.prisma.salesInvoice.count(),
      this.prisma.receipt.count(), this.prisma.auditLog.count(), this.prisma.backup.count(), this.prisma.scheduledJob.count(),
    ]);
    return { users, companies, journals, invoices, receipts, auditLogs, backups, jobs, time: new Date().toISOString() };
  }

  @Get('backups') backups() { return this.backup.list(); }
  @Post('backups') createBackup() { return this.backup.create(); }
  @Get('backups/:id/download') async download(@Param('id') id: string, @Res() res: any) {
    const b = await this.backup.download(id);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${b.filename}"` });
    res.sendFile(b.filePath);
  }
  @Post('backups/:id/restore') restore(@Req() req: any, @Param('id') id: string) {
    if (!req.user.isPlatformAdmin) throw new ForbiddenException('Restore requires platform admin');
    return this.backup.restore(id);
  }
}
