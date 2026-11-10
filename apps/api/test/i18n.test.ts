import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { EN, translate } from '@mecca/shared';
import { setupTestApp, type TestApp } from './helpers.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let t: TestApp;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => t.reset());

describe('English', () => {
  it('has a translation for every Arabic text in the apps', () => {
    const { allKeys } = require(path.join(root, 'scripts/i18n/extract.cjs')) as {
      allKeys: () => string[];
    };
    const missing = allKeys().filter((k) => !(k in EN));
    expect(missing).toEqual([]);
  });

  it('keeps the {0} placeholders of each text', () => {
    const bad = Object.entries(EN).filter(([ar, en]) => {
      const holes = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
      return holes(ar) !== holes(en);
    });
    expect(bad).toEqual([]);
  });

  it('fills values in either language', () => {
    expect(translate('ar', 'أهلاً {0}', ['أريج'])).toBe('أهلاً أريج');
    expect(translate('en', 'أهلاً {0}', ['Areej'])).toBe('Welcome, Areej');
    expect(translate('en', 'نص غير مترجم')).toBe('نص غير مترجم');
  });

  it('answers in the language the request asks for', async () => {
    const token = await t.tokenFor('super_admin');
    const ar = await request(t.app)
      .get('/api/customers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(ar.body.error.message).toBe('لم يتم العثور على العميل');
    const en = await request(t.app)
      .get('/api/customers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Locale', 'en')
      .expect(404);
    expect(en.body.error.message).toBe('Customer not found');
    const unauth = await request(t.app).get('/api/customers').set('X-Locale', 'en').expect(401);
    expect(unauth.body.error.message).toBe('Please sign in');
  });

  it('saves the user language and returns it at login', async () => {
    const token = await t.tokenFor('orders', 'lang@example.com');
    await request(t.app)
      .patch('/api/auth/me/locale')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'en' })
      .expect(200);
    const me = await request(t.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.data.locale).toBe('en');
    await request(t.app)
      .patch('/api/auth/me/locale')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'fr' })
      .expect(400);
  });

  it('translates report titles and columns', async () => {
    const token = await t.tokenFor('super_admin');
    const res = await request(t.app)
      .get('/api/reports/sales')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Locale', 'en')
      .expect(200);
    expect(res.body.data.title).toMatch(/^[A-Za-z]/);
    for (const c of res.body.data.columns as { label: string }[])
      expect(c.label).not.toMatch(/[؀-ۿ]/);
  });
});
