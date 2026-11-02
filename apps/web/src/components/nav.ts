import type { Permission } from '@mecca/shared';

export type NavItem = { href: string; label: string; permission?: Permission; ready?: boolean };

/** Sidebar items in the order agreed in the proposal. `ready: false` items are built in later phases. */
export const NAV: NavItem[] = [
  { href: '/', label: 'لوحة التحكم', ready: true },
  { href: '/orders', label: 'الطلبات', permission: 'orders.view' },
  { href: '/customers', label: 'المطاعم', permission: 'customers.view', ready: true },
  { href: '/contracts', label: 'العقود والائتمان', permission: 'contracts.view' },
  {
    href: '/trade-names',
    label: 'الأسماء التجارية',
    permission: 'trade_names.manage',
    ready: true,
  },
  { href: '/items', label: 'الأصناف والأسعار', permission: 'items.view', ready: true },
  { href: '/production', label: 'الإنتاج والمخزون', permission: 'production.view' },
  { href: '/deliveries', label: 'التوزيع والسائقون', permission: 'deliveries.view' },
  { href: '/invoices', label: 'الفواتير', permission: 'invoices.view' },
  { href: '/payments', label: 'المقبوضات والذمم', permission: 'payments.view' },
  { href: '/purchasing', label: 'طلبات الشراء', permission: 'purchasing.view' },
  { href: '/reports', label: 'التقارير', permission: 'reports.view' },
  { href: '/users', label: 'المستخدمون والصلاحيات', permission: 'users.view', ready: true },
  { href: '/settings', label: 'الإعدادات', permission: 'settings.manage' },
];
