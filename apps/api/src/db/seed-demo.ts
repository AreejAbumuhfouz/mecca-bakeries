import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, like, sql } from 'drizzle-orm';
import {
  addDays,
  ammanDate,
  currentDeliveryDate,
  cutoffAt,
  parseJod,
  ROLE_PERMISSIONS,
  type AuthUser,
  type ItemUnit,
  type Role,
} from '@mecca/shared';
import { createDb } from './client.js';
import { customers, users } from './schema/index.js';
import { createFilesService } from '../modules/files/files.service.js';
import { createTradeNamesService } from '../modules/trade-names/trade-names.service.js';
import { createCustomersService } from '../modules/customers/customers.service.js';
import { createItemsService } from '../modules/items/items.service.js';
import { createContractsService } from '../modules/contracts/contracts.service.js';
import type { AuditContext } from '../modules/audit/audit.service.js';
import { createSettingsService } from '../modules/settings/settings.service.js';
import { createOrdersService } from '../modules/orders/orders.service.js';
import { captureNotifier } from '../modules/notifications/notifier.js';

/**
 * Demo data for development and client demos. All names, phones and emails are fictional.
 *   pnpm run demo         adds the data if there are no customers yet
 *   pnpm run demo:reset   deletes customers, items, contracts, trade names and demo users first
 * Dates are relative to today, so contract states (active, expiring, expired…) always show.
 */

if (process.env.NODE_ENV === 'production') throw new Error('Demo data is for development only.');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');
const reset = process.argv.includes('--reset');

const { db, close } = createDb(url);
const ctx: AuditContext = { userId: null, ip: 'demo-seed', userAgent: 'demo-seed' };
const here = path.dirname(fileURLToPath(import.meta.url));
const files = createFilesService(db, process.env.UPLOAD_DIR ?? path.join(here, '../../uploads'));
const tradeNamesSvc = createTradeNamesService(db, files);
const customersSvc = createCustomersService(db);
const itemsSvc = createItemsService(db, files);
const contractsSvc = createContractsService({ db, files });
const jod = (v: string) => parseJod(v)!;
const today = ammanDate();

if (reset) {
  // Plain DELETEs, never TRUNCATE … CASCADE: users reference customers, and a cascade
  // would wipe every account (including the admin).
  await db.delete(users).where(like(users.email, '%@example.com'));
  await db.execute(sql`UPDATE users SET customer_id = NULL`);
  for (const table of [
    'whatsapp_messages',
    'order_events',
    'order_items',
    'orders',
    'scheduler_runs',
    'contract_attachments',
    'contract_prices',
    'contracts',
    'items',
    'item_sections',
    'branches',
    'customers',
    'customer_categories',
    'trade_names',
    'files',
  ])
    await db.execute(sql.raw(`DELETE FROM ${table}`));
  for (const seq of [
    'customer_code_seq',
    'item_code_seq',
    'contract_number_seq',
    'order_number_seq',
  ])
    await db.execute(sql.raw(`ALTER SEQUENCE ${seq} RESTART WITH 1`));
  console.log('✓ Old demo data removed');
}

const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(customers);
if ((existing?.n ?? 0) > 0) {
  console.log('Customers already exist — nothing added. Use "pnpm run demo:reset" to start over.');
  await close();
  process.exit(0);
}

// ---------- staff accounts (log in with these emails; codes print in the API terminal) ----------
const staff: [string, string, Role][] = [
  ['orders@example.com', 'رامي — موظف الطلبات', 'orders'],
  ['production@example.com', 'سامر — مسؤول الإنتاج', 'production'],
  ['accountant@example.com', 'هبة — المحاسبة', 'accountant'],
  ['purchasing@example.com', 'خالد — المشتريات', 'purchasing'],
  ['driver@example.com', 'أبو محمد — سائق', 'driver'],
];
await db
  .insert(users)
  .values(staff.map(([email, name, role]) => ({ email, name, role })))
  .onConflictDoNothing();

