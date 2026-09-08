import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { companyIdOf } from '../../core/context';
import { AuditService } from '../../core/common/audit.service';
import { PermissionService } from '../auth/permission.service';
import { round2, sumMoney } from '../performance/performance.constants';

type AnyReq = any;

export type ColumnDef = { key: string; label: string; type?: 'text' | 'money' | 'number' | 'date' | 'datetime' | 'percent'; groupable?: boolean; aggregatable?: boolean };
export type DatasetDef = {
  id: string; label: string; area: string; description: string;
  dateField: string; // primary date basis
  columns: ColumnDef[];
  groupable: string[]; // column keys allowed as groupBy
  permissions: string[]; // any-of
  sensitive?: boolean;
  statusOptions?: string[];
  supportsBranch?: boolean;
  supportsCurrency?: boolean;
};

const round = (n: any) => round2(Number(n || 0));

/** Curated, permission-mapped datasets. The frontend never names raw fields — it picks from here. */
export const DATASETS: DatasetDef[] = [
  {
    id: 'SALES_INVOICES', label: 'Invoice Detail', area: 'sales', description: 'Posted sales invoices with tax, collection and outstanding values',
    dateField: 'invoiceDate',
    columns: [
      { key: 'invoiceNo', label: 'Invoice #', type: 'text' }, { key: 'invoiceDate', label: 'Invoice Date', type: 'date' }, { key: 'dueDate', label: 'Due Date', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'text', groupable: true }, { key: 'salesperson', label: 'Salesperson', type: 'text', groupable: true },
      { key: 'subtotal', label: 'Subtotal', type: 'money', aggregatable: true }, { key: 'tax', label: 'Tax', type: 'money', aggregatable: true },
      { key: 'total', label: 'Total', type: 'money', aggregatable: true }, { key: 'paid', label: 'Paid', type: 'money', aggregatable: true },
      { key: 'outstanding', label: 'Outstanding', type: 'money', aggregatable: true }, { key: 'invoiceStatus', label: 'Status', type: 'text', groupable: true },
      { key: 'paymentStatus', label: 'Payment Status', type: 'text', groupable: true }, { key: 'currency', label: 'Currency', type: 'text', groupable: true },
    ],
    groupable: ['customer', 'salesperson', 'invoiceStatus', 'paymentStatus', 'currency'],
    permissions: ['reports.sales.view', 'sales.reports.view'], statusOptions: ['DRAFT', 'POSTED', 'PART_PAID', 'PAID', 'VOID'], supportsBranch: true, supportsCurrency: true,
  },
  {
    id: 'SALES_BY_CUSTOMER', label: 'Sales by Customer', area: 'sales', description: 'Revenue, collections and outstanding values by customer',
    dateField: 'invoiceDate',
    columns: [
      { key: 'customer', label: 'Customer', type: 'text' }, { key: 'invoices', label: 'Invoices', type: 'number', aggregatable: true },
      { key: 'total', label: 'Sales', type: 'money', aggregatable: true }, { key: 'paid', label: 'Collected', type: 'money', aggregatable: true },
      { key: 'outstanding', label: 'Outstanding', type: 'money', aggregatable: true },
    ],
    groupable: [], permissions: ['reports.sales.view', 'sales.reports.view'], supportsBranch: true, supportsCurrency: true,
  },
  {
    id: 'SALES_BY_PRODUCT', label: 'Sales by Product', area: 'sales', description: 'Units, revenue and tax by item / line description',
    dateField: 'invoiceDate',
    columns: [
      { key: 'product', label: 'Item', type: 'text' }, { key: 'qty', label: 'Units Sold', type: 'number', aggregatable: true },
      { key: 'net', label: 'Net Sales', type: 'money', aggregatable: true }, { key: 'tax', label: 'Tax', type: 'money', aggregatable: true },
      { key: 'gross', label: 'Gross Sales', type: 'money', aggregatable: true },
    ],
    groupable: [], permissions: ['reports.sales.view', 'sales.reports.view'], supportsCurrency: true,
  },
  {
    id: 'SALES_BY_SALESPERSON', label: 'Sales by Salesperson', area: 'sales', description: 'Revenue and collections by salesperson',
    dateField: 'invoiceDate',
    columns: [
      { key: 'salesperson', label: 'Salesperson', type: 'text' }, { key: 'invoices', label: 'Invoices', type: 'number', aggregatable: true },
      { key: 'total', label: 'Sales', type: 'money', aggregatable: true }, { key: 'paid', label: 'Collected', type: 'money', aggregatable: true },
      { key: 'outstanding', label: 'Outstanding', type: 'money', aggregatable: true },
    ],
    groupable: [], permissions: ['reports.sales.view', 'sales.reports.view'], supportsBranch: true, supportsCurrency: true,
  },
  {
    id: 'SUPPLIER_BILLS', label: 'Supplier Bills', area: 'purchasing', description: 'Posted supplier bills with payment status',
    dateField: 'invoiceDate',
    columns: [
      { key: 'invoiceNo', label: 'Bill #', type: 'text' }, { key: 'invoiceDate', label: 'Bill Date', type: 'date' }, { key: 'dueDate', label: 'Due Date', type: 'date' },
      { key: 'supplier', label: 'Supplier', type: 'text', groupable: true }, { key: 'subtotal', label: 'Subtotal', type: 'money', aggregatable: true },
      { key: 'tax', label: 'Tax', type: 'money', aggregatable: true }, { key: 'total', label: 'Total', type: 'money', aggregatable: true },
      { key: 'paid', label: 'Paid', type: 'money', aggregatable: true }, { key: 'outstanding', label: 'Outstanding', type: 'money', aggregatable: true },
      { key: 'status', label: 'Status', type: 'text', groupable: true }, { key: 'paymentStatus', label: 'Payment Status', type: 'text', groupable: true },
    ],
    groupable: ['supplier', 'status', 'paymentStatus'], permissions: ['reports.purchasing.view'], statusOptions: ['DRAFT', 'POSTED', 'PAID', 'VOID'], supportsCurrency: true,
  },
  {
    id: 'PURCHASE_BY_SUPPLIER', label: 'Purchases by Supplier', area: 'purchasing', description: 'Purchases, payments and outstanding by supplier',
    dateField: 'invoiceDate',
    columns: [
      { key: 'supplier', label: 'Supplier', type: 'text' }, { key: 'bills', label: 'Bills', type: 'number', aggregatable: true },
      { key: 'total', label: 'Purchases', type: 'money', aggregatable: true }, { key: 'paid', label: 'Paid', type: 'money', aggregatable: true },
      { key: 'outstanding', label: 'Outstanding', type: 'money', aggregatable: true },
    ],
    groupable: [], permissions: ['reports.purchasing.view'], supportsCurrency: true,
  },
  {
    id: 'INVENTORY_ITEMS', label: 'Stock Valuation', area: 'inventory', description: 'On-hand quantities, weighted average cost and stock value per item',
    dateField: 'createdAt',
    columns: [
      { key: 'sku', label: 'SKU', type: 'text' }, { key: 'name', label: 'Item', type: 'text' },
      { key: 'category', label: 'Category', type: 'text', groupable: true }, { key: 'warehouse', label: 'Primary Warehouse', type: 'text', groupable: true },
      { key: 'onHand', label: 'On Hand', type: 'number', aggregatable: true }, { key: 'avgCost', label: 'Avg Cost', type: 'money', aggregatable: true },
      { key: 'value', label: 'Value', type: 'money', aggregatable: true }, { key: 'reorderQty', label: 'Reorder Level', type: 'number' },
    ],
    groupable: ['category', 'warehouse'], permissions: ['reports.inventory.view', 'inventory.view'],
  },
  {
    id: 'INVENTORY_MOVEMENTS', label: 'Stock Movement', area: 'inventory', description: 'Chronological stock movements with running quantities',
    dateField: 'occurredAt',
    columns: [
      { key: 'occurredAt', label: 'Date', type: 'datetime' }, { key: 'sku', label: 'SKU', type: 'text' }, { key: 'item', label: 'Item', type: 'text' },
      { key: 'warehouse', label: 'Warehouse', type: 'text', groupable: true }, { key: 'type', label: 'Type', type: 'text', groupable: true },
      { key: 'quantity', label: 'Qty', type: 'number', aggregatable: true }, { key: 'unitCost', label: 'Unit Cost', type: 'money', aggregatable: true },
      { key: 'direction', label: 'Direction', type: 'text', groupable: true },
    ],
    groupable: ['warehouse', 'type', 'direction'], permissions: ['reports.inventory.view', 'inventory.view'],
    statusOptions: ['RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_IN', 'RETURN_OUT'],
  },
  {
    id: 'CUSTOMERS', label: 'Customer Directory', area: 'customers', description: 'Customers with credit limits and balances',
    dateField: 'createdAt',
    columns: [
      { key: 'name', label: 'Customer', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'city', label: 'City', type: 'text', groupable: true }, { key: 'creditLimit', label: 'Credit Limit', type: 'money', aggregatable: true },
      { key: 'outstanding', label: 'Outstanding', type: 'money', aggregatable: true }, { key: 'status', label: 'Status', type: 'text', groupable: true },
    ],
    groupable: ['city', 'status'], permissions: ['reports.customers.view', 'sales.reports.view'],
  },
  {
    id: 'OUTSTANDING_INVOICES', label: 'Outstanding Invoices', area: 'customers', description: 'Posted invoices with outstanding balances and aging bucket',
    dateField: 'invoiceDate',
    columns: [
      { key: 'invoiceNo', label: 'Invoice #', type: 'text' }, { key: 'invoiceDate', label: 'Invoice Date', type: 'date' }, { key: 'dueDate', label: 'Due Date', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'text', groupable: true }, { key: 'total', label: 'Total', type: 'money', aggregatable: true },
      { key: 'outstanding', label: 'Outstanding', type: 'money', aggregatable: true }, { key: 'bucket', label: 'Aging Bucket', type: 'text', groupable: true },
    ],
    groupable: ['customer', 'bucket'], permissions: ['reports.customers.view', 'sales.reports.view'],
  },
  {
    id: 'CREDIT_NOTES', label: 'Credit Notes', area: 'customers', description: 'Posted credit notes issued to customers',
    dateField: 'creditNoteDate',
    columns: [
      { key: 'creditNoteNo', label: 'Credit Note #', type: 'text' }, { key: 'creditNoteDate', label: 'Date', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'text', groupable: true }, { key: 'total', label: 'Total', type: 'money', aggregatable: true },
      { key: 'status', label: 'Status', type: 'text', groupable: true },
    ],
    groupable: ['customer', 'status'], permissions: ['reports.customers.view', 'sales.reports.view'], supportsCurrency: true,
  },
  {
    id: 'ASSETS', label: 'Asset Register', area: 'operations', description: 'Fixed assets with cost, accumulated depreciation and net book value',
    dateField: 'createdAt',
    columns: [
      { key: 'assetNo', label: 'Asset No', type: 'text' }, { key: 'name', label: 'Asset', type: 'text' },
      { key: 'category', label: 'Category', type: 'text', groupable: true }, { key: 'cost', label: 'Cost', type: 'money', aggregatable: true },
      { key: 'depreciation', label: 'Depreciation', type: 'money', aggregatable: true }, { key: 'nbv', label: 'Net Book Value', type: 'money', aggregatable: true },
      { key: 'status', label: 'Status', type: 'text', groupable: true },
    ],
    groupable: ['category', 'status'], permissions: ['reports.assets.view', 'assets.view'],
  },
  {
    id: 'PROJECTS', label: 'Project Profitability', area: 'operations', description: 'Revenue, cost, profit and margin per project',
    dateField: 'createdAt',
    columns: [
      { key: 'name', label: 'Project', type: 'text' }, { key: 'revenue', label: 'Revenue', type: 'money', aggregatable: true },
      { key: 'cost', label: 'Cost', type: 'money', aggregatable: true }, { key: 'profit', label: 'Profit', type: 'money', aggregatable: true },
      { key: 'margin', label: 'Margin %', type: 'percent', aggregatable: true }, { key: 'status', label: 'Status', type: 'text', groupable: true },
    ],
    groupable: ['status'], permissions: ['reports.view'],
  },
  {
    id: 'LEADS', label: 'Lead Pipeline', area: 'operations', description: 'CRM leads with stage, source and value',
    dateField: 'createdAt',
    columns: [
      { key: 'name', label: 'Lead', type: 'text' }, { key: 'company', label: 'Company', type: 'text' },
      { key: 'stage', label: 'Stage', type: 'text', groupable: true }, { key: 'source', label: 'Source', type: 'text', groupable: true },
      { key: 'value', label: 'Value', type: 'money', aggregatable: true }, { key: 'assignee', label: 'Assignee', type: 'text', groupable: true },
    ],
    groupable: ['stage', 'source', 'assignee'], permissions: ['crm.view'],
  },
  {
    id: 'EMPLOYEES', label: 'Employee Directory', area: 'hr', description: 'Active and inactive employees with department and role',
    dateField: 'hireDate',
    columns: [
      { key: 'employeeNo', label: 'Employee #', type: 'text' }, { key: 'name', label: 'Name', type: 'text' },
      { key: 'department', label: 'Department', type: 'text', groupable: true }, { key: 'position', label: 'Job Role', type: 'text', groupable: true },
      { key: 'hireDate', label: 'Hire Date', type: 'date' }, { key: 'employmentStatus', label: 'Status', type: 'text', groupable: true },
    ],
    groupable: ['department', 'position', 'employmentStatus'], permissions: ['reports.hr.view', 'hr.employees.view'],
  },
  {
    id: 'LEAVE_BALANCES', label: 'Leave Balances', area: 'hr', description: 'Leave entitlements, taken and remaining days',
    dateField: 'createdAt',
    columns: [
      { key: 'employee', label: 'Employee', type: 'text' }, { key: 'leaveType', label: 'Leave Type', type: 'text', groupable: true },
      { key: 'entitled', label: 'Entitled', type: 'number', aggregatable: true }, { key: 'taken', label: 'Taken', type: 'number', aggregatable: true },
      { key: 'remaining', label: 'Remaining', type: 'number', aggregatable: true },
    ],
    groupable: ['leaveType'], permissions: ['reports.hr.view', 'hr.leave.view'],
  },
  {
    id: 'ATTENDANCE', label: 'Attendance', area: 'hr', description: 'Daily attendance records with late minutes and overtime',
    dateField: 'date',
    columns: [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'employee', label: 'Employee', type: 'text', groupable: true },
      { key: 'status', label: 'Status', type: 'text', groupable: true }, { key: 'lateMinutes', label: 'Late Minutes', type: 'number', aggregatable: true },
      { key: 'overtimeHours', label: 'Overtime Hours', type: 'number', aggregatable: true },
    ],
    groupable: ['employee', 'status'], permissions: ['reports.hr.view', 'hr.attendance.view'],
  },
  {
    id: 'PAYSLIPS', label: 'Payroll Register', area: 'hr', description: 'Processed payslips with earnings, deductions and net pay',
    dateField: 'createdAt',
    columns: [
      { key: 'employeeNo', label: 'Employee #', type: 'text' }, { key: 'employee', label: 'Employee', type: 'text', groupable: true },
      { key: 'period', label: 'Period', type: 'text', groupable: true }, { key: 'basicSalary', label: 'Basic Salary', type: 'money', aggregatable: true },
      { key: 'bonus', label: 'Performance Bonus', type: 'money', aggregatable: true }, { key: 'grossPay', label: 'Gross Pay', type: 'money', aggregatable: true },
      { key: 'payeTax', label: 'PAYE', type: 'money', aggregatable: true }, { key: 'nssaDeduction', label: 'NSSA', type: 'money', aggregatable: true },
      { key: 'otherDeductions', label: 'Other Deductions', type: 'money', aggregatable: true }, { key: 'netPay', label: 'Net Pay', type: 'money', aggregatable: true },
    ],
    groupable: ['employee', 'period'], permissions: ['payroll.view'], sensitive: true,
  },
  {
    id: 'JOURNAL_LINES', label: 'General Ledger', area: 'financial', description: 'Posted journal lines by account with debit and credit',
    dateField: 'date',
    columns: [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'journalNo', label: 'Journal', type: 'text' },
      { key: 'accountCode', label: 'Account Code', type: 'text', groupable: true }, { key: 'accountName', label: 'Account Name', type: 'text', groupable: true },
      { key: 'debit', label: 'Debit', type: 'money', aggregatable: true }, { key: 'credit', label: 'Credit', type: 'money', aggregatable: true },
    ],
    groupable: ['accountCode', 'accountName'], permissions: ['reports.financial.view', 'finance.reports.view'],
  },
];

