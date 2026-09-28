'use client';
import { api } from '@/lib/api';
import { itemSelectorSubtitle, itemTypeLabel } from '@/lib/item-type';

/**
 * Shared customer → document hydration used by Quote, Sales Order and Invoice forms
 * (manual selection and Customer Details entry points behave identically).
 */

/** Clean multi-line address from the structured customer master fields. */
export function formatCustomerAddress(c: any): string | null {
  if (!c) return null;
  const street = [c.address1, c.address2].map((x: any) => String(x || '').trim()).filter(Boolean).join(', ');
  const locality = [c.city, c.state].map((x: any) => String(x || '').trim()).filter(Boolean).join(', ');
  const zipLine = [locality, String(c.zip || '').trim()].filter(Boolean).join(' ');
  const lines = [street, zipLine, String(c.country || '').trim()].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

export type CustomerDocDefaults = {
  customerId: string;
  displayName: string;
  email: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  terms: string | null;
  taxStatus: string;
  defaultTaxRate: number;
  priceList: { id: string; name: string; currency: string } | null;
};

/** One hydration path for every sales document form. */
export async function fetchCustomerDocumentDefaults(customerId: string): Promise<CustomerDocDefaults | null> {
  try { return await api(`/sales/customers/${customerId}/document-defaults`); } catch { return null; }
}

function plainString(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

export type ApplyCustomerDefaultsOpts = { shipping?: boolean; addressField?: string };

/** Write only primitive strings/numbers so rc-field-form isEqual does not walk circular objects (Decimal, dayjs, etc.). */
export function applyCustomerDefaultsToForm(
  form: { setFieldsValue: (v: Record<string, string | number>) => void },
  d: CustomerDocDefaults | null,
  c?: any,
  opts?: ApplyCustomerDefaultsOpts,
) {
  const addressField = opts?.addressField || 'billingAddress';
  const email = plainString(d?.email ?? c?.email);
  const billing = plainString(d?.billingAddress) || formatCustomerAddress(c) || undefined;
  const shipping = opts?.shipping ? (plainString(d?.shippingAddress) || billing || 'Same as Billing') : undefined;
  const terms = plainString(d?.terms ?? c?.paymentTerms);
  const phone = plainString((d as any)?.phone ?? c?.phone);
  const tax = Number(d?.defaultTaxRate ?? c?.defaultTaxRate);

  const patch: Record<string, string | number> = {};
  if (email) patch.email = email;
  if (billing) patch[addressField] = billing;
  if (shipping) patch.shippingAddress = shipping;
  if (terms) patch.terms = terms;
  if (Number.isFinite(tax) && tax !== 0) patch.taxRateId = tax;
  if (phone) patch.phone = phone;
  if (Object.keys(patch).length) form.setFieldsValue(patch);
}

export async function hydrateCustomerDocumentDefaults(
  customerId: string,
  form: { setFieldsValue: (v: Record<string, string | number>) => void },
  customers: any[] | undefined,
  opts?: ApplyCustomerDefaultsOpts,
) {
  const c = (customers || []).find((x: any) => x.id === customerId);
  const d = await fetchCustomerDocumentDefaults(customerId);
  applyCustomerDefaultsToForm(form, d, c, opts);
}

export type ResolvedProductPrice = {
  price: number | null;
  source: 'PRICE_LIST' | 'DEFAULT_SALES_PRICE' | 'NONE';
  priceListName?: string;
  currency: string;
  warning: string | null;
};

/** Authoritative product → Rate resolution (backend PricingService). */
export async function resolveProductPrice(customerId: string | null | undefined, itemId: string, currency?: string | null, quantity?: number): Promise<ResolvedProductPrice> {
  const q = new URLSearchParams({ itemId });
  if (customerId) q.set('customerId', customerId);
  if (currency) q.set('currency', currency);
  if (quantity) q.set('quantity', String(quantity));
  const res = await api(`/sales/pricing/resolve?${q.toString()}`);
  return { price: res.price, source: res.source, priceListName: res.priceListName, currency: res.currency, warning: res.source === 'NONE' ? `Sales price not configured for this product${currency ? ` in ${currency}` : ''}. Enter a rate manually if permitted.` : null };
}

/** Terms engine: Net 15/30/60 → due date. */
export function dueDateFromTerms(terms: string | null | undefined, invoiceDate: any): any {
  if (!invoiceDate) return null;
  const d = typeof invoiceDate === 'string' ? new Date(invoiceDate) : invoiceDate?.toDate?.() || invoiceDate;
  if (!d || Number.isNaN(new Date(d).getTime())) return null;
  const t = String(terms || '').toLowerCase();
  const dayjsLike = new Date(d);
  if (t.includes('net 15')) { dayjsLike.setDate(dayjsLike.getDate() + 15); return dayjsLike; }
  if (t.includes('net 30')) { dayjsLike.setDate(dayjsLike.getDate() + 30); return dayjsLike; }
  if (t.includes('net 60')) { dayjsLike.setDate(dayjsLike.getDate() + 60); return dayjsLike; }
  return null;
}

/** Line defaults from the selected product (description / unit / qty seed).
 * Description is customer-facing name only — SKU stays in the Product column. */
export function productLineDefaults(item: any): { description: string; unit?: string; quantity: number } {
  return {
    description: (item?.description || item?.name || '').trim() || 'Item',
    unit: item?.unit || undefined,
    quantity: 1,
  };
}

/** Product/service dropdown options — SKU, name, and search text. */
export function productOptions(items: any[] | undefined, _currency = 'USD') {
  return (items || []).map((i: any) => {
    const skuPart = i.sku ? `${i.sku} ` : '';
    const subtitle = itemSelectorSubtitle(i.type);
    return {
      label: i.sku ? `${i.sku} · ${i.name || 'Item'}` : (i.name || 'Item'),
      value: i.id,
      item: i,
      searchLabel: `${skuPart}${i.name || ''} ${i.description || ''} ${subtitle}`,
      typeBadge: subtitle,
      typeLabel: itemTypeLabel(i.type),
    };
  });
}

/**
 * Resolve the full line patch when a product is selected (or changed).
 * - description/unit snapshot from the item master
 * - Rate from the PricingService (price list → default sales price); never cost
 * - warning when no sales price is configured (never silently $0)
 */
export async function resolveProductLinePatch(itemId: string, items: any[] | undefined, customerId?: string | null, currency?: string | null): Promise<{ patch: Record<string, any>; warning: string | null }> {
  const item = (items || []).find((i: any) => i.id === itemId);
  const base = productLineDefaults(item);
  const res = await resolveProductPrice(customerId, itemId, currency);
  const patch: Record<string, any> = { itemId, description: base.description, unit: base.unit, quantity: base.quantity };
  if (res.price != null) patch.unitPrice = res.price; // otherwise leave the current rate untouched and warn
  return { patch, warning: res.warning };
}

type MergeableLine = { key: number; itemId?: string; quantity: number; description?: string; unitPrice?: number; taxRate?: number };

/**
 * One product = one line (Xero/QB style). If the product is already on another line,
 * add this line's quantity into it and remove the duplicate row.
 */
export function mergeDuplicateProductLine<T extends MergeableLine>(
  lines: T[],
  key: number,
  itemId: string,
  emptyLine: () => T,
): { lines: T[]; merged: true; newQty: number } | { lines: T[]; merged: false } {
  if (!itemId) return { lines, merged: false };
  const existing = lines.find((l) => l.key !== key && l.itemId === itemId);
  if (!existing) return { lines, merged: false };
  const current = lines.find((l) => l.key === key);
  const addQty = Math.max(Number(current?.quantity || 1) || 1, 0.0001);
  const newQty = Number(existing.quantity || 0) + addQty;
  let next = lines
    .map((l) => (l.key === existing.key ? { ...l, quantity: newQty } : l))
    .filter((l) => l.key !== key) as T[];
  if (!next.length) next = [emptyLine()];
  return { lines: next, merged: true, newQty };
}
