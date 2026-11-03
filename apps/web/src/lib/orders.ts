import type { ItemUnit, OrderEventType, OrderSource, OrderStatus } from '@mecca/shared';

export type OrderRow = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  deliveryDate: string;
  status: OrderStatus;
  source: OrderSource;
  total: number;
  itemCount: number;
  notes: string | null;
  creditReasons: { code: string; message: string }[] | null;
  createdAt: string;
};

export type OrderLine = {
  itemId: string;
  quantity: number;
  unitPrice: number;
  priceSource: string;
  lineTotal: number;
  code: string;
  name: string;
  unit: ItemUnit;
};

export type OrderEvent = {
  id: number;
  type: OrderEventType;
  note: string | null;
  data: unknown;
  createdAt: string;
  actorName: string | null;
};

export type Order = OrderRow & {
  lines: OrderLine[];
  events: OrderEvent[];
  cutoffAt: string;
  editableByRestaurant: boolean;
  approvalNote: string | null;
  cancelReason: string | null;
};

export type CatalogItem = {
  id: string;
  code: string;
  name: string;
  unit: ItemUnit;
  price: number;
  source: 'contract' | 'discount' | 'base';
  sectionName: string;
};

export const STATUS_TONE: Record<OrderStatus, 'green' | 'gold' | 'red' | 'neutral'> = {
  draft: 'neutral',
  submitted: 'gold',
  pending_approval: 'red',
  confirmed: 'green',
  delivered: 'green',
  rejected: 'red',
  cancelled: 'neutral',
};

/** "2026-11-11T00:00:00Z" → "03:00 — 11/11" in Amman time. */
export function formatAmman(iso: string) {
  return new Intl.DateTimeFormat('ar-JO', {
    timeZone: 'Asia/Amman',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
