import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface StageDef { code: string; label: string; position: number; probability: number; color: string; isWon: boolean; isLost: boolean; }

export const DEFAULT_STAGES: StageDef[] = [
  { code: 'NEW', label: 'New', position: 0, probability: 10, color: '#003366', isWon: false, isLost: false },
  { code: 'CONTACTED', label: 'Contacted', position: 1, probability: 20, color: '#2563eb', isWon: false, isLost: false },
  { code: 'QUALIFIED', label: 'Qualified', position: 2, probability: 40, color: '#0ea5e9', isWon: false, isLost: false },
  { code: 'OPPORTUNITY', label: 'Opportunity', position: 3, probability: 50, color: '#6366f1', isWon: false, isLost: false },
  { code: 'PROPOSAL', label: 'Proposal', position: 4, probability: 65, color: '#f59e0b', isWon: false, isLost: false },
  { code: 'NEGOTIATION', label: 'Negotiation', position: 5, probability: 80, color: '#8b5cf6', isWon: false, isLost: false },
  { code: 'WON', label: 'Won', position: 6, probability: 100, color: '#10b981', isWon: true, isLost: false },
  { code: 'LOST', label: 'Lost', position: 7, probability: 0, color: '#ef4444', isWon: false, isLost: true },
];

export function stageDef(code: string): StageDef {
  return DEFAULT_STAGES.find((s) => s.code === code) || DEFAULT_STAGES[0];
}

@Injectable()
export class CrmService {
  constructor(private prisma: PrismaService) {}

  async ensureStages(companyId: string) {
    const existing = await this.prisma.crmStage.findMany({ where: { companyId } });
    const have = new Set(existing.map((s) => s.code));
    for (const s of DEFAULT_STAGES) {
      if (have.has(s.code)) continue;
      await this.prisma.crmStage.create({ data: { companyId, code: s.code, label: s.label, position: s.position, probability: s.probability, color: s.color, isWon: s.isWon, isLost: s.isLost } });
    }
    return this.prisma.crmStage.findMany({ where: { companyId }, orderBy: { position: 'asc' } });
  }

  async stages(companyId: string) {
    const rows = await this.prisma.crmStage.findMany({ where: { companyId } });
    if (rows.length === 0) return this.ensureStages(companyId);
    return rows.sort((a, b) => a.position - b.position);
  }

  async event(companyId: string, input: { leadId?: string | null; opportunityId?: string | null; customerId?: string | null; type: string; message?: string; actorName?: string; metadata?: any }) {
    return this.prisma.crmEvent.create({ data: { companyId, leadId: input.leadId ?? undefined, opportunityId: input.opportunityId ?? undefined, customerId: input.customerId ?? undefined, type: input.type, message: input.message, actorName: input.actorName, metadata: input.metadata ?? undefined } });
  }

  touchActivity(companyId: string, relatedType: string, relatedId: string) {
    if (relatedType === 'LEAD') return this.prisma.lead.update({ where: { id: relatedId }, data: { lastActivityAt: new Date() } }).catch(() => {});
    return Promise.resolve();
  }

  validateTransition(opts: { from?: string | null; to: string; lostReason?: string | null; closingWon?: boolean }) {
    const to = stageDef(opts.to);
    if (to.isLost) {
      if (!opts.lostReason) throw new BadRequestException('Lost reason is required to mark a deal lost.');
      return;
    }
    if (to.isWon) {
      return; // won handled by dedicated workflow
    }
    if (opts.from === opts.to) throw new BadRequestException('Record is already in that stage.');
  }
}
