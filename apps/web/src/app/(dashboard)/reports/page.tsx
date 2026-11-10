'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, FileSpreadsheet, FileText } from 'lucide-react';
import { addDays, ammanDate, filsToJodString } from '@mecca/shared';
import { api, errorMessage, fetchAuthedBlob, openAuthed } from '@/lib/api';
import { Button, Card, ErrorBox } from '@/components/ui';
import { t } from '@/lib/i18n';

type Kind = 'text' | 'int' | 'money' | 'percent' | 'date';
type Table = {
  key: string;
  title: string;
  subtitle: string;
  columns: { key: string; label: string; kind: Kind }[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
  chart: { label: string; value: string } | null;
};
type ReportInfo = { key: string; title: string; groups: { key: string; label: string }[] };

const field = 'h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm';
const NO_DATES = new Set(['credit', 'aging']);

function show(kind: Kind, v: string | number | null | undefined) {
  if (v === null || v === undefined || v === '') return '—';
  if (kind === 'money') return filsToJodString(Number(v));
  if (kind === 'percent') return `${v}%`;
  if (kind === 'int') return Number(v).toLocaleString('en-US');
  return String(v);
}

export default function ReportsPage() {
  const [list, setList] = useState<ReportInfo[]>([]);
  const [key, setKey] = useState('sales');
  const [groupBy, setGroupBy] = useState('');
  const [from, setFrom] = useState(addDays(ammanDate(), -29));
  const [to, setTo] = useState(ammanDate());
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<ReportInfo[]>('/api/reports')
      .then(setList)
      .catch((err) => setError(errorMessage(err, t('تعذّر التحميل'))));
  }, []);

  const info = list.find((r) => r.key === key);
  const qs = useCallback(
    (format?: string) =>
      new URLSearchParams({
        from,
        to,
        ...(groupBy ? { groupBy } : {}),
        ...(format ? { format } : {}),
      }).toString(),
    [from, to, groupBy],
  );

  useEffect(() => {
    setBusy(true);
    void api<Table>(`/api/reports/${key}?${qs()}`)
      .then((tr) => {
        setTable(tr);
        setError('');
      })
      .catch((err) => setError(errorMessage(err, t('تعذّر تشغيل التقرير'))))
      .finally(() => setBusy(false));
  }, [key, qs]);

  async function excel() {
    try {
      const blob = await fetchAuthedBlob(`/api/reports/${key}?${qs('xlsx')}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${key}-${from}_${to}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) {
      setError(errorMessage(err, t('تعذّر التصدير')));
    }
  }

  const chart = table?.chart;
  const bars = chart
    ? [...table.rows]
        .filter((r) => Number(r[chart.value]) > 0)
        .sort((a, b) => Number(b[chart.value]) - Number(a[chart.value]))
        .slice(0, 12)
    : [];
  const chartCol = chart && table?.columns.find((c) => c.key === chart.value);
  const max = Math.max(1, ...bars.map((r) => Number(r[chart!.value])));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-brand-brown">
          <BarChart3 size={24} /> {t('التقارير')}
        </h1>
        <p className="text-sm text-brand-muted">
          {t('كل تقرير يُصدَّر Excel وPDF. المبالغ بالدينار.')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {list.map((r) => (
          <button
            key={r.key}
            onClick={() => {
              setKey(r.key);
              setGroupBy('');
            }}
            className={`rounded-full border px-4 py-2 text-sm font-bold ${
              key === r.key
                ? 'border-transparent bg-primary text-on-primary'
                : 'border-brand-line bg-surface text-brand-brown hover:bg-brand-cream'
            }`}
          >
            {r.title}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {!NO_DATES.has(key) && (
            <>
              <label className="flex items-center gap-1">
                {t('من')}{' '}
                <input
                  type="date"
                  className={field}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-1">
                {t('إلى')}{' '}
                <input
                  type="date"
                  className={field}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              {[
                [t('اليوم'), 0],
                [t('7 أيام'), 6],
                [t('30 يوم'), 29],
                [t('90 يوم'), 89],
              ].map(([label, days]) => (
                <button
                  key={label}
                  className="rounded-lg border border-brand-line px-3 py-2 hover:bg-brand-cream"
                  onClick={() => {
                    setTo(ammanDate());
                    setFrom(addDays(ammanDate(), -Number(days)));
                  }}
                >
                  {label}
                </button>
              ))}
            </>
          )}
          {info && info.groups.length > 0 && (
            <label className="flex items-center gap-1">
              {t('حسب')}
              <select
                className={field}
                value={groupBy || info.groups[0]!.key}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                {info.groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="ms-auto flex gap-2">
            <Button variant="outline" onClick={() => void excel()}>
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet size={15} /> Excel
              </span>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void openAuthed(`/api/reports/${key}?${qs('pdf')}`).catch((err) =>
                  setError(errorMessage(err, t('تعذّر فتح PDF'))),
                )
              }
            >
              <span className="flex items-center gap-1.5">
                <FileText size={15} /> PDF
              </span>
            </Button>
          </span>
        </div>
      </Card>
      <ErrorBox message={error} />

      {table && (
        <>
          {bars.length > 1 && chartCol && (
            <Card title={`${table.title} — ${chartCol.label}`}>
              <div className="space-y-1.5">
                {bars.map((r, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[minmax(0,10rem)_1fr_6rem] items-center gap-3 text-sm"
                  >
                    <span className="truncate">{String(r[chart!.label])}</span>
                    <div className="h-5 overflow-hidden rounded bg-brand-cream">
                      <div
                        className="h-full rounded bg-brand-gold"
                        style={{ width: `${(Number(r[chart!.value]) / max) * 100}%` }}
                      />
                    </div>
                    <span className="text-end font-bold tabular-nums">
                      {show(chartCol.kind, r[chart!.value])}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title={`${table.title} (${table.rows.length})`}>
            <p className="mb-3 text-sm text-brand-muted">{table.subtitle}</p>
            <div className={`overflow-x-auto ${busy ? 'opacity-50' : ''}`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-line text-start text-brand-muted">
                    {table.columns.map((c) => (
                      <th key={c.key} className="px-2 py-2 whitespace-nowrap">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i} className="border-b border-stone-100">
                      {table.columns.map((c) => (
                        <td
                          key={c.key}
                          className={`px-2 py-2 ${c.kind === 'text' ? '' : 'tabular-nums whitespace-nowrap'} ${c.kind === 'date' ? 'font-mono' : ''}`}
                        >
                          {show(c.kind, r[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {table.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={table.columns.length}
                        className="py-6 text-center text-brand-muted"
                      >
                        {t('لا توجد بيانات في هذه الفترة')}
                      </td>
                    </tr>
                  )}
                  {table.totals && table.rows.length > 0 && (
                    <tr className="bg-brand-gold-light/50 font-bold">
                      {table.columns.map((c, i) => (
                        <td key={c.key} className="px-2 py-2 tabular-nums whitespace-nowrap">
                          {i === 0
                            ? String(table.totals![c.key] ?? t('المجموع'))
                            : c.kind === 'percent' || table.totals![c.key] == null
                              ? ''
                              : show(c.kind, table.totals![c.key])}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
