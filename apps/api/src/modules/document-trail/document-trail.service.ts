import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class DocumentTrailService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, input: { documentType: string; documentId: string; eventType: string; title: string; description?: string; fromStatus?: string | null; toStatus?: string | null; metadata?: any; userId?: string | null }) {
    return this.prisma.documentTrailEvent.create({
      data: { companyId, documentType: input.documentType, documentId: input.documentId, eventType: input.eventType, title: input.title, description: input.description, fromStatus: input.fromStatus, toStatus: input.toStatus, metadata: input.metadata ?? undefined, userId: input.userId || null },
    });
  }

  async list(companyId: string, documentType: string, documentId: string, opts: { limit?: number; cursor?: string }) {
    const limit = Math.min(Number(opts?.limit) || 20, 50);
    const where = { companyId, documentType, documentId };
    const rows = await this.prisma.documentTrailEvent.findMany({
      where, orderBy: { createdAt: 'desc' }, take: limit + 1,
      ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    return { events, nextCursor: hasMore ? events[events.length - 1].id : null };
  }

  async addNote(companyId: string, documentType: string, documentId: string, note: string, userId?: string) {
    return this.create(companyId, { documentType, documentId, eventType: 'NOTE_ADDED', title: 'Note Added', description: note, userId });
  }

  async statusChange(companyId: string, documentType: string, doc: any, fromStatus: string | null, toStatus: string, userId?: string) {
    const title = `${documentType === 'QUOTE' ? 'Quote' : 'Invoice'} ${toStatus.replace(/_/g, ' ').toLowerCase()}`
      .replace(/^\w/, (c) => c.toUpperCase()) + (toStatus === 'VOID' ? ' (Void)' : '');
    return this.create(companyId, {
      documentType, documentId: doc.id, eventType: 'STATUS_CHANGED', title: `Status changed to ${toStatus.replace(/_/g, ' ')}`,
      description: `Status changed from ${fromStatus ? fromStatus.replace(/_/g, ' ') : '—'} to ${toStatus.replace(/_/g, ' ')}.`,
      fromStatus, toStatus, userId,
    });
  }
}
