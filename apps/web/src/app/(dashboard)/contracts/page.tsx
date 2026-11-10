'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  CONTRACT_STATE_LABELS_AR,
  CONTRACT_STATES,
  formatJod,
  PAYMENT_TYPE_LABELS_AR,
  type ContractState,
} from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox } from '@/components/ui';
import { STATE_TONE, type ContractRow } from '@/lib/contracts';
import { t } from '@/lib/i18n';

type Page = { items: ContractRow[]; total: number };
const filterClass = 'rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm';

export default function ContractsPage() {
  const { can } = useAuth();
  const [data, setData] = useState<Page | null>(null);
  const [search, setSearch] = useState('');
  const [state, setState] = useState<'' | ContractState>('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (search) qs.set('search', search);
    if (state) qs.set('state', state);
    setData(await api<Page>(`/api/contracts?${qs}`));
  }, [search, state]);

  useEffect(() => {
    const id = setTimeout(
      () => void load().catch((err) => setError(errorMessage(err, t('تعذّر تحميل العقود')))),
      250,
    );
    return () => clearTimeout(id);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-brown">{t('العقود والائتمان')}</h1>
          <p className="text-sm text-brand-muted">
            {t('الأسعار الخاصة والخصم وسقف الائتمان ومدة السداد والمرتجعات لكل عميل.')}
          </p>
        </div>
        {can('contracts.manage') && (
          <Link href="/contracts/new">
            <Button>{t('+ عقد جديد')}</Button>
          </Link>
        )}
      </div>

      <ErrorBox message={error} />

      <Card
        title={t('العقود{0}', data ? ` (${data.total})` : '')}
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              className={`${filterClass} w-56`}
              placeholder={t('بحث برقم العقد أو العميل')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className={filterClass}
              value={state}
              onChange={(e) => setState(e.target.value as '' | ContractState)}
            >
              <option value="">{t('كل الحالات')}</option>
              {CONTRACT_STATES.map((s) => (
                <option key={s} value={s}>
                  {CONTRACT_STATE_LABELS_AR[s]}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-right text-brand-muted">
                <th className="py-2">{t('رقم العقد')}</th>
                <th>{t('العميل')}</th>
                <th>{t('من')}</th>
                <th>{t('إلى')}</th>
                <th>{t('الدفع')}</th>
                <th>{t('سقف الائتمان')}</th>
                <th>{t('الخصم العام')}</th>
                <th>{t('الحالة')}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((c) => (
                <tr key={c.id} className="border-b border-stone-100 hover:bg-brand-cream/50">
                  <td className="py-2.5 pl-4 font-mono">
                    <Link href={`/contracts/${c.id}`} className="text-brand-brown underline">
                      {c.number}
                    </Link>
                  </td>
                  <td className="font-bold">
                    <Link href={`/contracts/${c.id}`}>{c.customerName}</Link>
                    <span className="mr-2 font-mono text-xs font-normal text-brand-muted">
                      {c.customerCode}
                    </span>
                  </td>
                  <td className="font-mono">{c.startDate}</td>
                  <td className="font-mono">{c.endDate}</td>
                  <td>{PAYMENT_TYPE_LABELS_AR[c.paymentType]}</td>
                  <td>{c.paymentType === 'credit' ? formatJod(c.creditLimit) : '—'}</td>
                  <td>{c.discountBps ? `${c.discountBps / 100}%` : '—'}</td>
                  <td>
                    <Badge tone={STATE_TONE[c.state]}>{CONTRACT_STATE_LABELS_AR[c.state]}</Badge>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-brand-muted">
                    {t('لا توجد عقود')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
