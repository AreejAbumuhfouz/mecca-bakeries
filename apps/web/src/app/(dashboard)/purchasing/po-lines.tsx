'use client';

import { COMMON_UNITS } from '@/lib/purchasing';
import { t } from '@/lib/i18n';

export type LineDraft = { description: string; quantity: string; unit: string; note: string };
export const emptyLine = (): LineDraft => ({
  description: '',
  quantity: '',
  unit: t('كغ'),
  note: '',
});

const field = 'h-9 rounded-lg border border-brand-line bg-surface px-2 text-sm';

export function PoLinesEditor({
  lines,
  setLines,
}: {
  lines: LineDraft[];
  setLines: (l: LineDraft[]) => void;
}) {
  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <datalist id="po-units">
        {COMMON_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-brand-muted">
              <th className="w-8">#</th>
              <th>{t('المادة')}</th>
              <th className="w-28">{t('الكمية')}</th>
              <th className="w-36">{t('الوحدة')}</th>
              <th>{t('ملاحظة')}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 text-brand-muted">{i + 1}</td>
                <td>
                  <input
                    className={`${field} w-full`}
                    aria-label={t('المادة {0}', i + 1)}
                    placeholder={t('مثلاً: طحين زيرو')}
                    value={l.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    dir="ltr"
                    inputMode="decimal"
                    className={`${field} w-24`}
                    aria-label={t('الكمية {0}', i + 1)}
                    value={l.quantity}
                    onChange={(e) => update(i, { quantity: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    list="po-units"
                    className={`${field} w-32`}
                    aria-label={t('الوحدة {0}', i + 1)}
                    value={l.unit}
                    onChange={(e) => update(i, { unit: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={`${field} w-full`}
                    value={l.note}
                    onChange={(e) => update(i, { note: e.target.value })}
                  />
                </td>
                <td>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="text-red-700"
                      aria-label={t('حذف البند')}
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="text-sm text-brand-brown underline"
        onClick={() => setLines([...lines, emptyLine()])}
      >
        {t('+ بند آخر')}
      </button>
    </div>
  );
}

/** Drafts → API lines, or an Arabic error. Empty rows are ignored. */
export function toPoLines(lines: LineDraft[]) {
  const out = [];
  for (const [i, l] of lines.entries()) {
    if (!l.description.trim() && !l.quantity.trim()) continue;
    const q = Number(l.quantity.replace(/[٠-٩]/g, (d) => String(t('٠١٢٣٤٥٦٧٨٩').indexOf(d))));
    if (!l.description.trim() || !(q > 0) || !l.unit.trim())
      return t('البند {0}: أكمل المادة والكمية والوحدة', i + 1);
    out.push({
      description: l.description.trim(),
      quantity: Math.round(q * 1000) / 1000,
      unit: l.unit.trim(),
      note: l.note.trim() || null,
    });
  }
  return out.length ? out : t('أضف بنداً واحداً على الأقل');
}
