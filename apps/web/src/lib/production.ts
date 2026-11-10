import type { ItemUnit, ProductionDayStatus, StockLossKind, StockLossReason } from '@mecca/shared';
import { t } from '@/lib/i18n';

export type DayItem = {
  itemId: string;
  code: string;
  name: string;
  unit: ItemUnit;
  sectionName: string;
  lineName: string | null;
  ordered: number;
  extra: number;
  planned: number;
  produced: number | null;
  loaded: number;
  waste: number;
  returned: number;
  note: string | null;
  productionDiff: number;
  loadingDiff: number;
  leftover: number;
  reasons: string[];
  needsApproval: boolean;
  open: boolean;
  approval: { note: string; approvedAt: string; approvedByName: string | null } | null;
};

export type ProductionDay = {
  id: string;
  deliveryDate: string;
  status: ProductionDayStatus;
  generatedAt: string;
  finalizedAt: string | null;
  closedAt: string | null;
  toleranceBps: number;
  pendingOrders: number;
  items: DayItem[];
  loads: { vehicleId: string; itemId: string; quantity: number }[];
  losses: {
    id: number;
    itemId: string;
    itemName: string;
    kind: StockLossKind;
    reason: StockLossReason;
    quantity: number;
    note: string | null;
    createdAt: string;
    createdByName: string | null;
  }[];
};

export type Vehicle = {
  id: string;
  name: string;
  plate: string | null;
  driverName: string | null;
  isActive: boolean;
};
export type ProductionLine = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  sectionCount: number;
};

export const DAY_TONE: Record<ProductionDayStatus, 'gold' | 'green' | 'neutral'> = {
  preliminary: 'gold',
  final: 'green',
  closed: 'neutral',
};

/** Groups rows by production line, then section, keeping the server order. */
export function groupByLine(items: DayItem[]) {
  const groups: { key: string; title: string; items: DayItem[] }[] = [];
  for (const i of items) {
    const title = `${i.lineName ?? t('بدون خط إنتاج')} — ${i.sectionName}`;
    let g = groups.find((x) => x.key === title);
    if (!g) groups.push((g = { key: title, title, items: [] }));
    g.items.push(i);
  }
  return groups;
}
