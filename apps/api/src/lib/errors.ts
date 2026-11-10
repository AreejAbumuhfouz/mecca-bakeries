import { t } from './i18n.js';

/** Throw this from routes/services for expected, user-facing errors. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** What each record is called in "not found" messages. */
const NAMES: Record<string, string> = {
  Attachment: 'المرفق',
  Branch: 'الفرع',
  Category: 'التصنيف',
  Contract: 'العقد',
  Customer: 'العميل',
  Delivery: 'التسليم',
  Entry: 'السجل',
  File: 'الملف',
  Invoice: 'الفاتورة',
  Item: 'الصنف',
  Line: 'السطر',
  Order: 'الطلب',
  Payment: 'الدفعة',
  'Purchase order': 'طلب الشراء',
  Route: 'المسار',
  Section: 'القسم',
  Signature: 'التوقيع',
  Supplier: 'المورد',
  'Trade name': 'الاسم التجاري',
  Trip: 'الرحلة',
  User: 'المستخدم',
  Vehicle: 'السيارة',
};

export const notFound = (what = 'Resource') =>
  new AppError(404, 'NOT_FOUND', t('لم يتم العثور على {0}', t(NAMES[what] ?? t('البيانات'))));
