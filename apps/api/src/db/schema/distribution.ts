import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { DELIVERY_REASONS, DELIVERY_STATUSES, PAYMENT_METHODS, TRIP_STATUSES } from '@mecca/shared';
import { timestamps } from './common.js';
import { branches } from './customers.js';
import { items } from './items.js';
import { orders } from './orders.js';
import { vehicles } from './production.js';
import { users } from './users.js';

/** A driver's daily route: which branches, in what order, with which car. */
export const routes = pgTable(
  'routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    driverId: uuid('driver_id').references(() => users.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('routes_name_unique').on(t.name)],
);

/** A branch belongs to at most one route. */
export const routeStops = pgTable(
  'route_stops',
  {
    branchId: uuid('branch_id')
      .primaryKey()
      .references(() => branches.id, { onDelete: 'cascade' }),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('route_stops_route_idx').on(t.routeId)],
);

/** One route on one delivery date. Driver and car are copied so later changes don't rewrite history. */
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id').references(() => users.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    status: text('status', { enum: TRIP_STATUSES }).notNull().default('planned'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('trips_date_route_unique').on(t.deliveryDate, t.routeId),
    index('trips_driver_idx').on(t.driverId, t.deliveryDate),
  ],
);

/** The delivery of one order. Location is recorded only at the moment of confirmation. */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    position: integer('position').notNull().default(0),
    status: text('status', { enum: DELIVERY_STATUSES }).notNull().default('pending'),
    failReason: text('fail_reason', { enum: DELIVERY_REASONS }),
    receiverName: text('receiver_name'),
    /** Signature drawn on the phone, as SVG path data. */
    signatureSvg: text('signature_svg'),
    /** Time on the phone when the driver confirmed (may be earlier than syncing). */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    accuracyM: doublePrecision('accuracy_m'),
    collectedAmount: integer('collected_amount').notNull().default(0),
    collectedMethod: text('collected_method', { enum: PAYMENT_METHODS }),
    note: text('note'),
    /** Id generated on the phone; makes offline re-sends safe. */
    clientRef: text('client_ref'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('deliveries_order_unique').on(t.orderId),
    uniqueIndex('deliveries_client_ref_unique').on(t.clientRef),
    index('deliveries_trip_idx').on(t.tripId),
  ],
);

/** Per item: ordered, delivered (short = ordered − delivered) and returned by the customer. */
export const deliveryLines = pgTable(
  'delivery_lines',
  {
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    orderedQty: integer('ordered_qty').notNull(),
    deliveredQty: integer('delivered_qty').notNull().default(0),
    shortReason: text('short_reason', { enum: DELIVERY_REASONS }),
    returnedQty: integer('returned_qty').notNull().default(0),
    returnReason: text('return_reason', { enum: DELIVERY_REASONS }),
  },
  (t) => [primaryKey({ columns: [t.deliveryId, t.itemId] })],
);
