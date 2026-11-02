import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { desc } from 'drizzle-orm';
import { addDays, ammanDate } from '@mecca/shared';
import { auditLogs } from '../src/db/schema/index.js';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
let customerId: string;
let breadId: string;
let croissantId: string;
const today = () => ammanDate();

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  admin = await t.tokenFor('super_admin', 'admin@example.com');
  customerId = (await post('/api/customers', { name: 'مطعم الريم' })).body.data.id;
  const section = (await post('/api/items/sections', { name: 'خبز' })).body.data.id;
  breadId = (
    await post('/api/items', { name: 'خبز عربي', sectionId: section, unit: 'bag', basePrice: 350 })
  ).body.data.id;
  croissantId = (
    await post('/api/items', {
      name: 'كرواسان',
      sectionId: section,
      unit: 'piece',
      basePrice: 1000,
    })
  ).body.data.id;
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
function post(path: string, body: object, token = admin) {
  return request(t.app).post(path).set(auth(token)).send(body);
}
const get = (path: string, token = admin) => request(t.app).get(path).set(auth(token));

const terms = (over: object = {}) => ({
  customerId,
  startDate: addDays(today(), -10),
  endDate: addDays(today(), 355),
  paymentType: 'credit',
  creditLimit: 500_000,
  paymentTermsDays: 30,
  overdueGraceDays: 0,
  discountBps: 1000,
  allowReturns: true,
  maxReturnBps: 500,
  renewalAlertDays: 30,
  ...over,
});

