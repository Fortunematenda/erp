// Central invoice status resolver — the ONE source of truth for how an invoice's
// status is presented in Preview, Print and PDF. Used by the DocumentViewModel so
// all three outputs stay identical.

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  PENDING: 'PENDING',
  POSTED: 'POSTED',
  PART_PAID: 'PART PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  VOID: 'VOID',
};

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  DRAFT: '#64748b',
  OPEN: '#0284c7',
  PENDING: '#f59e0b',
  POSTED: '#0284c7',
  PART_PAID: '#0284c7',
  PAID: '#16a34a',
  OVERDUE: '#dc2626',
  VOID: '#b91c1c',
};

export interface ResolvedStatus { status: string; label: string; color: string; }

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export function resolveInvoiceStatus(inv: { status?: string; dueDate?: Date | string | null; total?: any }, paid: number): ResolvedStatus {
  const raw = (inv?.status || 'DRAFT').toUpperCase();
  const total = Number(inv?.total || 0);
  const balance = total - (Number(paid) || 0);
  const overdue = !!inv?.dueDate && new Date(inv.dueDate) < startOfToday() && balance > 0.005;

  let status: string;
  if (raw === 'VOID') status = 'VOID';
  else if (raw === 'DRAFT') status = 'DRAFT';
  else if (raw === 'PAID' || balance <= 0.005) status = 'PAID';
  else if (overdue) status = 'OVERDUE';
  else if (raw === 'PART_PAID' || (balance < total)) status = 'PART_PAID';
  else status = 'PENDING';

  return { status, label: INVOICE_STATUS_LABELS[status] || status, color: INVOICE_STATUS_COLORS[status] || '#6b7280' };
}
