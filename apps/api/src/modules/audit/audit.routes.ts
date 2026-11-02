import { Router, type RequestHandler } from 'express';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { auditLogs } from '../../db/schema/index.js';
import { requirePermission } from '../../middleware/auth.js';

const Query = z.object({
  entity: z.string().max(50).optional(),
  entityId: z.string().max(100).optional(),
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function auditRouter(db: Db, authenticate: RequestHandler): Router {
  const router = Router();
  router.get('/', authenticate, requirePermission('audit.view'), async (req, res) => {
    const q = Query.parse(req.query);
    const filters: SQL[] = [];
    if (q.entity) filters.push(eq(auditLogs.entity, q.entity));
    if (q.entityId) filters.push(eq(auditLogs.entityId, q.entityId));
    if (q.userId) filters.push(eq(auditLogs.userId, q.userId));
    const rows = await db
      .select()
      .from(auditLogs)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLogs.id))
      .limit(q.limit);
    res.json({ ok: true, data: rows });
  });
  return router;
}