// ---------- trade names ----------
let logoFileId: string | null = null;
try {
  const logo = await readFile(path.join(here, '../../../web/public/logo.png'));
  logoFileId = (
    await files.save(
      { buffer: logo, originalName: 'logo.png', mimeType: 'image/png', isPublic: true },
      ctx,
    )
  ).id;
} catch {
  console.log('(logo not found — trade names created without a logo)');
}
const mecca = await tradeNamesSvc.create(
  {
    name: 'مخابز مكة',
    nameEn: 'Mecca Bakeries',
    invoicePrefix: 'MB',
    logoFileId,
    phone: '06 500 0000',
    address: 'عمّان',
    invoiceFooter: 'شكراً لتعاملكم معنا',
  },
  ctx,
);
const modern = await tradeNamesSvc.create(
  {
    name: 'أفران مكة الحديثة',
    nameEn: 'Mecca Modern Ovens',
    invoicePrefix: 'MK',
    phone: '06 500 0001',
  },
  ctx,
);

// ---------- customer categories ----------
const cat: Record<string, string> = {};
for (const name of ['مطاعم', 'فنادق', 'مقاهي', 'سوبرماركت'])
  cat[name] = (await customersSvc.createCategory({ name }, ctx)).id;

// ---------- sections and items ----------
const sec: Record<string, string> = {};
for (const [i, name] of ['خبز', 'صمون وتوست', 'معجنات', 'كعك وبسكويت', 'حلويات'].entries())
  sec[name] = (await itemsSvc.createSection({ name, sortOrder: i + 1 }, ctx)).id;

const itemRows: [string, string, string, ItemUnit, string][] = [
  ['خبز', 'خبز عربي كبير', 'Large Arabic bread', 'bag', '0.350'],
  ['خبز', 'خبز عربي صغير', 'Small Arabic bread', 'bag', '0.250'],
  ['خبز', 'خبز شراك', 'Shrak bread', 'pack', '0.500'],
  ['خبز', 'خبز طابون', 'Taboon bread', 'piece', '0.150'],
  ['صمون وتوست', 'صمون فرنسي', 'French roll', 'piece', '0.060'],
  ['صمون وتوست', 'صمون ساندويش طويل', 'Sandwich roll', 'piece', '0.080'],
  ['صمون وتوست', 'خبز توست أبيض', 'White toast', 'pack', '0.750'],
  ['صمون وتوست', 'خبز توست أسمر', 'Brown toast', 'pack', '0.850'],
  ['صمون وتوست', 'خبز برغر بالسمسم', 'Sesame burger buns', 'dozen', '1.200'],
  ['صمون وتوست', 'خبز هوت دوغ', 'Hot dog buns', 'dozen', '1.100'],
  ['معجنات', 'كرواسان زبدة', 'Butter croissant', 'piece', '0.250'],
  ['معجنات', 'فطاير سبانخ', 'Spinach pies', 'dozen', '2.400'],
  ['معجنات', 'مناقيش زعتر', "Za'atar manakish", 'piece', '0.200'],
  ['معجنات', 'بيتزا ميني', 'Mini pizza', 'dozen', '2.000'],
  ['كعك وبسكويت', 'كعك بالسمسم', 'Sesame ka’ak', 'bag', '1.000'],
  ['كعك وبسكويت', 'معمول بالتمر', 'Date maamoul', 'kg', '4.500'],
  ['كعك وبسكويت', 'بقسماط', 'Rusks', 'bag', '1.250'],
  ['حلويات', 'كنافة نابلسية', 'Nabulsi knafeh', 'tray', '12.000'],
  ['حلويات', 'هريسة', 'Harissa', 'tray', '8.000'],
  ['حلويات', 'بسبوسة', 'Basbousa', 'tray', '7.500'],
];
const item: Record<string, { id: string; basePrice: number }> = {};
for (const [i, [section, name, nameEn, unit, price]] of itemRows.entries())
  item[name] = await itemsSvc.create(
    { name, nameEn, sectionId: sec[section]!, unit, basePrice: jod(price), sortOrder: i },
    ctx,
  );
