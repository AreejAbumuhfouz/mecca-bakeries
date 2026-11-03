import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { purchaseOrderHtml } from '../src/modules/purchasing/purchase-order-pdf.js';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let buyer: string;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = (method: 'get' | 'post' | 'patch', path: string, body?: object, token = buyer) => {
  const r = request(t.app)[method](path).set(auth(token));
  return body ? r.send(body) : r;
};

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  buyer = await t.tokenFor('purchasing');
});

const lines = [
  { description: 'طحين زيرو', quantity: 20, unit: 'كيس 50 كغ' },
  { description: 'سمسم محمص', quantity: 12.5, unit: 'كغ', note: 'نفس نوع المرة الماضية' },
];

describe('suppliers and purchase orders', () => {
  it('creates a purchase order, sends its PDF on WhatsApp and tracks its status', async () => {
    const s = await api('post', '/api/purchasing/suppliers', {
      name: 'مطحنة الشرق',
      contactName: 'أبو فادي',
      whatsappPhone: '0795555555',
    }).expect(201);
    await api('post', '/api/purchasing/suppliers', { name: 'مطحنة الشرق' }).expect(409);

    const po = (
      await api('post', '/api/purchasing/orders', {
        supplierId: s.body.data.id,
        neededDate: '2026-11-12',
        lines,
      }).expect(201)
    ).body.data;
    expect(po).toMatchObject({ number: 'PO-0001', status: 'draft' });
    expect(po.lines.map((l: { quantity: string }) => Number(l.quantity))).toEqual([20, 12.5]);

    await api('patch', `/api/purchasing/orders/${po.id}`, { notes: 'التوصيل صباحاً' }).expect(200);

    const pdf = await api('get', `/api/purchasing/orders/${po.id}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');

    const sent = (await api('post', `/api/purchasing/orders/${po.id}/send`).expect(200)).body.data;
    expect(sent).toMatchObject({ status: 'sent', delivered: true });
    const msg = t.whatsappSent.at(-1)!.body as {
      to: string;
      template: {
        name: string;
        components: {
          type: string;
          parameters: {
            type: string;
            document?: { id: string; filename: string };
            text?: string;
          }[];
        }[];
      };
    };
    expect(msg.to).toBe('962795555555');
    expect(msg.template.name).toBe('mb_purchase_order');
    expect(msg.template.components[0]!.parameters[0]!.document).toEqual({
      id: 'test-media',
      filename: 'PO-0001.pdf',
    });
    expect(msg.template.components[1]!.parameters.map((p) => p.text)).toEqual([
      'PO-0001',
      '2026-11-12',
    ]);
    expect(sent.messages[0]).toMatchObject({ status: 'sent', phone: '962795555555' });

    const locked = await api('patch', `/api/purchasing/orders/${po.id}`, { notes: 'x' }).expect(
      409,
    );
    expect(locked.body.error.code).toBe('PO_LOCKED');

    await api('post', `/api/purchasing/orders/${po.id}/status`, { status: 'confirmed' }).expect(
      200,
    );
    await api('post', `/api/purchasing/orders/${po.id}/status`, { status: 'received' }).expect(200);
    const bad = await api('post', `/api/purchasing/orders/${po.id}/status`, {
      status: 'cancelled',
    }).expect(409);
    expect(bad.body.error.code).toBe('BAD_TRANSITION');

    const list = (await api('get', '/api/purchasing/orders?status=received').expect(200)).body.data;
    expect(list.items[0]).toMatchObject({ supplierName: 'مطحنة الشرق', lineCount: 2 });
    const suppliers = (await api('get', '/api/purchasing/suppliers').expect(200)).body.data;
    expect(suppliers[0].orderCount).toBe(1);
  });

  it('refuses to send without a WhatsApp number and validates lines', async () => {
    const s = await api('post', '/api/purchasing/suppliers', { name: 'مورد بدون رقم' });
    const po = await api('post', '/api/purchasing/orders', { supplierId: s.body.data.id, lines });
    const res = await api('post', `/api/purchasing/orders/${po.body.data.id}/send`).expect(400);
    expect(res.body.error.code).toBe('NO_PHONE');
    await api('post', '/api/purchasing/orders', { supplierId: s.body.data.id, lines: [] }).expect(
      400,
    );
    await api('post', '/api/purchasing/orders', {
      supplierId: s.body.data.id,
      lines: [{ description: 'سكر', quantity: -1, unit: 'كغ' }],
    }).expect(400);
  });

  it('is limited to purchasing staff', async () => {
    const clerk = await t.tokenFor('orders');
    await api('get', '/api/purchasing/orders', undefined, clerk).expect(403);
  });

  it('builds an RTL Arabic document and escapes user text', () => {
    const html = purchaseOrderHtml({
      number: 'PO-0007',
      createdAt: new Date('2026-11-10T10:00:00Z'),
      neededDate: null,
      notes: '<script>x</script>',
      supplier: { name: 'مورد', contactName: null, phone: null, address: null },
      bakery: { name: 'مخابز مكة', phone: null, address: null, logoDataUrl: null },
      lines: [{ description: 'طحين & ملح', quantity: '2.500', unit: 'كغ', note: null }],
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('طحين &amp; ملح');
    expect(html).toContain('>2.5<');
    expect(html).not.toContain('<script>x');
  });
});
