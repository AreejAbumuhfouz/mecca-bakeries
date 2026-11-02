'use client';

import { useMemo, useState } from 'react';
import { formatJod, ITEM_UNIT_LABELS_AR } from '@mecca/shared';
import type { CatalogItem } from '@/lib/orders';

/** Quantities keyed by item id. */
export type Quantities = Record<string, number>;

export function OrderLinesEditor({
  catalog,
  quantities,
  onChange,
}: {
  catalog: CatalogItem[];
  quantities: Quantities;
  onChange: (q: Quantities) => void;
}) {
  const [search, setSearch] = useState('');
  const [onlyChosen, setOnlyChosen] = useState(false);
  const rows = useMemo(
    () =>
      catalog.filter(
        (i) =>
          (!onlyChosen || quantities[i.id]) &&
          (!search ||
            i.name.includes(search) ||
            i.code.toLowerCase().includes(search.toLowerCase())),
      ),
    [catalog, quantities, onlyChosen, search],
  );
  const total = catalog.reduce((s, i) => s + (quantities[i.id] ?? 0) * i.price, 0);
  const chosen = Object.values(quantities).filter((q) => q > 0).length;

  const setQty = (id: string, value: number) => {
    const next = { ...quantities };
    if (value > 0) next[id] = Math.min(100_000, Math.trunc(value));
    else delete next[id];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="w-56 rounded-lg border border-brand-line px-3 py-2 text-sm"
          placeholder="بحث عن صنف"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-brand-gold"
            checked={onlyChosen}
            onChange={(e) => setOnlyChosen(e.target.checked)}
          />
          المختار فقط ({chosen})
        </label>
        <span className="mr-auto text-lg font-bold text-brand-brown">
          المجموع: {formatJod(total)}
        </span>
      </div>
      <div className="max-h-[520px] overflow-auto rounded-xl border border-brand-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-brand-cream">
            <tr className="text-right text-brand-muted">
              <th className="px-3 py-2">الكود</th>
              <th>الصنف</th>
              <th>الوحدة</th>
              <th>السعر</th>
              <th className="w-44">الكمية</th>
              <th>المجموع</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const q = quantities[i.id] ?? 0;
              return (
                <tr
                  key={i.id}
                  className={`border-t border-stone-100 ${q ? 'bg-brand-gold-light/30' : ''}`}
                >
                  <td className="px-3 py-2 font-mono">{i.code}</td>
                  <td className="font-bold">
                    {i.name}
                    <span className="mr-2 text-xs font-normal text-brand-muted">
                      {i.sectionName}
                    </span>
                  </td>
                  <td>{ITEM_UNIT_LABELS_AR[i.unit]}</td>
                  <td>
                    {formatJod(i.price)}
                    {i.source === 'contract' && (
                      <span className="mr-1 text-xs text-brand-gold">خاص</span>
                    )}
                  </td>
                  <td className="py-1">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="h-8 w-8 rounded-lg border border-brand-line text-lg"
                        onClick={() => setQty(i.id, q - 1)}
                        aria-label="إنقاص"
                      >
                        −
                      </button>
                      <input
                        dir="ltr"
                        inputMode="numeric"
                        className="h-8 w-16 rounded-lg border border-brand-line text-center"
                        value={q || ''}
                        placeholder="0"
                        aria-label={`كمية ${i.name}`}
                        onChange={(e) =>
                          setQty(i.id, Number(e.target.value.replace(/\D/g, '')) || 0)
                        }
                      />
                      <button
                        type="button"
                        className="h-8 w-8 rounded-lg border border-brand-line text-lg"
                        onClick={() => setQty(i.id, q + 1)}
                        aria-label="زيادة"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="font-bold">{q ? formatJod(q * i.price) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const toLines = (q: Quantities) =>
  Object.entries(q)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));
