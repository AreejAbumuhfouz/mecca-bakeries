import { ROLES, type Role } from './roles.js';

/**
 * Every protected action in the system. Roles get a default set below;
 * the super admin can grant or deny extra permissions per user.
 */
export const PERMISSIONS = [
  'users.view',
  'users.manage',
  'audit.view',
  'settings.manage',
  'customers.view',
  'customers.manage',
  'contracts.view',
  'contracts.manage',
  'credit.override', // موافقة استثنائية على تجاوز الائتمان
  'trade_names.manage', // الإدارة العليا فقط
  'items.view',
  'items.manage',
  'orders.view',
  'orders.manage',
  'orders.place', // المطعم من التطبيق
  'production.view',
  'production.manage',
  'variances.approve',
  'deliveries.view',
  'deliveries.manage',
  'deliveries.confirm', // السائق من التطبيق
  'invoices.view',
  'invoices.manage',
  'invoices.edit_locked',
  'payments.view',
  'payments.manage',
  'purchasing.view',
  'purchasing.manage',
  'reports.view',
  'own_account.view', // المطعم: فواتيره ورصيده
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const isPermission = (value: string): value is Permission =>
  (PERMISSIONS as readonly string[]).includes(value);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [ROLES.SUPER_ADMIN]: PERMISSIONS,
  [ROLES.ORDERS]: [
    'customers.view',
    'contracts.view',
    'items.view',
    'orders.view',
    'orders.manage',
    'deliveries.view',
    'reports.view',
  ],
  [ROLES.PRODUCTION]: [
    'items.view',
    'orders.view',
    'production.view',
    'production.manage',
    'deliveries.view',
    'reports.view',
  ],
  [ROLES.ACCOUNTANT]: [
    'customers.view',
    'contracts.view',
    'orders.view',
    'deliveries.view',
    'invoices.view',
    'invoices.manage',
    'payments.view',
    'payments.manage',
    'reports.view',
  ],
  [ROLES.PURCHASING]: ['items.view', 'purchasing.view', 'purchasing.manage'],
  [ROLES.RESTAURANT]: ['orders.place', 'own_account.view'],
  [ROLES.DRIVER]: ['deliveries.confirm'],
};

export type PermissionOverride = { permission: Permission; allowed: boolean };

/** Role defaults, then per-user overrides (grant or deny). */
export function effectivePermissions(
  role: Role,
  overrides: readonly PermissionOverride[] = [],
): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const o of overrides) {
    if (o.allowed) set.add(o.permission);
    else set.delete(o.permission);
  }
  return set;
}

/** Arabic labels for the permissions screen. */
export const PERMISSION_LABELS_AR: Record<Permission, string> = {
  'users.view': 'عرض المستخدمين',
  'users.manage': 'إدارة المستخدمين والصلاحيات',
  'audit.view': 'عرض سجل التدقيق',
  'settings.manage': 'إدارة الإعدادات',
  'customers.view': 'عرض العملاء',
  'customers.manage': 'إدارة العملاء والفروع',
  'contracts.view': 'عرض العقود',
  'contracts.manage': 'إدارة العقود والأسعار الخاصة',
  'credit.override': 'الموافقة على تجاوز الائتمان',
  'trade_names.manage': 'إدارة الأسماء التجارية',
  'items.view': 'عرض الأصناف',
  'items.manage': 'إدارة الأصناف والأسعار',
  'orders.view': 'عرض الطلبات',
  'orders.manage': 'إدارة الطلبات',
  'orders.place': 'تقديم طلبات (تطبيق المطعم)',
  'production.view': 'عرض الإنتاج',
  'production.manage': 'إدارة الإنتاج والمخزون',
  'variances.approve': 'اعتماد فروقات الإنتاج',
  'deliveries.view': 'عرض التوزيع',
  'deliveries.manage': 'إدارة التوزيع والسائقين',
  'deliveries.confirm': 'تأكيد التسليم (تطبيق السائق)',
  'invoices.view': 'عرض الفواتير',
  'invoices.manage': 'إدارة الفواتير',
  'invoices.edit_locked': 'تعديل فاتورة مقفلة',
  'payments.view': 'عرض المقبوضات',
  'payments.manage': 'تسجيل المقبوضات',
  'purchasing.view': 'عرض طلبات الشراء',
  'purchasing.manage': 'إدارة طلبات الشراء',
  'reports.view': 'عرض التقارير',
  'own_account.view': 'عرض حسابه وفواتيره (المطعم)',
};
