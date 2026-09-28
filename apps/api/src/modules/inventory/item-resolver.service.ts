import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PricingService } from '../sales/pricing.service';
import { isStockTracked, normalizeItemType } from './item-type';

type AccountRef = { id: string; code: string; name: string } | null;

/**
 * Single source of truth for resolving an item's commercial + accounting defaults
 * for purchase and sale documents. No other module should re-implement this
 * policy (PO, bill, invoice and stock paths all call this resolver).
 *
 * Priority is enforced by the CALLER: document override > price arrangement
 * (PricingService) > item master default. This service returns the item-master
 * and price-list defaults and validates that any configured account belongs to
 * the company and is of the correct type.
 */
@Injectable()
export class ItemResolverService {
  constructor(private prisma: PrismaService, private pricing: PricingService) {}

  private async account(companyId: string, id: string | null | undefined, allowed: string[], label: string): Promise<AccountRef> {
    if (!id) return null;
    const acc = await this.prisma.ledgerAccount.findFirst({ where: { id, companyId } });
    if (!acc) throw new BadRequestException(`${label} account was not found for this company.`);
    if (!allowed.includes(String(acc.type).toUpperCase())) {
      throw new BadRequestException(`${label} account must be a ${allowed.join(' / ')} account (got ${acc.code} ${acc.name}).`);
    }
    return { id: acc.id, code: acc.code, name: acc.name };
  }

  /** Purchase-side defaults. Stock items debit Inventory Asset; others debit Expense/COGS. */
  async resolveForPurchase(companyId: string, itemId: string) {
    const item = await this.prisma.inventoryItem.findFirst({ where: { id: itemId, companyId } });
    if (!item) throw new BadRequestException('Product not found for this company.');
    const itemType = normalizeItemType(item.type);
    const stock = isStockTracked(itemType);
    const debit = stock
      ? await this.account(companyId, item.inventoryAssetAccountId, ['ASSET'], 'Inventory Asset')
      : await this.account(companyId, item.expenseAccountId, ['EXPENSE'], 'Purchase/Expense');
    const cogs = stock ? await this.account(companyId, item.cogsAccountId, ['EXPENSE'], 'COGS') : null;
    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      itemType,
      stockTracked: stock,
      description: item.purchaseDescription || item.description || item.name,
      unit: item.purchaseUnit || item.unit,
      unitCost: Number(item.purchaseCost || 0),
      taxCode: item.purchaseTaxCode || null,
      accountId: debit?.id ?? null,
      accountCode: debit?.code ?? null,
      inventoryAssetAccountId: stock ? (debit?.id ?? null) : null,
      cogsAccountId: cogs?.id ?? null,
      cogsAccountCode: cogs?.code ?? null,
      preferredSupplierId: item.preferredSupplierId || null,
      supplierSku: item.supplierSku || null,
    };
  }

  /** Sale-side defaults. Price resolves via PricingService (never inventory cost). */
  async resolveForSale(companyId: string, itemId: string, opts: { customerId?: string | null; currency?: string | null; quantity?: number | null } = {}) {
    const item = await this.prisma.inventoryItem.findFirst({ where: { id: itemId, companyId } });
    if (!item) throw new BadRequestException('Product not found for this company.');
    const itemType = normalizeItemType(item.type);
    const stock = isStockTracked(itemType);
    const income = await this.account(companyId, item.incomeAccountId, ['REVENUE'], 'Income/Sales');
    const cogs = stock ? await this.account(companyId, item.cogsAccountId, ['EXPENSE'], 'COGS') : null;
    const asset = stock ? await this.account(companyId, item.inventoryAssetAccountId, ['ASSET'], 'Inventory Asset') : null;
    const price = await this.pricing.resolve(companyId, { customerId: opts.customerId, itemId: item.id, currency: opts.currency, quantity: opts.quantity });
    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      itemType,
      stockTracked: stock,
      description: item.salesDescription || item.description || item.name,
      unit: item.salesUnit || item.unit,
      unitPrice: price.price,
      priceSource: price.source,
      currency: price.currency,
      taxCode: item.salesTaxCode || null,
      incomeAccountId: income?.id ?? null,
      incomeAccountCode: income?.code ?? null,
      cogsAccountId: cogs?.id ?? null,
      inventoryAssetAccountId: asset?.id ?? null,
    };
  }

  /**
   * Fill purchase-document line defaults from the item master. Never overwrites a
   * value already supplied on the line (document override wins).
   */
  async applyPurchaseDefaults(companyId: string, lines: any[]) {
    for (const l of lines) {
      if (!l.itemId) continue;
      const d = await this.resolveForPurchase(companyId, l.itemId);
      if (!String(l.description || '').trim()) l.description = d.description;
      if (l.unitPrice == null || Number(l.unitPrice) <= 0) l.unitPrice = d.unitCost;
      if (!l.unit) l.unit = d.unit;
      if (!l.taxCode) l.taxCode = d.taxCode;
      if (!l.accountId && d.accountId) { l.accountId = d.accountId; l.accountCode = d.accountCode; }
      l.itemType = d.itemType;
    }
    return lines;
  }

  /**
   * Fill sales-document line defaults from the item master. Never overwrites a
   * supplied description/unit/tax. Price resolution stays with PricingService.
   */
  async applySalesDefaults(companyId: string, opts: { customerId?: string | null; currency?: string | null; lines: any[] }) {
    for (const l of opts.lines) {
      if (!l.itemId) continue;
      const d = await this.resolveForSale(companyId, l.itemId, { customerId: opts.customerId, currency: opts.currency, quantity: Number(l.quantity || 1) });
      if (!String(l.description || '').trim()) l.description = d.description;
      if (!l.unit) l.unit = d.unit;
      if (!l.taxCode) l.taxCode = d.taxCode;
      l.itemType = d.itemType;
    }
    return opts.lines;
  }
}
