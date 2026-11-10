'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Languages,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Sun,
  X,
} from 'lucide-react';
import { ROLE_LABELS_AR } from '@mecca/shared';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { getLocale, isRtl, t } from '@/lib/i18n';
import { NAV } from '@/components/nav';
import { CommandPalette } from '@/components/command-palette';
import { useSwitchLocale } from '@/components/language-switch';

const COLLAPSE_KEY = 'mb-sidebar-collapsed';

/** The nav item a path belongs to ('/' only matches the home page). */
const sectionOf = (pathname: string) =>
  NAV.filter((i) => (i.href === '/' ? pathname === '/' : pathname.startsWith(i.href))).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, can } = useAuth();
  const { theme, toggle } = useTheme();
  const switchLocale = useSwitchLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const rtl = isRtl();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // storage blocked: start expanded
    }
  }, []);

  // Close the phone drawer after navigating.
  useEffect(() => setMobileOpen(false), [pathname]);

  // Browser tab title follows the section.
  const section = sectionOf(pathname);
  useEffect(() => {
    document.title = section ? `${section.label} — ${t('مخابز مكة')}` : t('مخابز مكة');
  }, [section]);

  // Ctrl/⌘ + K opens the quick search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        // ignore
      }
      return !c;
    });
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="mb-spinner" aria-label={t('جارٍ التحميل…')} />
      </div>
    );
  }

  // Restaurant and driver accounts work in the phone app; the dashboard is for staff.
  if (user.role === 'restaurant' || user.role === 'driver') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-4 rounded-2xl border border-brand-line bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto w-fit rounded-xl bg-white p-2">
            <Image src="/logo.png" alt={t('مخابز مكة')} width={90} height={76} />
          </div>
          <h1 className="text-xl font-bold text-brand-brown">{t('هذا الحساب للتطبيق')}</h1>
          <p className="text-sm leading-7 text-brand-muted">
            {user.role === 'driver'
              ? t(
                  'حساب السائق «{0}» يعمل من تطبيق مخابز مكة على الجوال. لوحة التحكم لموظفي المخبز فقط.',
                  user.name,
                )
              : t(
                  'حساب المطعم «{0}» يعمل من تطبيق مخابز مكة على الجوال. لوحة التحكم لموظفي المخبز فقط.',
                  user.name,
                )}
          </p>
          <button
            onClick={() => void logout()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-on-primary"
          >
            <LogOut size={16} /> {t('خروج والدخول بحساب آخر')}
          </button>
        </div>
      </div>
    );
  }

  const items = NAV.filter((i) => !i.permission || can(i.permission));
  // On phones the drawer always shows labels.
  const narrow = collapsed && !mobileOpen;
  const initials = user.name.trim().charAt(0);
  const Crumb = rtl ? ChevronLeft : ChevronRight;
  const CollapseIcon = rtl
    ? narrow
      ? PanelRightOpen
      : PanelRightClose
    : narrow
      ? PanelLeftOpen
      : PanelLeftClose;
  // Sub-page of a section (e.g. /orders/123): show "Orders › Details" with a link back.
  const deeper = section && section.href !== '/' && pathname !== section.href;

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-primary px-3 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:inset-s-2"
      >
        {t('تخطي إلى المحتوى')}
      </a>
      {mobileOpen && (
        <button
          aria-label={t('إغلاق القائمة')}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] md:hidden print:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 inset-s-0 z-40 flex shrink-0 flex-col bg-sidebar text-sidebar-ink shadow-xl transition-all duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 md:shadow-none print:hidden ${
          mobileOpen ? 'translate-x-0' : rtl ? 'translate-x-full' : '-translate-x-full'
        } ${narrow ? 'w-[76px]' : 'w-64'}`}
      >
        <div className={`flex items-center gap-2 px-3 pt-4 pb-3 ${narrow ? 'justify-center' : ''}`}>
          <Link
            href="/"
            className={`rounded-xl bg-white p-1.5 ${narrow ? 'w-12' : 'flex-1'} transition-all`}
          >
            <Image
              src="/logo.png"
              alt={t('مخابز مكة')}
              width={narrow ? 40 : 80}
              height={narrow ? 34 : 67}
              className="mx-auto"
              priority
            />
          </Link>
          <button
            className="rounded-lg p-1.5 hover:bg-white/10 md:hidden"
            aria-label={t('إغلاق القائمة')}
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        {!narrow && (
          <button
            onClick={() => setPalette(true)}
            className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-sidebar-ink/75 hover:bg-white/15"
          >
            <Search size={16} />
            <span className="flex-1 text-start">{t('بحث سريع')}</span>
            <kbd className="rounded border border-white/20 px-1.5 text-[10px]" dir="ltr">
              Ctrl K
            </kbd>
          </button>
        )}

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label={t('القائمة')}>
          {items.map((item) => {
            const active = section?.href === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={narrow ? item.label : undefined}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  narrow ? 'justify-center' : ''
                } ${
                  active
                    ? 'bg-brand-gold font-bold text-white shadow-sm'
                    : 'text-sidebar-ink/85 hover:bg-white/10 hover:text-sidebar-ink'
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.3 : 1.8} className="shrink-0" />
                {!narrow && <span className="flex-1 truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="hidden border-t border-white/10 p-3 md:block">
          <button
            onClick={toggleCollapsed}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-ink/80 hover:bg-white/10 ${
              narrow ? 'justify-center' : ''
            }`}
            title={narrow ? t('توسيع القائمة') : undefined}
          >
            <CollapseIcon size={19} />
            {!narrow && t('تصغير القائمة')}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-brand-line bg-surface/90 px-4 py-2.5 backdrop-blur md:px-6 print:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="rounded-lg p-2 text-brand-brown hover:bg-brand-cream md:hidden"
              aria-label={t('فتح القائمة')}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <nav
              aria-label={t('مسار الصفحة')}
              className="flex min-w-0 items-center gap-1.5 text-sm text-brand-muted"
            >
              <Link href="/" className="hidden hover:text-brand-brown sm:inline">
                {t('لوحة التحكم')}
              </Link>
              {section && section.href !== '/' && (
                <>
                  <Crumb size={14} className="hidden shrink-0 sm:block" />
                  {deeper ? (
                    <Link href={section.href} className="truncate hover:text-brand-brown">
                      {section.label}
                    </Link>
                  ) : (
                    <span className="truncate font-bold text-brand-brown">{section.label}</span>
                  )}
                </>
              )}
              {deeper && (
                <>
                  <Crumb size={14} className="shrink-0" />
                  <span className="truncate font-bold text-brand-brown">{t('التفاصيل')}</span>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPalette(true)}
              className="rounded-lg border border-brand-line p-2 text-brand-brown hover:bg-brand-cream md:hidden"
              aria-label={t('بحث سريع')}
            >
              <Search size={17} />
            </button>
            <button
              onClick={() => void switchLocale(getLocale() === 'ar' ? 'en' : 'ar')}
              className="flex items-center gap-1.5 rounded-lg border border-brand-line px-2.5 py-2 text-xs font-bold text-brand-brown hover:bg-brand-cream"
              title={t('اللغة')}
            >
              <Languages size={16} />
              <span className="hidden sm:inline">
                {getLocale() === 'ar' ? 'English' : 'العربية'}
              </span>
            </button>
            <button
              onClick={toggle}
              className="rounded-lg border border-brand-line p-2 text-brand-brown hover:bg-brand-cream"
              aria-label={theme === 'dark' ? t('الوضع الفاتح') : t('الوضع الداكن')}
              title={theme === 'dark' ? t('الوضع الفاتح') : t('الوضع الداكن')}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="flex items-center gap-2 rounded-lg px-1 py-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gold-light text-sm font-bold text-brand-brown">
                {initials}
              </span>
              <div className="hidden text-start lg:block">
                <div className="text-sm leading-tight font-bold text-brand-brown">{user.name}</div>
                <div className="text-xs text-brand-muted">{t(ROLE_LABELS_AR[user.role])}</div>
              </div>
            </div>
            <button
              onClick={() => void logout()}
              className="flex items-center gap-1.5 rounded-lg border border-brand-line px-3 py-2 text-xs text-brand-brown hover:bg-brand-cream"
              aria-label={t('خروج')}
            >
              <LogOut size={15} className="rtl:-scale-x-100" />
              <span className="hidden sm:inline">{t('خروج')}</span>
            </button>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1500px] p-4 md:p-6">
          {children}
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={items} />
    </div>
  );
}
