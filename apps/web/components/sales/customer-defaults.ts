'use client';
import { api } from '@/lib/api';

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

/** Line defaults from the selected product (description / unit / qty seed). */
export function productLineDefaults(item: any): { description: string; unit?: string; quantity: number } {
  return {
    description: [item?.sku ? `${item.sku}` : null, item?.description || item?.name].filter(Boolean).join(' — ') || item?.name || '',
    unit: item?.unit || undefined,
    quantity: 1,
  };
}

/** Improved product dropdown option: product name only (clean labels on quote/order/invoice lines). */
export function productOptions(items: any[] | undefined, currency = 'USD') {
  return (items || []).map((i: any) => ({
    label: i.name,
    value: i.id,
    item: i,
  }));
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
