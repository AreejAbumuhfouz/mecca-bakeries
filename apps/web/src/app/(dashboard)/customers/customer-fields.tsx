'use client';

import { Input, Select, Textarea } from '@/components/ui';
import type { Category, CustomerForm, TradeNameOption } from '@/lib/customers';
import { t } from '@/lib/i18n';

export function CustomerFields({
  form,
  setForm,
  categories,
  tradeNames,
  codeHint,
}: {
  form: CustomerForm;
  setForm: (f: CustomerForm) => void;
  categories: Category[];
  tradeNames: TradeNameOption[];
  codeHint?: string;
}) {
  const set = (key: keyof CustomerForm) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Input
        label={t('اسم العميل')}
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
        placeholder={codeHint}
        value={form.code}
        onChange={set('code')}
      />
      <Select label={t('الفئة')} value={form.categoryId} onChange={set('categoryId')}>
        <option value="">{t('بدون فئة')}</option>
        {categories
          .filter((c) => c.isActive || c.id === form.categoryId)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </Select>
      <Select
        label={t('الاسم التجاري (للفواتير)')}
        value={form.tradeNameId}
        onChange={set('tradeNameId')}
      >
        <option value="">{t('— اختر —')}</option>
        {tradeNames
          .filter((tr) => tr.isActive || tr.id === form.tradeNameId)
          .map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.name}
            </option>
          ))}
      </Select>
      <Input label={t('الشخص المسؤول')} value={form.contactName} onChange={set('contactName')} />
      <Input label={t('الهاتف')} dir="ltr" value={form.phone} onChange={set('phone')} />
      <Input
        label={t('البريد الإلكتروني')}
        type="email"
        dir="ltr"
        value={form.email}
        onChange={set('email')}
      />
      <Input label={t('المدينة')} value={form.city} onChange={set('city')} />
      <Input label={t('العنوان')} value={form.address} onChange={set('address')} />
      <div className="md:col-span-3">
        <Textarea label={t('ملاحظات')} value={form.notes} onChange={set('notes')} />
      </div>
    </div>
  );
}
