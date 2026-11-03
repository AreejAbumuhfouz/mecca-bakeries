import { sql } from 'drizzle-orm';
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
} from 'drizzle-orm/pg-core';
import { ORDER_EVENT_TYPES, ORDER_SOURCES, ORDER_STATUSES } from '@mecca/shared';
import { timestamps } from './common.js';
import { branches, customers } from './customers.js';
import { contracts } from './contracts.js';
import { items } from './items.js';
import { users } from './users.js';

/** Feeds order numbers ORD-000001 … */
export const orderNumberSeq = pgSequence('order_number_seq', { startWith: 1 });

/** One order per branch per delivery date (while it is live). */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    /** The contract whose prices were used. */
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'restrict' }),
    deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
    status: text('status', { enum: ORDER_STATUSES }).notNull(),
    source: text('source', { enum: ORDER_SOURCES }).notNull(),
    /** Total in fils (sum of lines). */
    total: integer('total').notNull().default(0),
    itemCount: integer('item_count').notNull().default(0),
    notes: text('notes'),
    /** Credit reasons that put the order on hold: [{ code, message }]. */
    creditReasons: jsonb('credit_reasons').$type<{ code: string; message: string }[]>(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvalNote: text('approval_note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('orders_number_unique').on(t.number),
    // Duplicate prevention: one live order per branch per day.
    uniqueIndex('orders_branch_day_live_unique')
      .on(t.branchId, t.deliveryDate)
      .where(sql`status in ('draft','submitted','pending_approval','confirmed','delivered')`),
    index('orders_delivery_date_idx').on(t.deliveryDate),
    index('orders_customer_idx').on(t.customerId),
    index('orders_status_idx').on(t.status),
  ],
);

/** Order lines. Unit price is frozen when the line is saved. */
export const orderItems = pgTable(
  'order_items',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    priceSource: text('price_source').notNull(),
    lineTotal: integer('line_total').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.itemId] })],
);

/** Status history and change log of an order (who, when, what changed). */
export const orderEvents = pgTable(
  'order_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ORDER_EVENT_TYPES }).notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId)],
);

/** Expo push tokens of logged-in app users. */
export const pushTokens = pgTable(
  'push_tokens',
  {
    token: text('token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_tokens_user_idx').on(t.userId)],
);

/** One row per scheduled job run, so a job never runs twice for the same slot. */
export const schedulerRuns = pgTable(
  'scheduler_runs',
  {
    job: text('job').notNull(),
    runKey: text('run_key').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    result: jsonb('result'),
    error: text('error'),
  },
  (t) => [primaryKey({ columns: [t.job, t.runKey] })],
);
