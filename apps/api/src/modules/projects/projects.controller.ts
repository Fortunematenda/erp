import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { NumberingService } from '../../core/common/numbering.service';
import { CreateProjectDto } from './projects.dto';

@ApiTags('Projects') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('projects')
export class ProjectsController {
  constructor(private prisma: PrismaService, private numbering: NumberingService) {}

  @Get() list(@Req() req: any) {
    return this.prisma.project.findMany({ where: { companyId: companyIdOf(req.user) }, include: { customer: true }, orderBy: { createdAt: 'desc' } });
  }

  // ----- Reporting (declared before :id so they are not shadowed) -----
  @Get('profitability') async profitability(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const { from, to, projectId } = q;
    const dateFilter: any = {};
    if (from) dateFilter.invoiceDate = { gte: new Date(from) };
    if (to) dateFilter.invoiceDate = { ...(dateFilter.invoiceDate || {}), lte: new Date(to) };
    const projects = await this.prisma.project.findMany({ where: { companyId, ...(projectId ? { id: projectId } : {}) } });
    const invoices = await this.prisma.salesInvoice.findMany({ where: { companyId, projectId: { not: null }, status: { in: ['POSTED', 'PART_PAID', 'PAID'] }, ...dateFilter }, include: { creditNotes: true } });
    const bills = await this.prisma.supplierInvoice.findMany({ where: { companyId, projectId: { not: null }, ...dateFilter } });
    const timesheets = await this.prisma.timesheet.findMany({ where: { companyId } });
    const movements = await this.prisma.stockMovement.findMany({ where: { warehouse: { companyId }, projectId: { not: null }, type: 'ISSUE' }, include: { item: { include: { movements: true } } } });
    const revenueBy: Record<string, number> = {};
    for (const i of invoices) { if (!i.projectId) continue; const cn = (i.creditNotes || []).filter((c: any) => c.status === 'POSTED').reduce((s: number, c: any) => s + Number(c.total), 0); revenueBy[i.projectId] = (revenueBy[i.projectId] || 0) + Number(i.total) - cn; }
    const billBy: Record<string, number> = {};
    for (const b of bills) if (b.projectId) billBy[b.projectId] = (billBy[b.projectId] || 0) + Number(b.total);
    const labourBy: Record<string, number> = {};
    for (const t of timesheets) if (t.projectId) labourBy[t.projectId] = (labourBy[t.projectId] || 0) + Number(t.hours) * Number(t.costRate);
    const materialBy: Record<string, number> = {};
    for (const m of movements) {
      if (!m.projectId) continue;
      const receipts = (m.item?.movements || []).filter((x: any) => x.type === 'RECEIPT' && x.itemId === m.itemId);
      const qty = receipts.reduce((s, x) => s + Number(x.quantity), 0);
      const avg = qty ? receipts.reduce((s, x) => s + Number(x.unitCost) * Number(x.quantity), 0) / qty : 0;
      materialBy[m.projectId] = (materialBy[m.projectId] || 0) + Number(m.quantity) * avg;
    }
    const rows = projects.map((p) => {
      const revenue = Number((revenueBy[p.id] || 0).toFixed(2));
      const materialCost = Number((materialBy[p.id] || 0).toFixed(2));
      const labour = Number((labourBy[p.id] || 0).toFixed(2));
      const otherCost = Number((billBy[p.id] || 0).toFixed(2));
      const totalCost = Number((materialCost + labour + otherCost).toFixed(2));
      const profit = Number((revenue - totalCost).toFixed(2));
      const margin = revenue ? (profit / revenue) * 100 : 0;
      return { id: p.id, name: p.name, startDate: p.startDate, status: p.status, revenue, materialCost, labour, otherCost, cost: totalCost, profit, margin: Number(margin.toFixed(2)), budget: Number(p.budget), variance: Number((Number(p.budget) - totalCost).toFixed(2)) };
    });
    const totalRevenue = Number(rows.reduce((s, r) => s + r.revenue, 0).toFixed(2));
    const totalCosts = Number(rows.reduce((s, r) => s + r.cost, 0).toFixed(2));
    const totalProfit = Number((totalRevenue - totalCosts).toFixed(2));
    const avgMargin = totalRevenue ? (totalProfit / totalRevenue) * 100 : 0;
    return { rows, summary: { totalRevenue, totalCosts, totalProfit, avgMargin: Number(avgMargin.toFixed(2)) } };
  }

  @Get('timesheets') timesheets(@Req() req: any) { return this.prisma.timesheet.findMany({ where: { companyId: companyIdOf(req.user) }, include: { employee: true, project: true }, orderBy: { date: 'desc' } }); }

  @Post() async create(@Req() req: any, @Body() dto: CreateProjectDto) {
    const companyId = companyIdOf(req.user);
    const projectCode = dto.projectCode || await this.numbering.next(companyId, 'PRJ');
    return this.prisma.project.create({ data: { companyId, projectCode, name: dto.name, description: dto.description, budget: dto.budget ?? 0, currency: dto.currency || 'USD', status: dto.status || 'Active', customerId: dto.customerId, startDate: dto.startDate ? new Date(dto.startDate) : new Date() }, include: { customer: true } });
  }

