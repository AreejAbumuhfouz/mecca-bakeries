'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  PURCHASE_ORDER_STATUS_LABELS_AR,
  PURCHASE_ORDER_TRANSITIONS,
  type PurchaseOrderStatus,
} from '@mecca/shared';
import { api, errorMessage, openAuthed } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox } from '@/components/ui';
import { formatAmman } from '@/lib/orders';
import { PO_TONE, type PurchaseOrder } from '@/lib/purchasing';
import { PoLinesEditor, toPoLines, type LineDraft } from '../po-lines';

const NEXT_LABEL: Partial<Record<PurchaseOrderStatus, string>> = {
  confirmed: 'المورد أكّد الطلب',
  received: 'تم الاستلام',
  cancelled: 'إلغاء الطلب',
};
const MESSAGE_LABEL: Record<string, string> = {
  skipped: 'لم يُرسل فعلياً (واتساب غير مربوط)',
  sent: 'أُرسل',
  delivered: 'وصل',
  read: 'قُرئ',
  failed: 'فشل',
  queued: 'في الانتظار',
};

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const canManage = can('purchasing.manage');
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [editing, setEditing] = useState<LineDraft[] | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async () => setPo(await api<PurchaseOrder>(`/api/purchasing/orders/${id}`)),
    [id],
  );
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, 'تعذّر التحميل')));
  }, [load]);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setError('');
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    await run(async () => {
      const r = await api<PurchaseOrder>(`/api/purchasing/orders/${id}/send`, { method: 'POST' });
      setNotice(
        r.delivered
          ? { ok: true, text: 'تم إرسال طلب الشراء للمورد على واتساب ✓' }
          : {
              ok: false,
              text: 'تم تسجيل الإرسال، لكن واتساب غير مربوط بعد فلم يصل الطلب للمورد فعلياً.',
            },
      );
    }, 'تعذّر الإرسال');
  }

  if (!po)
    return (
      <div className="space-y-4">
        <ErrorBox message={error} />
      </div>
    );

  const next = PURCHASE_ORDER_TRANSITIONS[po.status].filter((s) => s !== 'sent');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/purchasing" className="text-sm text-brand-muted underline">
            ← طلبات الشراء
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-brand-brown">
            طلب شراء <span className="font-mono">{po.number}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <b>{po.supplier.name}</b>
            <span dir="ltr" className="font-mono text-brand-muted">
              {po.supplier.whatsappPhone ?? po.supplier.phone ?? 'بدون رقم'}
            </span>
            <Badge tone={PO_TONE[po.status]}>{PURCHASE_ORDER_STATUS_LABELS_AR[po.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-brand-muted">
            مطلوب بتاريخ {po.neededDate ?? '—'} — أنشأه {po.createdByName ?? '—'}{' '}
            {formatAmman(po.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void openAuthed(`/api/purchasing/orders/${id}/pdf`).catch((err) =>
                setError(errorMessage(err, 'تعذّر فتح PDF')),
              )
            }
          >
            عرض PDF
          </Button>
          {canManage && ['draft', 'sent', 'confirmed'].includes(po.status) && (
            <Button variant="gold" disabled={busy} onClick={() => void send()}>
              {po.status === 'draft' ? 'إرسال للمورد على واتساب' : 'إعادة الإرسال'}
            </Button>
          )}
          {canManage && po.status === 'draft' && !editing && (
            <Button
              variant="outline"
              onClick={() =>
                setEditing(
                  po.lines.map((l) => ({
                    description: l.description,
                    quantity: String(Number(l.quantity)),
                    unit: l.unit,
                    note: l.note ?? '',
                  })),
                )
              }
            >
              تعديل البنود
            </Button>
          )}
          {canManage &&
            next.map((s) => (
              <Button
                key={s}
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api(`/api/purchasing/orders/${id}/status`, {
                        method: 'POST',
                        body: JSON.stringify({ status: s }),
                      }),
                    'تعذّر تغيير الحالة',
                  )
                }
              >
                {NEXT_LABEL[s]}
              </Button>
            ))}
        </div>
      </div>

      <ErrorBox message={error} />
      {notice && (
        <div
          className={`rounded-lg px-4 py-2 text-sm ${notice.ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}
        >
          {notice.text}
        </div>
      )}

      <Card title={`البنود (${po.lines.length})`}>
        {editing ? (
          <>
            <PoLinesEditor lines={editing} setLines={setEditing} />
            <div className="mt-4 flex gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  const parsed = toPoLines(editing);
                  if (typeof parsed === 'string') return setError(parsed);
                  void run(
                    () =>
                      api(`/api/purchasing/orders/${id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ lines: parsed }),
                      }),
                    'تعذّر الحفظ',
                  ).then((ok) => ok && setEditing(null));
                }}
              >
                حفظ
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)}>
                إلغاء
              </Button>
            </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line text-right text-brand-muted">
                  <th className="py-2">#</th>
                  <th>المادة</th>
                  <th>الكمية</th>
                  <th>الوحدة</th>
                  <th>ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l, i) => (
                  <tr key={i} className="border-b border-stone-100">
                    <td className="py-2 text-brand-muted">{i + 1}</td>
                    <td className="font-bold">{l.description}</td>
                    <td dir="ltr" className="text-right font-bold">
                      {Number(l.quantity)}
                    </td>
                    <td>{l.unit}</td>
                    <td className="text-brand-muted">{l.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {po.notes && <p className="mt-3 text-sm">ملاحظات: {po.notes}</p>}
      </Card>

      <Card title="الإرسال على واتساب">
        <ul className="divide-y divide-stone-100 text-sm">
          {po.messages.map((m) => (
            <li key={m.id} className="flex flex-wrap gap-3 py-2">
              <span>{formatAmman(m.createdAt)}</span>
              <span dir="ltr" className="font-mono">
                +{m.phone}
              </span>
              <b className={m.status === 'failed' ? 'text-red-800' : ''}>
                {MESSAGE_LABEL[m.status] ?? m.status}
              </b>
              {m.error && <span className="text-red-700">{m.error}</span>}
            </li>
          ))}
          {po.messages.length === 0 && <li className="py-2 text-brand-muted">لم يُرسل بعد</li>}
        </ul>
      </Card>
    </div>
  );
}
