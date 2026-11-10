import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, like, sql } from 'drizzle-orm';
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
import {
  branches,
  customers,
  deliveries,
  deliveryLines,
  invoices,
  orderItems,
  orders,
  productionDays,
  productionItems,
  routeStops,
  routes,
  stockLosses,
  trips,
  users,
} from './schema/index.js';
import { createFilesService } from '../modules/files/files.service.js';
import { createTradeNamesService } from '../modules/trade-names/trade-names.service.js';
import { createCustomersService } from '../modules/customers/customers.service.js';
import { createItemsService } from '../modules/items/items.service.js';
import { createContractsService } from '../modules/contracts/contracts.service.js';
import type { AuditContext } from '../modules/audit/audit.service.js';
import { createSettingsService } from '../modules/settings/settings.service.js';
import { createOrdersService } from '../modules/orders/orders.service.js';
import { captureNotifier } from '../modules/notifications/notifier.js';
import { createProductionService } from '../modules/production/production.service.js';
import { createPurchasingService } from '../modules/purchasing/purchasing.service.js';
import { createWhatsAppService } from '../modules/whatsapp/whatsapp.service.js';
import { createBillingService } from '../modules/billing/billing.service.js';
import { createDistributionService } from '../modules/distribution/distribution.service.js';

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
    'payment_allocations',
    'payments',
    'invoice_revisions',
    'invoice_lines',
    'invoices',
    'delivery_lines',
    'deliveries',
    'trips',
    'route_stops',
    'routes',
    'variance_approvals',
    'stock_losses',
    'vehicle_loads',
    'production_items',
    'production_days',
    'purchase_order_lines',
    'purchase_orders',
    'suppliers',
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
    'production_lines',
    'vehicles',
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
    'purchase_order_number_seq',
    'payment_number_seq',
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
  locale: 'ar' as const,
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

// ---------- production (phase 3) ----------
const [boss] = await db.select().from(users).where(eq(users.email, 'production@example.com'));
const producer: AuthUser = {
  id: boss!.id,
  email: boss!.email,
  name: boss!.name,
  role: 'production',
  customerId: null,
  permissions: [...ROLE_PERMISSIONS.production, 'variances.approve'],
  locale: 'ar' as const,
};
const productionAt = (at: Date) =>
  createProductionService({ db, settings: settingsSvc, now: () => at });
const prod = productionAt(new Date());
const lineIds: Record<string, string> = {};
for (const [i, name] of ['خط الخبز', 'خط الصمون والمعجنات', 'خط الحلويات'].entries())
  lineIds[name] = (await prod.saveLine(null, { name, sortOrder: i + 1 }, ctx)).id;
const sectionLine: Record<string, string> = {
  خبز: 'خط الخبز',
  'صمون وتوست': 'خط الصمون والمعجنات',
  معجنات: 'خط الصمون والمعجنات',
  'كعك وبسكويت': 'خط الحلويات',
  حلويات: 'خط الحلويات',
};
for (const [section, line] of Object.entries(sectionLine))
  await itemsSvc.updateSection(sec[section]!, { productionLineId: lineIds[line]! }, ctx);
const vehicleIds: string[] = [];
for (const [name, plate, driverName] of [
  ['سيارة 1 — عمّان الغربية', '12-34567', 'أبو محمد'],
  ['سيارة 2 — عمّان الشرقية والزرقاء', '12-76543', 'أبو يوسف'],
  ['سيارة 3 — المحافظات', '13-11122', 'أبو فادي'],
])
  vehicleIds.push((await prod.saveVehicle(null, { name, plate, driverName }, ctx)).id);

// Yesterday: final plan after the cutoff, produced, loaded, some waste, one approved variance, closed.
const afterCutoff = productionAt(new Date(cutoffAt(previous, cutoffTime).getTime() + 10 * 60_000));
await afterCutoff.generate(previous, ctx);
const dayOf = async (d: string) => {
  const v = await afterCutoff.getDay(d);
  if (!v) throw new Error(`No production plan for ${d}`);
  return v;
};
let day = await dayOf(previous);
const extraOf = (ordered: number) => Math.max(1, Math.round(ordered * 0.05));
await afterCutoff.updateItems(
  previous,
  day.items.map((r) => ({ itemId: r.itemId, extraQty: extraOf(r.ordered) })),
  producer,
  ctx,
);
day = await dayOf(previous);
// The first item is under-produced by 10% so a variance needs approval.
const short = day.items[0]!;
await afterCutoff.updateItems(
  previous,
  day.items.map((r) => ({
    itemId: r.itemId,
    producedQty: r === short ? Math.round(r.ordered * 0.9) : r.planned,
  })),
  producer,
  ctx,
);
// Spread the ordered quantities over the three vehicles; the short item loads what was made.
const loads: { itemId: string; quantity: number }[][] = [[], [], []];
for (const r of day.items) {
  const total = r === short ? Math.round(r.ordered * 0.9) : r.ordered;
  const a = Math.floor(total / 2);
  const b = Math.floor((total - a) / 2);
  for (const [v, q] of [a, b, total - a - b].entries())
    if (q > 0) loads[v]!.push({ itemId: r.itemId, quantity: q });
}
for (const [v, lines] of loads.entries())
  await afterCutoff.setLoads(previous, vehicleIds[v]!, lines, ctx);
