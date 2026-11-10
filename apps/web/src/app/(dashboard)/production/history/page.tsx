'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PRODUCTION_DAY_STATUS_LABELS_AR, type ProductionDayStatus } from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { Badge, Card, ErrorBox } from '@/components/ui';
import { DAY_TONE } from '@/lib/production';

type Day = {
  id: string;
  deliveryDate: string;
  status: ProductionDayStatus;
  itemCount: number;
  ordered: number;
  planned: number;
  produced: number;
  loaded: number;
  waste: number;
  returned: number;
  flagged: number;
};

export default function ProductionHistoryPage() {
  const [days, setDays] = useState<Day[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Day[]>('/api/production/history')
      .then(setDays)
      .catch((err) => setError(errorMessage(err, 'تعذّر التحميل')));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/production" className="text-sm text-brand-muted underline">
          ← الإنتاج
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-brand-brown">سجل الإنتاج (آخر 30 يوماً)</h1>
      </div>
      <ErrorBox message={error} />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-right text-brand-muted">
                <th className="py-2">اليوم</th>
                <th>الحالة</th>
                <th>الأصناف</th>
                <th>مطلوب</th>
                <th>مخطط</th>
                <th>منتج</th>
                <th>محمّل</th>
                <th>تالف</th>
                <th>مرتجع</th>
                <th>فروقات</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.id} className="border-b border-stone-100">
                  <td className="py-2 font-mono font-bold">{d.deliveryDate}</td>
                  <td>
                    <Badge tone={DAY_TONE[d.status]}>
                      {PRODUCTION_DAY_STATUS_LABELS_AR[d.status]}
                    </Badge>
                  </td>
                  <td>{d.itemCount}</td>
                  <td>{d.ordered}</td>
                  <td>{d.planned}</td>
                  <td>{d.produced}</td>
                  <td>{d.loaded}</td>
                  <td>{d.waste}</td>
                  <td>{d.returned}</td>
                  <td className={d.flagged ? 'font-bold text-red-800' : 'text-green-800'}>
                    {d.flagged || '✓'}
                  </td>
                </tr>
              ))}
              {days.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-brand-muted">
                    لا يوجد سجل بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-brand-muted">
          لفتح يوم سابق: صفحة الإنتاج ← اختاري التاريخ. «فروقات» هو عدد الأصناف خارج السماحية
          (المعتمدة وغير المعتمدة).
        </p>
      </Card>
    </div>
  );
}
