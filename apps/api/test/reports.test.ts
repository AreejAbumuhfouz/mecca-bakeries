import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
const MORNING = '2026-11-11T05:00:00Z';
const DAY = '2026-11-11';
const api = (path: string, token = admin) =>
  request(t.app).get(path).set('Authorization', `Bearer ${token}`);
const post = (path: string, body: object, token = admin) =>
  request(t.app).post(path).set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());

beforeEach(async () => {
  await t.reset();
  t.setClock('2026-11-10T18:00:00Z');
  admin = await t.tokenFor('super_admin', 'admin@example.com');
  const d = await t.createUser('driver@example.com', 'driver', 'أبو محمد');
  const driver = (await t.login('driver@example.com')).accessToken;
  const tn = (await post('/api/trade-names', { name: 'مخابز مكة', invoicePrefix: 'MB' })).body.data
    .id;
  const section = (await post('/api/items/sections', { name: 'خبز' })).body.data.id;
  const bread = (
    await post('/api/items', { name: 'خبز عربي', sectionId: section, unit: 'bag', basePrice: 400 })
  ).body.data.id;
  const c = (await post('/api/customers', { name: 'مطعم أ', city: 'عمّان', tradeNameId: tn })).body
    .data;
  await post('/api/contracts', {
    customerId: c.id,
    startDate: '2026-11-01',
    endDate: '2027-10-31',
    paymentType: 'credit',
    creditLimit: 30_000,
    paymentTermsDays: 30,
    overdueGraceDays: 0,
    discountBps: 0,
    allowReturns: true,
    maxReturnBps: 1000,
    renewalAlertDays: 30,
  }).expect(201);
  const route = (await post('/api/distribution/routes', { name: 'م1', driverId: d.id })).body.data
    .id;
  await request(t.app)
    .put(`/api/distribution/routes/${route}/stops`)
    .set('Authorization', `Bearer ${admin}`)
    .send({ branchIds: [c.branches[0].id] })
    .expect(200);
  await post('/api/orders', {
    branchId: c.branches[0].id,
    lines: [{ itemId: bread, quantity: 50 }],
  }).expect(201);
  t.setClock(MORNING);
  await t.app.scheduler.tick();
  const trip = (await api(`/api/driver/trips?date=${DAY}`, driver)).body.data.trips[0];
  await post(
    `/api/driver/deliveries/${trip.stops[0].deliveryId}/confirm`,
    {
      clientRef: 'phone-ref-0001',
      outcome: 'delivered',
      receiverName: 'أبو أحمد',
      deliveredAt: '2026-11-11T05:30:00Z',
      lines: [{ itemId: bread, deliveredQty: 50, returnedQty: 2, returnReason: 'unsold' }],
      collected: { amount: 5000, method: 'cash' },
    },
    driver,
  ).expect(200);
});

describe('reports', () => {
  it('lists the reports and runs each one', async () => {
    const list = (await api('/api/reports').expect(200)).body.data as {
      key: string;
      groups: { key: string }[];
    }[];
    expect(list.map((r) => r.key)).toContain('sales');
    for (const r of list)
      for (const g of r.groups.length ? r.groups.map((x) => x.key) : ['']) {
        const res = await api(
          `/api/reports/${r.key}?from=2026-11-01&to=2026-11-30&groupBy=${g}`,
        ).expect(200);
        expect(res.body.data.columns.length).toBeGreaterThan(1);
      }
  });

  it('sales by customer and by item match the invoice', async () => {
    const byCustomer = (await api(`/api/reports/sales?from=${DAY}&to=${DAY}&groupBy=customer`)).body
      .data;
    expect(byCustomer.rows).toEqual([
      expect.objectContaining({
        name: 'مطعم أ',
        invoices: 1,
        sales: 20_000,
        returns: 800,
        net: 19_200,
      }),
    ]);
    const byItem = (await api(`/api/reports/sales?from=${DAY}&to=${DAY}&groupBy=item`)).body.data;
    expect(byItem.rows[0]).toMatchObject({
      name: 'خبز عربي',
      qty: 50,
      returned_qty: 2,
      net: 19_200,
    });
    const region = (await api(`/api/reports/sales?from=${DAY}&to=${DAY}&groupBy=region`)).body.data;
    expect(region.rows[0].name).toBe('عمّان');
  });

  it('delivery, drivers, returns and credit', async () => {
    const del = (await api(`/api/reports/delivery?from=${DAY}&to=${DAY}`)).body.data;
    expect(del.rows[0]).toMatchObject({
      stops: 1,
      full: 1,
      success: 100,
      collected: 5000,
      located: 0,
    });
    const drv = (await api(`/api/reports/drivers?from=${DAY}&to=${DAY}`)).body.data;
    expect(drv.rows[0]).toMatchObject({
      name: 'أبو محمد',
      delivered: 1,
      invoiced: 19_200,
      collected: 5000,
    });
    const ret = (await api(`/api/reports/returns?from=${DAY}&to=${DAY}&groupBy=reason`)).body.data;
    expect(ret.rows[0]).toMatchObject({ name: 'لم يُبع (مرتجع)', qty: 2 });
    const credit = (await api('/api/reports/credit')).body.data;
    expect(credit.rows[0]).toMatchObject({
      limit: 30_000,
      balance: 14_200,
      usage: 47.3,
      state: 'ضمن الحد',
    });
  });

  it('exports Excel and PDF, and the full data file', async () => {
    const x = await api(`/api/reports/sales?from=${DAY}&to=${DAY}&format=xlsx`)
      .buffer(true)
      .expect(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const p = await api(`/api/reports/aging?format=pdf`).expect(200);
    expect(p.headers['content-type']).toContain('application/pdf');
    const all = await api('/api/reports/export/all').buffer(true).expect(200);
    expect(all.headers['content-disposition']).toContain('mecca-bakeries-data');
  });

  it('home numbers follow permissions', async () => {
    const k = (await api('/api/reports/kpis').expect(200)).body.data;
    expect(k.deliveries).toMatchObject({ total: 1, delivered: 1, collected: 5000 });
    expect(k.money.trend).toHaveLength(14);
    const purchaser = await t.tokenFor('purchasing', 'buy@example.com');
    const p = (await api('/api/reports/kpis', purchaser).expect(200)).body.data;
    expect(p.money).toBeUndefined();
    expect(p.purchasing).toBeDefined();
    await api('/api/reports/sales', purchaser).expect(403);
    await api('/api/reports/export/all', purchaser).expect(403);
  });
});
