import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { customers } from './customers.js';
import { orders } from './orders.js';
import { users } from './users.js';

/**
 * WhatsApp message log, both directions.
 * Outgoing status: queued → sent → delivered → read, or failed / skipped (WhatsApp not configured).
 * Incoming messages have status "received".
 */
export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    direction: text('direction', { enum: ['out', 'in'] }).notNull(),
    phone: text('phone').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    template: text('template'),
    body: text('body').notNull(),
    status: text('status', {
      enum: ['queued', 'skipped', 'sent', 'delivered', 'read', 'failed', 'received'],
    }).notNull(),
    waMessageId: text('wa_message_id'),
    error: text('error'),
    sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('whatsapp_messages_wa_id_unique').on(t.waMessageId),
    index('whatsapp_messages_phone_idx').on(t.phone),
    index('whatsapp_messages_customer_idx').on(t.customerId),
    index('whatsapp_messages_created_idx').on(t.createdAt),
  ],
);
