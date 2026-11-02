'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input } from '@/components/ui';
import {
  emptyBranchForm,
  toBody,
  type Branch,
  type BranchForm,
  type Category,
  type Customer,
  type CustomerForm,
} from '@/lib/customers';
import { CustomerFields } from '../customer-fields';

const errMsg = (err: unknown, fallback: string) =>
  err instanceof ApiRequestError ? err.message : fallback;

const customerToForm = (c: Customer): CustomerForm => ({
  code: c.code,
  name: c.name,
  nameEn: c.nameEn ?? '',
  categoryId: c.categoryId ?? '',
  contactName: c.contactName ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
  city: c.city ?? '',
  address: c.address ?? '',
  notes: c.notes ?? '',
});

const branchToForm = (b: Branch): BranchForm => ({
  code: b.code,
  name: b.name,
  contactName: b.contactName ?? '',
  phone: b.phone ?? '',
  city: b.city ?? '',
  address: b.address ?? '',
  deliveryNotes: b.deliveryNotes ?? '',
});

function Info({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div>
      <div className="text-xs text-brand-muted">{label}</div>
      <div className="font-bold" dir={ltr ? 'ltr' : undefined} style={{ textAlign: 'right' }}>
        {value || '—'}
      </div>
    </div>
  );
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const canManage = can('customers.manage');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CustomerForm | null>(null);
  /** null = closed, 'new' = add form, otherwise the branch id being edited. */
  const [branchEdit, setBranchEdit] = useState<string | null>(null);
  const [branchForm, setBranchForm] = useState<BranchForm>(emptyBranchForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setCustomer(await api<Customer>(`/api/customers/${id}`));
  }, [id]);

  useEffect(() => {
    void load().catch((err) => setError(errMsg(err, 'تعذّر تحميل العميل')));
    void api<Category[]>('/api/customers/categories')
      .then(setCategories)
      .catch(() => undefined);
  }, [load]);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(errMsg(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveCustomer(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const ok = await run(
      () => api(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify(toBody(form)) }),
      'تعذّر حفظ التعديلات',
    );
    if (ok) setEditing(false);
  }

  const toggleCustomer = () =>
    customer &&
    run(
      () =>
        api(`/api/customers/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !customer.isActive }),
        }),
      'تعذّر تحديث الحالة',
    );

  async function saveBranch(e: FormEvent) {
    e.preventDefault();
    const body = JSON.stringify(toBody(branchForm));
    const ok = await run(
      () =>
        branchEdit === 'new'
          ? api(`/api/customers/${id}/branches`, { method: 'POST', body })
          : api(`/api/customers/${id}/branches/${branchEdit}`, { method: 'PATCH', body }),
      'تعذّر حفظ الفرع',
    );
    if (ok) setBranchEdit(null);
  }

  const toggleBranch = (b: Branch) =>
    run(
      () =>
        api(`/api/customers/${id}/branches/${b.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !b.isActive }),
        }),
      'تعذّر تحديث الفرع',
    );

  if (!customer) {
    return (
      <div className="space-y-4">
        <ErrorBox message={error} />
        {!error && <p className="text-brand-muted">جارٍ التحميل…</p>}
      </div>
    );
  }

  const setB = (key: keyof BranchForm) => (e: { target: { value: string } }) =>
    setBranchForm({ ...branchForm, [key]: e.target.value });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/customers" className="text-sm text-brand-muted underline">
            ← العملاء
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-brand-brown">
            {customer.name}{' '}
            <span className="font-mono text-base text-brand-muted" dir="ltr">
              {customer.code}
            </span>
          </h1>
          <div className="mt-1">
            {customer.isActive ? (
              <Badge tone="green">فعّال</Badge>
            ) : (
              <Badge tone="red">موقوف</Badge>
            )}
          </div>
        </div>
        {canManage && !editing && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void toggleCustomer()} disabled={busy}>
              {customer.isActive ? 'إيقاف العميل' : 'تفعيل العميل'}
            </Button>
            <Button
              onClick={() => {
                setForm(customerToForm(customer));
                setEditing(true);
              }}
            >
              تعديل البيانات
            </Button>
          </div>
        )}
      </div>

      <ErrorBox message={error} />

      <Card title="بيانات العميل">
        {editing && form ? (
          <form onSubmit={saveCustomer} className="space-y-4">
            <CustomerFields form={form} setForm={setForm} categories={categories} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                إلغاء
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Info label="الاسم بالإنجليزية" value={customer.nameEn} ltr />
            <Info label="الفئة" value={customer.category?.name ?? null} />
            <Info label="الشخص المسؤول" value={customer.contactName} />
            <Info label="الهاتف" value={customer.phone} ltr />
            <Info label="البريد الإلكتروني" value={customer.email} ltr />
            <Info label="المدينة" value={customer.city} />
            <Info label="العنوان" value={customer.address} />
            <Info label="ملاحظات" value={customer.notes} />
          </div>
        )}
      </Card>

      <Card
        title={`الفروع (${customer.branches.length})`}
        actions={
          canManage &&
          branchEdit === null && (
            <Button
              variant="gold"
              onClick={() => {
                setBranchForm(emptyBranchForm);
                setBranchEdit('new');
              }}
            >
              + فرع جديد
            </Button>
          )
        }
      >
        {branchEdit !== null && (
          <form
            onSubmit={saveBranch}
            className="mb-5 space-y-4 rounded-xl border border-brand-line bg-brand-cream/40 p-4"
          >
            <h3 className="font-bold text-brand-brown">
              {branchEdit === 'new' ? 'فرع جديد' : 'تعديل الفرع'}
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input
                label="اسم الفرع"
                required
                minLength={2}
                value={branchForm.name}
                onChange={setB('name')}
              />
              <Input
                label="كود الفرع"
                dir="ltr"
                placeholder={branchEdit === 'new' ? 'يُولَّد تلقائياً' : undefined}
                value={branchForm.code}
                onChange={setB('code')}
              />
              <Input
                label="الشخص المسؤول"
                value={branchForm.contactName}
                onChange={setB('contactName')}
              />
              <Input label="الهاتف" dir="ltr" value={branchForm.phone} onChange={setB('phone')} />
              <Input label="المدينة" value={branchForm.city} onChange={setB('city')} />
              <Input label="العنوان" value={branchForm.address} onChange={setB('address')} />
              <div className="md:col-span-3">
                <Input
                  label="ملاحظات التسليم للسائق"
                  value={branchForm.deliveryNotes}
                  onChange={setB('deliveryNotes')}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ الفرع'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setBranchEdit(null)}>
                إلغاء
              </Button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-right text-brand-muted">
                <th className="py-2">الكود</th>
                <th>الفرع</th>
                <th>المسؤول</th>
                <th>الهاتف</th>
                <th>العنوان</th>
                <th>الحالة</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {customer.branches.map((b) => (
                <tr key={b.id} className="border-b border-stone-100">
                  <td className="py-2.5 pl-4 font-mono">{b.code}</td>
                  <td className="font-bold">
                    {b.name}
                    {b.deliveryNotes && (
                      <div className="text-xs font-normal text-brand-muted">{b.deliveryNotes}</div>
                    )}
                  </td>
                  <td>{b.contactName ?? '—'}</td>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {b.phone ?? '—'}
                  </td>
                  <td>{[b.city, b.address].filter(Boolean).join(' - ') || '—'}</td>
                  <td>
                    {b.isActive ? (
                      <Badge tone="green">فعّال</Badge>
                    ) : (
                      <Badge tone="red">موقوف</Badge>
                    )}
                  </td>
                  {canManage && (
                    <td className="text-xs">
                      <div className="flex justify-end gap-3">
                        <button
                          className="text-brand-brown underline"
                          onClick={() => {
                            setBranchForm(branchToForm(b));
                            setBranchEdit(b.id);
                          }}
                        >
                          تعديل
                        </button>
                        <button
                          className="text-brand-brown underline"
                          onClick={() => void toggleBranch(b)}
                        >
                          {b.isActive ? 'إيقاف' : 'تفعيل'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {customer.branches.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-brand-muted">
                    لا توجد فروع — أضف فرعاً حتى يمكن استقبال الطلبات لهذا العميل
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
