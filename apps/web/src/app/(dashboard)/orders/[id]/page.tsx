'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  formatJod,
  ITEM_UNIT_LABELS_AR,
  ORDER_EVENT_LABELS_AR,
  ORDER_SOURCE_LABELS_AR,
  ORDER_STATUS_LABELS_AR,
} from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input, PageSkeleton } from '@/components/ui';
import { OrderLinesEditor, toLines, type Quantities } from '@/components/order-lines-editor';
import { formatAmman, STATUS_TONE, type CatalogItem, type Order } from '@/lib/orders';
import { t } from '@/lib/i18n';

type Change = { before?: { total: number }; after?: { total: number } };

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [editing, setEditing] = useState<Quantities | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setOrder(await api<Order>(`/api/orders/${id}`)), [id]);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر تحميل الطلب'))));
  }, [load]);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function startEdit() {
    if (!order) return;
    setCatalog(
      await api<CatalogItem[]>(
        `/api/orders/catalog?branchId=${order.branchId}&date=${order.deliveryDate}`,
      ),
    );
    setEditing(Object.fromEntries(order.lines.map((l) => [l.itemId, l.quantity])));
  }

  if (!order)
    return (
      <div className="space-y-4">
        <ErrorBox message={error} />
        {!error && <PageSkeleton />}
      </div>
    );

  const closed = ['cancelled', 'rejected'].includes(order.status);
  const canManage = can('orders.manage') && !closed;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/orders" className="text-sm text-brand-muted underline">
            {t('← الطلبات')}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-brand-brown">
            {t('طلب')} <span className="font-mono">{order.number}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/customers/${order.customerId}`} className="font-bold underline">
              {order.customerName}
            </Link>
            <span>— {order.branchName}</span>
            <Badge tone={STATUS_TONE[order.status]}>
              {t(ORDER_STATUS_LABELS_AR[order.status])}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-brand-muted">
            {t('التسليم يوم')} <b>{order.deliveryDate}</b>{' '}
            {t(
              '— إغلاق الطلبات {0} — المصدر: {1}',
              formatAmman(order.cutoffAt),
              t(ORDER_SOURCE_LABELS_AR[order.source]),
            )}
          </p>
        </div>
        {canManage && !editing && (
          <div className="flex flex-wrap gap-2">
            {order.status === 'draft' && (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api(`/api/orders/${id}/submit`, { method: 'POST' }),
                    t('تعذّر الإرسال'),
                  )
                }
              >
                {t('إرسال المسودة كطلب')}
              </Button>
            )}
            <Button variant="outline" onClick={() => void startEdit()}>
              {t('تعديل الأصناف')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api(`/api/orders/${id}/cancel`, {
                      method: 'POST',
                      body: JSON.stringify({ reason: note || null }),
                    }),
                  t('تعذّر الإلغاء'),
                )
              }
            >
              {t('إلغاء الطلب')}
            </Button>
          </div>
        )}
      </div>

      <ErrorBox message={error} />

      {order.status === 'pending_approval' && (
        <Card title={t('موقوف بسبب الائتمان')}>
          <ul className="mb-3 list-inside list-disc text-sm text-red-800">
            {order.creditReasons?.map((r) => (
              <li key={r.code}>{t(r.key ?? r.message, ...(r.args ?? []))}</li>
            ))}
          </ul>
          {can('credit.override') ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-80">
                <Input
                  label={t('سبب القرار (يُحفظ في السجل)')}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <Button
                disabled={busy || note.trim().length < 3}
                onClick={() =>
                  void run(
                    () =>
                      api(`/api/orders/${id}/approve`, {
                        method: 'POST',
                        body: JSON.stringify({ note }),
                      }),
                    t('تعذّرت الموافقة'),
                  ).then((ok) => ok && setNote(''))
                }
              >
                {t('موافقة استثنائية')}
              </Button>
              <Button
                variant="outline"
                disabled={busy || note.trim().length < 3}
                onClick={() =>
                  void run(
                    () =>
                      api(`/api/orders/${id}/reject`, {
                        method: 'POST',
                        body: JSON.stringify({ note }),
                      }),
                    t('تعذّر الرفض'),
                  ).then((ok) => ok && setNote(''))
                }
              >
                {t('رفض')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-brand-muted">
              {t('الموافقة تحتاج صلاحية «الموافقة على تجاوز الائتمان».')}
            </p>
          )}
        </Card>
      )}

      {editing ? (
        <Card title={t('تعديل الأصناف')}>
          <OrderLinesEditor catalog={catalog} quantities={editing} onChange={setEditing} />
          <div className="mt-4 flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api(`/api/orders/${id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ lines: toLines(editing) }),
                    }),
                  t('تعذّر حفظ التعديل'),
                ).then((ok) => ok && setEditing(null))
              }
            >
              {t('حفظ التعديل')}
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('إلغاء')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card title={t('الأصناف ({0})', order.lines.length)}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line text-start text-brand-muted">
                  <th className="py-2">{t('الكود')}</th>
                  <th>{t('الصنف')}</th>
                  <th>{t('الكمية')}</th>
                  <th>{t('سعر الوحدة')}</th>
                  <th>{t('المجموع')}</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.itemId} className="border-b border-stone-100">
                    <td className="py-2 pe-4 font-mono">{l.code}</td>
                    <td className="font-bold">{l.name}</td>
                    <td>
                      {l.quantity} {t(ITEM_UNIT_LABELS_AR[l.unit])}
                    </td>
                    <td>
                      {formatJod(l.unitPrice)}
                      {l.priceSource === 'contract' && (
                        <span className="ms-1 text-xs text-brand-gold">{t('سعر خاص')}</span>
                      )}
                    </td>
                    <td className="font-bold">{formatJod(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="py-3 pe-4 text-end font-bold">
                    {t('المجموع')}
                  </td>
                  <td className="text-lg font-bold text-brand-brown">{formatJod(order.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {order.notes && <p className="mt-2 text-sm">{t('ملاحظات المطعم: {0}', order.notes)}</p>}
          {order.cancelReason && (
            <p className="mt-2 text-sm text-red-800">{t('سبب الإلغاء: {0}', order.cancelReason)}</p>
          )}
        </Card>
      )}

      <Card title={t('سجل الطلب')}>
        <ol className="space-y-3 border-s-2 border-brand-line ps-4 text-sm">
          {order.events.map((e) => {
            const change = e.data as Change | null;
            return (
              <li key={e.id}>
                <div className="font-bold text-brand-brown">{t(ORDER_EVENT_LABELS_AR[e.type])}</div>
                <div className="text-xs text-brand-muted">
                  {formatAmman(e.createdAt)} — {e.actorName ?? t('النظام')}
                </div>
                {e.note && <div className="mt-1">{t(e.note)}</div>}
                {change?.before && change.after && (
                  <div className="mt-1 text-xs">
                    {t(
                      'المجموع: {0} ← {1}',
                      formatJod(change.before.total),
                      formatJod(change.after.total),
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
