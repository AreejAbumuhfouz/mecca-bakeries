'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  formatJod,
  ITEM_UNIT_LABELS_AR,
  ORDER_STATUS_LABELS_AR,
  type ItemUnit,
  type OrderStatus,
} from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, ErrorBox } from '@/components/ui';
import { t } from '@/lib/i18n';

type Summary = {
  deliveryDate: string;
  items: {
    itemId: string;
    code: string;
    name: string;
    unit: ItemUnit;
    sectionName: string;
    quantity: number;
    confirmedQuantity: number;
    amount: number;
  }[];
  counts: { status: OrderStatus; n: number; total: number }[];
  branchesWithoutOrder: {
    branchId: string;
    branchName: string;
    branchCode: string;
    customerName: string;
    customerPhone: string | null;
  }[];
};

function SummaryView() {
  const params = useSearchParams();
  const [date, setDate] = useState(params.get('date') ?? '');
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const qs = date ? `?date=${date}` : '';
    void api<Summary>(`/api/orders/summary${qs}`)
      .then((s) => {
        setData(s);
        if (!date) setDate(s.deliveryDate);
      })
      .catch((err) => setError(errorMessage(err, t('تعذّر تحميل الكشف'))));
  }, [date]);

  const sections = [...new Set(data?.items.map((i) => i.sectionName))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/orders" className="text-sm text-brand-muted underline">
            {t('← الطلبات')}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-brand-brown">{t('الكشف المبدئي للإنتاج')}</h1>
          <p className="text-sm text-brand-muted">
            {t('مجموع كل صنف من الطلبات المرسلة والمؤكدة والموقوفة.')}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="date"
            className="rounded-lg border border-brand-line px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button variant="outline" onClick={() => window.print()}>
            {t('طباعة')}
          </Button>
        </div>
      </div>
      <ErrorBox message={error} />

      {data && (
        <>
          <h2 className="hidden text-xl font-bold print:block">
            {t('الكشف المبدئي ليوم {0}', data.deliveryDate)}
          </h2>
          <div className="flex flex-wrap gap-3 text-sm">
            {data.counts.map((c) => (
              <span
                key={c.status}
                className="rounded-full border border-brand-line bg-surface px-3 py-1"
              >
                {t(ORDER_STATUS_LABELS_AR[c.status])}: <b>{c.n}</b>
              </span>
            ))}
          </div>

          <Card title={t('الأصناف ليوم {0}', data.deliveryDate)}>
            {data.items.length === 0 ? (
              <p className="text-sm text-brand-muted">{t('لا توجد طلبات لهذا اليوم')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-line text-start text-brand-muted">
                      <th className="py-2">{t('الكود')}</th>
                      <th>{t('الصنف')}</th>
                      <th>{t('الكمية الكلية')}</th>
                      <th>{t('منها مؤكد')}</th>
                      <th>{t('القيمة')}</th>
                    </tr>
                  </thead>
                  {sections.map((sec) => (
                    <tbody key={sec}>
                      <tr>
                        <td
                          colSpan={5}
                          className="bg-brand-cream px-2 py-1.5 font-bold text-brand-brown"
                        >
                          {sec}
                        </td>
                      </tr>
                      {data.items
                        .filter((i) => i.sectionName === sec)
                        .map((i) => (
                          <tr key={i.itemId} className="border-b border-stone-100">
                            <td className="py-2 pe-4 font-mono">{i.code}</td>
                            <td className="font-bold">{i.name}</td>
                            <td className="text-lg font-bold">
                              {i.quantity}{' '}
                              <span className="text-sm font-normal">
                                {t(ITEM_UNIT_LABELS_AR[i.unit])}
                              </span>
                            </td>
                            <td>{i.confirmedQuantity}</td>
                            <td>{formatJod(i.amount)}</td>
                          </tr>
                        ))}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </Card>

          <Card title={t('فروع لم تطلب ({0})', data.branchesWithoutOrder.length)}>
            <ul className="grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
              {data.branchesWithoutOrder.map((b) => (
                <li key={b.branchId}>
                  <b>{b.customerName}</b> — {b.branchName}{' '}
                  <span className="font-mono text-xs text-brand-muted">{b.branchCode}</span>
                  {b.customerPhone && (
                    <span className="ms-2 text-brand-muted" dir="ltr">
                      {b.customerPhone}
                    </span>
                  )}
                </li>
              ))}
              {data.branchesWithoutOrder.length === 0 && (
                <li className="text-brand-muted">{t('كل الفروع طلبت ✓')}</li>
              )}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

export default function SummaryPage() {
  return (
    <Suspense>
      <SummaryView />
    </Suspense>
  );
}
