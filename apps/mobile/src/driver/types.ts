import type {
  DeliveryReason,
  DeliveryStatus,
  PaymentMethod,
  PaymentType,
  TripStatus,
} from '@mecca/shared';

export type StopItem = {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  unitLabel: string;
  quantity: number;
  unitPrice: number;
};

export type Stop = {
  deliveryId: string;
  position: number;
  status: DeliveryStatus;
  order: { id: string; number: string; total: number; notes: string | null };
  customer: { id: string; code: string; name: string; phone: string | null };
  branch: { id: string; name: string; address: string | null; phone: string | null };
  paymentType: PaymentType;
  allowReturns: boolean;
  maxReturnBps: number;
  balance: number;
  items: StopItem[];
  result: {
    receiverName: string | null;
    deliveredAt: string | null;
    collectedAmount: number;
    invoice: { id: string; number: string; total: number } | null;
  } | null;
};

export type Trip = {
  id: string;
  deliveryDate: string;
  status: TripStatus;
  route: { id: string; name: string };
  driver: { id: string; name: string } | null;
  vehicle: { id: string; name: string; plate: string | null } | null;
  stops: Stop[];
};

export type DriverDay = {
  date: string;
  trips: Trip[];
  catalog: { id: string; code: string; name: string; unit: string; unitLabel: string }[];
};

export type Confirmation = {
  clientRef: string;
  outcome: 'delivered' | 'failed';
  failReason?: DeliveryReason | null;
  lines: {
    itemId: string;
    deliveredQty: number;
    shortReason?: DeliveryReason | null;
    returnedQty: number;
    returnReason?: DeliveryReason | null;
  }[];
  receiverName?: string | null;
  signature?: { width: number; height: number; paths: string[] } | null;
  deliveredAt: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  collected?: { amount: number; method: PaymentMethod; reference?: string | null } | null;
  note?: string | null;
};

/** A confirmation waiting to reach the server. `error` is set when the server refused it. */
export type Queued = {
  deliveryId: string;
  confirmation: Confirmation;
  label: string;
  queuedAt: string;
  error?: { code: string; message: string };
};
