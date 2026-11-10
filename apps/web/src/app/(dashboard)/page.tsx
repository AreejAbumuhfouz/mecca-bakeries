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

const PROD_LABEL = { preliminary: 'خطة مبدئية', final: 'خطة نهائية', closed: 'يوم مغلق' } as const;

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
  const max = Math.max(1, ...(k?.money?.trend.map((t) => t.sales) ?? [1]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-brown">أهلاً {user?.name}</h1>
        <p className="text-sm text-brand-muted">
          يوم {today}
          {k && ` — الطلبات المفتوحة لتسليم ${k.orderingFor}`}
        </p>
      </div>

      {k && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {k.orders && (
            <Tile
              icon={ClipboardList}
              label={`طلبات ${k.orderingFor}`}
              value={`${k.orders.placed} / ${k.orders.branches}`}
              note={`${formatJod(k.orders.value)}${k.orders.pending ? ` — ${k.orders.pending} بانتظار موافقة` : ''}`}
              href="/orders"
            />
          )}
          {k.deliveries && (
            <Tile
              icon={Truck}
              label="توصيلات اليوم"
              value={`${k.deliveries.delivered} / ${k.deliveries.total}`}
              note={`${k.deliveries.pending} بالطريق${k.deliveries.failed ? ` — ${k.deliveries.failed} لم تُسلَّم` : ''}`}
              href="/deliveries"
            />
          )}
          {k.money && (
            <>
              <Tile
                icon={Receipt}
                label="مبيعات اليوم"
                value={formatJod(k.money.salesToday)}
                note={
                  k.money.drafts ? `${k.money.drafts} فاتورة مسودة للاعتماد` : 'كل الفواتير معتمدة'
                }
                href="/invoices"
              />
              <Tile
                icon={Wallet}
                label="المقبوض اليوم"
                value={formatJod(k.money.receivedToday)}
                href="/payments"
              />
              <Tile
                icon={Wallet}
                label="إجمالي الذمم"
                value={formatJod(k.money.receivables)}
                href="/payments"
              />
              <Tile
                icon={AlertTriangle}
                label="المتأخر"
                value={formatJod(k.money.overdue)}
                note={`${k.money.overdueCustomers} عميل`}
                href="/payments"
                tone={k.money.overdue ? 'text-red-800' : 'text-green-800'}
              />
            </>
          )}
          {k.production && (
            <Tile
              icon={Factory}
              label="إنتاج اليوم"
              value={k.production.status ? PROD_LABEL[k.production.status] : 'لا خطة بعد'}
              note={k.production.items ? `${k.production.items} صنف` : undefined}
              href="/production"
            />
          )}
          {k.contracts && (
            <Tile
              icon={FileSignature}
              label="عقود تنتهي خلال 30 يوم"
              value={k.contracts.expiring}
              href="/contracts"
              tone={k.contracts.expiring ? 'text-amber-900' : ''}
            />
          )}
          {k.purchasing && (
            <Tile
              icon={ShoppingCart}
              label="طلبات شراء مفتوحة"
              value={k.purchasing.open}
              href="/purchasing"
            />
          )}
        </div>
      )}

      {k?.money && (
        <Card title="المبيعات — آخر 14 يوم">
          <div className="flex h-40 items-end gap-1.5" role="img" aria-label="رسم المبيعات اليومية">
            {k.money.trend.map((t) => (
              <div
                key={t.day}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[10px] text-brand-muted tabular-nums">
                  {t.sales ? filsToJodString(t.sales).replace(/\.\d+$/, '') : ''}
                </span>
                <div
                  title={`${t.day}: ${formatJod(t.sales)}`}
                  className={`w-full rounded-t ${t.day === today ? 'bg-brand-gold' : 'bg-primary'}`}
                  style={{
                    height: `${Math.max(2, (t.sales / max) * 100)}%`,
                    opacity: t.sales ? 1 : 0.25,
                  }}
                />
                <span className="text-[10px] text-brand-muted">{t.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

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
