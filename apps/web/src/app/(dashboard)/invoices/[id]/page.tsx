'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Lock, MapPin } from 'lucide-react';
import {
  bpsToPercentString,
  filsToJodString,
  formatJod,
  INVOICE_STATUS_LABELS_AR,
  parsePercentToBps,
  PAYMENT_METHOD_LABELS_AR,
} from '@mecca/shared';
import { api, errorMessage, openAuthed } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Input, Textarea } from '@/components/ui';
import { formatAmman } from '@/lib/orders';
import { INVOICE_TONE, jodToFils, type Invoice } from '@/lib/billing';

type EditLine = {
  kind: 'sale' | 'return';
  itemId: string | null;
  description: string;
  unit: string | null;
  quantity: string;
  price: string;
  listPrice: number;
};

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const canManage = can('invoices.manage');
  const canEditLocked = can('invoices.edit_locked');
  const [inv, setInv] = useState<Invoice | null>(null);
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [discount2, setDiscount2] = useState('0');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async () => setInv(await api<Invoice>(`/api/billing/invoices/${id}`)),
    [id],
  );
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err, 'تعذّر التحميل')));
  }, [load]);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setError('');
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

  if (!inv) return <ErrorBox message={error} />;
  const locked = inv.status === 'approved';
  const canEdit = inv.status !== 'cancelled' && (locked ? canEditLocked : canManage);

  function startEdit() {
    if (!inv) return;
    setLines(
      inv.lines.map((l) => ({
        kind: l.kind,
        itemId: l.itemId,
        description: l.description,
        unit: l.unit,
        quantity: String(l.quantity),
        price: filsToJodString(l.unitPrice),
        listPrice: l.listPrice,
      })),
    );
    setDiscount2(bpsToPercentString(inv.discount2Bps));
    setNotes(inv.notes ?? '');
    setReason('');
    setEditing(true);
  }

  async function save() {
    const bps = parsePercentToBps(discount2 || '0');
    if (bps === null) return setError('نسبة الخصم الثاني غير صحيحة');
    const out: {
      kind: 'sale' | 'return';
      itemId: string | null;
      description: string;
      unit: string | null;
      quantity: number;
      unitPrice: number;
      listPrice: number;
    }[] = [];
    for (const l of lines) {
      const q = Number(l.quantity);
      const p = jodToFils(l.price);
      if (!Number.isInteger(q) || q < 1 || p === null)
        return setError(`تحقّقي من الكمية والسعر: ${l.description}`);
      out.push({
        kind: l.kind,
        itemId: l.itemId,
        description: l.description,
        unit: l.unit,
        quantity: q,
        unitPrice: p,
        listPrice: Math.max(p, l.listPrice),
      });
    }
    const ok = await run(
      () =>
        api(`/api/billing/invoices/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            discount2Bps: bps,
            notes: notes || null,
            ...(inv?.kind === 'sale' ? { lines: out } : {}),
            ...(locked ? { reason } : {}),
          }),
        }),
      'تعذّر الحفظ',
    );
    if (ok) setEditing(false);
  }

  const sales = inv.grossTotal - inv.discount1Amount;
  const row = (label: string, value: string, strong = false) => (
    <div
      className={`flex justify-between py-1 ${strong ? 'border-t border-brand-line pt-2 text-lg font-bold' : ''}`}
    >
      <span>{label}</span>
      <span dir="ltr">{value}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/invoices" className="text-sm text-brand-muted underline">
            ← الفواتير
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-brand-brown">
            {inv.kind === 'opening' ? 'رصيد افتتاحي' : 'فاتورة'}{' '}
            <span className="font-mono">{inv.number}</span>
            {locked && <Lock size={18} className="text-brand-muted" />}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/payments/customers/${inv.customer.id}`} className="font-bold underline">
              {inv.customer.name}
            </Link>
            {inv.branchName && <span>— {inv.branchName}</span>}
            <span className="text-brand-muted">{inv.tradeName?.name}</span>
            <Badge tone={INVOICE_TONE[inv.status]}>{INVOICE_STATUS_LABELS_AR[inv.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-brand-muted">
            التاريخ {inv.issueDate} — الاستحقاق {inv.dueDate}
            {inv.orderNumber && (
              <>
                {' '}
                — الطلب{' '}
                <Link href={`/orders/${inv.orderId}`} className="font-mono underline">
                  {inv.orderNumber}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void openAuthed(`/api/billing/invoices/${id}/pdf`).catch((err) =>
                setError(errorMessage(err, 'تعذّر فتح PDF')),
              )
            }
          >
            PDF
          </Button>
          {canManage && inv.status === 'draft' && (
            <Button
              variant="gold"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api('/api/billing/invoices/approve', {
                      method: 'POST',
                      body: JSON.stringify({ ids: [id] }),
                    }),
                  'تعذّر الاعتماد',
                )
              }
            >
              اعتماد وقفل
            </Button>
          )}
          {canEdit && !editing && (
            <Button variant="outline" onClick={startEdit}>
              تعديل
            </Button>
          )}
        </div>
      </div>
      <ErrorBox message={error} />
      {inv.flags.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <AlertTriangle size={16} /> {inv.flags.join('، ')}
        </div>
      )}
      {locked && !canEditLocked && (
        <p className="text-sm text-brand-muted">
          الفاتورة معتمدة ومقفلة. تعديلها يحتاج صلاحية «تعديل الفواتير المعتمدة».
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="البنود">
            {editing && inv.kind === 'sale' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-brand-muted">
                      <th>الصنف</th>
                      <th className="w-24">الكمية</th>
                      <th className="w-28">السعر</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-1">
                          {l.kind === 'return' && <span className="text-red-800">مرتجع: </span>}
                          {l.description}
                        </td>
                        <td>
                          <input
                            dir="ltr"
                            aria-label={`كمية ${l.description}`}
                            className="h-9 w-20 rounded-lg border border-brand-line bg-surface px-2"
                            value={l.quantity}
                            onChange={(e) =>
                              setLines(
                                lines.map((x, j) =>
                                  j === i ? { ...x, quantity: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            dir="ltr"
                            aria-label={`سعر ${l.description}`}
                            className="h-9 w-24 rounded-lg border border-brand-line bg-surface px-2"
                            value={l.price}
                            onChange={(e) =>
                              setLines(
                                lines.map((x, j) =>
                                  j === i ? { ...x, price: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            className="text-red-700"
                            aria-label="حذف"
                            onClick={() => setLines(lines.filter((_, j) => j !== i))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-line text-right text-brand-muted">
                      <th className="py-2">#</th>
                      <th>الصنف</th>
                      <th>الكمية</th>
                      <th>السعر</th>
                      <th>المجموع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((l, i) => (
                      <tr
                        key={l.id}
                        className={`border-b border-stone-100 ${l.kind === 'return' ? 'text-red-800' : ''}`}
                      >
                        <td className="py-2 text-brand-muted">{i + 1}</td>
                        <td>
                          {l.kind === 'return' && 'مرتجع: '}
                          {l.description} <span className="text-xs text-brand-muted">{l.unit}</span>
                        </td>
                        <td>{l.quantity}</td>
                        <td>
                          {filsToJodString(l.unitPrice)}
                          {l.listPrice > l.unitPrice && (
                            <span className="mr-1 text-xs text-brand-muted line-through">
                              {filsToJodString(l.listPrice)}
                            </span>
                          )}
                        </td>
                        <td className="font-bold">{filsToJodString(l.lineTotal)}</td>
                      </tr>
                    ))}
                    {inv.lines.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-3 text-brand-muted">
                          {inv.notes}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {editing && (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {inv.kind === 'sale' && (
                  <Input
                    label="الخصم الثاني %"
                    dir="ltr"
                    value={discount2}
                    onChange={(e) => setDiscount2(e.target.value)}
                  />
                )}
                <Textarea
                  label="ملاحظات"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                {locked && (
                  <div className="md:col-span-2">
                    <Input
                      label="سبب تعديل الفاتورة المعتمدة (مطلوب)"
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                )}
                <div className="flex gap-2 md:col-span-2">
                  <Button disabled={busy} onClick={() => void save()}>
                    حفظ
                  </Button>
                  <Button variant="outline" onClick={() => setEditing(false)}>
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="المجموع">
            <div className="text-sm">
              {inv.discount1Amount > 0 && row('قبل الخصم', filsToJodString(inv.grossTotal))}
              {inv.discount1Amount > 0 &&
                row('الخصم الأول (العقد)', `− ${filsToJodString(inv.discount1Amount)}`)}
              {inv.kind === 'sale' && row('المبيعات', filsToJodString(sales))}
              {inv.discount2Amount > 0 &&
                row(
                  `الخصم الثاني (${bpsToPercentString(inv.discount2Bps)}%)`,
                  `− ${filsToJodString(inv.discount2Amount)}`,
                )}
              {inv.returnsTotal > 0 && row('المرتجعات', `− ${filsToJodString(inv.returnsTotal)}`)}
              {row('الصافي', formatJod(inv.total), true)}
              {row('المدفوع', formatJod(inv.paid))}
              <div
                className={`flex justify-between py-1 font-bold ${inv.balance > 0 ? 'text-red-800' : 'text-green-800'}`}
              >
                <span>المتبقي</span>
                <span dir="ltr">{formatJod(Math.max(0, inv.balance))}</span>
              </div>
            </div>
          </Card>

          <Card title="الدفعات">
            <ul className="space-y-1 text-sm">
              {inv.payments.map((p) => (
                <li key={p.paymentId} className="flex justify-between">
                  <span>
                    <span className="font-mono">{p.number}</span> — {p.receivedOn} —{' '}
                    {PAYMENT_METHOD_LABELS_AR[p.method]}
                  </span>
                  <b>{formatJod(p.amount)}</b>
                </li>
              ))}
              {inv.payments.length === 0 && <li className="text-brand-muted">لا دفعات بعد</li>}
            </ul>
          </Card>

          {inv.delivery && (
            <Card title="التسليم">
              <div className="space-y-1 text-sm">
                <div>
                  المستلم: <b>{inv.delivery.receiverName ?? '—'}</b>
                </div>
                {inv.delivery.deliveredAt && <div>{formatAmman(inv.delivery.deliveredAt)}</div>}
                {inv.delivery.latitude != null && (
                  <a
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-brand-gold underline"
                    href={`https://www.google.com/maps?q=${inv.delivery.latitude},${inv.delivery.longitude}`}
                  >
                    <MapPin size={14} /> موقع التسليم
                  </a>
                )}
                {inv.delivery.hasSignature && (
                  <div className="text-brand-muted">موقّع من المستلم</div>
                )}
              </div>
            </Card>
          )}

          {canEdit && inv.status !== 'cancelled' && (
            <Card title="إلغاء الفاتورة">
              <div className="space-y-2">
                <Input
                  label="سبب الإلغاء"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
                <Button
                  variant="outline"
                  className="!border-red-700 !text-red-700"
                  disabled={busy || cancelReason.trim().length < 3}
                  onClick={() =>
                    void run(
                      () =>
                        api(`/api/billing/invoices/${id}/cancel`, {
                          method: 'POST',
                          body: JSON.stringify({ reason: cancelReason }),
                        }),
                      'تعذّر الإلغاء',
                    )
                  }
                >
                  إلغاء الفاتورة
                </Button>
                <p className="text-xs text-brand-muted">
                  أي مبلغ مدفوع عليها يرجع رصيداً للعميل ويُوزَّع على فواتيره الأخرى.
                </p>
              </div>
            </Card>
          )}
          {inv.cancelReason && <p className="text-sm text-red-800">أُلغيت: {inv.cancelReason}</p>}
        </div>
      </div>

      {inv.revisions.length > 0 && (
        <Card title="سجل تعديل الفاتورة المعتمدة">
          <ul className="divide-y divide-stone-100 text-sm">
            {inv.revisions.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-3 py-2">
                <span>{formatAmman(r.createdAt)}</span>
                <b>{r.userName}</b>
                <span>
                  {formatJod(r.before.total)} ← {formatJod(r.after.total)}
                </span>
                <span className="text-brand-muted">السبب: {r.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
