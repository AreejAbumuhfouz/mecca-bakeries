'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  CONTRACT_STATE_LABELS_AR,
  daysBetween,
  ammanDate,
  filsToJodString,
  formatJod,
} from '@mecca/shared';
import {
  AlertTriangle,
  ClipboardList,
  Factory,
  FileSignature,
  Receipt,
  ShoppingCart,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Card } from '@/components/ui';
import { STATE_TONE, type ContractRow } from '@/lib/contracts';
import { t } from '@/lib/i18n';

type Kpis = {
  today: string;
  orderingFor: string;
  orders?: { placed: number; value: number; pending: number; branches: number };
  deliveries?: {
    total: number;
    pending: number;
    delivered: number;
    failed: number;
    collected: number;
  };
  money?: {
    salesToday: number;
    drafts: number;
    receivedToday: number;
    receivables: number;
    overdue: number;
    overdueCustomers: number;
    trend: { day: string; sales: number }[];
  };
  production?: { status: 'preliminary' | 'final' | 'closed' | null; items: number };
  contracts?: { expiring: number };
  purchasing?: { open: number };
};

const PROD_LABEL = {
  preliminary: t('خطة مبدئية'),
  final: t('خطة نهائية'),
  closed: t('يوم مغلق'),
} as const;

function Tile({
  icon: Icon,
  label,
  value,
  note,
  href,
  tone = '',
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  note?: string;
  href: string;
  tone?: string;
}) {
  return (
    <Link href={href} className="group">
      <Card>
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-brand-muted">{label}</div>
          <Icon size={18} className="text-brand-gold" />
        </div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${tone || 'text-brand-brown'}`}>
          {value}
        </div>
        {note && <div className="mt-1 text-xs text-brand-muted">{note}</div>}
      </Card>
    </Link>
  );
}

export default function DashboardHome() {
  const { user, can } = useAuth();
  const [k, setK] = useState<Kpis | null>(null);
  const [alerts, setAlerts] = useState<ContractRow[] | null>(null);

  useEffect(() => {
    void api<Kpis>('/api/reports/kpis')
      .then(setK)
      .catch(() => setK(null));
    if (can('contracts.view'))
      void api<ContractRow[]>('/api/contracts/renewal-alerts')
        .then(setAlerts)
        .catch(() => setAlerts([]));
  }, [can]);

  const today = ammanDate();
  const max = Math.max(1, ...(k?.money?.trend.map((tr) => tr.sales) ?? [1]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-brown">{t('أهلاً {0}', user?.name)}</h1>
        <p className="text-sm text-brand-muted">
          {t('يوم {0}', today)}
          {k && t(' — الطلبات المفتوحة لتسليم {0}', k.orderingFor)}
        </p>
      </div>

      {k && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {k.orders && (
            <Tile
              icon={ClipboardList}
              label={t('طلبات {0}', k.orderingFor)}
              value={`${k.orders.placed} / ${k.orders.branches}`}
              note={`${formatJod(k.orders.value)}${k.orders.pending ? t(' — {0} بانتظار موافقة', k.orders.pending) : ''}`}
              href="/orders"
            />
          )}
          {k.deliveries && (
            <Tile
              icon={Truck}
              label={t('توصيلات اليوم')}
              value={`${k.deliveries.delivered} / ${k.deliveries.total}`}
              note={t(
                '{0} بالطريق{1}',
                k.deliveries.pending,
                k.deliveries.failed ? t(' — {0} لم تُسلَّم', k.deliveries.failed) : '',
              )}
              href="/deliveries"
            />
          )}
          {k.money && (
            <>
              <Tile
                icon={Receipt}
                label={t('مبيعات اليوم')}
                value={formatJod(k.money.salesToday)}
                note={
                  k.money.drafts
                    ? t('{0} فاتورة مسودة للاعتماد', k.money.drafts)
                    : t('كل الفواتير معتمدة')
                }
                href="/invoices"
              />
              <Tile
                icon={Wallet}
                label={t('المقبوض اليوم')}
                value={formatJod(k.money.receivedToday)}
                href="/payments"
              />
              <Tile
                icon={Wallet}
                label={t('إجمالي الذمم')}
                value={formatJod(k.money.receivables)}
                href="/payments"
              />
              <Tile
                icon={AlertTriangle}
                label={t('المتأخر')}
                value={formatJod(k.money.overdue)}
                note={t('{0} عميل', k.money.overdueCustomers)}
                href="/payments"
                tone={k.money.overdue ? 'text-red-800' : 'text-green-800'}
              />
            </>
          )}
          {k.production && (
            <Tile
              icon={Factory}
              label={t('إنتاج اليوم')}
              value={k.production.status ? PROD_LABEL[k.production.status] : t('لا خطة بعد')}
              note={k.production.items ? t('{0} صنف', k.production.items) : undefined}
              href="/production"
            />
          )}
          {k.contracts && (
            <Tile
              icon={FileSignature}
              label={t('عقود تنتهي خلال 30 يوم')}
              value={k.contracts.expiring}
              href="/contracts"
              tone={k.contracts.expiring ? 'text-amber-900' : ''}
            />
          )}
          {k.purchasing && (
            <Tile
              icon={ShoppingCart}
              label={t('طلبات شراء مفتوحة')}
              value={k.purchasing.open}
              href="/purchasing"
            />
          )}
        </div>
      )}

      {k?.money && (
        <Card title={t('المبيعات — آخر 14 يوم')}>
          <div
            className="flex h-40 items-end gap-1.5"
            role="img"
            aria-label={t('رسم المبيعات اليومية')}
          >
            {k.money.trend.map((tr) => (
              <div
                key={tr.day}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[10px] text-brand-muted tabular-nums">
                  {tr.sales ? filsToJodString(tr.sales).replace(/\.\d+$/, '') : ''}
                </span>
                <div
                  title={`${tr.day}: ${formatJod(tr.sales)}`}
                  className={`w-full rounded-t ${tr.day === today ? 'bg-brand-gold' : 'bg-primary'}`}
                  style={{
                    height: `${Math.max(2, (tr.sales / max) * 100)}%`,
                    opacity: tr.sales ? 1 : 0.25,
                  }}
                />
                <span className="text-[10px] text-brand-muted">{tr.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {alerts && (
        <Card title={t('تنبيهات تجديد العقود ({0})', alerts.length)}>
          {alerts.length === 0 ? (
            <p className="text-sm text-brand-muted">{t('لا توجد عقود تحتاج إلى تجديد ✓')}</p>
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
                    <Badge tone={STATE_TONE[c.state]}>{t(CONTRACT_STATE_LABELS_AR[c.state])}</Badge>
                    <span className={left < 0 ? 'text-red-700' : 'text-brand-muted'}>
                      {left < 0
                        ? t('انتهى منذ {0} يوم', -left)
                        : left === 0
                          ? t('ينتهي اليوم')
                          : t('ينتهي بعد {0} يوم ({1})', left, c.endDate)}
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
