import { daysBetween } from './dates.js';

export const CONTRACT_STATUSES = ['active', 'suspended', 'terminated'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** cash: paid on delivery, no credit limit. credit: invoiced with payment terms and a limit. */
export const PAYMENT_TYPES = ['credit', 'cash'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS_AR: Record<PaymentType, string> = {
  credit: 'آجل (ذمم)',
  cash: 'نقدي عند التسليم',
};

/** What a contract means today, combining its stored status with its dates. */
export const CONTRACT_STATES = [
  'active',
  'expiring',
  'not_started',
  'expired',
  'suspended',
  'terminated',
] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

export const CONTRACT_STATE_LABELS_AR: Record<ContractState, string> = {
  active: 'ساري',
  expiring: 'قارب على الانتهاء',
  not_started: 'لم يبدأ بعد',
  expired: 'منتهي',
  suspended: 'موقوف',
  terminated: 'ملغى',
};

export type ContractDates = {
  status: ContractStatus;
  startDate: string;
  endDate: string;
  renewalAlertDays: number;
};

export function contractState(c: ContractDates, today: string): ContractState {
  if (c.status === 'terminated') return 'terminated';
  if (c.status === 'suspended') return 'suspended';
  if (today < c.startDate) return 'not_started';
  if (today > c.endDate) return 'expired';
  return daysBetween(today, c.endDate) <= c.renewalAlertDays ? 'expiring' : 'active';
}

/** True while orders may be placed under the contract (subject to the credit rules). */
export const isContractInForce = (state: ContractState) =>
  state === 'active' || state === 'expiring';
