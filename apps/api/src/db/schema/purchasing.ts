import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { PURCHASE_ORDER_STATUSES } from '@mecca/shared';
import { timestamps } from './common.js';
import { users } from './users.js';
import { whatsappMessages } from './messages.js';

/** Feeds purchase order numbers PO-0001 … */
export const purchaseOrderNumberSeq = pgSequence('purchase_order_number_seq', { startWith: 1 });

/** Suppliers the bakery buys from (purchase orders are sent to their WhatsApp number). */
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    phone: text('phone'),
    whatsappPhone: text('whatsapp_phone'),
    address: text('address'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('suppliers_name_unique').on(t.name)],
);

/**
 * A purchase order to a supplier. Lines are free text (what to buy, quantity, unit):
 * raw-material inventory and recipes are outside the agreed scope.
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    status: text('status', { enum: PURCHASE_ORDER_STATUSES }).notNull().default('draft'),
    neededDate: date('needed_date', { mode: 'string' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastMessageId: uuid('last_message_id').references(() => whatsappMessages.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('purchase_orders_number_unique').on(t.number),
    index('purchase_orders_supplier_idx').on(t.supplierId),
  ],
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    note: text('note'),
  },
  (t) => [index('purchase_order_lines_po_idx').on(t.purchaseOrderId)],
);
