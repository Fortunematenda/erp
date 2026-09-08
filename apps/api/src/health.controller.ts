import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from './core/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  @Get() check() { return { ok: true, service: 'nexuserp-api', time: new Date().toISOString() }; }
  @Get('ready') async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const [users, journals, backups] = await Promise.all([
        this.prisma.user.count(), this.prisma.journalEntry.count(), this.prisma.backup.count(),
      ]);
      return { ok: true, ready: true, db: 'up', counts: { users, journals, backups }, time: new Date().toISOString() };
    } catch (e: any) {
      return { ok: false, ready: false, db: 'down', error: e.message };
    }
  }
}
