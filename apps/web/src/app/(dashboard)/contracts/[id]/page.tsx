'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  addDays,
  CONTRACT_STATE_LABELS_AR,
  formatJod,
  PAYMENT_TYPE_LABELS_AR,
} from '@mecca/shared';
import { api, errorMessage, openPrivateFile, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input } from '@/components/ui';
import {
  STATE_TONE,
  termsToBody,
  termsToForm,
  type Contract,
  type TermsForm,
} from '@/lib/contracts';
import { TermsFields } from '../terms-fields';
import { draftToPrices, PricesEditor, pricesToDraft, type PriceDraft } from '../prices-editor';

type Credit = {
  allowed: boolean;
  outstanding: number;
  overdueAmount: number;
  available: number | null;
  reasons: { code: string; message: string }[];
  contract: { id: string } | null;
};

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-brand-muted">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}

export default function ContractPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can('contracts.manage');
  const [c, setC] = useState<Contract | null>(null);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [editTerms, setEditTerms] = useState<TermsForm | null>(null);
  const [draft, setDraft] = useState<PriceDraft>({});
  const [editPrices, setEditPrices] = useState(false);
  const [renewEnd, setRenewEnd] = useState<string | null>(null);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [attLabel, setAttLabel] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const contract = await api<Contract>(`/api/contracts/${id}`);
    setC(contract);
    setDraft(pricesToDraft(contract.prices));
    setCredit(await api<Credit>(`/api/contracts/credit-check?customerId=${contract.customer.id}`));
  }, [id]);

  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, 'تعذّر تحميل العقد')));
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

  async function saveTerms(e: FormEvent) {
    e.preventDefault();
    if (!editTerms) return;
    const body = termsToBody(editTerms);
    if (typeof body === 'string') return setError(body);
    if (
      await run(
        () => api(`/api/contracts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
        'تعذّر حفظ الشروط',
      )
    )
      setEditTerms(null);
  }

  async function savePrices() {
    const prices = draftToPrices(draft);
    if (typeof prices === 'string') return setError(prices);
    if (
      await run(
        () => api(`/api/contracts/${id}/prices`, { method: 'PUT', body: JSON.stringify(prices) }),
        'تعذّر حفظ الأسعار',
      )
    )
      setEditPrices(false);
  }

  const setStatus = (status: 'active' | 'suspended' | 'terminated') =>
    run(
      () => api(`/api/contracts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
      'تعذّر تغيير الحالة',
    );

  async function renew(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const created = await api<{ id: string }>(`/api/contracts/${id}/renew`, {
        method: 'POST',
        body: JSON.stringify({ endDate: renewEnd }),
      });
      router.push(`/contracts/${created.id}`);
    } catch (err) {
      setError(errorMessage(err, 'تعذّر تجديد العقد'));
    } finally {
      setBusy(false);
    }
  }

  async function addAttachment(file: File | undefined) {
    if (!file) return;
    await run(async () => {
      const uploaded = await uploadFile(file, false);
      await api(`/api/contracts/${id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ fileId: uploaded.id, label: attLabel.trim() || file.name }),
      });
      setAttLabel('');
    }, 'تعذّر رفع المرفق');
    if (fileInput.current) fileInput.current.value = '';
  }

  if (!c) {
    return (
      <div className="space-y-4">
        <ErrorBox message={error} />
        {!error && <p className="text-brand-muted">جارٍ التحميل…</p>}
      </div>
    );
  }

  const editable = canManage && c.status !== 'terminated';
  const discountBps = editTerms
    ? Math.round(Number(editTerms.discount || 0) * 100) || 0
    : c.discountBps;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/contracts" className="text-sm text-brand-muted underline">
            ← العقود
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-brand-brown">
            عقد <span className="font-mono">{c.number}</span>
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <Link href={`/customers/${c.customer.id}`} className="font-bold underline">
              {c.customer.name}
            </Link>
            <span className="font-mono text-brand-muted">{c.customer.code}</span>
            <Badge tone={STATE_TONE[c.state]}>{CONTRACT_STATE_LABELS_AR[c.state]}</Badge>
          </div>
        </div>
        {editable && !editTerms && (
          <div className="flex flex-wrap gap-2">
            <Button variant="gold" onClick={() => setRenewEnd(addDays(c.endDate, 365))}>
              تجديد
            </Button>
            {c.status === 'active' ? (
              <Button variant="outline" disabled={busy} onClick={() => void setStatus('suspended')}>
                إيقاف مؤقت
              </Button>
            ) : (
              <Button variant="outline" disabled={busy} onClick={() => void setStatus('active')}>
                إعادة تفعيل
              </Button>
            )}
            {confirmTerminate ? (
              <Button
                className="!bg-red-700"
                disabled={busy}
                onClick={() => void setStatus('terminated').then(() => setConfirmTerminate(false))}
              >
                تأكيد إلغاء العقد
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirmTerminate(true)}>
                إلغاء العقد
              </Button>
            )}
            <Button onClick={() => setEditTerms(termsToForm(c))}>تعديل الشروط</Button>
          </div>
        )}
      </div>

      <ErrorBox message={error} />

      {renewEnd !== null && (
        <Card title="تجديد العقد">
          <form onSubmit={renew} className="flex flex-wrap items-end gap-3">
            <p className="w-full text-sm text-brand-muted">
              يُنشأ عقد جديد بنفس الشروط والأسعار الخاصة، يبدأ في {addDays(c.endDate, 1)}.
            </p>
            <Input
              label="تاريخ نهاية العقد الجديد"
              type="date"
              required
              value={renewEnd}
              onChange={(e) => setRenewEnd(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              إنشاء العقد الجديد
            </Button>
            <Button type="button" variant="outline" onClick={() => setRenewEnd(null)}>
              إلغاء
            </Button>
          </form>
        </Card>
      )}

      {credit && (
        <Card title="حالة الائتمان اليوم">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Info label="يمكنه الطلب" value={credit.allowed ? 'نعم ✓' : 'لا ✗'} />
            <Info label="الرصيد المستحق" value={formatJod(credit.outstanding)} />
            <Info label="ذمم متأخرة" value={formatJod(credit.overdueAmount)} />
            <Info
              label="الائتمان المتاح"
              value={credit.available === null ? 'نقدي' : formatJod(Math.max(0, credit.available))}
            />
          </div>
          {credit.reasons.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-sm text-red-800">
              {credit.reasons.map((r) => (
                <li key={r.code}>{r.message}</li>
              ))}
            </ul>
          )}
          {credit.contract && credit.contract.id !== c.id && (
            <p className="mt-3 text-sm text-brand-muted">
              الحالة محسوبة على العقد الساري حالياً لهذا العميل وليس هذا العقد.
            </p>
          )}
          <p className="mt-3 text-xs text-brand-muted">
            الرصيد والذمم تُحسب من الفواتير بعد بناء وحدة الفواتير (المرحلة 4).
          </p>
        </Card>
      )}

      <Card title="شروط العقد">
        {editTerms ? (
          <form onSubmit={saveTerms} className="space-y-4">
            <TermsFields form={editTerms} setForm={setEditTerms} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ الشروط'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditTerms(null)}>
                إلغاء
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Info label="المدة" value={`${c.startDate} ← ${c.endDate}`} />
            <Info label="طريقة الدفع" value={PAYMENT_TYPE_LABELS_AR[c.paymentType]} />
            <Info
              label="سقف الائتمان"
              value={c.paymentType === 'credit' ? formatJod(c.creditLimit) : '—'}
            />
            <Info
              label="مدة السداد"
              value={c.paymentType === 'credit' ? `${c.paymentTermsDays} يوم` : '—'}
            />
            <Info label="سماحية التأخير" value={`${c.overdueGraceDays} يوم`} />
            <Info
              label="الخصم العام"
              value={c.discountBps ? `${c.discountBps / 100}%` : 'لا يوجد'}
            />
            <Info
              label="المرتجعات"
              value={c.allowReturns ? `مسموحة حتى ${c.maxReturnBps / 100}%` : 'غير مسموحة'}
            />
            <Info label="تنبيه التجديد" value={`قبل ${c.renewalAlertDays} يوم`} />
            {c.returnsNotes && <Info label="شروط المرتجعات" value={c.returnsNotes} />}
            {c.notes && <Info label="ملاحظات" value={c.notes} />}
          </div>
        )}
      </Card>

      <Card
        title={`الأسعار الخاصة (${c.prices.length})`}
        actions={
          editable &&
          (editPrices ? (
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void savePrices()}>
                حفظ الأسعار
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(pricesToDraft(c.prices));
                  setEditPrices(false);
                }}
              >
                إلغاء
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setEditPrices(true)}>
              تعديل الأسعار
            </Button>
          ))
        }
      >
        <PricesEditor
          key={editPrices ? 'edit' : 'view'}
          draft={draft}
          setDraft={setDraft}
          discountBps={discountBps}
          readOnly={!editPrices}
        />
      </Card>

      <Card title={`المرفقات (${c.attachments.length})`}>
        {canManage && (
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Input
                label="وصف المرفق"
                placeholder="مثلاً: العقد الموقّع"
                value={attLabel}
                onChange={(e) => setAttLabel(e.target.value)}
              />
            </div>
            <Button variant="gold" disabled={busy} onClick={() => fileInput.current?.click()}>
              رفع ملف (PDF أو صورة)
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void addAttachment(e.target.files?.[0])}
            />
          </div>
        )}
        <ul className="divide-y divide-stone-100 text-sm">
          {c.attachments.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-bold">{a.label}</div>
                <div className="text-xs text-brand-muted">
                  {a.fileName} — {Math.ceil(a.size / 1024)} KB
                </div>
              </div>
              <div className="flex gap-3 text-xs">
                <button
                  className="text-brand-brown underline"
                  onClick={() =>
                    void openPrivateFile(a.fileId).catch((err) =>
                      setError(errorMessage(err, 'تعذّر فتح الملف')),
                    )
                  }
                >
                  فتح
                </button>
                {canManage && (
                  <button
                    className="text-red-700 underline"
                    onClick={() =>
                      void run(
                        () => api(`/api/contracts/${id}/attachments/${a.id}`, { method: 'DELETE' }),
                        'تعذّر حذف المرفق',
                      )
                    }
                  >
                    حذف
                  </button>
                )}
              </div>
            </li>
          ))}
          {c.attachments.length === 0 && <li className="py-3 text-brand-muted">لا توجد مرفقات</li>}
        </ul>
      </Card>
    </div>
  );
}
