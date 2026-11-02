import {
  boolean,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './users.js';
import { tradeNames } from './trade-names.js';

/** Feeds automatic customer codes (C0001, C0002 …) when no code is entered. */
export const customerCodeSeq = pgSequence('customer_code_seq', { startWith: 1 });

/** Customer groups used for filtering and reports (e.g. restaurants, hotels, markets). */
export const customerCategories = pgTable(
  'customer_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('customer_categories_name_unique').on(t.name)],
);

/** A customer (restaurant / company) that buys from the bakery. Never hard-deleted. */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    categoryId: uuid('category_id').references(() => customerCategories.id, {
      onDelete: 'set null',
    }),
    /** The trade name this customer is invoiced under. */
    tradeNameId: uuid('trade_name_id').references(() => tradeNames.id, { onDelete: 'restrict' }),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    city: text('city'),
    address: text('address'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    /** Last branch number used, so branch codes are never reused. */
    branchSeq: integer('branch_seq').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('customers_code_unique').on(t.code),
    index('customers_name_idx').on(t.name),
    index('customers_category_idx').on(t.categoryId),
    index('customers_trade_name_idx').on(t.tradeNameId),
  ],
);

/** A delivery location of a customer. Orders and deliveries are per branch. */
export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    phone: text('phone'),
    city: text('city'),
    address: text('address'),
    deliveryNotes: text('delivery_notes'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('branches_code_unique').on(t.code),
    index('branches_customer_idx').on(t.customerId),
  ],
);