describe('contracts API', () => {
  it('creates a contract with special prices and numbers it CT-0001', async () => {
    const res = await post('/api/contracts', {
      ...terms(),
      prices: [{ itemId: breadId, price: 300 }],
    }).expect(201);
    expect(res.body.data).toMatchObject({
      number: 'CT-0001',
      state: 'active',
      creditLimit: 500_000,
    });

    const detail = await get(`/api/contracts/${res.body.data.id}`).expect(200);
    expect(detail.body.data.customer.name).toBe('مطعم الريم');
    expect(detail.body.data.prices).toEqual([
      expect.objectContaining({ itemId: breadId, price: 300, basePrice: 350 }),
    ]);
  });

  it('builds the price list: special price, else base minus discount', async () => {
    const c = await post('/api/contracts', {
      ...terms({ discountBps: 1000 }),
      prices: [{ itemId: breadId, price: 300 }],
    });
    const list = await get(`/api/contracts/${c.body.data.id}/price-list`).expect(200);
    const byId = Object.fromEntries(
      list.body.data.map((r: { id: string; price: number; source: string }) => [r.id, r]),
    );
    expect(byId[breadId]).toMatchObject({ price: 300, source: 'contract' });
    expect(byId[croissantId]).toMatchObject({ price: 900, source: 'discount' });
  });

  it('rejects overlapping contracts but allows back-to-back and after termination', async () => {
    const first = await post('/api/contracts', terms()).expect(201);
    const overlap = await post('/api/contracts', terms({ startDate: today() })).expect(409);
    expect(overlap.body.error.code).toBe('CONTRACT_OVERLAP');

    const next = terms({
      startDate: addDays(today(), 356),
      endDate: addDays(today(), 720),
    });
    await post('/api/contracts', next).expect(201);

    await request(t.app)
      .patch(`/api/contracts/${first.body.data.id}`)
      .set(auth(admin))
      .send({ status: 'terminated' })
      .expect(200);
    await post(
      '/api/contracts',
      terms({ startDate: today(), endDate: addDays(today(), 30) }),
    ).expect(201);
  });

  it('validates dates, items and amounts', async () => {
    expect(
      (await post('/api/contracts', terms({ endDate: addDays(today(), -20) }))).body.error.code,
    ).toBe('BAD_DATES');
    await post('/api/contracts', terms({ creditLimit: 12.5 })).expect(400);
    await post('/api/contracts', terms({ discountBps: 20_000 })).expect(400);
    await post('/api/contracts', terms({ startDate: '2026-02-30x' })).expect(400);
    const dup = await post('/api/contracts', {
      ...terms(),
      prices: [
        { itemId: breadId, price: 300 },
        { itemId: breadId, price: 310 },
      ],
    });
    expect(dup.body.error.code).toBe('DUPLICATE_ITEM');
  });

  it('replaces special prices and audits before/after', async () => {
    const c = await post('/api/contracts', {
      ...terms(),
      prices: [{ itemId: breadId, price: 300 }],
    });
    const res = await request(t.app)
      .put(`/api/contracts/${c.body.data.id}/prices`)
      .set(auth(admin))
      .send([{ itemId: croissantId, price: 800 }])
      .expect(200);
    expect(res.body.data.map((p: { itemId: string }) => p.itemId)).toEqual([croissantId]);
    const [log] = await t.db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
    expect(log!.action).toBe('contract.prices');
    expect(log!.before).toEqual({ prices: [{ itemId: breadId, price: 300 }] });
  });

  it('renews a contract with the same terms and prices from the next day', async () => {
    const c = await post('/api/contracts', {
      ...terms({ endDate: addDays(today(), 10) }),
      prices: [{ itemId: breadId, price: 300 }],
    });
    const renewed = await post(`/api/contracts/${c.body.data.id}/renew`, {
      endDate: addDays(today(), 375),
    }).expect(201);
    expect(renewed.body.data).toMatchObject({
      number: 'CT-0002',
      startDate: addDays(today(), 11),
      renewedFromId: c.body.data.id,
      creditLimit: 500_000,
      state: 'not_started',
    });
    const detail = await get(`/api/contracts/${renewed.body.data.id}`);
    expect(detail.body.data.prices).toHaveLength(1);
  });

  it('filters by state and lists renewal alerts (renewed contracts drop out)', async () => {
    const other = (await post('/api/customers', { name: 'فندق النخيل' })).body.data.id;
    const expiring = await post('/api/contracts', terms({ endDate: addDays(today(), 10) }));
    await post(
      '/api/contracts',
      terms({
        customerId: other,
        startDate: addDays(today(), -400),
        endDate: addDays(today(), -5),
      }),
    );

    const state = async (s: string) =>
      (await get(`/api/contracts?state=${s}`)).body.data.items.map(
        (c: { customerName: string }) => c.customerName,
      );
    expect(await state('expiring')).toEqual(['مطعم الريم']);
    expect(await state('expired')).toEqual(['فندق النخيل']);
    expect(await state('active')).toEqual([]);

    const alerts = await get('/api/contracts/renewal-alerts').expect(200);
    expect(alerts.body.data.map((a: { state: string }) => a.state).sort()).toEqual([
      'expired',
      'expiring',
    ]);

    await post(`/api/contracts/${expiring.body.data.id}/renew`, { endDate: addDays(today(), 400) });
    const after = await get('/api/contracts/renewal-alerts');
    expect(after.body.data.map((a: { customerName: string }) => a.customerName)).toEqual([
      'فندق النخيل',
    ]);
  });

  it('runs the credit check against the current contract', async () => {
    const none = await get(`/api/contracts/credit-check?customerId=${customerId}`).expect(200);
    expect(none.body.data).toMatchObject({ allowed: false, contract: null });
    expect(none.body.data.reasons[0].code).toBe('NO_CONTRACT');

    await post('/api/contracts', terms({ creditLimit: 100_000 }));
    const ok = await get(`/api/contracts/credit-check?customerId=${customerId}&orderAmount=100000`);
    expect(ok.body.data).toMatchObject({ allowed: true, available: 100_000 });
    const over = await get(
      `/api/contracts/credit-check?customerId=${customerId}&orderAmount=100001`,
    );
    expect(over.body.data.reasons.map((r: { code: string }) => r.code)).toEqual([
      'CREDIT_LIMIT_EXCEEDED',
    ]);
  });

  it('adds private attachments and removes them', async () => {
    const c = await post('/api/contracts', terms());
    const file = await request(t.app)
      .post('/api/files')
      .set(auth(admin))
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const att = await post(`/api/contracts/${c.body.data.id}/attachments`, {
      fileId: file.body.data.id,
      label: 'العقد الموقّع',
    }).expect(201);
    let detail = await get(`/api/contracts/${c.body.data.id}`);
    expect(detail.body.data.attachments[0]).toMatchObject({
      label: 'العقد الموقّع',
      fileName: 'contract.pdf',
    });
    await request(t.app)
      .delete(`/api/contracts/${c.body.data.id}/attachments/${att.body.data.id}`)
      .set(auth(admin))
      .expect(200);
    detail = await get(`/api/contracts/${c.body.data.id}`);
    expect(detail.body.data.attachments).toEqual([]);
  });

  it('lets accountants read contracts but not change them', async () => {
    const acc = await t.tokenFor('accountant');
    await get('/api/contracts', acc).expect(200);
    await post('/api/contracts', terms(), acc).expect(403);
    const driver = await t.tokenFor('driver');
    await get('/api/contracts', driver).expect(403);
  });
});
