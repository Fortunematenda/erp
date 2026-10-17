/** Money helpers. Amounts are rounded to cents, matching the rest of the ledger. */

export function roundMoney(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export type PricedLine = {
  net: number;
  tax: number;
  discount: number;
  total: number;
  exclusiveUnit: number;
};

export function priceLine(input: {
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
  taxInclusive?: boolean;
}): PricedLine {
  const qty = Number(input.quantity);
  if (!(qty > 0)) throw new Error('Quantity must be greater than zero');
  const unit = Number(input.unitPrice);
  if (unit < 0) throw new Error('Price cannot be negative');
  const gross = qty * unit;
  const discount = Math.min(Math.max(Number(input.discount || 0), 0), gross);
  const rate = Math.max(Number(input.taxRate || 0), 0);
  let net: number;
  let tax: number;
  if (input.taxInclusive && rate > 0) {
    const after = gross - discount;
    net = after / (1 + rate / 100);
    tax = after - net;
  } else {
    net = gross - discount;
    tax = net * (rate / 100);
  }
  const netR = roundMoney(net);
  const taxR = roundMoney(tax);
  return {
    net: netR,
    tax: taxR,
    discount: roundMoney(discount),
    total: roundMoney(netR + taxR),
    exclusiveUnit: qty ? roundMoney(netR / qty) : 0,
  };
}

export function sumLines(lines: PricedLine[], extra: { serviceCharge?: number; tip?: number } = {}) {
  const subtotal = roundMoney(lines.reduce((s, l) => s + l.net, 0));
  const taxTotal = roundMoney(lines.reduce((s, l) => s + l.tax, 0));
  const discountTotal = roundMoney(lines.reduce((s, l) => s + l.discount, 0));
  const serviceCharge = roundMoney(Number(extra.serviceCharge || 0));
  const tip = roundMoney(Number(extra.tip || 0));
  const total = roundMoney(subtotal + taxTotal + serviceCharge + tip);
  return { subtotal, taxTotal, discountTotal, serviceCharge, tip, total };
}

const CART = ['ACTIVE', 'HELD', 'ABANDONED'] as const;
const ORDER = ['OPEN', 'IN_PREPARATION', 'READY', 'COMPLETED', 'CANCELLED'] as const;
const SALE = ['DRAFT', 'PENDING_PAYMENT', 'POSTED', 'REVERSED'] as const;
const SHIFT = ['OPEN', 'CLOSING', 'CLOSED'] as const;
const KITCHEN = ['QUEUED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as const;

const EDGES: Record<string, Record<string, string[]>> = {
  cart: { ACTIVE: ['HELD', 'ABANDONED'], HELD: ['ACTIVE', 'ABANDONED'], ABANDONED: [] },
  order: {
    OPEN: ['IN_PREPARATION', 'CANCELLED', 'COMPLETED'],
    IN_PREPARATION: ['READY', 'CANCELLED', 'COMPLETED'],
    READY: ['COMPLETED', 'CANCELLED', 'IN_PREPARATION'],
    COMPLETED: [],
    CANCELLED: [],
  },
  sale: { DRAFT: ['PENDING_PAYMENT', 'POSTED'], PENDING_PAYMENT: ['POSTED'], POSTED: ['REVERSED'], REVERSED: [] },
  shift: { OPEN: ['CLOSING', 'CLOSED'], CLOSING: ['CLOSED', 'OPEN'], CLOSED: [] },
  kitchen: { QUEUED: ['PREPARING', 'CANCELLED'], PREPARING: ['READY', 'CANCELLED'], READY: ['COMPLETED'], COMPLETED: [], CANCELLED: [] },
};

export function assertTransition(family: keyof typeof EDGES, from: string, to: string) {
  if (from === to) return;
  const allowed = EDGES[family][from] || [];
  if (!allowed.includes(to)) throw new Error(`Cannot move ${family} from ${from} to ${to}`);
}

export const POS_STATUSES = { CART, ORDER, SALE, SHIFT, KITCHEN };
