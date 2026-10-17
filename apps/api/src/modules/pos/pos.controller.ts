import { Body, Controller, Get, Headers, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { PermissionService } from '../auth/permission.service';
import { companyIdOf } from '../../core/context';
import { PosService } from './pos.service';

@ApiTags('POS')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pos')
export class PosController {
  constructor(private pos: PosService, private permissions: PermissionService) {}

  private async can(req: any, code: string) {
    return !!req.user.isPlatformAdmin || this.permissions.hasAny(req.user, [code]);
  }

  private async sellFlags(req: any) {
    const [allowPriceOverride, allowCredit, allowDiscount] = await Promise.all([
      this.can(req, 'pos.price.override'), this.can(req, 'pos.credit'), this.can(req, 'pos.discount'),
    ]);
    return { allowPriceOverride, allowCredit, allowDiscount };
  }

  @RequirePermissions('pos.access')
  @Get('bootstrap')
  async bootstrap(@Req() req: any, @Query('branchId') branchId?: string) {
    const data = await this.pos.bootstrap(companyIdOf(req.user), branchId);
    const codes = ['pos.sell', 'pos.credit', 'pos.discount', 'pos.price.override', 'pos.hold', 'pos.cancel', 'pos.void', 'pos.refund', 'pos.refund.approve', 'pos.shifts.open', 'pos.shifts.close', 'pos.shifts.approve', 'pos.registers.manage', 'pos.settings', 'pos.restaurant', 'pos.kitchen', 'pos.reports'];
    const allowed = await Promise.all(codes.map((c) => this.can(req, c)));
    return { ...data, can: Object.fromEntries(codes.map((c, i) => [c, allowed[i]])) };
  }

  @RequirePermissions('pos.settings')
  @Put('settings')
  settings(@Req() req: any, @Body() body: any) {
    return this.pos.saveSettings(companyIdOf(req.user), body.branchId, body);
  }

  @RequirePermissions('pos.access')
  @Get('catalog')
  catalog(@Req() req: any, @Query() q: any) {
    return this.pos.catalog(companyIdOf(req.user), q);
  }

  @RequirePermissions('pos.access')
  @Get('sales')
  sales(@Req() req: any, @Query() q: any) {
    return this.pos.listSales(companyIdOf(req.user), q);
  }

  @RequirePermissions('pos.hold')
  @Post('sales/hold')
  async hold(@Req() req: any, @Body() body: any) {
    return this.pos.hold(companyIdOf(req.user), req.user.sub, { ...body, ...(await this.sellFlags(req)) });
  }

  @RequirePermissions('pos.access')
  @Post('sales/:id/resume')
  resume(@Req() req: any, @Param('id') id: string) {
    return this.pos.resume(companyIdOf(req.user), id);
  }

  @RequirePermissions('pos.hold')
  @Post('sales/:id/recall')
  recall(@Req() req: any, @Param('id') id: string) {
    return this.pos.recallHeld(companyIdOf(req.user), req.user.sub, id);
  }

  @RequirePermissions('pos.access')
  @Get('staff')
  staff(@Req() req: any) {
    return this.pos.staff(companyIdOf(req.user));
  }

  @RequirePermissions('pos.access')
  @Post('quote')
  async quote(@Req() req: any, @Body() body: any) {
    return this.pos.quote(companyIdOf(req.user), { ...body, ...(await this.sellFlags(req)) });
  }

  @RequirePermissions('pos.void')
  @Post('sales/:id/abandon')
  abandon(@Req() req: any, @Param('id') id: string) {
    return this.pos.abandonCart(companyIdOf(req.user), req.user.sub, id);
  }

  @RequirePermissions('pos.sell')
  @Post('sales/complete')
  async complete(@Req() req: any, @Body() body: any, @Headers('idempotency-key') key?: string) {
    return this.pos.complete(companyIdOf(req.user), req.user.sub, { ...body, ...(await this.sellFlags(req)) }, key || body.idempotencyKey);
  }

  @RequirePermissions('pos.sell')
  @Post('sales/:id/fiscalise')
  fiscalise(@Req() req: any, @Param('id') id: string) {
    return this.pos.retryFiscal(companyIdOf(req.user), req.user.sub, id);
  }

  @RequirePermissions('pos.refund')
  @Post('sales/:id/return')
  async ret(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.pos.returnSale(companyIdOf(req.user), req.user.sub, id, { ...body, canApprove: await this.can(req, 'pos.refund.approve') });
  }

  @RequirePermissions('pos.refund')
  @Get('returns')
  returns(@Req() req: any, @Query() q: any) {
    return this.pos.returns(companyIdOf(req.user), q);
  }

  @RequirePermissions('pos.refund.approve')
  @Post('returns/:id/approve')
  approveReturn(@Req() req: any, @Param('id') id: string) {
    return this.pos.approveReturn(companyIdOf(req.user), req.user.sub, id);
  }

  @RequirePermissions('pos.refund.approve')
  @Post('returns/:id/reject')
  rejectReturn(@Req() req: any, @Param('id') id: string) {
    return this.pos.rejectReturn(companyIdOf(req.user), req.user.sub, id);
  }

  @RequirePermissions('pos.access')
  @Get('orders')
  orders(@Req() req: any, @Query() q: any) {
    return this.pos.openOrders(companyIdOf(req.user), q);
  }

  @RequirePermissions('pos.sell')
  @Post('orders')
  async openOrder(@Req() req: any, @Body() body: any) {
    return this.pos.openOrder(companyIdOf(req.user), req.user.sub, { ...body, ...(await this.sellFlags(req)) });
  }

  @RequirePermissions('pos.sell')
  @Post('orders/:id/lines')
  async addLines(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.pos.addLines(companyIdOf(req.user), id, { ...body, ...(await this.sellFlags(req)) });
  }

  @RequirePermissions('pos.sell')
  @Post('orders/:id/lines/:lineId/void')
  async voidLine(@Req() req: any, @Param('id') id: string, @Param('lineId') lineId: string, @Body() body: { reason?: string }) {
    return this.pos.voidLine(companyIdOf(req.user), req.user.sub, id, lineId, await this.can(req, 'pos.cancel'), body?.reason);
  }

  @RequirePermissions('pos.sell')
  @Post('orders/:id/status')
  orderStatus(@Req() req: any, @Param('id') id: string, @Body() body: { status: string }) {
    return this.pos.setOrderStatus(companyIdOf(req.user), id, body.status);
  }

  @RequirePermissions('pos.restaurant')
  @Post('orders/:id/move')
  move(@Req() req: any, @Param('id') id: string, @Body() body: { tableId: string }) {
    return this.pos.moveTable(companyIdOf(req.user), req.user.sub, id, body.tableId);
  }

  @RequirePermissions('pos.sell')
  @Post('orders/:id/split')
  split(@Req() req: any, @Param('id') id: string, @Body() body: { lineIds: string[] }) {
    return this.pos.splitOrder(companyIdOf(req.user), req.user.sub, id, body.lineIds || []);
  }

  @RequirePermissions('pos.sell')
  @Post('orders/:id/merge')
  merge(@Req() req: any, @Param('id') id: string, @Body() body: { sourceId: string }) {
    return this.pos.mergeOrders(companyIdOf(req.user), req.user.sub, id, body.sourceId);
  }

  @RequirePermissions('pos.cancel')
  @Post('orders/:id/cancel')
  cancel(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.pos.cancelOrder(companyIdOf(req.user), req.user.sub, id, body?.reason);
  }

  @RequirePermissions('pos.sell')
  @Post('orders/:id/deposit')
  deposit(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.pos.takeDeposit(companyIdOf(req.user), req.user.sub, id, body);
  }

  @RequirePermissions('pos.access')
  @Get('registers')
  registers(@Req() req: any, @Query('branchId') branchId?: string) {
    return this.pos.registers(companyIdOf(req.user), branchId);
  }

  @RequirePermissions('pos.registers.manage')
  @Get('cash-accounts')
  cashAccounts(@Req() req: any) {
    return this.pos.cashAccounts(companyIdOf(req.user));
  }

  @RequirePermissions('pos.registers.manage')
  @Post('registers')
  saveRegister(@Req() req: any, @Body() body: any) {
    return this.pos.saveRegister(companyIdOf(req.user), body);
  }

  @RequirePermissions('pos.access')
  @Get('shifts')
  async shifts(@Req() req: any, @Query('branchId') branchId?: string) {
    const rows = await this.pos.shifts(companyIdOf(req.user), branchId);
    if (await this.can(req, 'pos.shifts.approve')) return rows;
    return rows.map((s) => (s.status === 'OPEN' ? { ...s, expectedCash: null } : s));
  }

  /** Cashiers count blind: the expected drawer total is only shown to supervisors while the shift is open. */
  @RequirePermissions('pos.access')
  @Get('shifts/:id/cash')
  async shiftCash(@Req() req: any, @Param('id') id: string) {
    const { shift, expected, cashSales, movements, byTender } = await this.pos.shiftCash(companyIdOf(req.user), id);
    const visible = shift.status !== 'OPEN' || await this.can(req, 'pos.shifts.approve');
    const base = { shiftId: shift.id, status: shift.status, openingFloat: Number(shift.openingFloat), movementList: shift.movements };
    return visible ? { ...base, expected, cashSales, movements, byTender } : { ...base, expected: null, cashSales: null, movements: null, byTender: null };
  }

  @RequirePermissions('pos.shifts.open')
  @Post('shifts/open')
  openShift(@Req() req: any, @Body() body: any) {
    return this.pos.openShift(companyIdOf(req.user), req.user.sub, body);
  }

  @RequirePermissions('pos.shifts.open')
  @Post('shifts/:id/cash')
  cash(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.pos.cashMove(companyIdOf(req.user), req.user.sub, id, body);
  }

  @RequirePermissions('pos.shifts.close')
  @Post('shifts/:id/close')
  async close(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const approve = await this.can(req, 'pos.shifts.approve');
    return this.pos.closeShift(companyIdOf(req.user), req.user.sub, id, { ...body, approveVariance: !!body.approveVariance && approve });
  }

  @RequirePermissions('pos.shifts.approve')
  @Post('shifts/:id/approve')
  approveShift(@Req() req: any, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.pos.approveShift(companyIdOf(req.user), req.user.sub, id, body?.note);
  }

  @RequirePermissions('pos.shifts.close')
  @Post('shifts/:id/recount')
  recount(@Req() req: any, @Param('id') id: string) {
    return this.pos.reopenShift(companyIdOf(req.user), req.user.sub, id);
  }

  @RequirePermissions('pos.restaurant')
  @Get('restaurant/areas')
  areas(@Req() req: any, @Query('branchId') branchId: string) {
    return this.pos.areas(companyIdOf(req.user), branchId);
  }

  @RequirePermissions('pos.settings')
  @Post('restaurant/areas')
  saveArea(@Req() req: any, @Body() body: any) {
    return this.pos.saveArea(companyIdOf(req.user), body);
  }

  @RequirePermissions('pos.settings')
  @Post('restaurant/tables')
  saveTable(@Req() req: any, @Body() body: any) {
    return this.pos.saveTable(companyIdOf(req.user), body);
  }

  @RequirePermissions('pos.restaurant')
  @Post('restaurant/tables/:id/status')
  tableStatus(@Req() req: any, @Param('id') id: string, @Body() body: { status: string }) {
    return this.pos.setTableStatus(companyIdOf(req.user), id, body.status);
  }

  @RequirePermissions('pos.restaurant')
  @Post('sales/:id/kitchen')
  kitchenSend(@Req() req: any, @Param('id') id: string, @Body() body: { stationId?: string }) {
    return this.pos.sendKitchen(companyIdOf(req.user), id, body?.stationId);
  }

  @RequirePermissions('pos.kitchen')
  @Get('kitchen')
  kitchen(@Req() req: any, @Query('branchId') branchId?: string) {
    return this.pos.kitchen(companyIdOf(req.user), branchId);
  }

  @RequirePermissions('pos.kitchen')
  @Post('kitchen/:id/status')
  async kitchenStatus(@Req() req: any, @Param('id') id: string, @Body() body: { status: string }) {
    return this.pos.kitchenStatus(companyIdOf(req.user), req.user.sub, id, body.status, await this.can(req, 'pos.cancel'));
  }

  @RequirePermissions('pos.kitchen')
  @Get('kitchen/stations')
  stations(@Req() req: any, @Query('branchId') branchId: string) {
    return this.pos.stations(companyIdOf(req.user), branchId);
  }

  @RequirePermissions('pos.settings')
  @Post('kitchen/stations')
  saveStation(@Req() req: any, @Body() body: any) {
    return this.pos.saveStation(companyIdOf(req.user), body);
  }

  @RequirePermissions('pos.settings')
  @Post('recipes')
  recipe(@Req() req: any, @Body() body: any) {
    return this.pos.saveRecipe(companyIdOf(req.user), body);
  }

  @RequirePermissions('pos.settings')
  @Post('modifiers')
  modifier(@Req() req: any, @Body() body: any) {
    return this.pos.saveModifier(companyIdOf(req.user), body);
  }

  @RequirePermissions('pos.reports')
  @Get('reports/summary')
  summary(@Req() req: any, @Query() q: any) {
    return this.pos.summary(companyIdOf(req.user), q);
  }
}
