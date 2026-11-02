'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  applyDiscount,
  filsToJodString,
  formatJod,
  ITEM_UNIT_LABELS_AR,
  parseJod,
  type ItemUnit,
} from '@mecca/shared';
import { api } from '@/lib/api';

export type CatalogItem = {
  id: string;
  code: string;
  name: string;
  unit: ItemUnit;
  basePrice: number;
  sectionName: string;
  isActive: boolean;
};

/** Special prices typed as JOD strings, keyed by item id. Empty = no special price. */
export type PriceDraft = Record<string, string>;

export function PricesEditor({
  draft,
  setDraft,
  discountBps,
  readOnly = false,
}: {
  draft: PriceDraft;
  setDraft: (d: PriceDraft) => void;
  discountBps: number;
  readOnly?: boolean;
}) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [search, setSearch] = useState('');
  const [onlySpecial, setOnlySpecial] = useState(readOnly);

  useEffect(() => {
    void api<{ items: CatalogItem[] }>('/api/items?pageSize=100')
      .then((r) => setCatalog(r.items))
      .catch(() => undefined);
  }, []);

  const rows = useMemo(
    () =>
      catalog.filter(
        (i) =>
          (i.isActive || draft[i.id]) &&
          (!onlySpecial || draft[i.id]) &&
          (!search ||
            i.name.includes(search) ||
            i.code.toLowerCase().includes(search.toLowerCase())),
      ),
    [catalog, draft, onlySpecial, search],
  );

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
            checked={onlySpecial}
            onChange={(e) => setOnlySpecial(e.target.checked)}
            className="accent-brand-gold"
          />
          الأصناف ذات السعر الخاص فقط ({Object.values(draft).filter(Boolean).length})
        </label>
      </div>
      <div className="max-h-[480px] overflow-auto rounded-xl border border-brand-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-brand-cream">
            <tr className="text-right text-brand-muted">
              <th className="px-3 py-2">الكود</th>
              <th>الصنف</th>
              <th>الوحدة</th>
              <th>السعر الأساسي</th>
              <th>بعد الخصم العام</th>
              <th className="w-40">السعر الخاص (دينار)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="border-t border-stone-100">
                <td className="px-3 py-2 font-mono">{i.code}</td>
                <td className="font-bold">
                  {i.name}
                  <span className="mr-2 text-xs font-normal text-brand-muted">{i.sectionName}</span>
                </td>
                <td>{ITEM_UNIT_LABELS_AR[i.unit]}</td>
                <td>{formatJod(i.basePrice)}</td>
                <td className="text-brand-muted">
                  {discountBps > 0 ? formatJod(applyDiscount(i.basePrice, discountBps)) : '—'}
                </td>
                <td className="py-1 pl-3">
                  {readOnly ? (
                    <span className="font-bold text-brand-brown">
                      {draft[i.id] ? `${draft[i.id]} د.أ` : '—'}
                    </span>
                  ) : (
                    <input
                      dir="ltr"
                      inputMode="decimal"
                      placeholder={filsToJodString(i.basePrice)}
                      className={`w-full rounded-lg border px-2 py-1.5 text-sm ${
                        draft[i.id]
                          ? 'border-brand-gold bg-brand-gold-light/40 font-bold'
                          : 'border-brand-line'
                      }`}
                      value={draft[i.id] ?? ''}
                      onChange={(e) => {
                        const next = { ...draft };
                        if (e.target.value.trim()) next[i.id] = e.target.value;
                        else delete next[i.id];
                        setDraft(next);
                      }}
                    />
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-brand-muted">
                  لا توجد أصناف
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Draft → API body, or an Arabic error naming the first bad price. */
export function draftToPrices(draft: PriceDraft): { itemId: string; price: number }[] | string {
  const out: { itemId: string; price: number }[] = [];
  for (const [itemId, value] of Object.entries(draft)) {
    const price = parseJod(value);
    if (price === null) return `سعر خاص غير صالح: ${value}`;
    out.push({ itemId, price });
  }
  return out;
}

export const pricesToDraft = (prices: { itemId: string; price: number }[]): PriceDraft =>
  Object.fromEntries(prices.map((p) => [p.itemId, filsToJodString(p.price)]));
