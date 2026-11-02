'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { ammanDate } from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Select } from '@/components/ui';
import { emptyTerms, termsToBody } from '@/lib/contracts';
import type { CustomerRow } from '@/lib/customers';
import { TermsFields } from '../terms-fields';
import { draftToPrices, PricesEditor, type PriceDraft } from '../prices-editor';

function NewContract() {
  const router = useRouter();
  const params = useSearchParams();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [terms, setTerms] = useState(() => emptyTerms(ammanDate()));
  const [draft, setDraft] = useState<PriceDraft>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ items: CustomerRow[] }>('/api/customers?pageSize=100&isActive=true')
      .then((r) => setCustomers(r.items))
      .catch(() => setError('تعذّر تحميل العملاء'));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    const body = termsToBody(terms);
    if (typeof body === 'string') return setError(body);
    const prices = draftToPrices(draft);
    if (typeof prices === 'string') return setError(prices);
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/api/contracts', {
        method: 'POST',
        body: JSON.stringify({ ...body, customerId, prices }),
      });
      router.push(`/contracts/${created.id}`);
    } catch (err) {
      setError(errorMessage(err, 'تعذّر حفظ العقد'));
      setBusy(false);
    }
  }

  const discountBps = Math.round(Number(terms.discount || 0) * 100) || 0;

  return (
    <form onSubmit={save} className="space-y-6">
      <div>
        <Link href="/contracts" className="text-sm text-brand-muted underline">
          ← العقود
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-brand-brown">عقد جديد</h1>
      </div>

      <ErrorBox message={error} />

      <Card title="العميل">
        <div className="max-w-md">
          <Select
            label="العميل"
            required
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">— اختر العميل —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card title="شروط العقد">
        <TermsFields form={terms} setForm={setTerms} />
      </Card>

      <Card title="الأسعار الخاصة">
        <p className="mb-3 text-sm text-brand-muted">
          اكتبي السعر الخاص فقط للأصناف المتفق عليها. باقي الأصناف تأخذ السعر الأساسي مع الخصم
          العام.
        </p>
        <PricesEditor draft={draft} setDraft={setDraft} discountBps={discountBps} />
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !customerId}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ العقد'}
        </Button>
        <Link href="/contracts">
          <Button type="button" variant="outline">
            إلغاء
          </Button>
        </Link>
      </div>
    </form>
  );
}

export default function NewContractPage() {
  return (
    <Suspense>
      <NewContract />
    </Suspense>
  );
}
