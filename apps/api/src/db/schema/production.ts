import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { PRODUCTION_DAY_STATUSES, STOCK_LOSS_KINDS, STOCK_LOSS_REASONS } from '@mecca/shared';
import { timestamps } from './common.js';
import { items } from './items.js';
import { users } from './users.js';

/** Production lines (e.g. bread line, pastry line). Item sections are assigned to a line. */
export const productionLines = pgTable(
  'production_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('production_lines_name_unique').on(t.name)],
);

/** Delivery vehicles. Loading is recorded per vehicle; routes and drivers come in phase 4. */
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    plate: text('plate'),
    driverName: text('driver_name'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('vehicles_name_unique').on(t.name)],
);

/** One production day per delivery date. */
export const productionDays = pgTable(
  'production_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
    status: text('status', { enum: PRODUCTION_DAY_STATUSES }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [uniqueIndex('production_days_date_unique').on(t.deliveryDate)],
);

/**
 * Plan line per item: ordered (from orders) + extra (manual) = planned.
 * produced is entered by production staff.
 */
export const productionItems = pgTable(
  'production_items',
  {
    dayId: uuid('day_id')
      .notNull()
      .references(() => productionDays.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    orderedQty: integer('ordered_qty').notNull().default(0),
    extraQty: integer('extra_qty').notNull().default(0),
    producedQty: integer('produced_qty'),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.dayId, t.itemId] })],
);

/** Quantity of an item loaded on a vehicle for the day. */
export const vehicleLoads = pgTable(
  'vehicle_loads',
  {
    dayId: uuid('day_id')
      .notNull()
      .references(() => productionDays.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
  },
  (t) => [primaryKey({ columns: [t.dayId, t.vehicleId, t.itemId] })],
);

/** Waste in the bakery and returns from customers, with a reason. */
export const stockLosses = pgTable(
  'stock_losses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    dayId: uuid('day_id')
      .notNull()
      .references(() => productionDays.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: STOCK_LOSS_KINDS }).notNull(),
    reason: text('reason', { enum: STOCK_LOSS_REASONS }).notNull(),
    quantity: integer('quantity').notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('stock_losses_day_idx').on(t.dayId)],
);

/** A manager's approval of an item's variance for the day (needs variances.approve). */
export const varianceApprovals = pgTable(
  'variance_approvals',
  {
    dayId: uuid('day_id')
      .notNull()
      .references(() => productionDays.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    note: text('note').notNull(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.dayId, t.itemId] })],
);
