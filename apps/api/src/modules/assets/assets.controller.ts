import { Body, BadRequestException, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { AssetDto, MaintenanceDto } from './assets.dto';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { PostingService } from '../finance/posting.service';
import { StatusDto } from '../sales/sales.dto';

@ApiTags('Assets') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('assets')
export class AssetsController {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService, private posting: PostingService) {}

  private async ensureLedgerAccounts(companyId: string) {
    const defs = [
      { code: '1500', name: 'Fixed Assets', type: 'ASSET' },
      { code: '1509', name: 'Accumulated Depreciation', type: 'ASSET' },
      { code: '6500', name: 'Depreciation Expense', type: 'EXPENSE' },
      { code: '6501', name: 'Asset Disposal Gain/Loss', type: 'EXPENSE' },
    ];
    const out: Record<string, any> = {};
    for (const d of defs) {
      const existing = await this.prisma.ledgerAccount.findFirst({ where: { companyId, code: d.code } });
      out[d.code] = existing || await this.prisma.ledgerAccount.create({ data: { companyId, code: d.code, name: d.name, type: d.type as any } });
    }
    return out;
  }

  @Get() async assets(@Req() req: any) {
    const list = await this.prisma.asset.findMany({ where: { companyId: companyIdOf(req.user) }, include: { assetCategory: true }, orderBy: { name: 'asc' } });
    // Single authoritative Net Book Value (cost − accumulated depreciation) so the
    // register rows, dashboard and reports always reconcile.
    return list.map((a: any) => ({ ...a, bookValue: Number((Number(a.cost) - Number(a.accumulatedDepreciation || 0)).toFixed(2)) }));
  }
  @Post() async createAsset(@Req() req: any, @Body() dto: AssetDto) {
    const companyId = companyIdOf(req.user);
    const assetNo = dto.assetNo || await this.numbering.next(companyId, 'AST');
    const asset = await this.prisma.asset.create({ data: { companyId, assetNo, name: dto.name, category: dto.category, location: dto.location, purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined, cost: Number(dto.cost), salvageValue: dto.salvageValue ?? 0, usefulLife: dto.usefulLife ?? 60 } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Asset', asset.id, { assetNo });
    return asset;
  }
  @Patch(':id') updateAsset(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<AssetDto>) {
    const data: any = { ...dto };
    if (dto.purchaseDate) data.purchaseDate = new Date(dto.purchaseDate);
    return this.prisma.asset.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data });
  }
  @Post(':id/depreciate') async depreciate(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const asset = await this.prisma.asset.findFirst({ where: { id, companyId }, include: { assetCategory: true } });
    if (!asset) throw new Error('Asset not found');
    const monthly = (Number(asset.cost) - Number(asset.salvageValue)) / Math.max(1, asset.usefulLife);
    const nextDepreciation = Number(asset.accumulatedDepreciation) + monthly;
    const amount = Math.min(nextDepreciation, Number(asset.cost) - Number(asset.salvageValue));
    const updated = await this.prisma.asset.update({ where: { id: asset.id }, data: { accumulatedDepreciation: Number(amount.toFixed(2)) } });
    const accounts = await this.ensureLedgerAccounts(companyId);
    const depExp = await this.prisma.ledgerAccount.findFirst({ where: { companyId, code: asset.assetCategory?.depreciationExpenseAccount || '6500' } });
    const accDep = await this.prisma.ledgerAccount.findFirst({ where: { companyId, code: asset.assetCategory?.accumulatedDepreciationAccount || '1509' } });
    if (amount > 0 && depExp && accDep) {
      await this.posting.postJournal(companyId, { date: new Date(), description: `Depreciation ${asset.assetNo}`, reference: asset.assetNo, sourceType: 'DEPRECIATION', sourceId: asset.id, lines: [
        { code: depExp.code, debit: Number(amount.toFixed(2)), credit: 0, description: 'Depreciation expense' },
        { code: accDep.code, debit: 0, credit: Number(amount.toFixed(2)), description: 'Accumulated depreciation' },
      ] });
    }
    await this.audit.log(companyId, req.user.sub, 'DEPRECIATE', 'Asset', asset.id, { amount: Number(amount.toFixed(2)) });
    return updated;
  }
  private async assertPostingDate(companyId: string, date: Date) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { companyId, startDate: { lte: date }, endDate: { gte: date } } });
    if (period && (period.status === 'CLOSED' || period.status === 'LOCKED')) throw new BadRequestException(`Depreciation cannot be posted to a closed period (${period.name}).`);
    if (period && period.status === 'FUTURE') throw new BadRequestException(`Depreciation cannot be posted to a future period (${period.name}).`);
  }

  @Post('depreciation-run') async runDepreciation(@Req() req: any, @Body() body: { period?: string }) {
    const companyId = companyIdOf(req.user);
    const period = body.period || new Date().toISOString().slice(0, 7);
    const existing = await this.prisma.depreciationRun.findFirst({ where: { companyId, period } });
    if (existing) throw new BadRequestException('Depreciation already run for this period');
    await this.assertPostingDate(companyId, new Date(`${period}-01`));
    const assets = await this.prisma.asset.findMany({ where: { companyId, status: 'ACTIVE' }, include: { assetCategory: true } });
    const accounts = await this.ensureLedgerAccounts(companyId);
    const run = await this.prisma.depreciationRun.create({ data: { companyId, period } });
    let total = 0;
    for (const a of assets) {
      const monthly = (Number(a.cost) - Number(a.salvageValue)) / Math.max(1, a.usefulLife);
      const base = Number(a.accumulatedDepreciation);
      const amount = Math.min(base + monthly, Number(a.cost) - Number(a.salvageValue)) - base;
      if (amount <= 0) continue;
      await this.prisma.depreciationLine.create({ data: { runId: run.id, assetId: a.id, period, amount: Number(amount.toFixed(2)) } });
      await this.prisma.asset.update({ where: { id: a.id }, data: { accumulatedDepreciation: Number((base + amount).toFixed(2)) } });
      const depExp = await this.prisma.ledgerAccount.findFirst({ where: { companyId, code: a.assetCategory?.depreciationExpenseAccount || '6500' } });
      const accDep = await this.prisma.ledgerAccount.findFirst({ where: { companyId, code: a.assetCategory?.accumulatedDepreciationAccount || '1509' } });
      if (depExp && accDep) await this.posting.postJournal(companyId, { date: new Date(), description: `Depreciation ${a.assetNo} (${period})`, reference: `${a.assetNo}-${period}`, sourceType: 'DEPRECIATION', sourceId: run.id, lines: [
        { code: depExp.code, debit: Number(amount.toFixed(2)), credit: 0, description: 'Depreciation expense' },
        { code: accDep.code, debit: 0, credit: Number(amount.toFixed(2)), description: 'Accumulated depreciation' },
      ] });
      total += amount;
    }
    await this.audit.log(companyId, req.user.sub, 'RUN', 'DepreciationRun', run.id, { period, total: Number(total.toFixed(2)) });
    return { run, assets: assets.length, total: Number(total.toFixed(2)) };
  }
  @Post(':id/dispose') async dispose(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const asset = await this.prisma.asset.findFirst({ where: { id, companyId }, include: { assetCategory: true } });
    if (!asset) throw new Error('Asset not found');
    const proceeds = Number(body.proceeds || 0);
    const bookValue = Number(asset.cost) - Number(asset.accumulatedDepreciation);
    const gainLoss = proceeds - bookValue;
    await this.assertPostingDate(companyId, body.disposalDate ? new Date(body.disposalDate) : new Date());
    const accounts = await this.ensureLedgerAccounts(companyId);
    const assetAcc = await this.prisma.ledgerAccount.findFirst({ where: { companyId, code: asset.assetCategory?.assetAccount || '1500' } });
    const accDep = await this.prisma.ledgerAccount.findFirst({ where: { companyId, code: asset.assetCategory?.accumulatedDepreciationAccount || '1509' } });
    const glAcc = await this.prisma.ledgerAccount.findFirst({ where: { companyId, code: asset.assetCategory?.disposalGainLossAccount || '6501' } });
    if (assetAcc) {
      const lines: any[] = [];
      if (proceeds > 0) lines.push({ code: '1000', debit: proceeds, credit: 0, description: 'Cash / bank' });
      if (Number(asset.accumulatedDepreciation) > 0 && accDep) lines.push({ code: accDep.code, debit: Number(asset.accumulatedDepreciation), credit: 0, description: 'Accumulated depreciation' });
      lines.push({ code: assetAcc.code, debit: 0, credit: Number(asset.cost), description: 'Fixed asset' });
      if (Math.abs(gainLoss) > 0.001 && glAcc) lines.push({ code: glAcc.code, debit: gainLoss > 0 ? 0 : Math.abs(gainLoss), credit: gainLoss > 0 ? gainLoss : 0, description: 'Disposal gain/loss' });
      await this.posting.postJournal(companyId, { date: body.disposalDate ? new Date(body.disposalDate) : new Date(), description: `Dispose ${asset.assetNo}`, reference: asset.assetNo, sourceType: 'ASSET_DISPOSAL', sourceId: asset.id, lines });
    }
    const updated = await this.prisma.asset.update({ where: { id: asset.id }, data: { status: 'DISPOSED', disposalDate: body.disposalDate ? new Date(body.disposalDate) : new Date(), disposalProceeds: proceeds, disposalBuyer: body.buyer, disposalReason: body.reason } });
    await this.audit.log(companyId, req.user.sub, 'DISPOSE', 'Asset', asset.id, { proceeds, gainLoss: Number(gainLoss.toFixed(2)) });
    return updated;
  }
  @Delete(':id') async deleteAsset(@Req() req: any, @Param('id') id: string) {
    await this.prisma.asset.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Asset categories / locations -----
  @Get('categories') categories(@Req() req: any) { return this.prisma.assetCategory.findMany({ where: { companyId: companyIdOf(req.user) }, orderBy: { name: 'asc' } }); }
  @Post('categories') createCategory(@Req() req: any, @Body() body: any) {
    return this.prisma.assetCategory.create({ data: { companyId: companyIdOf(req.user), name: body.name, assetAccount: body.assetAccount || '1500', accumulatedDepreciationAccount: body.accumulatedDepreciationAccount || '1509', depreciationExpenseAccount: body.depreciationExpenseAccount || '6500', disposalGainLossAccount: body.disposalGainLossAccount || '6501' } });
  }
  @Get('locations') locations(@Req() req: any) { return this.prisma.assetLocation.findMany({ where: { companyId: companyIdOf(req.user) }, orderBy: { name: 'asc' } }); }
  @Post('locations') createLocation(@Req() req: any, @Body() body: any) {
    return this.prisma.assetLocation.create({ data: { companyId: companyIdOf(req.user), name: body.name, branchId: body.branchId, departmentId: body.departmentId } });
  }
  @Post(':id/location') setLocation(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.assetLocationHistory.create({ data: { assetId: id, locationId: body.locationId, effectiveFrom: new Date() } });
  }

  // ----- Maintenance -----
  @Get('maintenance') maintenance(@Req() req: any) {
    return this.prisma.maintenanceOrder.findMany({ where: { companyId: companyIdOf(req.user) }, include: { asset: true }, orderBy: { scheduledDate: 'desc' } });
  }
  @Post('maintenance') async createMaintenance(@Req() req: any, @Body() dto: MaintenanceDto) {
    const companyId = companyIdOf(req.user);
    const order = await this.prisma.maintenanceOrder.create({ data: { companyId, assetId: dto.assetId, scheduledDate: new Date(dto.scheduledDate), completedDate: dto.completedDate ? new Date(dto.completedDate) : undefined, description: dto.description, cost: dto.cost ?? 0 } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'MaintenanceOrder', order.id);
    return order;
  }
  @Patch('maintenance/:id/status') updateMaintenanceStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    const companyId = companyIdOf(req.user);
    return this.prisma.maintenanceOrder.updateMany({ where: { id, companyId }, data: { status: dto.status, completedDate: dto.status === 'COMPLETED' ? new Date() : undefined } });
  }
  @Delete('maintenance/:id') async deleteMaintenance(@Req() req: any, @Param('id') id: string) {
    await this.prisma.maintenanceOrder.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  @Get('report') async report(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const assets = await this.prisma.asset.findMany({ where: { companyId } });
    return {
      totalValue: Number(assets.reduce((s, a) => s + Number(a.cost), 0).toFixed(2)),
      totalDepreciation: Number(assets.reduce((s, a) => s + Number(a.accumulatedDepreciation), 0).toFixed(2)),
      netBookValue: Number(assets.reduce((s, a) => s + (Number(a.cost) - Number(a.accumulatedDepreciation)), 0).toFixed(2)),
      byCategory: assets.reduce((acc: Record<string, number>, a) => { acc[a.category] = (acc[a.category] || 0) + Number(a.cost); return acc; }, {}),
      byStatus: assets.reduce((acc: Record<string, number>, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {}),
    };
  }
}