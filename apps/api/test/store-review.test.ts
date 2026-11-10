import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await setupTestApp({ STORE_REVIEW_EMAIL: 'review@example.com', STORE_REVIEW_CODE: '246810' });
});
afterAll(async () => t.close());
beforeEach(async () => t.reset());

const login = (email: string, code: string) =>
  request(t.app).post('/api/auth/otp/verify').send({ email, code });

describe('store review login', () => {
  it('lets the review restaurant account in with the fixed code, without an email', async () => {
    await t.createUser('review@example.com', 'restaurant');
    await request(t.app)
      .post('/api/auth/otp/request')
      .send({ email: 'review@example.com' })
      .expect(200);
    expect(t.sent).toHaveLength(0);
    await login('review@example.com', '111111').expect(401);
    const ok = await login('review@example.com', '246810').expect(200);
    expect(ok.body.data.user.role).toBe('restaurant');
  });

  it('never works for staff accounts', async () => {
    await t.createUser('review@example.com', 'super_admin');
    await request(t.app)
      .post('/api/auth/otp/request')
      .send({ email: 'review@example.com' })
      .expect(200);
    expect(t.sent).toHaveLength(1);
    await login('review@example.com', '246810').expect(401);
  });
});
