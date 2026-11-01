/** System roles. Fine-grained permissions are attached to roles in the database. */
export const ROLES = {
  SUPER_ADMIN: 'super_admin', // الإدارة العليا
  ORDERS: 'orders', // موظف الطلبات
  PRODUCTION: 'production', // مسؤول الإنتاج
  ACCOUNTANT: 'accountant', // المحاسب / المحصّل
  PURCHASING: 'purchasing', // مسؤول المشتريات
  RESTAURANT: 'restaurant', // المطعم / الفرع (تطبيق)
  DRIVER: 'driver', // السائق (تطبيق)
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
