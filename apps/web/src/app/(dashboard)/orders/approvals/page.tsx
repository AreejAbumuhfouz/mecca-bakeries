'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatJod } from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox } from '@/components/ui';
import type { OrderRow } from '@/lib/orders';
import { t } from '@/lib/i18n';

type Page = { items: OrderRow[]; total: number };

export default function ApprovalsPage() {
  const { can } = useAuth();
  const [pending, setPending] = useState<OrderRow[]>([]);
  const [drafts, setDrafts] = useState<OrderRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, d] = await Promise.all([
      api<Page>('/api/orders?status=pending_approval&pageSize=100'),
      api<Page>('/api/orders?status=draft&pageSize=100'),
    ]);
    setPending(p.items);
    setDrafts(d.items);
  }, []);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, [load]);

  async function decide(o: OrderRow, approve: boolean) {
    setError('');
    setBusy(o.id);
    try {
      await api(`/api/orders/${o.id}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
        body: JSON.stringify({ note: notes[o.id] ?? '' }),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err, t('تعذّر حفظ القرار')));
    } finally {
      setBusy(null);
    }
  }

  const canDecide = can('credit.override');

  return (
    <div className="space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-brand-muted underline">
          {t('← الطلبات')}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-brand-brown">
          {t('الموافقات الاستثنائية والمسودات')}
        </h1>
      </div>
      <ErrorBox message={error} />

      <Card title={t('بانتظار موافقة الإدارة ({0})', pending.length)}>
        {pending.length === 0 ? (
          <p className="text-sm text-brand-muted">{t('لا توجد طلبات موقوفة ✓')}</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {pending.map((o) => (
              <li key={o.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Link href={`/orders/${o.id}`} className="font-mono font-bold underline">
                    {o.number}
                  </Link>
                  <b>{o.customerName}</b>
                  <span>{o.branchName}</span>
                  <span className="font-mono">{o.deliveryDate}</span>
                  <b>{formatJod(o.total)}</b>
                </div>
                <ul className="list-inside list-disc text-sm text-red-800">
                  {o.creditReasons?.map((r) => (
                    <li key={r.code}>{t(r.key ?? r.message, ...(r.args ?? []))}</li>
                  ))}
                </ul>
                {canDecide && (
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="w-80 rounded-lg border border-brand-line px-3 py-2 text-sm"
                      placeholder={t('سبب القرار (مطلوب)')}
                      value={notes[o.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [o.id]: e.target.value })}
                    />
                    <Button
                      disabled={busy === o.id || (notes[o.id] ?? '').trim().length < 3}
                      onClick={() => void decide(o, true)}
                    >
                      {t('موافقة')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy === o.id || (notes[o.id] ?? '').trim().length < 3}
                      onClick={() => void decide(o, false)}
                    >
                      {t('رفض')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('مسودات من طلب الأمس لم تُؤكَّد ({0})', drafts.length)}>
        <p className="mb-3 text-sm text-brand-muted">
          {t(
            'تُنشأ تلقائياً منتصف الليل للفروع التي لم تطلب. إذا لم يؤكدها المطعم قبل الإغلاق تُلغى أو تُرسل حسب الإعدادات.',
          )}
        </p>
        <ul className="divide-y divide-stone-100 text-sm">
          {drafts.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 py-2">
              <Link href={`/orders/${o.id}`} className="font-mono font-bold underline">
                {o.number}
              </Link>
              <b>{o.customerName}</b>
              <span>{o.branchName}</span>
              <span className="font-mono">{o.deliveryDate}</span>
              <span>{formatJod(o.total)}</span>
            </li>
          ))}
          {drafts.length === 0 && <li className="py-2 text-brand-muted">{t('لا توجد مسودات')}</li>}
        </ul>
      </Card>
    </div>
  );
}
