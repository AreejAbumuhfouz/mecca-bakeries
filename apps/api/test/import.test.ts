import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
const auth = () => ({ Authorization: `Bearer ${admin}` });

/** Downloads the template and fills its data sheet with rows (header kept). */
async function filled(kind: string, rows: (string | number | null)[][]) {
  const res = await request(t.app)
    .get(`/api/import/${kind}/template`)
    .set(auth())
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  const ws = wb.getWorksheet('البيانات')!;
  ws.spliceRows(2, 1); // remove the example row
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const send = (kind: string, step: 'preview' | 'commit', file: Buffer) =>
  request(t.app).post(`/api/import/${kind}/${step}`).set(auth()).attach('file', file, 'data.xlsx');

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  t.setClock('2026-11-10T08:00:00Z');
  admin = await t.tokenFor('super_admin', 'admin@example.com');
  await request(t.app)
    .post('/api/trade-names')
    .set(auth())
    .send({ name: 'مخابز مكة', invoicePrefix: 'MB' })
    .expect(201);
});

describe('Excel import', () => {
  it('previews errors, then imports customers, items, contracts, prices and opening balances', async () => {
    // customers: one good, one with an unknown trade name
    let file = await filled('customers', [
      [
        '',
        'مطعم الأصيل',
        '',
        'مطاعم',
        'مخابز مكة',
        'أبو علي',
        '0791112223',
        '',
        'عمّان',
        'خلدا',
        'الفرع الرئيسي',
        '',
        '',
      ],
      ['', 'مطعم بلا اسم تجاري', '', '', 'غير موجود', '', '', '', '', '', '', '', ''],
    ]);
    let r = await send('customers', 'preview', file).expect(200);
    expect(r.body.data.summary).toMatchObject({ total: 2, create: 1, errors: 1 });
    expect(r.body.data.rows[1].errors[0]).toContain('الاسم التجاري');
    r = await send('customers', 'commit', file).expect(422);
    expect(r.body.error.code).toBe('IMPORT_ERRORS');

    file = await filled('customers', [
      [
        '',
        'مطعم الأصيل',
        '',
        'مطاعم',
        'مخابز مكة',
        'أبو علي',
        '٠٧٩١١١٢٢٢٣',
        '',
        'عمّان',
        'خلدا',
        'فرع خلدا',
        '',
        '',
      ],
    ]);
    r = await send('customers', 'commit', file).expect(200);
    expect(r.body.data.created).toBe(1);
    const customers = (await request(t.app).get('/api/customers?search=الأصيل').set(auth())).body
      .data.items;
    expect(customers[0]).toMatchObject({ name: 'مطعم الأصيل', phone: '0791112223', city: 'عمّان' });
    const code = customers[0].code as string;
    // importing the same file again does not duplicate
    r = await send('customers', 'preview', file).expect(200);
    expect(r.body.data.summary).toMatchObject({ create: 0, skip: 1 });

    r = await send(
      'items',
      'commit',
      await filled('items', [
        ['', 'خبز عربي كبير', '', 'خبز', 'كيس', 0.35],
        ['', 'كرواسان', '', 'معجنات', 'حبة', '0.250'],
      ]),
    ).expect(200);
    expect(r.body.data.created).toBe(2);
    const items = (await request(t.app).get('/api/items?pageSize=50').set(auth())).body.data.items;
    expect(items.map((i: { basePrice: number }) => i.basePrice).sort()).toEqual([250, 350]);

    r = await send(
      'contracts',
      'commit',
      await filled('contracts', [
        [code, '2026-11-01', '31-10-2027', 'آجل', 1500, 30, 7, 5, 'نعم', 10],
      ]),
    ).expect(200);
    expect(r.body.data.created).toBe(1);

    r = await send('prices', 'commit', await filled('prices', [[code, 'كرواسان', 0.2]])).expect(
      200,
    );
    expect(r.body.data.created).toBe(1);
    const contract = (await request(t.app).get('/api/contracts').set(auth())).body.data.items[0];
    const detail = (await request(t.app).get(`/api/contracts/${contract.id}`).set(auth())).body
      .data;
    expect(detail).toMatchObject({
      creditLimit: 1_500_000,
      discountBps: 500,
      allowReturns: true,
      maxReturnBps: 1000,
    });
    expect(detail.prices[0].price).toBe(200);

    r = await send(
      'opening',
      'preview',
      await filled('opening', [
        [code, 420.5, '2026-09-30', ''],
        ['C9999', 10, '2026-09-30', ''],
      ]),
    ).expect(200);
    expect(r.body.data.summary).toMatchObject({ errors: 1, openingTotal: 420_500 });
    r = await send(
      'opening',
      'commit',
      await filled('opening', [[code, 420.5, '2026-09-30', '']]),
    ).expect(200);
    const check = (await request(t.app).get('/api/import/opening-check').set(auth()).expect(200))
      .body.data;
    expect(check).toMatchObject({ total: 420_500, remaining: 420_500 });
  });

  it('refuses a file that is not the template, and other roles', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['a', 'b']);
    const r = await send('items', 'preview', Buffer.from(await wb.xlsx.writeBuffer())).expect(422);
    expect(r.body.error.code).toBe('BAD_TEMPLATE');
    const acc = await t.tokenFor('accountant', 'acc@example.com');
    await request(t.app)
      .get('/api/import')
      .set({ Authorization: `Bearer ${acc}` })
      .expect(403);
  });
});