// One inactive item, to show the filter.
const old = await itemsSvc.create(
  { name: 'خبز نخالة (متوقف)', sectionId: sec['خبز']!, unit: 'bag', basePrice: jod('0.400') },
  ctx,
);
await itemsSvc.update(old.id, { isActive: false }, ctx);

// ---------- customers, branches, contracts ----------
type Plan =
  | { kind: 'credit'; limit: string; discount?: number; special?: [string, string][] }
  | { kind: 'cash'; special?: [string, string][] };
type Demo = {
  name: string;
  category: string;
  tradeName: string;
  contact: string;
  phone: string;
  city: string;
  address: string;
  branches?: [string, string][];
  plan?: Plan;
  start?: number;
  end?: number;
  status?: 'suspended';
  inactive?: boolean;
};

const demo: Demo[] = [
  {
    name: 'مطعم السفرة الذهبية',
    category: 'مطاعم',
    tradeName: mecca.id,
    contact: 'أبو خالد',
    phone: '0790000101',
    city: 'عمّان',
    address: 'الصويفية - شارع الوكالات',
    branches: [['فرع خلدا', 'خلدا - شارع وصفي التل']],
    plan: {
      kind: 'credit',
      limit: '1500',
      discount: 300,
      special: [
        ['خبز عربي كبير', '0.320'],
        ['صمون فرنسي', '0.055'],
        ['كرواسان زبدة', '0.220'],
      ],
    },
  },
  {
    name: 'فندق الياسمين',
    category: 'فنادق',
    tradeName: mecca.id,
    contact: 'م. ليلى',
    phone: '0790000102',
    city: 'عمّان',
    address: 'الشميساني',
    plan: {
      kind: 'credit',
      limit: '2000',
      discount: 500,
      special: [
        ['خبز توست أبيض', '0.700'],
        ['كرواسان زبدة', '0.210'],
        ['كنافة نابلسية', '11.000'],
      ],
    },
  },
  {
    name: 'مقهى زاوية القهوة',
    category: 'مقاهي',
    tradeName: modern.id,
    contact: 'سارة',
    phone: '0790000103',
    city: 'عمّان',
    address: 'اللويبدة',
    plan: { kind: 'cash', special: [['كرواسان زبدة', '0.230']] },
  },
  {
    name: 'مطعم بيت الشاورما',
    category: 'مطاعم',
    tradeName: mecca.id,
    contact: 'أبو علي',
    phone: '0790000104',
    city: 'عمّان',
    address: 'الجبيهة',
    branches: [
      ['فرع تلاع العلي', 'تلاع العلي - شارع المدينة المنورة'],
      ['فرع مرج الحمام', 'مرج الحمام - الدوار الرئيسي'],
    ],
    plan: {
      kind: 'credit',
      limit: '1000',
      special: [
        ['خبز شراك', '0.450'],
        ['صمون ساندويش طويل', '0.070'],
      ],
    },
  },
  {
    name: 'سوبرماركت النخبة',
    category: 'سوبرماركت',
    tradeName: modern.id,
    contact: 'أحمد',
    phone: '0790000105',
    city: 'الزرقاء',
    address: 'الزرقاء الجديدة',
    branches: [['فرع الرصيفة', 'الرصيفة - الشارع الرئيسي']],
    plan: { kind: 'credit', limit: '800', discount: 200 },
  },
  {
    name: 'مطعم أكلات زمان',
    category: 'مطاعم',
    tradeName: mecca.id,
    contact: 'أم محمد',
    phone: '0790000106',
    city: 'عمّان',
    address: 'جبل الحسين',
    plan: { kind: 'credit', limit: '400', special: [['خبز طابون', '0.130']] },
  },
  {
    name: 'فندق برج الشرق',
    category: 'فنادق',
    tradeName: mecca.id,
    contact: 'م. سامي',
    phone: '0790000107',
    city: 'العقبة',
    address: 'العقبة - المنطقة الفندقية',
    plan: { kind: 'credit', limit: '1800', discount: 400 },
    start: 5,
    end: 370,
  },
  {
    name: 'مطعم سنابل البحر',
    category: 'مطاعم',
    tradeName: modern.id,
    contact: 'وليد',
    phone: '0790000108',
    city: 'عمّان',
    address: 'دابوق',
    plan: { kind: 'credit', limit: '600' },
    start: -350,
    end: 12,
  },
  {
    name: 'مقهى ليالي عمّان',
    category: 'مقاهي',
    tradeName: modern.id,
    contact: 'رنا',
    phone: '0790000109',
    city: 'عمّان',
    address: 'عبدون',
    plan: { kind: 'credit', limit: '300' },
    status: 'suspended',
  },
  {
    name: 'مطعم ورق عنب',
    category: 'مطاعم',
    tradeName: mecca.id,
    contact: 'أبو سليم',
    phone: '0790000110',
    city: 'إربد',
    address: 'إربد - شارع الجامعة',
  },
  {
    name: 'سوبرماركت الأمانة',
    category: 'سوبرماركت',
    tradeName: modern.id,
    contact: 'يوسف',
    phone: '0790000111',
    city: 'مادبا',
    address: 'مادبا - وسط البلد',
    plan: { kind: 'credit', limit: '500' },
    start: -385,
    end: -20,
  },
  {
    name: 'مطعم الطابون الأصلي',
    category: 'مطاعم',
    tradeName: mecca.id,
    contact: 'حسن',
    phone: '0790000112',
    city: 'السلط',
    address: 'السلط - البلد',
    inactive: true,
  },
];

