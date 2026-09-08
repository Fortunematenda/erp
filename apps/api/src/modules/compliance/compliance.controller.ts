import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { ObligationDto, RiskDto } from './compliance.dto';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { StatusDto } from '../sales/sales.dto';

@ApiTags('Compliance') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('compliance')
export class ComplianceController {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService) {}

  // ----- Risk register -----
  @Get('risks') risks(@Req() req: any) { return this.prisma.risk.findMany({ where: { companyId: companyIdOf(req.user) } }); }
  @Post('risks') async createRisk(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const code = body.code || `${body.category || 'RSK'}-${Math.floor(Math.random() * 900 + 100)}`;
    const risk = await this.prisma.risk.create({ data: { companyId, code, title: body.title, category: body.category, description: body.description, likelihood: body.likelihood ?? 1, impact: body.impact ?? 1, residualLikelihood: body.residualLikelihood ?? body.likelihood ?? 1, residualImpact: body.residualImpact ?? body.impact ?? 1, controls: body.controls, owner: body.owner, status: (body.status || 'OPEN') as any, mitigation: body.mitigation, dueDate: body.dueDate ? new Date(body.dueDate) : undefined, reviewDate: body.reviewDate ? new Date(body.reviewDate) : undefined } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Risk', risk.id, { code });
    return risk;
  }
  @Patch('risks/:id') updateRisk(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const data: any = { ...body };
    if (body.dueDate) data.dueDate = new Date(body.dueDate);
    if (body.reviewDate) data.reviewDate = new Date(body.reviewDate);
    return this.prisma.risk.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @Patch('risks/:id/status') updateRiskStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.prisma.risk.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { status: dto.status as any } });
  }
  @Delete('risks/:id') async deleteRisk(@Req() req: any, @Param('id') id: string) {
    await this.prisma.risk.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Compliance obligations -----
  @Get('obligations') obligations(@Req() req: any) { return this.prisma.complianceObligation.findMany({ where: { companyId: companyIdOf(req.user) }, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }] }); }
  @Post('obligations') async createObligation(@Req() req: any, @Body() dto: ObligationDto) {
    const companyId = companyIdOf(req.user);
    const obligation = await this.prisma.complianceObligation.create({ data: { companyId, authority: dto.authority, title: dto.title, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, frequency: dto.frequency, status: dto.status || 'OPEN', notes: dto.notes } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'ComplianceObligation', obligation.id);
    return obligation;
  }
  @Patch('obligations/:id') updateObligation(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<ObligationDto>) {
    const data: any = { ...dto };
    if (dto.dueDate) data.dueDate = new Date(dto.dueDate);
    return this.prisma.complianceObligation.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @Patch('obligations/:id/status') updateObligationStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.prisma.complianceObligation.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { status: dto.status } });
  }
  @Delete('obligations/:id') async deleteObligation(@Req() req: any, @Param('id') id: string) {
    await this.prisma.complianceObligation.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Reports -----
  @Get('calendar') calendar(@Req() req: any) {
    return this.prisma.complianceObligation.findMany({ where: { companyId: companyIdOf(req.user), status: { not: 'COMPLETED' } }, orderBy: { dueDate: 'asc' } });
  }
  @Get('report') async report(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const [risks, obligations] = await Promise.all([
      this.prisma.risk.groupBy({ by: ['status'], where: { companyId }, _count: true }),
      this.prisma.complianceObligation.groupBy({ by: ['status'], where: { companyId }, _count: true }),
    ]);
    return { risksByStatus: risks, obligationsByStatus: obligations };
  }

  // ----- Internal controls -----
  @Get('internal-controls') internalControls(@Req() req: any) { return this.prisma.internalControl.findMany({ where: { companyId: companyIdOf(req.user) }, include: { tests: { include: { evidence: true } } } }); }
  @Post('internal-controls') createControl(@Req() req: any, @Body() body: any) { return this.prisma.internalControl.create({ data: { companyId: companyIdOf(req.user), controlId: body.controlId, process: body.process, owner: body.owner, frequency: body.frequency, designEffectiveness: body.designEffectiveness, operatingEffectiveness: body.operatingEffectiveness, nextTest: body.nextTest ? new Date(body.nextTest) : undefined } }); }
  @Post('internal-controls/:id/test') addControlTest(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.controlTest.create({ data: { companyId, controlId: id, result: body.result, evidence: body.evidence?.dataUrl ? { create: { companyId, name: body.evidence.name, dataUrl: body.evidence.dataUrl } } : undefined }, include: { evidence: true } });
  }

  // ----- Audit engagements -----
  @Get('audits') audits(@Req() req: any) { return this.prisma.auditEngagement.findMany({ where: { companyId: companyIdOf(req.user) }, include: { procedures: true, findings: { include: { actions: true } } } }); }
  @Post('audits') createAudit(@Req() req: any, @Body() body: any) { return this.prisma.auditEngagement.create({ data: { companyId: companyIdOf(req.user), name: body.name, scope: body.scope, status: body.status || 'PLANNED', startDate: body.startDate ? new Date(body.startDate) : undefined, endDate: body.endDate ? new Date(body.endDate) : undefined, procedures: body.procedures ? { create: body.procedures.map((p: any) => ({ companyId: companyIdOf(req.user), title: p.title })) } : undefined } }); }
  @Patch('audits/:id') updateAudit(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const data: any = { ...body };
    if (body.startDate) data.startDate = new Date(body.startDate);
    if (body.endDate) data.endDate = new Date(body.endDate);
    return this.prisma.auditEngagement.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @Post('audits/:id/findings') addFinding(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.prisma.auditFinding.create({ data: { companyId: companyIdOf(req.user), engagementId: id, title: body.title, severity: body.severity || 'LOW', managementResponse: body.managementResponse, status: body.status || 'OPEN' } }); }
  @Patch('findings/:id') updateFinding(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.prisma.auditFinding.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: body }); }
  @Post('findings/:id/actions') addAction(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.prisma.auditAction.create({ data: { companyId: companyIdOf(req.user), findingId: id, description: body.description, owner: body.owner, dueDate: body.dueDate ? new Date(body.dueDate) : undefined, status: body.status || 'OPEN' } }); }

  // ----- Regulatory reports -----
  @Get('regulatory-reports') regulatoryReports(@Req() req: any) { return this.prisma.regulatoryReport.findMany({ where: { companyId: companyIdOf(req.user) } }); }
  @Post('regulatory-reports') createRegReport(@Req() req: any, @Body() body: any) { return this.prisma.regulatoryReport.create({ data: { companyId: companyIdOf(req.user), name: body.name, authority: body.authority, period: body.period, status: body.status || 'DUE' } }); }
  @Patch('regulatory-reports/:id') updateRegReport(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const data: any = { ...body };
    if (body.submittedAt) { data.submittedAt = new Date(body.submittedAt); data.status = 'SUBMITTED'; }
    return this.prisma.regulatoryReport.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }

  // ----- Exceptions -----
  @Get('exceptions') async exceptions(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const out: any[] = [];
    const today = new Date();
    const overdueReceivable = await this.prisma.salesInvoice.findMany({ where: { companyId, status: { in: ['POSTED', 'PART_PAID'] } }, include: { receipts: true } });
    const arOverdue = overdueReceivable.reduce((s, i) => s + (Number(i.total) - (i.receipts || []).reduce((x: number, r: any) => x + Number(r.amount), 0)), 0);
    if (arOverdue > 0) out.push({ type: 'Overdue Receivables', value: Number(arOverdue.toFixed(2)) });
    const apOverdue = await this.prisma.supplierInvoice.findMany({ where: { companyId, dueDate: { lt: today }, status: { in: ['UNPAID', 'PART_PAID'] } } });
    const apTotal = apOverdue.reduce((s, i) => s + Number(i.total), 0);
    if (apTotal > 0) out.push({ type: 'Overdue Supplier Invoices', value: Number(apTotal.toFixed(2)) });
    const fiscalRetry = await this.prisma.fiscalReceipt.count({ where: { invoice: { companyId }, status: { in: ['RETRY', 'REJECTED'] } } });
    if (fiscalRetry > 0) out.push({ type: 'Fiscal Retry Outstanding', value: fiscalRetry });
    const negativeStock = await this.prisma.inventoryItem.findMany({ where: { companyId }, include: { movements: true } });
    const neg = negativeStock.filter((i) => i.movements.reduce((s, m) => s + (['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN'].includes(m.type) ? Number(m.quantity) : -Number(m.quantity)), 0) < 0);
    if (neg.length) out.push({ type: 'Negative Stock', value: neg.length });
    const taxed = await this.prisma.taxRate.findMany({ where: { companyId } });
    if (!taxed.length) out.push({ type: 'Missing Tax Configuration', value: 1 });
    const openBudget = await this.prisma.budgetControlRule.count({ where: { companyId, mode: 'BLOCK', active: true } });
    if (openBudget > 0) out.push({ type: 'Budget Control Active', value: openBudget });
    return out;
  }
}