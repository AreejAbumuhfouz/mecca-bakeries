'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox } from '@/components/ui';
import {
  emptyCustomerForm,
  toBody,
  type Category,
  type CustomerRow,
  type TradeNameOption,
} from '@/lib/customers';
import { CustomerFields } from './customer-fields';
import { t } from '@/lib/i18n';

type Page = { items: CustomerRow[]; total: number; page: number; pageSize: number };
const PAGE_SIZE = 25;
const errMsg = (err: unknown, fallback: string) =>
  err instanceof ApiRequestError ? err.message : fallback;

export default function CustomersPage() {
  const { can } = useAuth();
  const canManage = can('customers.manage');
  const [data, setData] = useState<Page | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tradeNames, setTradeNames] = useState<TradeNameOption[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'' | 'true' | 'false'>('true');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [form, setForm] = useState(emptyCustomerForm);
  const [newCategory, setNewCategory] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCategories = useCallback(async () => {
    setCategories(await api<Category[]>('/api/customers/categories'));
  }, []);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) qs.set('search', search);
    if (categoryId) qs.set('categoryId', categoryId);
    if (status) qs.set('isActive', status);
    setData(await api<Page>(`/api/customers?${qs}`));
  }, [search, categoryId, status, page]);

  useEffect(() => {
    void loadCategories().catch(() => setError(t('تعذّر تحميل الفئات')));
    void api<TradeNameOption[]>('/api/trade-names')
      .then(setTradeNames)
      .catch(() => undefined);
  }, [loadCategories]);

  useEffect(() => {
    const id = setTimeout(() => void load().catch(() => setError(t('تعذّر تحميل العملاء'))), 250);
    return () => clearTimeout(id);
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/customers', { method: 'POST', body: JSON.stringify(toBody(form)) });
      setForm(emptyCustomerForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(errMsg(err, t('تعذّر حفظ العميل')));
    } finally {
      setBusy(false);
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/api/customers/categories', {
        method: 'POST',
        body: JSON.stringify({ name: newCategory }),
      });
      setNewCategory('');
      await loadCategories();
    } catch (err) {
      setError(errMsg(err, t('تعذّر حفظ الفئة')));
    }
  }

  async function toggleCategory(c: Category) {
    setError('');
    try {
      await api(`/api/customers/categories/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !c.isActive }),
      });
      await loadCategories();
    } catch (err) {
      setError(errMsg(err, t('تعذّر تحديث الفئة')));
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filterClass = 'rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-brown">{t('المطاعم والعملاء')}</h1>
          <p className="text-sm text-brand-muted">
            {t('كل عميل له كود ثابت، ولكل فرع كود خاص يُستخدم في الطلبات والتوزيع.')}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowCategories((v) => !v)}>
              {t('الفئات')}
            </Button>
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm ? t('إلغاء') : t('+ عميل جديد')}
            </Button>
          </div>
        )}
      </div>

      <ErrorBox message={error} />

      {showCategories && canManage && (
        <Card title={t('فئات العملاء')}>
          <form onSubmit={addCategory} className="mb-4 flex gap-2">
            <input
              className={`${filterClass} w-64`}
              placeholder={t('اسم الفئة (مثلاً: فنادق)')}
              value={newCategory}
              minLength={2}
              required
              onChange={(e) => setNewCategory(e.target.value)}
            />
            <Button type="submit" variant="gold">
              {t('إضافة')}
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => void toggleCategory(c)}
                title={c.isActive ? t('اضغط للتعطيل') : t('اضغط للتفعيل')}
                className={`rounded-full border px-3 py-1 text-sm ${
                  c.isActive
                    ? 'border-brand-gold bg-brand-gold-light text-brand-brown'
                    : 'border-stone-200 text-stone-400 line-through'
                }`}
              >
                {c.name}
              </button>
            ))}
            {categories.length === 0 && (
              <span className="text-sm text-brand-muted">{t('لا توجد فئات بعد')}</span>
            )}
          </div>
        </Card>
      )}

      {showForm && (
        <Card title={t('عميل جديد')}>
          <form onSubmit={onCreate} className="space-y-4">
            <CustomerFields
              form={form}
              setForm={setForm}
              categories={categories}
              tradeNames={tradeNames}
              codeHint={t('يُولَّد تلقائياً')}
            />
            <p className="text-xs text-brand-muted">
              {t(
                'يُنشأ «الفرع الرئيسي» تلقائياً بنفس العنوان والهاتف، ويمكن إضافة فروع أخرى لاحقاً.',
              )}
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? t('جارٍ الحفظ…') : t('حفظ')}
            </Button>
          </form>
        </Card>
      )}

      <Card
        title={t('العملاء{0}', data ? ` (${data.total})` : '')}
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              className={`${filterClass} w-56`}
              placeholder={t('بحث بالكود أو الاسم أو الهاتف')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <select
              className={filterClass}
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('كل الفئات')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className={filterClass}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as '' | 'true' | 'false');
                setPage(1);
              }}
            >
              <option value="true">{t('الفعّالون')}</option>
              <option value="false">{t('الموقوفون')}</option>
              <option value="">{t('الكل')}</option>
            </select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-right text-brand-muted">
                <th className="py-2">{t('الكود')}</th>
                <th>{t('الاسم')}</th>
                <th>{t('الفئة')}</th>
                <th>{t('الاسم التجاري')}</th>
                <th>{t('المسؤول')}</th>
                <th>{t('الهاتف')}</th>
                <th>{t('الفروع')}</th>
                <th>{t('الحالة')}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((c) => (
                <tr key={c.id} className="border-b border-stone-100 hover:bg-brand-cream/50">
                  <td className="py-2.5 pl-4 font-mono">
                    <Link href={`/customers/${c.id}`} className="text-brand-brown underline">
                      {c.code}
                    </Link>
                  </td>
                  <td className="font-bold">
                    <Link href={`/customers/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>{c.categoryName ?? '—'}</td>
                  <td>{c.tradeName ?? '—'}</td>
                  <td>{c.contactName ?? '—'}</td>
                  <td dir="ltr" className="text-right">
                    {c.phone ?? '—'}
                  </td>
                  <td>{c.branchCount}</td>
                  <td>
                    {c.isActive ? (
                      <Badge tone="green">{t('فعّال')}</Badge>
                    ) : (
                      <Badge tone="red">{t('موقوف')}</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-brand-muted">
                    {t('لا يوجد عملاء')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('السابق')}
            </Button>
            <span>{t('صفحة {0} من {1}', page, pages)}</span>
            <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t('التالي')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
