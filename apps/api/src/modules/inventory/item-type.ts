/** Canonical item types for Products & Services (stock + accounting behaviour). */
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

/** Accept legacy short codes from older data. */
export function normalizeItemType(raw?: string | null): ItemType {
  const t = String(raw || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (t === 'INVENTORY' || t === 'INVENTORY_PRODUCT' || t === 'PRODUCT') return ITEM_TYPE.INVENTORY_PRODUCT;
  if (t === 'NON_INVENTORY' || t === 'NON_INVENTORY_PRODUCT' || t === 'NONINVENTORY') return ITEM_TYPE.NON_INVENTORY_PRODUCT;
  if (t === 'SERVICE') return ITEM_TYPE.SERVICE;
  return ITEM_TYPE.INVENTORY_PRODUCT;
}

/** Only inventory products participate in qty/valuation/COGS stock movements. */
export function isStockTracked(raw?: string | null): boolean {
  return normalizeItemType(raw) === ITEM_TYPE.INVENTORY_PRODUCT;
}

export function isService(raw?: string | null): boolean {
  return normalizeItemType(raw) === ITEM_TYPE.SERVICE;
}

export function itemTypeOptions() {
  return (Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map((value) => ({ value, label: ITEM_TYPE_LABELS[value] }));
}

export const TRACKING_STATUS = {
  TRACKED: 'TRACKED',
  UNTRACKED: 'UNTRACKED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;

export type TrackingStatus = (typeof TRACKING_STATUS)[keyof typeof TRACKING_STATUS];

/** Derived from item type — single source of truth (no separate trackInventory flag). */
export function trackingStatus(raw?: string | null): TrackingStatus {
  const t = normalizeItemType(raw);
  if (t === ITEM_TYPE.INVENTORY_PRODUCT) return TRACKING_STATUS.TRACKED;
  if (t === ITEM_TYPE.NON_INVENTORY_PRODUCT) return TRACKING_STATUS.UNTRACKED;
  return TRACKING_STATUS.NOT_APPLICABLE;
}

export function itemTypeFromTracking(tracking?: string | null): ItemType | null {
  const t = String(tracking || '').toUpperCase();
  if (t === 'TRACKED') return ITEM_TYPE.INVENTORY_PRODUCT;
  if (t === 'UNTRACKED') return ITEM_TYPE.NON_INVENTORY_PRODUCT;
  if (t === 'NOT_APPLICABLE' || t === 'N/A') return ITEM_TYPE.SERVICE;
  return null;
}
