import {
  bpsToPercentString,
  filsToJodString,
  parseJod,
  parsePercentToBps,
  type ContractState,
  type ContractStatus,
  type ItemUnit,
  type PaymentType,
} from '@mecca/shared';

export type ContractRow = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  startDate: string;
  endDate: string;
  status: ContractStatus;
  state: ContractState;
  paymentType: PaymentType;
  creditLimit: number;
  discountBps: number;
};

export type ContractPrice = {
  itemId: string;
  price: number;
  code: string;
  name: string;
  unit: ItemUnit;
  basePrice: number;
};

export type Attachment = {
  id: string;
  label: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type Contract = Omit<ContractRow, 'customerName' | 'customerCode'> & {
  paymentTermsDays: number;
  overdueGraceDays: number;
  allowReturns: boolean;
  maxReturnBps: number;
  returnsNotes: string | null;
  renewalAlertDays: number;
  notes: string | null;
  renewedFromId: string | null;
  customer: { id: string; code: string; name: string };
  prices: ContractPrice[];
  attachments: Attachment[];
};

/** The terms form works in what people type: JOD, percent, days. */
export type TermsForm = {
  startDate: string;
  endDate: string;
  paymentType: PaymentType;
  creditLimit: string;
  paymentTermsDays: string;
  overdueGraceDays: string;
  discount: string;
  allowReturns: boolean;
  maxReturn: string;
  returnsNotes: string;
  renewalAlertDays: string;
  notes: string;
};

export function emptyTerms(today: string): TermsForm {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    startDate: today,
    endDate: end.toISOString().slice(0, 10),
    paymentType: 'credit',
    creditLimit: '500',
    paymentTermsDays: '30',
    overdueGraceDays: '7',
    discount: '0',
    allowReturns: false,
    maxReturn: '0',
    returnsNotes: '',
    renewalAlertDays: '30',
    notes: '',
  };
}

export const termsToForm = (c: Contract): TermsForm => ({
  startDate: c.startDate,
  endDate: c.endDate,
  paymentType: c.paymentType,
  creditLimit: filsToJodString(c.creditLimit),
  paymentTermsDays: String(c.paymentTermsDays),
  overdueGraceDays: String(c.overdueGraceDays),
  discount: bpsToPercentString(c.discountBps),
  allowReturns: c.allowReturns,
  maxReturn: bpsToPercentString(c.maxReturnBps),
  returnsNotes: c.returnsNotes ?? '',
  renewalAlertDays: String(c.renewalAlertDays),
  notes: c.notes ?? '',
});

/** Converts the form to the API body, or returns an Arabic error message. */
export function termsToBody(f: TermsForm): Record<string, unknown> | string {
  const creditLimit = f.paymentType === 'cash' ? 0 : parseJod(f.creditLimit);
  if (creditLimit === null) return 'سقف الائتمان غير صالح';
  const discountBps = parsePercentToBps(f.discount || '0');
  if (discountBps === null) return 'نسبة الخصم غير صالحة';
  const maxReturnBps = f.allowReturns ? parsePercentToBps(f.maxReturn || '0') : 0;
  if (maxReturnBps === null) return 'نسبة المرتجعات غير صالحة';
  const int = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));
  return {
    startDate: f.startDate,
    endDate: f.endDate,
    paymentType: f.paymentType,
    creditLimit,
    paymentTermsDays: int(f.paymentTermsDays),
    overdueGraceDays: int(f.overdueGraceDays),
    discountBps,
    allowReturns: f.allowReturns,
    maxReturnBps,
    returnsNotes: f.returnsNotes.trim() || null,
    renewalAlertDays: int(f.renewalAlertDays),
    notes: f.notes.trim() || null,
  };
}

export const STATE_TONE: Record<ContractState, 'green' | 'gold' | 'red' | 'neutral'> = {
  active: 'green',
  expiring: 'gold',
  not_started: 'neutral',
  expired: 'red',
  suspended: 'red',
  terminated: 'neutral',
};
