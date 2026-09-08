import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';

@ApiTags('Companies') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('companies')
export class CompanyController {
  constructor(private prisma: PrismaService) {}
  @Get() async list(@Req() req: any) {
    return this.prisma.membership.findMany({ where: { userId: req.user.sub }, include: { company: { include: { branches: true } } } });
  }
  @Get('meta') async meta(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const [branches, departments, accounts, customers, suppliers, items, warehouses, employees, taxRates, plans, categories, priceLists] = await Promise.all([
      this.prisma.branch.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
      this.prisma.department.findMany({ where: { branch: { companyId } }, include: { branch: true } }),
      this.prisma.ledgerAccount.findMany({ where: { companyId, active: true }, orderBy: { code: 'asc' } }),
      this.prisma.customer.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
      this.prisma.supplier.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
      this.prisma.inventoryItem.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.warehouse.findMany({ where: { companyId } }),
      this.prisma.employee.findMany({ where: { companyId, active: true }, orderBy: { firstName: 'asc' } }),
      this.prisma.taxRate.findMany({ where: { companyId, active: true } }),
      this.prisma.subscriptionPlan.findMany({ orderBy: { monthlyPrice: 'asc' } }),
      this.prisma.inventoryCategory.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.priceList.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } }),
    ]);
    return { branches, departments, accounts, customers, suppliers, items, warehouses, employees, taxRates, plans, categories, priceLists };
  }
}

