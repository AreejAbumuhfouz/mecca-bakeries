'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { bpsToPercentString, parsePercentToBps, type ProductionSettings } from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input } from '@/components/ui';
import type { ProductionLine, Vehicle } from '@/lib/production';
import { t } from '@/lib/i18n';

type Section = { id: string; name: string; productionLineId: string | null; isActive: boolean };
const field = 'rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm';

export default function ProductionSetupPage() {
  const { can } = useAuth();
  const canManage = can('production.manage');
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [settings, setSettings] = useState<ProductionSettings | null>(null);
  const [tolerance, setTolerance] = useState('');
  const [newLine, setNewLine] = useState('');
  const [newVehicle, setNewVehicle] = useState({ name: '', plate: '', driverName: '' });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    const [l, s, v] = await Promise.all([
      api<ProductionLine[]>('/api/production/lines'),
      api<Section[]>('/api/items/sections'),
      api<Vehicle[]>('/api/production/vehicles'),
    ]);
    setLines(l);
    setSections(s);
    setVehicles(v);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
    void api<ProductionSettings>('/api/settings/production')
      .then((x) => {
        setSettings(x);
        setTolerance(bpsToPercentString(x.toleranceBps));
      })
      .catch(() => undefined);
  }, [load]);

  async function run(fn: () => Promise<unknown>, fallback: string, done = '') {
    setError('');
    setSaved('');
    try {
      await fn();
      await load();
      setSaved(done);
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    }
  }

  async function addLine(e: FormEvent) {
    e.preventDefault();
    if (
      await run(
        () =>
          api('/api/production/lines', {
            method: 'POST',
            body: JSON.stringify({ name: newLine, sortOrder: lines.length + 1 }),
          }),
        t('تعذّر الحفظ'),
      )
    )
      setNewLine('');
  }

  async function addVehicle(e: FormEvent) {
    e.preventDefault();
    if (
      await run(
        () =>
          api('/api/production/vehicles', {
            method: 'POST',
            body: JSON.stringify({
              name: newVehicle.name,
              plate: newVehicle.plate || null,
              driverName: newVehicle.driverName || null,
            }),
          }),
        t('تعذّر الحفظ'),
      )
    )
      setNewVehicle({ name: '', plate: '', driverName: '' });
  }

  async function saveTolerance(e: FormEvent) {
    e.preventDefault();
    const bps = parsePercentToBps(tolerance);
    if (bps === null) return setError(t('نسبة غير صالحة'));
    await run(
      async () =>
        setSettings(
          await api<ProductionSettings>('/api/settings/production', {
            method: 'PUT',
            body: JSON.stringify({ toleranceBps: bps }),
          }),
        ),
      t('تعذّر الحفظ'),
      t('تم الحفظ ✓'),
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/production" className="text-sm text-brand-muted underline">
          {t('← الإنتاج')}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-brand-brown">{t('خطوط الإنتاج والسيارات')}</h1>
      </div>
      <ErrorBox message={error} />
      {saved && (
        <div className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{saved}</div>
      )}

      <Card title={t('خطوط الإنتاج')}>
        {canManage && (
          <form onSubmit={addLine} className="mb-4 flex gap-2">
            <input
              className={`${field} w-64`}
              placeholder={t('اسم الخط (مثلاً: خط الخبز)')}
              required
              minLength={2}
              value={newLine}
              onChange={(e) => setNewLine(e.target.value)}
            />
            <Button type="submit" variant="gold">
              {t('إضافة')}
            </Button>
          </form>
        )}
        <div className="flex flex-wrap gap-2">
          {lines.map((l) => (
            <button
              key={l.id}
              disabled={!canManage}
              onClick={() =>
                void run(
                  () =>
                    api(`/api/production/lines/${l.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ isActive: !l.isActive }),
                    }),
                  t('تعذّر التحديث'),
                )
              }
              className={`rounded-full border px-3 py-1 text-sm ${l.isActive ? 'border-brand-gold bg-brand-gold-light text-brand-brown' : 'border-stone-200 text-stone-400 line-through'}`}
            >
              {t('{0} ({1} أقسام)', l.name, l.sectionCount)}
            </button>
          ))}
          {lines.length === 0 && (
            <span className="text-sm text-brand-muted">{t('لا توجد خطوط بعد')}</span>
          )}
        </div>
      </Card>

      <Card title={t('ربط أقسام الأصناف بخطوط الإنتاج')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {sections.map((s) => (
                <tr key={s.id} className="border-b border-stone-100">
                  <td className="py-2 font-bold">{s.name}</td>
                  <td>
                    <select
                      className={field}
                      disabled={!can('items.manage')}
                      value={s.productionLineId ?? ''}
                      onChange={(e) =>
                        void run(
                          () =>
                            api(`/api/items/sections/${s.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ productionLineId: e.target.value || null }),
                            }),
                          t('تعذّر الحفظ'),
                        )
                      }
                    >
                      <option value="">{t('— بدون خط —')}</option>
                      {lines.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t('السيارات')}>
        {canManage && (
          <form onSubmit={addVehicle} className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <Input
              label={t('الاسم')}
              required
              value={newVehicle.name}
              onChange={(e) => setNewVehicle({ ...newVehicle, name: e.target.value })}
            />
            <Input
              label={t('رقم اللوحة')}
              dir="ltr"
              value={newVehicle.plate}
              onChange={(e) => setNewVehicle({ ...newVehicle, plate: e.target.value })}
            />
            <Input
              label={t('السائق')}
              value={newVehicle.driverName}
              onChange={(e) => setNewVehicle({ ...newVehicle, driverName: e.target.value })}
            />
            <div className="self-end">
              <Button type="submit" variant="gold">
                {t('إضافة سيارة')}
              </Button>
            </div>
          </form>
        )}
        <ul className="divide-y divide-stone-100 text-sm">
          {vehicles.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
              <b>{v.name}</b>
              {v.plate && <span className="font-mono text-brand-muted">{v.plate}</span>}
              {v.driverName && <span>{v.driverName}</span>}
              {v.isActive ? (
                <Badge tone="green">{t('فعّالة')}</Badge>
              ) : (
                <Badge tone="red">{t('موقوفة')}</Badge>
              )}
              {canManage && (
                <button
                  className="ms-auto text-xs text-brand-brown underline"
                  onClick={() =>
                    void run(
                      () =>
                        api(`/api/production/vehicles/${v.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isActive: !v.isActive }),
                        }),
                      t('تعذّر التحديث'),
                    )
                  }
                >
                  {v.isActive ? t('إيقاف') : t('تفعيل')}
                </button>
              )}
            </li>
          ))}
          {vehicles.length === 0 && (
            <li className="py-2 text-brand-muted">{t('لا توجد سيارات بعد')}</li>
          )}
        </ul>
      </Card>

      {settings && can('settings.manage') && (
        <Card title={t('سماحية الفروقات')}>
          <form onSubmit={saveTolerance} className="flex flex-wrap items-end gap-2">
            <div className="w-48">
              <Input
                label={t('النسبة المسموحة (%)')}
                dir="ltr"
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
              />
            </div>
            <Button type="submit">{t('حفظ')}</Button>
          </form>
          <p className="mt-2 text-xs text-brand-muted">
            {t(
              'أي فرق أكبر من هذه النسبة بين المخطط والمنتج، أو بين المطلوب والمحمّل، يحتاج اعتماداً بسبب مكتوب.',
            )}
          </p>
        </Card>
      )}
    </div>
  );
}
