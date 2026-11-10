'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  PURCHASE_ORDER_STATUS_LABELS_AR,
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderStatus,
} from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input } from '@/components/ui';
import { formatAmman } from '@/lib/orders';
import { PO_TONE, type PoRow, type Supplier } from '@/lib/purchasing';
import { t } from '@/lib/i18n';

const emptySupplier = { name: '', contactName: '', phone: '', whatsappPhone: '', address: '' };

export default function PurchasingPage() {
  const { can } = useAuth();
  const canManage = can('purchasing.manage');
  const [orders, setOrders] = useState<PoRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [status, setStatus] = useState<'' | PurchaseOrderStatus>('');
  const [form, setForm] = useState(emptySupplier);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ pageSize: '100', ...(status ? { status } : {}) });
    const [o, s] = await Promise.all([
      api<{ items: PoRow[] }>(`/api/purchasing/orders?${qs}`),
      api<Supplier[]>('/api/purchasing/suppliers'),
    ]);
    setOrders(o.items);
    setSuppliers(s);
  }, [status]);

  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, [load]);

  async function saveSupplier(e: FormEvent) {
    e.preventDefault();
    setError('');
    const body = JSON.stringify(
      Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v.trim() || (k === 'name' ? v : null)]),
      ),
    );
    try {
      if (editing === 'new') await api('/api/purchasing/suppliers', { method: 'POST', body });
      else await api(`/api/purchasing/suppliers/${editing}`, { method: 'PATCH', body });
      setEditing(null);
      setForm(emptySupplier);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('تعذّر حفظ المورد')));
    }
  }

  const set = (k: keyof typeof emptySupplier) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-brown">{t('طلبات الشراء')}</h1>
          <p className="text-sm text-brand-muted">
            {t('طلب الشراء يُرسل للمورد ملف PDF على واتساب.')}
          </p>
        </div>
        {canManage && (
          <Link href="/purchasing/new">
            <Button>{t('+ طلب شراء')}</Button>
          </Link>
        )}
      </div>
      <ErrorBox message={error} />

      <Card
        title={t('الطلبات ({0})', orders.length)}
        actions={
          <select
            className="rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | PurchaseOrderStatus)}
          >
            <option value="">{t('كل الحالات')}</option>
            {PURCHASE_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(PURCHASE_ORDER_STATUS_LABELS_AR[s])}
              </option>
            ))}
          </select>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-start text-brand-muted">
                <th className="py-2">{t('الرقم')}</th>
                <th>{t('المورد')}</th>
                <th>{t('البنود')}</th>
                <th>{t('مطلوب بتاريخ')}</th>
                <th>{t('أُنشئ')}</th>
                <th>{t('الحالة')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-stone-100">
                  <td className="py-2 pe-4 font-mono">
                    <Link href={`/purchasing/${o.id}`} className="text-brand-brown underline">
                      {o.number}
                    </Link>
                  </td>
                  <td className="font-bold">{o.supplierName}</td>
                  <td>{o.lineCount}</td>
                  <td className="font-mono">{o.neededDate ?? '—'}</td>
                  <td className="text-brand-muted">{formatAmman(o.createdAt)}</td>
                  <td>
                    <Badge tone={PO_TONE[o.status]}>
                      {t(PURCHASE_ORDER_STATUS_LABELS_AR[o.status])}
                    </Badge>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-brand-muted">
                    {t('لا توجد طلبات شراء')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={t('الموردون ({0})', suppliers.length)}
        actions={
          canManage &&
          editing === null && (
            <Button
              variant="gold"
              onClick={() => {
                setForm(emptySupplier);
                setEditing('new');
              }}
            >
              {t('+ مورد')}
            </Button>
          )
        }
      >
        {editing !== null && (
          <form
            onSubmit={saveSupplier}
            className="mb-5 grid grid-cols-1 gap-3 rounded-xl border border-brand-line bg-brand-cream/40 p-4 md:grid-cols-5"
          >
            <Input
              label={t('اسم المورد')}
              required
              minLength={2}
              value={form.name}
              onChange={set('name')}
            />
            <Input
              label={t('الشخص المسؤول')}
              value={form.contactName}
              onChange={set('contactName')}
            />
            <Input label={t('الهاتف')} dir="ltr" value={form.phone} onChange={set('phone')} />
            <Input
              label={t('رقم واتساب (للطلبات)')}
              dir="ltr"
              value={form.whatsappPhone}
              onChange={set('whatsappPhone')}
            />
            <Input label={t('العنوان')} value={form.address} onChange={set('address')} />
            <div className="flex gap-2 md:col-span-5">
              <Button type="submit">{t('حفظ')}</Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                {t('إلغاء')}
              </Button>
            </div>
          </form>
        )}
        <ul className="divide-y divide-stone-100 text-sm">
          {suppliers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
              <b>{s.name}</b>
              {s.contactName && <span>{s.contactName}</span>}
              <span dir="ltr" className="font-mono text-brand-muted">
                {s.whatsappPhone ?? s.phone ?? t('بدون رقم')}
              </span>
              <span className="text-brand-muted">{t('{0} طلب', s.orderCount)}</span>
              {!s.isActive && <Badge tone="red">{t('موقوف')}</Badge>}
              {canManage && (
                <span className="ms-auto flex gap-3 text-xs">
                  <button
                    className="text-brand-brown underline"
                    onClick={() => {
                      setForm({
                        name: s.name,
                        contactName: s.contactName ?? '',
                        phone: s.phone ?? '',
                        whatsappPhone: s.whatsappPhone ?? '',
                        address: s.address ?? '',
                      });
                      setEditing(s.id);
                    }}
                  >
                    {t('تعديل')}
                  </button>
                  <button
                    className="text-brand-brown underline"
                    onClick={() =>
                      void api(`/api/purchasing/suppliers/${s.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ isActive: !s.isActive }),
                      })
                        .then(load)
                        .catch((err) => setError(errorMessage(err, t('تعذّر التحديث'))))
                    }
                  >
                    {s.isActive ? t('إيقاف') : t('تفعيل')}
                  </button>
                </span>
              )}
            </li>
          ))}
          {suppliers.length === 0 && (
            <li className="py-2 text-brand-muted">{t('لا يوجد موردون بعد')}</li>
          )}
        </ul>
      </Card>
    </div>
  );
}
