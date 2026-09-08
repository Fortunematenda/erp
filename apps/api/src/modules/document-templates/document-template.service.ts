import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { validateTemplateInput } from './template.validation';

@Injectable()
export class DocumentTemplateService {
  constructor(private prisma: PrismaService) {}

  private normalizeType(type: string) {
    const t = String(type || '').toUpperCase();
    if (t === 'INVOICE' || t === 'QUOTE' || t === 'INVOICES' || t === 'QUOTES' || t === 'QUOTE_' || t === 'quotation') return t.startsWith('QU') ? 'QUOTE' : 'INVOICE';
    throw new BadRequestException('documentType must be INVOICE or QUOTE');
  }

  async getFor(companyId: string, type: string) {
    const docType = this.normalizeType(type);
    let tpl = await this.prisma.documentTemplate.findFirst({ where: { companyId, documentType: docType }, orderBy: { isDefault: 'desc' } });
    if (!tpl) tpl = await this.prisma.documentTemplate.create({ data: { companyId, documentType: docType, name: docType === 'INVOICE' ? 'Professional Blue' : 'Professional Blue Quote' } });
    return this.serialize(tpl);
  }

  async list(companyId: string) {
    const rows = await this.prisma.documentTemplate.findMany({ where: { companyId }, orderBy: [{ documentType: 'asc' }, { isDefault: 'desc' }] });
    return rows.map((r) => this.serialize(r));
  }

  async save(companyId: string, type: string, body: any, userId?: string) {
    const docType = this.normalizeType(type);
    const current = await this.getFor(companyId, docType);
    const data = validateTemplateInput(body, docType);
    const updated = await this.prisma.documentTemplate.update({ where: { id: current.id }, data: { ...data, ...(userId ? { updatedBy: userId } : {}) } });
    await this.audit(companyId, userId, 'TEMPLATE_CHANGED', docType, updated.id);
    return this.serialize(updated);
  }

  async reset(companyId: string, type: string, userId?: string) {
    const docType = this.normalizeType(type);
    const current = await this.getFor(companyId, docType);
    const refreshed = await this.prisma.documentTemplate.update({
      where: { id: current.id },
      data: {
        name: docType === 'INVOICE' ? 'Professional Blue' : 'Professional Blue Quote',
        logoUrl: null, logoPosition: 'left', logoSize: 'medium',
        primaryColor: '#003366', secondaryColor: '#0b4a8f', textColor: '#171a2e', mutedColor: '#6b7280', tableHeaderColor: '#003366', tableHeaderTextColor: '#ffffff',
        fontFamily: 'Inter', baseFontSize: 13, density: 'normal', layoutStyle: 'classic', tableStyle: 'modern', totalsStyle: 'highlighted', customerBlockLayout: 'stacked', stampPosition: 'center',
        showCompanyFields: {}, showCustomerFields: {}, columns: [], showDeliveryAddress: false, hideDuplicateDeliveryAddress: true,
        showPaymentStatus: true, showBalanceDue: true, showPaymentDetails: true, showFiscalInformation: true, showFiscalQrCode: false, invoiceTitle: 'INVOICE',
        showNotes: true, showStatementMemo: true, statementMemo: null, invoiceTerms: null, footerMessage: 'Thank you for your business!', footerAlignment: 'center',
        footerShowPageNumber: true, footerShowCompanyContact: true, footerShowCompanyWebsite: true,
        quoteTitle: 'QUOTATION', preparedForLabel: 'PREPARED FOR', showValidity: true, validityMessage: 'This quotation is valid for {{validityDays}} days from the date of issue.', validityDays: 30,
        showAcceptanceSection: true, acceptanceNotesAllowed: false, quoteTerms: null, quoteFooterMessage: 'Thank you for the opportunity to quote.',
        ...(userId ? { updatedBy: userId } : {}),
      },
    });
    await this.audit(companyId, userId, 'TEMPLATE_RESET', docType, refreshed.id);
    return this.serialize(refreshed);
  }

  async duplicate(companyId: string, type: string, body: { name?: string }, userId?: string) {
    const docType = this.normalizeType(type);
    const current = await this.getFor(companyId, docType);
    const name = body?.name ? String(body.name).slice(0, 80) : `${docType === 'INVOICE' ? 'Invoice' : 'Quote'} Template Copy`;
    const existing = await this.prisma.documentTemplate.findFirst({ where: { companyId, name } });
    if (existing) throw new BadRequestException('A template with that name already exists');
    const { id: _id, updatedAt: _u, createdAt: _c, ...rest } = current;
    const copy = await this.prisma.documentTemplate.create({ data: { ...rest, name, isDefault: false, createdBy: userId, updatedBy: userId } });
    await this.audit(companyId, userId, 'TEMPLATE_DUPLICATED', docType, copy.id);
    return this.serialize(copy);
  }

  async setDefault(companyId: string, type: string, id: string, userId?: string) {
    const docType = this.normalizeType(type);
    await this.prisma.$transaction(async (tx) => {
      await tx.documentTemplate.updateMany({ where: { companyId, documentType: docType }, data: { isDefault: false } });
      await tx.documentTemplate.update({ where: { id }, data: { isDefault: true, updatedBy: userId } });
    });
    await this.audit(companyId, userId, 'DEFAULT_CHANGED', docType, id);
    return this.serialize(await this.prisma.documentTemplate.findUnique({ where: { id } }));
  }

  private serialize(t: any) {
    const d = { ...t };
    delete (d as any).createdAt; delete (d as any).updatedAt;
    return d;
  }

  private async audit(companyId: string, userId: string | undefined, action: string, type: string, templateId: string) {
    if (!userId) return;
    try { await this.prisma.auditLog.create({ data: { companyId, userId, action, entityType: 'DocumentTemplate', entityId: templateId, metadata: { documentType: type } } }); } catch {}
  }
}
