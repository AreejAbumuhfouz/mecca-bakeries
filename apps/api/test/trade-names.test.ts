import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const upload = (token: string, buf: Buffer, name: string, type: string, isPublic = true) =>
  request(t.app)
    .post('/api/files')
    .set(auth(token))
    .field('isPublic', String(isPublic))
    .attach('file', buf, { filename: name, contentType: type });

describe('files', () => {
  it('uploads a public logo that loads without login', async () => {
    const up = await upload(admin, PNG, 'شعار.png', 'image/png').expect(201);
    expect(up.body.data).toMatchObject({ mimeType: 'image/png', isPublic: true, size: PNG.length });
    const file = await request(t.app).get(`/api/files/${up.body.data.id}`).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('keeps PDFs private: login and contracts.view required', async () => {
    const up = await upload(admin, Buffer.from('%PDF-1.4 test'), 'عقد.pdf', 'application/pdf');
    expect(up.status).toBe(201);
    expect(up.body.data.isPublic).toBe(false);
    const id = up.body.data.id as string;
    await request(t.app).get(`/api/files/${id}`).expect(401);
    const driver = await t.tokenFor('driver');
    await request(t.app).get(`/api/files/${id}`).set(auth(driver)).expect(403);
    await request(t.app).get(`/api/files/${id}`).set(auth(admin)).expect(200);
  });

  it('rejects other file types and users without upload rights', async () => {
    const bad = await upload(admin, Buffer.from('MZ'), 'x.exe', 'application/octet-stream');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_FILE_TYPE');
    const accountant = await t.tokenFor('accountant');
    await upload(accountant, PNG, 'a.png', 'image/png').expect(403);
  });
});

describe('trade names API', () => {
  const create = (body: object, token = admin) =>
    request(t.app).post('/api/trade-names').set(auth(token)).send(body);

  it('creates a trade name with a logo and lists it with customer counts', async () => {
    const logo = await upload(admin, PNG, 'logo.png', 'image/png').expect(201);
    const tn = await create({
      name: 'مخابز مكة',
      nameEn: 'Mecca Bakeries',
      invoicePrefix: 'mb',
      logoFileId: logo.body.data.id,
      phone: '0791234567',
    }).expect(201);
    expect(tn.body.data).toMatchObject({ invoicePrefix: 'MB', nextInvoiceNumber: 1 });

    await request(t.app)
      .post('/api/customers')
      .set(auth(admin))
      .send({ name: 'مطعم الريم', tradeNameId: tn.body.data.id })
      .expect(201);
    const list = await request(t.app).get('/api/trade-names').set(auth(admin)).expect(200);
    expect(list.body.data[0]).toMatchObject({ name: 'مخابز مكة', customerCount: 1 });

    const customers = await request(t.app)
      .get(`/api/customers?tradeNameId=${tn.body.data.id}`)
      .set(auth(admin))
      .expect(200);
    expect(customers.body.data.items[0].tradeName).toBe('مخابز مكة');
  });

  it('keeps names and invoice prefixes unique', async () => {
    await create({ name: 'مخابز مكة', invoicePrefix: 'MB' }).expect(201);
    expect((await create({ name: 'مخابز مكة', invoicePrefix: 'MK' })).body.error.code).toBe(
      'NAME_TAKEN',
    );
    expect((await create({ name: 'أفران مكة', invoicePrefix: 'mb' })).body.error.code).toBe(
      'PREFIX_TAKEN',
    );
    await create({ name: 'أفران', invoicePrefix: 'M1' }).expect(400);
  });

  it('gives each trade name its own invoice sequence that never goes backwards', async () => {
    const a = (await create({ name: 'مخابز مكة', invoicePrefix: 'MB' })).body.data;
    const b = (await create({ name: 'أفران الحرم', invoicePrefix: 'HR', nextInvoiceNumber: 500 }))
      .body.data;

    const { createTradeNamesService } =
      await import('../src/modules/trade-names/trade-names.service.js');
    const { createFilesService } = await import('../src/modules/files/files.service.js');
    const svc = createTradeNamesService(t.db, createFilesService(t.db, 'unused'));
    const got = await t.db.transaction(async (tx) => [
      await svc.allocateInvoiceNumber(tx, a.id),
      await svc.allocateInvoiceNumber(tx, a.id),
      await svc.allocateInvoiceNumber(tx, b.id),
    ]);
    expect(got.map((g) => g.formatted)).toEqual(['MB-000001', 'MB-000002', 'HR-000500']);

    const back = await request(t.app)
      .patch(`/api/trade-names/${a.id}`)
      .set(auth(admin))
      .send({ nextInvoiceNumber: 2 })
      .expect(409);
    expect(back.body.error.code).toBe('INVOICE_SEQUENCE_BACKWARDS');
    await request(t.app)
      .patch(`/api/trade-names/${a.id}`)
      .set(auth(admin))
      .send({ nextInvoiceNumber: 1000 })
      .expect(200);
  });

  it('lets only the super admin manage trade names; customer staff can read them', async () => {
    const orders = await t.tokenFor('orders');
    await create({ name: 'اسم', invoicePrefix: 'AB' }, orders).expect(403);
    await request(t.app).get('/api/trade-names').set(auth(orders)).expect(200);
    const driver = await t.tokenFor('driver');
    await request(t.app).get('/api/trade-names').set(auth(driver)).expect(403);
  });

  it('rejects a customer with an unknown trade name', async () => {
    const res = await request(t.app)
      .post('/api/customers')
      .set(auth(admin))
      .send({ name: 'مطعم', tradeNameId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
    expect(res.body.error.code).toBe('BAD_TRADE_NAME');
  });
});
