'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FileText, Send } from 'lucide-react';
import {
  addDays,
  AGING_BUCKETS,
  AGING_LABELS_AR,
  ammanDate,
  filsToJodString,
  formatJod,
} from '@mecca/shared';
import { api, errorMessage, openAuthed } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox, Input } from '@/components/ui';
import { jodToFils, type Statement } from '@/lib/billing';
import { t } from '@/lib/i18n';

export default function CustomerAccountPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [from, setFrom] = useState(addDays(ammanDate(), -90));
  const [to, setTo] = useState(ammanDate());
  const [st, setSt] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState({ amount: '', date: '' });

  const load = useCallback(async () => {
    setSt(await api<Statement>(`/api/billing/customers/${id}/statement?from=${from}&to=${to}`));
  }, [id, from, to]);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string, fallback: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(errorMessage(err, fallback));
    }
  }

  if (!st) return <ErrorBox message={error} />;
  const s = st.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/payments" className="text-sm text-brand-muted underline">
            {t('← المقبوضات والذمم')}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-brand-brown">
            {t('كشف حساب {0}', st.customer.name)}{' '}
            <span className="font-mono text-base text-brand-muted">{st.customer.code}</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void openAuthed(
                `/api/billing/customers/${id}/statement/pdf?from=${from}&to=${to}`,
              ).catch((err) => setError(errorMessage(err, t('تعذّر فتح PDF'))))
            }
          >
            <span className="flex items-center gap-1.5">
              <FileText size={15} /> PDF
            </span>
          </Button>
          {can('payments.manage') && (
            <Button
              variant="gold"
              onClick={() =>
                void run(
                  async () => {
                    const r = await api<{ whatsapp: string }>(
                      `/api/billing/customers/${id}/send-statement`,
                      { method: 'POST' },
                    );
                    if (r.whatsapp === 'skipped')
                      throw new Error(t('سُجّل الإرسال لكن واتساب غير مربوط بعد'));
                    if (r.whatsapp === 'no_phone')
                      throw new Error(t('لا يوجد رقم هاتف للعميل أو فروعه'));
                  },
                  t('تم إرسال كشف الحساب على واتساب ✓'),
                  t('تعذّر الإرسال'),
                )
              }
            >
              <span className="flex items-center gap-1.5">
                <Send size={15} /> {t('إرسال على واتساب')}
              </span>
            </Button>
          )}
        </div>
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{notice}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-7">
        <Card>
          <div className="text-sm text-brand-muted">{t('الرصيد')}</div>
          <div className="mt-1 text-xl font-bold text-brand-brown">{formatJod(s.balance)}</div>
        </Card>
        <Card>
          <div className="text-sm text-brand-muted">{t('المتأخر')}</div>
          <div className="mt-1 text-xl font-bold text-red-800">{formatJod(s.overdue)}</div>
        </Card>
        {AGING_BUCKETS.map((b) => (
          <Card key={b}>
            <div className="text-sm text-brand-muted">{t(AGING_LABELS_AR[b])}</div>
            <div className="mt-1 text-lg font-bold">{filsToJodString(s.aging[b])}</div>
          </Card>
        ))}
      </div>

      <Card
        title={t('الحركات')}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {t('من')}{' '}
            <input
              type="date"
              className="h-10 rounded-lg border border-brand-line bg-surface px-3"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            {t('إلى')}{' '}
            <input
              type="date"
              className="h-10 rounded-lg border border-brand-line bg-surface px-3"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-start text-brand-muted">
                <th className="py-2">{t('التاريخ')}</th>
                <th>{t('الرقم')}</th>
                <th>{t('البيان')}</th>
                <th>{t('مدين')}</th>
                <th>{t('دائن')}</th>
                <th>{t('الرصيد')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-stone-100 bg-brand-cream/50">
                <td className="py-2" colSpan={5}>
                  <b>{t('رصيد سابق')}</b>
                </td>
                <td className="font-bold">{filsToJodString(st.opening)}</td>
              </tr>
              {st.rows.map((r, i) => (
                <tr key={i} className="border-b border-stone-100">
                  <td className="py-2 font-mono">{r.date}</td>
                  <td className="font-mono">{r.number}</td>
                  <td>{r.description}</td>
                  <td>{r.debit ? filsToJodString(r.debit) : ''}</td>
                  <td className="text-green-800">{r.credit ? filsToJodString(r.credit) : ''}</td>
                  <td className="font-bold">{filsToJodString(r.balance)}</td>
                </tr>
              ))}
              <tr className="bg-brand-cream/50">
                <td className="py-2" colSpan={5}>
                  <b>{t('الرصيد الختامي')}</b>
                </td>
                <td className="font-bold">{filsToJodString(st.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card title={t('التذكير اليومي بالرصيد')}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={st.customer.balanceAlerts}
              disabled={!can('payments.manage')}
              onChange={(e) =>
                void run(
                  () =>
                    api(`/api/billing/customers/${id}/alerts`, {
                      method: 'PATCH',
                      body: JSON.stringify({ enabled: e.target.checked }),
                    }),
                  t('تم الحفظ'),
                  t('تعذّر الحفظ'),
                )
              }
            />
            {t('إرسال كشف الحساب لهذا العميل على واتساب والتطبيق ضمن التذكير اليومي')}
          </label>
          <p className="mt-2 text-xs text-brand-muted">
            {t('وقت التذكير والحد الأدنى للمبلغ من «الإعدادات».')}
          </p>
        </Card>
        {can('invoices.manage') && (
          <Card title={t('رصيد افتتاحي (من قبل النظام)')}>
            <div className="grid grid-cols-2 items-end gap-3">
              <Input
                label={t('المبلغ (دينار)')}
                dir="ltr"
                value={opening.amount}
                onChange={(e) => setOpening({ ...opening, amount: e.target.value })}
              />
              <Input
                label={t('تاريخ الاستحقاق')}
                type="date"
                value={opening.date}
                onChange={(e) => setOpening({ ...opening, date: e.target.value })}
              />
              <Button
                className="col-span-2"
                disabled={!opening.amount || !opening.date}
                onClick={() => {
                  const amount = jodToFils(opening.amount);
                  if (!amount) return setError(t('المبلغ غير صحيح'));
                  void run(
                    () =>
                      api(`/api/billing/customers/${id}/opening`, {
                        method: 'POST',
                        body: JSON.stringify({ amount, date: opening.date }),
                      }),
                    t('تم تسجيل الرصيد الافتتاحي'),
                    t('تعذّر الحفظ'),
                  ).then(() => setOpening({ amount: '', date: '' }));
                }}
              >
                {t('تسجيل الرصيد الافتتاحي')}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
