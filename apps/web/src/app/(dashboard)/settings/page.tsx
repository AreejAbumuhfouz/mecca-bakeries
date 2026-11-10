'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { filsToJodString, type OrderSettings, type ReceivablesSettings } from '@mecca/shared';
import { jodToFils } from '@/lib/billing';
import { api, errorMessage, fetchAuthedBlob } from '@/lib/api';
import { Button, Card, ErrorBox, Input, PageSkeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { formatAmman } from '@/lib/orders';
import { t } from '@/lib/i18n';

type Template = { name: string; label: string; body: string };
type Run = {
  job: string;
  runKey: string;
  startedAt: string;
  result: unknown;
  error: string | null;
};

const JOB_LABELS: Record<string, string> = {
  reminder: t('تذكير'),
  drafts: t('مسودات'),
  cutoff: t('إغلاق'),
  balance_alerts: t('تذكير الذمم'),
};

/** Daily reminder of unpaid balances. */
function ReceivablesCard() {
  const [r, setR] = useState<ReceivablesSettings | null>(null);
  const [min, setMin] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void api<ReceivablesSettings>('/api/settings/receivables').then((v) => {
      setR(v);
      setMin(filsToJodString(v.minAmount));
    });
  }, []);
  if (!r) return null;
  async function save() {
    const minAmount = jodToFils(min || '0');
    if (minAmount === null) return setMsg(t('المبلغ غير صحيح'));
    try {
      setR(
        await api<ReceivablesSettings>('/api/settings/receivables', {
          method: 'PUT',
          body: JSON.stringify({ ...r, minAmount }),
        }),
      );
      setMsg(t('تم الحفظ ✓'));
    } catch (err) {
      setMsg(errorMessage(err, t('تعذّر الحفظ')));
    }
  }
  return (
    <Card title={t('تذكير الذمم اليومي')}>
      <div className="space-y-3">
        <Toggle
          label={t('إرسال كشف الحساب يومياً للعملاء (واتساب + التطبيق)')}
          checked={r.alertsEnabled}
          onChange={(v) => setR({ ...r, alertsEnabled: v })}
        />
        <Toggle
          label={t('فقط لمن عليه مبلغ متأخر')}
          checked={r.onlyOverdue}
          onChange={(v) => setR({ ...r, onlyOverdue: v })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('وقت الإرسال')}
            type="time"
            value={r.alertTime}
            onChange={(e) => setR({ ...r, alertTime: e.target.value })}
          />
          <Input
            label={t('أقل رصيد (دينار)')}
            dir="ltr"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void save()}>
            {t('حفظ')}
          </Button>
          <span className="text-sm text-brand-muted">{msg}</span>
        </div>
        <p className="text-xs text-brand-muted">
          {t('يمكن إيقافه لعميل معيّن من صفحة كشف حسابه.')}
        </p>
      </div>
    </Card>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-bold text-brand-brown">
      <input
        type="checkbox"
        className="h-4 w-4 accent-brand-gold"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState<OrderSettings | null>(null);
  const [templates, setTemplates] = useState<{ configured: boolean; templates: Template[] } | null>(
    null,
  );
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void api<OrderSettings>('/api/settings/orders')
      .then(setS)
      .catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
    void api<{ configured: boolean; templates: Template[] }>('/api/whatsapp/templates')
      .then(setTemplates)
      .catch(() => undefined);
    void api<Run[]>('/api/orders/scheduler-runs')
      .then(setRuns)
      .catch(() => undefined);
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setError('');
    setBusy(true);
    try {
      setS(
        await api<OrderSettings>('/api/settings/orders', {
          method: 'PUT',
          body: JSON.stringify(s),
        }),
      );
      toast.success(t('تم حفظ الإعدادات ✓'));
    } catch (err) {
      toast.error(errorMessage(err, t('تعذّر الحفظ')));
    } finally {
      setBusy(false);
    }
  }

  if (!s) return error ? <ErrorBox message={error} /> : <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-brown">{t('الإعدادات')}</h1>
        <p className="text-sm text-brand-muted">{t('كل الأوقات بتوقيت عمّان.')}</p>
      </div>
      <ErrorBox message={error} />

      <form onSubmit={save} className="space-y-6">
        <Card title={t('مواعيد الطلبات')}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input
              label={t('إغلاق استقبال الطلبات')}
              type="time"
              value={s.cutoffTime}
              onChange={(e) => setS({ ...s, cutoffTime: e.target.value })}
            />
            <Input
              label={t('إنشاء مسودات من طلب الأمس')}
              type="time"
              value={s.draftTime}
              onChange={(e) => setS({ ...s, draftTime: e.target.value })}
            />
            <div className="space-y-2 self-end pb-2">
              <Toggle
                label={t('إنشاء المسودات')}
                checked={s.draftsEnabled}
                onChange={(v) => setS({ ...s, draftsEnabled: v })}
              />
              <Toggle
                label={t('إرسال المسودة غير المؤكدة تلقائياً عند الإغلاق')}
                checked={s.autoSubmitDrafts}
                onChange={(v) => setS({ ...s, autoSubmitDrafts: v })}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-brand-muted">
            {t(
              'الإغلاق قبل الظهر (مثل 03:00) يكون في يوم التسليم نفسه؛ بعد الظهر (مثل 22:00) يكون في الليلة السابقة.',
            )}
          </p>
        </Card>

        <Card title={t('التذكيرات')}>
          <div className="mb-3">
            <Toggle
              label={t('إرسال تذكيرات للفروع التي لم تطلب')}
              checked={s.remindersEnabled}
              onChange={(v) => setS({ ...s, remindersEnabled: v })}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {s.reminderTimes.map((tr, i) => (
              <div key={i} className="flex items-end gap-1">
                <Input
                  label={t('تذكير {0}', i + 1)}
                  type="time"
                  value={tr}
                  onChange={(e) =>
                    setS({
                      ...s,
                      reminderTimes: s.reminderTimes.map((x, j) => (j === i ? e.target.value : x)),
                    })
                  }
                />
                <button
                  type="button"
                  className="mb-2 text-xs text-red-700 underline"
                  onClick={() =>
                    setS({ ...s, reminderTimes: s.reminderTimes.filter((_, j) => j !== i) })
                  }
                >
                  {t('حذف')}
                </button>
              </div>
            ))}
            {s.reminderTimes.length < 6 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setS({ ...s, reminderTimes: [...s.reminderTimes, '20:00'] })}
              >
                {t('+ وقت')}
              </Button>
            )}
          </div>
        </Card>

        <Card title={t('قنوات الإشعارات')}>
          <div className="flex flex-wrap gap-6">
            <Toggle
              label={t('رسائل واتساب')}
              checked={s.whatsappEnabled}
              onChange={(v) => setS({ ...s, whatsappEnabled: v })}
            />
            <Toggle
              label={t('إشعارات التطبيق')}
              checked={s.pushEnabled}
              onChange={(v) => setS({ ...s, pushEnabled: v })}
            />
          </div>
        </Card>

        <Button type="submit" disabled={busy}>
          {busy ? t('جارٍ الحفظ…') : t('حفظ الإعدادات')}
        </Button>
      </form>

      {templates && (
        <Card title={t('قوالب رسائل واتساب')}>
          <p className="mb-3 text-sm">
            {t('الحالة:')}{' '}
            {templates.configured ? (
              <b className="text-green-800">{t('مربوط بحساب واتساب ✓')}</b>
            ) : (
              <b className="text-red-800">{t('غير مربوط بعد — الرسائل تُسجَّل فقط ولا تُرسل')}</b>
            )}
          </p>
          <p className="mb-3 text-xs text-brand-muted">
            {t('تُسجَّل هذه القوالب في WhatsApp Manager بنفس الاسم، اللغة العربية، الفئة Utility.')}
          </p>
          <ul className="space-y-2 text-sm">
            {templates.templates.map((tr) => (
              <li key={tr.name} className="rounded-lg border border-brand-line p-3">
                <div className="font-bold">
                  {tr.label} <span className="font-mono text-xs text-brand-muted">{tr.name}</span>
                </div>
                <div className="mt-1 text-brand-muted">{tr.body}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ReceivablesCard />

      <Card title={t('بياناتكم')}>
        <p className="mb-3 text-sm text-brand-muted">
          {t(
            'البيانات ملك مخابز مكة بالكامل. يمكن تنزيل نسخة كاملة منها (كل جدول في ورقة Excel) في أي وقت.',
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void fetchAuthedBlob('/api/reports/export/all').then((blob) => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `mecca-bakeries-data-${new Date().toISOString().slice(0, 10)}.xlsx`;
              a.click();
            })
          }
        >
          {t('تنزيل كل البيانات (Excel)')}
        </Button>
        <Link href="/settings/import" className="ms-3 text-sm text-brand-brown underline">
          {t('نقل البيانات من Excel (العملاء، الأصناف، العقود، الأرصدة الافتتاحية)')}
        </Link>
      </Card>

      <Card title={t('آخر المهام المجدولة')}>
        <ul className="divide-y divide-stone-100 text-sm">
          {runs.map((r) => (
            <li key={`${r.job}-${r.runKey}`} className="flex flex-wrap gap-3 py-2">
              <b>{JOB_LABELS[r.job] ?? r.job}</b>
              <span className="font-mono">{r.runKey}</span>
              <span className="text-brand-muted">{formatAmman(r.startedAt)}</span>
              <span
                className={`min-w-0 break-all ${r.error ? 'text-red-700' : 'text-brand-muted'}`}
              >
                {r.error ?? JSON.stringify(r.result)}
              </span>
            </li>
          ))}
          {runs.length === 0 && (
            <li className="py-2 text-brand-muted">{t('لم تعمل أي مهمة بعد')}</li>
          )}
        </ul>
      </Card>
    </div>
  );
}
