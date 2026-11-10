'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROLE_LABELS_AR, ROLE_VALUES, type Role } from '@mecca/shared';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Input } from '@/components/ui';
import { UserEditor } from './user-editor';

type UserRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
};
type Page = { items: UserRow[]; total: number };

const emptyForm = { name: '', email: '', phone: '', role: 'orders' as Role, customerId: '' };
type CustomerOption = { id: string; code: string; name: string };

export default function UsersPage() {
  const { can, user: me } = useAuth();
  const [data, setData] = useState<Page | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const canManage = can('users.manage');

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ pageSize: '100', ...(search ? { search } : {}) });
    setData(await api<Page>(`/api/users?${qs}`));
  }, [search]);

  useEffect(() => {
    if (form.role !== 'restaurant' || customers.length) return;
    void api<{ items: CustomerOption[] }>('/api/customers?pageSize=100&isActive=true')
      .then((r) => setCustomers(r.items))
      .catch(() => undefined);
  }, [form.role, customers.length]);

  useEffect(() => {
    const id = setTimeout(() => void load().catch(() => setError('تعذّر تحميل المستخدمين')), 250);
    return () => clearTimeout(id);
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          phone: form.phone || null,
          customerId: form.role === 'restaurant' ? form.customerId || null : null,
        }),
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'تعذّر حفظ المستخدم');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: UserRow) {
    setError('');
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'تعذّر التحديث');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-brown">المستخدمون والصلاحيات</h1>
          <p className="text-sm text-brand-muted">
            الحسابات يضيفها المدير فقط، ويتم الدخول بالبريد ورمز التحقق.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'إلغاء' : '+ مستخدم جديد'}
          </Button>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}

      {editingId && (
        <UserEditor
          key={editingId}
          userId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            void load();
          }}
        />
      )}

      {showForm && (
        <Card title="مستخدم جديد">
          <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Input
              label="الاسم"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              label="البريد الإلكتروني"
              type="email"
              dir="ltr"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label="الهاتف"
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-brand-brown">الدور</span>
              <select
                className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2.5 text-sm"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLE_VALUES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS_AR[r]}
                  </option>
                ))}
              </select>
            </label>
            {form.role === 'restaurant' && (
              <label className="block md:col-span-2">
                <span className="mb-1 block text-sm font-bold text-brand-brown">
                  العميل (حساب المطعم يطلب لكل فروعه)
                </span>
                <select
                  required
                  className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2.5 text-sm"
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                >
                  <option value="">— اختر العميل —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="md:col-span-4">
              <Button type="submit" disabled={busy}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title={`المستخدمون${data ? ` (${data.total})` : ''}`}
        actions={
          <input
            className="w-64 rounded-lg border border-brand-line px-3 py-2 text-sm"
            placeholder="بحث بالاسم أو البريد أو الهاتف"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-right text-brand-muted">
                <th className="py-2">الاسم</th>
                <th>البريد</th>
                <th>الدور</th>
                <th>آخر دخول</th>
                <th>الحالة</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((u) => (
                <tr key={u.id} className="border-b border-stone-100">
                  <td className="py-2.5 font-bold">{u.name}</td>
                  <td dir="ltr" className="text-right">
                    {u.email}
                  </td>
                  <td>{ROLE_LABELS_AR[u.role]}</td>
                  <td className="text-brand-muted">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleString('ar-JO', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </td>
                  <td>
                    {u.isActive ? (
                      <Badge tone="green">مفعّل</Badge>
                    ) : (
                      <Badge tone="red">معطّل</Badge>
                    )}
                  </td>
                  {canManage && (
                    <td className="text-xs">
                      <div className="flex justify-end gap-3">
                        <button
                          className="text-brand-brown underline"
                          onClick={() => {
                            setEditingId(u.id);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          تعديل
                        </button>
                        {u.id !== me?.id && (
                          <button
                            className="text-brand-brown underline"
                            onClick={() => void toggleActive(u)}
                          >
                            {u.isActive ? 'تعطيل' : 'تفعيل'}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-brand-muted">
                    لا يوجد مستخدمون
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
