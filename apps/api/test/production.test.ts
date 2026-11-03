import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, type TestApp } from './helpers.js';
import { varianceFor } from '../src/modules/production/production.service.js';

let t: TestApp;
let admin: string;
let bread: string;
let croissant: string;
let branchA: string;
let branchB: string;

const EVENING = '2026-11-10T18:00:00Z'; // 21:00 Amman, ordering for the 11th
const AFTER_CUTOFF = '2026-11-11T00:05:00Z'; // 03:05 Amman on the 11th
const DAY = '2026-11-11';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = (
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  token = admin,
  body?: object,
) => {
  const r = request(t.app)[method](path).set(auth(token));
  return body ? r.send(body) : r;
};
type Row = {
  itemId: string;
  ordered: number;
  extra: number;
  planned: number;
  produced: number | null;
  loaded: number;
  waste: number;
  returned: number;
  leftover: number;
  reasons: string[];
  open: boolean;
};
const rowOf = (day: { items: Row[] }, itemId: string) =>
  day.items.find((i) => i.itemId === itemId)!;

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  t.setClock(EVENING);
  admin = await t.tokenFor('super_admin', 'admin@example.com');
  const section = (await api('post', '/api/items/sections', admin, { name: 'خبز' })).body.data.id;
  bread = (
    await api('post', '/api/items', admin, {
      name: 'خبز عربي',
      sectionId: section,
      unit: 'bag',
      basePrice: 350,
    })
  ).body.data.id;
  croissant = (
    await api('post', '/api/items', admin, {
      name: 'كرواسان',
      sectionId: section,
      unit: 'piece',
      basePrice: 1000,
    })
  ).body.data.id;
  const mk = async (name: string, limit: number) => {
    const c = (await api('post', '/api/customers', admin, { name })).body.data;
    await api('post', '/api/contracts', admin, {
      customerId: c.id,
      startDate: '2026-11-01',
      endDate: '2027-10-31',
      paymentType: 'credit',
      creditLimit: limit,
      paymentTermsDays: 30,
      overdueGraceDays: 0,
      discountBps: 0,
      allowReturns: true,
      maxReturnBps: 500,
      renewalAlertDays: 30,
    });
    return c.branches[0].id as string;
  };
  branchA = await mk('مطعم أ', 500_000);
  branchB = await mk('مطعم ب', 1_000); // tiny limit → held for approval
  await api('post', '/api/orders', admin, {
    branchId: branchA,
    lines: [
      { itemId: bread, quantity: 100 },
      { itemId: croissant, quantity: 40 },
    ],
  }).expect(201);
  await api('post', '/api/orders', admin, {
    branchId: branchB,
    lines: [{ itemId: bread, quantity: 50 }],
  }).expect(201);
});

describe('variance rules', () => {
  it('flags differences beyond the tolerance and impossible leftovers', () => {
    const base = { ordered: 100, planned: 100, produced: 100, loaded: 100, waste: 0, returned: 0 };
    expect(varianceFor(base, 200).needsApproval).toBe(false);
    expect(varianceFor({ ...base, produced: 102 }, 200).needsApproval).toBe(false); // within 2%
    expect(varianceFor({ ...base, produced: 103, loaded: 100 }, 200).reasons).toEqual([
      'إنتاج أكثر من المخطط',
    ]);
    expect(varianceFor({ ...base, loaded: 90 }, 200).reasons).toEqual(['تحميل أقل من المطلوب']);
    expect(varianceFor({ ...base, waste: 5 }, 200)).toMatchObject({
      leftover: -5,
      reasons: ['المحمّل والتالف أكثر من المنتج'],
    });
    expect(varianceFor({ ...base, produced: null }, 200).reasons).toEqual([
      'لم تُسجَّل الكمية المنتجة',
    ]);
  });
});

