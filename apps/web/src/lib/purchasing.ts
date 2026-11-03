import type { PurchaseOrderStatus } from '@mecca/shared';

export type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  orderCount: number;
};

export type PoRow = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  neededDate: string | null;
  lineCount: number;
  createdAt: string;
  sentAt: string | null;
};

export type PoLine = { description: string; quantity: string; unit: string; note: string | null };

export type PurchaseOrder = Omit<PoRow, 'supplierName' | 'lineCount'> & {
  notes: string | null;
  supplier: Omit<Supplier, 'orderCount'>;
  lines: PoLine[];
  createdByName: string | null;
  messages: {
    id: string;
    status: string;
    error: string | null;
    createdAt: string;
    phone: string;
  }[];
  delivered?: boolean;
};

export const PO_TONE: Record<PurchaseOrderStatus, 'neutral' | 'gold' | 'green' | 'red'> = {
  draft: 'neutral',
  sent: 'gold',
  confirmed: 'gold',
  received: 'green',
  cancelled: 'red',
};

/** Common purchase units for the line form. */
export const COMMON_UNITS = ['كغ', 'كيس', 'كرتونة', 'علبة', 'لتر', 'حبة', 'ربطة', 'رول'];
