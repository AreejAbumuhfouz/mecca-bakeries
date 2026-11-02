import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Uploaded files (trade name logos, item images, contract attachments).
 * The bytes live on disk under UPLOAD_DIR; public files (logos, item images) can be
 * loaded without a login, private ones (attachments) need an authenticated user.
 */
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  storageKey: text('storage_key').notNull(),
  isPublic: boolean('is_public').notNull().default(false),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
