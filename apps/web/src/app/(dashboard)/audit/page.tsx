'use client';

import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { addDays, ammanDate } from '@mecca/shared';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, ErrorBox } from '@/components/ui';
import { formatAmman } from '@/lib/orders';

type Entry = {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  userName: string | null;
};

/** What each part of the system is called in the log. */
const ENTITY_AR: Record<string, string> = {
  user: 'مستخدم',
  customer: 'عميل',
  branch: 'فرع',
  customer_category: 'تصنيف عملاء',
  trade_name: 'اسم تجاري',
  item: 'صنف',
  item_section: 'قسم',
  contract: 'عقد',
  order: 'طلب',
  production_day: 'يوم إنتاج',
  production_line: 'خط إنتاج',
  vehicle: 'سيارة',
  supplier: 'مورد',
  purchase_order: 'طلب شراء',
  route: 'مسار',
  trip: 'رحلة',
  trip_day: 'مسارات اليوم',
  delivery: 'تسليم',
  invoice: 'فاتورة',
  payment: 'دفعة',
  settings: 'إعدادات',
  file: 'ملف',
  system: 'النظام',
};
const VERB_AR: [RegExp, string][] = [
  [/\.create$|\.opening$/, 'إضافة'],
  [/\.update$|\.edit|\.stops$|\.items$|\.loads$/, 'تعديل'],
  [/\.delete$|\.remove/, 'حذف'],
  [/\.approve/, 'اعتماد'],
  [/\.reject/, 'رفض'],
  [/\.cancel/, 'إلغاء'],
  [/\.confirm/, 'تأكيد'],
  [/\.close$/, 'إغلاق'],
  [/\.generate$/, 'تجهيز'],
  [/\.send/, 'إرسال'],
  [/login/, 'دخول'],
  [/logout/, 'خروج'],
  [/export/, 'تصدير'],
];
const verb = (a: string) => VERB_AR.find(([re]) => re.test(a))?.[1] ?? a;

/** Fields that changed between before and after (top level only). */
function changes(before: unknown, after: unknown) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return null;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const skip = new Set(['updatedAt', 'createdAt', 'id']);
  return Object.keys(a)
    .filter((k) => !skip.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ key: k, from: b[k], to: a[k] }));
}
const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? '—' : s.length > 60 ? `${s.slice(0, 60)}…` : s;
};

const field = 'h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm';

export default function AuditPage() {
  const [from, setFrom] = useState(addDays(ammanDate(), -7));
  const [to, setTo] = useState(ammanDate());
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState<Entry[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');

  const query = useCallback(
    (before?: number) =>
      new URLSearchParams({
        limit: '100',
        from,
        to,
        ...(entity ? { entity } : {}),
        ...(before ? { before: String(before) } : {}),
      }).toString(),
    [from, to, entity],
  );

  useEffect(() => {
    void api<Entry[]>(`/api/audit?${query()}`)
      .then((r) => {
        setRows(r);
        setMore(r.length === 100);
      })
      .catch((err) => setError(errorMessage(err, 'تعذّر التحميل')));
  }, [query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-brand-brown">
          <History size={24} /> سجل التدقيق
        </h1>
        <p className="text-sm text-brand-muted">
          كل تعديل في النظام: من، ومتى، وما الذي تغيّر. السجل للقراءة فقط ولا يمكن تعديله.
        </p>
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          من{' '}
          <input
            type="date"
            className={field}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          إلى{' '}
          <input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
          <select
            className={field}
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            aria-label="النوع"
          >
            <option value="">كل الأنواع</option>
            {Object.entries(ENTITY_AR).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </Card>
      <ErrorBox message={error} />
      <Card title={`${rows.length} عملية`}>
        <ul className="divide-y divide-stone-100 text-sm">
          {rows.map((r) => {
            const diff = changes(r.before, r.after);
            return (
              <li key={r.id} className="py-2">
                <button
                  className="flex w-full flex-wrap items-center gap-3 text-right"
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  <span className="w-36 shrink-0 text-brand-muted tabular-nums">
                    {formatAmman(r.createdAt)}
                  </span>
                  <b className="w-40 shrink-0 truncate">{r.userName ?? '—'}</b>
                  <span className="rounded-full bg-brand-gold-light px-2 py-0.5 text-xs font-bold text-brand-brown">
                    {verb(r.action)}
                  </span>
                  <span>{ENTITY_AR[r.entity] ?? r.entity}</span>
                  {diff && diff.length > 0 && (
                    <span className="truncate text-brand-muted">
                      {diff
                        .slice(0, 3)
                        .map((d) => d.key)
                        .join('، ')}
                    </span>
                  )}
                  <span className="mr-auto font-mono text-xs text-brand-muted" dir="ltr">
                    {r.action}
                  </span>
                </button>
                {open === r.id && (
                  <div className="mt-2 space-y-2 rounded-lg bg-brand-cream/60 p-3 text-xs">
                    {diff && diff.length > 0 ? (
                      <table className="w-full">
                        <thead>
                          <tr className="text-right text-brand-muted">
                            <th>الحقل</th>
                            <th>قبل</th>
                            <th>بعد</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diff.map((d) => (
                            <tr key={d.key}>
                              <td className="py-1 font-mono">{d.key}</td>
                              <td className="text-red-800" dir="ltr">
                                {short(d.from)}
                              </td>
                              <td className="text-green-800" dir="ltr">
                                {short(d.to)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <pre className="overflow-x-auto whitespace-pre-wrap" dir="ltr">
                        {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                      </pre>
                    )}
                    <div className="text-brand-muted" dir="ltr">
                      {r.entityId} {r.ip ? `— ${r.ip}` : ''}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="py-4 text-brand-muted">لا توجد عمليات في هذه الفترة</li>
          )}
        </ul>
        {more && rows.length > 0 && (
          <Button
            variant="outline"
            className="mt-3"
            onClick={() =>
              void api<Entry[]>(`/api/audit?${query(rows[rows.length - 1]!.id)}`).then((r) => {
                setRows([...rows, ...r]);
                setMore(r.length === 100);
              })
            }
          >
            عرض المزيد
          </Button>
        )}
      </Card>
    </div>
  );
}
