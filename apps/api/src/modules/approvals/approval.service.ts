import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { companyIdOf } from '../../core/context';

export const APPROVAL_DOC_TYPES = [
  'PURCHASE_REQUISITION', 'PURCHASE_ORDER', 'SUPPLIER_INVOICE', 'BUDGET', 'JOURNAL_REVERSAL',
  'CHECK', 'STOCK_ADJUSTMENT', 'ASSET_DISPOSAL', 'PAYROLL_RUN',
];

@Injectable()
export class ApprovalService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async ensureDefaults(companyId: string) {
    for (const docType of APPROVAL_DOC_TYPES) {
      const existing = await this.prisma.approvalWorkflow.findUnique({ where: { companyId_documentType: { companyId, documentType: docType } } });
      if (existing) continue;
      const wf = await this.prisma.approvalWorkflow.create({ data: { companyId, documentType: docType, name: `${docType.replace(/_/g, ' ')} Approval` } });
      await this.prisma.approvalStep.create({ data: { workflowId: wf.id, sequence: 1, roleName: 'Company Administrator' } });
    }
  }

  async listWorkflows(companyId: string) {
    await this.ensureDefaults(companyId);
    return this.prisma.approvalWorkflow.findMany({ where: { companyId }, include: { steps: { orderBy: { sequence: 'asc' } } }, orderBy: { documentType: 'asc' } });
  }

  async addStep(companyId: string, workflowId: string, body: any) {
    await this.ensureDefaults(companyId);
    const wf = await this.prisma.approvalWorkflow.findFirst({ where: { id: workflowId, companyId } });
    if (!wf) throw new BadRequestException('Workflow not found');
    const max = await this.prisma.approvalStep.aggregate({ where: { workflowId }, _max: { sequence: true } });
    return this.prisma.approvalStep.create({ data: { workflowId, sequence: (Number(body.sequence) || (max._max.sequence || 0)) + 1, roleName: body.roleName, approverUserId: body.approverUserId, amountFrom: body.amountFrom ?? undefined, amountTo: body.amountTo ?? undefined } });
  }

  async listRequests(companyId: string, filter?: any) {
    const where: any = { companyId };
    if (filter?.status) where.status = filter.status;
    if (filter?.documentType) where.documentType = filter.documentType;
    if (filter?.mine === 'true') where.requesterId = filter.userId;
    return this.prisma.approvalRequest.findMany({ where, include: { actions: { orderBy: { at: 'desc' } } }, orderBy: { submittedAt: 'desc' } });
  }

  async submit(companyId: string, userId: string, body: any) {
    await this.ensureDefaults(companyId);
    const wf = await this.prisma.approvalWorkflow.findFirst({ where: { companyId, documentType: body.documentType } });
    if (!wf) throw new BadRequestException('No workflow for document type');
    const request = await this.prisma.approvalRequest.create({ data: { companyId, workflowId: wf.id, documentType: body.documentType, documentId: body.documentId, documentNo: body.documentNo, amount: Number(body.amount || 0), requesterId: userId, status: 'SUBMITTED', currentStep: 1 } });
    await this.prisma.approvalAction.create({ data: { requestId: request.id, actorId: userId, action: 'SUBMIT', comment: body.comment, step: 1 } });
    await this.audit.log(companyId, userId, 'SUBMIT', 'ApprovalRequest', request.id, { documentType: body.documentType, documentNo: body.documentNo });
    return request;
  }

  async act(companyId: string, userId: string, requestId: string, action: string, comment?: string) {
    const req = await this.prisma.approvalRequest.findFirst({ where: { id: requestId, companyId }, include: { workflow: { include: { steps: true } } } });
    if (!req) throw new BadRequestException('Request not found');
    if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(req.status)) throw new BadRequestException('Request already resolved');
    if (action === 'CANCEL' && req.requesterId !== userId) throw new BadRequestException('Only requester can cancel');
    const steps = (req.workflow?.steps || []).sort((a, b) => a.sequence - b.sequence);
    if (action === 'APPROVE') {
      const nextSeq = req.currentStep + 1;
      const next = steps.find((s) => s.sequence === nextSeq);
      if (next) {
        await this.prisma.approvalRequest.update({ where: { id: req.id }, data: { status: 'PENDING_APPROVAL', currentStep: nextSeq } });
      } else {
        await this.prisma.approvalRequest.update({ where: { id: req.id }, data: { status: 'APPROVED', resolvedAt: new Date(), resolvedBy: userId } });
        if (req.workflow?.documentType) await this.applySourceStatus(companyId, req.documentType, req);
      }
    } else if (action === 'REJECT' || action === 'RETURN') {
      await this.prisma.approvalRequest.update({ where: { id: req.id }, data: { status: action === 'REJECT' ? 'REJECTED' : 'RETURNED', resolvedAt: new Date(), resolvedBy: userId } });
    } else if (action === 'CANCEL') {
      await this.prisma.approvalRequest.update({ where: { id: req.id }, data: { status: 'CANCELLED', resolvedAt: new Date(), resolvedBy: userId } });
    }
    await this.prisma.approvalAction.create({ data: { requestId: req.id, actorId: userId, action, comment, step: req.currentStep } });
    await this.audit.log(companyId, userId, action, 'ApprovalRequest', req.id, { documentType: req.documentType, documentNo: req.documentNo, comment });
    return this.prisma.approvalRequest.findUnique({ where: { id: req.id }, include: { actions: true } });
  }

  private async applySourceStatus(companyId: string, docType: string, req: any) {
    const status = 'APPROVED';
    try {
      if (docType === 'PURCHASE_REQUISITION') await this.prisma.purchaseRequisition.updateMany({ where: { id: req.documentId, companyId }, data: { status } });
      else if (docType === 'PURCHASE_ORDER') await this.prisma.purchaseOrder.updateMany({ where: { id: req.documentId, companyId }, data: { status } });
    } catch { /* ignore source mapping errors */ }
  }
}
