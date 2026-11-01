import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

const env = { CORS_ORIGINS: ['http://localhost:3000'], NODE_ENV: 'test' as const };

describe('GET /api/health', () => {
  it('returns ok when the database is up', async () => {
    const app = createApp({ env, version: 'test', pingDb: async () => true });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: { status: 'ok', database: 'up' } });
  });

  it('returns 503 when the database is down', async () => {
    const app = createApp({ env, version: 'test', pingDb: async () => false });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.data.database).toBe('down');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const app = createApp({ env, version: 'test', pingDb: async () => true });
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