// Waste equals the extra that was not loaded, so the rest balance out.
for (const r of day.items.filter((x) => x !== short).slice(0, 2))
  await afterCutoff.addLoss(
    previous,
    { itemId: r.itemId, kind: 'waste', reason: 'burnt', quantity: r.extra, note: 'احترق في الفرن' },
    producer,
    ctx,
  );
day = await dayOf(previous);
for (const r of day.items.filter((x) => x.needsApproval))
  await afterCutoff.approveVariance(
    previous,
    r.itemId,
    r.itemId === short.itemId
      ? 'نقص في الطحين صباحاً، تم إبلاغ الزبائن'
      : 'الزيادة بقيت في المخبز وبيعت في الصالة',
    producer,
    ctx,
  );
await afterCutoff.close(previous, producer, ctx);

// Today: a preliminary plan from the orders placed so far.
await prod.generate(current, ctx);

// ---------- suppliers and purchase orders ----------
const purchasing = createPurchasingService({
  db,
  whatsapp: createWhatsAppService({ db, config: null }),
  files,
  pdf: async () => Buffer.from(''),
});
const supplierIds: string[] = [];
for (const [name, contactName, phone] of [
  ['مطاحن الشرق للطحين', 'أبو أحمد', '0790000201'],
  ['شركة الألبان الذهبية', 'نادر', '0790000202'],
  ['مؤسسة التغليف الحديث', 'م. هالة', '0790000203'],
])
  supplierIds.push(
    (await purchasing.saveSupplier(null, { name, contactName, phone, whatsappPhone: phone }, ctx))
      .id,
  );
const [buyer] = await db.select().from(users).where(eq(users.email, 'purchasing@example.com'));
const purchaser: AuthUser = {
  id: buyer!.id,
  email: buyer!.email,
  name: buyer!.name,
  role: 'purchasing',
  customerId: null,
  permissions: [...ROLE_PERMISSIONS.purchasing],
  locale: 'ar' as const,
};
const pos: [
  number,
  [string, number, string][],
  ('sent' | 'confirmed' | 'received' | 'cancelled')[],
][] = [
  [
    0,
    [
      ['طحين زيرو', 40, 'كيس'],
      ['طحين أسمر', 10, 'كيس'],
      ['سميد', 5, 'كيس'],
    ],
    ['sent', 'received'],
  ],
  [
    1,
    [
      ['زبدة', 60, 'كغ'],
      ['حليب طازج', 40, 'لتر'],
      ['جبنة عكاوي', 25, 'كغ'],
    ],
    ['sent', 'confirmed'],
  ],
  [
    2,
    [
      ['أكياس خبز مطبوعة', 20, 'رول'],
      ['علب كرواسان', 10, 'كرتونة'],
    ],
    ['sent'],
  ],
  [
    0,
    [
      ['خميرة فورية', 12, 'كرتونة'],
      ['سكر', 10, 'كيس'],
    ],
    [],
  ],
  [2, [['صواني كنافة ألمنيوم', 5, 'كرتونة']], ['cancelled']],
];
for (const [s, items, steps] of pos) {
  const po = await purchasing.create(
    {
      supplierId: supplierIds[s]!,
      neededDate: addDays(today, 2),
      notes: 'التسليم صباحاً قبل الساعة 8',
      lines: items.map(([description, quantity, unit]) => ({ description, quantity, unit })),
    },
    purchaser,
    ctx,
  );
  for (const st of steps) await purchasing.setStatus(po.id, st, ctx);
}

