import { boolean, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './common.js';
import { files } from './files.js';

/**
 * A name the bakery invoices under. Each has its own logo, contact data and
 * an independent invoice number sequence (prefix + running number).
 */
export const tradeNames = pgTable(
  'trade_names',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    logoFileId: uuid('logo_file_id').references(() => files.id, { onDelete: 'set null' }),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    invoicePrefix: text('invoice_prefix').notNull(),
    /** The number the next invoice will get. Only moves forward. */
    nextInvoiceNumber: integer('next_invoice_number').notNull().default(1),
    invoiceFooter: text('invoice_footer'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('trade_names_name_unique').on(t.name),
    uniqueIndex('trade_names_invoice_prefix_unique').on(t.invoicePrefix),
  ],
);
