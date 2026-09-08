import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { DocumentTrailService } from '../document-trail/document-trail.service';

export const QUOTE_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CONVERTED',
  'CANCELLED',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const ALIASES: Record<string, QuoteStatus> = {
  DRAFT: 'DRAFT',
  OPEN: 'SENT',
  PENDING: 'PENDING_APPROVAL',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  SENT: 'SENT',
  VIEWED: 'VIEWED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  DECLINED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CONVERTED: 'CONVERTED',
  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
};

/** Free-form PATCH transitions. CONVERTED is an action, not a status PATCH. */
const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'SENT', 'CANCELLED', 'EXPIRED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED', 'REJECTED'],
  APPROVED: ['SENT', 'CANCELLED', 'EXPIRED'],
  SENT: ['VIEWED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  VIEWED: ['ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['CANCELLED'],
  REJECTED: [],
  EXPIRED: [],
  CONVERTED: [],
  CANCELLED: [],
};

const CONVERTIBLE: QuoteStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED', 'ACCEPTED'];

@Injectable()
export class QuotationStatusService {
  constructor(private prisma: PrismaService, private audit: AuditService, private trail: DocumentTrailService) {}

  normalize(raw?: string | null): QuoteStatus {
    const key = String(raw || 'DRAFT').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const mapped = ALIASES[key];
    if (!mapped) throw new BadRequestException(`Unknown quotation status "${raw}"`);
    return mapped;
  }

  allowedFrom(from: QuoteStatus): QuoteStatus[] {
    return TRANSITIONS[from] || [];
  }

  isExpired(validUntil?: Date | null, now = new Date()): boolean {
    if (!validUntil) return false;
    return new Date(validUntil).getTime() < now.getTime();
  }

  async transition(companyId: string, quotationId: string, nextRaw: string, userId: string, opts?: { reason?: string }) {
    const quotation = await this.prisma.quotation.findFirst({ where: { id: quotationId, companyId } });
    if (!quotation) throw new BadRequestException('Quotation not found');
    const from = this.normalize(quotation.status);
    const to = this.normalize(nextRaw);
    if (from === to) return quotation;

    if (to === 'CONVERTED') {
      throw new BadRequestException('Conversion is an action. Use convert-to-order or convert-to-invoice instead of patching status.');
    }

    const expired = this.isExpired(quotation.validUntil);
    if (expired && !['EXPIRED', 'CANCELLED'].includes(to) && from !== 'EXPIRED') {
      throw new BadRequestException('This quotation has passed its validity date and cannot be moved to that status. Mark it expired or cancel it.');
    }
    if (to === 'EXPIRED' && !expired && from !== 'EXPIRED') {
      // Allow explicit expire only when validity has lapsed, or keep as a manual override when validUntil is set in the past.
      if (quotation.validUntil && !expired) throw new BadRequestException('Quotation is still within its validity period');
    }

    const allowed = this.allowedFrom(from);
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Cannot change quotation status from ${from} to ${to}`);
    }

    const updated = await this.prisma.quotation.update({ where: { id: quotation.id }, data: { status: to } });
    await this.audit.log(companyId, userId, 'STATUS_CHANGE', 'Quotation', quotation.id, {
      module: 'sales',
      result: 'SUCCESS',
      metadata: { from, to, quotationNo: quotation.quotationNo, reason: opts?.reason },
    });
    await this.trail.statusChange(companyId, 'QUOTE', quotation, from, to, userId).catch(() => {});
    return updated;
  }

  assertConvertible(status: string, validUntil?: Date | null) {
    const from = this.normalize(status);
    if (!CONVERTIBLE.includes(from)) {
      throw new BadRequestException(`Cannot convert a ${from} quotation`);
    }
    if (this.isExpired(validUntil) && from !== 'ACCEPTED') {
      throw new BadRequestException('Cannot convert an expired quotation');
    }
    return from;
  }

  async markConverted(companyId: string, quotationId: string, userId: string, conversionType: 'SALES_ORDER' | 'INVOICE', meta?: any) {
    const quotation = await this.prisma.quotation.findFirst({ where: { id: quotationId, companyId } });
    if (!quotation) throw new BadRequestException('Quotation not found');
    this.assertConvertible(quotation.status, quotation.validUntil);
    await this.audit.log(companyId, userId, 'CONVERT', 'Quotation', quotation.id, {
      module: 'sales',
      result: 'SUCCESS',
      metadata: { from: quotation.status, to: 'CONVERTED', conversionType, quotationNo: quotation.quotationNo, ...meta },
    });
  }
}