describe('production plan', () => {
  it('builds a preliminary plan from all live orders, then a final one from confirmed orders', async () => {
    const pre = (await api('post', `/api/production/days/${DAY}/generate`).expect(200)).body.data;
    expect(pre.status).toBe('preliminary');
    expect(rowOf(pre, bread)).toMatchObject({ ordered: 150, planned: 150 });
    expect(pre.pendingOrders).toBe(1);

    await api('patch', `/api/production/days/${DAY}/items`, admin, [
      { itemId: bread, extraQty: 10 },
    ]).expect(200);

    t.setClock(AFTER_CUTOFF);
    await t.app.scheduler.tick(); // cutoff: confirms orders and builds the final plan
    const fin = (await api('get', `/api/production/days/${DAY}`).expect(200)).body.data;
    expect(fin.status).toBe('final');
    // The held order (branch B) is not confirmed, so it is not in the final plan; the extra stays.
    expect(rowOf(fin, bread)).toMatchObject({ ordered: 100, extra: 10, planned: 110 });
    expect(rowOf(fin, croissant)).toMatchObject({ ordered: 40, planned: 40 });
  });

  it('records production, loading and waste; approves variances; closes the day', async () => {
    t.setClock(AFTER_CUTOFF);
    await t.app.scheduler.tick();
    const v1 = (
      await api('post', '/api/production/vehicles', admin, { name: 'سيارة 1', plate: '12-34567' })
    ).body.data.id;
    const v2 = (await api('post', '/api/production/vehicles', admin, { name: 'سيارة 2' })).body.data
      .id;

    await api('patch', `/api/production/days/${DAY}/items`, admin, [
      { itemId: bread, producedQty: 105 },
      { itemId: croissant, producedQty: 40 },
    ]).expect(200);
    await api('put', `/api/production/days/${DAY}/loads`, admin, {
      vehicleId: v1,
      lines: [
        { itemId: bread, quantity: 60 },
        { itemId: croissant, quantity: 40 },
      ],
    }).expect(200);
    await api('put', `/api/production/days/${DAY}/loads`, admin, {
      vehicleId: v2,
      lines: [{ itemId: bread, quantity: 40 }],
    }).expect(200);
    await api('post', `/api/production/days/${DAY}/losses`, admin, {
      itemId: bread,
      kind: 'waste',
      reason: 'burnt',
      quantity: 3,
    }).expect(201);
    const day = (
      await api('post', `/api/production/days/${DAY}/losses`, admin, {
        itemId: croissant,
        kind: 'return',
        reason: 'customer_refused',
        quantity: 2,
      }).expect(201)
    ).body.data;

    expect(rowOf(day, bread)).toMatchObject({
      produced: 105,
      loaded: 100,
      waste: 3,
      leftover: 2,
      open: true,
    });
    expect(rowOf(day, bread).reasons).toEqual(['إنتاج أكثر من المخطط']); // 105 vs 100 planned, 2% = 2
    expect(rowOf(day, croissant)).toMatchObject({ loaded: 40, returned: 2, open: false });

    const close1 = await api('post', `/api/production/days/${DAY}/close`).expect(409);
    expect(close1.body.error.code).toBe('OPEN_VARIANCES');

    const prod = await t.tokenFor('production');
    await api('post', `/api/production/days/${DAY}/variances/approve`, prod, {
      itemId: bread,
      note: 'زيادة احتياط',
    }).expect(403);
    await api('post', `/api/production/days/${DAY}/variances/approve`, admin, {
      itemId: croissant,
      note: 'لا يوجد',
    }).expect(409);
    await api('post', `/api/production/days/${DAY}/variances/approve`, admin, {
      itemId: bread,
      note: 'زيادة احتياط للطلبات المتأخرة',
    }).expect(200);

    const closed = (await api('post', `/api/production/days/${DAY}/close`).expect(200)).body.data;
    expect(closed.status).toBe('closed');
    const locked = await api('patch', `/api/production/days/${DAY}/items`, admin, [
      { itemId: bread, producedQty: 1 },
    ]).expect(409);
    expect(locked.body.error.code).toBe('DAY_CLOSED');

    const history = (
      await api('get', `/api/production/history?from=2026-11-01&to=2026-11-30`).expect(200)
    ).body.data;
    expect(history[0]).toMatchObject({
      deliveryDate: DAY,
      status: 'closed',
      produced: 145,
      loaded: 140,
      waste: 3,
      returned: 2,
    });
  });

  it('cannot close a preliminary plan', async () => {
    await api('post', `/api/production/days/${DAY}/generate`).expect(200);
    expect((await api('post', `/api/production/days/${DAY}/close`)).body.error.code).toBe(
      'NOT_FINAL',
    );
  });

  it('manages production lines and assigns sections to them', async () => {
    const line = (
      await api('post', '/api/production/lines', admin, { name: 'خط الخبز' }).expect(201)
    ).body.data;
    await api('post', '/api/production/lines', admin, { name: 'خط الخبز' }).expect(409);
    const sections = (await api('get', '/api/items/sections')).body.data;
    await api('patch', `/api/items/sections/${sections[0].id}`, admin, {
      productionLineId: line.id,
    }).expect(200);
    const lines = (await api('get', '/api/production/lines')).body.data;
    expect(lines[0]).toMatchObject({ name: 'خط الخبز', sectionCount: 1 });
    const plan = (await api('post', `/api/production/days/${DAY}/generate`)).body.data;
    expect(plan.items[0].lineName).toBe('خط الخبز');
  });

  it('keeps production screens away from roles without production rights', async () => {
    const clerk = await t.tokenFor('orders');
    await api('get', `/api/production/days/${DAY}`, clerk).expect(403);
    const prod = await t.tokenFor('production');
    await api('get', `/api/production/days/${DAY}`, prod).expect(200);
  });
});
