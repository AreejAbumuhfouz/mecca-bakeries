import type {
  AgingBucket,
  DeliveryReason,
  DeliveryStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentSource,
  TripStatus,
} from '@mecca/shared';
import { t } from '@/lib/i18n';

export type DayDelivery = {
  id: string;
  tripId: string;
  position: number;
  status: DeliveryStatus;
  receiverName: string | null;
  deliveredAt: string | null;
  collectedAmount: number;
  failReason: DeliveryReason | null;
  latitude: number | null;
  longitude: number | null;
  orderId: string;
  orderNumber: string;
  orderTotal: number;
  customerName: string;
  branchName: string;
  address: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
};

export type DayTrip = {
  id: string;
  deliveryDate: string;
  status: TripStatus;
  startedAt: string | null;
  finishedAt: string | null;
  routeName: string;
  driverName: string | null;
  vehicleName: string | null;
  counts: Record<'total' | DeliveryStatus, number>;
  collected: number;
  invoiced: number;
  deliveries: DayDelivery[];
};

export type DistributionDay = {
  date: string;
  trips: DayTrip[];
  unassigned: {
    orderId: string;
    orderNumber: string;
    customerName: string;
    branchName: string;
    total: number;
  }[];
  notConfirmed: number;
};

export type RouteRow = {
  id: string;
  name: string;
  vehicleId: string | null;
  driverId: string | null;
  sortOrder: number;
  isActive: boolean;
  vehicleName: string | null;
  driverName: string | null;
  stops: {
    branchId: string;
    branchName: string;
    branchCode: string;
    customerName: string;
    address: string | null;
    position: number;
  }[];
};

export type InvoiceRow = {
  id: string;
  number: string;
  kind: 'sale' | 'opening';
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  total: number;
  paid: number;
  balance: number;
  flags: string[];
  customerId: string;
  customerName: string;
  customerCode: string;
  branchName: string | null;
  tradeName: string | null;
};

export type InvoiceLine = {
  id: number;
  kind: 'sale' | 'return';
  itemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  listPrice: number;
  unitPrice: number;
  lineTotal: number;
};

export type Invoice = Omit<
  InvoiceRow,
  'customerName' | 'customerCode' | 'branchName' | 'tradeName'
> & {
  orderId: string | null;
  grossTotal: number;
  discount1Amount: number;
  discount2Bps: number;
  discount2Amount: number;
  returnsTotal: number;
  notes: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  lines: InvoiceLine[];
  customer: { id: string; code: string; name: string };
  branchName: string | null;
  tradeName: { id: string; name: string; prefix: string } | null;
  orderNumber: string | null;
  delivery: {
    receiverName: string | null;
    deliveredAt: string | null;
    hasSignature: boolean;
    latitude: number | null;
    longitude: number | null;
  } | null;
  deliveryId: string | null;
  payments: {
    paymentId: string;
    number: string;
    receivedOn: string;
    method: PaymentMethod;
    amount: number;
    manual: boolean;
  }[];
  revisions: {
    id: number;
    reason: string;
    createdAt: string;
    userName: string | null;
    before: { total: number };
    after: { total: number };
  }[];
};

export type PaymentRow = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  amount: number;
  method: PaymentMethod;
  source: PaymentSource;
  receivedOn: string;
  reference: string | null;
  chequeDueDate: string | null;
  status: 'received' | 'cancelled';
  receivedByName: string | null;
  allocated: number;
};

export type ReceivableRow = {
  customerId: string;
  code: string;
  name: string;
  tradeName: string | null;
  balanceAlerts: boolean;
  owed: number;
  credit: number;
  balance: number;
  overdue: number;
  aging: Record<AgingBucket, number>;
  oldestDue: string | null;
  lastPaymentOn: string | null;
};

export type Summary = {
  balance: number;
  owed: number;
  credit: number;
  overdue: number;
  aging: Record<AgingBucket, number>;
  openInvoices: {
    id: string;
    number: string;
    issueDate: string;
    dueDate: string;
    total: number;
    paid: number;
    balance: number;
  }[];
};

export type Statement = {
  customer: {
    id: string;
    code: string;
    name: string;
    balanceAlerts: boolean;
    phone: string | null;
  };
  from: string;
  to: string;
  opening: number;
  rows: {
    date: string;
    number: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  closing: number;
  summary: Summary;
};

export const INVOICE_TONE: Record<InvoiceStatus, 'neutral' | 'green' | 'red'> = {
  draft: 'neutral',
  approved: 'green',
  cancelled: 'red',
};
export const DELIVERY_TONE: Record<DeliveryStatus, 'neutral' | 'green' | 'gold' | 'red'> = {
  pending: 'neutral',
  delivered: 'green',
  partial: 'gold',
  failed: 'red',
};
export const TRIP_TONE: Record<TripStatus, 'neutral' | 'gold' | 'green'> = {
  planned: 'neutral',
  out: 'gold',
  done: 'green',
};

/** "12.5" → 12500 fils, or null. */
export function jodToFils(input: string): number | null {
  const v = input.replace(/[٠-٩]/g, (d) => String(t('٠١٢٣٤٥٦٧٨٩').indexOf(d))).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(v)) return null;
  return Math.round(Number(v) * 1000);
}
