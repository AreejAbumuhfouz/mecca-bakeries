import type { Permission } from '@mecca/shared';
import {
  BarChart3,
  Building2,
  ClipboardList,
  Croissant,
  Factory,
  FileSignature,
  History,
  LayoutDashboard,
  MessageCircle,
  Receipt,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/lib/i18n';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  ready?: boolean;
};

/** Sidebar items in the order agreed in the proposal. `ready: false` items are built in later phases. */
export const NAV: NavItem[] = [
  { href: '/', label: t('لوحة التحكم'), icon: LayoutDashboard, ready: true },
  {
    href: '/orders',
    label: t('الطلبات'),
    icon: ClipboardList,
    permission: 'orders.view',
    ready: true,
  },
  {
    href: '/messages',
    label: t('رسائل واتساب'),
    icon: MessageCircle,
    permission: 'orders.view',
    ready: true,
  },
  {
    href: '/customers',
    label: t('المطاعم'),
    icon: Store,
    permission: 'customers.view',
    ready: true,
  },
  {
    href: '/contracts',
    label: t('العقود والائتمان'),
    icon: FileSignature,
    permission: 'contracts.view',
    ready: true,
  },
  {
    href: '/trade-names',
    label: t('الأسماء التجارية'),
    icon: Building2,
    permission: 'trade_names.manage',
    ready: true,
  },
  {
    href: '/items',
    label: t('الأصناف والأسعار'),
    icon: Croissant,
    permission: 'items.view',
    ready: true,
  },
  {
    href: '/production',
    label: t('الإنتاج والمخزون'),
    icon: Factory,
    permission: 'production.view',
    ready: true,
  },
  {
    href: '/deliveries',
    label: t('التوزيع والسائقون'),
    icon: Truck,
    permission: 'deliveries.view',
    ready: true,
  },
  {
    href: '/invoices',
    label: t('الفواتير'),
    icon: Receipt,
    permission: 'invoices.view',
    ready: true,
  },
  {
    href: '/payments',
    label: t('المقبوضات والذمم'),
    icon: Wallet,
    permission: 'payments.view',
    ready: true,
  },
  {
    href: '/purchasing',
    label: t('طلبات الشراء'),
    icon: ShoppingCart,
    permission: 'purchasing.view',
    ready: true,
  },
  {
    href: '/reports',
    label: t('التقارير'),
    icon: BarChart3,
    permission: 'reports.view',
    ready: true,
  },
  {
    href: '/users',
    label: t('المستخدمون والصلاحيات'),
    icon: Users,
    permission: 'users.view',
    ready: true,
  },
  { href: '/audit', label: t('سجل التدقيق'), icon: History, permission: 'audit.view', ready: true },
  {
    href: '/settings',
    label: t('الإعدادات'),
    icon: Settings,
    permission: 'settings.manage',
    ready: true,
  },
];
