import { sql } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadEnv, type Env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { users } from '../src/db/schema/index.js';
import type { Mail } from '../src/lib/mailer.js';
import type { GoogleIdentity } from '../src/modules/auth/google.js';
import type { Role } from '@mecca/shared';

/**
 * Integration tests run against a real PostgreSQL database.
 * Set TEST_DATABASE_URL, or create the default one with: createdb mecca_bakeries_test
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/mecca_bakeries_test';

export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123',
    OTP_PEPPER: 'test-pepper-test-pepper',
    GOOGLE_CLIENT_IDS: 'test-client-id',
    UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'mecca-uploads-')),
    ...overrides,
  });
}

export async function setupTestApp(envOverrides: Partial<Record<keyof Env, string>> = {}) {
  const env = testEnv(envOverrides);
  await runMigrations(env.DATABASE_URL);
  const database = createDb(env.DATABASE_URL);
  const sent: Mail[] = [];
  const googleIdentities = new Map<string, GoogleIdentity>();
  let clock = new Date();

  const whatsappSent: { path: string; body: unknown }[] = [];
  const pushSent: { to: string; title: string; body: string }[] = [];
  const app = createApp({
    env,
    db: database.db,
    pingDb: database.ping,
    version: 'test',
    mailer: { send: async (m) => void sent.push(m) },
    google: async (token) => {
      const id = googleIdentities.get(token);
      if (!id) throw new Error('bad token');
      return id;
    },
    now: () => clock,
    whatsappTransport: async (path, body) => {
      whatsappSent.push({ path, body });
      return { ok: true, messageId: `wamid.${whatsappSent.length}` };
    },
    pushTransport: async (messages) => void pushSent.push(...messages),
  });

  return {
    app,
    db: database.db,
    sent,
    googleIdentities,
    whatsappSent,
    pushSent,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
    /** Sets the clock to an instant, e.g. "2026-11-10T18:00:00Z" (= 21:00 in Amman). */
    setClock: (iso: string) => (clock = new Date(iso)),
    async reset() {
      await database.db.execute(
        sql`TRUNCATE purchase_order_lines, purchase_orders, suppliers, variance_approvals, stock_losses, vehicle_loads, production_items, production_days, vehicles, production_lines, whatsapp_messages, order_events, order_items, orders, push_tokens, scheduler_runs, app_settings, contract_attachments, contract_prices, contracts, items, item_sections, branches, customers, customer_categories, trade_names, files, audit_logs, sessions, otp_codes, user_permission_overrides, users RESTART IDENTITY CASCADE`,
      );
      await database.db.execute(sql`ALTER SEQUENCE customer_code_seq RESTART WITH 1`);
      await database.db.execute(sql`ALTER SEQUENCE item_code_seq RESTART WITH 1`);
      await database.db.execute(sql`ALTER SEQUENCE contract_number_seq RESTART WITH 1`);
      await database.db.execute(sql`ALTER SEQUENCE order_number_seq RESTART WITH 1`);
      await database.db.execute(sql`ALTER SEQUENCE purchase_order_number_seq RESTART WITH 1`);
      whatsappSent.length = 0;
      pushSent.length = 0;
      sent.length = 0;
      googleIdentities.clear();
      clock = new Date();
    },
    async createUser(email: string, role: Role = 'super_admin', name = 'Test User') {
      const [u] = await database.db.insert(users).values({ email, name, role }).returning();
      return u!;
    },
    /** Logs in through the real OTP flow and returns the tokens. */
    async login(email: string) {
      await request(app).post('/api/auth/otp/request').send({ email }).expect(200);
      const code = sent.at(-1)?.text.match(/\d{6}/)?.[0];
      if (!code) throw new Error('No OTP email captured');
      const res = await request(app).post('/api/auth/otp/verify').send({ email, code }).expect(200);
      return res.body.data as { accessToken: string; refreshToken: string };
    },
    /** Logs in a fresh user with the given role and returns the access token. */
    async tokenFor(role: Role, email = `${role}@example.com`) {
      await this.createUser(email, role);
      return (await this.login(email)).accessToken;
    },
    close: database.close,
  };
}

export type TestApp = Awaited<ReturnType<typeof setupTestApp>>;
