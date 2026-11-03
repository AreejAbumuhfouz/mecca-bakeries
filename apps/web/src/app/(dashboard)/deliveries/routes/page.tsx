'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input, Select } from '@/components/ui';
import type { RouteRow } from '@/lib/billing';
import type { Vehicle } from '@/lib/production';

type Branch = {
  branchId: string;
  branchName: string;
  branchCode: string;
  customerName: string;
  address: string | null;
};
type Driver = { id: string; name: string; email: string };

export default function RoutesPage() {
  const { can } = useAuth();
  const canManage = can('deliveries.manage');
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [free, setFree] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [form, setForm] = useState({ name: '', driverId: '', vehicleId: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [r, f, d] = await Promise.all([
      api<RouteRow[]>('/api/distribution/routes'),
      api<Branch[]>('/api/distribution/unassigned'),
      api<Driver[]>('/api/distribution/drivers'),
    ]);
    setRoutes(r);
    setFree(f);
    setDrivers(d);
    setVehicles(await api<Vehicle[]>('/api/production/vehicles').catch(() => []));
  }, []);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, 'تعذّر التحميل')));
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err, 'تعذّر الحفظ'));
    }
  }

  function addRoute(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api('/api/distribution/routes', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          driverId: form.driverId || null,
          vehicleId: form.vehicleId || null,
          sortOrder: routes.length + 1,
        }),
      });
      setForm({ name: '', driverId: '', vehicleId: '' });
    });
  }

  const setStops = (r: RouteRow, ids: string[]) =>
    run(() =>
      api(`/api/distribution/routes/${r.id}/stops`, {
        method: 'PUT',
        body: JSON.stringify({ branchIds: ids }),
      }),
    );
  const patch = (r: RouteRow, body: object) =>
    run(() =>
      api(`/api/distribution/routes/${r.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/deliveries" className="text-sm text-brand-muted underline">
          ← التوزيع
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-brand-brown">مسارات السائقين</h1>
        <p className="text-sm text-brand-muted">
          كل فرع في مسار واحد بترتيب التوزيع. السائق والسيارة يُنسخان لمسار كل يوم.
        </p>
      </div>
      <ErrorBox message={error} />

      {drivers.length === 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          لا يوجد سائقون. أضيفيهم من «المستخدمون» بدور «سائق».
        </div>
      )}

      {canManage && (
        <Card title="مسار جديد">
          <form onSubmit={addRoute} className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
            <Input
              label="اسم المسار"
              required
              minLength={2}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Select
              label="السائق"
              value={form.driverId}
              onChange={(e) => setForm({ ...form, driverId: e.target.value })}
            >
              <option value="">—</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              label="السيارة"
              value={form.vehicleId}
              onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
            >
              <option value="">—</option>
              {vehicles
                .filter((v) => v.isActive)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </Select>
            <Button type="submit">+ إضافة</Button>
          </form>
        </Card>
      )}

      {routes.map((r) => (
        <Card
          key={r.id}
          title={`${r.name} (${r.stops.length} فرع)`}
          actions={!r.isActive && <Badge tone="red">موقوف</Badge>}
        >
          {canManage && (
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Select
                label="السائق"
                value={r.driverId ?? ''}
                onChange={(e) => void patch(r, { driverId: e.target.value || null })}
              >
                <option value="">—</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <Select
                label="السيارة"
                value={r.vehicleId ?? ''}
                onChange={(e) => void patch(r, { vehicleId: e.target.value || null })}
              >
                <option value="">—</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
              <Select
                label="إضافة فرع"
                value=""
                onChange={(e) =>
                  e.target.value &&
                  void setStops(r, [...r.stops.map((s) => s.branchId), e.target.value])
                }
              >
                <option value="">— اختاري فرعاً بدون مسار —</option>
                {free.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.customerName} — {b.branchName}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <ol className="divide-y divide-stone-100 text-sm">
            {r.stops.map((s, i) => {
              const ids = r.stops.map((x) => x.branchId);
              const move = (to: number) => {
                const next = [...ids];
                next.splice(i, 1);
                next.splice(to, 0, s.branchId);
                void setStops(r, next);
              };
              return (
                <li key={s.branchId} className="flex items-center gap-3 py-2">
                  <span className="w-6 text-brand-muted">{i + 1}</span>
                  <span className="flex-1">
                    <b>{s.customerName}</b> — {s.branchName}{' '}
                    <span className="text-xs text-brand-muted">{s.address}</span>
                  </span>
                  {canManage && (
                    <span className="flex gap-1">
                      <button
                        disabled={i === 0}
                        aria-label="أعلى"
                        className="rounded p-1 hover:bg-brand-cream disabled:opacity-30"
                        onClick={() => move(i - 1)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        disabled={i === ids.length - 1}
                        aria-label="أسفل"
                        className="rounded p-1 hover:bg-brand-cream disabled:opacity-30"
                        onClick={() => move(i + 1)}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        aria-label="إزالة"
                        className="rounded p-1 text-red-700 hover:bg-red-50"
                        onClick={() =>
                          void setStops(
                            r,
                            ids.filter((x) => x !== s.branchId),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
            {r.stops.length === 0 && <li className="py-2 text-brand-muted">لا فروع بعد</li>}
          </ol>
          {canManage && (
            <button
              className="mt-3 text-xs text-brand-brown underline"
              onClick={() => void patch(r, { isActive: !r.isActive })}
            >
              {r.isActive ? 'إيقاف المسار' : 'تفعيل المسار'}
            </button>
          )}
        </Card>
      ))}

      {free.length > 0 && (
        <Card title={`فروع بدون مسار (${free.length})`}>
          <p className="text-sm text-brand-muted">
            {free.map((b) => `${b.customerName} — ${b.branchName}`).join('، ')}
          </p>
        </Card>
      )}
    </div>
  );
}
