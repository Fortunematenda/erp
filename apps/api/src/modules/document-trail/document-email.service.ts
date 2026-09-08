import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { DocumentPdfService } from '../documents/document-pdf.service';
import { DocumentTrailService } from './document-trail.service';
import { decryptSecret } from '../../core/common/secret';
import * as nodemailer from 'nodemailer';

@Injectable()
export class DocumentEmailService {
  constructor(private prisma: PrismaService, private pdf: DocumentPdfService, private trail: DocumentTrailService) {}

  private async smtpConfig(companyId: string) {
    const rows = await this.prisma.systemConfig.findMany({ where: { companyId, key: { startsWith: 'cfg.messaging.' } } });
    const map: Record<string, any> = {};
    for (const r of rows) { const k = r.key.replace('cfg.messaging.', ''); const v = (r.value as any)?.value; map[k] = v; }
    const password = map.password && typeof map.password === 'object' ? decryptSecret(map.password) : map.password;
    return { host: map.host || '', port: Number(map.port) || 587, secure: Number(map.port) === 465, user: map.username || '', pass: password || '', from: map.fromAddress || '', provider: map.provider || 'mock' };
  }

  async send(companyId: string, userId: string, body: { documentType: 'INVOICE' | 'QUOTE'; documentId: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; message?: string }) {
    const docType = body.documentType;
    const cfg = await this.smtpConfig(companyId);
    if (cfg.provider !== 'smtp' || !cfg.host || !cfg.pass) {
      throw new BadRequestException('Email sending has not been configured for this company. Configure SMTP in Administration → Integrations / Email Settings.');
    }
    const model = docType === 'INVOICE' ? 'salesInvoice' : 'quotation';
    const doc: any = await (this.prisma as any)[model].findUnique({ where: { id: body.documentId }, include: { customer: true } });
    if (!doc) throw new BadRequestException('Document not found');
    const prefix = docType === 'INVOICE' ? 'Invoice' : 'Quote';
    const noField = docType === 'INVOICE' ? doc.invoiceNo : doc.quotationNo;
    const fileName = `${prefix}_${String(noField || doc.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

    // Generate the PDF using the SAME renderer as the PDF button.
    const vm = { kind: docType === 'INVOICE' ? 'invoice' : 'quote', number: noField, date: docType === 'INVOICE' ? doc.invoiceDate : doc.quotationDate, dueDate: docType === 'INVOICE' ? doc.dueDate : null, validUntil: docType === 'INVOICE' ? null : doc.validUntil, status: doc.status, company: { name: 'NexusERP' }, party: doc.customer ? { name: doc.customer.name, email: doc.customer.email } : null, lines: [], subtotal: Number(doc.subtotal || 0), taxTotal: Number(doc.taxTotal || 0), total: Number(doc.total || 0) };
    const pdfBuf = await this.pdf.generate(vm);

    const transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined });
    const to = body.to.filter(Boolean).join(', ');
    try {
      const info = await transport.sendMail({
        from: cfg.from || cfg.user,
        to, cc: body.cc?.filter(Boolean).join(', '), bcc: body.bcc?.filter(Boolean).join(', '),
        subject: body.subject, text: body.message || '',
        attachments: [{ filename: fileName, content: pdfBuf }],
      });
      await this.prisma.documentEmailLog.create({ data: { companyId, documentType: docType, documentId: doc.id, to, cc: body.cc || [], bcc: body.bcc || [], subject: body.subject, provider: 'smtp', status: 'SENT', attachmentFileName: fileName, sentByUserId: userId, sentAt: new Date(), messageId: info.messageId } });
      await this.trail.create(companyId, { documentType: docType, documentId: doc.id, eventType: 'EMAIL_SENT', title: 'Email Sent', description: `${prefix} emailed to ${to}.`, metadata: { to, cc: body.cc || [], subject: body.subject, attachment: fileName, messageId: info.messageId }, userId });
      return { status: 'SENT', messageId: info.messageId, sentTo: to };
    } catch (e: any) {
      await this.prisma.documentEmailLog.create({ data: { companyId, documentType: docType, documentId: doc.id, to, cc: body.cc || [], bcc: body.bcc || [], subject: body.subject, provider: 'smtp', status: 'FAILED', attachmentFileName: fileName, sentByUserId: userId, errorCode: e.code, errorMessage: e.message } });
      await this.trail.create(companyId, { documentType: docType, documentId: doc.id, eventType: 'EMAIL_FAILED', title: 'Email Failed', description: `Unable to send ${prefix} ${noField} to ${to}.`, metadata: { to, error: e.message }, userId });
      throw new BadRequestException('Email could not be sent. ' + (e.message || '').slice(0, 160));
    }
  }
}
