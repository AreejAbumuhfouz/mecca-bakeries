import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** Append-only log of every data-changing action: who, when, what, before/after. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // e.g. user.create, auth.login, contract.update
    entity: text('entity').notNull(), // e.g. user, contract
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entity, t.entityId),
    index('audit_created_idx').on(t.createdAt),
  ],
);