  @Get(':id') async detail(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const p = await this.prisma.project.findFirst({ where: { id, companyId }, include: { customer: true, invoices: { include: { customer: true, receipts: true }, orderBy: { invoiceDate: 'desc' } }, quotations: { include: { customer: true }, orderBy: { quotationDate: 'desc' } }, salesOrders: true, tasks: { orderBy: { createdAt: 'asc' } }, notes: { orderBy: { createdAt: 'desc' } }, attachments: { orderBy: { createdAt: 'desc' } }, supplierInvoices: true, timesheets: { include: { employee: true }, orderBy: { date: 'desc' } } } });
    if (!p) throw new Error('Project not found');
    return p;
  }

  @Patch(':id') async update(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<CreateProjectDto>) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.project.findFirst({ where: { id, companyId } });
    if (!existing) throw new Error('Project not found');
    return this.prisma.project.update({ where: { id }, data: { name: dto.name ?? existing.name, description: dto.description ?? existing.description, projectCode: dto.projectCode ?? existing.projectCode, budget: dto.budget ?? Number(existing.budget), currency: dto.currency ?? existing.currency, status: dto.status ?? existing.status, customerId: dto.customerId ?? existing.customerId, startDate: dto.startDate ? new Date(dto.startDate) : existing.startDate } });
  }

  @Delete(':id') async remove(@Req() req: any, @Param('id') id: string) {
    await this.prisma.project.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Tasks -----
  @Post(':id/tasks') async addTask(@Req() req: any, @Param('id') id: string, @Body() b: any) {
    const companyId = companyIdOf(req.user);
    await this.prisma.project.findFirstOrThrow({ where: { id, companyId } });
    return this.prisma.projectTask.create({ data: { projectId: id, title: b.title, description: b.description, status: b.status || 'Todo', progress: b.progress ?? 0, dueDate: b.dueDate ? new Date(b.dueDate) : undefined } });
  }
  @Patch(':id/tasks/:taskId') async updateTask(@Req() req: any, @Param('id') id: string, @Param('taskId') taskId: string, @Body() b: any) {
    const companyId = companyIdOf(req.user);
    await this.prisma.project.findFirstOrThrow({ where: { id, companyId } });
    return this.prisma.projectTask.update({ where: { id: taskId }, data: { title: b.title, description: b.description, status: b.status, progress: b.progress != null ? Number(b.progress) : undefined, dueDate: b.dueDate ? new Date(b.dueDate) : undefined } });
  }
  @Delete(':id/tasks/:taskId') async removeTask(@Req() req: any, @Param('id') id: string, @Param('taskId') taskId: string) {
    const companyId = companyIdOf(req.user);
    await this.prisma.project.findFirstOrThrow({ where: { id, companyId } });
    await this.prisma.projectTask.deleteMany({ where: { id: taskId, projectId: id } });
    return { ok: true };
  }

  // ----- Notes -----
  @Post(':id/notes') async addNote(@Req() req: any, @Param('id') id: string, @Body() b: any) {
    const companyId = companyIdOf(req.user);
    await this.prisma.project.findFirstOrThrow({ where: { id, companyId } });
    return this.prisma.projectNote.create({ data: { projectId: id, body: b.body } });
  }
  @Delete(':id/notes/:noteId') async removeNote(@Req() req: any, @Param('id') id: string, @Param('noteId') noteId: string) {
    await this.prisma.projectNote.deleteMany({ where: { id: noteId, projectId: id } });
    return { ok: true };
  }

  // ----- Attachments (pictures) -----
  @Post(':id/attachments') async addAttachment(@Req() req: any, @Param('id') id: string, @Body() b: any) {
    const companyId = companyIdOf(req.user);
    await this.prisma.project.findFirstOrThrow({ where: { id, companyId } });
    return this.prisma.projectAttachment.create({ data: { projectId: id, name: b.name || 'picture', mime: b.mime || 'image/*', size: b.size || 0, dataUrl: b.dataUrl } });
  }
  @Delete(':id/attachments/:attId') async removeAttachment(@Req() req: any, @Param('id') id: string, @Param('attId') attId: string) {
    await this.prisma.projectAttachment.deleteMany({ where: { id: attId, projectId: id } });
    return { ok: true };
  }

  // ----- Quote / Invoice the project -----
  @Post(':id/quote') async quote(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const p = await this.prisma.project.findFirst({ where: { id, companyId } });
    if (!p) throw new Error('Project not found');
    const quotationNo = await this.numbering.next(companyId, 'QT');
    return this.prisma.quotation.create({ data: { companyId, customerId: p.customerId, projectId: p.id, quotationNo, status: 'DRAFT', subtotal: 0, taxTotal: 0, total: 0 } });
  }
  @Post(':id/invoice') async invoice(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const p = await this.prisma.project.findFirst({ where: { id, companyId } });
    if (!p) throw new Error('Project not found');
    const branch = await this.prisma.branch.findFirst({ where: { companyId } });
    if (!branch) throw new Error('Create a branch first');
    const invoiceNo = await this.numbering.next(companyId, 'INV');
    return this.prisma.salesInvoice.create({ data: { companyId, branchId: branch.id, customerId: p.customerId, projectId: p.id, invoiceNo, status: 'DRAFT', subtotal: 0, taxTotal: 0, total: 0, fiscalRequired: true, fiscalStatus: 'READY' } });
  }

  @Post(':id/timesheets') async addTimesheet(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    await this.prisma.project.findFirstOrThrow({ where: { id, companyId } });
    return this.prisma.timesheet.create({ data: { companyId, projectId: id, employeeId: body.employeeId, date: body.date ? new Date(body.date) : new Date(), hours: Number(body.hours || 0), costRate: Number(body.costRate || 0), billable: body.billable ?? true, description: body.description } });
  }
}
