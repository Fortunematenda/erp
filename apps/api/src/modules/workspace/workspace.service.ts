import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

type SearchResult = {
  id: string;
  type: string;
  title: string;
  subtitle?: string | null;
  href: string;
  keywords?: string[];
};

type ActionItem = {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  title: string;
  description?: string | null;
  href: string;
  createdAt?: Date | string | null;
  sourceId?: string | null;
  sourceType?: string | null;
};

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async search(companyId: string, rawQuery: string, rawLimit = 8) {
    const q = String(rawQuery || '').trim();
    const limit = Math.min(Math.max(rawLimit, 1), 12);
    if (q.length < 2) return { query: q, results: [] as SearchResult[] };

    const contains = { contains: q, mode: 'insensitive' as const };
    const [customers, suppliers, items, invoices, quotes, orders, employees] = await Promise.all([
      this.prisma.customer.findMany({
        where: { companyId, OR: [{ name: contains }, { code: contains }, { email: contains }, { companyName: contains }] },
        select: { id: true, code: true, name: true, email: true, companyName: true }, take: limit,
      }),
      this.prisma.supplier.findMany({
        where: { companyId, OR: [{ name: contains }, { code: contains }, { email: contains }, { companyName: contains }] },
        select: { id: true, code: true, name: true, email: true }, take: limit,
      }),
      this.prisma.inventoryItem.findMany({
        where: { companyId, active: true, OR: [{ name: contains }, { sku: contains }, { barcode: contains }, { brand: contains }] },
        select: { id: true, sku: true, name: true, unit: true }, take: limit,
      }),
      this.prisma.salesInvoice.findMany({
        where: { companyId, OR: [{ invoiceNo: contains }, { customer: { name: contains } }, { customerReference: contains }, { poReference: contains }] },
        select: { id: true, invoiceNo: true, total: true, currency: true, status: true, customer: { select: { name: true } } }, take: limit,
      }),
      this.prisma.quotation.findMany({
        where: { companyId, OR: [{ quotationNo: contains }, { customer: { name: contains } }] },
        select: { id: true, quotationNo: true, total: true, currency: true, status: true, customer: { select: { name: true } } }, take: limit,
      }),
      this.prisma.salesOrder.findMany({
        where: { companyId, OR: [{ orderNo: contains }, { customer: { name: contains } }] },
        select: { id: true, orderNo: true, total: true, currency: true, status: true, customer: { select: { name: true } } }, take: limit,
      }),
      this.prisma.employee.findMany({
        where: { companyId, OR: [{ employeeNo: contains }, { firstName: contains }, { lastName: contains }, { workEmail: contains }, { email: contains }] },
        select: { id: true, employeeNo: true, firstName: true, lastName: true, position: true, workEmail: true }, take: limit,
      }),
    ]);

    const results: SearchResult[] = [
      ...customers.map((r) => ({ id: r.id, type: 'Customer', title: r.name, subtitle: [r.code, r.companyName, r.email].filter(Boolean).join(' · '), href: `/sales/customers/${r.id}` })),
      ...suppliers.map((r) => ({ id: r.id, type: 'Supplier', title: r.name, subtitle: [r.code, r.email].filter(Boolean).join(' · '), href: `/procurement?tab=suppliers&supplierId=${r.id}` })),
      ...items.map((r) => ({ id: r.id, type: 'Product', title: r.name, subtitle: [r.sku, r.unit].filter(Boolean).join(' · '), href: `/inventory?itemId=${r.id}` })),
      ...invoices.map((r) => ({ id: r.id, type: 'Invoice', title: r.invoiceNo, subtitle: [r.customer?.name, r.status, `${r.currency} ${Number(r.total).toFixed(2)}`].filter(Boolean).join(' · '), href: `/sales/invoices?invoiceId=${r.id}` })),
      ...quotes.map((r) => ({ id: r.id, type: 'Quotation', title: r.quotationNo, subtitle: [r.customer?.name, r.status, `${r.currency} ${Number(r.total).toFixed(2)}`].filter(Boolean).join(' · '), href: `/sales/quotations?quotationId=${r.id}` })),
      ...orders.map((r) => ({ id: r.id, type: 'Sales Order', title: r.orderNo, subtitle: [r.customer?.name, r.status, `${r.currency} ${Number(r.total).toFixed(2)}`].filter(Boolean).join(' · '), href: `/sales/orders?orderId=${r.id}` })),
      ...employees.map((r) => ({ id: r.id, type: 'Employee', title: `${r.firstName} ${r.lastName}`.trim(), subtitle: [r.employeeNo, r.position, r.workEmail].filter(Boolean).join(' · '), href: `/hr/employees/${r.id}` })),
    ];

    return { query: q, results: results.slice(0, limit * 3) };
  }

  async actionCenter(companyId: string, userId?: string | null) {
    const now = new Date();
    const quoteLimit = new Date(now.getTime() + 7 * 86400000);

    const [overdueInvoices, approvals, fiscalFailures, perfNotifications, expiringQuotes, reorderItems, movementGroups] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: { companyId, dueDate: { lt: now }, balanceDue: { gt: 0 }, status: { notIn: ['PAID', 'VOID'] } },
        include: { customer: { select: { name: true } } }, orderBy: { dueDate: 'asc' }, take: 8,
      }),
      this.prisma.approvalRequest.findMany({
        where: { companyId, status: 'SUBMITTED' }, orderBy: { submittedAt: 'asc' }, take: 8,
      }),
      this.prisma.fiscalReceipt.findMany({
        where: { device: { branch: { companyId } }, status: { in: ['REJECTED', 'RETRY'] } },
        include: { invoice: { select: { invoiceNo: true } }, creditNote: { select: { creditNoteNo: true } }, debitNote: { select: { debitNoteNo: true } } },
        orderBy: { createdAt: 'desc' }, take: 8,
      }),
      this.prisma.performanceNotification.findMany({
        where: { companyId, userId: userId || undefined, readAt: null }, orderBy: { createdAt: 'desc' }, take: 8,
      }),
      this.prisma.quotation.findMany({
        where: { companyId, validUntil: { gte: now, lte: quoteLimit }, status: { notIn: ['CONVERTED', 'CANCELLED', 'REJECTED', 'EXPIRED'] } },
        include: { customer: { select: { name: true } } }, orderBy: { validUntil: 'asc' }, take: 8,
      }),
      this.prisma.inventoryItem.findMany({ where: { companyId, active: true, reorderLevel: { gt: 0 } }, select: { id: true, sku: true, name: true, reorderLevel: true }, take: 200 }),
      this.prisma.stockMovement.groupBy({
        by: ['itemId', 'type'],
        where: { item: { companyId } },
        _sum: { quantity: true },
      }),
    ]);

    const stock = new Map<string, number>();
    const positive = new Set(['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN']);
    for (const row of movementGroups) {
      const qty = Number(row._sum.quantity || 0) * (positive.has(row.type) ? 1 : -1);
      stock.set(row.itemId, (stock.get(row.itemId) || 0) + qty);
    }
    const lowStock = reorderItems
      .map((i) => ({ ...i, onHand: stock.get(i.id) || 0 }))
      .filter((i) => i.onHand <= Number(i.reorderLevel))
      .sort((a, b) => (a.onHand - Number(a.reorderLevel)) - (b.onHand - Number(b.reorderLevel)))
      .slice(0, 8);

    const items: ActionItem[] = [
      ...fiscalFailures.map((r) => ({ id: `fiscal:${r.id}`, kind: 'FISCAL_FAILURE', severity: 'critical' as const, title: `Fiscalisation needs attention`, description: `${r.invoice?.invoiceNo || r.creditNote?.creditNoteNo || r.debitNote?.debitNoteNo || `Receipt ${r.globalReceiptNo}`}${r.lastError ? ` · ${r.lastError}` : ''}`, href: '/fiscalisation', createdAt: r.createdAt, sourceId: r.id, sourceType: 'FiscalReceipt' })),
      ...overdueInvoices.map((r) => ({ id: `invoice:${r.id}`, kind: 'OVERDUE_INVOICE', severity: 'critical' as const, title: `${r.invoiceNo} is overdue`, description: `${r.customer?.name || 'Customer'} · ${r.currency} ${Number(r.balanceDue).toFixed(2)} outstanding`, href: `/sales/invoices?invoiceId=${r.id}`, createdAt: r.dueDate, sourceId: r.id, sourceType: 'SalesInvoice' })),
      ...approvals.map((r) => ({ id: `approval:${r.id}`, kind: 'PENDING_APPROVAL', severity: 'warning' as const, title: `${r.documentType} awaiting approval`, description: `${r.documentNo || 'Document'} · ${Number(r.amount).toFixed(2)}`, href: '/administration/my-approvals', createdAt: r.submittedAt, sourceId: r.id, sourceType: 'ApprovalRequest' })),
      ...lowStock.map((r) => ({ id: `stock:${r.id}`, kind: 'LOW_STOCK', severity: 'warning' as const, title: `${r.name} is low on stock`, description: `${r.sku} · ${r.onHand.toFixed(2)} on hand · reorder level ${Number(r.reorderLevel).toFixed(2)}`, href: `/inventory?itemId=${r.id}`, sourceId: r.id, sourceType: 'InventoryItem' })),
      ...expiringQuotes.map((r) => ({ id: `quote:${r.id}`, kind: 'QUOTE_EXPIRING', severity: 'info' as const, title: `${r.quotationNo} expires soon`, description: `${r.customer?.name || 'Customer'} · valid until ${r.validUntil?.toISOString().slice(0, 10)}`, href: `/sales/quotations?quotationId=${r.id}`, createdAt: r.validUntil, sourceId: r.id, sourceType: 'Quotation' })),
      ...perfNotifications.map((r) => ({ id: `performance:${r.id}`, kind: 'PERFORMANCE', severity: 'info' as const, title: r.title, description: r.body, href: r.link || '/performance', createdAt: r.createdAt, sourceId: r.id, sourceType: 'PerformanceNotification' })),
    ];

    const rank = { critical: 0, warning: 1, info: 2, success: 3 } as const;
    items.sort((a, b) => rank[a.severity] - rank[b.severity]);

    return {
      generatedAt: now.toISOString(),
      count: items.length,
      counts: {
        overdueInvoices: overdueInvoices.length,
        approvals: approvals.length,
        fiscalFailures: fiscalFailures.length,
        lowStock: lowStock.length,
        expiringQuotes: expiringQuotes.length,
        performance: perfNotifications.length,
      },
      items: items.slice(0, 30),
    };
  }
}
