import {
  boolean,
  date,
  index,
  integer,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CONTRACT_STATUSES, PAYMENT_TYPES } from '@mecca/shared';
import { timestamps } from './users.js';
import { customers } from './customers.js';
import { items } from './items.js';
import { files } from './files.js';

/** Feeds contract numbers CT-0001 … */
export const contractNumberSeq = pgSequence('contract_number_seq', { startWith: 1 });

/**
 * The commercial terms agreed with a customer for a period: special prices, a general
 * discount, credit limit, payment terms and returns policy.
 * A customer has at most one non-terminated contract for any given day.
 */
export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    status: text('status', { enum: CONTRACT_STATUSES }).notNull().default('active'),
    paymentType: text('payment_type', { enum: PAYMENT_TYPES }).notNull().default('credit'),
    /** Maximum unpaid balance in fils (credit contracts). */
    creditLimit: integer('credit_limit').notNull().default(0),
    /** Invoice due date = invoice date + this many days. */
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    /** Orders are blocked once an invoice is overdue by more than this many days. */
    overdueGraceDays: integer('overdue_grace_days').notNull().default(0),
    /** General discount in basis points (100 = 1%) for items without a special price. */
    discountBps: integer('discount_bps').notNull().default(0),
    allowReturns: boolean('allow_returns').notNull().default(false),
    /** Maximum returns as basis points of the delivered quantity. */
    maxReturnBps: integer('max_return_bps').notNull().default(0),
    returnsNotes: text('returns_notes'),
    /** Show a renewal alert this many days before the end date. */
    renewalAlertDays: integer('renewal_alert_days').notNull().default(30),
    notes: text('notes'),
    /** Set when this contract was created by renewing another one. */
    renewedFromId: uuid('renewed_from_id'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('contracts_number_unique').on(t.number),
    index('contracts_customer_idx').on(t.customerId),
    index('contracts_end_date_idx').on(t.endDate),
  ],
);

/** Special price of an item under a contract, in fils. Overrides the base price and discount. */
export const contractPrices = pgTable(
  'contract_prices',
  {
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    price: integer('price').notNull(),
  },
  (t) => [primaryKey({ columns: [t.contractId, t.itemId] })],
);

/** Scanned contract, IDs, commercial registration … (private files). */
export const contractAttachments = pgTable(
  'contract_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contract_attachments_contract_idx').on(t.contractId)],
);
