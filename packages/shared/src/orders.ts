import { addDays, ammanDate, BUSINESS_TZ } from './dates.js';

/**
 * Order lifecycle:
 *   draft            created at midnight from yesterday's order; the restaurant confirms it
 *   submitted        placed and editable until the cutoff
 *   pending_approval blocked by the credit rules, waiting for a manager
 *   confirmed        locked at the cutoff (or approved after it); goes to production
 *   rejected         a manager refused the credit exception
 *   cancelled        cancelled by the restaurant or staff, or an expired draft
 */
export const ORDER_STATUSES = [
  'draft',
  'submitted',
  'pending_approval',
  'confirmed',
  'delivered',
  'rejected',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS_AR: Record<OrderStatus, string> = {
  draft: 'مسودة (من طلب الأمس)',
  submitted: 'مُرسل',
  pending_approval: 'بانتظار موافقة الإدارة',
  confirmed: 'مؤكد',
  delivered: 'تم التسليم',
  rejected: 'مرفوض',
  cancelled: 'ملغى',
};

/** Statuses that still count as "the order" of a branch for a day. */
export const LIVE_ORDER_STATUSES: OrderStatus[] = [
  'draft',
  'submitted',
  'pending_approval',
  'confirmed',
  'delivered',
];

export const ORDER_SOURCES = ['app', 'dashboard', 'auto_draft'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const ORDER_SOURCE_LABELS_AR: Record<OrderSource, string> = {
  app: 'تطبيق المطعم',
  dashboard: 'لوحة التحكم',
  auto_draft: 'مسودة تلقائية',
};

export const ORDER_EVENT_TYPES = [
  'created',
  'updated',
  'submitted',
  'draft_created',
  'approval_requested',
  'approved',
  'rejected',
  'confirmed',
  'delivered',
  'cancelled',
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export const ORDER_EVENT_LABELS_AR: Record<OrderEventType, string> = {
  created: 'إنشاء الطلب',
  updated: 'تعديل الطلب',
  submitted: 'إرسال الطلب',
  draft_created: 'إنشاء مسودة من طلب الأمس',
  approval_requested: 'إيقاف بسبب الائتمان وطلب موافقة',
  approved: 'موافقة استثنائية',
  rejected: 'رفض الموافقة',
  confirmed: 'تأكيد عند الإغلاق',
  delivered: 'تسليم من السائق',
  cancelled: 'إلغاء',
};

// ---------------------------------------------------------------- settings

/** Ordering schedule. Times are "HH:MM" in Amman time. */
export type OrderSettings = {
  /** Reminder times (evening before delivery) for branches with no order yet. */
  reminderTimes: string[];
  remindersEnabled: boolean;
  /** When drafts are created from yesterday's orders. */
  draftTime: string;
  draftsEnabled: boolean;
  /** Ordering closes; orders are confirmed and the preliminary summary is ready. */
  cutoffTime: string;
  /** At the cutoff: true = unconfirmed drafts are sent as orders; false = they are cancelled. */
  autoSubmitDrafts: boolean;
  whatsappEnabled: boolean;
  pushEnabled: boolean;
};

export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  reminderTimes: ['21:00', '22:00', '23:00'],
  remindersEnabled: true,
  draftTime: '00:00',
  draftsEnabled: true,
  cutoffTime: '03:00',
  autoSubmitDrafts: false,
  whatsappEnabled: true,
  pushEnabled: true,
};

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------- ordering window

/** "HH:MM" in Amman right now. */
export function ammanTime(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** UTC instant of a local Amman date and time. */
export function ammanToUtc(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  // Offset of Amman at that instant (Jordan is UTC+3 all year, but do not hard-code it).
  const local = new Date(guess.toLocaleString('en-US', { timeZone: BUSINESS_TZ }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

/**
 * When ordering closes for a delivery date. A morning cutoff (before 12:00) is on the
 * delivery day itself (03:00 on day D); an evening one is the night before.
 */
export function cutoffAt(deliveryDate: string, cutoffTime: string): Date {
  const day = cutoffTime < '12:00' ? deliveryDate : addDays(deliveryDate, -1);
  return ammanToUtc(day, cutoffTime);
}

/** The delivery date a restaurant is ordering for right now. */
export function currentDeliveryDate(now: Date, cutoffTime: string): string {
  const today = ammanDate(now);
  for (const candidate of [today, addDays(today, 1), addDays(today, 2)]) {
    if (now < cutoffAt(candidate, cutoffTime)) return candidate;
  }
  return addDays(today, 2);
}

export const isBeforeCutoff = (now: Date, deliveryDate: string, cutoffTime: string) =>
  now < cutoffAt(deliveryDate, cutoffTime);
