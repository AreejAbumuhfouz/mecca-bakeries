import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { auditLogs, otpCodes, users } from '../src/db/schema/index.js';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => t.reset());

const codeFrom = (text?: string) => text?.match(/\d{6}/)?.[0];

describe('email OTP login', () => {
  it('sends a code to an existing user and logs in with it', async () => {
    await t.createUser('owner@example.com');
    await request(t.app)
      .post('/api/auth/otp/request')
      .send({ email: 'Owner@Example.com ' })
      .expect(200);

    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.to).toBe('owner@example.com');
    const code = codeFrom(t.sent[0]!.text)!;

    const res = await request(t.app)
      .post('/api/auth/otp/verify')
      .send({ email: 'owner@example.com', code })
      .expect(200);
    expect(res.body.data.user).toMatchObject({ email: 'owner@example.com', role: 'super_admin' });
    expect(res.body.data.user.permissions).toContain('users.manage');
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']?.[0]).toMatch(/mb_refresh=.*HttpOnly/i);

    const [stored] = await t.db.select().from(otpCodes);
    expect(stored!.codeHash).not.toContain(code); // only the hash is stored
    expect(stored!.consumedAt).not.toBeNull();
  });

  it('does not reveal whether an email exists', async () => {
    const res = await request(t.app)
      .post('/api/auth/otp/request')
      .send({ email: 'nobody@example.com' })
      .expect(200);
    expect(res.body).toEqual({ ok: true, data: { sent: true } });
    expect(t.sent).toHaveLength(0);
  });

  it('rejects wrong, reused and expired codes', async () => {
    await t.createUser('a@example.com');
    await request(t.app).post('/api/auth/otp/request').send({ email: 'a@example.com' });
    const code = codeFrom(t.sent[0]!.text)!;
    const wrong = code === '000000' ? '111111' : '000000';

    await request(t.app)
      .post('/api/auth/otp/verify')
      .send({ email: 'a@example.com', code: wrong })
      .expect(401);
    await request(t.app)
      .post('/api/auth/otp/verify')
      .send({ email: 'a@example.com', code })
      .expect(200);
    await request(t.app)
      .post('/api/auth/otp/verify')
      .send({ email: 'a@example.com', code })
      .expect(401); // reused

    await request(t.app).post('/api/auth/otp/request').send({ email: 'a@example.com' });
    const code2 = codeFrom(t.sent[1]!.text)!;
    t.advance(11 * 60_000); // past the 10 minute TTL
    await request(t.app)
      .post('/api/auth/otp/verify')
      .send({ email: 'a@example.com', code: code2 })
      .expect(401);
  });

  it('locks a code after too many wrong attempts', async () => {
    await t.createUser('b@example.com');
    await request(t.app).post('/api/auth/otp/request').send({ email: 'b@example.com' });
    const code = codeFrom(t.sent[0]!.text)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await request(t.app)
        .post('/api/auth/otp/verify')
        .send({ email: 'b@example.com', code: wrong })
        .expect(401);
    }
    await request(t.app)
      .post('/api/auth/otp/verify')
      .send({ email: 'b@example.com', code })
      .expect(401);
  });

  it('limits how many codes can be requested per email', async () => {
    await t.createUser('c@example.com');
    for (let i = 0; i < 5; i++)
      await request(t.app)
        .post('/api/auth/otp/request')
        .send({ email: 'c@example.com' })
        .expect(200);
    await request(t.app).post('/api/auth/otp/request').send({ email: 'c@example.com' }).expect(429);
    t.advance(16 * 60_000);
    await request(t.app).post('/api/auth/otp/request').send({ email: 'c@example.com' }).expect(200);
  });

  it('refuses disabled accounts', async () => {
    const u = await t.createUser('off@example.com');
    await t.db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    await request(t.app)
      .post('/api/auth/otp/request')
      .send({ email: 'off@example.com' })
      .expect(200);
    expect(t.sent).toHaveLength(0);
  });

  it('writes an audit row for each login', async () => {
    const u = await t.createUser('d@example.com');
    await t.login('d@example.com');
    const rows = await t.db.select().from(auditLogs).where(eq(auditLogs.userId, u.id));
    expect(rows.map((r) => r.action)).toEqual(['auth.login']);
  });
});

describe('Google login', () => {
  it('logs in an existing user with a verified Google email', async () => {
    await t.createUser('g@gmail.com', 'accountant');
    t.googleIdentities.set('good-google-token-123456', {
      email: 'g@gmail.com',
      emailVerified: true,
    });
    const res = await request(t.app)
      .post('/api/auth/google')
      .send({ idToken: 'good-google-token-123456' })
      .expect(200);
    expect(res.body.data.user.role).toBe('accountant');
  });

  it('rejects unknown emails and invalid tokens', async () => {
    t.googleIdentities.set('stranger-token-12345678', {
      email: 'stranger@gmail.com',
      emailVerified: true,
    });
    await request(t.app)
      .post('/api/auth/google')
      .send({ idToken: 'stranger-token-12345678' })
      .expect(403);
    await request(t.app)
      .post('/api/auth/google')
      .send({ idToken: 'invalid-token-1234567890' })
      .expect(401);
  });
});

describe('sessions', () => {
  it('returns the current user for a valid access token', async () => {
    await t.createUser('me@example.com', 'orders', 'Orders Clerk');
    const { accessToken } = await t.login('me@example.com');
    const res = await request(t.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.data).toMatchObject({
      email: 'me@example.com',
      name: 'Orders Clerk',
      role: 'orders',
    });
    await request(t.app).get('/api/auth/me').expect(401);
    await request(t.app).get('/api/auth/me').set('Authorization', 'Bearer nonsense').expect(401);
  });

  it('rotates refresh tokens and rejects the old one', async () => {
    await t.createUser('r@example.com');
    const first = await t.login('r@example.com');
    const res = await request(t.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(res.body.data.refreshToken).not.toBe(first.refreshToken);
    await request(t.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
  });

  it('accepts the refresh token from the httpOnly cookie (dashboard)', async () => {
    await t.createUser('cookie@example.com');
    const agent = request.agent(t.app);
    await agent.post('/api/auth/otp/request').send({ email: 'cookie@example.com' });
    const code = codeFrom(t.sent.at(-1)!.text)!;
    await agent
      .post('/api/auth/otp/verify')
      .send({ email: 'cookie@example.com', code })
      .expect(200);
    await agent.post('/api/auth/refresh').send({}).expect(200);
  });

  it('logout revokes the session', async () => {
    await t.createUser('l@example.com');
    const { refreshToken } = await t.login('l@example.com');
    await request(t.app).post('/api/auth/logout').send({ refreshToken }).expect(200);
    await request(t.app).post('/api/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('cuts off a user immediately when disabled', async () => {
    const u = await t.createUser('cut@example.com', 'orders');
    const { accessToken } = await t.login('cut@example.com');
    await t.db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    await request(t.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });
});
