'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { NavItem } from './nav';

/** Extra destinations reachable from quick search, besides the sidebar sections. */
const EXTRA = [
  { href: '/orders/new', label: () => t('طلب جديد'), parent: '/orders' },
  { href: '/orders/approvals', label: () => t('الموافقات والمسودات'), parent: '/orders' },
  { href: '/orders/summary', label: () => t('مجموع الطلبات'), parent: '/orders' },
  { href: '/contracts/new', label: () => t('عقد جديد'), parent: '/contracts' },
  { href: '/production/setup', label: () => t('الخطوط والسيارات'), parent: '/production' },
  { href: '/production/history', label: () => t('سجل الإنتاج'), parent: '/production' },
  { href: '/deliveries/routes', label: () => t('مسارات السائقين'), parent: '/deliveries' },
  { href: '/purchasing/new', label: () => t('طلب شراء جديد'), parent: '/purchasing' },
  { href: '/settings/import', label: () => t('نقل البيانات من Excel'), parent: '/settings' },
];

/** Ctrl/⌘+K: jump to any page by typing part of its name. */
export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const all = useMemo(() => {
    const allowed = new Set(items.map((i) => i.href));
    return [
      ...items.map((i) => ({ href: i.href, label: i.label, icon: i.icon, hint: '' })),
      ...EXTRA.filter((e) => allowed.has(e.parent)).map((e) => {
        const parent = items.find((i) => i.href === e.parent)!;
        return { href: e.href, label: e.label(), icon: parent.icon, hint: parent.label };
      }),
    ];
  }, [items]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? all.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(s)) : all;
  }, [all, q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => setSel(0), [q]);

  if (!open) return null;
  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[1px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('بحث سريع')}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-brand-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-brand-line px-4">
          <Search size={18} className="text-brand-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, list.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              }
              if (e.key === 'Enter' && list[sel]) go(list[sel].href);
            }}
            placeholder={t('اكتب اسم الصفحة…')}
            className="h-12 flex-1 bg-transparent text-sm outline-none"
            aria-label={t('بحث سريع')}
          />
          <kbd className="rounded border border-brand-line px-1.5 text-[10px] text-brand-muted">
            Esc
          </kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {list.map((i, n) => {
            const Icon = i.icon;
            return (
              <li key={i.href} role="option" aria-selected={n === sel}>
                <button
                  onMouseEnter={() => setSel(n)}
                  onClick={() => go(i.href)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm ${
                    n === sel ? 'bg-brand-cream text-brand-brown' : 'text-brand-brown/90'
                  }`}
                >
                  <Icon size={17} className="shrink-0 text-brand-gold" />
                  <span className="flex-1 font-bold">{i.label}</span>
                  {i.hint && <span className="text-xs text-brand-muted">{i.hint}</span>}
                  {n === sel && <CornerDownLeft size={14} className="text-brand-muted" />}
                </button>
              </li>
            );
          })}
          {list.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-brand-muted">{t('لا توجد نتائج')}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
