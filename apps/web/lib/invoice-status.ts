/**
 * Xero / QuickBooks-style invoice status for lists, edit header, and related docs.
 *
 * Lifecycle:
 *   Draft → (Save & send / Save & post) → Awaiting Payment → Part Paid / Paid / Overdue
 *   Void anytime after post (via void action)
 *
 * Drafts never show as Unpaid — they are not yet AR.
 */
export function invoiceDisplayStatus(r: {
  invoiceStatus?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
} | null | undefined): string {
  const life = String(r?.invoiceStatus || r?.status || '').toUpperCase();
  if (life === 'DRAFT') return 'DRAFT';
  if (life === 'VOID') return 'VOID';
  const pay = String(r?.paymentStatus || 'UNPAID').toUpperCase();
  if (pay === 'PAID') return 'PAID';
  if (pay === 'PARTIALLY_PAID' || pay === 'PART_PAID') return 'PARTIALLY PAID';
  if (pay === 'OVERDUE') return 'OVERDUE';
  return 'AWAITING PAYMENT';
}

export function isInvoiceDraft(r: { invoiceStatus?: string | null; status?: string | null } | null | undefined): boolean {
  return String(r?.invoiceStatus || r?.status || '').toUpperCase() === 'DRAFT';
}
