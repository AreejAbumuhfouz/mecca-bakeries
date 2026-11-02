import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { desc } from 'drizzle-orm';
import { auditLogs } from '../src/db/schema/index.js';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let adminToken: string;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.createUser('admin@example.com', 'super_admin', 'Admin');
  adminToken = (await t.login('admin@example.com')).accessToken;
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('users API', () => {
  it('lets a super admin create, list and update users, with audit rows', async () => {
    const created = await request(t.app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: 'Clerk@Example.com',
        name: 'موظف الطلبات',
        role: 'orders',
        phone: '0791234567',
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      email: 'clerk@example.com',
      role: 'orders',
      isActive: true,
    });
    const id = created.body.data.id as string;

    const list = await request(t.app)
      .get('/api/users?search=clerk')
      .set(auth(adminToken))
      .expect(200);
    expect(list.body.data.total).toBe(1);

    const updated = await request(t.app)
      .patch(`/api/users/${id}`)
      .set(auth(adminToken))
      .send({ name: 'موظف الطلبات 1', overrides: [{ permission: 'reports.view', allowed: false }] })
      .expect(200);
    expect(updated.body.data.name).toBe('موظف الطلبات 1');
    expect(updated.body.data.overrides).toEqual([{ permission: 'reports.view', allowed: false }]);

    const logs = await t.db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(2);
    expect(logs.map((l) => l.action)).toEqual(['user.update', 'user.create']);
    expect(logs[0]!.before).toMatchObject({ name: 'موظف الطلبات' });
    expect(logs[0]!.after).toMatchObject({ name: 'موظف الطلبات 1' });
  });

  it('applies permission overrides to the user', async () => {
    const res = await request(t.app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: 'acc@example.com', name: 'Accountant', role: 'accountant' })
      .expect(201);
    await request(t.app)
      .patch(`/api/users/${res.body.data.id}`)
      .set(auth(adminToken))
      .send({
        overrides: [
          { permission: 'users.view', allowed: true },
          { permission: 'reports.view', allowed: false },
        ],
      })
      .expect(200);
    const token = (await t.login('acc@example.com')).accessToken;
    const me = await request(t.app).get('/api/auth/me').set(auth(token)).expect(200);
    expect(me.body.data.permissions).toContain('users.view');
    expect(me.body.data.permissions).not.toContain('reports.view');
    await request(t.app).get('/api/users').set(auth(token)).expect(200);
    await request(t.app)
      .post('/api/users')
      .set(auth(token))
      .send({ email: 'x@example.com', name: 'X', role: 'driver' })
      .expect(403);
  });

  it('forbids users without permission', async () => {
    await t.createUser('driver@example.com', 'driver');
    const token = (await t.login('driver@example.com')).accessToken;
    const res = await request(t.app).get('/api/users').set(auth(token)).expect(403);
    expect(res.body.error.details.missing).toEqual(['users.view']);
  });

  it('validates input and rejects duplicate emails', async () => {
    await request(t.app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: 'bad', name: 'X', role: 'nope' })
      .expect(400);
    await request(t.app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: 'admin@example.com', name: 'Dup', role: 'orders' })
      .expect(409);
  });

  it('never allows removing the last active super admin', async () => {
    const me = await request(t.app).get('/api/auth/me').set(auth(adminToken));
    await request(t.app)
      .patch(`/api/users/${me.body.data.id}`)
      .set(auth(adminToken))
      .send({ isActive: false })
      .expect(409);
    await request(t.app)
      .patch(`/api/users/${me.body.data.id}`)
      .set(auth(adminToken))
      .send({ role: 'orders' })
      .expect(409);
  });

  it('exposes the audit log to super admins only', async () => {
    const res = await request(t.app)
      .get('/api/audit?entity=user')
      .set(auth(adminToken))
      .expect(200);
    expect(res.body.data[0].action).toBe('auth.login');
    await t.createUser('prod@example.com', 'production');
    const token = (await t.login('prod@example.com')).accessToken;
    await request(t.app).get('/api/audit').set(auth(token)).expect(403);
  });
});
