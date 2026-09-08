import { PrismaClient, AccountType, InvoiceStatus, FiscalStatus, DeviceStatus, FiscalDayStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Password123!', 12);
  const plan = await prisma.subscriptionPlan.upsert({
    where: { name: 'Professional' },
    update: {},
    create: { name: 'Professional', monthlyPrice: 99, maxCompanies: 5, maxUsers: 25, features: ['finance','sales','inventory','procurement','crm','assets','hr','compliance','reporting','fiscalisation'] }
  });
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-holdings' }, update: {}, create: { name: 'Demo Holdings', slug: 'demo-holdings' }
  });
  await prisma.subscription.upsert({ where: { tenantId: tenant.id }, update: { planId: plan.id }, create: { tenantId: tenant.id, planId: plan.id } });
  let company = await prisma.company.findFirst({ where: { tenantId: tenant.id, code: 'DEMO' } });
  if (!company) company = await prisma.company.create({ data: { tenantId: tenant.id, legalName: 'Demo Supermarkets (Pvt) Ltd', tradingName: 'Demo Supermarkets', code: 'DEMO', tin: 'TEST-TIN-001', vatNumber: 'TEST-VAT-001', baseCurrency: 'USD' } });
  let branch = await prisma.branch.findFirst({ where: { companyId: company.id, code: 'HRE' } });
  if (!branch) branch = await prisma.branch.create({ data: { companyId: company.id, name: 'Harare Main', code: 'HRE', city: 'Harare', address: 'Test branch for local development' } });
  let dept = await prisma.department.findFirst({ where: { branchId: branch.id, code: 'ADM' } });
  if (!dept) dept = await prisma.department.create({ data: { branchId: branch.id, name: 'Administration', code: 'ADM' } });

  const user = await prisma.user.upsert({ where:{email:'admin@demo.local'}, update:{passwordHash}, create:{email:'admin@demo.local',passwordHash,firstName:'Demo',lastName:'Admin'} });
  await prisma.membership.upsert({ where:{userId_companyId:{userId:user.id,companyId:company.id}}, update:{role:'ADMIN'}, create:{userId:user.id,tenantId:tenant.id,companyId:company.id,role:'ADMIN'} });
  await prisma.user.upsert({ where:{email:'platform@demo.local'}, update:{passwordHash,isPlatformAdmin:true}, create:{email:'platform@demo.local',passwordHash,firstName:'Platform',lastName:'Admin',isPlatformAdmin:true} });

  const accounts = [
    ['1000','Cash & Bank',AccountType.ASSET],['1100','Accounts Receivable',AccountType.ASSET],['1200','Inventory',AccountType.ASSET],
    ['2000','Accounts Payable',AccountType.LIABILITY],['2100','VAT Payable',AccountType.LIABILITY],['3000','Share Capital',AccountType.EQUITY],
    ['4000','Sales Revenue',AccountType.REVENUE],['5000','Cost of Sales',AccountType.EXPENSE],['6000','Operating Expenses',AccountType.EXPENSE]
  ] as const;
  for (const [code,name,type] of accounts) await prisma.ledgerAccount.upsert({ where:{companyId_code:{companyId:company.id,code}}, update:{name,type}, create:{companyId:company.id,code,name,type} });

  const customer = await prisma.customer.upsert({ where:{companyId_code:{companyId:company.id,code:'CUST001'}}, update:{}, create:{companyId:company.id,code:'CUST001',name:'Walk-in Customer',email:'customer@example.test'} });
  const supplier = await prisma.supplier.upsert({ where:{companyId_code:{companyId:company.id,code:'SUP001'}}, update:{}, create:{companyId:company.id,code:'SUP001',name:'Demo Supplier'} });
  const item = await prisma.inventoryItem.upsert({ where:{companyId_sku:{companyId:company.id,sku:'SKU-001'}}, update:{}, create:{companyId:company.id,sku:'SKU-001',name:'Demo Product',unit:'EA',hsCode:'00000000',reorderLevel:5} });
  let wh = await prisma.warehouse.findFirst({where:{companyId:company.id,code:'MAIN'}});
  if(!wh) wh=await prisma.warehouse.create({data:{companyId:company.id,branchId:branch.id,code:'MAIN',name:'Main Warehouse'}});
  await prisma.employee.upsert({ where:{companyId_employeeNo:{companyId:company.id,employeeNo:'EMP001'}}, update:{}, create:{companyId:company.id,departmentId:dept.id,employeeNo:'EMP001',firstName:'Tariro',lastName:'Moyo',hireDate:new Date('2026-01-15'),basicSalary:800,workEmail:'tariro.moyo@demo.local'} });
  // Backfill work emails for demo employees created by older seeds (the
  // employee-first user flow requires a work email).
  const emailless = await prisma.employee.findMany({ where: { companyId: company.id, workEmail: null }, select: { id: true, firstName: true, lastName: true }, take: 200 });
  for (const e of emailless) {
    const w = `${(e.firstName || 'employee').toLowerCase().replace(/[^a-z0-9]/g, '.')}.${(e.lastName || 'demo').toLowerCase().replace(/[^a-z0-9]/g, '.')}@demo.local`;
    await prisma.employee.update({ where: { id: e.id }, data: { workEmail: w } });
  }
  if(await prisma.lead.count({where:{companyId:company.id}})===0) await prisma.lead.create({data:{companyId:company.id,name:'Kudzai N.',companyName:'Karoi Trading',stage:'QUALIFIED',estimatedValue:25000}});
  await prisma.asset.upsert({where:{companyId_assetNo:{companyId:company.id,assetNo:'AST001'}},update:{},create:{companyId:company.id,assetNo:'AST001',name:'Delivery Vehicle',category:'Vehicles',location:'Harare',cost:18000}});
  await prisma.risk.upsert({where:{companyId_code:{companyId:company.id,code:'RSK001'}},update:{},create:{companyId:company.id,code:'RSK001',title:'FDMS connectivity outage',category:'Operational',likelihood:2,impact:4,owner:'Finance Manager',mitigation:'Queue and retry fiscal transactions.'}});
  if(await prisma.complianceObligation.count({where:{companyId:company.id}})===0) await prisma.complianceObligation.create({data:{companyId:company.id,authority:'ZIMRA',title:'Fiscalisation compliance',frequency:'Continuous',status:'OPEN'}});
  const integrationSeeds:any[]=[['ZIMRA','ZIMRA FDMS','Fiscalisation','MOCK'],['PAYNOW','Paynow','Payments','NOT_CONFIGURED'],['SMTP','SMTP','Email','NOT_CONFIGURED'],['BANK','Bank API','Banking','NOT_CONFIGURED'],['WEBHOOK','Generic Webhook','Webhooks','NOT_CONFIGURED'],['SSO','OIDC/SAML','Identity','NOT_CONFIGURED'],['STORAGE','S3 Compatible','Documents','NOT_CONFIGURED'],['WHATSAPP','WhatsApp Business','Messaging','NOT_CONFIGURED']];
  for(const [type,provider,name,status] of integrationSeeds){ const exists=await prisma.integrationConnection.findFirst({where:{companyId:company.id,type,provider,name}}); if(!exists) await prisma.integrationConnection.create({data:{companyId:company.id,type,provider,name,status}}); }
  let device = await prisma.fiscalDevice.findFirst({where:{branchId:branch.id,serialNumber:'NEXUS-DEMO-001'}});
  if(!device) device=await prisma.fiscalDevice.create({data:{branchId:branch.id,name:'Main VFD',serialNumber:'NEXUS-DEMO-001',status:DeviceStatus.UNREGISTERED,dayStatus:FiscalDayStatus.CLOSED}});

  if(await prisma.salesInvoice.count({where:{companyId:company.id}})===0){
    await prisma.salesInvoice.create({data:{companyId:company.id,branchId:branch.id,customerId:customer.id,invoiceNo:'INV-0001',subtotal:100,taxTotal:15.5,total:115.5,status:InvoiceStatus.DRAFT,fiscalRequired:true,fiscalStatus:FiscalStatus.READY,lines:{create:[{description:'Demo Product',itemId:item.id,quantity:1,unitPrice:100,taxRate:15.5,taxAmount:15.5,lineTotal:115.5,hsCode:'00000000'}]}}});
  }
  console.log('Seed complete');
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());
