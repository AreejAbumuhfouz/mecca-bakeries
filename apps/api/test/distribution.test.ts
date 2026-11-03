import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, type TestApp } from './helpers.js';
import { invoiceTotals } from '../src/modules/billing/billing.service.js';

let t: TestApp;
let admin: string;
let driver: string;
let driverId: string;
let bread: string;
let croissant: string;
let cake: string;
let custA: string;
let branchA: string;
let custB: string;
let branchB: string;
let routeId: string;

const EVENING = '2026-11-10T18:00:00Z'; // 21:00 Amman, ordering for the 11th
const MORNING = '2026-11-11T05:00:00Z'; // 08:00 Amman on the 11th, after the cutoff
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

type Stop = {
  deliveryId: string;
  status: string;
  customer: { id: string };
  balance: number;
  items: { itemId: string; quantity: number; unitPrice: number }[];
  result: { invoice: { id: string; number: string; total: number } | null } | null;
};
type Trip = { id: string; status: string; stops: Stop[] };

const confirmation = (over: Record<string, unknown> = {}) => ({
  clientRef: `phone-${Math.random().toString(36).slice(2)}`,
  outcome: 'delivered',
  lines: [],
  receiverName: 'أبو أحمد',
  deliveredAt: '2026-11-11T06:00:00Z',
  latitude: 31.95,
  longitude: 35.91,
  accuracyM: 12,
  ...over,
});

async function myTrip(): Promise<Trip> {
  const r = await api('get', `/api/driver/trips?date=${DAY}`, driver).expect(200);
  return r.body.data.trips[0];
}

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  t.setClock(EVENING);
  admin = await t.tokenFor('super_admin', 'admin@example.com');
  const d = await t.createUser('driver@example.com', 'driver', 'أبو محمد');
  driverId = d.id;
  driver = (await t.login('driver@example.com')).accessToken;

  const tn = (
    await api('post', '/api/trade-names', admin, { name: 'مخابز مكة', invoicePrefix: 'MB' })
  ).body.data.id;
  const section = (await api('post', '/api/items/sections', admin, { name: 'خبز' })).body.data.id;
  const item = async (name: string, basePrice: number) =>
    (await api('post', '/api/items', admin, { name, sectionId: section, unit: 'bag', basePrice }))
      .body.data.id as string;
  bread = await item('خبز عربي', 400);
  croissant = await item('كرواسان', 1000);
  cake = await item('كعك', 2000);

  const customer = async (name: string, contract: Record<string, unknown>) => {
    const c = (await api('post', '/api/customers', admin, { name, tradeNameId: tn })).body.data;
    await api('post', '/api/contracts', admin, {
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
      ...contract,
    }).expect(201);
    return { id: c.id as string, branch: c.branches[0].id as string };
  };
  // A: 10% contract discount, croissant at a special price; B: no returns, 7 days terms.
  ({ id: custA, branch: branchA } = await customer('مطعم أ', {
    discountBps: 1000,
    prices: [{ itemId: croissant, price: 800 }],
  }));
  ({ id: custB, branch: branchB } = await customer('مطعم ب', {
    allowReturns: false,
    maxReturnBps: 0,
    paymentTermsDays: 7,
  }));

  routeId = (
    await api('post', '/api/distribution/routes', admin, { name: 'مسار عمّان', driverId }).expect(
      201,
    )
  ).body.data.id;
  await api('put', `/api/distribution/routes/${routeId}/stops`, admin, {
    branchIds: [branchB, branchA],
  }).expect(200);

  await api('post', '/api/orders', admin, {
    branchId: branchA,
    lines: [
      { itemId: bread, quantity: 100 },
      { itemId: croissant, quantity: 20 },
    ],
  }).expect(201);
  await api('post', '/api/orders', admin, {
    branchId: branchB,
    lines: [{ itemId: bread, quantity: 50 }],
  }).expect(201);

  t.setClock(MORNING);
  await t.app.scheduler.tick(); // cutoff: confirms orders, builds the plan and the trips
});

describe('invoice totals', () => {
  it('applies list price, contract discount, second discount and returns', () => {
    const r = invoiceTotals(
      [
        { kind: 'sale', quantity: 10, unitPrice: 360, listPrice: 400 },
        { kind: 'sale', quantity: 2, unitPrice: 800 },
        { kind: 'return', quantity: 1, unitPrice: 360 },
      ],
      500,
    );
    expect(r).toEqual({
      grossTotal: 5600,
      discount1Amount: 400,
      discount2Amount: 260,
      returnsTotal: 360,
      total: 4580,
    });
  });
});

