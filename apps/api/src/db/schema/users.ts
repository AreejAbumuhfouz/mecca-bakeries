import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ROLE_VALUES } from '@mecca/shared';
import { timestamps } from './common.js';
import { customers } from './customers.js';

/** Dashboard staff, restaurants and drivers. Accounts are created by an admin (no self sign-up). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    role: text('role', { enum: ROLE_VALUES }).notNull(),
    /** Restaurant accounts: the customer they order for (all of its branches). */
    // Typed explicitly: users → customers → trade names → files → users is a reference cycle.
    customerId: uuid('customer_id').references((): AnyPgColumn => customers.id, {
      onDelete: 'restrict',
    }),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

/** Per-user grant (allowed=true) or deny (allowed=false) on top of the role defaults. */
export const userPermissionOverrides = pgTable(
  'user_permission_overrides',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    allowed: boolean('allowed').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permission] })],
);

/** One-time login codes sent by email. Only the hash is stored. */
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('otp_codes_email_created_idx').on(t.email, t.createdAt)],
);

/** Refresh-token sessions. Rotated on every refresh; only the hash is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);
