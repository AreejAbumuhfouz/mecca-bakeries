'use client';

import { Input, Select, Textarea } from '@/components/ui';
import type { Category, CustomerForm, TradeNameOption } from '@/lib/customers';

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
      <Input label="اسم العميل" required minLength={2} value={form.name} onChange={set('name')} />
      <Input label="الاسم بالإنجليزية" dir="ltr" value={form.nameEn} onChange={set('nameEn')} />
      <Input
        label="الكود"
        dir="ltr"
        placeholder={codeHint}
        value={form.code}
        onChange={set('code')}
      />
      <Select label="الفئة" value={form.categoryId} onChange={set('categoryId')}>
        <option value="">بدون فئة</option>
        {categories
          .filter((c) => c.isActive || c.id === form.categoryId)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </Select>
      <Select
        label="الاسم التجاري (للفواتير)"
        value={form.tradeNameId}
        onChange={set('tradeNameId')}
      >
        <option value="">— اختر —</option>
        {tradeNames
          .filter((t) => t.isActive || t.id === form.tradeNameId)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
      </Select>
      <Input label="الشخص المسؤول" value={form.contactName} onChange={set('contactName')} />
      <Input label="الهاتف" dir="ltr" value={form.phone} onChange={set('phone')} />
      <Input
        label="البريد الإلكتروني"
        type="email"
        dir="ltr"
        value={form.email}
        onChange={set('email')}
      />
      <Input label="المدينة" value={form.city} onChange={set('city')} />
      <Input label="العنوان" value={form.address} onChange={set('address')} />
      <div className="md:col-span-3">
        <Textarea label="ملاحظات" value={form.notes} onChange={set('notes')} />
      </div>
    </div>
  );
}
