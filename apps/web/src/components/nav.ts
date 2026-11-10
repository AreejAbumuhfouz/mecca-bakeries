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

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  ready?: boolean;
};

/** Sidebar items in the order agreed in the proposal. `ready: false` items are built in later phases. */
export const NAV: NavItem[] = [
  { href: '/', label: 'لوحة التحكم', icon: LayoutDashboard, ready: true },
  {
    href: '/orders',
    label: 'الطلبات',
    icon: ClipboardList,
    permission: 'orders.view',
    ready: true,
  },
  {
    href: '/messages',
    label: 'رسائل واتساب',
    icon: MessageCircle,
    permission: 'orders.view',
    ready: true,
  },
  { href: '/customers', label: 'المطاعم', icon: Store, permission: 'customers.view', ready: true },
  {
    href: '/contracts',
    label: 'العقود والائتمان',
    icon: FileSignature,
    permission: 'contracts.view',
    ready: true,
  },
  {
    href: '/trade-names',
    label: 'الأسماء التجارية',
    icon: Building2,
    permission: 'trade_names.manage',
    ready: true,
  },
  {
    href: '/items',
    label: 'الأصناف والأسعار',
    icon: Croissant,
    permission: 'items.view',
    ready: true,
  },
  {
    href: '/production',
    label: 'الإنتاج والمخزون',
    icon: Factory,
    permission: 'production.view',
    ready: true,
  },
  {
    href: '/deliveries',
    label: 'التوزيع والسائقون',
    icon: Truck,
    permission: 'deliveries.view',
    ready: true,
  },
  { href: '/invoices', label: 'الفواتير', icon: Receipt, permission: 'invoices.view', ready: true },
  {
    href: '/payments',
    label: 'المقبوضات والذمم',
    icon: Wallet,
    permission: 'payments.view',
    ready: true,
  },
  {
    href: '/purchasing',
    label: 'طلبات الشراء',
    icon: ShoppingCart,
    permission: 'purchasing.view',
    ready: true,
  },
  { href: '/reports', label: 'التقارير', icon: BarChart3, permission: 'reports.view', ready: true },
  {
    href: '/users',
    label: 'المستخدمون والصلاحيات',
    icon: Users,
    permission: 'users.view',
    ready: true,
  },
  { href: '/audit', label: 'سجل التدقيق', icon: History, permission: 'audit.view', ready: true },
  {
    href: '/settings',
    label: 'الإعدادات',
    icon: Settings,
    permission: 'settings.manage',
    ready: true,
  },
];
