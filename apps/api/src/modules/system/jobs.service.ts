import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BackupService } from './backup.service';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService, private backup: BackupService) {}

  async list() {
    return this.prisma.scheduledJob.findMany({ include: { runs: { orderBy: { startedAt: 'desc' }, take: 5 } }, orderBy: { createdAt: 'asc' } });
  }

  async seed() {
    const defaults = [
      { name: 'Automatic database backup', type: 'BACKUP', intervalSeconds: 86400 },
      { name: 'Fiscal receipt retry', type: 'FISCAL_RETRY', intervalSeconds: 600 },
      { name: 'Compliance deadline reminders', type: 'COMPLIANCE_REMINDERS', intervalSeconds: 86400 },
      { name: 'Audit log retention', type: 'AUDIT_PRUNE', intervalSeconds: 86400 },
    ];
    for (const d of defaults) {
      const existing = await this.prisma.scheduledJob.findFirst({ where: { type: d.type } });
      if (!existing) await this.prisma.scheduledJob.create({ data: d });
    }
  }

  async update(id: string, body: { name?: string; intervalSeconds?: number; enabled?: boolean; payload?: any }) {
    return this.prisma.scheduledJob.update({ where: { id }, data: { ...(body.name != null ? { name: body.name } : {}), ...(body.intervalSeconds != null ? { intervalSeconds: Number(body.intervalSeconds) } : {}), ...(body.enabled != null ? { enabled: body.enabled } : {}), ...(body.payload != null ? { payload: body.payload } : {}) } });
  }

  async runNow(id: string) {
    const job = await this.prisma.scheduledJob.findUnique({ where: { id } });
    if (!job) throw new BadRequestException('Job not found');
    return this.execute(job);
  }

  async execute(job: any) {
    const run = await this.prisma.jobRun.create({ data: { jobId: job.id, status: 'RUNNING' } });
    try {
      const result = await this.runExecutor(job.type, job.payload as any);
      await this.prisma.$transaction(async (tx) => {
        await tx.jobRun.update({ where: { id: run.id }, data: { status: 'OK', finishedAt: new Date(), result } });
        await tx.scheduledJob.update({ where: { id: job.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date(), lastStatus: 'OK', lastError: null, nextRunAt: new Date(Date.now() + job.intervalSeconds * 1000) } });
      });
      return { id: run.id, runId: run.id, status: 'OK', result };
    } catch (e: any) {
      await this.prisma.$transaction(async (tx) => {
        await tx.jobRun.update({ where: { id: run.id }, data: { status: 'ERROR', finishedAt: new Date(), error: e.message } });
        await tx.scheduledJob.update({ where: { id: job.id }, data: { lastRunAt: new Date(), lastStatus: 'ERROR', lastError: e.message, nextRunAt: new Date(Date.now() + job.intervalSeconds * 1000) } });
      });
      return { id: run.id, runId: run.id, status: 'ERROR', error: e.message };
    }
  }

  private async runExecutor(type: string, payload: any): Promise<any> {
    switch (type) {
      case 'BACKUP': {
        const b = await this.backup.create();
        return { backupId: b.id, filename: b.filename, size: b.size, status: b.status };
      }
      case 'FISCAL_RETRY': {
        const companyId = payload?.companyId || (await this.prisma.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
        if (!companyId) return { retried: 0, skipped: 1 };
        const receipts = await this.prisma.fiscalReceipt.findMany({ where: { status: 'RETRY', OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] } });
        return { retried: 0, pending: receipts.length, note: 'Automatic retry pending manual device day availability; see fiscalisation module.' };
      }
      case 'COMPLIANCE_REMINDERS': {
        const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        const due = await this.prisma.complianceObligation.count({ where: { dueDate: { lte: soon }, status: { not: 'COMPLIANT' } } });
        return { dueWithin7Days: due };
      }
      case 'AUDIT_PRUNE': {
        const days = Number(process.env.AUDIT_RETENTION) || 365;
        const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
        const res = await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
        return { deleted: res.count, retentionDays: days };
      }
      default:
        throw new BadRequestException(`Unknown job type ${type}`);
    }
  }
}
