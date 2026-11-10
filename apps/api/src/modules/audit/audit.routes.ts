import { Router, type RequestHandler } from 'express';
import { and, desc, eq, gte, ilike, lt, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { ammanToUtc } from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { auditLogs, users } from '../../db/schema/index.js';
import { requirePermission } from '../../middleware/auth.js';
import { isoDate } from '../../lib/validation.js';

const Query = z.object({
  entity: z.string().max(50).optional(),
  entityId: z.string().max(100).optional(),
  userId: z.string().uuid().optional(),
  action: z.string().max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Older than this id, for "show more". */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Who changed what and when. Read-only: nothing in the system can edit or delete these rows. */
export function auditRouter(db: Db, authenticate: RequestHandler): Router {
  const router = Router();
  router.get('/', authenticate, requirePermission('audit.view'), async (req, res) => {
    const q = Query.parse(req.query);
    const filters: SQL[] = [];
    if (q.entity) filters.push(eq(auditLogs.entity, q.entity));
    if (q.entityId) filters.push(eq(auditLogs.entityId, q.entityId));
    if (q.userId) filters.push(eq(auditLogs.userId, q.userId));
    if (q.action) filters.push(ilike(auditLogs.action, `${q.action}%`));
    if (q.from) filters.push(gte(auditLogs.createdAt, ammanToUtc(q.from, '00:00')));
    if (q.to) filters.push(lte(auditLogs.createdAt, ammanToUtc(q.to, '23:59')));
    if (q.before) filters.push(lt(auditLogs.id, q.before));
    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        before: auditLogs.before,
        after: auditLogs.after,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
        userId: auditLogs.userId,
        userName: sql<
          string | null
        >`coalesce(${users.name}, case when ${auditLogs.ip} = 'scheduler' then 'النظام (مهمة مجدولة)' end)`,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLogs.id))
      .limit(q.limit);
    res.json({ ok: true, data: rows });
  });
  return router;
}
