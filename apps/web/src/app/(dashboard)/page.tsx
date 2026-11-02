'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CONTRACT_STATE_LABELS_AR, daysBetween, ammanDate } from '@mecca/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Card } from '@/components/ui';
import { STATE_TONE, type ContractRow } from '@/lib/contracts';

type Total = { total: number };
type Stat = { label: string; value: number | null; href: string };

export default function DashboardHome() {
  const { user, can } = useAuth();
  const [stats, setStats] = useState<Stat[]>([]);
  const [alerts, setAlerts] = useState<ContractRow[] | null>(null);

  useEffect(() => {
    const count = (path: string) =>
      api<Total>(path)
        .then((r) => r.total)
        .catch(() => null);
    const wanted: Promise<Stat>[] = [];
    if (can('customers.view'))
      wanted.push(
        count('/api/customers?isActive=true&pageSize=1').then((value) => ({
          label: 'العملاء الفعّالون',
          value,
          href: '/customers',
        })),
      );
    if (can('contracts.view')) {
      wanted.push(
        count('/api/contracts?state=active&pageSize=1').then((value) => ({
          label: 'عقود سارية',
          value,
          href: '/contracts',
        })),
        count('/api/contracts?state=expiring&pageSize=1').then((value) => ({
          label: 'عقود قاربت على الانتهاء',
          value,
          href: '/contracts',
        })),
      );
      void api<ContractRow[]>('/api/contracts/renewal-alerts')
        .then(setAlerts)
        .catch(() => setAlerts([]));
    }
    if (can('items.view'))
      wanted.push(
        count('/api/items?isActive=true&pageSize=1').then((value) => ({
          label: 'الأصناف الفعّالة',
          value,
          href: '/items',
        })),
      );
    void Promise.all(wanted).then(setStats);
  }, [can]);

  const today = ammanDate();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-brown">أهلاً {user?.name}</h1>
        <p className="text-sm text-brand-muted">
          مؤشرات الطلبات والمبيعات والذمم تظهر هنا بعد بناء وحداتها في المراحل القادمة.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card>
              <div className="text-sm text-brand-muted">{s.label}</div>
              <div className="mt-1 text-3xl font-bold text-brand-brown">{s.value ?? '—'}</div>
            </Card>
          </Link>
        ))}
      </div>

      {alerts && (
        <Card title={`تنبيهات تجديد العقود (${alerts.length})`}>
          {alerts.length === 0 ? (
            <p className="text-sm text-brand-muted">لا توجد عقود تحتاج إلى تجديد ✓</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {alerts.map((c) => {
                const left = daysBetween(today, c.endDate);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                    <Link href={`/contracts/${c.id}`} className="font-bold underline">
                      {c.customerName}
                    </Link>
                    <span className="font-mono text-brand-muted">{c.number}</span>
                    <Badge tone={STATE_TONE[c.state]}>{CONTRACT_STATE_LABELS_AR[c.state]}</Badge>
                    <span className={left < 0 ? 'text-red-700' : 'text-brand-muted'}>
                      {left < 0
                        ? `انتهى منذ ${-left} يوم`
                        : left === 0
                          ? 'ينتهي اليوم'
                          : `ينتهي بعد ${left} يوم (${c.endDate})`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
