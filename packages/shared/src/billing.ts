/** Distribution, invoices, payments and receivables (phase 4). */

// ---------------------------------------------------------------- distribution

export const TRIP_STATUSES = ['planned', 'out', 'done'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const TRIP_STATUS_LABELS_AR: Record<TripStatus, string> = {
  planned: 'لم يخرج',
  out: 'في الطريق',
  done: 'انتهى',
};

export const DELIVERY_STATUSES = ['pending', 'delivered', 'partial', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_STATUS_LABELS_AR: Record<DeliveryStatus, string> = {
  pending: 'بانتظار التسليم',
  delivered: 'تم التسليم',
  partial: 'تسليم ناقص',
  failed: 'لم يُسلَّم',
};

/** Why something was short, returned, or not delivered at all. */
export const DELIVERY_REASONS = [
  'shop_closed',
  'customer_refused',
  'bakery_shortage',
  'damaged',
  'quality',
  'wrong_item',
  'unsold',
  'other',
] as const;
export type DeliveryReason = (typeof DELIVERY_REASONS)[number];
export const DELIVERY_REASON_LABELS_AR: Record<DeliveryReason, string> = {
  shop_closed: 'المحل مغلق',
  customer_refused: 'رفض الاستلام',
  bakery_shortage: 'نقص من المخبز',
  damaged: 'تالف',
  quality: 'جودة غير مقبولة',
  wrong_item: 'صنف خطأ',
  unsold: 'لم يُبع (مرتجع)',
  other: 'سبب آخر',
};

// ---------------------------------------------------------------- invoices

export const INVOICE_STATUSES = ['draft', 'approved', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS_AR: Record<InvoiceStatus, string> = {
  draft: 'مسودة',
  approved: 'معتمدة',
  cancelled: 'ملغاة',
};

/** `opening` is the customer's balance carried in from before the system. */
export const INVOICE_KINDS = ['sale', 'opening'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_LINE_KINDS = ['sale', 'return'] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

/** Invoice number: prefix of the trade name + six digits, e.g. MB-000123. */
export const invoiceNumber = (prefix: string, n: number) =>
  `${prefix}-${String(n).padStart(6, '0')}`;

// ---------------------------------------------------------------- payments

export const PAYMENT_METHODS = ['cash', 'cheque', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS_AR: Record<PaymentMethod, string> = {
  cash: 'نقداً',
  cheque: 'شيك',
  transfer: 'تحويل بنكي',
};

export const PAYMENT_SOURCES = ['driver', 'office'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const PAYMENT_STATUSES = ['received', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// ---------------------------------------------------------------- receivables

/** Aging buckets by days past the due date. */
export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_LABELS_AR: Record<AgingBucket, string> = {
  current: 'غير مستحق',
  d1_30: '1–30 يوم',
  d31_60: '31–60 يوم',
  d61_90: '61–90 يوم',
  d90_plus: 'أكثر من 90',
};
export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
}

/** Daily receivables reminder to customers (WhatsApp + app notification). */
export type ReceivablesSettings = {
  alertsEnabled: boolean;
  /** "HH:MM" Amman time. */
  alertTime: string;
  /** Only customers owing at least this many fils. */
  minAmount: number;
  /** Only customers with an overdue amount. */
  onlyOverdue: boolean;
};
export const DEFAULT_RECEIVABLES_SETTINGS: ReceivablesSettings = {
  alertsEnabled: true,
  alertTime: '10:00',
  minAmount: 1000,
  onlyOverdue: true,
};