// Back-compat alias for old saved reports
const LEGACY_MAP: Record<string, string> = { GL: 'JOURNAL_LINES', SALES: 'SALES_INVOICES', CUSTOMERS: 'CUSTOMERS', SUPPLIERS: null as any, INVENTORY: 'INVENTORY_ITEMS', ASSETS: 'ASSETS', PROJECTS: 'PROJECTS' };

const sign = (t: string) => ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'].includes(t) ? 1 : -1;
const OUT_INVOICES = ['POSTED', 'PART_PAID', 'PAID'];
const postedInvoices = { invoiceStatus: { in: OUT_INVOICES } };
const postedBills = { status: 'POSTED' };

const ageBucket = (due: Date | null): string => {
  if (!due) return 'Current';
  const days = Math.floor((Date.now() - new Date(due).getTime()) / 86400000);
  if (days <= 0) return 'Current';
  if (days <= 30) return '1–30';
  if (days <= 60) return '31–60';
  if (days <= 90) return '61–90';
  return '90+';
};

@Injectable()
export class ReportService {
  constructor(private prisma: PrismaService, private audit: AuditService, private permissionService: PermissionService) {}

  datasets() { return DATASETS.map(({ id, label, area, description, columns, groupable, permissions, statusOptions, supportsBranch, supportsCurrency }) => ({ id, label, area, description, columns, groupable, permissions, statusOptions, supportsBranch, supportsCurrency })); }

