'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Input, Select } from '@/components/ui';
import { OrderLinesEditor, toLines, type Quantities } from '@/components/order-lines-editor';
import type { CustomerRow, Customer } from '@/lib/customers';
import type { CatalogItem } from '@/lib/orders';

function NewOrder() {
  const router = useRouter();
  const params = useSearchParams();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(params.get('date') ?? '');
  const [notes, setNotes] = useState('');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [quantities, setQuantities] = useState<Quantities>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ items: CustomerRow[] }>('/api/customers?pageSize=100&isActive=true')
      .then((r) => setCustomers(r.items))
      .catch(() => setError('تعذّر تحميل العملاء'));
  }, []);

  useEffect(() => {
    setCustomer(null);
    setBranchId('');
    if (!customerId) return;
    void api<Customer>(`/api/customers/${customerId}`).then((c) => {
      setCustomer(c);
      const active = c.branches.filter((b) => b.isActive);
      if (active.length === 1) setBranchId(active[0]!.id);
    });
  }, [customerId]);

  useEffect(() => {
    setCatalog([]);
    if (!branchId) return;
    const qs = new URLSearchParams({ branchId, ...(date ? { date } : {}) });
    void api<CatalogItem[]>(`/api/orders/catalog?${qs}`)
      .then(setCatalog)
      .catch((err) => setError(errorMessage(err, 'تعذّر تحميل الأسعار')));
  }, [branchId, date]);

  async function save() {
    setError('');
    setBusy(true);
    try {
      const order = await api<{ id: string }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          branchId,
          deliveryDate: date || undefined,
          lines: toLines(quantities),
          notes: notes || null,
        }),
      });
      router.push(`/orders/${order.id}`);
    } catch (err) {
      const existing =
        err instanceof ApiRequestError && err.code === 'ORDER_EXISTS'
          ? ' — افتحي الطلب الموجود من قائمة الطلبات لتعديله'
          : '';
      setError(errorMessage(err, 'تعذّر حفظ الطلب') + existing);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-brand-muted underline">
          ← الطلبات
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-brand-brown">طلب جديد (من لوحة التحكم)</h1>
        <p className="text-sm text-brand-muted">
          للطلبات الهاتفية أو الإضافات المتأخرة. السعر من عقد العميل ويُطبق فحص الائتمان نفسه.
        </p>
      </div>

      <ErrorBox message={error} />

      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Select label="العميل" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— اختر —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
          <Select
            label="الفرع"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            disabled={!customer}
          >
            <option value="">— اختر —</option>
            {customer?.branches
              .filter((b) => b.isActive)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
          </Select>
          <Input
            label="تاريخ التسليم"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </Card>

      {branchId && (
        <Card title="الأصناف">
          <OrderLinesEditor catalog={catalog} quantities={quantities} onChange={setQuantities} />
          <div className="mt-4">
            <Button disabled={busy || toLines(quantities).length === 0} onClick={() => void save()}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ الطلب'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense>
      <NewOrder />
    </Suspense>
  );
}
