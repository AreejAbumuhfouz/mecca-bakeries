import { Router } from 'express';
import type { ApiSuccess, HealthStatus } from '@mecca/shared';

export type DbPing = () => Promise<boolean>;

const startedAt = Date.now();

export function healthRouter(pingDb: DbPing, version: string): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const dbUp = await pingDb().catch(() => false);
    const data: HealthStatus = {
      status: dbUp ? 'ok' : 'degraded',
      version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      database: dbUp ? 'up' : 'down',
    };
    const body: ApiSuccess<HealthStatus> = { ok: true, data };
    res.status(dbUp ? 200 : 503).json(body);
  });
  return router;
}
