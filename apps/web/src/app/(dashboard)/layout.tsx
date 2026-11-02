'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ROLE_LABELS_AR } from '@mecca/shared';
import { useAuth } from '@/lib/auth';
import { NAV } from '@/components/nav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-brand-muted">
        جارٍ التحميل…
      </div>
    );
  }

  const items = NAV.filter((i) => !i.permission || can(i.permission));

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-brand-brown px-4 py-5 text-[#F3E9DA]">
        <div className="mb-6 rounded-xl bg-white p-2 text-center">
          <Image src="/logo.png" alt="مخابز مكة" width={96} height={81} className="mx-auto" />
        </div>
        <nav className="space-y-0.5">
          {items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.ready ? item.href : '#'}
                aria-disabled={!item.ready}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                  active ? 'bg-brand-gold font-bold text-white' : 'hover:bg-white/10'
                } ${item.ready ? '' : 'cursor-default opacity-50'}`}
              >
                {item.label}
                {!item.ready && <span className="text-[10px]">قريباً</span>}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-brand-line bg-white px-6 py-3">
          <div className="text-sm text-brand-muted">نظام إدارة الطلبات والإنتاج والتوزيع</div>
          <div className="flex items-center gap-3">
            <div className="text-left">
              <div className="text-sm font-bold text-brand-brown">{user.name}</div>
              <div className="text-xs text-brand-muted">{ROLE_LABELS_AR[user.role]}</div>
            </div>
            <button
              onClick={() => void logout()}
              className="rounded-lg border border-brand-line px-3 py-1.5 text-xs hover:bg-brand-cream"
            >
              خروج
            </button>
          </div>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
