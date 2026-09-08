import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PricingService } from './pricing.service';
import { AuditService } from '../../core/common/audit.service';

export const INVOICE_FINANCIAL_LOCK = new Set([
  'POSTED',
  'FISCALISATION_PENDING',
  'FISCALISED',
  'PARTIALLY_PAID',
  'PART_PAID',
  'PAID',
  'VOID',
  'CREDITED',
]);

export const POSTED_INVOICE_EDIT_MESSAGE = 'Posted invoices cannot be edited. Create a credit note or corrective document instead.';

const SAFE_INVOICE_META = new Set(['notes', 'statementMemo', 'customerReference', 'poReference']);

@Injectable()
export class SalesIntegrityService {
  constructor(private prisma: PrismaService, private pricing: PricingService, private audit: AuditService) {}

  validateLines(lines: any[], kind = 'line') {
    if (!Array.isArray(lines) || !lines.length) throw new BadRequestException({ message: 'At least one line is required', errors: { lines: ['At least one line is required'] } });
    const errors: Record<string, string[]> = {};
    lines.forEach((l, i) => {
      const prefix = `lines.${i}`;
      const qty = Number(l.quantity);
      const rate = Number(l.unitPrice);
      const tax = Number(l.taxRate || 0);
      const discount = Number(l.discount || 0);
      if (!(qty > 0)) errors[`${prefix}.quantity`] = ['Quantity must be greater than 0'];
      if (!(rate >= 0) || Number.isNaN(rate)) errors[`${prefix}.unitPrice`] = ['Rate must be greater than or equal to 0'];
      if (!(tax >= 0) || tax > 100) errors[`${prefix}.taxRate`] = ['Tax rate must be between 0 and 100'];
      if (discount < 0) errors[`${prefix}.discount`] = ['Discount cannot be negative'];
      const net = qty * rate;
      if (discount > net + 0.001) errors[`${prefix}.discount`] = ['Discount cannot exceed line net amount'];
      if (!String(l.description || '').trim() && !l.itemId) errors[`${prefix}.description`] = [`${kind} description is required`];
    });
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Validation failed', errors });
  }

