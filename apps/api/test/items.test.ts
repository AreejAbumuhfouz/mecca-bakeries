import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { desc } from 'drizzle-orm';
import { applyDiscount, filsToJodString, parseJod, parsePercentToBps } from '@mecca/shared';
import { auditLogs } from '../src/db/schema/index.js';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  admin = await t.tokenFor('super_admin', 'admin@example.com');
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const post = (path: string, body: object, token = admin) =>
  request(t.app).post(path).set(auth(token)).send(body);
const patch = (path: string, body: object, token = admin) =>
  request(t.app).patch(path).set(auth(token)).send(body);

async function section(name = 'خبز', sortOrder = 0) {
  return (await post('/api/items/sections', { name, sortOrder }).expect(201)).body.data as {
    id: string;
  };
}

describe('money helpers', () => {
  it('parses and formats JOD as integer fils', () => {
    expect(parseJod('1.250')).toBe(1250);
    expect(parseJod('0.35')).toBe(350);
    expect(parseJod('12')).toBe(12000);
    expect(parseJod('١٫٥'.replace('٫', '.'))).toBe(1500);
    expect(parseJod('1.2345')).toBeNull();
    expect(parseJod('abc')).toBeNull();
    expect(filsToJodString(1250)).toBe('1.250');
    expect(filsToJodString(5)).toBe('0.005');
    expect(applyDiscount(1000, 750)).toBe(925);
    expect(applyDiscount(333, 1000)).toBe(300);
    expect(parsePercentToBps('7.5')).toBe(750);
    expect(parsePercentToBps('101')).toBeNull();
  });
});

describe('items API', () => {
  it('creates items with automatic codes, ordered by section then item', async () => {
    const pastry = await section('معجنات', 2);
    const bread = await section('خبز', 1);
    const a = await post('/api/items', {
      name: 'خبز عربي كبير',
      sectionId: bread.id,
      unit: 'bag',
      basePrice: 350,
    }).expect(201);
    expect(a.body.data).toMatchObject({ code: 'I0001', basePrice: 350, unit: 'bag' });
    await post('/api/items', {
      name: 'كرواسان زبدة',
      sectionId: pastry.id,
      unit: 'piece',
      basePrice: 250,
    }).expect(201);
    await post('/api/items', {
      name: 'صمون',
      code: 'sam-1',
      sectionId: bread.id,
      unit: 'piece',
      basePrice: 50,
    }).expect(201);

    const list = await request(t.app).get('/api/items').set(auth(admin)).expect(200);
    // Section order first (خبز before معجنات), then name (خبز عربي before صمون).
    expect(list.body.data.items.map((i: { code: string }) => i.code)).toEqual([
      'I0001',
      'SAM-1',
      'I0002',
    ]);
    expect(list.body.data.items[0].sectionName).toBe('خبز');

    const sections = await request(t.app).get('/api/items/sections').set(auth(admin)).expect(200);
    expect(sections.body.data.map((s: { itemCount: number }) => s.itemCount)).toEqual([2, 1]);
  });

  it('filters by search, section and status', async () => {
    const bread = await section();
    const sweets = await section('حلويات');
    await post('/api/items', {
      name: 'خبز عربي',
      sectionId: bread.id,
      unit: 'bag',
      basePrice: 350,
    });
    const k = await post('/api/items', {
      name: 'كنافة',
      sectionId: sweets.id,
      unit: 'tray',
      basePrice: 12000,
    });
    await patch(`/api/items/${k.body.data.id}`, { isActive: false }).expect(200);

    const q = (qs: string) => request(t.app).get(`/api/items?${qs}`).set(auth(admin)).expect(200);
    expect((await q('search=عربي')).body.data.total).toBe(1);
    expect((await q(`sectionId=${sweets.id}`)).body.data.total).toBe(1);
    expect((await q('isActive=true')).body.data.total).toBe(1);
  });

  it('validates input and keeps codes unique', async () => {
    const bread = await section();
    const base = { name: 'خبز', sectionId: bread.id, unit: 'bag', basePrice: 350 };
    await post('/api/items', { ...base, code: 'B1' }).expect(201);
    expect((await post('/api/items', { ...base, code: 'b1' })).body.error.code).toBe('CODE_TAKEN');
    await post('/api/items', { ...base, basePrice: 0.35 }).expect(400);
    await post('/api/items', { ...base, basePrice: -1 }).expect(400);
    await post('/api/items', { ...base, unit: 'litre' }).expect(400);
    const bad = await post('/api/items', {
      ...base,
      sectionId: '00000000-0000-4000-8000-000000000000',
    });
    expect(bad.body.error.code).toBe('BAD_SECTION');
    await post('/api/items/sections', { name: 'خبز' }).expect(409);
  });

  it('records price changes in the audit log with before and after', async () => {
    const bread = await section();
    const item = await post('/api/items', {
      name: 'خبز',
      sectionId: bread.id,
      unit: 'bag',
      basePrice: 350,
    });
    await patch(`/api/items/${item.body.data.id}`, { basePrice: 400 }).expect(200);
    const [log] = await t.db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
    expect(log!.action).toBe('item.price_change');
    expect(log!.before).toMatchObject({ basePrice: 350 });
    expect(log!.after).toMatchObject({ basePrice: 400 });
  });

  it('lets purchasing view but not manage; drivers see nothing', async () => {
    const purchasing = await t.tokenFor('purchasing');
    await request(t.app).get('/api/items').set(auth(purchasing)).expect(200);
    await post('/api/items/sections', { name: 'قسم' }, purchasing).expect(403);
    const driver = await t.tokenFor('driver');
    await request(t.app).get('/api/items').set(auth(driver)).expect(403);
  });
});