describe('routes and trips', () => {
  it('builds the trip at the cutoff in route order, with the loading sheet', async () => {
    const day = (await api('get', `/api/distribution/days/${DAY}`).expect(200)).body.data;
    expect(day.trips).toHaveLength(1);
    expect(day.trips[0].driverName).toBe('أبو محمد');
    expect(day.trips[0].deliveries.map((d: { customerName: string }) => d.customerName)).toEqual([
      'مطعم ب',
      'مطعم أ',
    ]);
    expect(day.unassigned).toHaveLength(0);
    // Repeating is harmless.
    await api('post', `/api/distribution/days/${DAY}/generate`).expect(200);
    const again = (await api('get', `/api/distribution/days/${DAY}`)).body.data;
    expect(again.trips[0].deliveries).toHaveLength(2);

    const sheet = await api('get', `/api/distribution/trips/${day.trips[0].id}/sheet`).expect(200);
    expect(sheet.headers['content-type']).toContain('application/pdf');
  });

  it('only the assigned driver sees and confirms the trip', async () => {
    const other = await t.tokenFor('driver', 'other@example.com');
    const r = await api('get', `/api/driver/trips?date=${DAY}`, other).expect(200);
    expect(r.body.data.trips).toHaveLength(0);
    const trip = await myTrip();
    await api(
      'post',
      `/api/driver/deliveries/${trip.stops[0]!.deliveryId}/confirm`,
      other,
      confirmation(),
    ).expect(403);
  });
});

describe('delivery confirmation → invoice → receivables', () => {
  it('invoices the delivered quantity at contract prices, returns credited, cash allocated', async () => {
    const trip = await myTrip();
    const stopA = trip.stops.find((s) => s.customer.id === custA)!;
    expect(stopA.items.find((i) => i.itemId === bread)!.unitPrice).toBe(360); // 10% off 400
    expect(stopA.items.find((i) => i.itemId === croissant)!.unitPrice).toBe(800); // special

    const res = await api(
      'post',
      `/api/driver/deliveries/${stopA.deliveryId}/confirm`,
      driver,
      confirmation({
        lines: [
          { itemId: bread, deliveredQty: 90, shortReason: 'bakery_shortage', returnedQty: 0 },
          { itemId: croissant, deliveredQty: 20, returnedQty: 0 },
          { itemId: cake, deliveredQty: 0, returnedQty: 1, returnReason: 'unsold' }, // not ordered today
        ],
        collected: { amount: 10_000, method: 'cash' },
        signature: { width: 300, height: 120, paths: ['M10 10 L50 60 L90 20'] },
      }),
    ).expect(200);
    const after = res.body.data.trip as Trip;
    const done = after.stops.find((s) => s.deliveryId === stopA.deliveryId)!;
    expect(done.status).toBe('partial');
    const inv = (await api('get', `/api/billing/invoices/${done.result!.invoice!.id}`)).body.data;
    expect(inv.number).toBe('MB-000001');
    expect(inv.status).toBe('draft');
    expect(inv.issueDate).toBe(DAY);
    expect(inv.dueDate).toBe('2026-12-11');
    // 90 × 0.360 + 20 × 0.800 = 48.400; cake return at 10% off 2.000 = 1.800
    expect(inv).toMatchObject({
      grossTotal: 90 * 400 + 20 * 800,
      discount1Amount: 90 * 40,
      returnsTotal: 1800,
      total: 48_400 - 1800,
      paid: 10_000,
      balance: 46_600 - 10_000,
    });
    expect(inv.delivery).toMatchObject({
      receiverName: 'أبو أحمد',
      hasSignature: true,
      latitude: 31.95,
    });

    const order = (await api('get', `/api/orders/${inv.orderId}`)).body.data;
    expect(order.status).toBe('delivered');
    // A delivered order can no longer be edited; corrections go on the invoice.
    await api('patch', `/api/orders/${inv.orderId}`, admin, {
      lines: [{ itemId: bread, quantity: 1 }],
    }).expect(409);

    const summary = (await api('get', `/api/billing/customers/${custA}/summary`)).body.data;
    expect(summary).toMatchObject({ balance: 36_600, overdue: 0 });
    const pays = (await api('get', `/api/billing/payments?customerId=${custA}`)).body.data;
    expect(pays.items[0]).toMatchObject({
      number: 'RC-000001',
      amount: 10_000,
      source: 'driver',
      allocated: 10_000,
    });

    const sig = await api(
      'get',
      `/api/distribution/deliveries/${stopA.deliveryId}/signature`,
    ).expect(200);
    expect(sig.headers['content-type']).toContain('image/svg+xml');
    expect(String(sig.body)).toContain('<path d="M10 10 L50 60 L90 20"');
  });

  it('is safe to resend; a second different confirmation is a conflict', async () => {
    const trip = await myTrip();
    const stop = trip.stops[0]!;
    const c = confirmation();
    await api('post', `/api/driver/deliveries/${stop.deliveryId}/confirm`, driver, c).expect(200);
    const again = await api(
      'post',
      `/api/driver/deliveries/${stop.deliveryId}/confirm`,
      driver,
      c,
    ).expect(200);
    expect(again.body.data.duplicate).toBe(true);
    const other = await api(
      'post',
      `/api/driver/deliveries/${stop.deliveryId}/confirm`,
      driver,
      confirmation(),
    ).expect(409);
    expect(other.body.error.code).toBe('ALREADY_CONFIRMED');
    const invs = (await api('get', '/api/billing/invoices')).body.data;
    expect(invs.total).toBe(1);
  });

  it('syncs an offline queue item by item and reports problems', async () => {
    const trip = await myTrip();
    const [b, a] = trip.stops;
    const r = await api('post', '/api/driver/sync', driver, {
      items: [
        {
          deliveryId: b!.deliveryId,
          confirmation: confirmation({
            lines: [{ itemId: bread, deliveredQty: 50, returnedQty: 2, returnReason: 'unsold' }],
          }),
        }, // B does not allow returns
        {
          deliveryId: a!.deliveryId,
          confirmation: confirmation({
            outcome: 'failed',
            failReason: 'shop_closed',
            receiverName: null,
          }),
        },
      ],
    }).expect(200);
    expect(r.body.data.results[0]).toMatchObject({
      ok: false,
      error: { code: 'RETURNS_NOT_ALLOWED' },
    });
    expect(r.body.data.results[1]).toMatchObject({ ok: true });
    const failed = (r.body.data.trips.trips[0] as Trip).stops.find(
      (s) => s.deliveryId === a!.deliveryId,
    )!;
    expect(failed.status).toBe('failed');
    expect(failed.result!.invoice).toBeNull();
  });

  it('requires reasons and a receiver', async () => {
    const stop = (await myTrip()).stops.find((s) => s.customer.id === custB)!;
    const url = `/api/driver/deliveries/${stop.deliveryId}/confirm`;
    let r = await api(
      'post',
      url,
      driver,
      confirmation({ lines: [{ itemId: bread, deliveredQty: 40, returnedQty: 0 }] }),
    ).expect(422);
    expect(r.body.error.code).toBe('SHORT_REASON');
    r = await api('post', url, driver, confirmation({ receiverName: '' })).expect(422);
    expect(r.body.error.code).toBe('RECEIVER_REQUIRED');
    r = await api(
      'post',
      url,
      driver,
      confirmation({ lines: [{ itemId: bread, deliveredQty: 60, returnedQty: 0 }] }),
    ).expect(422);
    expect(r.body.error.code).toBe('OVER_DELIVERED');
  });
});

