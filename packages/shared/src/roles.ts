/** System roles. Default permissions per role live in permissions.ts. */
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

export const ROLE_VALUES = Object.values(ROLES) as [Role, ...Role[]];

export const ROLE_LABELS_AR: Record<Role, string> = {
  super_admin: 'الإدارة العليا',
  orders: 'موظف الطلبات',
  production: 'مسؤول الإنتاج',
  accountant: 'المحاسب / المحصّل',
  purchasing: 'مسؤول المشتريات',
  restaurant: 'مطعم / فرع',
  driver: 'سائق',
};

/** Roles that use the dashboard (web) vs the mobile app. */
export const DASHBOARD_ROLES: readonly Role[] = [
  'super_admin',
  'orders',
  'production',
  'accountant',
  'purchasing',
];
export const APP_ROLES: readonly Role[] = ['restaurant', 'driver'];
