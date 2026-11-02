import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { testEnv } from '../test/helpers.js';

const env = testEnv();
const database = createDb(env.DATABASE_URL);
const base = {
  env,
  db: database.db,
  mailer: { send: async () => {} },
  google: null,
  version: 'test',
};
afterAll(async () => database.close());
beforeAll(() => {});

describe('GET /api/health', () => {
  it('returns ok when the database is up', async () => {
    const res = await request(createApp({ ...base, pingDb: async () => true })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: { status: 'ok', database: 'up' } });
  });

  it('returns 503 when the database is down', async () => {
    const res = await request(createApp({ ...base, pingDb: async () => false })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.data.database).toBe('down');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(createApp({ ...base, pingDb: async () => true })).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
