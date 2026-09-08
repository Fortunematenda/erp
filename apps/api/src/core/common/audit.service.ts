import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditMeta = {
  branchId?: string;
  module?: string;
  result?: string;
  reason?: string;
  correlationId?: string;
  metadata?: any;
};

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(companyId: string | undefined, userId: string | undefined, action: string, entityType: string, entityId?: string, meta?: AuditMeta | any) {
    try {
      await this.prisma.auditLog.create({
        data: {
          companyId, userId, action, entityType, entityId,
          branchId: meta?.branchId ?? undefined,
          module: meta?.module ?? undefined,
          result: meta?.result ?? undefined,
          reason: meta?.reason ?? undefined,
          correlationId: meta?.correlationId ?? undefined,
          metadata: meta?.metadata ?? (meta && meta.action ? undefined : meta) ?? undefined,
        },
      });
    } catch {
      /* audit must never break the business operation */
    }
  }
}