// ---------- distribution, invoices and collections (phase 4) ----------
const noPdf = async () => Buffer.from('');
const billing = createBillingService({ db, files, pdf: noPdf });
const distribution = createDistributionService({ db, billing, files, pdf: noPdf });
const [driver1] = await db.select().from(users).where(eq(users.email, 'driver@example.com'));
const [driver2, driver3] = await db
  .insert(users)
  .values([
    { email: 'driver2@example.com', name: 'أبو يوسف — سائق', role: 'driver' },
    { email: 'driver3@example.com', name: 'أبو فادي — سائق', role: 'driver' },
  ])
  .returning();
const allBranches = await db
  .select({ id: branches.id, customerId: branches.customerId, city: customers.city })
  .from(branches)
  .innerJoin(customers, eq(customers.id, branches.customerId))
  .where(and(eq(branches.isActive, true), eq(customers.isActive, true)));
const routePlan: [string, (city: string | null) => boolean, string][] = [
  ['مسار عمّان الغربية', (c) => c === 'عمّان', driver1!.id],
  ['مسار الزرقاء ومادبا', (c) => c === 'الزرقاء' || c === 'مادبا', driver2!.id],
  ['مسار المحافظات', (c) => c !== 'عمّان' && c !== 'الزرقاء' && c !== 'مادبا', driver3!.id],
];
for (const [i, [name, match, driverId]] of routePlan.entries()) {
  const r = await distribution.saveRoute(
    null,
    { name, driverId, vehicleId: vehicleIds[i] ?? null, sortOrder: i + 1 },
    ctx,
  );
  await distribution.setStops(
    r.id,
    allBranches.filter((b) => match(b.city)).map((b) => b.id),
    ctx,
  );
}

const admin = {
  ...actor,
  role: 'super_admin' as const,
  permissions: [...ROLE_PERMISSIONS.super_admin],
  locale: 'ar' as const,
};

// History: the two weeks before today, delivered and invoiced, so reports and the home chart
// have something to show. Built from today's orders with quantities varied day to day.
const todays = await db
  .select({ order: orders, routeId: routeStops.routeId, position: routeStops.position })
  .from(orders)
  .innerJoin(routeStops, eq(routeStops.branchId, orders.branchId))
  .where(and(eq(orders.deliveryDate, previous), eq(orders.status, 'confirmed')));
