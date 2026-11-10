'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import {
  DELIVERY_REASON_LABELS_AR,
  DELIVERY_STATUS_LABELS_AR,
  formatJod,
  PAYMENT_METHOD_LABELS_AR,
  PAYMENT_TYPE_LABELS_AR,
  TRIP_STATUS_LABELS_AR,
  type DeliveryReason,
  type DeliveryStatus,
  type PaymentMethod,
  type PaymentType,
  type TripStatus,
} from '@mecca/shared';
import { api, errorMessage, fetchAuthedBlob, openAuthed } from '@/lib/api';
import { Badge, Button, Card, ErrorBox } from '@/components/ui';
import { formatAmman } from '@/lib/orders';
import { DELIVERY_TONE, TRIP_TONE } from '@/lib/billing';
import { t } from '@/lib/i18n';

type Stop = {
  deliveryId: string;
  position: number;
  status: DeliveryStatus;
  order: { id: string; number: string; total: number };
  customer: { name: string; phone: string | null };
  branch: { name: string; address: string | null; phone: string | null };
  paymentType: PaymentType;
  balance: number;
  items: { itemId: string; name: string; quantity: number; unitLabel: string }[];
  result: {
    receiverName: string | null;
    deliveredAt: string | null;
    failReason: DeliveryReason | null;
    latitude: number | null;
    longitude: number | null;
    hasSignature: boolean;
    collectedAmount: number;
    collectedMethod: PaymentMethod | null;
    note: string | null;
    lines: {
      itemId: string;
      orderedQty: number;
      deliveredQty: number;
      shortReason: DeliveryReason | null;
      returnedQty: number;
      returnReason: DeliveryReason | null;
    }[];
    invoice: { id: string; number: string; total: number } | null;
  } | null;
};
type Trip = {
  id: string;
  deliveryDate: string;
  status: TripStatus;
  startedAt: string | null;
  finishedAt: string | null;
  route: { name: string };
  driver: { name: string } | null;
  vehicle: { name: string; plate: string | null } | null;
  stops: Stop[];
};

/** The signature is served as SVG; fetch it with the token and show it as an image. */
function Signature({ deliveryId }: { deliveryId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    void fetchAuthedBlob(`/api/distribution/deliveries/${deliveryId}/signature`)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => setSrc(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [deliveryId]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={t('توقيع المستلم')}
      className="h-16 rounded border border-brand-line bg-white"
    />
  );
}

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Trip>(`/api/distribution/trips/${id}`)
      .then(setTrip)
      .catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, [id]);
  if (!trip) return <ErrorBox message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/deliveries" className="text-sm text-brand-muted underline">
            {t('← التوزيع')}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-brand-brown">
            {trip.route.name} — <span className="font-mono">{trip.deliveryDate}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-brand-muted">
            <Badge tone={TRIP_TONE[trip.status]}>{TRIP_STATUS_LABELS_AR[trip.status]}</Badge>
            {trip.driver?.name ?? t('بدون سائق')} — {trip.vehicle?.name ?? t('بدون سيارة')}
            {trip.startedAt && <span>{t('خرج {0}', formatAmman(trip.startedAt))}</span>}
            {trip.finishedAt && <span>{t('انتهى {0}', formatAmman(trip.finishedAt))}</span>}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            void openAuthed(`/api/distribution/trips/${id}/sheet`).catch((err) =>
              setError(errorMessage(err, t('تعذّر فتح الكشف'))),
            )
          }
        >
          {t('كشف التحميل PDF')}
        </Button>
      </div>
      <ErrorBox message={error} />

      {trip.stops.map((s) => (
        <Card
          key={s.deliveryId}
          title={`${s.position}. ${s.customer.name} — ${s.branch.name}`}
          actions={
            <Badge tone={DELIVERY_TONE[s.status]}>{DELIVERY_STATUS_LABELS_AR[s.status]}</Badge>
          }
        >
          <div className="mb-3 flex flex-wrap gap-4 text-sm text-brand-muted">
            <span>{s.branch.address}</span>
            <span dir="ltr">{s.branch.phone ?? s.customer.phone}</span>
            <span>
              {t('الطلب')}{' '}
              <Link href={`/orders/${s.order.id}`} className="font-mono underline">
                {s.order.number}
              </Link>{' '}
              {formatJod(s.order.total)}
            </span>
            <span>{PAYMENT_TYPE_LABELS_AR[s.paymentType]}</span>
            <span>{t('الرصيد الحالي {0}', formatJod(s.balance))}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line text-right text-brand-muted">
                  <th className="py-1.5">{t('الصنف')}</th>
                  <th>{t('المطلوب')}</th>
                  <th>{t('المسلّم')}</th>
                  <th>{t('الناقص')}</th>
                  <th>{t('المرتجع')}</th>
                </tr>
              </thead>
              <tbody>
                {(s.result?.lines.length
                  ? s.result.lines
                  : s.items.map((i) => ({
                      itemId: i.itemId,
                      orderedQty: i.quantity,
                      deliveredQty: null,
                      shortReason: null,
                      returnedQty: 0,
                      returnReason: null,
                    }))
                ).map((l) => {
                  const item = s.items.find((i) => i.itemId === l.itemId);
                  const short = l.deliveredQty == null ? 0 : l.orderedQty - l.deliveredQty;
                  return (
                    <tr key={l.itemId} className="border-b border-stone-100">
                      <td className="py-1.5">{item?.name ?? t('صنف مرتجع')}</td>
                      <td>{l.orderedQty}</td>
                      <td className="font-bold">{l.deliveredQty ?? '—'}</td>
                      <td className={short ? 'text-red-800' : ''}>
                        {short || ''}{' '}
                        {l.shortReason && (
                          <span className="text-xs">
                            ({DELIVERY_REASON_LABELS_AR[l.shortReason]})
                          </span>
                        )}
                      </td>
                      <td>
                        {l.returnedQty || ''}{' '}
                        {l.returnReason && (
                          <span className="text-xs">
                            ({DELIVERY_REASON_LABELS_AR[l.returnReason]})
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {s.result && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              {s.result.failReason && (
                <b className="text-red-800">{DELIVERY_REASON_LABELS_AR[s.result.failReason]}</b>
              )}
              {s.result.receiverName && (
                <span>
                  {t('المستلم:')} <b>{s.result.receiverName}</b>
                </span>
              )}
              {s.result.deliveredAt && <span>{formatAmman(s.result.deliveredAt)}</span>}
              {s.result.latitude != null && (
                <a
                  className="flex items-center gap-1 text-brand-gold underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://www.google.com/maps?q=${s.result.latitude},${s.result.longitude}`}
                >
                  <MapPin size={14} /> {t('الموقع')}
                </a>
              )}
              {s.result.collectedAmount > 0 && (
                <span>
                  {t(
                    'حصّل {0} {1}',
                    formatJod(s.result.collectedAmount),
                    s.result.collectedMethod && PAYMENT_METHOD_LABELS_AR[s.result.collectedMethod],
                  )}
                </span>
              )}
              {s.result.invoice && (
                <Link href={`/invoices/${s.result.invoice.id}`} className="font-mono underline">
                  {s.result.invoice.number} — {formatJod(s.result.invoice.total)}
                </Link>
              )}
              {s.result.hasSignature && <Signature deliveryId={s.deliveryId} />}
              {s.result.note && <span className="text-brand-muted">{s.result.note}</span>}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
