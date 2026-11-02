import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { asc } from 'drizzle-orm';
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
  await t.createUser('admin@example.com', 'super_admin', 'Admin');
  admin = (await t.login('admin@example.com')).accessToken;
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const post = (path: string, body: object, token = admin) =>
  request(t.app).post(path).set(auth(token)).send(body);
const patch = (path: string, body: object, token = admin) =>
  request(t.app).patch(path).set(auth(token)).send(body);
const get = (path: string, token = admin) => request(t.app).get(path).set(auth(token));

describe('customers API', () => {
  it('creates customers with automatic codes and a main branch', async () => {
    const a = await post('/api/customers', {
      name: 'مطعم الريم',
      phone: '0791111111',
      address: 'عمّان - الصويفية',
    }).expect(201);
    expect(a.body.data).toMatchObject({ code: 'C0001', name: 'مطعم الريم', branchSeq: 1 });
    expect(a.body.data.branches).toHaveLength(1);
    expect(a.body.data.branches[0]).toMatchObject({
      code: 'C0001-01',
      name: 'الفرع الرئيسي',
      address: 'عمّان - الصويفية',
      phone: '0791111111',
    });

    const b = await post('/api/customers', { name: 'فندق النخيل', createMainBranch: false });
    expect(b.status).toBe(201);
    expect(b.body.data.code).toBe('C0002');
    expect(b.body.data.branches).toEqual([]);
  });

  it('accepts a manual code, rejects duplicates and skips taken automatic codes', async () => {
    await post('/api/customers', { name: 'عميل يدوي', code: 'c0001' }).expect(201);
    const dup = await post('/api/customers', { name: 'آخر', code: 'C0001' }).expect(409);
    expect(dup.body.error.code).toBe('CODE_TAKEN');
    const auto = await post('/api/customers', { name: 'تلقائي' }).expect(201);
    expect(auto.body.data.code).toBe('C0002');
  });

  it('adds branches with sequential codes that are never reused', async () => {
    const c = await post('/api/customers', { name: 'مطعم السلطان' }).expect(201);
    const id = c.body.data.id as string;
    const b2 = await post(`/api/customers/${id}/branches`, {
      name: 'فرع خلدا',
      deliveryNotes: 'التسليم من الباب الخلفي',
    }).expect(201);
    expect(b2.body.data.code).toBe('C0001-02');

    await patch(`/api/customers/${id}/branches/${b2.body.data.id}`, { isActive: false }).expect(
      200,
    );
    const b3 = await post(`/api/customers/${id}/branches`, { name: 'فرع عبدون' }).expect(201);
    expect(b3.body.data.code).toBe('C0001-03');

    const detail = await get(`/api/customers/${id}`).expect(200);
    expect(detail.body.data.branches.map((b: { code: string }) => b.code)).toEqual([
      'C0001-01',
      'C0001-02',
      'C0001-03',
    ]);
    expect(detail.body.data.branches[1].isActive).toBe(false);
  });

  it('updates a customer branch only through its own customer', async () => {
    const a = await post('/api/customers', { name: 'أ' + 'لف' }).expect(201);
    const b = await post('/api/customers', { name: 'باء' }).expect(201);
    const branchOfA = a.body.data.branches[0].id as string;
    await patch(`/api/customers/${b.body.data.id}/branches/${branchOfA}`, {
      name: 'تغيير',
    }).expect(404);
  });

  it('lists with search, category filter, status filter and branch counts', async () => {
    const cat = await post('/api/customers/categories', { name: 'فنادق' }).expect(201);
    await post('/api/customers', { name: 'مطعم الريم', phone: '0791111111' }).expect(201);
    await post('/api/customers', { name: 'فندق النخيل', categoryId: cat.body.data.id }).expect(201);
    const off = await post('/api/customers', { name: 'مطعم مغلق' }).expect(201);
    await patch(`/api/customers/${off.body.data.id}`, { isActive: false }).expect(200);

    const all = await get('/api/customers').expect(200);
    expect(all.body.data.total).toBe(3);
    expect(all.body.data.items[0]).toMatchObject({ code: 'C0001', branchCount: 1 });

    const byPhone = await get('/api/customers?search=07911').expect(200);
    expect(byPhone.body.data.items.map((c: { name: string }) => c.name)).toEqual(['مطعم الريم']);

    const byCat = await get(`/api/customers?categoryId=${cat.body.data.id}`).expect(200);
    expect(byCat.body.data.items).toHaveLength(1);
    expect(byCat.body.data.items[0].categoryName).toBe('فنادق');

    const active = await get('/api/customers?isActive=true').expect(200);
    expect(active.body.data.total).toBe(2);
  });

  it('rejects an unknown category and invalid input', async () => {
    const bad = await post('/api/customers', {
      name: 'عميل',
      categoryId: '00000000-0000-4000-8000-000000000000',
    }).expect(400);
    expect(bad.body.error.code).toBe('BAD_CATEGORY');
    await post('/api/customers', { name: 'x' }).expect(400);
    await post('/api/customers', { name: 'عميل', code: 'كود عربي' }).expect(400);
    await post('/api/customers', { name: 'عميل', phone: 'abc' }).expect(400);
  });

  it('manages categories with unique names', async () => {
    const c = await post('/api/customers/categories', { name: 'مطاعم' }).expect(201);
    await post('/api/customers/categories', { name: 'مطاعم' }).expect(409);
    await patch(`/api/customers/categories/${c.body.data.id}`, { name: 'مطاعم ومقاهي' }).expect(
      200,
    );
    const list = await get('/api/customers/categories').expect(200);
    expect(list.body.data.map((x: { name: string }) => x.name)).toEqual(['مطاعم ومقاهي']);
  });

  it('writes an audit row for every change', async () => {
    const c = await post('/api/customers', { name: 'مطعم الريم' }).expect(201);
    await patch(`/api/customers/${c.body.data.id}`, { name: 'مطعم الريم الجديد' }).expect(200);
    const logs = await t.db.select().from(auditLogs).orderBy(asc(auditLogs.id));
    const actions = logs.map((l) => l.action).filter((a) => !a.startsWith('auth.'));
    expect(actions).toEqual(['customer.create', 'branch.create', 'customer.update']);
    const upd = logs.at(-1)!;
    expect(upd.before).toMatchObject({ name: 'مطعم الريم' });
    expect(upd.after).toMatchObject({ name: 'مطعم الريم الجديد' });
  });

  it('enforces permissions: accountant can view, not manage; driver cannot view', async () => {
    await t.createUser('acc@example.com', 'accountant');
    await t.createUser('drv@example.com', 'driver');
    const acc = (await t.login('acc@example.com')).accessToken;
    const drv = (await t.login('drv@example.com')).accessToken;
    await get('/api/customers', acc).expect(200);
    await post('/api/customers', { name: 'عميل' }, acc).expect(403);
    await get('/api/customers', drv).expect(403);
  });
});