const created: Record<string, string> = {};
for (const d of demo) {
  const c = await customersSvc.create(
    {
      name: d.name,
      categoryId: cat[d.category],
      tradeNameId: d.tradeName,
      contactName: d.contact,
      phone: d.phone,
      city: d.city,
      address: d.address,
    },
    ctx,
  );
  created[d.name] = c.id;
  for (const [name, address] of d.branches ?? [])
    await customersSvc.createBranch(c.id, { name, address, city: d.city }, ctx);
  if (d.inactive) await customersSvc.update(c.id, { isActive: false }, ctx);
  if (!d.plan) continue;

  const startDate = addDays(today, d.start ?? -2);
  const endDate = addDays(today, d.end ?? 363);
  const contract = await contractsSvc.create(
    {
      customerId: c.id,
      startDate,
      endDate,
      paymentType: d.plan.kind,
      creditLimit: d.plan.kind === 'credit' ? jod(d.plan.limit) : 0,
      paymentTermsDays: d.plan.kind === 'credit' ? 30 : 0,
      overdueGraceDays: 7,
      discountBps: d.plan.kind === 'credit' ? (d.plan.discount ?? 0) : 0,
      allowReturns: d.category !== 'سوبرماركت',
      maxReturnBps: d.category !== 'سوبرماركت' ? 500 : 0,
      returnsNotes: d.category !== 'سوبرماركت' ? 'المرتجعات في نفس يوم التسليم فقط' : null,
      renewalAlertDays: 30,
      prices: (d.plan.special ?? []).map(([name, price]) => ({
        itemId: item[name]!.id,
        price: jod(price),
      })),
    },
    ctx,
  );
  if (d.status) await contractsSvc.update(contract.id, { status: d.status }, ctx);
}

// ---------- restaurant app account and orders ----------
await db.insert(users).values({
  email: 'restaurant@example.com',
  name: 'مطعم السفرة الذهبية — التطبيق',
  role: 'restaurant',
  customerId: created['مطعم السفرة الذهبية']!,
});
const [clerk] = await db.select().from(users).where(eq(users.email, 'orders@example.com'));
const actor: AuthUser = {
  id: clerk!.id,
  email: clerk!.email,
  name: clerk!.name,
  role: 'orders',
  customerId: null,
  permissions: [...ROLE_PERMISSIONS.orders, 'credit.override'],
};
const settingsSvc = createSettingsService(db);
const { notifier } = captureNotifier(); // demo orders send no messages
const { cutoffTime } = await settingsSvc.getOrderSettings();
const ordersAt = (at: Date) =>
  createOrdersService({ db, settings: settingsSvc, notifier, now: () => at });
