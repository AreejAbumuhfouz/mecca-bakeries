'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  PERMISSION_LABELS_AR,
  PERMISSIONS,
  ROLE_LABELS_AR,
  ROLE_PERMISSIONS,
  ROLE_VALUES,
  type Permission,
  type Role,
} from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Input, Select } from '@/components/ui';
import { t } from '@/lib/i18n';

type UserDetail = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  customerId: string | null;
  overrides: { permission: Permission; allowed: boolean }[];
};

/**
 * Edits name, phone, role and per-user permissions.
 * A permission that differs from the role default is saved as an override.
 */
export function UserEditor({
  userId,
  onClose,
  onSaved,
}: {
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [user, setUser] = useState<UserDetail | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('orders');
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState<{ id: string; code: string; name: string }[]>([]);
  const [overrides, setOverrides] = useState<Partial<Record<Permission, boolean>>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<UserDetail>(`/api/users/${userId}`)
      .then((u) => {
        setUser(u);
        setName(u.name);
        setPhone(u.phone ?? '');
        setRole(u.role);
        setCustomerId(u.customerId ?? '');
        setOverrides(Object.fromEntries(u.overrides.map((o) => [o.permission, o.allowed])));
      })
      .catch((err) => setError(errorMessage(err, t('تعذّر تحميل المستخدم'))));
  }, [userId]);

  useEffect(() => {
    if (role !== 'restaurant' || customers.length) return;
    void api<{ items: { id: string; code: string; name: string }[] }>('/api/customers?pageSize=100')
      .then((r) => setCustomers(r.items))
      .catch(() => undefined);
  }, [role, customers.length]);

  const defaults = new Set<Permission>(ROLE_PERMISSIONS[role]);
  const effective = (p: Permission) => overrides[p] ?? defaults.has(p);

  function toggle(p: Permission) {
    const next = { ...overrides };
    const want = !effective(p);
    // Back to the role default removes the override; anything else is stored.
    if (want === defaults.has(p)) delete next[p];
    else next[p] = want;
    setOverrides(next);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api(`/api/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          phone: phone.trim() || null,
          role,
          customerId: role === 'restaurant' ? customerId || null : null,
          overrides:
            role === 'super_admin'
              ? []
              : Object.entries(overrides)
                  .filter(([p, allowed]) => allowed !== defaults.has(p as Permission))
                  .map(([permission, allowed]) => ({ permission, allowed })),
        }),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t('تعذّر حفظ المستخدم')));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return error ? <ErrorBox message={error} /> : null;

  const customCount = Object.keys(overrides).filter(
    (p) => overrides[p as Permission] !== defaults.has(p as Permission),
  ).length;

  return (
    <Card title={t('تعديل: {0}', user.email)}>
      <form onSubmit={save} className="space-y-5">
        <ErrorBox message={error} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input
            label={t('الاسم')}
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label={t('الهاتف')}
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Select label={t('الدور')} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLE_VALUES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS_AR[r]}
              </option>
            ))}
          </Select>
        </div>

        {role === 'restaurant' && (
          <label className="block max-w-md">
            <span className="mb-1 block text-sm font-bold text-brand-brown">{t('العميل')}</span>
            <select
              required
              className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2.5 text-sm"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">{t('— اختر العميل —')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {role === 'super_admin' ? (
          <p className="text-sm text-brand-muted">{t('المدير العام يملك كل الصلاحيات.')}</p>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold text-brand-brown">{t('الصلاحيات')}</h3>
              <span className="text-xs text-brand-muted">
                {t('المعلَّم بلون ذهبي مختلف عن صلاحيات الدور ({0})', customCount)}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PERMISSIONS.map((p) => {
                const custom = overrides[p] !== undefined && overrides[p] !== defaults.has(p);
                return (
                  <label
                    key={p}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      custom ? 'border-brand-gold bg-brand-gold-light/40' : 'border-brand-line'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-gold"
                      checked={effective(p)}
                      onChange={() => toggle(p)}
                    />
                    {PERMISSION_LABELS_AR[p]}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t('جارٍ الحفظ…') : t('حفظ')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('إلغاء')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
