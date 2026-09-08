import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { CustomerPaymentsService } from '../sales/customer-payments.service';
import { CrmService, stageDef } from './crm.service';
import { ConvertDto, CrmTaskDto, InteractionDto, LeadDto, LostDto, OpportunityDto, PositionDto, StageMoveDto, WonDto } from './crm.dto';

@ApiTags('CRM') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('crm')
export class CrmController {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService, private crm: CrmService, private payments: CustomerPaymentsService) {}

  private uid(req: any) { return req.user?.sub; }
  private nameOf(req: any) { return req.user?.name || req.user?.email || 'System'; }
  private async lead(req: any, id: string): Promise<any> {
    const row = await this.prisma.lead.findFirst({ where: { id, companyId: companyIdOf(req.user) } });
    if (!row) throw new BadRequestException('Lead not found');
    return row;
  }
  private async opp(req: any, id: string): Promise<any> {
    const row = await this.prisma.opportunity.findFirst({ where: { id, companyId: companyIdOf(req.user) } });
    if (!row) throw new BadRequestException('Opportunity not found');
    return row;
  }
  private async positions(companyId: string, stage: string) {
    const max = await this.prisma.lead.aggregate({ where: { companyId, stage }, _max: { position: true } });
    return Number(max._max.position || 0) + 1;
  }
  // Duplicate detection + create/link customer for a lead (does NOT touch win/convert flags).
  private async resolveCustomer(req: any, lead: any, opts: { customerId?: string; forceCreate?: boolean }) {
    const companyId = companyIdOf(req.user);
    const dupWhere: any = {};
    if (lead.email) dupWhere.email = lead.email;
    if (lead.phone) dupWhere.phone = lead.phone;
    if (lead.companyName) dupWhere.OR = [{ companyName: lead.companyName }, { name: lead.companyName }];
    const dups = await this.prisma.customer.findMany({ where: { companyId, ...dupWhere } });
    if (dups.length && !opts.customerId && !opts.forceCreate) return { pending: true, duplicates: dups };
    let customer = opts.customerId ? await this.prisma.customer.findFirst({ where: { id: opts.customerId, companyId } }) : null;
    let created = false;
    if (!customer) {
      const code = await this.numbering.next(companyId, 'CUS');
      customer = await this.prisma.customer.create({ data: { companyId, code, name: lead.companyName || lead.name, companyName: lead.companyName, firstName: lead.contactName, email: lead.email, phone: lead.phone, notes: lead.notes } });
      created = true;
      await this.crm.event(companyId, { leadId: lead.id, customerId: customer.id, type: 'CUSTOMER_CREATED', message: `Customer "${customer.name}" created from lead.`, actorName: this.nameOf(req) });
    } else {
      await this.crm.event(companyId, { leadId: lead.id, customerId: customer.id, type: 'CUSTOMER_LINKED', message: `Linked to existing customer "${customer.name}".`, actorName: this.nameOf(req) });
    }
    return { customer, created };
  }

  // ----- Workflow: customer + duplicate context -----
  @Get('opportunities/:id/workflow') async oppWorkflow(@Req() req: any, @Param('id') id: string) {
    const opp = await this.opp(req, id);
    const companyId = companyIdOf(req.user);
    const quotes = await this.prisma.quotation.findMany({ where: { companyId, opportunityId: id }, orderBy: { createdAt: 'desc' } });
    const quoteIds = quotes.map((q) => q.id);
    const customerId = opp.customerId || (opp.leadId ? (await this.prisma.lead.findFirst({ where: { id: opp.leadId }, select: { convertedCustomerId: true } }))?.convertedCustomerId : undefined);
    const [orders, projects, tickets, invoices] = await Promise.all([
      this.prisma.salesOrder.findMany({ where: { companyId, quotationId: { in: quoteIds } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.project.findMany({ where: { companyId, opportunityId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.serviceTicket.findMany({ where: { companyId, opportunityId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.salesInvoice.findMany({ where: { companyId, sourceQuoteId: { in: quoteIds } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const acceptedQuote = quotes.find((q) => String(q.status).toUpperCase() === 'ACCEPTED');
    return { customerId, customer: opp.customer || null, customerReady: !!customerId, acceptedQuote, quotes, salesOrders: orders, projects, invoices, serviceTickets: tickets };
  }
  @Post('opportunities/:id/ensure-customer') async ensureCustomer(@Req() req: any, @Param('id') id: string, @Body() dto: ConvertDto) {
    const opp = await this.opp(req, id);
    const lead = opp.leadId ? await this.prisma.lead.findFirst({ where: { id: opp.leadId, companyId: companyIdOf(req.user) } }) : { id: undefined, email: opp.customer?.email, phone: opp.customer?.phone, companyName: opp.customer?.name, companyName2: opp.customer?.name };
    if (opp.customerId && !dto.customerId) {
      const c = await this.prisma.customer.findFirst({ where: { id: opp.customerId, companyId: companyIdOf(req.user) } });
      if (c) return { customer: c, created: false, customerReady: true };
    }
    const leadFor = lead && lead.id ? lead : { id: opp.leadId, email: opp.customer?.email, phone: opp.customer?.phone, companyName: opp.customer?.name, contactName: opp.customer?.firstName };
    const res = await this.resolveCustomer(req, leadFor, { customerId: dto.customerId, forceCreate: dto.forceCreate });
    if (res.pending) return { pending: true, duplicates: res.duplicates, customerReady: false };
    if (res.customer && !opp.customerId) await this.prisma.opportunity.update({ where: { id }, data: { customerId: res.customer.id } });
    return { ...res, customerReady: !!res.customer };
  }

  // ----- Quote from Lead / Opportunity (reuses Quotation module) -----
  @Post('opportunities/:id/quote') async opportunityQuote(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const op = await this.opp(req, id);
    const companyId = companyIdOf(req.user);
    if (!op.customerId) return { needsCustomer: true, message: 'This opportunity is not linked to a customer.' };
    const cust = await this.prisma.customer.findFirst({ where: { id: op.customerId, companyId } });
    const quotationNo = await this.numbering.next(companyId, 'QT');
    const q = await this.prisma.quotation.create({ data: { companyId, customerId: op.customerId, opportunityId: op.id, leadId: op.leadId, quotationNo, status: 'DRAFT', currency: op.currency || 'USD', subtotal: 0, taxTotal: 0, total: 0, address: cust?.address1 || cust?.address2 || undefined, statementMemo: cust?.name, notes: `From opportunity ${op.name}` } });
    await this.prisma.opportunity.update({ where: { id }, data: { sourceQuoteId: q.id, nextAction: 'Awaiting quote review' } });
    await this.crm.event(companyId, { opportunityId: op.id, leadId: op.leadId, customerId: op.customerId, type: 'QUOTE_CREATED', message: `Quote ${q.quotationNo} created for ${op.name}.`, actorName: this.nameOf(req), metadata: { quotationId: q.id, quotationNo } });
    await this.audit.log(companyId, this.uid(req), 'CONVERT', 'Opportunity', op.id, { quotationNo });
    return q;
  }
  @Post('leads/:id/quote') async leadQuote(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const lead = await this.lead(req, id);
    const companyId = companyIdOf(req.user);
    let customerId = body?.customerId;
    if (!customerId && lead.convertedCustomerId) customerId = lead.convertedCustomerId;
    if (!customerId) {
      const res = await this.resolveCustomer(req, lead, { customerId: body?.customerId, forceCreate: body?.forceCreate });
      if (res.pending) return { pending: true, duplicates: res.duplicates };
      if (!res.customer) return { needsCustomer: true };
      customerId = res.customer.id;
    }
    const quotationNo = await this.numbering.next(companyId, 'QT');
    const q = await this.prisma.quotation.create({ data: { companyId, customerId, leadId: lead.id, opportunityId: body?.opportunityId, quotationNo, status: 'DRAFT', currency: body?.currency || lead.currency || 'USD', address: body?.address, subtotal: 0, taxTotal: 0, total: 0, notes: `From lead ${lead.name}`, lines: { create: [] } } });
    await this.crm.event(companyId, { leadId: lead.id, customerId, type: 'QUOTE_CREATED', message: `Quote ${q.quotationNo} created for ${lead.name}.`, actorName: this.nameOf(req), metadata: { quotationId: q.id, quotationNo } });
    await this.audit.log(companyId, this.uid(req), 'CONVERT', 'Lead', lead.id, { quotationNo });
    return q;
  }

  // ----- Project from opportunity -----
  @Post('opportunities/:id/project') async createProjectFromOpp(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const op = await this.opp(req, id);
    const companyId = companyIdOf(req.user);
    const customer = body?.customerId ? await this.prisma.customer.findFirst({ where: { id: body.customerId, companyId } }) : op.customerId ? await this.prisma.customer.findFirst({ where: { id: op.customerId, companyId } }) : null;
    if (!customer) return { needsCustomer: true, message: 'Create or link a customer first.' };
    const code = await this.numbering.next(companyId, 'PRJ');
    const project = await this.prisma.project.create({ data: { companyId, projectCode: code, name: body.name || op.name, description: body.description || op.notes || '', budget: body.budget ?? Number(op.value || 0), revenueBudget: body.revenueBudget ?? undefined, currency: body.currency || op.currency || 'USD', status: body.status || 'Planned', customerId: customer.id, opportunityId: op.id, sourceQuoteId: body.sourceQuoteId || op.sourceQuoteId, sourceOrderId: body.sourceOrderId, projectManagerId: body.projectManagerId, projectManager: body.projectManager, startDate: body.startDate ? new Date(body.startDate) : new Date() } });
    await this.crm.event(companyId, { opportunityId: op.id, leadId: op.leadId, customerId: customer.id, type: 'PROJECT_CREATED', message: `Project ${project.projectCode} — ${project.name} created (Customer: ${customer.name}).`, actorName: this.nameOf(req), metadata: { projectId: project.id, projectCode: code } });
    await this.audit.log(companyId, this.uid(req), 'CREATE', 'Project', project.id, { projectCode: code, opportunityId: op.id });
    return project;
  }

  // ----- Service ticket from opportunity -----
  @Post('opportunities/:id/service-ticket') async createTicketFromOpp(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const op = await this.opp(req, id);
    const companyId = companyIdOf(req.user);
    const customerId = body?.customerId || op.customerId;
    if (!customerId) return { needsCustomer: true, message: 'Create or link a customer first.' };
    const ticket = await this.prisma.serviceTicket.create({ data: { companyId, customerId, subject: body.subject || `Service request for ${op.name}`, type: body.type || 'SERVICE', category: body.category, priority: body.priority || 'MEDIUM', status: body.status || 'OPEN', owner: body.owner, assignedTo: body.assignedTo, assignedToId: body.assignedToId, contact: body.contact, opportunityId: op.id, salesOrderId: body.salesOrderId, invoiceId: body.invoiceId, projectId: body.projectId, slaDue: body.slaDue ? new Date(body.slaDue) : undefined, description: body.description } });
    await this.crm.event(companyId, { opportunityId: op.id, leadId: op.leadId, customerId, type: 'SERVICE_TICKET_CREATED', message: `Service ticket "${ticket.subject}" created${ticket.assignedTo ? `, assigned to ${ticket.assignedTo}` : ''}.`, actorName: this.nameOf(req), metadata: { ticketId: ticket.id, priority: ticket.priority } });
    await this.audit.log(companyId, this.uid(req), 'CREATE', 'ServiceTicket', ticket.id, { opportunityId: op.id });
    return ticket;
  }

  // ----- Stages / config -----
  @Get('stages') stages(@Req() req: any) { return this.crm.stages(companyIdOf(req.user)); }

  // Active internal employee selector for the current company.
  @Get('employees') async employees(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId, active: true };
    if (q.q) where.OR = [{ firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { employeeNo: { contains: q.q, mode: 'insensitive' } }, { position: { contains: q.q, mode: 'insensitive' } }];
    const emps = await this.prisma.employee.findMany({ where, include: { department: true, company: { select: { baseCurrency: true } } }, orderBy: [{ firstName: 'asc' }] });
    return emps.map((e: any) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, firstName: e.firstName, lastName: e.lastName, email: e.email, employeeNo: e.employeeNo, position: e.position, active: e.active, branch: e.department?.name || null, currency: e.company?.baseCurrency || 'USD' }));
  }
  @Get('dashboard') async dashboard(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    const openStage = { notIn: ['WON', 'LOST'] };
    const [openLeads, openOpps, leadAgg, oppAgg, tasks] = await Promise.all([
      this.prisma.lead.count({ where: { companyId, stage: openStage, archived: false } }),
      this.prisma.opportunity.count({ where: { companyId, stage: openStage, archived: false } }),
      this.prisma.lead.aggregate({ where: { companyId, stage: openStage, archived: false }, _sum: { estimatedValue: true } }),
      this.prisma.opportunity.aggregate({ where: { companyId, stage: openStage, archived: false }, _sum: { value: true } }),
      this.prisma.crmTask.count({ where: { companyId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    ]);
    const leads = await this.prisma.lead.findMany({ where: { companyId, stage: openStage, archived: false }, select: { estimatedValue: true, probability: true } });
    const opps = await this.prisma.opportunity.findMany({ where: { companyId, stage: openStage, archived: false }, select: { value: true, probability: true } });
    const pipelineValue = Number(leadAgg._sum.estimatedValue || 0) + Number(oppAgg._sum.value || 0);
    const weighted = leads.reduce((s, l) => s + Number(l.estimatedValue) * (l.probability || 0) / 100, 0) + opps.reduce((s, o) => s + Number(o.value) * (o.probability || 0) / 100, 0);
    return { currency: company?.baseCurrency || 'USD', openLeads, openOpportunities: openOpps, pipelineValue, weightedPipeline: Number(weighted.toFixed(2)), openTasks: tasks };
  }

  // ----- Leads -----
  @Get('leads') async leads(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId };
    if (!q.includeArchived || q.includeArchived !== 'true') where.archived = false;
    if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { companyName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q, mode: 'insensitive' } }, { owner: { contains: q.q, mode: 'insensitive' } }];
    if (q.owner) where.owner = q.owner;
    if (q.source) where.source = q.source;
    if (q.stage) where.stage = q.stage;
    if (q.priority) where.priority = q.priority;
    if (q.minValue) where.estimatedValue = { ...(where.estimatedValue || {}), gte: Number(q.minValue) };
    if (q.maxValue) where.estimatedValue = { ...(where.estimatedValue || {}), lte: Number(q.maxValue) };
    if (q.expectedCloseMonth) {
      const [y, m] = q.expectedCloseMonth.split('-').map(Number);
      where.expectedCloseDate = { gte: new Date(y, m - 1, 1), lt: new Date(y, m - 1 + 1, 1) };
    }
    return this.prisma.lead.findMany({ where, orderBy: [{ stage: 'asc' }, { position: 'asc' }, { updatedAt: 'desc' }], take: Number(q.limit) || 500, include: { _count: { select: { opportunities: true, crmEvents: true } } } });
  }
  @Get('leads/:id') async leadDetail(@Req() req: any, @Param('id') id: string) {
    await this.lead(req, id);
    const companyId = companyIdOf(req.user);
    const lead: any = await this.prisma.lead.findUnique({ where: { id }, include: { opportunities: { include: { customer: true, quotations: { orderBy: { createdAt: 'desc' } } } }, interactions: { orderBy: { interactedAt: 'desc' } }, crmEvents: { orderBy: { createdAt: 'desc' } }, convertedCustomer: true, quotations: { orderBy: { createdAt: 'desc' } } } });
    const customerId = lead.convertedCustomerId;
    const tasks = await this.prisma.crmTask.findMany({ where: { companyId, OR: [{ relatedType: 'LEAD', relatedId: id }, { relatedType: 'OPPORTUNITY', relatedId: { in: lead.opportunities.map((o: any) => o.id) } }, { relatedType: 'CUSTOMER', relatedId: customerId || 'none' }] }, orderBy: { dueDate: 'asc' } });
    let related: any = { tasks };
    const customerPromises: any = {};
    if (customerId) {
      [related.invoices, related.salesOrders, related.projects, related.serviceTickets, related.receipts] = await Promise.all([
        this.prisma.salesInvoice.findMany({ where: { customerId, invoiceStatus: 'POSTED' }, orderBy: { invoiceDate: 'desc' } }),
        this.prisma.salesOrder.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }),
        this.prisma.project.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }),
        this.prisma.serviceTicket.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }),
        this.prisma.receipt.findMany({ where: { customerId, status: 'POSTED' }, orderBy: { receiptDate: 'desc' }, include: { allocations: true } }),
      ]);
      related.financial = await this.payments.summary(customerId);
    }
    return { ...lead, related };
  }
  @Post('leads') async createLead(@Req() req: any, @Body() dto: LeadDto) {
    const companyId = companyIdOf(req.user);
    const { email, phone, companyName } = dto;
    if (email || phone || companyName) {
      const dups = await this.prisma.lead.count({ where: { companyId, ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(companyName ? { OR: [{ companyName }, { name: companyName }] } : {}) } });
      if (dups > 0) throw new BadRequestException('A lead with this email, phone, or company already exists.');
    }
    const probability = dto.probability ?? stageDef(dto.stage || 'NEW').probability;
    const position = await this.positions(companyId, dto.stage || 'NEW');
    const lead = await this.prisma.lead.create({ data: { companyId, name: dto.name, companyName: dto.companyName, contactName: dto.contactName, email: dto.email, phone: dto.phone, source: dto.source, industry: dto.industry, stage: dto.stage || 'NEW', priority: dto.priority || 'NORMAL', probability, currency: dto.currency || 'USD', estimatedValue: dto.estimatedValue ?? 0, expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : undefined, owner: dto.owner, ownerId: dto.ownerId, nextFollowUp: dto.nextFollowUp ? new Date(dto.nextFollowUp) : undefined, interestedProducts: dto.interestedProducts, budget: dto.budget, authority: dto.authority, need: dto.need, timeline: dto.timeline, score: dto.score ?? 0, notes: dto.notes, position } });
    await this.crm.event(companyId, { leadId: lead.id, type: 'LEAD_CREATED', message: `Lead "${lead.name}" created.`, actorName: this.nameOf(req) });
    await this.audit.log(companyId, this.uid(req), 'CREATE', 'Lead', lead.id, { name: lead.name, stage: lead.stage });
    return lead;
  }
  @Patch('leads/:id') async updateLead(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<LeadDto>) {
    const existing = await this.lead(req, id);
    const data: any = { ...dto };
    ['expectedCloseDate', 'nextFollowUp', 'lastActivityAt'].forEach((k) => { if ((dto as any)[k]) data[k] = new Date((dto as any)[k]); });
    delete data.position; delete data.id;
    await this.prisma.lead.update({ where: { id }, data });
    const companyId = companyIdOf(req.user);
    await this.crm.event(companyId, { leadId: id, type: 'LEAD_UPDATED', message: 'Lead details updated.', actorName: this.nameOf(req) });
    if (dto.owner !== undefined && dto.owner !== existing.owner) await this.crm.event(companyId, { leadId: id, type: 'OWNER_CHANGED', message: `Owner changed: ${existing.owner || 'Unassigned'} → ${dto.owner || 'Unassigned'}.`, actorName: this.nameOf(req), metadata: { from: existing.owner, to: dto.owner } });
    if (dto.assignee !== undefined && dto.assignee !== existing.assignee) await this.crm.event(companyId, { leadId: id, type: 'ASSIGNEE_CHANGED', message: `Assignee changed: ${existing.assignee || 'Unassigned'} → ${dto.assignee || 'Unassigned'}.`, actorName: this.nameOf(req), metadata: { from: existing.assignee, to: dto.assignee } });
    await this.audit.log(companyId, this.uid(req), 'UPDATE', 'Lead', id, data);
    return this.prisma.lead.findUnique({ where: { id } });
  }
  @Post('leads/:id/stage') async moveLead(@Req() req: any, @Param('id') id: string, @Body() dto: StageMoveDto) {
    const lead = await this.lead(req, id);
    const companyId = companyIdOf(req.user);
    this.crm.validateTransition({ from: lead.stage, to: dto.stage, lostReason: dto.lostReason });
    const to = stageDef(dto.stage);
    const from = stageDef(lead.stage);
    const data: any = { stage: dto.stage, probability: to.probability };
    if (to.isLost) { data.lostReason = dto.lostReason; data.lostCompetitor = dto.lostCompetitor; }
    if (to.isWon) { data.probability = 100; }
    if (dto.dealValue != null) data.estimatedValue = dto.dealValue;
    if (dto.closeDate) data.expectedCloseDate = new Date(dto.closeDate);
    if (!to.isLost && !to.isWon) data.position = await this.positions(companyId, dto.stage);
    if (to.isWon) data.lastActivityAt = new Date();
    await this.prisma.lead.update({ where: { id }, data });
    await this.crm.event(companyId, { leadId: id, type: to.isLost ? 'LEAD_MARKED_LOST' : to.isWon ? 'OPPORTUNITY_WON' : 'STAGE_CHANGED', message: to.isLost ? `Lead moved to Lost. Reason: ${dto.lostReason}` : to.isWon ? 'Lead marked as Won.' : `Stage changed: ${from.label} → ${to.label}.`, actorName: this.nameOf(req), metadata: { from: from.code, to: to.code, lostReason: dto.lostReason } });
    await this.audit.log(companyId, this.uid(req), 'STAGE_CHANGED', 'Lead', id, { from: from.code, to: to.code });
    return this.prisma.lead.findUnique({ where: { id } });
  }
  @Post('leads/:id/won') async wonLead(@Req() req: any, @Param('id') id: string, @Body() dto: WonDto) {
    const lead = await this.lead(req, id);
    const companyId = companyIdOf(req.user);
    const data: any = { stage: 'WON', probability: 100, lastActivityAt: new Date() };
    if (dto.dealValue != null) data.estimatedValue = dto.dealValue;
    if (dto.closeDate) data.expectedCloseDate = new Date(dto.closeDate);
    if (dto.nextStep) data.notes = [lead.notes, `Next step: ${dto.nextStep}`].filter(Boolean).join('\n');
    if (dto.customerId) { const c = await this.prisma.customer.findFirst({ where: { id: dto.customerId, companyId } }); if (c && !lead.convertedCustomerId) { data.convertedCustomerId = c.id; data.convertedAt = new Date(); } }
    await this.prisma.lead.update({ where: { id }, data });
    await this.crm.event(companyId, { leadId: id, type: 'OPPORTUNITY_WON', message: `Lead "${lead.name}" marked Won (${dto.dealValue ?? lead.estimatedValue}).`, actorName: this.nameOf(req), metadata: { dealValue: dto.dealValue, closeDate: dto.closeDate } });
    await this.audit.log(companyId, this.uid(req), 'WON', 'Lead', id, { dealValue: dto.dealValue, closeDate: dto.closeDate });
    return this.prisma.lead.findUnique({ where: { id } });
  }
  @Post('leads/:id/lost') async lostLead(@Req() req: any, @Param('id') id: string, @Body() dto: LostDto) {
    await this.lead(req, id);
    const companyId = companyIdOf(req.user);
    if (!dto.lostReason) throw new BadRequestException('Lost reason is required.');
    await this.prisma.lead.update({ where: { id }, data: { stage: 'LOST', probability: 0, lostReason: dto.lostReason, lostCompetitor: dto.lostCompetitor, notes: dto.notes ?? undefined, lastActivityAt: new Date() } });
    await this.crm.event(companyId, { leadId: id, type: 'LEAD_MARKED_LOST', message: `Lead lost. Reason: ${dto.lostReason}.`, actorName: this.nameOf(req), metadata: { lostReason: dto.lostReason, lostCompetitor: dto.lostCompetitor } });
    await this.audit.log(companyId, this.uid(req), 'LOST', 'Lead', id, { lostReason: dto.lostReason, lostCompetitor: dto.lostCompetitor });
    return this.prisma.lead.findUnique({ where: { id } });
  }
  @Post('leads/:id/convert') async convertLead(@Req() req: any, @Param('id') id: string, @Body() dto: ConvertDto) {
    const lead = await this.lead(req, id);
    const companyId = companyIdOf(req.user);
    const dupWhere: any = {};
    if (lead.email) dupWhere.email = lead.email;
    if (lead.phone) dupWhere.phone = lead.phone;
    if (lead.companyName) dupWhere.OR = [{ companyName: lead.companyName }, { name: lead.companyName }];
    const dups = await this.prisma.customer.findMany({ where: { companyId, ...dupWhere } });
    if (dups.length && !dto.customerId && !dto.forceCreate) return { pending: true, duplicates: dups };
    let customer = dto.customerId ? await this.prisma.customer.findFirst({ where: { id: dto.customerId, companyId } }) : null;
    if (!customer) {
      const code = await this.numbering.next(companyId, 'CUS');
      customer = await this.prisma.customer.create({ data: { companyId, code, name: lead.companyName || lead.name, companyName: lead.companyName, firstName: lead.contactName, email: lead.email, phone: lead.phone, notes: lead.notes } });
      await this.crm.event(companyId, { leadId: id, customerId: customer.id, type: 'CUSTOMER_CREATED', message: `Customer "${customer.name}" created from lead.`, actorName: this.nameOf(req) });
    } else {
      await this.crm.event(companyId, { leadId: id, customerId: customer.id, type: 'CUSTOMER_LINKED', message: `Linked to existing customer "${customer.name}".`, actorName: this.nameOf(req) });
    }
    let opportunity: any;
    if (dto.createOpportunity) {
      const stage = dto.opportunityStage || 'OPPORTUNITY';
      opportunity = await this.prisma.opportunity.create({ data: { companyId, leadId: lead.id, customerId: customer.id, name: lead.name, stage, value: dto.opportunityValue ?? lead.estimatedValue ?? 0, probability: stageDef(stage).probability, currency: lead.currency || 'USD', owner: lead.owner, expectedClose: lead.expectedCloseDate } });
      await this.crm.event(companyId, { leadId: id, opportunityId: opportunity.id, customerId: customer.id, type: 'OPPORTUNITY_CREATED', message: `Opportunity "${opportunity.name}" created.`, actorName: this.nameOf(req) });
    }
    await this.prisma.lead.update({ where: { id }, data: { convertedCustomerId: customer.id, convertedAt: new Date(), stage: 'WON', probability: 100 } });
    await this.audit.log(companyId, this.uid(req), 'CONVERT', 'Lead', id, { customerId: customer.id });
    return { customer, opportunity, converted: true };
  }
  @Post('leads/:id/position') async moveLeadPosition(@Req() req: any, @Param('id') id: string, @Body() dto: PositionDto) {
    await this.lead(req, id);
    const companyId = companyIdOf(req.user);
    const siblings = await this.prisma.lead.findMany({ where: { companyId, stage: dto.stage }, orderBy: { position: 'asc' }, select: { id: true, position: true } });
    const before = dto.beforeId ? siblings.find((s) => s.id === dto.beforeId) : null;
    const after = dto.afterId ? siblings.find((s) => s.id === dto.afterId) : null;
    let pos: number;
    if (after && before) pos = (after.position + before.position) / 2;
    else if (after) pos = after.position + 1;
    else if (before) pos = before.position - 1;
    else pos = siblings.length ? Math.max(...siblings.map((s) => s.position)) + 1 : 1;
    await this.prisma.lead.update({ where: { id }, data: { stage: dto.stage, position: pos } });
    return this.prisma.lead.findUnique({ where: { id } });
  }
  @Post('leads/:id/interactions') async logInteraction(@Req() req: any, @Param('id') id: string, @Body() dto: InteractionDto) {
    await this.lead(req, id);
    const companyId = companyIdOf(req.user);
    const i = await this.prisma.customerInteraction.create({ data: { companyId, leadId: id, customerId: dto.customerId, type: dto.type || 'CALL', subject: dto.subject || dto.type + ' logged', summary: dto.summary, outcome: dto.outcome, nextAction: dto.nextAction, contact: dto.contact, createdBy: this.nameOf(req), interactedAt: dto.interactedAt ? new Date(dto.interactedAt) : new Date() } });
    await this.prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });
    await this.crm.event(companyId, { leadId: id, customerId: dto.customerId, type: dto.type === 'EMAIL' ? 'EMAIL_LOGGED' : dto.type === 'MEETING' ? 'MEETING_LOGGED' : dto.type === 'TASK' ? 'TASK_CREATED' : dto.type === 'NOTE' ? 'NOTE_ADDED' : 'CALL_LOGGED', message: `${dto.type}: ${dto.subject || ''}${dto.summary ? ' — ' + dto.summary : ''}`, actorName: this.nameOf(req), metadata: { outcome: dto.outcome, nextAction: dto.nextAction } });
    await this.audit.log(companyId, this.uid(req), 'ACTIVITY', 'CustomerInteraction', i.id, { type: i.type });
    return i;
  }
  @Delete('leads/:id') async deleteLead(@Req() req: any, @Param('id') id: string) {
    await this.lead(req, id);
    const companyId = companyIdOf(req.user);
    const lead: any = await this.prisma.lead.findUnique({ where: { id }, include: { _count: { select: { opportunities: true, quotations: true } } } });
    if (lead._count.opportunities > 0 || lead._count.quotations > 0) throw new BadRequestException('This lead is connected to downstream records and cannot be deleted. Archive it instead.');
    await this.prisma.lead.delete({ where: { id } });
    await this.audit.log(companyId, this.uid(req), 'DELETE', 'Lead', id);
    return { ok: true };
  }

  // ----- Opportunities -----
  @Get('opportunities') async opportunities(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId };
    if (q.stage) where.stage = q.stage;
    if (q.customerId) where.customerId = q.customerId;
    if (q.leadId) where.leadId = q.leadId;
    return this.prisma.opportunity.findMany({ where, include: { lead: true, customer: true, quotations: { orderBy: { createdAt: 'desc' } } }, orderBy: [{ stage: 'asc' }, { position: 'asc' }, { updatedAt: 'desc' }] });
  }
  @Get('opportunities/:id') async oppDetail(@Req() req: any, @Param('id') id: string) {
    await this.opp(req, id);
    const companyId = companyIdOf(req.user);
    const opp = await this.prisma.opportunity.findUnique({ where: { id }, include: { lead: true, customer: true, quotations: true, crmEvents: { orderBy: { createdAt: 'desc' } } } });
    const tasks = await this.prisma.crmTask.findMany({ where: { companyId, relatedType: 'OPPORTUNITY', relatedId: id }, orderBy: { dueDate: 'asc' } });
    return { ...opp, tasks };
  }
  @Post('opportunities') async createOpportunity(@Req() req: any, @Body() dto: OpportunityDto) {
    const companyId = companyIdOf(req.user);
    const stage = dto.stage || 'OPPORTUNITY';
    const pos = await this.prisma.opportunity.aggregate({ where: { companyId, stage }, _max: { position: true } });
    const op = await this.prisma.opportunity.create({ data: { companyId, leadId: dto.leadId, customerId: dto.customerId, name: dto.name, stage, value: dto.value ?? 0, probability: dto.probability ?? stageDef(stage).probability, currency: dto.currency || 'USD', priority: dto.priority || 'NORMAL', expectedClose: dto.expectedClose ? new Date(dto.expectedClose) : undefined, owner: dto.owner, nextAction: dto.nextAction, sourceQuoteId: dto.sourceQuoteId, notes: dto.notes, position: Number(pos._max.position || 0) + 1 } });
    await this.crm.event(companyId, { opportunityId: op.id, leadId: dto.leadId, customerId: dto.customerId, type: 'OPPORTUNITY_CREATED', message: `Opportunity "${op.name}" created.`, actorName: this.nameOf(req) });
    await this.audit.log(companyId, this.uid(req), 'CREATE', 'Opportunity', op.id);
    return op;
  }
  @Patch('opportunities/:id') async updateOpportunity(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<OpportunityDto>) {
    const existing = await this.opp(req, id);
    const data: any = { ...dto };
    if (dto.expectedClose) data.expectedClose = new Date(dto.expectedClose);
    delete data.position; delete data.id;
    await this.prisma.opportunity.update({ where: { id }, data });
    const companyId = companyIdOf(req.user);
    if (dto.owner !== undefined && dto.owner !== existing.owner) await this.crm.event(companyId, { opportunityId: id, leadId: existing.leadId, customerId: existing.customerId, type: 'OWNER_CHANGED', message: `Owner changed: ${existing.owner || 'Unassigned'} → ${dto.owner || 'Unassigned'}.`, actorName: this.nameOf(req), metadata: { from: existing.owner, to: dto.owner } });
    if (dto.assignee !== undefined && dto.assignee !== existing.assignee) await this.crm.event(companyId, { opportunityId: id, leadId: existing.leadId, customerId: existing.customerId, type: 'ASSIGNEE_CHANGED', message: `Assignee changed: ${existing.assignee || 'Unassigned'} → ${dto.assignee || 'Unassigned'}.`, actorName: this.nameOf(req), metadata: { from: existing.assignee, to: dto.assignee } });
    await this.audit.log(companyId, this.uid(req), 'UPDATE', 'Opportunity', id, data);
    return this.prisma.opportunity.findUnique({ where: { id } });
  }
  @Post('opportunities/:id/stage') async moveOpportunity(@Req() req: any, @Param('id') id: string, @Body() dto: StageMoveDto) {
    const op = await this.opp(req, id);
    const companyId = companyIdOf(req.user);
    this.crm.validateTransition({ from: op.stage, to: dto.stage, lostReason: dto.lostReason });
    const to = stageDef(dto.stage);
    const data: any = { stage: dto.stage, probability: to.probability };
    if (to.isWon) { data.probability = 100; data.actualCloseAt = new Date(); data.wonValue = dto.dealValue ?? op.value; }
    if (to.isLost) { data.lostReason = dto.lostReason; data.lostCompetitor = dto.lostCompetitor; data.probability = 0; }
    if (dto.closeDate) data.expectedClose = new Date(dto.closeDate);
    await this.prisma.opportunity.update({ where: { id }, data });
    await this.crm.event(companyId, { opportunityId: id, leadId: op.leadId, customerId: op.customerId, type: to.isLost ? 'OPPORTUNITY_LOST' : to.isWon ? 'OPPORTUNITY_WON' : 'STAGE_CHANGED', message: to.isLost ? `Opportunity lost. Reason: ${dto.lostReason}` : to.isWon ? `Opportunity "${op.name}" won.` : `Stage changed to ${to.label}.`, actorName: this.nameOf(req), metadata: { from: op.stage, to: to.code } });
    await this.audit.log(companyId, this.uid(req), 'STAGE_CHANGED', 'Opportunity', id, { from: op.stage, to: to.code });
    return this.prisma.opportunity.findUnique({ where: { id } });
  }
  @Post('opportunities/:id/won') async wonOpportunity(@Req() req: any, @Param('id') id: string, @Body() dto: WonDto) {
    const op = await this.opp(req, id);
    const companyId = companyIdOf(req.user);
    await this.prisma.opportunity.update({ where: { id }, data: { stage: 'WON', probability: 100, actualCloseAt: dto.closeDate ? new Date(dto.closeDate) : new Date(), wonValue: dto.dealValue ?? op.value, nextAction: dto.nextStep, customerId: dto.customerId ?? op.customerId } });
    await this.crm.event(companyId, { opportunityId: id, leadId: op.leadId, customerId: dto.customerId ?? op.customerId, type: 'OPPORTUNITY_WON', message: `Opportunity "${op.name}" won (${dto.dealValue ?? op.value}).`, actorName: this.nameOf(req), metadata: { wonValue: dto.dealValue } });
    await this.audit.log(companyId, this.uid(req), 'WON', 'Opportunity', id, { wonValue: dto.dealValue });
    return this.prisma.opportunity.findUnique({ where: { id } });
  }
  @Post('opportunities/:id/lost') async lostOpportunity(@Req() req: any, @Param('id') id: string, @Body() dto: LostDto) {
    await this.opp(req, id);
    const companyId = companyIdOf(req.user);
    if (!dto.lostReason) throw new BadRequestException('Lost reason is required.');
    await this.prisma.opportunity.update({ where: { id }, data: { stage: 'LOST', probability: 0, lostReason: dto.lostReason, lostCompetitor: dto.lostCompetitor, notes: dto.notes ?? undefined } });
    await this.crm.event(companyId, { opportunityId: id, type: 'OPPORTUNITY_LOST', message: `Opportunity lost. Reason: ${dto.lostReason}.`, actorName: this.nameOf(req), metadata: { lostReason: dto.lostReason } });
    await this.audit.log(companyId, this.uid(req), 'LOST', 'Opportunity', id, { lostReason: dto.lostReason });
    return this.prisma.opportunity.findUnique({ where: { id } });
  }
  @Delete('opportunities/:id') async deleteOpportunity(@Req() req: any, @Param('id') id: string) {
    await this.opp(req, id);
    await this.prisma.opportunity.delete({ where: { id } });
    await this.audit.log(companyIdOf(req.user), this.uid(req), 'DELETE', 'Opportunity', id);
    return { ok: true };
  }

  // ----- Tasks -----
  @Get('tasks') tasks(@Req() req: any, @Query() q: any) {
    const where: any = { companyId: companyIdOf(req.user) };
    if (q.relatedType && q.relatedId) { where.relatedType = q.relatedType; where.relatedId = q.relatedId; }
    if (q.status) where.status = q.status;
    return this.prisma.crmTask.findMany({ where, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }] });
  }
  @Post('tasks') async createTask(@Req() req: any, @Body() dto: CrmTaskDto) {
    const companyId = companyIdOf(req.user);
    const task = await this.prisma.crmTask.create({ data: { companyId, title: dto.title || dto.description || 'Untitled task', description: dto.description, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, status: dto.status || 'TODO', priority: dto.priority || 'NORMAL', relatedType: dto.relatedType, relatedId: dto.relatedId, assignee: dto.assignee, notes: dto.notes } });
    await this.crm.event(companyId, { leadId: dto.relatedType === 'LEAD' ? dto.relatedId : undefined, opportunityId: dto.relatedType === 'OPPORTUNITY' ? dto.relatedId : undefined, type: 'TASK_CREATED', message: `Task "${task.title}" created.`, actorName: this.nameOf(req) });
    await this.audit.log(companyId, this.uid(req), 'CREATE', 'CrmTask', task.id);
    return task;
  }
  @Patch('tasks/:id') updateTask(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<CrmTaskDto>) {
    const data: any = { ...dto };
    if (dto.dueDate) data.dueDate = new Date(dto.dueDate);
    return this.prisma.crmTask.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @Patch('tasks/:id/status') updateTaskStatus(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.prisma.crmTask.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { status: dto.status } });
  }
  @Delete('tasks/:id') async deleteTask(@Req() req: any, @Param('id') id: string) {
    await this.prisma.crmTask.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Interactions -----
  @Get('interactions') interactions(@Req() req: any, @Query() q: any) {
    const where: any = { companyId: companyIdOf(req.user) };
    if (q.leadId) where.leadId = q.leadId;
    if (q.customerId) where.customerId = q.customerId;
    if (q.type) where.type = q.type;
    return this.prisma.customerInteraction.findMany({ where, include: { customer: true, lead: true }, orderBy: { interactedAt: 'desc' } });
  }
  @Post('interactions') async createInteraction(@Req() req: any, @Body() dto: InteractionDto) {
    const companyId = companyIdOf(req.user);
    const interaction = await this.prisma.customerInteraction.create({ data: { companyId, customerId: dto.customerId, leadId: dto.leadId, type: dto.type || 'CALL', subject: dto.subject || 'Activity', summary: dto.summary, outcome: dto.outcome, nextAction: dto.nextAction, contact: dto.contact, createdBy: this.nameOf(req), interactedAt: dto.interactedAt ? new Date(dto.interactedAt) : new Date() } });
    await this.crm.event(companyId, { leadId: dto.leadId, customerId: dto.customerId, type: dto.type === 'EMAIL' ? 'EMAIL_LOGGED' : dto.type === 'MEETING' ? 'MEETING_LOGGED' : dto.type === 'NOTE' ? 'NOTE_ADDED' : 'CALL_LOGGED', message: `${dto.type}: ${interaction.subject}`, actorName: this.nameOf(req) });
    await this.audit.log(companyId, this.uid(req), 'CREATE', 'CustomerInteraction', interaction.id);
    return interaction;
  }
  @Delete('interactions/:id') async deleteInteraction(@Req() req: any, @Param('id') id: string) {
    await this.prisma.customerInteraction.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Service / support tickets -----
  @Get('tickets') tickets(@Req() req: any) {
    return this.prisma.serviceTicket.findMany({ where: { companyId: companyIdOf(req.user) }, include: { customer: true, comments: true }, orderBy: { createdAt: 'desc' } });
  }
  @Post('tickets') async createTicket(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const ticket = await this.prisma.serviceTicket.create({ data: { companyId, customerId: body.customerId, subject: body.subject, type: body.type || 'SERVICE', category: body.category, priority: body.priority || 'MEDIUM', owner: body.owner, slaDue: body.slaDue ? new Date(body.slaDue) : undefined } });
    await this.crm.event(companyId, { customerId: body.customerId, type: 'TICKET_CREATED', message: `Ticket "${ticket.subject}" created.`, actorName: this.nameOf(req) });
    await this.audit.log(companyId, this.uid(req), 'CREATE', 'ServiceTicket', ticket.id);
    return ticket;
  }
  @Patch('tickets/:id') updateTicket(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const data: any = { ...body };
    if (body.slaDue) data.slaDue = new Date(body.slaDue);
    return this.prisma.serviceTicket.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @Post('tickets/:id/comments') addTicketComment(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.prisma.ticketComment.create({ data: { ticketId: id, author: body.author || req.user.email, body: body.body } });
  }

  @Get('crm-report') async crmReport(@Req() req: any) { return this.dashboard(req); }
}
