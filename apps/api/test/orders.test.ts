import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { asc } from 'drizzle-orm';
import { auditLogs, whatsappMessages } from '../src/db/schema/index.js';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
let restaurant: string;
let customerId: string;
let branchId: string;
let bread: string;
let croissant: string;

// 21:00 in Amman on 10 Nov → ordering for 11 Nov, cutoff 11 Nov 03:00 (00:00Z).
const EVENING = '2026-11-10T18:00:00Z';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = (
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  token: string,
  body?: object,
) => {
  const r = request(t.app)[method](path).set(auth(token));
  return body ? r.send(body) : r;
};
const whatsTemplates = () =>
  t.whatsappSent.map((w) => (w.body as { template?: { name: string } }).template?.name);

async function setup(opts: { creditLimit?: number; contract?: boolean } = {}) {
  admin = await t.tokenFor('super_admin', 'admin@example.com');
  const c = await api('post', '/api/customers', admin, {
    name: 'مطعم الريم',
    phone: '0791111111',
  }).expect(201);
  customerId = c.body.data.id;
  branchId = c.body.data.branches[0].id;
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
  if (opts.contract !== false)
    await api('post', '/api/contracts', admin, {
      customerId,
      startDate: '2026-11-01',
      endDate: '2027-10-31',
      paymentType: 'credit',
      creditLimit: opts.creditLimit ?? 500_000,
      paymentTermsDays: 30,
      overdueGraceDays: 0,
      discountBps: 1000,
      allowReturns: false,
      maxReturnBps: 0,
      renewalAlertDays: 30,
      prices: [{ itemId: bread, price: 300 }],
    }).expect(201);
  await api('post', '/api/users', admin, {
    email: 'rest@example.com',
    name: 'حساب المطعم',
    role: 'restaurant',
    customerId,
  }).expect(201);
  restaurant = (await t.login('rest@example.com')).accessToken;
}

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  t.setClock(EVENING);
});

const place = (token = restaurant, lines = [{ itemId: bread, quantity: 10 }]) =>
  api('post', '/api/app/orders', token, { branchId, lines });

