'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  filsToJodString,
  formatJod,
  ITEM_UNIT_LABELS_AR,
  ITEM_UNITS,
  parseJod,
  type ItemUnit,
} from '@mecca/shared';
import { api, errorMessage, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input, Select, Textarea } from '@/components/ui';
import { ImageUpload } from '@/components/image-upload';
import { t } from '@/lib/i18n';

type Section = {
  id: string;
  name: string;
  nameEn: string | null;
  sortOrder: number;
  isActive: boolean;
  itemCount: number;
};

type Item = {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  sectionId: string;
  sectionName: string;
  unit: ItemUnit;
  basePrice: number;
  imageFileId: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

type Page = { items: Item[]; total: number };

type Form = {
  code: string;
  name: string;
  nameEn: string;
  sectionId: string;
  unit: ItemUnit;
  price: string;
  imageFileId: string | null;
  description: string;
  sortOrder: string;
};

const emptyForm = (sectionId = ''): Form => ({
  code: '',
  name: '',
  nameEn: '',
  sectionId,
  unit: 'piece',
  price: '',
  imageFileId: null,
  description: '',
  sortOrder: '0',
});

const toForm = (i: Item): Form => ({
  code: i.code,
  name: i.name,
  nameEn: i.nameEn ?? '',
  sectionId: i.sectionId,
  unit: i.unit,
  price: filsToJodString(i.basePrice),
  imageFileId: i.imageFileId,
  description: i.description ?? '',
  sortOrder: String(i.sortOrder),
});

const filterClass = 'rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm';

export default function ItemsPage() {
  const { can } = useAuth();
  const canManage = can('items.manage');
  const [sections, setSections] = useState<Section[]>([]);
  const [data, setData] = useState<Page | null>(null);
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [status, setStatus] = useState<'' | 'true' | 'false'>('true');
  const [showSections, setShowSections] = useState(false);
  const [newSection, setNewSection] = useState('');
  /** null = closed, 'new' = add, otherwise the item id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSections = useCallback(
    async () => setSections(await api<Section[]>('/api/items/sections')),
    [],
  );
  const load = useCallback(async () => {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (search) qs.set('search', search);
    if (sectionFilter) qs.set('sectionId', sectionFilter);
    if (status) qs.set('isActive', status);
    setData(await api<Page>(`/api/items?${qs}`));
  }, [search, sectionFilter, status]);

  useEffect(() => {
    void loadSections().catch(() => setError(t('تعذّر تحميل الأقسام')));
  }, [loadSections]);
  useEffect(() => {
    const id = setTimeout(() => void load().catch(() => setError(t('تعذّر تحميل الأصناف'))), 250);
    return () => clearTimeout(id);
  }, [load]);

  const set = (key: keyof Form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setError('');
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(e: FormEvent) {
    e.preventDefault();
    const basePrice = parseJod(form.price);
    if (basePrice === null) {
      setError(t('السعر غير صالح — اكتبيه بالدينار مثل 0.350'));
      return;
    }
    const body = JSON.stringify({
      ...(form.code.trim() ? { code: form.code.trim() } : {}),
      name: form.name,
      nameEn: form.nameEn || null,
      sectionId: form.sectionId,
      unit: form.unit,
      basePrice,
      imageFileId: form.imageFileId,
      description: form.description || null,
      sortOrder: Number(form.sortOrder) || 0,
    });
    const ok = await run(
      () =>
        editing === 'new'
          ? api('/api/items', { method: 'POST', body })
          : api(`/api/items/${editing}`, { method: 'PATCH', body }),
      t('تعذّر حفظ الصنف'),
    );
    if (ok) {
      setEditing(null);
      await Promise.all([load(), loadSections()]);
    }
  }

  const toggleItem = async (i: Item) => {
    if (
      await run(
        () =>
          api(`/api/items/${i.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive: !i.isActive }),
          }),
        t('تعذّر التحديث'),
      )
    )
      await load();
  };

  async function addSection(e: FormEvent) {
    e.preventDefault();
    const ok = await run(
      () =>
        api('/api/items/sections', {
          method: 'POST',
          body: JSON.stringify({ name: newSection, sortOrder: sections.length + 1 }),
        }),
      t('تعذّر حفظ القسم'),
    );
    if (ok) {
      setNewSection('');
      await loadSections();
    }
  }

  const toggleSection = async (s: Section) => {
    if (
      await run(
        () =>
          api(`/api/items/sections/${s.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive: !s.isActive }),
          }),
        t('تعذّر تحديث القسم'),
      )
    )
      await loadSections();
  };

  const activeSections = sections.filter((s) => s.isActive || s.id === form.sectionId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-brown">{t('الأصناف والأسعار')}</h1>
          <p className="text-sm text-brand-muted">
            {t('السعر الأساسي هنا هو سعر القائمة. الأسعار الخاصة لكل عميل تُحدد في عقده.')}
          </p>
        </div>
        {canManage && editing === null && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowSections((v) => !v)}>
              {t('الأقسام')}
            </Button>
            <Button
              onClick={() => {
                setForm(emptyForm(sections.find((s) => s.isActive)?.id));
                setEditing('new');
              }}
            >
              {t('+ صنف جديد')}
            </Button>
          </div>
        )}
      </div>

      <ErrorBox message={error} />

      {showSections && canManage && (
        <Card title={t('أقسام الأصناف')}>
          <form onSubmit={addSection} className="mb-4 flex gap-2">
            <input
              className={`${filterClass} w-64`}
              placeholder={t('اسم القسم (مثلاً: معجنات)')}
              required
              minLength={2}
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
            />
            <Button type="submit" variant="gold" disabled={busy}>
              {t('إضافة')}
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => void toggleSection(s)}
                title={s.isActive ? t('اضغط للإيقاف') : t('اضغط للتفعيل')}
                className={`rounded-full border px-3 py-1 text-sm ${
                  s.isActive
                    ? 'border-brand-gold bg-brand-gold-light text-brand-brown'
                    : 'border-stone-200 text-stone-400 line-through'
                }`}
              >
                {s.name} ({s.itemCount})
              </button>
            ))}
          </div>
        </Card>
      )}

      {editing !== null && (
        <Card title={editing === 'new' ? t('صنف جديد') : t('تعديل الصنف')}>
          {sections.length === 0 ? (
            <p className="text-sm text-brand-muted">{t('أضيفي قسماً أولاً من زر «الأقسام».')}</p>
          ) : (
            <form onSubmit={saveItem} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <Input
                  label={t('اسم الصنف')}
                  required
                  minLength={2}
                  value={form.name}
                  onChange={set('name')}
                />
                <Input
                  label={t('الاسم بالإنجليزية')}
                  dir="ltr"
                  value={form.nameEn}
                  onChange={set('nameEn')}
                />
                <Input
                  label={t('الكود')}
                  dir="ltr"
                  placeholder={editing === 'new' ? t('يُولَّد تلقائياً') : undefined}
                  value={form.code}
                  onChange={set('code')}
                />
                <Select
                  label={t('القسم')}
                  required
                  value={form.sectionId}
                  onChange={set('sectionId')}
                >
                  <option value="">{t('— اختر —')}</option>
                  {activeSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Select label={t('الوحدة')} value={form.unit} onChange={set('unit')}>
                  {ITEM_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {ITEM_UNIT_LABELS_AR[u]}
                    </option>
                  ))}
                </Select>
                <Input
                  label={t('السعر الأساسي (دينار)')}
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="0.350"
                  required
                  value={form.price}
                  onChange={set('price')}
                />
                <Input
                  label={t('ترتيب العرض')}
                  type="number"
                  min={0}
                  dir="ltr"
                  value={form.sortOrder}
                  onChange={set('sortOrder')}
                />
                <ImageUpload
                  label={t('صورة الصنف (للتطبيق)')}
                  value={form.imageFileId}
                  onChange={(imageFileId) => setForm({ ...form, imageFileId })}
                />
                <div className="md:col-span-4">
                  <Textarea
                    label={t('الوصف')}
                    value={form.description}
                    onChange={set('description')}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? t('جارٍ الحفظ…') : t('حفظ')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {t('إلغاء')}
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      <Card
        title={t('الأصناف{0}', data ? ` (${data.total})` : '')}
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              className={`${filterClass} w-52`}
              placeholder={t('بحث بالكود أو الاسم')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className={filterClass}
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
            >
              <option value="">{t('كل الأقسام')}</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              className={filterClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as '' | 'true' | 'false')}
            >
              <option value="true">{t('الفعّالة')}</option>
              <option value="false">{t('الموقوفة')}</option>
              <option value="">{t('الكل')}</option>
            </select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-right text-brand-muted">
                <th className="py-2" />
                <th>{t('الكود')}</th>
                <th>{t('الصنف')}</th>
                <th>{t('القسم')}</th>
                <th>{t('الوحدة')}</th>
                <th>{t('السعر الأساسي')}</th>
                <th>{t('الحالة')}</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((i) => (
                <tr key={i.id} className="border-b border-stone-100">
                  <td className="py-2 pl-3">
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-brand-line bg-brand-cream">
                      {i.imageFileId ? (
                        <img
                          src={fileUrl(i.imageFileId)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-brand-muted">—</span>
                      )}
                    </div>
                  </td>
                  <td className="pl-4 font-mono">{i.code}</td>
                  <td className="font-bold">
                    {i.name}
                    {i.nameEn && (
                      <div
                        className="text-xs font-normal text-brand-muted"
                        dir="ltr"
                        style={{ textAlign: 'right' }}
                      >
                        {i.nameEn}
                      </div>
                    )}
                  </td>
                  <td>{i.sectionName}</td>
                  <td>{ITEM_UNIT_LABELS_AR[i.unit]}</td>
                  <td className="font-bold">{formatJod(i.basePrice)}</td>
                  <td>
                    {i.isActive ? (
                      <Badge tone="green">{t('فعّال')}</Badge>
                    ) : (
                      <Badge tone="red">{t('موقوف')}</Badge>
                    )}
                  </td>
                  {canManage && (
                    <td className="text-xs">
                      <div className="flex justify-end gap-3">
                        <button
                          className="text-brand-brown underline"
                          onClick={() => {
                            setForm(toForm(i));
                            setEditing(i.id);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          {t('تعديل')}
                        </button>
                        <button
                          className="text-brand-brown underline"
                          onClick={() => void toggleItem(i)}
                        >
                          {i.isActive ? t('إيقاف') : t('تفعيل')}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-brand-muted">
                    {t('لا توجد أصناف')}
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
