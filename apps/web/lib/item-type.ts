/** Shared Products & Services type labels / helpers (mirrors API item-type). */
export const ITEM_TYPE = {
  INVENTORY_PRODUCT: 'INVENTORY_PRODUCT',
  NON_INVENTORY_PRODUCT: 'NON_INVENTORY_PRODUCT',
  SERVICE: 'SERVICE',
} as const;

export type ItemType = (typeof ITEM_TYPE)[keyof typeof ITEM_TYPE];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  INVENTORY_PRODUCT: 'Inventory Product',
  NON_INVENTORY_PRODUCT: 'Non-Inventory Product',
  SERVICE: 'Service',
};

export const ITEM_TYPE_BADGE: Record<ItemType, string> = {
  INVENTORY_PRODUCT: 'Inventory',
  NON_INVENTORY_PRODUCT: 'Non-Inventory',
  SERVICE: 'Service',
};

export const ITEM_TYPE_TONE: Record<ItemType, string> = {
  INVENTORY_PRODUCT: 'blue',
  NON_INVENTORY_PRODUCT: 'default',
  SERVICE: 'purple',
};

export function normalizeItemType(raw?: string | null): ItemType {
  const t = String(raw || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (t === 'INVENTORY' || t === 'INVENTORY_PRODUCT' || t === 'PRODUCT') return ITEM_TYPE.INVENTORY_PRODUCT;
  if (t === 'NON_INVENTORY' || t === 'NON_INVENTORY_PRODUCT' || t === 'NONINVENTORY') return ITEM_TYPE.NON_INVENTORY_PRODUCT;
  if (t === 'SERVICE') return ITEM_TYPE.SERVICE;
  return ITEM_TYPE.INVENTORY_PRODUCT;
}

export function isStockTracked(raw?: string | null): boolean {
  return normalizeItemType(raw) === ITEM_TYPE.INVENTORY_PRODUCT;
}

export function isService(raw?: string | null): boolean {
  return normalizeItemType(raw) === ITEM_TYPE.SERVICE;
}

export function itemTypeOptions() {
  return (Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map((value) => ({ value, label: ITEM_TYPE_LABELS[value] }));
}

export function itemTypeLabel(raw?: string | null): string {
  return ITEM_TYPE_LABELS[normalizeItemType(raw)];
}

export const TRACKING_STATUS = {
  TRACKED: 'TRACKED',
  UNTRACKED: 'UNTRACKED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;

export type TrackingStatus = (typeof TRACKING_STATUS)[keyof typeof TRACKING_STATUS];

export const TRACKING_LABELS: Record<TrackingStatus, string> = {
  TRACKED: 'Tracked',
  UNTRACKED: 'Untracked',
  NOT_APPLICABLE: 'Not applicable',
};

export const TRACKING_TONE: Record<TrackingStatus, string> = {
  TRACKED: 'green',
  UNTRACKED: 'default',
  NOT_APPLICABLE: 'purple',
};

export const TRACKING_HINTS: Record<ItemType, string> = {
  INVENTORY_PRODUCT: 'Stock tracking enabled. Purchases, sales, adjustments and transfers may affect quantity and inventory valuation.',
  NON_INVENTORY_PRODUCT: 'Stock tracking disabled. This item can be bought and sold, but quantity on hand and inventory valuation are not tracked.',
  SERVICE: 'This is a service. No stock quantity, warehouse movement or inventory valuation will be created.',
};

/** Derived from item type — never a separate editable field. */
export function trackingStatus(raw?: string | null): TrackingStatus {
  const t = normalizeItemType(raw);
  if (t === ITEM_TYPE.INVENTORY_PRODUCT) return TRACKING_STATUS.TRACKED;
  if (t === ITEM_TYPE.NON_INVENTORY_PRODUCT) return TRACKING_STATUS.UNTRACKED;
  return TRACKING_STATUS.NOT_APPLICABLE;
}

export function trackingLabel(raw?: string | null): string {
  return TRACKING_LABELS[trackingStatus(raw)];
}

/** Map UI tracking filter → item type. */
export function itemTypeFromTracking(tracking?: string | null): ItemType | null {
  const t = String(tracking || '').toUpperCase();
  if (t === 'TRACKED') return ITEM_TYPE.INVENTORY_PRODUCT;
  if (t === 'UNTRACKED') return ITEM_TYPE.NON_INVENTORY_PRODUCT;
  if (t === 'NOT_APPLICABLE' || t === 'N/A') return ITEM_TYPE.SERVICE;
  return null;
}

export function trackingFilterOptions() {
  return [
    { value: 'TRACKED', label: 'Tracked' },
    { value: 'UNTRACKED', label: 'Untracked' },
    { value: 'NOT_APPLICABLE', label: 'Not applicable' },
  ];
}

export function itemSelectorSubtitle(type?: string | null): string {
  const t = normalizeItemType(type);
  if (t === ITEM_TYPE.SERVICE) return `${ITEM_TYPE_LABELS[t]} · No stock tracking`;
  return `${ITEM_TYPE_LABELS[t]} · ${TRACKING_LABELS[trackingStatus(t)]}`;
}

export function itemOptionLabel(item: { sku?: string; name?: string; type?: string }) {
  const skuPart = item.sku ? `${item.sku} — ` : '';
  return `${skuPart}${item.name || 'Item'}`;
}
