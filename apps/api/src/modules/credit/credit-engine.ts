import {
  addDays,
  applyDiscount,
  contractState,
  formatJod,
  isContractInForce,
  type ContractState,
  type ContractStatus,
  type PaymentType,
} from '@mecca/shared';
import { t } from '../../lib/i18n.js';

/**
 * Credit rules engine (pure, no database).
 * Decides whether a customer may place an order of a given amount today.
 * Every blocking reason can be overridden by a user with `credit.override`.
 */

export type CreditContract = {
  status: ContractStatus;
  startDate: string;
  endDate: string;
  renewalAlertDays: number;
  paymentType: PaymentType;
  creditLimit: number;
  overdueGraceDays: number;
};

/** An unpaid (or partly paid) invoice. `balance` is what is still owed, in fils. */
export type OpenInvoice = { balance: number; dueDate: string };

export type CreditReasonCode =
  | 'NO_CONTRACT'
  | 'CONTRACT_NOT_STARTED'
  | 'CONTRACT_EXPIRED'
  | 'CONTRACT_SUSPENDED'
  | 'CONTRACT_TERMINATED'
  | 'OVERDUE_DEBT'
  | 'CREDIT_LIMIT_EXCEEDED';

export type CreditReason = { code: CreditReasonCode; message: string };

export type CreditInput = {
  today: string;
  contract: CreditContract | null;
  openInvoices: OpenInvoice[];
  /** Amount of the order being placed, in fils (0 to just check the status). */
  orderAmount: number;
};

export type CreditDecision = {
  allowed: boolean;
  contractState: ContractState | null;
  outstanding: number;
  overdueAmount: number;
  /** Remaining credit before this order (credit contracts only). */
  available: number | null;
  reasons: CreditReason[];
};

const STATE_REASONS: Partial<Record<ContractState, CreditReason>> = {
  not_started: { code: 'CONTRACT_NOT_STARTED', message: 'العقد لم يبدأ بعد' },
  expired: { code: 'CONTRACT_EXPIRED', message: 'العقد منتهي ويحتاج إلى تجديد' },
  suspended: { code: 'CONTRACT_SUSPENDED', message: 'العقد موقوف' },
  terminated: { code: 'CONTRACT_TERMINATED', message: 'العقد ملغى' },
};

export function evaluateCredit(input: CreditInput): CreditDecision {
  const { today, contract, openInvoices, orderAmount } = input;
  const outstanding = openInvoices.reduce((sum, i) => sum + Math.max(0, i.balance), 0);

  if (!contract) {
    return {
      allowed: false,
      contractState: null,
      outstanding,
      overdueAmount: 0,
      available: null,
      reasons: [{ code: 'NO_CONTRACT', message: t('لا يوجد عقد لهذا العميل') }],
    };
  }

  const reasons: CreditReason[] = [];
  const state = contractState(contract, today);
  const stateReason = STATE_REASONS[state];
  if (stateReason && !isContractInForce(state)) reasons.push(stateReason);

  // Overdue: still owed after due date + grace days.
  const overdue = openInvoices.filter(
    (i) => i.balance > 0 && addDays(i.dueDate, contract.overdueGraceDays) < today,
  );
  const overdueAmount = overdue.reduce((sum, i) => sum + i.balance, 0);
  if (overdueAmount > 0) {
    reasons.push({
      code: 'OVERDUE_DEBT',
      message: t('يوجد ذمم متأخرة بقيمة {0}', formatJod(overdueAmount)),
    });
  }

  let available: number | null = null;
  if (contract.paymentType === 'credit') {
    available = contract.creditLimit - outstanding;
    if (outstanding + orderAmount > contract.creditLimit) {
      reasons.push({
        code: 'CREDIT_LIMIT_EXCEEDED',
        message: t('الطلب يتجاوز سقف الائتمان (المتاح {0})', formatJod(Math.max(0, available))),
      });
    }
  }

  return {
    allowed: reasons.length === 0,
    contractState: state,
    outstanding,
    overdueAmount,
    available,
    reasons,
  };
}

export type PriceSource = 'contract' | 'discount' | 'base';

/** Price a customer pays for one unit: special contract price, else base price minus discount. */
export function effectivePrice(
  basePrice: number,
  specialPrice: number | undefined,
  discountBps: number,
): { price: number; source: PriceSource } {
  if (specialPrice !== undefined) return { price: specialPrice, source: 'contract' };
  if (discountBps > 0) return { price: applyDiscount(basePrice, discountBps), source: 'discount' };
  return { price: basePrice, source: 'base' };
}
