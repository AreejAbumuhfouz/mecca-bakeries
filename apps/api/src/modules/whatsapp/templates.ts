/**
 * WhatsApp message templates. Business-initiated messages must use templates approved by Meta:
 * register each one in WhatsApp Manager with the same name, language "ar" (Arabic),
 * category "Utility", and the body below ({{1}}, {{2}} … are the parameters in order).
 * Templates with header "document" also need a Document header in WhatsApp Manager.
 */
export const WHATSAPP_TEMPLATES = {
  mb_order_confirmed: {
    label: 'تأكيد استلام الطلب',
    body: 'تم استلام طلبكم رقم {{1}} لفرع {{2}} ليوم {{3}}. المجموع {{4}} دينار. يمكنكم التعديل من التطبيق حتى {{5}}. مخابز مكة',
  },
  mb_order_updated: {
    label: 'تعديل الطلب',
    body: 'تم تعديل طلبكم رقم {{1}} لفرع {{2}} ليوم {{3}}. المجموع الجديد {{4}} دينار. مخابز مكة',
  },
  mb_order_on_hold: {
    label: 'الطلب بانتظار موافقة',
    body: 'طلبكم رقم {{1}} لفرع {{2}} ليوم {{3}} بانتظار موافقة الإدارة: {{4}}. سنبلغكم بالقرار. مخابز مكة',
  },
  mb_order_approved: {
    label: 'الموافقة على الطلب',
    body: 'تمت الموافقة على طلبكم رقم {{1}} لفرع {{2}} ليوم {{3}}. مخابز مكة',
  },
  mb_order_rejected: {
    label: 'رفض الطلب',
    body: 'نعتذر، لم تتم الموافقة على طلبكم رقم {{1}} لفرع {{2}} ليوم {{3}}. يرجى التواصل مع المخبز. مخابز مكة',
  },
  mb_order_cancelled: {
    label: 'إلغاء الطلب',
    body: 'تم إلغاء طلبكم رقم {{1}} لفرع {{2}} ليوم {{3}}. مخابز مكة',
  },
  mb_draft_ready: {
    label: 'مسودة من طلب الأمس',
    body: 'جهّزنا مسودة طلب لفرع {{1}} ليوم {{2}} مثل طلب الأمس. أكّدوها أو عدّلوها من التطبيق قبل {{3}}. مخابز مكة',
  },
  mb_order_reminder: {
    label: 'تذكير بالطلب',
    body: 'تذكير: لم يصلنا طلب فرع {{1}} ليوم {{2}}. آخر موعد للطلب {{3}}. مخابز مكة',
  },
  mb_purchase_order: {
    label: 'طلب شراء لمورد (مع ملف PDF)',
    body: 'طلب شراء رقم {{1}} من مخابز مكة، مطلوب بتاريخ {{2}}. التفاصيل في الملف المرفق. نرجو تأكيد الطلب بالرد على هذه الرسالة.',
    header: 'document',
  },
} as const;

export type TemplateName = keyof typeof WHATSAPP_TEMPLATES;

/** The text as the restaurant will read it (stored in the message log). */
export const renderTemplate = (name: TemplateName, params: string[]) =>
  WHATSAPP_TEMPLATES[name].body.replace(
    /\{\{(\d+)\}\}/g,
    (_m, i: string) => params[Number(i) - 1] ?? '',
  );

/** Jordanian numbers to WhatsApp format: 0791234567 / +962 79… / 00962 79… → 962791234567. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `962${digits.slice(1)}`;
  return /^\d{10,15}$/.test(digits) ? digits : null;
}
