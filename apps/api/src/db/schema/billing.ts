import {
  bigserial,
  date,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from 'drizzle-orm/pg-core';
import {
  INVOICE_KINDS,
  INVOICE_LINE_KINDS,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_SOURCES,
  PAYMENT_STATUSES,
} from '@mecca/shared';
import { timestamps } from './common.js';
import { branches, customers } from './customers.js';
import { items } from './items.js';
import { orders } from './orders.js';
import { tradeNames } from './trade-names.js';
import { users } from './users.js';
import { deliveries } from './distribution.js';

/**
 * Invoice for what was actually delivered, under the customer's trade name and that
 * trade name's own number sequence. Approved invoices are locked; changing one needs
 * `invoices.edit_locked` and leaves a revision with the reason.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    kind: text('kind', { enum: INVOICE_KINDS }).notNull().default('sale'),
    tradeNameId: uuid('trade_name_id').references(() => tradeNames.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    deliveryId: uuid('delivery_id').references(() => deliveries.id, { onDelete: 'set null' }),
    issueDate: date('issue_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('draft'),
    /** Sales at list price (before the contract discount). */
    grossTotal: integer('gross_total').notNull().default(0),
    /** First discount: the contract's general discount, already inside line prices. */
    discount1Amount: integer('discount1_amount').notNull().default(0),
    /** Second discount on the invoice, in basis points. */
    discount2Bps: integer('discount2_bps').notNull().default(0),
    discount2Amount: integer('discount2_amount').notNull().default(0),
    returnsTotal: integer('returns_total').notNull().default(0),
    /** Net amount owed, in fils. */
    total: integer('total').notNull().default(0),
    notes: text('notes'),
    /** Things for the accountant to check, e.g. returns above the contract limit. */
    flags: jsonb('flags').$type<string[]>().notNull().default([]),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('invoices_number_unique').on(t.number),
    uniqueIndex('invoices_order_unique').on(t.orderId),
    index('invoices_customer_idx').on(t.customerId, t.issueDate),
    index('invoices_issue_date_idx').on(t.issueDate),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind', { enum: INVOICE_LINE_KINDS }).notNull().default('sale'),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    unit: text('unit'),
    quantity: integer('quantity').notNull(),
    /** Price before the contract discount (equals unitPrice for special prices). */
    listPrice: integer('list_price').notNull(),
    unitPrice: integer('unit_price').notNull(),
    /** Positive for sales, negative for returns. */
    lineTotal: integer('line_total').notNull(),
  },
  (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId)],
);

/** Who changed an approved invoice, why, and what it looked like before and after. */
export const invoiceRevisions = pgTable(
  'invoice_revisions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    before: jsonb('before').notNull(),
    after: jsonb('after').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invoice_revisions_invoice_idx').on(t.invoiceId)],
);

/** Feeds receipt numbers RC-000001 … */
export const paymentNumberSeq = pgSequence('payment_number_seq', { startWith: 1 });

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    amount: integer('amount').notNull(),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    source: text('source', { enum: PAYMENT_SOURCES }).notNull().default('office'),
    receivedOn: date('received_on', { mode: 'string' }).notNull(),
    /** Cheque number or transfer reference. */
    reference: text('reference'),
    chequeDueDate: date('cheque_due_date', { mode: 'string' }),
    deliveryId: uuid('delivery_id').references(() => deliveries.id, { onDelete: 'set null' }),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('received'),
    cancelReason: text('cancel_reason'),
    note: text('note'),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payments_number_unique').on(t.number),
    uniqueIndex('payments_delivery_unique').on(t.deliveryId),
    index('payments_customer_idx').on(t.customerId, t.receivedOn),
  ],
);

/**
 * How a payment is spread over invoices. `manual` rows were chosen by a person and are
 * kept; the rest are recalculated oldest-invoice-first whenever money or invoices change.
 */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    manual: boolean('manual').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId, t.invoiceId] }),
    index('payment_allocations_invoice_idx').on(t.invoiceId),
  ],
);