describe('restaurant accounts', () => {
  it('must be linked to a customer', async () => {
    admin = await t.tokenFor('super_admin', 'admin@example.com');
    const res = await api('post', '/api/users', admin, {
      email: 'r@x.com',
      name: 'مطعم',
      role: 'restaurant',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CUSTOMER_REQUIRED');
  });
});

describe('ordering from the app', () => {
  beforeEach(() => setup());

  it('shows the ordering window, branches and credit', async () => {
    const me = await api('get', '/api/app/me', restaurant).expect(200);
    expect(me.body.data).toMatchObject({
      deliveryDate: '2026-11-11',
      cutoffAt: '2026-11-11T00:00:00.000Z',
    });
    expect(me.body.data.branches[0]).toMatchObject({ id: branchId, order: null });
    expect(me.body.data.credit.allowed).toBe(true);

    const catalog = await api('get', `/api/app/catalog?branchId=${branchId}`, restaurant).expect(
      200,
    );
    const prices = Object.fromEntries(
      catalog.body.data.map((i: { id: string; price: number }) => [i.id, i.price]),
    );
    expect(prices).toEqual({ [bread]: 300, [croissant]: 900 });
  });

  it('places an order at contract prices and confirms it on WhatsApp', async () => {
    const res = await place(restaurant, [
      { itemId: bread, quantity: 10 },
      { itemId: croissant, quantity: 4 },
    ]).expect(201);
    expect(res.body.data).toMatchObject({
      number: 'ORD-000001',
      status: 'submitted',
      deliveryDate: '2026-11-11',
      total: 10 * 300 + 4 * 900,
      source: 'app',
      editableByRestaurant: true,
    });
    await t.app.orders.idle();
    expect(whatsTemplates()).toEqual(['mb_order_confirmed']);
    const msg = t.whatsappSent[0]!.body as {
      to: string;
      template: { components: { parameters: { text: string }[] }[] };
    };
    expect(msg.to).toBe('962791111111');
    expect(msg.template.components[0]!.parameters.map((p) => p.text)).toEqual([
      'ORD-000001',
      'الفرع الرئيسي',
      '2026-11-11',
      '6.600',
      '03:00 يوم 2026-11-11',
    ]);
    const [logged] = await t.db.select().from(whatsappMessages);
    expect(logged).toMatchObject({ status: 'sent', template: 'mb_order_confirmed', customerId });
  });

  it('prevents a second order for the same branch and day', async () => {
    const first = await place().expect(201);
    const dup = await place().expect(409);
    expect(dup.body.error).toMatchObject({
      code: 'ORDER_EXISTS',
      details: { orderId: first.body.data.id },
    });
  });

  it('keeps restaurants inside their own customer', async () => {
    const other = await api('post', '/api/customers', admin, { name: 'مطعم آخر' });
    const res = await api('post', '/api/app/orders', restaurant, {
      branchId: other.body.data.branches[0].id,
      lines: [{ itemId: bread, quantity: 1 }],
    });
    expect(res.status).toBe(403);
    const staffOrder = await api('post', '/api/orders', admin, {
      branchId: other.body.data.branches[0].id,
      lines: [{ itemId: bread, quantity: 1 }],
    }).expect(201);
    await api('get', `/api/app/orders/${staffOrder.body.data.id}`, restaurant).expect(404);
  });

  it('allows edits until the cutoff, logs before/after, then locks for the restaurant only', async () => {
    const o = (await place().expect(201)).body.data;
    const edited = await api('patch', `/api/app/orders/${o.id}`, restaurant, {
      lines: [{ itemId: bread, quantity: 15 }],
    }).expect(200);
    expect(edited.body.data.total).toBe(4500);
    const updated = edited.body.data.events.find((e: { type: string }) => e.type === 'updated');
    expect(updated.data.before.total).toBe(3000);
    expect(updated.data.after.total).toBe(4500);

    t.setClock('2026-11-11T00:00:01Z'); // 03:00:01 Amman
    const locked = await api('patch', `/api/app/orders/${o.id}`, restaurant, {
      lines: [{ itemId: bread, quantity: 20 }],
    }).expect(409);
    expect(locked.body.error.code).toBe('ORDER_LOCKED');
    await api('patch', `/api/orders/${o.id}`, admin, {
      lines: [{ itemId: bread, quantity: 20 }],
    }).expect(200);
  });

  it('repeats the last order', async () => {
    t.setClock('2026-11-09T18:00:00Z'); // ordering for the 10th
    await place(restaurant, [{ itemId: croissant, quantity: 7 }]).expect(201);
    t.setClock(EVENING);
    const again = await api('post', '/api/app/orders/repeat', restaurant, { branchId }).expect(201);
    expect(again.body.data).toMatchObject({ deliveryDate: '2026-11-11', itemCount: 1 });
    expect(again.body.data.lines[0]).toMatchObject({
      itemId: croissant,
      quantity: 7,
      unitPrice: 900,
    });
  });

  it('rejects empty orders, bad quantities and dates too far ahead', async () => {
    expect((await place(restaurant, [{ itemId: bread, quantity: 0 }])).body.error.code).toBe(
      'EMPTY_ORDER',
    );
    await place(restaurant, [{ itemId: bread, quantity: 1.5 }]).expect(400);
    const far = await api('post', '/api/app/orders', restaurant, {
      branchId,
      deliveryDate: '2026-12-01',
      lines: [{ itemId: bread, quantity: 1 }],
    });
    expect(far.body.error.code).toBe('TOO_FAR_AHEAD');
  });
});

describe('credit rules on orders', () => {
  it('holds an order over the limit; a manager approves it with a reason', async () => {
    await setup({ creditLimit: 5_000 });
    const o = (await place(restaurant, [{ itemId: bread, quantity: 20 }]).expect(201)).body.data;
    expect(o.status).toBe('pending_approval');
    expect(o.creditReasons.map((r: { code: string }) => r.code)).toEqual(['CREDIT_LIMIT_EXCEEDED']);
    await t.app.orders.idle();
    expect(whatsTemplates()).toEqual(['mb_order_on_hold']);

    const clerk = await t.tokenFor('orders');
    await api('post', `/api/orders/${o.id}/approve`, clerk, { note: 'عميل قديم' }).expect(403);
    await api('post', `/api/orders/${o.id}/approve`, admin, { note: 'x' }).expect(400);
    const ok = await api('post', `/api/orders/${o.id}/approve`, admin, {
      note: 'عميل قديم وموثوق',
    }).expect(200);
    expect(ok.body.data).toMatchObject({ status: 'submitted', approvalNote: 'عميل قديم وموثوق' });
    expect(ok.body.data.events.map((e: { type: string }) => e.type)).toEqual([
      'created',
      'approval_requested',
      'approved',
    ]);
    const logs = await t.db.select().from(auditLogs).orderBy(asc(auditLogs.id));
    expect(logs.at(-1)).toMatchObject({
      action: 'order.credit_approve',
      reason: 'عميل قديم وموثوق',
    });
  });

  it('holds orders from customers without a contract', async () => {
    await setup({ contract: false });
    const o = await place().expect(201);
    expect(o.body.data.status).toBe('pending_approval');
    expect(o.body.data.creditReasons[0].code).toBe('NO_CONTRACT');
  });
});

describe('scheduler: reminders, drafts, cutoff', () => {
  beforeEach(() => setup());

  it('sends each reminder once to branches without an order', async () => {
    t.setClock('2026-11-10T18:00:30Z'); // 21:00 Amman
    await t.app.scheduler.tick();
    await t.app.scheduler.tick();
    expect(whatsTemplates()).toEqual(['mb_order_reminder']);

    await place().expect(201);
    t.setClock('2026-11-10T19:00:30Z'); // 22:00 — branch has ordered now
    await t.app.scheduler.tick();
    await t.app.orders.idle();
    expect(whatsTemplates()).toEqual(['mb_order_reminder', 'mb_order_confirmed']);
  });

  it('creates drafts from yesterday at midnight and closes ordering at the cutoff', async () => {
    t.setClock('2026-11-09T18:00:00Z');
    await place(restaurant, [{ itemId: bread, quantity: 12 }]).expect(201); // for the 10th
    t.setClock('2026-11-09T21:00:00Z');
    await t.app.scheduler.tick(); // 00:00 on the 10th: no previous order for the 9th → no draft
    t.setClock('2026-11-10T00:00:10Z');
    await t.app.scheduler.tick(); // 03:00 on the 10th: cutoff
    const day10 = await api('get', '/api/orders?deliveryDate=2026-11-10', admin);
    expect(day10.body.data.items[0].status).toBe('confirmed');

    t.setClock('2026-11-10T21:00:10Z'); // 00:00 on the 11th
    await t.app.scheduler.tick();
    let day11 = await api('get', '/api/orders?deliveryDate=2026-11-11', admin);
    expect(day11.body.data.items[0]).toMatchObject({
      status: 'draft',
      source: 'auto_draft',
      total: 3600,
    });
    await t.app.orders.idle();
    expect(whatsTemplates()).toContain('mb_draft_ready');

    t.setClock('2026-11-11T00:00:10Z'); // 03:00 on the 11th: unconfirmed draft is cancelled
    await t.app.scheduler.tick();
    day11 = await api('get', '/api/orders?deliveryDate=2026-11-11', admin);
    expect(day11.body.data.items[0]).toMatchObject({ status: 'cancelled' });

    const runs = await api('get', '/api/orders/scheduler-runs', admin);
    expect(runs.body.data.map((r: { job: string }) => r.job)).toEqual(
      expect.arrayContaining(['drafts', 'cutoff']),
    );
  });

  it('a confirmed draft becomes the order; with auto-submit on, drafts are confirmed at the cutoff', async () => {
    await api('put', '/api/settings/orders', admin, { autoSubmitDrafts: true }).expect(200);
    t.setClock('2026-11-09T18:00:00Z');
    await place(restaurant, [{ itemId: bread, quantity: 12 }]).expect(201);
    t.setClock('2026-11-10T21:00:10Z');
    await t.app.scheduler.tick();
    t.setClock('2026-11-11T00:00:10Z');
    await t.app.scheduler.tick();
    const day11 = await api('get', '/api/orders?deliveryDate=2026-11-11', admin);
    expect(day11.body.data.items[0].status).toBe('confirmed');
  });

  it('builds the preliminary summary per item', async () => {
    await place(restaurant, [
      { itemId: bread, quantity: 10 },
      { itemId: croissant, quantity: 3 },
    ]).expect(201);
    const s = await api('get', '/api/orders/summary?date=2026-11-11', admin).expect(200);
    expect(
      s.body.data.items.map((i: { name: string; quantity: number }) => [i.name, i.quantity]),
    ).toEqual([
      ['خبز عربي', 10],
      ['كرواسان', 3],
    ]);
    expect(s.body.data.branchesWithoutOrder).toEqual([]);
  });
});

describe('settings', () => {
  it('validates times and audits changes', async () => {
    admin = await t.tokenFor('super_admin', 'admin@example.com');
    await api('put', '/api/settings/orders', admin, { cutoffTime: '25:00' }).expect(400);
    const res = await api('put', '/api/settings/orders', admin, {
      cutoffTime: '02:30',
      reminderTimes: ['22:30', '21:30', '21:30'],
    }).expect(200);
    expect(res.body.data).toMatchObject({ cutoffTime: '02:30', reminderTimes: ['21:30', '22:30'] });
    const clerk = await t.tokenFor('orders');
    await api('put', '/api/settings/orders', clerk, { cutoffTime: '01:00' }).expect(403);
    await api('get', '/api/settings/orders', clerk).expect(200);
  });
});

describe('WhatsApp webhook', () => {
  it('stores incoming messages linked to the customer and delivery statuses', async () => {
    await setup();
    await place().expect(201);
    await t.app.orders.idle();
    await request(t.app)
      .post('/api/whatsapp/webhook')
      .send({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.in1',
                      from: '962791111111',
                      type: 'text',
                      text: { body: 'شكراً' },
                    },
                  ],
                  statuses: [{ id: 'wamid.1', status: 'read' }],
                },
              },
            ],
          },
        ],
      })
      .expect(200);
    const list = await api('get', '/api/whatsapp/messages', admin).expect(200);
    const byDir = Object.fromEntries(
      list.body.data.items.map((m: { direction: string }) => [m.direction, m]),
    );
    expect(byDir.in).toMatchObject({
      body: 'شكراً',
      customerName: 'مطعم الريم',
      status: 'received',
    });
    expect(byDir.out).toMatchObject({ status: 'read' });
    await request(t.app)
      .get('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x')
      .expect(403);
  });
});
