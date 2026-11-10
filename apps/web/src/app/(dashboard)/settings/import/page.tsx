'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileUp, XCircle } from 'lucide-react';
import { filsToJodString, formatJod } from '@mecca/shared';
import { api, errorMessage, fetchAuthedBlob, uploadForm } from '@/lib/api';
import { Badge, Button, Card, ErrorBox } from '@/components/ui';
import { t } from '@/lib/i18n';

type Kind = {
  kind: string;
  label: string;
  columns: { key: string; label: string; required: boolean }[];
};
type Preview = {
  kind: string;
  rows: {
    row: number;
    values: Record<string, string | number | null>;
    action: 'create' | 'skip';
    errors: string[];
    note?: string;
  }[];
  summary: { total: number; create: number; skip: number; errors: number; openingTotal?: number };
};
type Opening = {
  items: {
    code: string;
    name: string;
    amount: number;
    paid: number;
    remaining: number;
    dueDate: string;
  }[];
  total: number;
  remaining: number;
};

/** The order the data should go in: customers before their contracts, and so on. */
const ORDER_NOTE = t('الترتيب: الأصناف ← العملاء ← العقود ← الأسعار الخاصة ← الأرصدة الافتتاحية');

export default function ImportPage() {
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [kind, setKind] = useState('items');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string>('');
  const [opening, setOpening] = useState<Opening | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<Kind[]>('/api/import')
      .then(setKinds)
      .catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, []);
  useEffect(() => {
    if (kind === 'opening') void api<Opening>('/api/import/opening-check').then(setOpening);
  }, [kind, done]);

  const current = kinds.find((k) => k.kind === kind);

  function reset(k: string) {
    setKind(k);
    setFile(null);
    setPreview(null);
    setDone('');
    setError('');
    if (input.current) input.current.value = '';
  }

  async function template() {
    try {
      const blob = await fetchAuthedBlob(`/api/import/${kind}/template`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = t('قالب-{0}.xlsx', current?.label ?? kind);
      a.click();
    } catch (err) {
      setError(errorMessage(err, t('تعذّر تنزيل القالب')));
    }
  }

  async function send(step: 'preview' | 'commit') {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (step === 'preview') {
        setPreview(await uploadForm<Preview>(`/api/import/${kind}/preview`, form));
        setDone('');
      } else {
        const r = await uploadForm<{ created: number; failed: { row: number; message: string }[] }>(
          `/api/import/${kind}/commit`,
          form,
        );
        setDone(
          t('تم استيراد {0} سطر', r.created) +
            (r.failed.length
              ? t(
                  ' — لم ينجح {0}: {1}',
                  r.failed.length,
                  r.failed.map((f) => t('سطر {0} ({1})', f.row, f.message)).join(t('، ')),
                )
              : ' ✓'),
        );
        setPreview(null);
        setFile(null);
        if (input.current) input.current.value = '';
      }
    } catch (err) {
      setError(errorMessage(err, t('تعذّر قراءة الملف')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-brand-muted underline">
          {t('← الإعدادات')}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-brand-brown">{t('نقل البيانات من Excel')}</h1>
        <p className="text-sm text-brand-muted">
          {t('{0}. كل ملف يُفحص أولاً، ولا يُستورد إلا إذا كان بلا أخطاء.', ORDER_NOTE)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button
            key={k.kind}
            onClick={() => reset(k.kind)}
            className={`rounded-full border px-4 py-2 text-sm font-bold ${
              kind === k.kind
                ? 'border-transparent bg-primary text-on-primary'
                : 'border-brand-line bg-surface text-brand-brown'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      {done && (
        <div className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{done}</div>
      )}

      {current && (
        <Card title={current.label}>
          <ol className="space-y-3 text-sm">
            <li className="flex flex-wrap items-center gap-3">
              <b>1.</b> {t('نزّل القالب وعبّئه (الأعمدة:')}{' '}
              {current.columns.map((c) => c.label + (c.required ? '*' : '')).join(t('، '))})
              <Button variant="outline" onClick={() => void template()}>
                <span className="flex items-center gap-1.5">
                  <Download size={15} /> {t('تنزيل القالب')}
                </span>
              </Button>
            </li>
            <li className="flex flex-wrap items-center gap-3">
              <b>2.</b> {t('ارفع الملف وافحصه')}
              <input
                ref={input}
                type="file"
                accept=".xlsx"
                aria-label={t('ملف Excel')}
                className="text-sm"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                  setDone('');
                }}
              />
              <Button disabled={!file || busy} onClick={() => void send('preview')}>
                <span className="flex items-center gap-1.5">
                  <FileUp size={15} /> {t('فحص الملف')}
                </span>
              </Button>
            </li>
            <li className="flex flex-wrap items-center gap-3">
              <b>3.</b> {t('إذا لم تظهر أخطاء: استيراد')}
              <Button
                variant="gold"
                disabled={
                  !preview || preview.summary.errors > 0 || preview.summary.create === 0 || busy
                }
                onClick={() => void send('commit')}
              >
                {t('استيراد {0} سطر', preview?.summary.create ?? '')}
              </Button>
            </li>
          </ol>
        </Card>
      )}

      {preview && current && (
        <Card
          title={t('نتيجة الفحص — {0} سطر', preview.summary.total)}
          actions={
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="green">{t('جديد {0}', preview.summary.create)}</Badge>
              <Badge tone="neutral">{t('موجود مسبقاً {0}', preview.summary.skip)}</Badge>
              <Badge tone={preview.summary.errors ? 'red' : 'green'}>
                {t('أخطاء {0}', preview.summary.errors)}
              </Badge>
              {preview.summary.openingTotal !== undefined && (
                <Badge tone="gold">
                  {t('المجموع {0}', formatJod(preview.summary.openingTotal))}
                </Badge>
              )}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line text-start text-brand-muted">
                  <th className="py-2">{t('السطر')}</th>
                  <th />
                  {current.columns.map((c) => (
                    <th key={c.key} className="px-2 whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                  <th>{t('الملاحظات')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr
                    key={r.row}
                    className={`border-b border-stone-100 ${r.errors.length ? 'bg-red-50' : ''}`}
                  >
                    <td className="py-2 font-mono">{r.row}</td>
                    <td>
                      {r.errors.length ? (
                        <XCircle size={16} className="text-red-700" />
                      ) : r.action === 'create' ? (
                        <CheckCircle2 size={16} className="text-green-800" />
                      ) : (
                        <span className="text-brand-muted">—</span>
                      )}
                    </td>
                    {current.columns.map((c) => (
                      <td key={c.key} className="px-2 whitespace-nowrap">
                        {String(r.values[c.key] ?? '')}
                      </td>
                    ))}
                    <td className={r.errors.length ? 'text-red-800' : 'text-brand-muted'}>
                      {r.errors.join(t('، ')) || r.note || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {kind === 'opening' && opening && (
        <Card title={t('التحقق من الأرصدة الافتتاحية — {0} عميل', opening.items.length)}>
          <p className="mb-3 text-sm text-brand-muted">
            {t(
              'قارن المجموع مع دفاتر المخبز قبل الإطلاق. المجموع {0}، المتبقي بعد الدفعات {1}.',
              formatJod(opening.total),
              formatJod(opening.remaining),
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line text-start text-brand-muted">
                  <th className="py-2">{t('الكود')}</th>
                  <th>{t('العميل')}</th>
                  <th>{t('الرصيد الافتتاحي')}</th>
                  <th>{t('المدفوع منه')}</th>
                  <th>{t('المتبقي')}</th>
                  <th>{t('الاستحقاق')}</th>
                </tr>
              </thead>
              <tbody>
                {opening.items.map((o) => (
                  <tr key={o.code} className="border-b border-stone-100">
                    <td className="py-2 font-mono">{o.code}</td>
                    <td>{o.name}</td>
                    <td className="tabular-nums">{filsToJodString(o.amount)}</td>
                    <td className="tabular-nums">{filsToJodString(o.paid)}</td>
                    <td className="font-bold tabular-nums">{filsToJodString(o.remaining)}</td>
                    <td className="font-mono">{o.dueDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
