'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input } from '@/components/ui';
import { formatAmman } from '@/lib/orders';
import { t } from '@/lib/i18n';

type Message = {
  id: string;
  direction: 'in' | 'out';
  phone: string;
  customerName: string | null;
  template: string | null;
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<string, [string, 'green' | 'gold' | 'red' | 'neutral']> = {
  queued: [t('في الانتظار'), 'neutral'],
  skipped: [t('لم يُرسل (واتساب غير مربوط)'), 'neutral'],
  sent: [t('أُرسل'), 'gold'],
  delivered: [t('وصل'), 'green'],
  read: [t('قُرئ'), 'green'],
  failed: [t('فشل'), 'red'],
  received: [t('وارد'), 'gold'],
};

export default function MessagesPage() {
  const { can } = useAuth();
  const [items, setItems] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (search) qs.set('search', search);
    if (direction) qs.set('direction', direction);
    const r = await api<{ items: Message[]; total: number }>(`/api/whatsapp/messages?${qs}`);
    setItems(r.items);
    setTotal(r.total);
  }, [search, direction]);

  useEffect(() => {
    const id = setTimeout(
      () => void load().catch((err) => setError(errorMessage(err, t('تعذّر التحميل')))),
      250,
    );
    return () => clearTimeout(id);
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/whatsapp/messages', { method: 'POST', body: JSON.stringify({ to, text }) });
      setText('');
      await load();
    } catch (err) {
      setError(errorMessage(err, t('تعذّر الإرسال')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-brown">{t('رسائل واتساب')}</h1>
        <p className="text-sm text-brand-muted">
          {t('كل الرسائل الصادرة والواردة مع حالة الوصول.')}
        </p>
      </div>
      <ErrorBox message={error} />

      {can('orders.manage') && (
        <Card title={t('رد على عميل')}>
          <form onSubmit={send} className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <Input
                label={t('الرقم')}
                dir="ltr"
                placeholder="0791234567"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="min-w-64 flex-1">
              <Input
                label={t('الرسالة')}
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {t('إرسال')}
            </Button>
          </form>
          <p className="mt-2 text-xs text-brand-muted">
            {t('الرد الحر يصل فقط خلال 24 ساعة من آخر رسالة من العميل (سياسة واتساب).')}
          </p>
        </Card>
      )}

      <Card
        title={t('الرسائل ({0})', total)}
        actions={
          <div className="flex gap-2">
            <input
              className="w-52 rounded-lg border border-brand-line px-3 py-2 text-sm"
              placeholder={t('بحث بالرقم أو النص أو العميل')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="rounded-lg border border-brand-line px-3 py-2 text-sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value as '' | 'in' | 'out')}
            >
              <option value="">{t('الكل')}</option>
              <option value="out">{t('الصادرة')}</option>
              <option value="in">{t('الواردة')}</option>
            </select>
          </div>
        }
      >
        <ul className="divide-y divide-stone-100 text-sm">
          {items.map((m) => {
            const [label, tone] = STATUS_LABELS[m.status] ?? [m.status, 'neutral'];
            return (
              <li key={m.id} className="flex gap-3 py-3">
                <span className="mt-0.5 text-lg">{m.direction === 'in' ? '⬅️' : '➡️'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{m.customerName ?? t('رقم غير مسجل')}</b>
                    <span dir="ltr" className="font-mono text-xs text-brand-muted">
                      +{m.phone}
                    </span>
                    <Badge tone={tone}>{label}</Badge>
                    <span className="text-xs text-brand-muted">{formatAmman(m.createdAt)}</span>
                  </div>
                  <div className="mt-1">{m.body}</div>
                  {m.error && <div className="mt-1 text-xs text-red-700">{m.error}</div>}
                </div>
              </li>
            );
          })}
          {items.length === 0 && <li className="py-3 text-brand-muted">{t('لا توجد رسائل')}</li>}
        </ul>
      </Card>
    </div>
  );
}
