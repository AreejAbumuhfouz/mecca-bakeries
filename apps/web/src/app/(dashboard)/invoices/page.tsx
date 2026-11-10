'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCheck, Receipt } from 'lucide-react';
import {
  ammanDate,
  formatJod,
  INVOICE_STATUS_LABELS_AR,
  INVOICE_STATUSES,
  type InvoiceStatus,
} from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox } from '@/components/ui';
import { INVOICE_TONE, type InvoiceRow } from '@/lib/billing';
import { t } from '@/lib/i18n';

type List = {
  items: InvoiceRow[];
  total: number;
  sumTotal: number;
  drafts: number;
  page: number;
  pageSize: number;
};
const field = 'h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm';

export default function InvoicesPage() {
  const { can } = useAuth();
  const canManage = can('invoices.manage');
  const [from, setFrom] = useState(ammanDate());
  const [to, setTo] = useState(ammanDate());
  const [status, setStatus] = useState<'' | InvoiceStatus>('');
  const [unpaid, setUnpaid] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<List | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const qs = new URLSearchParams({
      page: String(page),
      pageSize: '50',
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(status ? { status } : {}),
      ...(unpaid ? { unpaid: 'true' } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    });
    setData(await api<List>(`/api/billing/invoices?${qs}`));
    setSelected(new Set());
  }, [from, to, status, unpaid, search, page]);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, [load]);

  async function approve(body: object) {
    setError('');
    setNotice('');
    try {
      const r = await api<{ approved: number }>('/api/billing/invoices/approve', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNotice(t('تم اعتماد {0} فاتورة', r.approved));
      await load();
    } catch (err) {
      setError(errorMessage(err, t('تعذّر الاعتماد')));
    }
  }

  const drafts = data?.items.filter((i) => i.status === 'draft') ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-brand-brown">
            <Receipt size={24} /> {t('الفواتير')}
          </h1>
          <p className="text-sm text-brand-muted">
            {t(
              'تُنشأ الفاتورة تلقائياً عند تأكيد السائق للتسليم، على الكمية المسلّمة وباسم الاسم التجاري للعميل.',
            )}
          </p>
        </div>
        {canManage && from === to && (
          <Button variant="gold" onClick={() => void approve({ date: from })}>
            <span className="flex items-center gap-1.5">
              <CheckCheck size={16} /> {t('اعتماد كل مسودات {0}', from)}
            </span>
          </Button>
        )}
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{notice}</div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            {t('من')}{' '}
            <input
              type="date"
              className={field}
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="flex items-center gap-1">
            {t('إلى')}{' '}
            <input
              type="date"
              className={field}
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            className={field}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | InvoiceStatus);
              setPage(1);
            }}
          >
            <option value="">{t('كل الحالات')}</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(INVOICE_STATUS_LABELS_AR[s])}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={unpaid}
              onChange={(e) => {
                setUnpaid(e.target.checked);
                setPage(1);
              }}
            />{' '}
            {t('غير مدفوعة فقط')}
          </label>
          <input
            className={`${field} flex-1`}
            placeholder={t('رقم الفاتورة أو العميل')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <button
            className="text-brand-brown underline"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            {t('كل التواريخ')}
          </button>
        </div>
      </Card>

      {data && (
        <Card
          title={t('{0} فاتورة — المجموع {1}', data.total, formatJod(data.sumTotal))}
          actions={
            canManage &&
            selected.size > 0 && (
              <Button onClick={() => void approve({ ids: [...selected] })}>
                {t('اعتماد المحدد ({0})', selected.size)}
              </Button>
            )
          }
        >
          {data.drafts > 0 && (
            <p className="mb-3 text-sm text-brand-muted">
              {t('{0} مسودة تحتاج مراجعة واعتماداً.', data.drafts)}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line text-start text-brand-muted">
                  {canManage && (
                    <th className="w-8 py-2">
                      <input
                        type="checkbox"
                        aria-label={t('تحديد كل المسودات')}
                        checked={drafts.length > 0 && drafts.every((d) => selected.has(d.id))}
                        onChange={(e) =>
                          setSelected(new Set(e.target.checked ? drafts.map((d) => d.id) : []))
                        }
                      />
                    </th>
                  )}
                  <th className="py-2">{t('الرقم')}</th>
                  <th>{t('التاريخ')}</th>
                  <th>{t('العميل')}</th>
                  <th>{t('الاسم التجاري')}</th>
                  <th>{t('المجموع')}</th>
                  <th>{t('المتبقي')}</th>
                  <th>{t('الاستحقاق')}</th>
                  <th>{t('الحالة')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id} className="border-b border-stone-100">
                    {canManage && (
                      <td>
                        {i.status === 'draft' && (
                          <input
                            type="checkbox"
                            aria-label={t('تحديد {0}', i.number)}
                            checked={selected.has(i.id)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(i.id);
                              else next.delete(i.id);
                              setSelected(next);
                            }}
                          />
                        )}
                      </td>
                    )}
                    <td className="py-2 font-mono">
                      <Link href={`/invoices/${i.id}`} className="text-brand-brown underline">
                        {i.number}
                      </Link>
                      {i.flags.length > 0 && (
                        <span
                          title={i.flags.join(t('، '))}
                          className="ms-1 inline-block text-amber-900"
                        >
                          <AlertTriangle size={14} />
                        </span>
                      )}
                    </td>
                    <td className="font-mono">{i.issueDate}</td>
                    <td>
                      <b>{i.customerName}</b>
                      {i.branchName && <span className="text-brand-muted"> — {i.branchName}</span>}
                    </td>
                    <td className="text-brand-muted">{i.tradeName}</td>
                    <td className="font-bold">{formatJod(i.total)}</td>
                    <td className={i.balance > 0 ? 'font-bold text-red-800' : 'text-green-800'}>
                      {i.status === 'cancelled'
                        ? '—'
                        : i.balance > 0
                          ? formatJod(i.balance)
                          : t('مدفوعة ✓')}
                    </td>
                    <td className="font-mono text-brand-muted">{i.dueDate}</td>
                    <td>
                      <Badge tone={INVOICE_TONE[i.status]}>
                        {t(INVOICE_STATUS_LABELS_AR[i.status])}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-brand-muted">
                      {t('لا توجد فواتير')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data.total > data.pageSize && (
            <div className="mt-4 flex items-center gap-3 text-sm">
              <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t('السابق')}
              </Button>
              <span>{t('صفحة {0} من {1}', page, Math.ceil(data.total / data.pageSize))}</span>
              <Button
                variant="outline"
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage(page + 1)}
              >
                {t('التالي')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
