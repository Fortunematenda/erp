import { Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CreateTenantDto } from './platform.dto';

@ApiTags('Platform Admin') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('platform')
export class PlatformController {
  constructor(private prisma: PrismaService) {}
  private requireAdmin(req:any){ if(!req.user.isPlatformAdmin) throw new ForbiddenException(); }
  @Get('tenants') tenants(@Req() req:any){this.requireAdmin(req); return this.prisma.tenant.findMany({include:{companies:true,subscription:{include:{plan:true}}},orderBy:{createdAt:'desc'}})}
  @Get('plans') plans(@Req() req:any){this.requireAdmin(req); return this.prisma.subscriptionPlan.findMany({orderBy:{monthlyPrice:'asc'}})}

  @Post('tenants') async createTenant(@Req() req:any,@Body() dto:CreateTenantDto){
    this.requireAdmin(req);
    const plan=await this.prisma.subscriptionPlan.findUnique({where:{name:dto.planName}});
    if(!plan) throw new ForbiddenException('Subscription plan not found');
    const passwordHash=await bcrypt.hash(dto.adminPassword,12);
    return this.prisma.$transaction(async tx=>{
      const tenant=await tx.tenant.create({data:{name:dto.tenantName,slug:dto.slug}});
      await tx.subscription.create({data:{tenantId:tenant.id,planId:plan.id}});
      const company=await tx.company.create({data:{tenantId:tenant.id,legalName:dto.legalName,tradingName:dto.tradingName,code:dto.companyCode,tin:dto.tin,vatNumber:dto.vatNumber,baseCurrency:dto.baseCurrency||'USD'}});
      const branch=await tx.branch.create({data:{companyId:company.id,name:dto.branchName,code:dto.branchCode}});
      let user=await tx.user.findUnique({where:{email:dto.adminEmail}});
      if(!user) user=await tx.user.create({data:{email:dto.adminEmail,passwordHash,firstName:dto.adminFirstName,lastName:dto.adminLastName}});
      await tx.membership.create({data:{userId:user.id,tenantId:tenant.id,companyId:company.id,role:'ADMIN'}});
      const accounts:[string,string,AccountType][]=[['1000','Cash & Bank',AccountType.ASSET],['1100','Accounts Receivable',AccountType.ASSET],['1200','Inventory',AccountType.ASSET],['2000','Accounts Payable',AccountType.LIABILITY],['2100','VAT Payable',AccountType.LIABILITY],['3000','Equity',AccountType.EQUITY],['4000','Sales Revenue',AccountType.REVENUE],['5000','Cost of Sales',AccountType.EXPENSE],['6000','Operating Expenses',AccountType.EXPENSE]];
      for(const [code,name,type] of accounts) await tx.ledgerAccount.create({data:{companyId:company.id,code,name,type}});
      await tx.fiscalDevice.create({data:{branchId:branch.id,name:'Primary VFD',serialNumber:`NEXUS-${company.code}-001`}});
      for(const [type,provider,name,status] of [['ZIMRA','ZIMRA FDMS','Fiscalisation','MOCK'],['PAYNOW','Paynow','Payments','NOT_CONFIGURED'],['SMTP','SMTP','Email','NOT_CONFIGURED'],['BANK','Bank API','Banking','NOT_CONFIGURED'],['WEBHOOK','Generic Webhook','Webhooks','NOT_CONFIGURED'],['SSO','OIDC/SAML','Identity','NOT_CONFIGURED'],['STORAGE','S3 Compatible','Documents','NOT_CONFIGURED'],['WHATSAPP','WhatsApp Business','Messaging','NOT_CONFIGURED']] as const){await tx.integrationConnection.create({data:{companyId:company.id,type,provider,name,status}})}
      return {tenant,company,branch,admin:{id:user.id,email:user.email}};
    })
  }
}
