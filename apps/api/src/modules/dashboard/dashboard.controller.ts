import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';

@ApiTags('Dashboard') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('dashboard')
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  @Get('summary') async summary(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const [customers, invoices, items, employees, assets, leads, risks, receipts, suppliers, openTasks, outstandingReceivables] = await Promise.all([
      this.prisma.customer.count({ where: { companyId } }),
      this.prisma.salesInvoice.count({ where: { companyId } }),
      this.prisma.inventoryItem.count({ where: { companyId } }),
      this.prisma.employee.count({ where: { companyId, active: true } }),
      this.prisma.asset.count({ where: { companyId, status: 'ACTIVE' } }),
      this.prisma.lead.count({ where: { companyId } }),
      this.prisma.risk.count({ where: { companyId, status: { not: 'CLOSED' } } }),
      this.prisma.fiscalReceipt.count({ where: { invoice: { companyId }, status: 'FISCALISED' } }),
      this.prisma.supplier.count({ where: { companyId } }),
      this.prisma.crmTask.count({ where: { companyId, status: { not: 'COMPLETED' } } }),
      (async () => {
        const invoices = await this.prisma.salesInvoice.findMany({ where: { companyId, status: { in: ['POSTED', 'PART_PAID'] } }, include: { receipts: true } });
        return invoices.reduce((s, i) => s + Math.max(0, Number(i.total) - i.receipts.reduce((x, r) => x + Number(r.amount), 0)), 0);
      })(),
    ]);
    const totals = await this.prisma.salesInvoice.aggregate({ where: { companyId, status: { in: ['POSTED', 'PART_PAID', 'PAID'] } }, _sum: { total: true, taxTotal: true } });
    const lowStock = await this.prisma.inventoryItem.findMany({ where: { companyId, active: true }, include: { movements: true } });
    const lowStockCount = lowStock.filter((i: any) => i.movements.reduce((s: number, m: any) => s + (['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN'].includes(m.type) ? Number(m.quantity) : -Number(m.quantity)), 0) <= Number(i.reorderLevel)).length;
    return { customers, invoices, items, employees, assets, leads, openRisks: risks, fiscalReceipts: receipts, suppliers, openTasks, outstandingReceivables: Number(outstandingReceivables.toFixed(2)), lowStockCount, sales: Number(totals._sum.total || 0), tax: Number(totals._sum.taxTotal || 0) };
  }
}
