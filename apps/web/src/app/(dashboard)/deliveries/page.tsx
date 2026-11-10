'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FileText, MapPin, RefreshCw, Route as RouteIcon, Truck } from 'lucide-react';
import {
  ammanDate,
  DELIVERY_REASON_LABELS_AR,
  DELIVERY_STATUS_LABELS_AR,
  formatJod,
  TRIP_STATUS_LABELS_AR,
} from '@mecca/shared';
import { api, errorMessage, openAuthed } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox } from '@/components/ui';
import { formatAmman } from '@/lib/orders';
import { DELIVERY_TONE, TRIP_TONE, type DistributionDay } from '@/lib/billing';
import { t } from '@/lib/i18n';

export default function DeliveriesPage() {
  const { can } = useAuth();
  const canManage = can('deliveries.manage');
  const [date, setDate] = useState(ammanDate());
  const [day, setDay] = useState<DistributionDay | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDay(await api<DistributionDay>(`/api/distribution/days/${date}`));
  }, [date]);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, [load]);

  async function generate() {
    setError('');
    setBusy(true);
    try {
      setDay(
        await api<DistributionDay>(`/api/distribution/days/${date}/generate`, { method: 'POST' }),
      );
    } catch (err) {
      setError(errorMessage(err, t('تعذّر تجهيز المسارات')));
    } finally {
      setBusy(false);
    }
  }

  const all = day?.trips.flatMap((tr) => tr.deliveries) ?? [];
  const stat = (label: string, value: string | number, tone = '') => (
    <Card>
      <div className="text-sm text-brand-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone || 'text-brand-brown'}`}>{value}</div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-brand-brown">
            <Truck size={24} /> {t('التوزيع والسائقون')}
          </h1>
          <p className="text-sm text-brand-muted">
            {t('المسارات تُجهَّز تلقائياً عند إغلاق الطلبات من الطلبات المؤكدة.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm"
          />
          {canManage && (
            <Button variant="outline" disabled={busy} onClick={() => void generate()}>
              <span className="flex items-center gap-1.5">
                <RefreshCw size={15} /> {t('تحديث من الطلبات')}
              </span>
            </Button>
          )}
          <Link href="/deliveries/routes">
            <Button variant="outline">
              <span className="flex items-center gap-1.5">
                <RouteIcon size={15} /> {t('المسارات')}
              </span>
            </Button>
          </Link>
        </div>
      </div>
      <ErrorBox message={error} />

      {day && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {stat(t('التوصيلات'), all.length)}
            {stat(t('بانتظار التسليم'), all.filter((d) => d.status === 'pending').length)}
            {stat(
              t('سُلِّم'),
              all.filter((d) => d.status === 'delivered' || d.status === 'partial').length,
              'text-green-800',
            )}
            {stat(t('لم يُسلَّم'), all.filter((d) => d.status === 'failed').length, 'text-red-800')}
            {stat(t('المحصّل نقداً'), formatJod(day.trips.reduce((s, tr) => s + tr.collected, 0)))}
          </div>

          {(day.unassigned.length > 0 || day.notConfirmed > 0) && (
            <div className="rounded-xl border border-brand-gold bg-brand-gold-light/40 px-4 py-3 text-sm text-brand-brown">
              {day.unassigned.length > 0 && (
                <div>
                  <b>{t('{0} طلب مؤكد بدون مسار:', day.unassigned.length)}</b>{' '}
                  {day.unassigned.map((u) => `${u.customerName} — ${u.branchName}`).join(t('، '))}.{' '}
                  <Link href="/deliveries/routes" className="underline">
                    {t('أضيفي فروعها لمسار')}
                  </Link>{' '}
                  {t('ثم «تحديث من الطلبات».')}
                </div>
              )}
              {day.notConfirmed > 0 && (
                <div>{t('{0} طلب لم يتأكد بعد (يدخل المسارات بعد تأكيده).', day.notConfirmed)}</div>
              )}
            </div>
          )}

          {day.trips.length === 0 && (
            <Card>
              <p className="text-sm text-brand-muted">
                {t(
                  'لا توجد مسارات لهذا اليوم بعد. تُجهَّز عند إغلاق الطلبات، أو اضغطي «تحديث من الطلبات».',
                )}
              </p>
            </Card>
          )}

          {day.trips.map((tr) => (
            <Card
              key={tr.id}
              title={tr.routeName}
              actions={
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={TRIP_TONE[tr.status]}>{TRIP_STATUS_LABELS_AR[tr.status]}</Badge>
                  <span className="text-brand-muted">
                    {tr.driverName ?? t('بدون سائق')} — {tr.vehicleName ?? t('بدون سيارة')}
                  </span>
                  <Button
                    variant="outline"
                    className="!px-3 !py-1.5"
                    onClick={() =>
                      void openAuthed(`/api/distribution/trips/${tr.id}/sheet`).catch((err) =>
                        setError(errorMessage(err, t('تعذّر فتح الكشف'))),
                      )
                    }
                  >
                    <span className="flex items-center gap-1.5">
                      <FileText size={14} /> {t('كشف التحميل')}
                    </span>
                  </Button>
                  <Link href={`/deliveries/trips/${tr.id}`} className="text-brand-brown underline">
                    {t('التفاصيل')}
                  </Link>
                </div>
              }
            >
              <div className="mb-3 flex flex-wrap gap-4 text-sm text-brand-muted">
                <span>
                  {t(
                    '{0} / {1} تم',
                    tr.counts.delivered + tr.counts.partial + tr.counts.failed,
                    tr.counts.total,
                  )}
                </span>
                <span>{t('الفواتير: {0}', formatJod(tr.invoiced))}</span>
                <span>{t('المحصّل: {0}', formatJod(tr.collected))}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-line text-right text-brand-muted">
                      <th className="py-2">#</th>
                      <th>{t('المطعم')}</th>
                      <th>{t('الطلب')}</th>
                      <th>{t('الحالة')}</th>
                      <th>{t('المستلم والوقت')}</th>
                      <th>{t('الفاتورة')}</th>
                      <th>{t('المحصّل')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tr.deliveries.map((d, i) => (
                      <tr key={d.id} className="border-b border-stone-100">
                        <td className="py-2 text-brand-muted">{i + 1}</td>
                        <td>
                          <b>{d.customerName}</b> — {d.branchName}
                          <div className="text-xs text-brand-muted">{d.address}</div>
                        </td>
                        <td className="font-mono">
                          <Link href={`/orders/${d.orderId}`} className="underline">
                            {d.orderNumber}
                          </Link>
                        </td>
                        <td>
                          <Badge tone={DELIVERY_TONE[d.status]}>
                            {DELIVERY_STATUS_LABELS_AR[d.status]}
                          </Badge>
                          {d.failReason && (
                            <div className="text-xs text-red-700">
                              {DELIVERY_REASON_LABELS_AR[d.failReason]}
                            </div>
                          )}
                        </td>
                        <td className="text-xs">
                          {d.receiverName ?? ''}
                          {d.deliveredAt && (
                            <div className="text-brand-muted">{formatAmman(d.deliveredAt)}</div>
                          )}
                        </td>
                        <td className="font-mono text-xs">
                          {d.invoiceId ? (
                            <Link href={`/invoices/${d.invoiceId}`} className="underline">
                              {d.invoiceNumber}
                            </Link>
                          ) : (
                            '—'
                          )}
                          {d.invoiceTotal != null && (
                            <div className="text-brand-muted">{formatJod(d.invoiceTotal)}</div>
                          )}
                        </td>
                        <td>{d.collectedAmount ? formatJod(d.collectedAmount) : '—'}</td>
                        <td>
                          {d.latitude != null && (
                            <a
                              href={`https://www.google.com/maps?q=${d.latitude},${d.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              title={t('موقع التسليم')}
                              className="text-brand-gold"
                            >
                              <MapPin size={16} />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
