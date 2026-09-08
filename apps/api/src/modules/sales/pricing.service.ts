import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { round2 } from '../performance/performance.constants';

export type ResolvedPrice = {
  price: number | null;
  source: 'CUSTOMER_PRICE' | 'CUSTOMER_PRICE_LIST' | 'DATE_EFFECTIVE_LIST' | 'DEFAULT_SALES_PRICE' | 'COMPANY_DEFAULT' | 'NONE';
  priceListName?: string;
  currency: string;
};

/**
 * Authoritative sales pricing resolution.
 * Sequence:
 *  1. Customer-specific price (assigned customer price list item)
 *  2. Customer assigned price list (date-effective)
 *  3. Any other valid date-effective product/list price
 *  4. Product selling price
 *  5. Company default selling price (none configured → NONE)
 * Inventory cost is NEVER used for the sales Rate.
 */
@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

  private inWindow(list: { effectiveFrom?: Date | null; effectiveTo?: Date | null }, at: Date) {
    if (list.effectiveFrom && new Date(list.effectiveFrom) > at) return false;
    if (list.effectiveTo && new Date(list.effectiveTo) < at) return false;
    return true;
  }

  async resolve(companyId: string, opts: { customerId?: string | null; itemId: string; currency?: string | null; quantity?: number | null; at?: Date | null }): Promise<ResolvedPrice> {
    const currency = (opts.currency || 'USD').toUpperCase();
    const at = opts.at || new Date();
    const item = await this.prisma.inventoryItem.findFirst({ where: { id: opts.itemId, companyId } });
    if (!item) return { price: null, source: 'NONE', currency };

    const pick = (rows: any[], source: ResolvedPrice['source']): ResolvedPrice | null => {
      const matching = rows
        .filter((li) => (li.priceList.currency || 'USD').toUpperCase() === currency)
        .filter((li) => this.inWindow(li.priceList, at))
        .filter((li) => !li.minQty || !opts.quantity || Number(opts.quantity) >= Number(li.minQty))
        .filter((li) => Number(li.price) > 0)
        .sort((a, b) => Number(b.minQty || 0) - Number(a.minQty || 0));
      if (!matching.length) return null;
      return { price: round2(Number(matching[0].price)), source, priceListName: matching[0].priceList.name, currency };
    };

    if (opts.customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: opts.customerId, companyId } });
      if (customer?.priceListId) {
        const assigned = await this.prisma.priceListItem.findMany({
          where: { itemId: item.id, priceListId: customer.priceListId, priceList: { companyId, active: true } },
          include: { priceList: true },
        });
        const fromAssigned = pick(assigned, 'CUSTOMER_PRICE');
        if (fromAssigned) return fromAssigned;
        // Same list, even if window filtering emptied min-qty matches — still try without min qty as assigned list.
        const anyAssigned = assigned.filter((li) => Number(li.price) > 0 && this.inWindow(li.priceList, at));
        if (anyAssigned.length) return { price: round2(Number(anyAssigned[0].price)), source: 'CUSTOMER_PRICE_LIST', priceListName: anyAssigned[0].priceList.name, currency };
      }
    }

    const dated = await this.prisma.priceListItem.findMany({
      where: { itemId: item.id, priceList: { companyId, active: true } },
      include: { priceList: true },
    });
    const fromDated = pick(dated, 'DATE_EFFECTIVE_LIST');
    if (fromDated) return fromDated;

    if (item.sellingPrice != null && Number(item.sellingPrice) > 0) {
      return { price: round2(Number(item.sellingPrice)), source: 'DEFAULT_SALES_PRICE', currency };
    }

    return { price: null, source: 'NONE', currency };
  }

  async resolveLinePrices(companyId: string, opts: { customerId?: string | null; currency?: string | null; lines: any[] }): Promise<{ lines: any[]; unresolved: string[] }> {
    const unresolved: string[] = [];
    for (const l of opts.lines) {
      if (!l.itemId) continue;
      if (l.unitPrice != null && Number(l.unitPrice) > 0) continue;
      const res = await this.resolve(companyId, { customerId: opts.customerId, itemId: l.itemId, currency: opts.currency, quantity: Number(l.quantity || 1) });
      if (res.price != null) { l.unitPrice = res.price; l.priceSource = res.source; }
      else unresolved.push(l.description || l.itemId);
    }
    return { lines: opts.lines, unresolved };
  }

  async documentDefaults(companyId: string, customerId: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, companyId } });
    if (!c) return null;
    const priceList = c.priceListId ? await this.prisma.priceList.findFirst({ where: { id: c.priceListId, companyId, active: true }, select: { id: true, name: true, currency: true } }) : null;
    const billingAddress = [c.address1, c.address2, c.city, c.state, c.zip, c.country].filter((x) => String(x || '').trim()).join(', ');
    return {
      customerId: c.id,
      displayName: c.name,
      email: c.email || null,
      phone: c.phone || null,
      billingAddress: billingAddress || null,
      shippingAddress: billingAddress || null,
      terms: c.paymentTerms || null,
      taxStatus: c.taxStatus || 'Taxable',
      defaultTaxRate: Number(c.defaultTaxRate || 0),
      priceList: priceList || null,
    };
  }
}