  private can(perms: string[], required: string[]): boolean {
    if (perms.includes('*')) return true;
    return required.some((r) => perms.includes(r));
  }

  async assertDatasetAccess(req: AnyReq, datasetId: string): Promise<DatasetDef> {
    const ds = DATASETS.find((d) => d.id === datasetId);
    if (!ds) throw new BadRequestException(`Unknown report dataset "${datasetId}"`);
    const perms = req.user?.isPlatformAdmin ? ['*'] : await this.permissions(req);
    if (!this.can(perms, ds.permissions)) throw new ForbiddenException(`You do not have permission for the ${ds.label} dataset`);
    if (ds.sensitive) {
      await this.audit.log(companyIdOf(req.user), req.user.sub, 'SENSITIVE_REPORT_ACCESSED', 'ReportDataset', ds.id, { dataset: ds.label });
    }
    return ds;
  }

  private async permissions(req: AnyReq): Promise<string[]> {
    try { return await this.permissionService.getPermissions(req.user); } catch { return []; }
  }

  /** Public permission lookup for controller-side checks. */
  async getPermissions(req: AnyReq): Promise<string[]> { return this.permissions(req); }

  // ------------------------------------------------------------------
  // OVERVIEW
  // ------------------------------------------------------------------
  async overview(req: AnyReq, q: { from?: string; to?: string; branchId?: string; currency?: string; compareFrom?: string; compareTo?: string }) {
    const companyId = companyIdOf(req.user);
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(new Date(q.to).setHours(23, 59, 59, 999)) : null;
    const cFrom = q.compareFrom ? new Date(q.compareFrom) : null;
    const cTo = q.compareTo ? new Date(new Date(q.compareTo).setHours(23, 59, 59, 999)) : null;
    const currency = q.currency || null;
    const curWhere = currency ? { currency } : {};
    const branchWhere = q.branchId ? { branchId: q.branchId } : {};

    const revenueWhere: any = { companyId, ...postedInvoices, ...curWhere, ...branchWhere };
    if (from) revenueWhere.invoiceDate = { ...revenueWhere.invoiceDate, gte: from };
    if (to) revenueWhere.invoiceDate = { ...revenueWhere.invoiceDate, lte: to };

    const [revenueAgg, purchasesAgg, receivableRows, inventoryVal, prevRevenue, prevPurchases] = await Promise.all([
      this.prisma.salesInvoice.aggregate({ where: revenueWhere, _sum: { total: true, taxTotal: true }, _count: true }),
      this.prisma.supplierInvoice.aggregate({ where: { companyId, ...postedBills, ...curWhere, ...(from || to ? { invoiceDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, _sum: { total: true }, _count: true }),
      // Receivables use the SAME math as the A/R Aging report (total − receipts − posted credits)
      // so the Overview KPI reconciles with the Customers → A/R Aging report (spec 103/108).
      this.prisma.salesInvoice.findMany({ where: { companyId, ...postedInvoices, ...curWhere, ...branchWhere, ...(to ? { invoiceDate: { lte: to } } : {}) }, select: { total: true, currency: true, dueDate: true, invoiceDate: true, receipts: { where: { status: { not: 'REVERSED' } } }, creditNotes: { where: { status: 'POSTED' } } } }),
      this.inventoryValue(companyId),
      cFrom || cTo ? this.prisma.salesInvoice.aggregate({ where: { companyId, ...postedInvoices, ...curWhere, ...branchWhere, ...(cFrom ? { invoiceDate: { gte: cFrom } } : {}), ...(cTo ? { invoiceDate: { lte: cTo } } : {}) }, _sum: { total: true } }) : Promise.resolve(null),
      cFrom || cTo ? this.prisma.supplierInvoice.aggregate({ where: { companyId, ...postedBills, ...curWhere, ...(cFrom ? { invoiceDate: { gte: cFrom } } : {}), ...(cTo ? { invoiceDate: { lte: cTo } } : {}) }, _sum: { total: true } }) : Promise.resolve(null),
    ]);

    const outstandingOf = (i: any) => this.invoiceOutstanding(i);
    const receivablesTotal = round(sumMoney(receivableRows.map((r) => outstandingOf(r))));
    const buckets: Record<string, number> = { Current: 0, '1–30': 0, '31–60': 0, '61–90': 0, '90+': 0 };
    for (const r of receivableRows) {
      const o = outstandingOf(r);
      if (o <= 0.005) continue;
      const b = ageBucket(r.dueDate ? new Date(r.dueDate) : null);
      buckets[b] = round(buckets[b] + o);
    }

    // currency breakdown when no explicit currency filter
    let currencyBreakdown: any = null;
    if (!currency) {
      const cur: Record<string, { revenue: number; receivables: number }> = {};
      const revs = await this.prisma.salesInvoice.groupBy({ by: ['currency'], where: revenueWhere, _sum: { total: true } });
      for (const r of revs) cur[r.currency] = { revenue: round(Number(r._sum.total || 0)), receivables: 0 };
      for (const r of receivableRows) { const o = outstandingOf(r); if (!cur[r.currency]) cur[r.currency] = { revenue: 0, receivables: 0 }; cur[r.currency].receivables = round(cur[r.currency].receivables + o); }
      currencyBreakdown = cur;
    }

    // monthly trend within range (fallback: last 6 months)
    const trendFrom = from || new Date(new Date().setMonth(new Date().getMonth() - 5, 1));
    const trendTo = to || new Date();
    const [revRows, purRows] = await Promise.all([
      this.prisma.salesInvoice.findMany({ where: { companyId, ...postedInvoices, ...curWhere, ...branchWhere, invoiceDate: { gte: trendFrom, lte: trendTo } }, select: { invoiceDate: true, total: true, currency: true } }),
      this.prisma.supplierInvoice.findMany({ where: { companyId, ...postedBills, ...curWhere, invoiceDate: { gte: trendFrom, lte: trendTo } }, select: { invoiceDate: true, total: true, currency: true } }),
    ]);
    const trendMap: Record<string, { month: string; revenue: number; purchases: number }> = {};
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    for (const r of [...revRows.map((x) => ({ d: x.invoiceDate, v: Number(x.total), k: 'revenue' as const })), ...purRows.map((x) => ({ d: x.invoiceDate, v: Number(x.total), k: 'purchases' as const }))]) {
      const key = monthKey(new Date(r.d));
      if (!trendMap[key]) trendMap[key] = { month: key, revenue: 0, purchases: 0 };
      trendMap[key][r.k] = round(trendMap[key][r.k] + r.v);
    }
    const trend = Object.values(trendMap).sort((a, b) => a.month.localeCompare(b.month));

    const pct = (curr: number, prev: number | null | undefined) => {
      if (prev == null || Number(prev) === 0) return null;
      return round2(((curr - Number(prev)) / Math.abs(Number(prev))) * 100);
    };
    const revenue = round(Number(revenueAgg._sum.total || 0));
    const purchases = round(Number(purchasesAgg._sum.total || 0));
    const reorderAlerts = await this.prisma.inventoryItem.count({ where: { companyId } });

    return {
      kpis: {
        revenue,
        purchases,
        receivables: receivablesTotal,
        inventoryValue: inventoryVal.totalValue,
        invoiceCount: revenueAgg._count,
        billCount: purchasesAgg._count,
        compare: cFrom || cTo ? {
          revenue: prevRevenue ? round(Number(prevRevenue._sum.total || 0)) : null,
          purchases: prevPurchases ? round(Number(prevPurchases._sum.total || 0)) : null,
          revenuePct: pct(revenue, prevRevenue ? Number(prevRevenue._sum.total || 0) : null),
          purchasesPct: pct(purchases, prevPurchases ? Number(prevPurchases._sum.total || 0) : null),
        } : null,
      },
      currencyBreakdown,
      trend,
      arBuckets: buckets,
      inventoryPosition: { itemsInStock: reorderAlerts, reorderAlerts: inventoryVal.reorderAlerts, totalValue: inventoryVal.totalValue },
      meta: { from, to, compareFrom: cFrom, compareTo: cTo, currency, branchId: q.branchId || null },
    };
  }

  private async inventoryValue(companyId: string) {
    const items = await this.prisma.inventoryItem.findMany({ where: { companyId }, include: { movements: { include: { warehouse: true } }, category: true } });
    let totalValue = 0; let reorderAlerts = 0; let itemsInStock = 0;
    const perItem: any[] = [];
    for (const i of items) {
      const b = this.wac(i.movements);
      totalValue += b.value;
      if (b.onHand > 0) itemsInStock += 1;
      if (Number(i.reorderLevel) > 0 && b.onHand <= Number(i.reorderLevel)) reorderAlerts += 1;
      const whNames = [...new Set(i.movements.map((m: any) => m.warehouse?.name).filter(Boolean))];
      perItem.push({ id: i.id, sku: i.sku, name: i.name, category: i.category?.name || null, warehouse: whNames[0] || null, onHand: b.onHand, avgCost: b.avgCost, value: b.value, reorderQty: Number(i.reorderLevel || 0), reorderAlert: Number(i.reorderLevel) > 0 && b.onHand <= Number(i.reorderLevel) });
    }
    return { totalValue: round(totalValue), reorderAlerts, itemsInStock, perItem };
  }

  private wac(movements: any[]) {
    let qty = 0, value = 0;
    const sorted = [...movements].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    for (const m of sorted) {
      const q = Number(m.quantity || 0);
      if (sign(m.type) > 0) { qty += q; value += q * Number(m.unitCost || 0); }
      else { const avg = qty > 0 ? value / qty : 0; const out = Math.min(q, qty); value -= out * avg; qty -= out; }
    }
    return { onHand: Number(qty.toFixed(4)), avgCost: Number((qty > 0.0001 ? value / qty : 0).toFixed(2)), value: Number(value.toFixed(2)) };
  }

  /** Same math as the A/R Aging report: total − receipts − posted credits. */
  private invoiceOutstanding(i: any): number {
    const paid = (i.receipts || []).reduce((s: number, r: any) => s + Number(r.amount), 0);
    const credited = (i.creditNotes || []).reduce((s: number, c: any) => s + Number(c.total), 0);
    return Math.max(0, Number(i.total || 0) - paid - credited);
  }

  async branches(companyId: string) {
    return this.prisma.branch.findMany({ where: { companyId }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
  }

  async currencies(companyId: string) {
    const [inv, bills] = await Promise.all([
      this.prisma.salesInvoice.groupBy({ by: ['currency'], where: { companyId }, _count: true }),
      this.prisma.supplierInvoice.groupBy({ by: ['currency'], where: { companyId }, _count: true }),
    ]);
    const set = new Set<string>([...inv.map((i) => i.currency), ...bills.map((b) => b.currency)]);
    return [...set].sort();
  }

  // ------------------------------------------------------------------
  // DATASET RUNNER (curated, RBAC-mapped, server-side group/sort/page)
  // ------------------------------------------------------------------
  async run(req: AnyReq, body: { dataset: string; from?: string; to?: string; branchId?: string; currency?: string; status?: string; paymentStatus?: string; keyword?: string; customerId?: string; supplierId?: string; warehouseId?: string; categoryId?: string; itemId?: string; groupBy?: string; aggregation?: string; aggColumn?: string; sortBy?: string; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number }) {
    const ds = await this.assertDatasetAccess(req, body.dataset);
    const companyId = companyIdOf(req.user);
    const rows = await this.loadRows(companyId, ds, body);

    let out = rows;
    // grouping
    if (body.groupBy) {
      if (!ds.groupable.includes(body.groupBy)) throw new BadRequestException(`Grouping by "${body.groupBy}" is not supported for ${ds.label}`);
      out = this.groupRows(out, body.groupBy, body.aggregation || 'SUM', body.aggColumn);
    } else if (body.aggregation && body.aggColumn) {
      out = [{ [`${body.aggregation.toLowerCase()}_${body.aggColumn}`]: this.aggregate(out, body.aggregation, body.aggColumn) }];
    }
    // sort
    const sortBy = body.sortBy || (ds.columns[0]?.key || '');
    const col = ds.columns.find((c) => c.key === sortBy);
    const dir = body.sortDir === 'asc' ? 1 : -1;
    if (col) {
      out.sort((a: any, b: any) => {
        const av = a[sortBy], bv = b[sortBy];
        if (av == null) return 1; if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    // totals over the FULL filtered dataset
    const totals: Record<string, number> = {};
    for (const c of ds.columns.filter((x) => x.aggregatable)) totals[c.key] = round(sumMoney(out.map((r: any) => Number(r[c.key] || 0))));
    // paginate
    const page = Math.max(1, Number(body.page || 1));
    const pageSize = Math.min(200, Math.max(10, Number(body.pageSize || 25)));
    const total = out.length;
    const paged = out.slice((page - 1) * pageSize, page * pageSize);
    return { rows: paged, total, page, pageSize, totals, dataset: { id: ds.id, label: ds.label, columns: ds.columns } };
  }

  private groupRows(rows: any[], by: string, aggregation: string, aggColumn?: string): any[] {
    const map = new Map<string, any>();
    for (const r of rows) {
      const key = String(r[by] ?? '—');
      if (!map.has(key)) map.set(key, { ...r, _count: 0, _rows: [] });
      const g = map.get(key)!;
      g._count += 1;
      g._rows.push(r);
    }
    const out: any[] = [];
    for (const [key, g] of map) {
      const row: any = { [by]: key, count: g._count };
      for (const k of Object.keys(g)) {
        if (k.startsWith('_') || k === by) continue;
        const v = g[k];
        if (typeof v === 'number') {
          if (aggregation === 'COUNT') row[k] = g._count;
          else if (aggregation === 'AVG') row[k] = round(v / g._count);
          else if (aggregation === 'MIN') row[k] = Math.min(...g._rows.map((x: any) => Number(x[k] || 0)));
          else if (aggregation === 'MAX') row[k] = Math.max(...g._rows.map((x: any) => Number(x[k] || 0)));
          else row[k] = round(v);
        } else if (typeof v === 'string') { row[k] = key === v ? v : v; }
      }
      if (aggColumn) row[aggColumn] = this.aggregate(g._rows, aggregation, aggColumn);
      out.push(row);
    }
    return out;
  }

  private aggregate(rows: any[], aggregation: string, column: string): any {
    const nums = rows.map((r) => Number(r[column] || 0)).filter((n) => !Number.isNaN(n));
    switch ((aggregation || 'SUM').toUpperCase()) {
      case 'COUNT': return rows.length;
      case 'AVG': return nums.length ? round(nums.reduce((s, n) => s + n, 0) / nums.length) : 0;
      case 'MIN': return nums.length ? round(Math.min(...nums)) : 0;
      case 'MAX': return nums.length ? round(Math.max(...nums)) : 0;
      default: return round(nums.reduce((s, n) => s + n, 0));
    }
  }

  private async loadRows(companyId: string, ds: DatasetDef, q: any): Promise<any[]> {
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(new Date(q.to).setHours(23, 59, 59, 999)) : null;
    const range = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : null;
    const kw = (q.keyword || '').toLowerCase();
    const cur = q.currency ? { currency: q.currency } : {};
    const branch = q.branchId && ds.supportsBranch ? { branchId: q.branchId } : {};
    const CAP = 5000;

    switch (ds.id) {
      case 'SALES_INVOICES': case 'SALES_BY_CUSTOMER': case 'SALES_BY_PRODUCT': case 'SALES_BY_SALESPERSON': {
        const where: any = { companyId, ...branch, ...cur, invoiceStatus: { not: 'VOID' } };
        if (q.status === 'DRAFT') where.invoiceStatus = 'DRAFT';
        else if (q.status && q.status !== 'ALL') where.invoiceStatus = q.status;
        else where.invoiceStatus = { in: [...OUT_INVOICES, 'DRAFT'] };
        if (q.paymentStatus) where.paymentStatus = q.paymentStatus;
        if (q.customerId) where.customerId = q.customerId;
        if (range) where[ds.dateField] = range;
        const invoices = await this.prisma.salesInvoice.findMany({ where, include: { customer: true, lines: true }, take: CAP, orderBy: { invoiceDate: 'desc' } });
        // resolve item names for line-level grouping (no direct relation on invoice lines)
        const itemIds = [...new Set(invoices.flatMap((i: any) => (i.lines || []).map((l: any) => l.itemId).filter(Boolean)))];
        const itemMap = new Map<string, string>();
        if (itemIds.length) {
          const items = await this.prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } });
          for (const it of items) itemMap.set(it.id, it.name);
        }
        const itemName = (id: string | null) => (id ? itemMap.get(id) || 'Unknown Item' : null);
        let filtered = invoices.filter((i: any) => !kw || `${i.invoiceNo} ${i.customer?.name} ${i.salesperson || ''}`.toLowerCase().includes(kw));
        if (ds.id === 'SALES_INVOICES') {
          return filtered.map((i: any) => ({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, dueDate: i.dueDate, customer: i.customer?.name || '—', salesperson: i.salesperson || '—', subtotal: round(i.subtotal), tax: round(i.taxTotal), total: round(i.total), paid: round(i.amountPaid), outstanding: round(i.balanceDue), invoiceStatus: i.invoiceStatus, paymentStatus: i.paymentStatus, currency: i.currency }));
        }
        if (ds.id === 'SALES_BY_CUSTOMER') {
          const m: Record<string, any> = {};
          for (const i of filtered) { const k = i.customerId || 'none'; m[k] = m[k] || { customer: i.customer?.name || 'Unknown', invoices: 0, total: 0, paid: 0, outstanding: 0, children: [] }; const c = m[k]; c.invoices++; c.total += Number(i.total); c.paid += Number(i.amountPaid); c.outstanding += Number(i.balanceDue); c.children.push({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, total: round(i.total), paid: round(i.amountPaid), outstanding: round(i.balanceDue), paymentStatus: i.paymentStatus }); }
          return Object.values(m).map((c: any) => ({ customer: c.customer, invoices: c.invoices, total: round(c.total), paid: round(c.paid), outstanding: round(c.outstanding), _children: c.children }));
        }
        if (ds.id === 'SALES_BY_SALESPERSON') {
          const m: Record<string, any> = {};
          for (const i of filtered) { const k = i.salesperson || 'Unassigned'; m[k] = m[k] || { salesperson: k, invoices: 0, total: 0, paid: 0, outstanding: 0, children: [] }; const c = m[k]; c.invoices++; c.total += Number(i.total); c.paid += Number(i.amountPaid); c.outstanding += Number(i.balanceDue); c.children.push({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, customer: i.customer?.name || '—', total: round(i.total), outstanding: round(i.balanceDue) }); }
          return Object.values(m).map((c: any) => ({ salesperson: c.salesperson, invoices: c.invoices, total: round(c.total), paid: round(c.paid), outstanding: round(c.outstanding), _children: c.children }));
        }
        // BY PRODUCT — line level
        const pm: Record<string, any> = {};
        for (const i of filtered) for (const l of i.lines || []) {
          const key = l.itemId || `manual::${l.description || 'Unlinked'}`;
          pm[key] = pm[key] || { product: itemName(l.itemId) || l.description || 'Unlinked / Manual', qty: 0, net: 0, tax: 0, gross: 0, children: [] };
          const p = pm[key]; p.qty += Number(l.quantity); p.net += Number(l.quantity) * Number(l.unitPrice); p.tax += Number(l.taxAmount); p.gross += Number(l.lineTotal);
          p.children.push({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, customer: i.customer?.name || '', qty: Number(l.quantity), rate: Number(l.unitPrice), lineTotal: round(l.lineTotal) });
        }
        return Object.values(pm).map((p: any) => ({ product: p.product, qty: Number(p.qty.toFixed(2)), net: round(p.net), tax: round(p.tax), gross: round(p.gross), _children: p.children }));
      }
      case 'SUPPLIER_BILLS': case 'PURCHASE_BY_SUPPLIER': {
        const where: any = { companyId, ...cur };
        if (q.status && q.status !== 'ALL') where.status = q.status; else where.status = { in: ['DRAFT', 'POSTED', 'PAID', 'VOID'] };
        if (q.paymentStatus) where.paymentStatus = q.paymentStatus;
        if (q.supplierId) where.supplierId = q.supplierId;
        if (range) where[ds.dateField] = range;
        const bills = await this.prisma.supplierInvoice.findMany({ where, include: { supplier: true }, take: CAP, orderBy: { invoiceDate: 'desc' } });
        const filtered = bills.filter((b: any) => !kw || `${b.invoiceNo} ${b.supplier?.name}`.toLowerCase().includes(kw));
        if (ds.id === 'SUPPLIER_BILLS') return filtered.map((b: any) => ({ id: b.id, invoiceNo: b.invoiceNo, invoiceDate: b.invoiceDate, dueDate: b.dueDate, supplier: b.supplier?.name || '—', subtotal: round(b.subtotal), tax: round(b.taxTotal), total: round(b.total), paid: round(b.amountPaid), outstanding: round(b.balanceDue), status: b.status, paymentStatus: b.paymentStatus, currency: b.currency }));
        const m: Record<string, any> = {};
        for (const b of filtered) { const k = b.supplierId; m[k] = m[k] || { supplier: b.supplier?.name || 'Unknown', bills: 0, total: 0, paid: 0, outstanding: 0, children: [] }; const s = m[k]; s.bills++; s.total += Number(b.total); s.paid += Number(b.amountPaid); s.outstanding += Number(b.balanceDue); s.children.push({ id: b.id, invoiceNo: b.invoiceNo, invoiceDate: b.invoiceDate, total: round(b.total), outstanding: round(b.balanceDue), paymentStatus: b.paymentStatus }); }
        return Object.values(m).map((s: any) => ({ supplier: s.supplier, bills: s.bills, total: round(s.total), paid: round(s.paid), outstanding: round(s.outstanding), _children: s.children }));
      }
      case 'INVENTORY_ITEMS': {
        const val = await this.inventoryValue(companyId);
        let rows = val.perItem;
        if (q.categoryId) { const cat = await this.prisma.inventoryCategory.findFirst({ where: { id: q.categoryId, companyId } }); rows = rows.filter((r) => r.category === cat?.name); }
        if (q.warehouseId) { const wh = await this.prisma.warehouse.findFirst({ where: { id: q.warehouseId, companyId } }); rows = rows.filter((r) => r.warehouse === wh?.name); }
        if (q.itemId) rows = rows.filter((r) => r.id === q.itemId);
        if (q.stockStatus === 'IN_STOCK') rows = rows.filter((r) => r.onHand > 0);
        if (q.stockStatus === 'OUT_OF_STOCK') rows = rows.filter((r) => r.onHand <= 0);
        if (q.stockStatus === 'REORDER') rows = rows.filter((r) => r.reorderAlert);
        if (kw) rows = rows.filter((r) => `${r.sku} ${r.name}`.toLowerCase().includes(kw));
        return rows;
      }
      case 'INVENTORY_MOVEMENTS': {
        const where: any = { warehouse: { companyId, ...(q.branchId ? { branchId: q.branchId } : {}) } };
        if (q.itemId) where.itemId = q.itemId;
        if (q.warehouseId) where.warehouseId = q.warehouseId;
        if (q.status && q.status !== 'ALL') where.type = q.status;
        if (range) where.occurredAt = range;
        const mv = await this.prisma.stockMovement.findMany({ where, include: { item: true, warehouse: true }, take: CAP, orderBy: { occurredAt: 'desc' } });
        return mv.filter((m: any) => !kw || `${m.item?.sku} ${m.item?.name} ${m.reference || ''}`.toLowerCase().includes(kw)).map((m: any) => ({ id: m.id, occurredAt: m.occurredAt, sku: m.item?.sku || '—', item: m.item?.name || '—', warehouse: m.warehouse?.name || '—', type: m.type, quantity: Number(m.quantity), unitCost: round(m.unitCost), direction: sign(m.type) > 0 ? 'IN' : 'OUT', reference: m.reference || null }));
      }
      case 'CUSTOMERS': {
        const rows = await this.prisma.customer.findMany({ where: { companyId }, include: { invoices: { where: postedInvoices } }, take: CAP });
        let out = rows.map((c: any) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, city: c.city || '—', creditLimit: round(c.creditLimit), outstanding: round(c.invoices.reduce((s: number, i: any) => s + Number(i.balanceDue), 0)), status: c.status || 'ACTIVE' }));
        if (q.customerStatus) out = out.filter((c) => c.status === q.customerStatus);
        if (kw) out = out.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(kw));
        return out;
      }
      case 'OUTSTANDING_INVOICES': {
        const where: any = { companyId, ...cur, ...branch, invoiceStatus: { in: OUT_INVOICES } };
        if (q.customerId) where.customerId = q.customerId;
        if (range) where.invoiceDate = range;
        const rows = await this.prisma.salesInvoice.findMany({ where, include: { customer: true, receipts: { where: { status: { not: 'REVERSED' } } }, creditNotes: { where: { status: 'POSTED' } } }, take: CAP, orderBy: { dueDate: 'asc' } });
        let out = rows.map((i: any) => ({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, dueDate: i.dueDate, customer: i.customer?.name || '—', total: round(i.total), outstanding: round(this.invoiceOutstanding(i)), bucket: ageBucket(i.dueDate ? new Date(i.dueDate) : null), currency: i.currency })).filter((r: any) => r.outstanding > 0.005);
        if (q.bucket) out = out.filter((r) => r.bucket === q.bucket);
        if (kw) out = out.filter((r) => `${r.invoiceNo} ${r.customer}`.toLowerCase().includes(kw));
        return out;
      }
      case 'CREDIT_NOTES': {
        const where: any = { companyId, ...cur, ...(range ? { [ds.dateField]: range } : {}) };
        const rows = await this.prisma.creditNote.findMany({ where: { ...where, ...(q.status && q.status !== 'ALL' ? { status: q.status } : { status: { not: 'VOID' } }) }, include: { customer: true }, take: CAP, orderBy: { creditNoteDate: 'desc' } });
        return rows.filter((c: any) => !kw || `${c.creditNoteNo} ${c.customer?.name}`.toLowerCase().includes(kw)).map((c: any) => ({ id: c.id, creditNoteNo: c.creditNoteNo, creditNoteDate: c.creditNoteDate, customer: c.customer?.name || '—', total: round(c.total), status: c.status, currency: (c as any).currency || null }));
      }
      case 'ASSETS': {
        const rows = await this.prisma.asset.findMany({ where: { companyId, ...(q.categoryId ? { assetCategoryId: q.categoryId } : {}), ...(q.status && q.status !== 'ALL' ? { status: q.status } : {}) }, include: { assetCategory: true }, take: CAP });
        return rows.filter((a: any) => !kw || `${a.assetNo} ${a.name}`.toLowerCase().includes(kw)).map((a: any) => ({ id: a.id, assetNo: a.assetNo, name: a.name, category: a.assetCategory?.name || a.category || '—', cost: round(a.cost), depreciation: round(a.accumulatedDepreciation), nbv: round(Number(a.cost) - Number(a.accumulatedDepreciation)), status: a.status }));
      }
      case 'PROJECTS': {
        const rows = await this.prisma.project.findMany({ where: { companyId }, include: { invoices: true, timesheets: true, supplierInvoices: true }, take: CAP });
        return rows.filter((p: any) => !kw || p.name.toLowerCase().includes(kw)).map((p: any) => {
          const revenue = p.invoices.filter((i: any) => OUT_INVOICES.includes(i.status)).reduce((s: number, i: any) => s + Number(i.total), 0);
          const cost = p.timesheets.reduce((s: number, t: any) => s + Number(t.hours) * Number(t.costRate), 0) + p.supplierInvoices.reduce((s: number, b: any) => s + Number(b.total), 0);
          const profit = revenue - cost;
          return { id: p.id, name: p.name, revenue: round(revenue), cost: round(cost), profit: round(profit), margin: revenue ? round((profit / revenue) * 100) : 0, status: p.status };
        });
      }
      case 'LEADS': {
        const rows = await this.prisma.lead.findMany({ where: { companyId, ...(q.stage ? { stage: q.stage } : {}), ...(q.status && q.status !== 'ALL' ? {} : {}) }, take: CAP, orderBy: { createdAt: 'desc' } });
        return rows.filter((l: any) => !kw || `${l.name} ${l.company || ''}`.toLowerCase().includes(kw)).map((l: any) => ({ id: l.id, name: l.name, company: l.company || '—', stage: l.stage || '—', source: l.source || '—', value: round((l as any).value || (l as any).estimatedValue || 0), assignee: l.assignee || '—' }));
      }
      case 'EMPLOYEES': {
        const rows = await this.prisma.employee.findMany({ where: { companyId, ...(q.status && q.status !== 'ALL' ? { employmentStatus: q.status } : {}) }, include: { department: true }, take: CAP, orderBy: { firstName: 'asc' } });
        return rows.filter((e: any) => !kw || `${e.firstName} ${e.lastName} ${e.employeeNo}`.toLowerCase().includes(kw)).map((e: any) => ({ id: e.id, employeeNo: e.employeeNo, name: `${e.firstName} ${e.lastName}`, department: e.department?.name || '—', position: e.position || '—', hireDate: e.hireDate, employmentStatus: e.employmentStatus || (e.active ? 'ACTIVE' : 'INACTIVE') }));
      }
      case 'LEAVE_BALANCES': {
        const rows = await this.prisma.leaveBalance.findMany({ where: { companyId }, include: { employee: true, leaveType: true }, take: CAP });
        return rows.filter((l: any) => !kw || `${l.employee?.firstName} ${l.employee?.lastName}`.toLowerCase().includes(kw)).map((l: any) => ({ id: l.id, employee: `${l.employee?.firstName} ${l.employee?.lastName}`, leaveType: l.leaveType?.name || '—', entitled: Number(l.entitled || 0), taken: Number(l.taken || 0), remaining: Number((Number(l.entitled || 0) - Number(l.taken || 0)).toFixed(1)) }));
      }
      case 'ATTENDANCE': {
        const where: any = { companyId, ...(range ? { date: range } : {}) };
        if (q.status && q.status !== 'ALL') where.status = q.status;
        if (q.employeeId) where.employeeId = q.employeeId;
        const rows = await this.prisma.attendance.findMany({ where, include: { employee: true }, take: CAP, orderBy: { date: 'desc' } });
        return rows.filter((a: any) => !kw || `${a.employee?.firstName} ${a.employee?.lastName}`.toLowerCase().includes(kw)).map((a: any) => ({ id: a.id, date: a.date, employee: `${a.employee?.firstName} ${a.employee?.lastName}`, status: a.status, lateMinutes: Number(a.lateMinutes || 0), overtimeHours: Number(a.overtimeHours || 0) }));
      }
      case 'PAYSLIPS': {
        const runs = await this.prisma.payrollRun.findMany({ where: { companyId, ...(q.period ? { period: Number(q.period) } : {}), ...(q.year ? { year: Number(q.year) } : {}) }, orderBy: [{ year: 'desc' }, { period: 'desc' }], take: 12 });
        const runIds = runs.map((r) => r.id);
        if (!runIds.length) return [];
        const runById = new Map(runs.map((r) => [r.id, r]));
        const rows = await this.prisma.payslip.findMany({ where: { payrollRunId: { in: runIds } }, include: { employee: true }, take: CAP });
        return rows.filter((p: any) => !kw || `${p.employee?.firstName} ${p.employee?.lastName} ${p.employee?.employeeNo}`.toLowerCase().includes(kw)).map((p: any) => { const run: any = runById.get(p.payrollRunId); return { id: p.id, employeeNo: p.employee?.employeeNo || '—', employee: `${p.employee?.firstName} ${p.employee?.lastName}`, period: run ? `${run.period}/${run.year}` : '—', basicSalary: round(p.basicSalary), bonus: round((p as any).bonusAmount), grossPay: round(p.grossPay), payeTax: round(p.payeTax), nssaDeduction: round(p.nssaDeduction), otherDeductions: round(p.otherDeductions), netPay: round(p.netPay), runStatus: run?.status || '—' }; });
      }
      case 'JOURNAL_LINES': {
        const where: any = { journal: { companyId, status: 'POSTED', ...(range ? { date: range } : {}) } };
        if (q.accountId) where.accountId = q.accountId;
        const lines = await this.prisma.journalLine.findMany({ where, include: { account: true, journal: true }, take: CAP, orderBy: { journal: { date: 'desc' as any } } });
        return lines.filter((l: any) => !kw || `${l.account?.code} ${l.account?.name} ${l.journal?.number} ${l.journal?.memo || ''}`.toLowerCase().includes(kw)).map((l: any) => ({ id: l.id, date: l.journal.date, journalNo: l.journal.number, journalId: l.journal.id, accountCode: l.account?.code || '—', accountName: l.account?.name || '—', debit: round(l.debit), credit: round(l.credit) }));
      }
      default:
        throw new BadRequestException(`Dataset "${ds.id}" is not runnable`);
    }
  }

  // ------------------------------------------------------------------
  // USER STATE (favorites / recents)
  // ------------------------------------------------------------------
  async getState(companyId: string, userId: string) {
    const rows = await this.prisma.reportUserState.findMany({ where: { companyId, userId } });
    const fav = rows.find((r) => r.key === 'favorites');
    const rec = rows.find((r) => r.key === 'recents');
    return { favorites: (fav?.value as string[]) || [], recents: (rec?.value as string[]) || [] };
  }

  async toggleFavorite(companyId: string, userId: string, reportId: string) {
    const state = await this.getState(companyId, userId);
    const favorites = state.favorites.includes(reportId) ? state.favorites.filter((f) => f !== reportId) : [...state.favorites, reportId];
    await this.prisma.reportUserState.upsert({
      where: { companyId_userId_key: { companyId, userId, key: 'favorites' } },
      update: { value: favorites },
      create: { companyId, userId, key: 'favorites', value: favorites },
    });
    return { favorites };
  }

  async addRecent(companyId: string, userId: string, reportId: string) {
    const state = await this.getState(companyId, userId);
    const recents = [reportId, ...state.recents.filter((r) => r !== reportId)].slice(0, 5);
    await this.prisma.reportUserState.upsert({
      where: { companyId_userId_key: { companyId, userId, key: 'recents' } },
      update: { value: recents },
      create: { companyId, userId, key: 'recents', value: recents },
    });
    return { recents };
  }
}
