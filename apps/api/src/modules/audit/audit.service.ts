import type { Db } from '../../db/client.js';
import { auditLogs } from '../../db/schema/index.js';

export type AuditContext = { userId: string | null; ip?: string | null; userAgent?: string | null };

export type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

/** Minimal shape shared by the db client and a transaction, so audit rows can be written inside transactions. */
type Executor = Pick<Db, 'insert'>;

const SENSITIVE_KEYS = new Set(['codeHash', 'tokenHash', 'password']);
const scrub = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !SENSITIVE_KEYS.has(k)));
};

export async function writeAudit(db: Executor, ctx: AuditContext, entry: AuditEntry) {
  await db.insert(auditLogs).values({
    userId: ctx.userId,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: scrub(entry.before),
    after: scrub(entry.after),
    reason: entry.reason ?? null,
  });
}