const todaysItems = await db.select().from(orderItems);
const allRoutes = await db.select().from(routes);
let seedRand = 42;
const rand = () => ((seedRand = (seedRand * 16807) % 2147483647) - 1) / 2147483646;
const historyDays = 13;
let historyInvoices = 0;
for (let k = historyDays; k >= 1; k--) {
  const day = addDays(previous, -k);
  const at = (h: number) => new Date(cutoffAt(day, cutoffTime).getTime() + h * 3_600_000);
  await db.transaction(async (tx) => {
    const tripOf = new Map<string, string>();
    const made = new Map<string, number>();
    for (const r of allRoutes) {
      const [tr] = await tx
        .insert(trips)
        .values({
          deliveryDate: day,
          routeId: r.id,
          driverId: r.driverId,
          vehicleId: r.vehicleId,
          status: 'done',
          startedAt: at(3),
          finishedAt: at(3 + 2 + rand() * 2),
        })
        .returning();
      tripOf.set(r.id, tr!.id);
    }
    for (const t of todays) {
      if (rand() < 0.12) continue; // some customers skip a day
      const factor = 0.75 + rand() * 0.5;
      const lines = todaysItems
        .filter((i) => i.orderId === t.order.id)
        .map((i) => ({ ...i, quantity: Math.max(1, Math.round(i.quantity * factor)) }));
      const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
      const [n] = await tx.execute<{ n: string }>(sql`select nextval('order_number_seq') as n`);
      const [o] = await tx
        .insert(orders)
        .values({
          number: `ORD-${String(Number(n!.n)).padStart(6, '0')}`,
          customerId: t.order.customerId,
          branchId: t.order.branchId,
          contractId: t.order.contractId,
          deliveryDate: day,
          status: 'delivered',
          source: t.order.source,
          total,
          itemCount: lines.length,
          submittedAt: at(-6),
          confirmedAt: at(0),
        })
        .returning();
      await tx.insert(orderItems).values(
        lines.map((l) => ({
          orderId: o!.id,
          itemId: l.itemId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          priceSource: l.priceSource,
          lineTotal: l.quantity * l.unitPrice,
        })),
      );
      const short = rand() < 0.15;
      const delivered = lines.map((l, j) => ({
        itemId: l.itemId,
        orderedQty: l.quantity,
        deliveredQty: short && j === 0 ? Math.round(l.quantity * 0.9) : l.quantity,
        shortReason: short && j === 0 ? ('bakery_shortage' as const) : null,
        returnedQty: 0,
        returnReason: null,
      }));
      for (const l of delivered) made.set(l.itemId, (made.get(l.itemId) ?? 0) + l.orderedQty);
      const [d] = await tx
        .insert(deliveries)
        .values({
          tripId: tripOf.get(t.routeId)!,
          orderId: o!.id,
          position: t.position,
          status: short ? 'partial' : 'delivered',
          receiverName: 'المستلم',
          deliveredAt: at(4 + rand() * 2),
          confirmedAt: at(4 + rand() * 2),
          latitude: 31.9 + rand() * 0.1,
          longitude: 35.85 + rand() * 0.1,
          clientRef: `demo-history-${o!.id}`,
        })
        .returning();
      await tx.insert(deliveryLines).values(delivered.map((l) => ({ ...l, deliveryId: d!.id })));
      const inv = await billing.createFromDelivery(tx, {
        orderId: o!.id,
        deliveryId: d!.id,
        lines: delivered,
        actorId: admin.id,
      });
      if (inv) {
        await tx
          .update(invoices)
          .set({ status: 'approved', approvedBy: admin.id, approvedAt: at(8) })
          .where(eq(invoices.id, inv.id));
        historyInvoices++;
        // Cash customers pay the driver; most credit customers pay invoices older than a week.
        const contract = t.order.contractId
          ? await tx.query.contracts.findFirst({
              where: (c, { eq: e }) => e(c.id, t.order.contractId!),
            })
          : null;
        const pays = contract?.paymentType === 'cash' || (k > 7 && rand() < 0.6);
        if (pays)
          await billing.insertPayment(
            tx,
            {
              customerId: t.order.customerId,
              amount: inv.total,
              method:
                contract?.paymentType === 'cash' ? 'cash' : rand() < 0.5 ? 'transfer' : 'cheque',
              reference: contract?.paymentType === 'cash' ? null : `H${Math.round(rand() * 1e6)}`,
              receivedOn: contract?.paymentType === 'cash' ? day : addDays(day, 5),
              // Paid against this invoice, so the old opening balances stay overdue in the demo.
              allocations: [{ invoiceId: inv.id, amount: inv.total }],
            },
            {
              source: contract?.paymentType === 'cash' ? 'driver' : 'office',
              deliveryId: contract?.paymentType === 'cash' ? d!.id : null,
              receivedBy: admin.id,
            },
          );
        await billing.rebalance(tx, t.order.customerId);
      }
    }
    // A closed production day to match.
    const [pd] = await tx
      .insert(productionDays)
      .values({
        deliveryDate: day,
        status: 'closed',
        generatedAt: at(0),
        finalizedAt: at(0),
        closedAt: at(9),
        closedBy: admin.id,
      })
      .returning();
    const prodRows = [...made].map(([itemId, qty]) => {
      const extra = Math.max(1, Math.round(qty * 0.03));
      return { dayId: pd!.id, itemId, orderedQty: qty, extraQty: extra, producedQty: qty + extra };
    });
    if (prodRows.length) await tx.insert(productionItems).values(prodRows);
    const wasted = prodRows.filter(() => rand() < 0.3);
    if (wasted.length)
      await tx.insert(stockLosses).values(
        wasted.map((r) => ({
          dayId: pd!.id,
          itemId: r.itemId,
          kind: 'waste' as const,
          reason: (['burnt', 'damaged', 'shape'] as const)[Math.floor(rand() * 3)]!,
          quantity: r.extraQty,
          createdBy: admin.id,
        })),
      );
  });
}

// Opening balances from before the system: two customers with old, overdue debt.
await billing.createOpening(
  created['مطعم بيت الشاورما']!,
  { amount: jod('420'), date: addDays(today, -75), note: 'رصيد منقول من الدفاتر' },
  admin,
  ctx,
);
await billing.createOpening(
  created['سوبرماركت النخبة']!,
  { amount: jod('260'), date: addDays(today, -40), note: 'رصيد منقول من الدفاتر' },
  admin,
  ctx,
);
await billing.createOpening(
  created['فندق الياسمين']!,
  { amount: jod('150'), date: addDays(today, 10), note: 'رصيد منقول من الدفاتر' },
  admin,
  ctx,
);

