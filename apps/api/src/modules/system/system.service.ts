import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const PREF_KEYS = ['currency', 'vatDefault', 'fiscalRequiredByDefault', 'invoiceDueDays', 'pdfHeader', 'pdfFooter', 'logo', 'companyName', 'email', 'phone', 'address', 'fiscalDeviceId'];

@Injectable()
export class SystemService {
  constructor(private prisma: PrismaService) {}

  async getPreferences(companyId: string) {
    const rows = await this.prisma.systemConfig.findMany({ where: { companyId, key: { startsWith: 'pref.' } } });
    const out: Record<string, any> = {};
    for (const r of rows) out[r.key.replace('pref.', '')] = (r.value as any)?.value ?? r.value;
    return out;
  }

  async savePreferences(companyId: string, prefs: Record<string, any>) {
    await this.prisma.$transaction(async (tx) => {
      for (const k of PREF_KEYS) {
        if (prefs[k] === undefined) continue;
        const key = `pref.${k}`;
        await tx.systemConfig.upsert({
          where: { companyId_key: { companyId, key } },
          update: { value: { value: prefs[k] } },
          create: { companyId, key, value: { value: prefs[k] }, description: k },
        });
      }
    });
    return this.getPreferences(companyId);
  }

  async numberingConfigs(companyId: string) {
    const prefixes = ['INV', 'QT', 'SO', 'RCP', 'CN', 'DN', 'DEL', 'PO', 'GRN', 'PINV', 'SP', 'PRQ', 'PRJ', 'AST', 'EMP', 'JE', 'VC', 'SKU', 'SC', 'BR', 'WH', 'ACC', 'TAX', 'CUS', 'SUP', 'DEPT'];
    const rows = await this.prisma.systemConfig.findMany({ where: { companyId, key: { startsWith: 'numbering:' } } });
    const map: Record<string, any> = {};
    for (const r of rows) {
      const p = r.key.replace('numbering:', '');
      const v = r.value as any;
      const seq = await this.prisma.systemConfig.findUnique({ where: { companyId_key: { companyId, key: `seq:${p}` } } });
      map[p] = { key: p, format: v?.format || '{prefix}-{seq:000000}', start: Number(v?.start) || 1, next: seq ? (Number((seq.value as any)?.value) || 0) + 1 : 1 };
    }
    return { configured: prefixes.filter((p) => map[p]), items: prefixes.map((p) => map[p] || { key: p, format: '{prefix}-{seq:000000}', start: 1, next: null }) };
  }

  async setNumbering(companyId: string, prefix: string, body: { format?: string; start?: number }) {
    const existing = await this.prisma.systemConfig.findUnique({ where: { companyId_key: { companyId, key: `numbering:${prefix}` } } });
    const cur = ((existing?.value as any) || {}) as any;
    const format = body.format ?? cur?.format ?? '{prefix}-{seq:000000}';
    const start = body.start != null ? Number(body.start) : Number(cur?.start) || 1;
    if (!new RegExp('\\{seq').test(format)) throw new BadRequestException('Format must include {seq}');
    await this.prisma.systemConfig.upsert({
      where: { companyId_key: { companyId, key: `numbering:${prefix}` } },
      update: { value: { format, start } },
      create: { companyId, key: `numbering:${prefix}`, value: { format, start }, description: `Numbering ${prefix}` },
    });
    return this.numberingConfigs(companyId);
  }

  async resetNumbering(companyId: string, prefix: string) {
    await this.prisma.systemConfig.deleteMany({ where: { companyId, key: `numbering:${prefix}` } });
    await this.prisma.systemConfig.updateMany({ where: { companyId, key: `seq:${prefix}` }, data: { value: { value: 0 } } });
    return this.numberingConfigs(companyId);
  }
}
