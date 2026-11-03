'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Input, Select, Textarea } from '@/components/ui';
import type { Supplier } from '@/lib/purchasing';
import { emptyLine, PoLinesEditor, toPoLines, type LineDraft } from '../po-lines';

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [neededDate, setNeededDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Supplier[]>('/api/purchasing/suppliers?isActive=true')
      .then(setSuppliers)
      .catch(() => setError('تعذّر تحميل الموردين'));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = toPoLines(lines);
    if (typeof parsed === 'string') return setError(parsed);
    setError('');
    setBusy(true);
    try {
      const po = await api<{ id: string }>('/api/purchasing/orders', {
        method: 'POST',
        body: JSON.stringify({
          supplierId,
          neededDate: neededDate || null,
          notes: notes || null,
          lines: parsed,
        }),
      });
      router.push(`/purchasing/${po.id}`);
    } catch (err) {
      setError(errorMessage(err, 'تعذّر الحفظ'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div>
        <Link href="/purchasing" className="text-sm text-brand-muted underline">
          ← طلبات الشراء
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-brand-brown">طلب شراء جديد</h1>
      </div>
      <ErrorBox message={error} />
      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Select
            label="المورد"
            required
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">— اختر المورد —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label="مطلوب بتاريخ"
            type="date"
            value={neededDate}
            onChange={(e) => setNeededDate(e.target.value)}
          />
          <div className="md:col-span-3">
            <Textarea
              label="ملاحظات للمورد"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      </Card>
      <Card title="البنود">
        <PoLinesEditor lines={lines} setLines={setLines} />
      </Card>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !supplierId}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ كمسودة'}
        </Button>
        <Link href="/purchasing">
          <Button type="button" variant="outline">
            إلغاء
          </Button>
        </Link>
      </div>
    </form>
  );
}