// Today's deliveries: trips from the confirmed orders; most stops delivered, some left for the app.
const dayTrips = await distribution.generate(previous, ctx);
const driverActor = (u: typeof driver1) => ({
  id: u!.id,
  email: u!.email,
  name: u!.name,
  role: 'driver' as const,
  customerId: null,
  permissions: [...ROLE_PERMISSIONS.driver],
  locale: 'ar' as const,
});
const drivers = [driver1, driver2, driver3];
let deliveredCount = 0;
let leftForApp = 0;
for (const t of dayTrips.trips) {
  const detail = await distribution.trip(t.id);
  const who = driverActor(drivers.find((d) => d!.id === detail.driver?.id) ?? driver1);
  for (const [i, s] of detail.stops.entries()) {
    // Driver 1 still has the last two stops of the day to do in the app.
    if (detail.driver?.id === driver1!.id && i >= detail.stops.length - 2) {
      leftForApp++;
      continue;
    }
    const at = new Date(Date.now() - (detail.stops.length - i) * 20 * 60_000).toISOString();
    const base = {
      clientRef: `demo-${s.deliveryId}`,
      deliveredAt: at,
      latitude: 31.95 + i * 0.01,
      longitude: 35.88 + i * 0.01,
      accuracyM: 15,
      receiverName: ['أبو خالد', 'م. ليلى', 'سارة', 'أبو علي', 'أحمد'][i % 5]!,
    };
    if (i === 1 && detail.driver?.id === driver2!.id) {
      await distribution.confirm(
        s.deliveryId,
        { ...base, outcome: 'failed', failReason: 'shop_closed', lines: [] },
        who,
        ctx,
      );
      continue;
    }
    const short = i === 0; // first stop of each trip is short by 10% on its first item
    const lines = s.items.map((it, j) => ({
      itemId: it.itemId,
      deliveredQty: short && j === 0 ? Math.round(it.quantity * 0.9) : it.quantity,
      shortReason: short && j === 0 ? ('bakery_shortage' as const) : null,
      returnedQty: s.allowReturns && j === 0 && i === 2 ? 3 : 0,
      returnReason: s.allowReturns && j === 0 && i === 2 ? ('unsold' as const) : null,
    }));
    const value = lines.reduce((sum, l, j) => sum + l.deliveredQty * s.items[j]!.unitPrice, 0);
    await distribution.confirm(
      s.deliveryId,
      {
        ...base,
        outcome: 'delivered',
        lines,
        collected:
          s.paymentType === 'cash' || i % 3 === 0
            ? { amount: s.paymentType === 'cash' ? value : Math.round(value / 2), method: 'cash' }
            : null,
      },
      who,
      ctx,
    );
    deliveredCount++;
  }
}
// The accountant approves part of the day; the rest stays as drafts to review.
const drafts = await billing.draftIds(previous);
await billing.approve(drafts.slice(0, Math.ceil(drafts.length / 2)), admin, ctx);

// Office payments: a cheque against the oldest debt, a transfer.
await billing.createPayment(
  {
    customerId: created['مطعم بيت الشاورما']!,
    amount: jod('200'),
    method: 'cheque',
    reference: '000123',
    chequeDueDate: addDays(today, 15),
    receivedOn: addDays(today, -5),
    note: 'دفعة على الحساب',
  },
  admin,
  ctx,
);
await billing.createPayment(
  {
    customerId: created['فندق الياسمين']!,
    amount: jod('100'),
    method: 'transfer',
    reference: 'TRX-7781',
    receivedOn: addDays(today, -2),
  },
  admin,
  ctx,
);

console.log(`✓ Demo data added:
  - ${staff.length} staff accounts: ${staff.map(([e]) => e).join(', ')}
  - 2 trade names, 4 customer categories, 5 sections, ${itemRows.length + 1} items
  - ${demo.length} customers with branches; contracts: active, cash, expiring, not started,
    suspended, expired, and one customer with no contract
  - ${orderCount} orders: yesterday (${previous}) confirmed, today (${current}) open, one held for credit approval
  - restaurant app account: restaurant@example.com (مطعم السفرة الذهبية)
  - production: 3 lines, 3 vehicles; ${previous} closed (with waste and an approved variance),
    ${current} preliminary plan
  - 3 suppliers and ${pos.length} purchase orders in different statuses
  - 3 routes with drivers (driver@, driver2@, driver3@example.com); ${previous}: ${deliveredCount} delivered
    with invoices, ${leftForApp} left for driver@example.com to do in the app; opening balances and payments
  - history: ${historyDays} earlier days delivered and invoiced (${historyInvoices} invoices) for the reports`);
await close();
