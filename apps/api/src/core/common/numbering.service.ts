import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NumberingService {
  constructor(private prisma: PrismaService) {}

  private async getCfg(companyId: string, prefix: string): Promise<{ format: string; start: number }> {
    const row = await this.prisma.systemConfig.findUnique({ where: { companyId_key: { companyId, key: `numbering:${prefix}` } } });
    const v = row?.value as any;
    return { format: v?.format || '{prefix}-{seq:000000}', start: Number(v?.start) || 1 };
  }

  async next(companyId: string, prefix: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const cfg = await this.getCfg(companyId, prefix);
      const key = `seq:${prefix}`;
      const existing = await tx.systemConfig.findUnique({ where: { companyId_key: { companyId, key } } });
      const nextVal = existing ? (Number((existing.value as any)?.value) || cfg.start) + 1 : cfg.start;
      await tx.systemConfig.upsert({
        where: { companyId_key: { companyId, key } },
        create: { companyId, key, value: { value: nextVal } },
        update: { value: { value: nextVal } },
      });
      return this.render(cfg.format, prefix, nextVal);
    });
  }

  render(format: string, prefix: string, seq: number): string {
    const year = new Date().getFullYear();
    return format
      .replace(/\{prefix\}/g, prefix)
      .replace(/\{year\}/g, String(year))
      .replace(/\{seq:(\d+)\}/g, (_m, spec: string) => String(seq).padStart(spec.length, '0'))
      .replace(/\{seq\}/g, String(seq));
  }
}