const current = currentDeliveryDate(new Date(), cutoffTime);
const previous = addDays(current, -1);

const baskets: Record<string, [string, number][]> = {
  'مطعم السفرة الذهبية': [
    ['خبز عربي كبير', 40],
    ['صمون فرنسي', 120],
    ['كرواسان زبدة', 30],
  ],
  'فندق الياسمين': [
    ['خبز توست أبيض', 25],
    ['كرواسان زبدة', 80],
    ['خبز برغر بالسمسم', 6],
    ['كنافة نابلسية', 2],
  ],
  'مقهى زاوية القهوة': [
    ['كرواسان زبدة', 24],
    ['مناقيش زعتر', 20],
  ],
  'مطعم بيت الشاورما': [
    ['خبز شراك', 60],
    ['صمون ساندويش طويل', 150],
  ],
  'سوبرماركت النخبة': [
    ['خبز عربي كبير', 100],
    ['خبز عربي صغير', 80],
    ['خبز توست أسمر', 30],
  ],
  'مطعم أكلات زمان': [
    ['خبز طابون', 50],
    ['خبز عربي صغير', 20],
  ],
  'مطعم سنابل البحر': [
    ['خبز عربي كبير', 30],
    ['خبز هوت دوغ', 4],
  ],
};
const branchesOf = async (name: string) =>
  (await customersSvc.get(created[name]!)).branches.filter((b) => b.isActive);
const lines = (basket: [string, number][], factor = 1) =>
  basket.map(([name, q]) => ({
    itemId: item[name]!.id,
    quantity: Math.max(1, Math.round(q * factor)),
  }));

// Yesterday: placed the evening before, confirmed at the cutoff.
const yesterdayEvening = ordersAt(
  new Date(cutoffAt(previous, cutoffTime).getTime() - 5 * 3_600_000),
);
let orderCount = 0;
for (const [name, basket] of Object.entries(baskets))
  for (const b of await branchesOf(name)) {
    await yesterdayEvening.place(
      actor,
      { branchId: b.id, deliveryDate: previous, lines: lines(basket) },
      'app',
      ctx,
    );
    orderCount++;
  }
await ordersAt(new Date(cutoffAt(previous, cutoffTime).getTime() + 5 * 60_000)).closeOrdering(
  previous,
);

// Current delivery date: some branches ordered, some not yet; one order is over its credit limit.
const live = ordersAt(new Date());
for (const name of ['مطعم السفرة الذهبية', 'فندق الياسمين', 'مطعم بيت الشاورما'])
  for (const b of (await branchesOf(name)).slice(0, 2)) {
    await live.place(actor, { branchId: b.id, lines: lines(baskets[name]!, 1.1) }, 'app', ctx);
    orderCount++;
  }
const [zaman] = await branchesOf('مطعم أكلات زمان');
await live.place(
  actor,
  { branchId: zaman!.id, lines: [{ itemId: item['كنافة نابلسية']!.id, quantity: 40 }] },
  'app',
  ctx,
);
orderCount++;

console.log(`✓ Demo data added:
  - ${staff.length} staff accounts: ${staff.map(([e]) => e).join(', ')}
  - 2 trade names, 4 customer categories, 5 sections, ${itemRows.length + 1} items
  - ${demo.length} customers with branches; contracts: active, cash, expiring, not started,
    suspended, expired, and one customer with no contract
  - ${orderCount} orders: yesterday (${previous}) confirmed, today (${current}) open, one held for credit approval
  - restaurant app account: restaurant@example.com (مطعم السفرة الذهبية)`);
await close();
