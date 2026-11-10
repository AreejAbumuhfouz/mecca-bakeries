'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ITEM_UNIT_LABELS_AR,
  PRODUCTION_DAY_STATUS_LABELS_AR,
  STOCK_LOSS_REASON_LABELS_AR,
  STOCK_LOSS_REASONS,
  type StockLossKind,
  type StockLossReason,
} from '@mecca/shared';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input, Select } from '@/components/ui';
import { formatAmman } from '@/lib/orders';
import { DAY_TONE, groupByLine, type ProductionDay, type Vehicle } from '@/lib/production';
import { t } from '@/lib/i18n';

type Tab = 'plan' | 'loading' | 'losses' | 'variances';
const TABS: { key: Tab; label: string }[] = [
  { key: 'plan', label: t('الخطة والإنتاج') },
  { key: 'loading', label: t('التحميل على السيارات') },
  { key: 'losses', label: t('التالف والمرتجع') },
  { key: 'variances', label: t('الفروقات وإغلاق اليوم') },
];
const num = (v: string) => Math.max(0, Math.trunc(Number(v.replace(/\D/g, '')) || 0));
const cell = 'h-8 w-20 rounded-lg border border-brand-line px-2 text-center';
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export default function ProductionPage() {
  const { can } = useAuth();
  const canManage = can('production.manage');
  const [date, setDate] = useState('');
  const [day, setDay] = useState<ProductionDay | null | undefined>(undefined);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [tab, setTab] = useState<Tab>('plan');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Draft edits, keyed by item (plan) or `${vehicleId}:${itemId}` (loading).
  const [plan, setPlan] = useState<Record<string, { extra: string; produced: string }>>({});
  const [loads, setLoads] = useState<Record<string, string>>({});
  const [loss, setLoss] = useState({
    itemId: '',
    kind: 'waste' as StockLossKind,
    reason: 'burnt' as StockLossReason,
    quantity: '',
    note: '',
  });
  const [approveNotes, setApproveNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    void api<{ deliveryDate: string }>('/api/orders/window')
      .then((w) => setDate(w.deliveryDate))
      .catch(() => setDate(new Date().toISOString().slice(0, 10)));
    void api<Vehicle[]>('/api/production/vehicles')
      .then(setVehicles)
      .catch(() => undefined);
  }, []);

  const apply = useCallback((d: ProductionDay | null) => {
    setDay(d);
    if (!d) return;
    setPlan(
      Object.fromEntries(
        d.items.map((i) => [
          i.itemId,
          { extra: String(i.extra), produced: i.produced === null ? '' : String(i.produced) },
        ]),
      ),
    );
    setLoads(
      Object.fromEntries(d.loads.map((l) => [`${l.vehicleId}:${l.itemId}`, String(l.quantity)])),
    );
  }, []);

  const load = useCallback(async () => {
    if (!date) return;
    apply(await api<ProductionDay | null>(`/api/production/days/${date}`));
  }, [date, apply]);

  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, [load]);

  async function run(fn: () => Promise<ProductionDay | null>, fallback: string) {
    setError('');
    setBusy(true);
    try {
      apply(await fn());
      return true;
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'OPEN_VARIANCES') {
        setError(t('يوجد فروقات لم تُعتمد بعد — اعتمدها من الأسفل ثم أغلق اليوم'));
        setTab('variances');
      } else setError(errorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const generate = () =>
    run(
      () => api<ProductionDay>(`/api/production/days/${date}/generate`, { method: 'POST' }),
      t('تعذّر توليد الخطة'),
    );

  const savePlan = () => {
    if (!day) return;
    const updates = day.items
      .map((i) => {
        const d = plan[i.itemId];
        if (!d) return null;
        const extra = num(d.extra);
        const produced = d.produced.trim() === '' ? null : num(d.produced);
        if (extra === i.extra && produced === i.produced) return null;
        return { itemId: i.itemId, extraQty: extra, producedQty: produced };
      })
      .filter(Boolean);
    if (!updates.length) return;
    void run(
      () =>
        api<ProductionDay>(`/api/production/days/${date}/items`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }),
      t('تعذّر الحفظ'),
    );
  };

  const saveLoads = async () => {
    if (!day) return;
    for (const v of vehicles.filter((x) => x.isActive)) {
      const lines = day.items.map((i) => ({
        itemId: i.itemId,
        quantity: num(loads[`${v.id}:${i.itemId}`] ?? '0'),
      }));
      const ok = await run(
        () =>
          api<ProductionDay>(`/api/production/days/${date}/loads`, {
            method: 'PUT',
            body: JSON.stringify({ vehicleId: v.id, lines }),
          }),
        t('تعذّر حفظ التحميل'),
      );
      if (!ok) return;
    }
  };

  async function addLoss(e: FormEvent) {
    e.preventDefault();
    const ok = await run(
      () =>
        api<ProductionDay>(`/api/production/days/${date}/losses`, {
          method: 'POST',
          body: JSON.stringify({ ...loss, quantity: num(loss.quantity), note: loss.note || null }),
        }),
      t('تعذّر الحفظ'),
    );
    if (ok) setLoss({ ...loss, quantity: '', note: '' });
  }

  const groups = useMemo(() => groupByLine(day?.items ?? []), [day]);
  const closed = day?.status === 'closed';
  const editable = canManage && !closed;
  const activeVehicles = vehicles.filter((v) => v.isActive);
  const openCount = day?.items.filter((i) => i.open).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-brand-brown">{t('الإنتاج والمخزون')}</h1>
          <p className="text-sm text-brand-muted">
            {t(
              'الخطة تُبنى من الطلبات: مبدئية قبل الإغلاق، ونهائية تلقائياً بعده من الطلبات المؤكدة.',
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            className="rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Link href="/production/history">
            <Button variant="outline">{t('السجل')}</Button>
          </Link>
          <Link href="/production/setup">
            <Button variant="outline">{t('الخطوط والسيارات')}</Button>
          </Link>
          {day && (
            <Button variant="outline" onClick={() => window.print()}>
              {t('طباعة الكشف')}
            </Button>
          )}
        </div>
      </div>

      <ErrorBox message={error} />

      {day === null && (
        <Card>
          <p className="mb-3 text-sm">{t('لم تُنشأ خطة إنتاج ليوم {0} بعد.', date)}</p>
          {canManage && (
            <Button disabled={busy} onClick={() => void generate()}>
              {t('توليد الخطة من الطلبات')}
            </Button>
          )}
        </Card>
      )}

      {day && (
        <>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <Badge tone={DAY_TONE[day.status]}>
              {t(PRODUCTION_DAY_STATUS_LABELS_AR[day.status])}
            </Badge>
            <span className="text-sm text-brand-muted">
              {t('آخر تحديث من الطلبات: {0}', formatAmman(day.generatedAt))}
            </span>
            {day.pendingOrders > 0 && (
              <span className="text-sm text-red-800">
                {t('{0} طلب بانتظار موافقة الائتمان', day.pendingOrders)}{' '}
                {day.status === 'final' ? t('(غير محسوب)') : t('(محسوب مبدئياً)')}
              </span>
            )}
            {editable && (
              <Button variant="outline" disabled={busy} onClick={() => void generate()}>
                {t('تحديث من الطلبات')}
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2 print:hidden">
            {TABS.map((tr) => (
              <button
                key={tr.key}
                onClick={() => setTab(tr.key)}
                className={`rounded-full px-4 py-2 text-sm font-bold ${
                  tab === tr.key
                    ? 'bg-primary text-on-primary'
                    : 'border border-brand-line bg-surface text-brand-brown'
                }`}
              >
                {tr.label}
                {tr.key === 'variances' && openCount > 0 && (
                  <span className="ms-1 text-red-300">({openCount})</span>
                )}
              </button>
            ))}
          </div>

          <h2 className="hidden text-xl font-bold print:block">
            {t(
              'كشف الإنتاج ليوم {0} — {1}',
              day.deliveryDate,
              t(PRODUCTION_DAY_STATUS_LABELS_AR[day.status]),
            )}
          </h2>

          {(tab === 'plan' || closed) && (
            <Card
              title={t('خطة الإنتاج')}
              actions={
                editable && (
                  <Button disabled={busy} onClick={savePlan} className="print:hidden">
                    {t('حفظ')}
                  </Button>
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-line text-start text-brand-muted">
                      <th className="py-2">{t('الكود')}</th>
                      <th>{t('الصنف')}</th>
                      <th>{t('المطلوب')}</th>
                      <th>{t('إضافي')}</th>
                      <th>{t('المخطط')}</th>
                      <th>{t('المنتج فعلياً')}</th>
                      <th>{t('الفرق')}</th>
                    </tr>
                  </thead>
                  {groups.map((g) => (
                    <tbody key={g.key}>
                      <tr>
                        <td
                          colSpan={7}
                          className="bg-brand-cream px-2 py-1.5 font-bold text-brand-brown"
                        >
                          {g.title}
                        </td>
                      </tr>
                      {g.items.map((i) => {
                        const d = plan[i.itemId] ?? { extra: '0', produced: '' };
                        return (
                          <tr key={i.itemId} className="border-b border-stone-100">
                            <td className="py-1.5 pe-4 font-mono">{i.code}</td>
                            <td className="font-bold">
                              {i.name}{' '}
                              <span className="text-xs font-normal text-brand-muted">
                                {t(ITEM_UNIT_LABELS_AR[i.unit])}
                              </span>
                            </td>
                            <td>{i.ordered}</td>
                            <td>
                              {editable ? (
                                <input
                                  dir="ltr"
                                  className={cell}
                                  aria-label={t('إضافي {0}', i.name)}
                                  value={d.extra}
                                  onChange={(e) =>
                                    setPlan({
                                      ...plan,
                                      [i.itemId]: { ...d, extra: e.target.value },
                                    })
                                  }
                                />
                              ) : (
                                i.extra
                              )}
                            </td>
                            <td className="text-lg font-bold">{num(d.extra) + i.ordered}</td>
                            <td>
                              {editable ? (
                                <input
                                  dir="ltr"
                                  className={cell}
                                  aria-label={t('المنتج {0}', i.name)}
                                  placeholder="—"
                                  value={d.produced}
                                  onChange={(e) =>
                                    setPlan({
                                      ...plan,
                                      [i.itemId]: { ...d, produced: e.target.value },
                                    })
                                  }
                                />
                              ) : (
                                (i.produced ?? '—')
                              )}
                            </td>
                            <td
                              className={
                                i.productionDiff ? 'font-bold text-red-800' : 'text-brand-muted'
                              }
                            >
                              {i.produced === null ? '—' : signed(i.productionDiff)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
              {day.items.length === 0 && (
                <p className="py-4 text-sm text-brand-muted">{t('لا توجد طلبات لهذا اليوم.')}</p>
              )}
            </Card>
          )}

          {tab === 'loading' && !closed && (
            <Card
              title={t('التحميل على السيارات')}
              actions={
                editable &&
                activeVehicles.length > 0 && (
                  <Button disabled={busy} onClick={() => void saveLoads()}>
                    {t('حفظ التحميل')}
                  </Button>
                )
              }
            >
              {activeVehicles.length === 0 ? (
                <p className="text-sm text-brand-muted">
                  {t('أضف السيارات أولاً من')}{' '}
                  <Link href="/production/setup" className="underline">
                    {t('الخطوط والسيارات')}
                  </Link>
                  .
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-brand-line text-start text-brand-muted">
                        <th className="py-2">{t('الصنف')}</th>
                        <th>{t('المطلوب')}</th>
                        {activeVehicles.map((v) => (
                          <th key={v.id}>
                            {v.name}
                            {v.driverName && (
                              <div className="text-xs font-normal">{v.driverName}</div>
                            )}
                          </th>
                        ))}
                        <th>{t('المجموع المحمّل')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.items.map((i) => {
                        const total = activeVehicles.reduce(
                          (s, v) => s + num(loads[`${v.id}:${i.itemId}`] ?? '0'),
                          0,
                        );
                        return (
                          <tr key={i.itemId} className="border-b border-stone-100">
                            <td className="py-1.5 font-bold">{i.name}</td>
                            <td>{i.ordered}</td>
                            {activeVehicles.map((v) => (
                              <td key={v.id}>
                                <input
                                  dir="ltr"
                                  className={cell}
                                  aria-label={`${v.name} ${i.name}`}
                                  disabled={!editable}
                                  value={loads[`${v.id}:${i.itemId}`] ?? ''}
                                  placeholder="0"
                                  onChange={(e) =>
                                    setLoads({ ...loads, [`${v.id}:${i.itemId}`]: e.target.value })
                                  }
                                />
                              </td>
                            ))}
                            <td
                              className={`font-bold ${total !== i.ordered ? 'text-red-800' : 'text-green-800'}`}
                            >
                              {total}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'losses' && !closed && (
            <Card title={t('التالف والمرتجع')}>
              {editable && (
                <form onSubmit={addLoss} className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-6">
                  <Select
                    label={t('الصنف')}
                    required
                    value={loss.itemId}
                    onChange={(e) => setLoss({ ...loss, itemId: e.target.value })}
                  >
                    <option value="">{t('— اختر —')}</option>
                    {day.items.map((i) => (
                      <option key={i.itemId} value={i.itemId}>
                        {i.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label={t('النوع')}
                    value={loss.kind}
                    onChange={(e) => setLoss({ ...loss, kind: e.target.value as StockLossKind })}
                  >
                    <option value="waste">{t('تالف في المخبز')}</option>
                    <option value="return">{t('مرتجع من العميل')}</option>
                  </Select>
                  <Select
                    label={t('السبب')}
                    value={loss.reason}
                    onChange={(e) =>
                      setLoss({ ...loss, reason: e.target.value as StockLossReason })
                    }
                  >
                    {STOCK_LOSS_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {t(STOCK_LOSS_REASON_LABELS_AR[r])}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label={t('الكمية')}
                    dir="ltr"
                    required
                    value={loss.quantity}
                    onChange={(e) => setLoss({ ...loss, quantity: e.target.value })}
                  />
                  <Input
                    label={t('ملاحظة')}
                    value={loss.note}
                    onChange={(e) => setLoss({ ...loss, note: e.target.value })}
                  />
                  <div className="self-end">
                    <Button
                      type="submit"
                      variant="gold"
                      disabled={busy || !loss.itemId || !num(loss.quantity)}
                    >
                      {t('إضافة')}
                    </Button>
                  </div>
                </form>
              )}
              <ul className="divide-y divide-stone-100 text-sm">
                {day.losses.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-2">
                    <Badge tone={l.kind === 'waste' ? 'red' : 'gold'}>
                      {l.kind === 'waste' ? t('تالف') : t('مرتجع')}
                    </Badge>
                    <b>{l.itemName}</b>
                    <span>{l.quantity}</span>
                    <span className="text-brand-muted">
                      {t(STOCK_LOSS_REASON_LABELS_AR[l.reason])}
                    </span>
                    {l.note && <span className="text-brand-muted">— {l.note}</span>}
                    <span className="text-xs text-brand-muted">
                      {l.createdByName} {formatAmman(l.createdAt)}
                    </span>
                    {editable && (
                      <button
                        className="ms-auto text-xs text-red-700 underline"
                        onClick={() =>
                          void run(
                            () =>
                              api<ProductionDay>(`/api/production/days/${date}/losses/${l.id}`, {
                                method: 'DELETE',
                              }),
                            t('تعذّر الحذف'),
                          )
                        }
                      >
                        {t('حذف')}
                      </button>
                    )}
                  </li>
                ))}
                {day.losses.length === 0 && (
                  <li className="py-2 text-brand-muted">{t('لا يوجد تالف أو مرتجع مسجّل')}</li>
                )}
              </ul>
            </Card>
          )}

          {(tab === 'variances' || closed) && (
            <Card
              title={t('تقرير الفروقات (السماحية {0}%)', day.toleranceBps / 100)}
              actions={
                editable && (
                  <Button
                    disabled={busy || day.status !== 'final'}
                    title={
                      day.status !== 'final'
                        ? t('يُغلق اليوم بعد اعتماد الخطة النهائية')
                        : undefined
                    }
                    onClick={() =>
                      void run(
                        () =>
                          api<ProductionDay>(`/api/production/days/${date}/close`, {
                            method: 'POST',
                          }),
                        t('تعذّر إغلاق اليوم'),
                      )
                    }
                    className="print:hidden"
                  >
                    {t('إغلاق اليوم')}
                  </Button>
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-line text-start text-brand-muted">
                      <th className="py-2">{t('الصنف')}</th>
                      <th>{t('مطلوب')}</th>
                      <th>{t('مخطط')}</th>
                      <th>{t('منتج')}</th>
                      <th>{t('محمّل')}</th>
                      <th>{t('تالف')}</th>
                      <th>{t('مرتجع')}</th>
                      <th>{t('متبقٍ')}</th>
                      <th>{t('الملاحظة')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.items.map((i) => (
                      <tr
                        key={i.itemId}
                        className={`border-b border-stone-100 ${i.open ? 'bg-red-50/60' : ''}`}
                      >
                        <td className="py-2 font-bold">{i.name}</td>
                        <td>{i.ordered}</td>
                        <td>{i.planned}</td>
                        <td>{i.produced ?? '—'}</td>
                        <td>{i.loaded}</td>
                        <td>{i.waste}</td>
                        <td>{i.returned}</td>
                        <td className={i.leftover < 0 ? 'font-bold text-red-800' : ''}>
                          {i.produced === null ? '—' : i.leftover}
                        </td>
                        <td className="min-w-72">
                          {i.reasons.length === 0 ? (
                            <span className="text-green-800">{t('مطابق ✓')}</span>
                          ) : (
                            <div className="space-y-1">
                              <div className="text-red-800">{i.reasons.join(t('، '))}</div>
                              {i.approval ? (
                                <div className="text-xs text-green-800">
                                  {t(
                                    'اعتُمد: {0} — {1}',
                                    i.approval.note,
                                    i.approval.approvedByName,
                                  )}
                                </div>
                              ) : (
                                can('variances.approve') &&
                                !closed && (
                                  <div className="flex gap-1 print:hidden">
                                    <input
                                      className="h-8 flex-1 rounded-lg border border-brand-line px-2 text-xs"
                                      placeholder={t('سبب الفرق')}
                                      value={approveNotes[i.itemId] ?? ''}
                                      onChange={(e) =>
                                        setApproveNotes({
                                          ...approveNotes,
                                          [i.itemId]: e.target.value,
                                        })
                                      }
                                    />
                                    <Button
                                      className="!px-3 !py-1 text-xs"
                                      disabled={
                                        busy || (approveNotes[i.itemId] ?? '').trim().length < 3
                                      }
                                      onClick={() =>
                                        void run(
                                          () =>
                                            api<ProductionDay>(
                                              `/api/production/days/${date}/variances/approve`,
                                              {
                                                method: 'POST',
                                                body: JSON.stringify({
                                                  itemId: i.itemId,
                                                  note: approveNotes[i.itemId],
                                                }),
                                              },
                                            ),
                                          t('تعذّر الاعتماد'),
                                        )
                                      }
                                    >
                                      {t('اعتماد')}
                                    </Button>
                                  </div>
                                )
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-brand-muted">
                {t(
                  'المتبقي = المنتج − المحمّل − التالف. يُعتمد كل فرق خارج السماحية بسبب مكتوب قبل إغلاق اليوم.',
                )}
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
