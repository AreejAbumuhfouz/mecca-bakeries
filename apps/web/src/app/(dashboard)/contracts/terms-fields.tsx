'use client';

import { PAYMENT_TYPE_LABELS_AR, PAYMENT_TYPES, type PaymentType } from '@mecca/shared';
import { Input, Select, Textarea } from '@/components/ui';
import type { TermsForm } from '@/lib/contracts';

export function TermsFields({
  form,
  setForm,
}: {
  form: TermsForm;
  setForm: (f: TermsForm) => void;
}) {
  const set = (key: keyof TermsForm) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });
  const credit = form.paymentType === 'credit';

  return (
    <div className="space-y-5">
      <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <legend className="mb-2 font-bold text-brand-brown">مدة العقد</legend>
        <Input
          label="تاريخ البداية"
          type="date"
          required
          value={form.startDate}
          onChange={set('startDate')}
        />
        <Input
          label="تاريخ النهاية"
          type="date"
          required
          value={form.endDate}
          onChange={set('endDate')}
        />
        <Input
          label="تنبيه التجديد قبل (يوم)"
          type="number"
          min={0}
          max={365}
          value={form.renewalAlertDays}
          onChange={set('renewalAlertDays')}
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <legend className="mb-2 font-bold text-brand-brown">الدفع والائتمان</legend>
        <Select
          label="طريقة الدفع"
          value={form.paymentType}
          onChange={(e) => setForm({ ...form, paymentType: e.target.value as PaymentType })}
        >
          {PAYMENT_TYPES.map((p) => (
            <option key={p} value={p}>
              {PAYMENT_TYPE_LABELS_AR[p]}
            </option>
          ))}
        </Select>
        {credit && (
          <>
            <Input
              label="سقف الائتمان (دينار)"
              dir="ltr"
              inputMode="decimal"
              required
              value={form.creditLimit}
              onChange={set('creditLimit')}
            />
            <Input
              label="مدة السداد (يوم)"
              type="number"
              min={0}
              max={365}
              value={form.paymentTermsDays}
              onChange={set('paymentTermsDays')}
            />
          </>
        )}
        <Input
          label="سماحية التأخير قبل الإيقاف (يوم)"
          type="number"
          min={0}
          max={365}
          value={form.overdueGraceDays}
          onChange={set('overdueGraceDays')}
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <legend className="mb-2 font-bold text-brand-brown">الخصومات والمرتجعات</legend>
        <Input
          label="خصم عام على الأصناف بدون سعر خاص (%)"
          dir="ltr"
          inputMode="decimal"
          value={form.discount}
          onChange={set('discount')}
        />
        <label className="flex items-center gap-2 self-end pb-3 text-sm font-bold text-brand-brown">
          <input
            type="checkbox"
            checked={form.allowReturns}
            onChange={(e) => setForm({ ...form, allowReturns: e.target.checked })}
            className="h-4 w-4 accent-brand-gold"
          />
          يسمح بالمرتجعات
        </label>
        {form.allowReturns && (
          <>
            <Input
              label="أقصى نسبة مرتجعات من الكمية (%)"
              dir="ltr"
              inputMode="decimal"
              value={form.maxReturn}
              onChange={set('maxReturn')}
            />
            <Input
              label="شروط المرتجعات"
              value={form.returnsNotes}
              onChange={set('returnsNotes')}
            />
          </>
        )}
      </fieldset>

      <Textarea label="ملاحظات العقد" value={form.notes} onChange={set('notes')} />
    </div>
  );
}
