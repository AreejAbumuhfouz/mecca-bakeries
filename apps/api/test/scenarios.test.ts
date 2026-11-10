/**
 * End-to-end scenarios: one working day through the whole system, the way the bakery
 * will run it — order → credit → cutoff → production → loading → delivery (offline sync)
 * → invoice → collection → receivables and reports — plus the awkward cases in between.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
let restaurant: string;
let driver: string;
let ids: Record<string, string>;

const DAY = '2026-11-11';
const call = (
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  token = admin,
  body?: object,
) => {
  const r = request(t.app)[method](path).set('Authorization', `Bearer ${token}`);
  return body ? r.send(body) : r;
};
let ref = 0;
const confirmation = (over: Record<string, unknown>) => ({
  clientRef: `phone-${++ref}-abcdefgh`,
  outcome: 'delivered',
  lines: [],
  receiverName: 'المستلم',
  deliveredAt: '2026-11-11T06:00:00Z',
  latitude: 31.95,
  longitude: 35.9,
  ...over,
});

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());

beforeEach(async () => {
  await t.reset();
  t.setClock('2026-11-10T15:00:00Z'); // 18:00 Amman
  admin = await t.tokenFor('super_admin', 'admin@example.com');
  const d = await t.createUser('driver@example.com', 'driver', 'أبو محمد');
  driver = (await t.login('driver@example.com')).accessToken;

  const tnA = (
    await call('post', '/api/trade-names', admin, { name: 'مخابز مكة', invoicePrefix: 'MB' })
  ).body.data.id;
  const tnB = (
    await call('post', '/api/trade-names', admin, { name: 'أفران مكة', invoicePrefix: 'MK' })
  ).body.data.id;
  const section = (await call('post', '/api/items/sections', admin, { name: 'خبز' })).body.data.id;
  const item = async (name: string, basePrice: number) =>
    (await call('post', '/api/items', admin, { name, sectionId: section, unit: 'bag', basePrice }))
      .body.data.id as string;
  const bread = await item('خبز عربي', 400);
  const samoon = await item('صمون', 1000);

  const customer = async (
    name: string,
    tradeNameId: string,
    phone: string,
    terms: Record<string, unknown>,
  ) => {
    const c = (await call('post', '/api/customers', admin, { name, tradeNameId, phone })).body.data;
    await call('post', '/api/contracts', admin, {
      customerId: c.id,
      startDate: '2026-11-01',
      endDate: '2027-10-31',
      paymentType: 'credit',
      creditLimit: 100_000,
      paymentTermsDays: 30,
      overdueGraceDays: 0,
      discountBps: 0,
      allowReturns: true,
      maxReturnBps: 1000,
      renewalAlertDays: 30,
      ...terms,
    }).expect(201);
    return { id: c.id as string, branch: c.branches[0].id as string };
  };
  const A = await customer('مطعم أ', tnA, '0791000001', { discountBps: 1000 });
  const B = await customer('مطعم ب', tnB, '0791000002', {
    creditLimit: 5_000,
    paymentType: 'credit',
  });
  const C = await customer('مطعم ج', tnA, '0791000003', {});
  await call('post', '/api/users', admin, {
    email: 'rest@example.com',
    name: 'حساب أ',
    role: 'restaurant',
    customerId: A.id,
  }).expect(201);
  restaurant = (await t.login('rest@example.com')).accessToken;

  const route = (
    await call('post', '/api/distribution/routes', admin, { name: 'مسار عمّان', driverId: d.id })
  ).body.data.id;
  await call('put', `/api/distribution/routes/${route}/stops`, admin, {
    branchIds: [A.branch, B.branch, C.branch],
  }).expect(200);
  await call('put', '/api/settings/production', admin, {
    toleranceBps: 200,
    defaultExtraBps: 0,
  }).expect(200);
  ids = {
    bread,
    samoon,
    A: A.id,
    B: B.id,
    C: C.id,
    branchA: A.branch,
    branchB: B.branch,
    branchC: C.branch,
    route,
  };
});

describe('a full day through the system', () => {
  it('order → credit → cutoff → production → delivery → invoice → collection → reports', async () => {
    // ---- evening: A orders from the app; B is over its limit and needs a manager
    const a = (
      await call('post', '/api/app/orders', restaurant, {
        branchId: ids.branchA,
        lines: [
          { itemId: ids.bread, quantity: 100 },
          { itemId: ids.samoon, quantity: 20 },
        ],
      }).expect(201)
    ).body.data;
    expect(a).toMatchObject({ status: 'submitted', total: 100 * 360 + 20 * 900 });
    const b = (
      await call('post', '/api/orders', admin, {
        branchId: ids.branchB,
        lines: [{ itemId: ids.bread, quantity: 30 }],
      }).expect(201)
    ).body.data;
    expect(b.status).toBe('pending_approval');
    await call('post', `/api/orders/${b.id}/approve`, admin, {
      note: 'عميل قديم، يدفع نقداً اليوم',
    }).expect(200);

    // ---- 21:00 reminder goes only to C, who has not ordered
    t.whatsappSent.length = 0;
    t.setClock('2026-11-10T18:01:00Z');
    await t.app.scheduler.tick();
    await t.app.orders.idle();
    const reminders = t.whatsappSent.filter((m) =>
      JSON.stringify(m.body).includes('mb_order_reminder'),
    );
    expect(reminders).toHaveLength(1);
    expect(JSON.stringify(reminders[0]!.body)).toContain('962791000003');

    // ---- 03:00 cutoff: orders confirmed, final plan and trips built
    t.setClock('2026-11-11T00:05:00Z');
    await t.app.scheduler.tick();
    const plan = (await call('get', `/api/production/days/${DAY}`)).body.data;
    expect(plan.status).toBe('final');
    expect(plan.items.find((i: { itemId: string }) => i.itemId === ids.bread).ordered).toBe(130);
    const day = (await call('get', `/api/distribution/days/${DAY}`)).body.data;
    expect(day.trips[0].deliveries).toHaveLength(2);

    // ---- production: bread short by 10, one bag burnt, loaded, variance approved, day closed
    await call('patch', `/api/production/days/${DAY}/items`, admin, [
      { itemId: ids.bread, producedQty: 120 },
      { itemId: ids.samoon, producedQty: 20 },
    ]).expect(200);
    const vehicle = (await call('post', '/api/production/vehicles', admin, { name: 'سيارة 1' }))
      .body.data.id;
    await call('put', `/api/production/days/${DAY}/loads`, admin, {
      vehicleId: vehicle,
      lines: [
        { itemId: ids.bread, quantity: 119 },
        { itemId: ids.samoon, quantity: 20 },
      ],
    }).expect(200);
    await call('post', `/api/production/days/${DAY}/losses`, admin, {
      itemId: ids.bread,
      kind: 'waste',
      reason: 'burnt',
      quantity: 1,
    }).expect(201);
    let close = await call('post', `/api/production/days/${DAY}/close`, admin).expect(409);
    expect(close.body.error.code).toBe('OPEN_VARIANCES');
    await call('post', `/api/production/days/${DAY}/variances/approve`, admin, {
      itemId: ids.bread,
      note: 'نقص طحين',
    }).expect(200);
    close = await call('post', `/api/production/days/${DAY}/close`, admin).expect(200);

    // ---- morning: the driver works offline and syncs both stops at once
    t.setClock('2026-11-11T06:30:00Z');
    const trip = (await call('get', `/api/driver/trips?date=${DAY}`, driver)).body.data.trips[0];
    const stopA = trip.stops.find((s: { customer: { id: string } }) => s.customer.id === ids.A);
    const stopB = trip.stops.find((s: { customer: { id: string } }) => s.customer.id === ids.B);
    expect(stopA.balance).toBe(0);
    const sync = await call('post', '/api/driver/sync', driver, {
      items: [
        {
          deliveryId: stopA.deliveryId,
          confirmation: confirmation({
            lines: [
              {
                itemId: ids.bread,
                deliveredQty: 90,
                shortReason: 'bakery_shortage',
                returnedQty: 5,
                returnReason: 'unsold',
              },
              { itemId: ids.samoon, deliveredQty: 20, returnedQty: 0 },
            ],
          }),
        },
        {
          deliveryId: stopB.deliveryId,
          confirmation: confirmation({
            lines: [{ itemId: ids.bread, deliveredQty: 30, returnedQty: 0 }],
            collected: { amount: 12_000, method: 'cash' },
          }),
        },
      ],
    }).expect(200);
    expect(sync.body.data.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(sync.body.data.trips.trips[0].status).toBe('done');

    // ---- invoices: each under its trade name and its own sequence
    const invs = (await call('get', `/api/billing/invoices?from=${DAY}&to=${DAY}`)).body.data;
    const invA = invs.items.find((i: { customerId: string }) => i.customerId === ids.A);
    const invB = invs.items.find((i: { customerId: string }) => i.customerId === ids.B);
    expect(invA).toMatchObject({
      number: 'MB-000001',
      tradeName: 'مخابز مكة',
      total: 90 * 360 + 20 * 900 - 5 * 360,
      status: 'draft',
    });
    expect(invB).toMatchObject({
      number: 'MK-000001',
      tradeName: 'أفران مكة',
      total: 30 * 400,
      balance: 0,
    });
    expect(
      (await call('post', '/api/billing/invoices/approve', admin, { date: DAY })).body.data
        .approved,
    ).toBe(2);

    // ---- A pays half by cheque at the office
    await call('post', '/api/billing/payments', admin, {
      customerId: ids.A,
      amount: 24_000,
      method: 'cheque',
      reference: '552211',
      receivedOn: DAY,
    }).expect(201);

    // ---- reports agree with the books
    const sales = (await call('get', `/api/reports/sales?from=${DAY}&to=${DAY}&groupBy=trade_name`))
      .body.data;
    expect(sales.totals.net).toBe(invA.total + invB.total);
    const aging = (await call('get', '/api/reports/aging')).body.data;
    expect(aging.totals.balance).toBe(invA.total - 24_000);
    const drivers = (await call('get', `/api/reports/drivers?from=${DAY}&to=${DAY}`)).body.data;
    expect(drivers.rows[0]).toMatchObject({ delivered: 2, collected: 12_000 });
    const waste = (await call('get', `/api/reports/waste?from=${DAY}&to=${DAY}`)).body.data;
    expect(waste.totals.waste).toBe(1);
    const variances = (await call('get', `/api/reports/variances?from=${DAY}&to=${DAY}`)).body.data;
    expect(variances.rows[0].approval).toContain('نقص طحين');

    // ---- the restaurant sees its invoice and balance
    const bal = (await call('get', '/api/app/account/balance', restaurant)).body.data;
    expect(bal.balance).toBe(invA.total - 24_000);

    // ---- 40 days later A is overdue: a new order waits for a manager
    t.setClock('2026-12-20T15:00:00Z');
    const late = (
      await call('post', '/api/app/orders', restaurant, {
        branchId: ids.branchA,
        lines: [{ itemId: ids.bread, quantity: 10 }],
      }).expect(201)
    ).body.data;
    expect(late.status).toBe('pending_approval');
    expect(late.creditReasons.map((r: { code: string }) => r.code)).toContain('OVERDUE_DEBT');

    // ---- every step left an audit trail
    const actions = (await t.db.execute(
      sql`select distinct action from audit_logs`,
    )) as unknown as { action: string }[];
    const names = actions.map((x) => x.action);
    for (const a of ['delivery.confirm', 'invoice.approve', 'payment.create', 'production.close'])
      expect(
        names.some((n) => n.startsWith(a.split('.')[0]!) && n.includes(a.split('.')[1]!)),
      ).toBe(true);
  });
});

describe('awkward cases', () => {
  async function toCutoff() {
    await call('post', '/api/orders', admin, {
      branchId: ids.branchA,
      lines: [{ itemId: ids.bread, quantity: 10 }],
    }).expect(201);
    await call('post', '/api/orders', admin, {
      branchId: ids.branchC,
      lines: [{ itemId: ids.bread, quantity: 10 }],
    }).expect(201);
    t.setClock('2026-11-11T00:05:00Z');
    await t.app.scheduler.tick();
    return (await call('get', `/api/driver/trips?date=${DAY}`, driver)).body.data.trips[0];
  }

  it('an order cancelled after loading is refused on sync and leaves the trip', async () => {
    const trip = await toCutoff();
    const stopC = trip.stops.find((s: { customer: { id: string } }) => s.customer.id === ids.C);
    await call('post', `/api/orders/${stopC.order.id}/cancel`, admin, {
      reason: 'المطعم مغلق اليوم',
    }).expect(200);
    const sync = await call('post', '/api/driver/sync', driver, {
      items: [{ deliveryId: stopC.deliveryId, confirmation: confirmation({}) }],
    }).expect(200);
    expect(sync.body.data.results[0]).toMatchObject({
      ok: false,
      error: { code: 'ORDER_NOT_DELIVERABLE' },
    });
    await call('post', `/api/distribution/days/${DAY}/generate`, admin).expect(200);
    const day = (await call('get', `/api/distribution/days/${DAY}`)).body.data;
    expect(day.trips[0].deliveries.map((x: { customerName: string }) => x.customerName)).toEqual([
      'مطعم أ',
    ]);
    expect((await call('get', '/api/billing/invoices')).body.data.total).toBe(0);
  });

  it('returns above the contract limit are flagged on the invoice', async () => {
    const trip = await toCutoff();
    const stopA = trip.stops.find((s: { customer: { id: string } }) => s.customer.id === ids.A);
    await call(
      'post',
      `/api/driver/deliveries/${stopA.deliveryId}/confirm`,
      driver,
      confirmation({
        lines: [{ itemId: ids.bread, deliveredQty: 10, returnedQty: 4, returnReason: 'unsold' }],
      }),
    ).expect(200);
    const inv = (await call('get', '/api/billing/invoices')).body.data.items[0];
    expect(inv.flags[0]).toContain('أكثر من الحد المسموح');
  });

  it('a re-sent confirmation after a dropped connection is not invoiced twice', async () => {
    const trip = await toCutoff();
    const stop = trip.stops[0];
    const c = confirmation({ collected: { amount: 1000, method: 'cash' } });
    for (let i = 0; i < 3; i++)
      await call('post', '/api/driver/sync', driver, {
        items: [{ deliveryId: stop.deliveryId, confirmation: c }],
      }).expect(200);
    expect((await call('get', '/api/billing/invoices')).body.data.total).toBe(1);
    expect((await call('get', '/api/billing/payments')).body.data.total).toBe(1);
  });

  it('cancelling a paid invoice turns the money into credit for the next one', async () => {
    const trip = await toCutoff();
    const stopA = trip.stops.find((s: { customer: { id: string } }) => s.customer.id === ids.A);
    await call(
      'post',
      `/api/driver/deliveries/${stopA.deliveryId}/confirm`,
      driver,
      confirmation({
        collected: { amount: 3600, method: 'cash' },
      }),
    ).expect(200);
    const inv = (await call('get', '/api/billing/invoices')).body.data.items[0];
    expect(inv.balance).toBe(0);
    await call('post', `/api/billing/invoices/${inv.id}/cancel`, admin, {
      reason: 'فاتورة مكررة',
    }).expect(200);
    const sum = (await call('get', `/api/billing/customers/${ids.A}/summary`)).body.data;
    expect(sum).toMatchObject({ balance: -3600, credit: 3600 });
  });
});
