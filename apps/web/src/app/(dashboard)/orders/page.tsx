'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  formatJod,
  ORDER_SOURCE_LABELS_AR,
  ORDER_STATUS_LABELS_AR,
  ORDER_STATUSES,
  type OrderStatus,
} from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox } from '@/components/ui';
import { formatAmman, STATUS_TONE, type OrderRow } from '@/lib/orders';

type Page = { items: OrderRow[]; total: number };
type Window = { deliveryDate: string; cutoffAt: string };
const filterClass = 'rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm';

export default function OrdersPage() {
  const { can } = useAuth();
  const [win, setWin] = useState<Window | null>(null);
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<'' | OrderStatus>('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<Window>('/api/orders/window')
      .then((w) => {
        setWin(w);
        setDate(w.deliveryDate);
      })
      .catch((err) => setError(errorMessage(err, 'تعذّر التحميل')));
  }, []);

  const load = useCallback(async () => {
    if (!date) return;
    const qs = new URLSearchParams({ deliveryDate: date, pageSize: '100' });
    if (status) qs.set('status', status);
    if (search) qs.set('search', search);
    setData(await api<Page>(`/api/orders?${qs}`));
  }, [date, status, search]);

  useEffect(() => {
    const id = setTimeout(
      () => void load().catch((err) => setError(errorMessage(err, 'تعذّر تحميل الطلبات'))),
      250,
    );
    return () => clearTimeout(id);
  }, [load]);

  const counts = (data?.items ?? []).reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
  const total = (data?.items ?? [])
    .filter((o) => !['cancelled', 'rejected', 'draft'].includes(o.status))
    .reduce((s, o) => s + o.total, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-brown">الطلبات</h1>
          {win && (
            <p className="text-sm text-brand-muted">
              الطلبات مفتوحة الآن ليوم <b>{win.deliveryDate}</b> وتُغلق {formatAmman(win.cutoffAt)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/orders/summary?date=${date}`}>
            <Button variant="outline">الكشف المبدئي</Button>
          </Link>
          <Link href="/orders/approvals">
            <Button variant="outline">الموافقات والمسودات</Button>
          </Link>
          {can('orders.manage') && (
            <Link href={`/orders/new?date=${date}`}>
              <Button>+ طلب جديد</Button>
            </Link>
          )}
        </div>
      </div>

      <ErrorBox message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(['submitted', 'confirmed', 'pending_approval', 'draft'] as OrderStatus[]).map((s) => (
          <button key={s} onClick={() => setStatus(status === s ? '' : s)} className="text-right">
            <Card>
              <div className="text-xs text-brand-muted">{ORDER_STATUS_LABELS_AR[s]}</div>
              <div className="text-2xl font-bold text-brand-brown">{counts[s] ?? 0}</div>
            </Card>
          </button>
        ))}
        <Card>
          <div className="text-xs text-brand-muted">مجموع الطلبات</div>
          <div className="text-xl font-bold text-brand-brown">{formatJod(total)}</div>
        </Card>
      </div>

      <Card
        title={`طلبات يوم ${date || '…'}${data ? ` (${data.total})` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              className={filterClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <select
              className={filterClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as '' | OrderStatus)}
            >
              <option value="">كل الحالات</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_LABELS_AR[s]}
                </option>
              ))}
            </select>
            <input
              className={`${filterClass} w-52`}
              placeholder="رقم الطلب أو العميل"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-right text-brand-muted">
                <th className="py-2">رقم الطلب</th>
                <th>العميل</th>
                <th>الفرع</th>
                <th>الأصناف</th>
                <th>المجموع</th>
                <th>المصدر</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((o) => (
                <tr key={o.id} className="border-b border-stone-100 hover:bg-brand-cream/50">
                  <td className="py-2.5 pl-4 font-mono">
                    <Link href={`/orders/${o.id}`} className="text-brand-brown underline">
                      {o.number}
                    </Link>
                  </td>
                  <td className="font-bold">{o.customerName}</td>
                  <td>
                    {o.branchName}{' '}
                    <span className="font-mono text-xs text-brand-muted">{o.branchCode}</span>
                  </td>
                  <td>{o.itemCount}</td>
                  <td className="font-bold">{formatJod(o.total)}</td>
                  <td className="text-brand-muted">{ORDER_SOURCE_LABELS_AR[o.source]}</td>
                  <td>
                    <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS_AR[o.status]}</Badge>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-brand-muted">
                    لا توجد طلبات لهذا اليوم
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
