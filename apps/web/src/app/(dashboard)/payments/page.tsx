'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Wallet } from 'lucide-react';
import {
  AGING_BUCKETS,
  AGING_LABELS_AR,
  ammanDate,
  filsToJodString,
  formatJod,
  PAYMENT_METHOD_LABELS_AR,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input, Select } from '@/components/ui';
import { jodToFils, type PaymentRow, type ReceivableRow, type Summary } from '@/lib/billing';
import { t } from '@/lib/i18n';

type Tab = 'receivables' | 'payments' | 'new';
type Customer = { id: string; code: string; name: string };
const field = 'h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm';

export default function PaymentsPage() {
  const { can } = useAuth();
  const canManage = can('payments.manage');
  const [tab, setTab] = useState<Tab>('receivables');
  const [error, setError] = useState('');

  const tabs: [Tab, string][] = [
    ['receivables', t('الذمم وأعمارها')],
    ['payments', t('سجل المقبوضات')],
    ...(canManage ? ([['new', t('+ تسجيل دفعة')]] as [Tab, string][]) : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-brand-brown">
          <Wallet size={24} /> {t('المقبوضات والذمم')}
        </h1>
        <p className="text-sm text-brand-muted">
          {t('كل دفعة تُوزَّع تلقائياً على أقدم فاتورة مستحقة، ويمكن توزيعها يدوياً عند التسجيل.')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-2 text-sm font-bold ${tab === k ? 'border-transparent bg-primary text-on-primary' : 'border-brand-line bg-surface text-brand-brown'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      {tab === 'receivables' && <Receivables setError={setError} />}
      {tab === 'payments' && <Payments setError={setError} />}
      {tab === 'new' && <NewPayment setError={setError} onDone={() => setTab('payments')} />}
    </div>
  );
}

function Receivables({ setError }: { setError: (s: string) => void }) {
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{
    items: ReceivableRow[];
    totals: { balance: number; overdue: number; aging: Record<string, number> };
  } | null>(null);
  useEffect(() => {
    const qs = new URLSearchParams({
      ...(onlyOverdue ? { onlyOverdue: 'true' } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    });
    void api<typeof data>(`/api/billing/receivables?${qs}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, [onlyOverdue, search, setError]);
  if (!data) return null;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-7">
        <Card>
          <div className="text-sm text-brand-muted">{t('إجمالي الذمم')}</div>
          <div className="mt-1 text-xl font-bold text-brand-brown">
            {formatJod(data.totals.balance)}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-brand-muted">{t('المتأخر')}</div>
          <div className="mt-1 text-xl font-bold text-red-800">
            {formatJod(data.totals.overdue)}
          </div>
        </Card>
        {AGING_BUCKETS.map((b) => (
          <Card key={b}>
            <div className="text-sm text-brand-muted">{t(AGING_LABELS_AR[b])}</div>
            <div className="mt-1 text-lg font-bold text-brand-brown">
              {filsToJodString(data.totals.aging[b] ?? 0)}
            </div>
          </Card>
        ))}
      </div>
      <Card
        title={t('العملاء ({0})', data.items.length)}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <input
              className={field}
              placeholder={t('بحث بالاسم أو الكود')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={onlyOverdue}
                onChange={(e) => setOnlyOverdue(e.target.checked)}
              />{' '}
              {t('المتأخرون فقط')}
            </label>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-start text-brand-muted">
                <th className="py-2">{t('العميل')}</th>
                <th>{t('الرصيد')}</th>
                <th>{t('المتأخر')}</th>
                {AGING_BUCKETS.map((b) => (
                  <th key={b}>{t(AGING_LABELS_AR[b])}</th>
                ))}
                <th>{t('آخر دفعة')}</th>
                <th>{t('التذكير')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.customerId} className="border-b border-stone-100">
                  <td className="py-2">
                    <Link
                      href={`/payments/customers/${c.customerId}`}
                      className="font-bold underline"
                    >
                      {c.name}
                    </Link>{' '}
                    <span className="font-mono text-xs text-brand-muted">{c.code}</span>
                  </td>
                  <td className="font-bold">{filsToJodString(c.balance)}</td>
                  <td className={c.overdue ? 'font-bold text-red-800' : 'text-brand-muted'}>
                    {filsToJodString(c.overdue)}
                  </td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b} className={c.aging[b] ? '' : 'text-brand-muted'}>
                      {c.aging[b] ? filsToJodString(c.aging[b]) : '—'}
                    </td>
                  ))}
                  <td className="font-mono text-xs">{c.lastPaymentOn ?? '—'}</td>
                  <td>
                    {c.balanceAlerts ? (
                      <Badge tone="green">{t('مفعّل')}</Badge>
                    ) : (
                      <Badge tone="neutral">{t('موقوف')}</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-brand-muted">
                    {t('لا توجد ذمم ✓')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Payments({ setError }: { setError: (s: string) => void }) {
  const [from, setFrom] = useState(ammanDate());
  const [to, setTo] = useState(ammanDate());
  const [method, setMethod] = useState<'' | PaymentMethod>('');
  const [data, setData] = useState<{
    items: PaymentRow[];
    total: number;
    sumAmount: number;
  } | null>(null);
  const load = useCallback(async () => {
    const qs = new URLSearchParams({
      pageSize: '100',
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(method ? { method } : {}),
    });
    setData(await api(`/api/billing/payments?${qs}`));
  }, [from, to, method]);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, [load, setError]);
  return (
    <Card
      title={data ? t('{0} دفعة — {1}', data.total, formatJod(data.sumAmount)) : t('الدفعات')}
      actions={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="date"
            className={field}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
          <select
            className={field}
            value={method}
            onChange={(e) => setMethod(e.target.value as '' | PaymentMethod)}
          >
            <option value="">{t('كل الطرق')}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(PAYMENT_METHOD_LABELS_AR[m])}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-line text-start text-brand-muted">
              <th className="py-2">{t('الإيصال')}</th>
              <th>{t('التاريخ')}</th>
              <th>{t('العميل')}</th>
              <th>{t('المبلغ')}</th>
              <th>{t('الطريقة')}</th>
              <th>{t('المصدر')}</th>
              <th>{t('غير موزّع')}</th>
              <th>{t('سجّله')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((p) => (
              <PaymentLine key={p.id} p={p} onChange={load} setError={setError} />
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-brand-muted">
                  {t('لا توجد دفعات')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PaymentLine({
  p,
  onChange,
  setError,
}: {
  p: PaymentRow;
  onChange: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const { can } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const cancelled = p.status === 'cancelled';
  return (
    <tr className={`border-b border-stone-100 ${cancelled ? 'opacity-50' : ''}`}>
      <td className="py-2 font-mono">{p.number}</td>
      <td className="font-mono">{p.receivedOn}</td>
      <td>
        <Link href={`/payments/customers/${p.customerId}`} className="underline">
          {p.customerName}
        </Link>
      </td>
      <td className="font-bold">{formatJod(p.amount)}</td>
      <td>
        {t(PAYMENT_METHOD_LABELS_AR[p.method])}
        {p.reference && <span className="text-xs text-brand-muted"> {p.reference}</span>}
        {p.chequeDueDate && (
          <div className="text-xs text-brand-muted">{t('استحقاق {0}', p.chequeDueDate)}</div>
        )}
      </td>
      <td>{p.source === 'driver' ? t('السائق') : t('المكتب')}</td>
      <td>{!cancelled && p.amount - p.allocated > 0 ? formatJod(p.amount - p.allocated) : '—'}</td>
      <td className="text-xs text-brand-muted">{p.receivedByName}</td>
      <td className="text-xs">
        {cancelled ? (
          <Badge tone="red">{t('ملغاة')}</Badge>
        ) : can('payments.manage') && !cancelling ? (
          <button className="text-red-700 underline" onClick={() => setCancelling(true)}>
            {t('إلغاء')}
          </button>
        ) : cancelling ? (
          <span className="flex items-center gap-1">
            <input
              className="h-8 w-32 rounded border border-brand-line bg-surface px-2"
              placeholder={t('السبب')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              className="text-red-700 underline"
              disabled={reason.trim().length < 3}
              onClick={() =>
                void api(`/api/billing/payments/${p.id}/cancel`, {
                  method: 'POST',
                  body: JSON.stringify({ reason }),
                })
                  .then(onChange)
                  .catch((err) => setError(errorMessage(err, t('تعذّر الإلغاء'))))
              }
            >
              {t('تأكيد')}
            </button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function NewPayment({ setError, onDone }: { setError: (s: string) => void; onDone: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [receivedOn, setReceivedOn] = useState(ammanDate());
  const [reference, setReference] = useState('');
  const [chequeDueDate, setChequeDueDate] = useState('');
  const [note, setNote] = useState('');
  const [manual, setManual] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ items: Customer[] }>('/api/customers?pageSize=100&isActive=true').then((r) =>
      setCustomers(r.items),
    );
  }, []);
  useEffect(() => {
    setManual({});
    if (!customerId) return setSummary(null);
    void api<Summary>(`/api/billing/customers/${customerId}/summary`).then(setSummary);
  }, [customerId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const fils = jodToFils(amount);
    if (!fils) return setError(t('اكتب المبلغ بالدينار، مثل 25 أو 12.500'));
    const allocations = [];
    for (const [invoiceId, v] of Object.entries(manual)) {
      if (!v.trim()) continue;
      const a = jodToFils(v);
      if (!a) return setError(t('مبلغ التوزيع غير صحيح'));
      allocations.push({ invoiceId, amount: a });
    }
    setError('');
    setBusy(true);
    try {
      await api('/api/billing/payments', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          amount: fils,
          method,
          receivedOn,
          reference: reference || null,
          chequeDueDate: method === 'cheque' && chequeDueDate ? chequeDueDate : null,
          note: note || null,
          allocations,
        }),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err, t('تعذّر الحفظ')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title={t('الدفعة')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Select
            label={t('العميل')}
            required
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">{t('— اختر العميل —')}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
          <Input
            label={t('المبلغ (دينار)')}
            dir="ltr"
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Select
            label={t('الطريقة')}
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(PAYMENT_METHOD_LABELS_AR[m])}
              </option>
            ))}
          </Select>
          <Input
            label={t('تاريخ الاستلام')}
            type="date"
            required
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
          {method !== 'cash' && (
            <Input
              label={method === 'cheque' ? t('رقم الشيك') : t('رقم الحوالة')}
              required={method === 'cheque'}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          )}
          {method === 'cheque' && (
            <Input
              label={t('تاريخ استحقاق الشيك')}
              type="date"
              value={chequeDueDate}
              onChange={(e) => setChequeDueDate(e.target.value)}
            />
          )}
          <Input label={t('ملاحظة')} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Card>
      {summary && (
        <Card title={t('الفواتير المفتوحة — الرصيد {0}', formatJod(summary.balance))}>
          <p className="mb-3 text-sm text-brand-muted">
            {t(
              'اترك الحقول فارغة ليُوزَّع المبلغ تلقائياً على الأقدم أولاً، أو اكتب مبلغاً لفاتورة معيّنة.',
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line text-start text-brand-muted">
                  <th className="py-2">{t('الفاتورة')}</th>
                  <th>{t('التاريخ')}</th>
                  <th>{t('الاستحقاق')}</th>
                  <th>{t('المتبقي')}</th>
                  <th className="w-32">{t('توزيع يدوي')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.openInvoices.map((i) => (
                  <tr key={i.id} className="border-b border-stone-100">
                    <td className="py-2 font-mono">{i.number}</td>
                    <td className="font-mono">{i.issueDate}</td>
                    <td className={`font-mono ${i.dueDate < ammanDate() ? 'text-red-800' : ''}`}>
                      {i.dueDate}
                    </td>
                    <td className="font-bold">{filsToJodString(i.balance)}</td>
                    <td>
                      <input
                        dir="ltr"
                        aria-label={t('توزيع على {0}', i.number)}
                        className="h-9 w-28 rounded-lg border border-brand-line bg-surface px-2"
                        value={manual[i.id] ?? ''}
                        onChange={(e) => setManual({ ...manual, [i.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
                {summary.openInvoices.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-brand-muted">
                      {t('لا فواتير مفتوحة — الدفعة تبقى رصيداً دائناً للعميل')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Button type="submit" disabled={busy || !customerId}>
        {busy ? t('جارٍ الحفظ…') : t('حفظ الدفعة')}
      </Button>
    </form>
  );
}
