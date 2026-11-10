import type { AuthUser, ItemUnit, OrderEventType, OrderStatus } from '@mecca/shared';

export type DayOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  total: number;
  itemCount: number;
  deliveryDate: string;
};

export type Me = {
  user: AuthUser;
  deliveryDate: string;
  cutoffAt: string;
  now: string;
  today: string;
  branches: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    order: DayOrder | null;
  }[];
  credit: {
    allowed: boolean;
    outstanding: number;
    overdueAmount: number;
    available: number | null;
    reasons: { code: string; message: string; key?: string; args?: string[] }[];
    contract: { number: string; endDate: string } | null;
  };
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

export type Order = DayOrder & {
  branchId: string;
  branchName: string;
  customerName: string;
  notes: string | null;
  cutoffAt: string;
  editableByRestaurant: boolean;
  creditReasons: { code: string; message: string; key?: string; args?: string[] }[] | null;
  lines: {
    itemId: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    name: string;
    unit: ItemUnit;
  }[];
  events: {
    id: number;
    type: OrderEventType;
    createdAt: string;
    actorName: string | null;
    note: string | null;
  }[];
};

export type OrderRow = DayOrder & { branchName: string; branchCode: string };
