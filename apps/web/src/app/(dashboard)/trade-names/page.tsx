'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, fileUrl } from '@/lib/api';
import { Badge, Button, Card, ErrorBox, Input, Textarea } from '@/components/ui';
import { ImageUpload } from '@/components/image-upload';
import { t } from '@/lib/i18n';

type TradeName = {
  id: string;
  name: string;
  nameEn: string | null;
  logoFileId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  invoiceFooter: string | null;
  isActive: boolean;
  customerCount: number;
};

type Form = {
  name: string;
  nameEn: string;
  logoFileId: string | null;
  phone: string;
  email: string;
  address: string;
  invoicePrefix: string;
  nextInvoiceNumber: string;
  invoiceFooter: string;
};

const empty: Form = {
  name: '',
  nameEn: '',
  logoFileId: null,
  phone: '',
  email: '',
  address: '',
  invoicePrefix: '',
  nextInvoiceNumber: '1',
  invoiceFooter: '',
};

const toForm = (tr: TradeName): Form => ({
  name: tr.name,
  nameEn: tr.nameEn ?? '',
  logoFileId: tr.logoFileId,
  phone: tr.phone ?? '',
  email: tr.email ?? '',
  address: tr.address ?? '',
  invoicePrefix: tr.invoicePrefix,
  nextInvoiceNumber: String(tr.nextInvoiceNumber),
  invoiceFooter: tr.invoiceFooter ?? '',
});

const invoiceExample = (prefix: string, n: string) =>
  `${prefix.toUpperCase() || 'XX'}-${String(Number(n) || 1).padStart(6, '0')}`;

export default function TradeNamesPage() {
  const [rows, setRows] = useState<TradeName[] | null>(null);
  /** null = form closed, 'new' = add, otherwise the id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setRows(await api<TradeName[]>('/api/trade-names')), []);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر تحميل الأسماء التجارية'))));
  }, [load]);

  const set = (key: keyof Form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const body = JSON.stringify({
      ...form,
      nextInvoiceNumber: Number(form.nextInvoiceNumber) || 1,
    });
    try {
      if (editing === 'new') await api('/api/trade-names', { method: 'POST', body });
      else await api(`/api/trade-names/${editing}`, { method: 'PATCH', body });
      setEditing(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('تعذّر الحفظ')));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(tr: TradeName) {
    setError('');
    try {
      await api(`/api/trade-names/${tr.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !tr.isActive }),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err, t('تعذّر التحديث')));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-brown">{t('الأسماء التجارية')}</h1>
          <p className="text-sm text-brand-muted">
            {t('لكل اسم تجاري شعاره وبياناته وتسلسل فواتير مستقل. يُربط كل عميل باسم تجاري واحد.')}
          </p>
        </div>
        {editing === null && (
          <Button
            onClick={() => {
              setForm(empty);
              setEditing('new');
            }}
          >
            {t('+ اسم تجاري جديد')}
          </Button>
        )}
      </div>

      <ErrorBox message={error} />

      {editing !== null && (
        <Card title={editing === 'new' ? t('اسم تجاري جديد') : t('تعديل الاسم التجاري')}>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input
                label={t('الاسم')}
                required
                minLength={2}
                value={form.name}
                onChange={set('name')}
              />
              <Input
                label={t('الاسم بالإنجليزية')}
                dir="ltr"
                value={form.nameEn}
                onChange={set('nameEn')}
              />
              <ImageUpload
                label={t('الشعار')}
                value={form.logoFileId}
                onChange={(logoFileId) => setForm({ ...form, logoFileId })}
              />
              <Input label={t('الهاتف')} dir="ltr" value={form.phone} onChange={set('phone')} />
              <Input
                label={t('البريد الإلكتروني')}
                type="email"
                dir="ltr"
                value={form.email}
                onChange={set('email')}
              />
              <Input label={t('العنوان')} value={form.address} onChange={set('address')} />
              <Input
                label={t('بادئة رقم الفاتورة')}
                dir="ltr"
                required
                maxLength={6}
                pattern="[A-Za-z]{1,6}"
                title={t('من 1 إلى 6 أحرف إنجليزية')}
                value={form.invoicePrefix}
                onChange={set('invoicePrefix')}
              />
              <Input
                label={t('رقم الفاتورة التالي')}
                type="number"
                min={1}
                dir="ltr"
                value={form.nextInvoiceNumber}
                onChange={set('nextInvoiceNumber')}
              />
              <div className="self-end pb-2 text-sm text-brand-muted">
                {t('أول فاتورة ستكون:')}{' '}
                <span className="font-mono font-bold text-brand-brown" dir="ltr">
                  {invoiceExample(form.invoicePrefix, form.nextInvoiceNumber)}
                </span>
              </div>
              <div className="md:col-span-3">
                <Textarea
                  label={t('نص أسفل الفاتورة')}
                  value={form.invoiceFooter}
                  onChange={set('invoiceFooter')}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? t('جارٍ الحفظ…') : t('حفظ')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                {t('إلغاء')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows?.map((tr) => (
          <Card key={tr.id}>
            <div className="flex items-start gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-brand-line bg-white">
                {tr.logoFileId ? (
                  <img
                    src={fileUrl(tr.logoFileId)}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-brand-muted">{t('بدون شعار')}</span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-brand-brown">{tr.name}</h3>
                  {tr.isActive ? (
                    <Badge tone="green">{t('فعّال')}</Badge>
                  ) : (
                    <Badge tone="red">{t('موقوف')}</Badge>
                  )}
                </div>
                {tr.nameEn && (
                  <div dir="ltr" className="text-right text-brand-muted">
                    {tr.nameEn}
                  </div>
                )}
                <div>
                  {t('الفاتورة التالية:')}{' '}
                  <span className="font-mono font-bold" dir="ltr">
                    {invoiceExample(tr.invoicePrefix, String(tr.nextInvoiceNumber))}
                  </span>
                </div>
                <div>{t('العملاء المرتبطون: {0}', tr.customerCount)}</div>
                {(tr.phone || tr.address) && (
                  <div className="text-brand-muted">
                    {[tr.phone, tr.address].filter(Boolean).join(' — ')}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex gap-3 text-xs">
              <button
                className="text-brand-brown underline"
                onClick={() => {
                  setForm(toForm(tr));
                  setEditing(tr.id);
                }}
              >
                {t('تعديل')}
              </button>
              <button className="text-brand-brown underline" onClick={() => void toggle(tr)}>
                {tr.isActive ? t('إيقاف') : t('تفعيل')}
              </button>
            </div>
          </Card>
        ))}
        {rows && rows.length === 0 && (
          <p className="text-brand-muted">{t('لا توجد أسماء تجارية بعد.')}</p>
        )}
      </div>
    </div>
  );
}
