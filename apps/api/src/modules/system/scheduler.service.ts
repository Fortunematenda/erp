import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JobsService } from './jobs.service';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Scheduler');
  private timer: any;
  private running = false;

  constructor(private prisma: PrismaService, private jobs: JobsService) {}

  async onModuleInit() {
    await this.jobs.seed();
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const now = new Date();
        const due = await this.prisma.scheduledJob.findMany({ where: { enabled: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null, lastRunAt: null }] } });
        for (const job of due) await this.jobs.execute(job);
      } catch (e: any) {
        this.logger.error(e.message);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => { tick(); }, Number(process.env.SCHEDULER_TICK_MS) || 30000);
    setTimeout(() => tick(), 5000);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