  async assertCustomer(companyId: string, customerId?: string | null, opts?: { required?: boolean; mustBeActive?: boolean }) {
    if (!customerId) {
      if (opts?.required) throw new BadRequestException({ message: 'Customer is required', errors: { customerId: ['Customer is required'] } });
      return null;
    }
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, companyId } });
    if (!c) throw new BadRequestException({ message: 'Customer not found', errors: { customerId: ['Customer must exist and belong to the current company'] } });
    if ((opts?.mustBeActive ?? true) && c.status && c.status !== 'ACTIVE') {
      throw new BadRequestException({ message: 'Customer is deactivated and cannot be used', errors: { customerId: ['Customer is deactivated'] } });
    }
    return c;
  }

  async assertProducts(companyId: string, lines: any[]) {
    const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean))];
    if (!ids.length) return [];
    const items = await this.prisma.inventoryItem.findMany({ where: { id: { in: ids }, companyId } });
    const found = new Set(items.map((i) => i.id));
    const errors: Record<string, string[]> = {};
    lines.forEach((l, i) => {
      if (l.itemId && !found.has(l.itemId)) errors[`lines.${i}.itemId`] = ['Product must exist and belong to the current company'];
      const item = items.find((x) => x.id === l.itemId);
      if (item && Number(item.sellingPrice) < 0) errors[`lines.${i}.unitPrice`] = ['Product selling price cannot be negative'];
    });
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Validation failed', errors });
    return items;
  }

  async assertWarehouse(companyId: string, warehouseId?: string | null) {
    if (!warehouseId) return null;
    const w = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, companyId } });
    if (!w) throw new BadRequestException({ message: 'Warehouse not found', errors: { warehouseId: ['Warehouse must belong to the current company'] } });
    return w;
  }

  async assertCurrency(companyId: string, code?: string | null) {
    if (!code) return 'USD';
    const currency = code.toUpperCase();
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrency: true } });
    if (company?.baseCurrency && company.baseCurrency.toUpperCase() === currency) return currency;
    const configured = await this.prisma.currency.findFirst({ where: { companyId, code: currency, active: true } });
    if (configured) return currency;
    const any = await this.prisma.currency.count({ where: { companyId } });
    if (!any && ['USD', 'ZWG', 'ZAR', 'EUR', 'GBP'].includes(currency)) return currency;
    throw new BadRequestException({ message: 'Invalid currency', errors: { currency: [`Currency ${currency} is not configured for this company`] } });
  }

  async applyPricing(companyId: string, opts: { customerId?: string | null; currency?: string | null; lines: any[]; allowZeroWithoutItem?: boolean }) {
    const { unresolved } = await this.pricing.resolveLinePrices(companyId, opts);
    if (unresolved.length) {
      throw new BadRequestException({
        message: `No selling price configured for: ${unresolved.join(', ')}. Set a customer price, price list, or product selling price. Cost is never used.`,
        errors: { 'lines.unitPrice': unresolved.map((d) => `No selling price for ${d}`) },
      });
    }
    for (const l of opts.lines) {
      if (l.itemId && Number(l.unitPrice) <= 0 && !opts.allowZeroWithoutItem) {
        throw new BadRequestException({
          message: 'Product lines require a selling price greater than zero',
          errors: { unitPrice: ['Do not silently save a zero rate because a price lookup failed'] },
        });
      }
    }
    return opts.lines;
  }

  /**
   * Historical commercial tax must be preserved. New tax config is only a last resort
   * for documents that never stored a rate.
   */
  async resolveTaxRate(companyId: string, ctx: {
    taxRate?: number | null;
    salesOrderLine?: { taxRate?: any } | null;
    quoteLine?: { taxRate?: any } | null;
    itemId?: string | null;
    customerId?: string | null;
  }): Promise<number> {
    const stored = [ctx.taxRate, ctx.salesOrderLine?.taxRate, ctx.quoteLine?.taxRate]
      .map((v) => (v == null ? null : Number(v)))
      .find((v) => v != null && !Number.isNaN(v));
    if (stored != null) return stored;
    if (ctx.itemId) {
      const item = await this.prisma.inventoryItem.findFirst({ where: { id: ctx.itemId, companyId } });
      if (item?.salesTaxCode) {
        const tr = await this.prisma.taxRate.findFirst({ where: { companyId, OR: [{ code: item.salesTaxCode }, { taxCode: item.salesTaxCode }], active: true } });
        if (tr) return Number(tr.rate);
      }
    }
    if (ctx.customerId) {
      const c = await this.prisma.customer.findFirst({ where: { id: ctx.customerId, companyId } });
      if (c && Number(c.defaultTaxRate) > 0) return Number(c.defaultTaxRate);
    }
    const def = await this.prisma.taxRate.findFirst({ where: { companyId, isDefault: true, active: true } });
    if (def) return Number(def.rate);
    const cfg = await this.prisma.systemConfig.findFirst({ where: { companyId, key: 'cfg.finance.defaultTaxRate' } });
    const v = Number((cfg?.value as any)?.value ?? cfg?.value ?? 0);
    return Number.isFinite(v) ? v : 0;
  }

  isInvoiceFinanciallyLocked(inv: { status?: string; invoiceStatus?: string; paymentStatus?: string; fiscalStatus?: string }): boolean {
    const lifecycle = String(inv.invoiceStatus || inv.status || '').toUpperCase();
    if (INVOICE_FINANCIAL_LOCK.has(lifecycle)) return true;
    const fiscal = String(inv.fiscalStatus || '').toUpperCase();
    if (['FISCALISED', 'SUBMITTED', 'PENDING'].includes(fiscal) && lifecycle !== 'DRAFT') return true;
    const pay = String(inv.paymentStatus || '').toUpperCase();
    if (['PAID', 'PARTIALLY_PAID', 'PART_PAID'].includes(pay) && lifecycle !== 'DRAFT') return true;
    return false;
  }

  assertInvoiceEditable(inv: any, body: any, userId?: string, companyId?: string) {
    if (!this.isInvoiceFinanciallyLocked(inv)) return 'FULL';
    const keys = Object.keys(body || {}).filter((k) => body[k] !== undefined);
    const financial = keys.filter((k) => !SAFE_INVOICE_META.has(k));
    if (financial.length) {
      if (companyId) {
        void this.audit.log(companyId, userId, 'INVOICE_EDIT_REJECTED', 'SalesInvoice', inv.id, {
          module: 'sales',
          result: 'DENIED',
          reason: POSTED_INVOICE_EDIT_MESSAGE,
          metadata: { invoiceNo: inv.invoiceNo, invoiceStatus: inv.invoiceStatus, attempted: financial },
        });
      }
      throw new ConflictException(POSTED_INVOICE_EDIT_MESSAGE);
    }
    return 'META';
  }
}
