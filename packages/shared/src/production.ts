/**
 * Production day lifecycle (one per delivery date):
 *   preliminary  generated from live orders before the cutoff, can be regenerated
 *   final        generated from confirmed orders after the cutoff (ordered quantities frozen)
 *   closed       produced / loaded / waste recorded and variances approved; read-only
 */
export const PRODUCTION_DAY_STATUSES = ['preliminary', 'final', 'closed'] as const;
export type ProductionDayStatus = (typeof PRODUCTION_DAY_STATUSES)[number];

export const PRODUCTION_DAY_STATUS_LABELS_AR: Record<ProductionDayStatus, string> = {
  preliminary: 'خطة مبدئية',
  final: 'خطة نهائية',
  closed: 'يوم مغلق',
};

/** Waste = spoiled in the bakery; return = brought back from customers. */
export const STOCK_LOSS_KINDS = ['waste', 'return'] as const;
export type StockLossKind = (typeof STOCK_LOSS_KINDS)[number];

export const STOCK_LOSS_REASONS = [
  'burnt',
  'damaged',
  'shape',
  'expired',
  'unsold',
  'customer_refused',
  'other',
] as const;
export type StockLossReason = (typeof STOCK_LOSS_REASONS)[number];

export const STOCK_LOSS_REASON_LABELS_AR: Record<StockLossReason, string> = {
  burnt: 'محروق',
  damaged: 'تالف أو مكسور',
  shape: 'شكل غير مطابق',
  expired: 'منتهي',
  unsold: 'فائض غير مباع',
  customer_refused: 'رفض العميل',
  other: 'سبب آخر',
};

export type ProductionSettings = {
  /** Allowed difference (basis points) before a variance needs approval. 200 = 2%. */
  toleranceBps: number;
  /** Extra quantity added to every planned item (basis points of the ordered quantity). */
  defaultExtraBps: number;
};

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  toleranceBps: 200,
  defaultExtraBps: 0,
};

// ---------------------------------------------------------------- purchasing

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'sent',
  'confirmed',
  'received',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS_AR: Record<PurchaseOrderStatus, string> = {
  draft: 'مسودة',
  sent: 'أُرسل للمورد',
  confirmed: 'أكّده المورد',
  received: 'تم الاستلام',
  cancelled: 'ملغى',
};

/** Allowed status changes. */
export const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['confirmed', 'received', 'cancelled'],
  confirmed: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};