describe('invoice locking, payments, statements', () => {
  async function deliverAll() {
    const trip = await myTrip();
    for (const s of trip.stops)
      await api(
        'post',
        `/api/driver/deliveries/${s.deliveryId}/confirm`,
        driver,
        confirmation(),
      ).expect(200);
    return (await api('get', '/api/billing/invoices')).body.data.items as {
      id: string;
      customerId: string;
      total: number;
      number: string;
    }[];
  }

  it('locks approved invoices; changes need the special permission and a reason', async () => {
    const invs = await deliverAll();
    const invA = invs.find((i) => i.customerId === custA)!;
    // Draft: second discount by the accountant.
    const acc = await t.tokenFor('accountant', 'acc@example.com');
    let r = await api('patch', `/api/billing/invoices/${invA.id}`, acc, {
      discount2Bps: 500,
    }).expect(200);
    expect(r.body.data.discount2Amount).toBe(Math.round((invA.total * 500) / 10_000));
    await api('post', '/api/billing/invoices/approve', acc, { date: DAY }).expect(200);

    r = await api('patch', `/api/billing/invoices/${invA.id}`, acc, { discount2Bps: 0 }).expect(
      403,
    );
    expect(r.body.error.code).toBe('INVOICE_LOCKED');
    r = await api('patch', `/api/billing/invoices/${invA.id}`, admin, { discount2Bps: 0 }).expect(
      422,
    );
    expect(r.body.error.code).toBe('REASON_REQUIRED');
    r = await api('patch', `/api/billing/invoices/${invA.id}`, admin, {
      discount2Bps: 0,
      reason: 'خصم أضيف بالخطأ',
    }).expect(200);
    expect(r.body.data.total).toBe(invA.total);
    expect(r.body.data.revisions).toHaveLength(1);
    expect(r.body.data.revisions[0].reason).toBe('خصم أضيف بالخطأ');
  });

  it('spreads payments oldest first, keeps aging, and blocks orders when overdue', async () => {
    // Opening balance from before the system, due long ago.
    await api('post', `/api/billing/customers/${custB}/opening`, admin, {
      amount: 30_000,
      date: '2026-09-01',
    }).expect(201);
    await api('post', `/api/billing/customers/${custB}/opening`, admin, {
      amount: 1,
      date: '2026-09-01',
    }).expect(409);
    await deliverAll();

    let sum = (await api('get', `/api/billing/customers/${custB}/summary`)).body.data;
    expect(sum.balance).toBe(30_000 + 50 * 400);
    expect(sum.overdue).toBe(30_000);
    expect(sum.aging.d61_90).toBe(30_000);

    // Overdue debt now blocks a new order (contract has 0 grace days).
    t.setClock('2026-11-11T18:00:00Z');
    const held = await api('post', '/api/orders', admin, {
      branchId: branchB,
      lines: [{ itemId: bread, quantity: 5 }],
    }).expect(201);
    expect(held.body.data.status).toBe('pending_approval');

    // 35 JOD pays the opening balance first, then 5 JOD of the new invoice.
    const pay = await api('post', '/api/billing/payments', admin, {
      customerId: custB,
      amount: 35_000,
      method: 'cheque',
      reference: '123456',
      receivedOn: '2026-11-11',
    }).expect(201);
    expect(pay.body.data.allocations.map((a: { amount: number }) => a.amount)).toEqual([
      30_000, 5_000,
    ]);
    sum = (await api('get', `/api/billing/customers/${custB}/summary`)).body.data;
    expect(sum).toMatchObject({ balance: 15_000, overdue: 0 });

    const st = (
      await api('get', `/api/billing/customers/${custB}/statement?from=2026-11-01&to=2026-11-30`)
    ).body.data;
    expect(st.opening).toBe(30_000);
    expect(st.rows.map((r: { debit: number; credit: number }) => [r.debit, r.credit])).toEqual([
      [20_000, 0],
      [0, 35_000],
    ]);
    expect(st.closing).toBe(15_000);
    await api('get', `/api/billing/customers/${custB}/statement/pdf`).expect(200);

    const rec = (await api('get', '/api/billing/receivables')).body.data;
    expect(rec.items.map((c: { name: string }) => c.name).sort()).toEqual(['مطعم أ', 'مطعم ب']);

    // Cancelling the payment puts the debt back.
    await api('post', `/api/billing/payments/${pay.body.data.id}/cancel`, admin, {
      reason: 'شيك مرتجع',
    }).expect(200);
    sum = (await api('get', `/api/billing/customers/${custB}/summary`)).body.data;
    expect(sum.balance).toBe(50_000);
  });

  it('restaurant sees only its own invoices, balance and statement', async () => {
    const invs = await deliverAll();
    await t.createUser('rest@example.com', 'restaurant');
    await t.db.execute(
      (await import('drizzle-orm'))
        .sql`update users set customer_id = ${custA} where email = 'rest@example.com'`,
    );
    const rest = (await t.login('rest@example.com')).accessToken;
    const list = (await api('get', '/api/app/account/invoices', rest).expect(200)).body.data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].customerId).toBe(custA);
    const otherInv = invs.find((i) => i.customerId === custB)!;
    await api('get', `/api/app/account/invoices/${otherInv.id}`, rest).expect(404);
    await api('get', `/api/app/account/invoices/${list.items[0].id}/pdf`, rest).expect(200);
    const bal = (await api('get', '/api/app/account/balance', rest).expect(200)).body.data;
    expect(bal.balance).toBe(list.items[0].total);
    await api('get', '/api/app/account/statement/pdf', rest).expect(200);
    await api('get', '/api/billing/invoices', rest).expect(403);
  });

  it('sends the daily balance reminder with the statement to customers who are overdue', async () => {
    await api('post', `/api/billing/customers/${custB}/opening`, admin, {
      amount: 30_000,
      date: '2026-09-01',
    }).expect(201);
    await api('patch', `/api/billing/customers/${custA}/alerts`, admin, { enabled: false }).expect(
      200,
    );
    await t.db.execute(
      (await import('drizzle-orm'))
        .sql`update customers set phone = '0791112223' where id = ${custB}`,
    );
    t.whatsappSent.length = 0;
    t.setClock('2026-11-11T07:05:00Z'); // 10:05 Amman
    await t.app.scheduler.tick();
    const docs = t.whatsappSent.filter((m) =>
      JSON.stringify(m.body).includes('mb_balance_statement'),
    );
    expect(docs).toHaveLength(1);
    expect(JSON.stringify(docs[0]!.body)).toContain('962791112223');
    await t.app.scheduler.tick(); // once a day
    expect(
      t.whatsappSent.filter((m) => JSON.stringify(m.body).includes('mb_balance_statement')),
    ).toHaveLength(1);
  });
});
