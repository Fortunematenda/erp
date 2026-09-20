import { PrismaService } from '../../core/prisma/prisma.service';

export type TransactionPostingMode = 'AUTOMATIC' | 'MANUAL' | 'APPROVAL_BASED';

/** Company posting workflow preference. Default AUTOMATIC. */
export async function getTransactionPostingMode(prisma: PrismaService, companyId: string): Promise<TransactionPostingMode> {
  const row = await prisma.systemConfig.findFirst({ where: { companyId, key: 'cfg.finance.transactionPostingMode' } });
  const raw = String((row?.value as any)?.value ?? 'AUTOMATIC').toUpperCase();
  if (raw === 'MANUAL' || raw === 'APPROVAL_BASED') return raw;
  return 'AUTOMATIC';
}
