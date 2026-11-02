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
import { ITEM_UNITS } from '@mecca/shared';
import { timestamps } from './users.js';
import { files } from './files.js';

/** Feeds automatic item codes (I0001 …) when no code is entered. */
export const itemCodeSeq = pgSequence('item_code_seq', { startWith: 1 });

/** Catalogue sections (bread, pastries, sweets …). Ordered for the app catalogue. */
export const itemSections = pgTable(
  'item_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('item_sections_name_unique').on(t.name)],
);

/** A product the bakery sells. basePrice is the list price before any contract price. */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => itemSections.id, { onDelete: 'restrict' }),
    unit: text('unit', { enum: ITEM_UNITS }).notNull(),
    /** List price in fils (1 JOD = 1000 fils). */
    basePrice: integer('base_price').notNull(),
    imageFileId: uuid('image_file_id').references(() => files.id, { onDelete: 'set null' }),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('items_code_unique').on(t.code),
    index('items_section_idx').on(t.sectionId),
    index('items_name_idx').on(t.name),
  ],
);
