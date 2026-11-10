import ExcelJS from 'exceljs';
import { and, desc, eq, lte, gte, sql } from 'drizzle-orm';
import {
  ammanDate,
  ITEM_UNIT_LABELS_AR,
  ITEM_UNITS,
  translate,
  type AuthUser,
  type ItemUnit,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import {
  contractPrices,
  contracts,
  customerCategories,
  customers,
  invoices,
  itemSections,
  items,
  tradeNames,
} from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import type { AuditContext } from '../audit/audit.service.js';
import type { BillingService } from '../billing/billing.service.js';
import type { createContractsService } from '../contracts/contracts.service.js';
import type { createCustomersService } from '../customers/customers.service.js';
import type { createItemsService } from '../items/items.service.js';
import { isRtlNow, t } from '../../lib/i18n.js';

/**
 * Moving the bakery's existing data in from Excel. Each kind has a template; an upload is
 * checked row by row first (preview), and only a file without errors can be imported.
 * Every row goes through the normal services, so it is validated and audited like a
 * record typed into the dashboard.
 */
export const IMPORT_KINDS = ['customers', 'items', 'contracts', 'prices', 'opening'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

type Col = {
  key: string;
  label: string;
  required?: boolean;
  example: string | number;
  help?: string;
};

const COLUMNS: Record<ImportKind, Col[]> = {
  customers: [
    { key: 'code', label: 'كود العميل', example: '', help: 'اتركه فارغاً ليُعطى تلقائياً' },
    { key: 'name', label: 'اسم العميل', required: true, example: 'مطعم السفرة الذهبية' },
    { key: 'nameEn', label: 'الاسم بالإنجليزية', example: 'Golden Table' },
    { key: 'category', label: 'التصنيف', example: 'مطاعم' },
    { key: 'tradeName', label: 'الاسم التجاري', required: true, example: 'مخابز مكة' },
    { key: 'contactName', label: 'الشخص المسؤول', example: 'أبو أحمد' },
    { key: 'phone', label: 'الهاتف', example: '0791234567' },
    { key: 'email', label: 'البريد', example: '' },
    { key: 'city', label: 'المدينة', example: 'عمّان' },
    { key: 'address', label: 'العنوان', example: 'خلدا — شارع وصفي التل' },
    {
      key: 'branchName',
      label: 'اسم الفرع',
      example: 'الفرع الرئيسي',
      help: 'الفرع الأول؛ الفروع الأخرى تضاف من اللوحة',
    },
    { key: 'branchAddress', label: 'عنوان الفرع', example: '' },
    { key: 'branchPhone', label: 'هاتف الفرع', example: '' },
  ],
  items: [
    { key: 'code', label: 'كود الصنف', example: '', help: 'اتركه فارغاً ليُعطى تلقائياً' },
    { key: 'name', label: 'اسم الصنف', required: true, example: 'خبز عربي كبير' },
    { key: 'nameEn', label: 'الاسم بالإنجليزية', example: 'Large Arabic bread' },
    {
      key: 'section',
      label: 'القسم',
      required: true,
      example: 'خبز',
      help: 'يُنشأ القسم إن لم يكن موجوداً',
    },
    {
      key: 'unit',
      label: 'الوحدة',
      required: true,
      example: 'كيس',
      help: Object.values(ITEM_UNIT_LABELS_AR).join('، '),
    },
    { key: 'basePrice', label: 'السعر الأساسي (دينار)', required: true, example: 0.35 },
  ],
  contracts: [
    { key: 'customer', label: 'كود العميل أو اسمه', required: true, example: 'C0001' },
    { key: 'startDate', label: 'تاريخ البداية', required: true, example: '2027-01-01' },
    { key: 'endDate', label: 'تاريخ النهاية', required: true, example: '2027-12-31' },
    {
      key: 'paymentType',
      label: 'نوع الدفع',
      required: true,
      example: 'آجل',
      help: 'نقدي أو آجل',
    },
    { key: 'creditLimit', label: 'سقف الائتمان (دينار)', example: 1500 },
    { key: 'paymentTermsDays', label: 'مدة السداد (يوم)', example: 30 },
    { key: 'overdueGraceDays', label: 'أيام السماح', example: 7 },
    { key: 'discount', label: 'الخصم العام %', example: 5 },
    { key: 'allowReturns', label: 'يسمح بالمرتجع', example: 'نعم', help: 'نعم أو لا' },
    { key: 'maxReturn', label: 'أقصى مرتجع %', example: 10 },
  ],
  prices: [
    { key: 'customer', label: 'كود العميل أو اسمه', required: true, example: 'C0001' },
    { key: 'item', label: 'كود الصنف أو اسمه', required: true, example: 'I0001' },
    { key: 'price', label: 'السعر الخاص (دينار)', required: true, example: 0.3 },
  ],
  opening: [
    { key: 'customer', label: 'كود العميل أو اسمه', required: true, example: 'C0001' },
    { key: 'amount', label: 'الرصيد المستحق (دينار)', required: true, example: 420.5 },
    { key: 'dueDate', label: 'تاريخ الاستحقاق', required: true, example: '2026-12-31' },
    { key: 'note', label: 'ملاحظة', example: 'رصيد منقول من الدفاتر' },
  ],
};

export const IMPORT_LABELS_AR: Record<ImportKind, string> = {
  customers: 'العملاء وفروعهم',
  items: 'الأصناف والأسعار',
  contracts: 'العقود',
  prices: 'الأسعار الخاصة في العقود',
  opening: 'الأرصدة الافتتاحية',
};

type Cell = string | number | boolean | Date | null | undefined;
export type PreviewRow = {
  row: number;
  values: Record<string, Cell>;
  action: 'create' | 'skip';
  errors: string[];
  note?: string;
};

const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const text = (v: Cell) =>
  v === null || v === undefined
    ? ''
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).trim();
const jod = (v: Cell) => {
  const s = digits(text(v)).replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : NaN;
};
const int = (v: Cell) => {
  const s = digits(text(v));
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};
const date = (v: Cell) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = digits(text(v)).replace(/\//g, '-');
  if (!s) return null;
  // Accept 2027-01-31 and 31-01-2027.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? s
    : /^(\d{1,2})-(\d{1,2})-(\d{4})$/.test(s)
      ? s.replace(
          /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
          (_, d, m, y) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
        )
      : '';
  return iso && !Number.isNaN(new Date(iso).getTime()) ? iso : 'bad';
};
const yes = (v: Cell) => ['نعم', 'yes', 'y', '1', 'true'].includes(text(v).toLowerCase());
const unitOf = (v: Cell): ItemUnit | null => {
  const s = text(v);
  const found = ITEM_UNITS.find(
    (u) =>
      u === s ||
      ITEM_UNIT_LABELS_AR[u] === s ||
      translate('en', ITEM_UNIT_LABELS_AR[u]).toLowerCase() === s.toLowerCase(),
  );
  return found ?? null;
};

export function createImportService(deps: {
  db: Db;
  customers: ReturnType<typeof createCustomersService>;
  items: ReturnType<typeof createItemsService>;
  contracts: ReturnType<typeof createContractsService>;
  billing: BillingService;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();

  async function template(kind: ImportKind) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(t('البيانات'), {
      views: [{ rightToLeft: isRtlNow(), state: 'frozen', ySplit: 1 }],
    });
    const cols = COLUMNS[kind];
    ws.addRow(cols.map((c) => (c.required ? `${t(c.label)} *` : t(c.label))));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).eachCell(
      (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3E2A1C' } }),
    );
    ws.addRow(cols.map((c) => (typeof c.example === 'string' ? t(c.example) : c.example)));
    ws.getRow(2).font = { italic: true, color: { argb: 'FF7A6E62' } };
    cols.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(14, c.label.length + 6)));

    const help = wb.addWorksheet(t('طريقة التعبئة'), { views: [{ rightToLeft: isRtlNow() }] });
    help.addRow([t('قالب استيراد: {0}', t(IMPORT_LABELS_AR[kind]))]).font = {
      bold: true,
      size: 14,
    };
    help.addRow([t('• عبّئ البيانات في ورقة «البيانات» بدءاً من السطر الثاني (امسح سطر المثال).')]);
    help.addRow([
      t(
        '• الأعمدة التي عليها * مطلوبة. المبالغ بالدينار (مثل 12.500). التواريخ بالشكل 2027-01-31.',
      ),
    ]);
    help.addRow([t('• لا تغيّر عناوين الأعمدة.')]);
    help.addRow([]);
    for (const c of cols)
      help.addRow([
        t(c.label),
        c.required ? t('مطلوب') : t('اختياري'),
        c.key === 'unit'
          ? Object.values(ITEM_UNIT_LABELS_AR)
              .map((u) => t(u))
              .join(t('، '))
          : c.help
            ? t(c.help)
            : '',
      ]);
    if (kind === 'customers' || kind === 'items') {
      help.addRow([]);
      const [tns, cats, secs] = await Promise.all([
        db.select({ name: tradeNames.name }).from(tradeNames),
        db.select({ name: customerCategories.name }).from(customerCategories),
        db.select({ name: itemSections.name }).from(itemSections),
      ]);
      if (kind === 'customers') {
        help.addRow([t('الأسماء التجارية المتاحة'), tns.map((tr) => tr.name).join(t('، '))]);
        help.addRow([
          t('التصنيفات الحالية'),
          cats.map((tr) => tr.name).join(t('، ')) || t('— (يُنشأ التصنيف إن لم يكن موجوداً)'),
        ]);
      } else help.addRow([t('الأقسام الحالية'), secs.map((tr) => tr.name).join(t('، '))]);
    }
    help.getColumn(1).width = 34;
    help.getColumn(2).width = 14;
    help.getColumn(3).width = 60;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async function read(kind: ImportKind, file: Buffer) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw new AppError(422, 'BAD_FILE', t('الملف ليس Excel صالحاً (xlsx)'));
    }
    // Templates downloaded in either language are accepted.
    const ws =
      wb.getWorksheet('البيانات') ??
      wb.getWorksheet(translate('en', 'البيانات')) ??
      wb.worksheets[0];
    if (!ws) throw new AppError(422, 'BAD_FILE', t('الملف فارغ'));
    const cols = COLUMNS[kind];
    const header = (ws.getRow(1).values as Cell[])
      .slice(1)
      .map((h) => text(h).replace(/\s*\*$/, ''));
    const index = cols.map((c) =>
      header.findIndex((h) => h === c.label || h === translate('en', c.label)),
    );
    const missing = cols.filter((c, i) => c.required && index[i] === -1).map((c) => t(c.label));
    if (missing.length)
      throw new AppError(
        422,
        'BAD_TEMPLATE',
        t('أعمدة ناقصة في الملف: {0}. استخدم القالب.', missing.join(t('، '))),
      );
    const rows: { row: number; values: Record<string, Cell> }[] = [];
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const values: Record<string, Cell> = {};
      cols.forEach((c, i) => {
        const cell = index[i]! >= 0 ? r.getCell(index[i]! + 1).value : null;
        values[c.key] =
          cell && typeof cell === 'object' && !(cell instanceof Date)
            ? 'result' in cell
              ? (cell.result as Cell)
              : 'text' in cell
                ? (cell.text as string)
                : null
            : (cell as Cell);
      });
      if (Object.values(values).some((v) => text(v) !== '')) rows.push({ row: n, values });
    });
    if (rows.length > 5000)
      throw new AppError(422, 'TOO_MANY', t('الحد الأقصى 5000 سطر في الملف الواحد'));
    return rows;
  }

  async function lookups() {
    const [cs, its, tns, cats, secs] = await Promise.all([
      db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers),
      db.select({ id: items.id, code: items.code, name: items.name }).from(items),
      db.select({ id: tradeNames.id, name: tradeNames.name }).from(tradeNames),
      db
        .select({ id: customerCategories.id, name: customerCategories.name })
        .from(customerCategories),
      db.select({ id: itemSections.id, name: itemSections.name }).from(itemSections),
    ]);
    const find = <T extends { code?: string; name: string }>(list: T[], v: Cell) => {
      const s = text(v);
      return list.find((x) => x.code === s) ?? list.find((x) => x.name === s);
    };
    return { cs, its, tns, cats, secs, find };
  }

  /** Current contract of a customer (in force today, newest first). */
  async function currentContract(customerId: string) {
    const today = ammanDate(now());
    return db.query.contracts.findFirst({
      where: and(
        eq(contracts.customerId, customerId),
        eq(contracts.status, 'active'),
        lte(contracts.startDate, today),
        gte(contracts.endDate, today),
      ),
      orderBy: [desc(contracts.startDate)],
    });
  }

  async function validate(kind: ImportKind, rows: { row: number; values: Record<string, Cell> }[]) {
    const L = await lookups();
    const out: PreviewRow[] = [];
    const seen = new Set<string>();
    for (const { row, values: v } of rows) {
      const errors: string[] = [];
      const need = (key: string) => {
        const c = COLUMNS[kind].find((x) => x.key === key)!;
        if (!text(v[key])) errors.push(t('«{0}» مطلوب', c.label));
      };
      COLUMNS[kind].filter((c) => c.required).forEach((c) => need(c.key));
      let action: PreviewRow['action'] = 'create';
      let note: string | undefined;

      if (kind === 'customers') {
        const name = text(v.name);
        if (name && L.cs.some((c) => c.name === name)) {
          action = 'skip';
          note = t('عميل بنفس الاسم موجود — لن يُكرَّر');
        }
        if (text(v.code) && L.cs.some((c) => c.code === text(v.code)))
          errors.push(t('الكود مستخدم لعميل آخر'));
        if (text(v.tradeName) && !L.find(L.tns, v.tradeName))
          errors.push(t('الاسم التجاري «{0}» غير موجود في النظام', text(v.tradeName)));
        if (seen.has(name)) errors.push(t('الاسم مكرر في الملف'));
        seen.add(name);
        if (text(v.email) && !/^\S+@\S+\.\S+$/.test(text(v.email)))
          errors.push(t('البريد غير صحيح'));
      }
      if (kind === 'items') {
        const name = text(v.name);
        if (name && L.its.some((i) => i.name === name)) {
          action = 'skip';
          note = t('صنف بنفس الاسم موجود — لن يُكرَّر');
        }
        if (text(v.unit) && !unitOf(v.unit))
          errors.push(t('الوحدة «{0}» غير معروفة', text(v.unit)));
        if (Number.isNaN(jod(v.basePrice))) errors.push(t('السعر غير صحيح'));
        if (seen.has(name)) errors.push(t('الاسم مكرر في الملف'));
        seen.add(name);
      }
      if (kind === 'contracts') {
        const c = text(v.customer) ? L.find(L.cs, v.customer) : null;
        if (text(v.customer) && !c) errors.push(t('العميل «{0}» غير موجود', text(v.customer)));
        const s = date(v.startDate);
        const e = date(v.endDate);
        if (s === 'bad') errors.push(t('تاريخ البداية غير صحيح'));
        if (e === 'bad') errors.push(t('تاريخ النهاية غير صحيح'));
        if (s && e && s !== 'bad' && e !== 'bad' && e < s) errors.push(t('النهاية قبل البداية'));
        if (text(v.paymentType) && !['نقدي', 'آجل', 'cash', 'credit'].includes(text(v.paymentType)))
          errors.push(t('نوع الدفع: نقدي أو آجل'));
        for (const k of ['creditLimit'])
          if (Number.isNaN(jod(v[k]))) errors.push(t('سقف الائتمان غير صحيح'));
        for (const k of ['paymentTermsDays', 'overdueGraceDays', 'discount', 'maxReturn'])
          if (Number.isNaN(Number(digits(text(v[k])) || 0)))
            errors.push(t('«{0}» غير صحيح', COLUMNS.contracts.find((x) => x.key === k)!.label));
      }
      if (kind === 'prices') {
        const c = text(v.customer) ? L.find(L.cs, v.customer) : null;
        if (text(v.customer) && !c) errors.push(t('العميل «{0}» غير موجود', text(v.customer)));
        else if (c && !(await currentContract(c.id)))
          errors.push(t('لا يوجد عقد ساري لهذا العميل'));
        if (text(v.item) && !L.find(L.its, v.item))
          errors.push(t('الصنف «{0}» غير موجود', text(v.item)));
        if (Number.isNaN(jod(v.price))) errors.push(t('السعر غير صحيح'));
      }
      if (kind === 'opening') {
        const c = text(v.customer) ? L.find(L.cs, v.customer) : null;
        if (text(v.customer) && !c) errors.push(t('العميل «{0}» غير موجود', text(v.customer)));
        if (c) {
          const has = await db.query.invoices.findFirst({
            where: and(
              eq(invoices.customerId, c.id),
              eq(invoices.kind, 'opening'),
              sql`${invoices.status} <> 'cancelled'`,
            ),
          });
          if (has) {
            action = 'skip';
            note = t('للعميل رصيد افتتاحي مسجل — لن يُكرَّر');
          }
          if (seen.has(c.id)) errors.push(t('العميل مكرر في الملف'));
          seen.add(c.id);
        }
        const a = jod(v.amount);
        if (Number.isNaN(a) || a === 0) errors.push(t('المبلغ غير صحيح'));
        if (date(v.dueDate) === 'bad') errors.push(t('التاريخ غير صحيح'));
      }
      out.push({ row, values: v, action: errors.length ? 'skip' : action, errors, note });
    }
    const amounts =
      kind === 'opening'
        ? out
            .filter((r) => !r.errors.length && r.action === 'create')
            .reduce((s, r) => s + (jod(r.values.amount) ?? 0), 0)
        : null;
    return {
      kind,
      rows: out,
      summary: {
        total: out.length,
        create: out.filter((r) => r.action === 'create').length,
        skip: out.filter((r) => r.action === 'skip' && !r.errors.length).length,
        errors: out.filter((r) => r.errors.length).length,
        ...(amounts !== null ? { openingTotal: amounts } : {}),
      },
    };
  }

  async function commit(kind: ImportKind, file: Buffer, actor: AuthUser, ctx: AuditContext) {
    const preview = await validate(kind, await read(kind, file));
    if (preview.summary.errors)
      throw new AppError(
        422,
        'IMPORT_ERRORS',
        t('في الملف {0} سطر فيه أخطاء؛ صحّحها ثم أعد الرفع', preview.summary.errors),
        preview,
      );
    const L = await lookups();
    let created = 0;
    const results: { row: number; ok: boolean; message?: string }[] = [];
    // Special prices are written per contract, merged with what is already there.
    const priceGroups = new Map<string, Map<string, number>>();

    for (const r of preview.rows.filter((x) => x.action === 'create')) {
      const v = r.values;
      try {
        if (kind === 'customers') {
          let categoryId: string | null = null;
          if (text(v.category)) {
            const found = L.find(L.cats, v.category);
            categoryId =
              found?.id ??
              (await deps.customers.createCategory({ name: text(v.category) }, ctx)).id;
            if (!found) L.cats.push({ id: categoryId!, name: text(v.category) });
          }
          const c = await deps.customers.create(
            {
              code: text(v.code) || undefined,
              name: text(v.name),
              nameEn: text(v.nameEn) || null,
              categoryId,
              tradeNameId: L.find(L.tns, v.tradeName)!.id,
              contactName: text(v.contactName) || null,
              phone: digits(text(v.phone)) || null,
              email: text(v.email) || null,
              city: text(v.city) || null,
              address: text(v.address) || null,
              createMainBranch: false,
            } as Parameters<typeof deps.customers.create>[0],
            ctx,
          );
          await deps.customers.createBranch(
            c.id,
            {
              name: text(v.branchName) || t('الفرع الرئيسي'),
              address: text(v.branchAddress) || text(v.address) || null,
              phone: digits(text(v.branchPhone)) || digits(text(v.phone)) || null,
              city: text(v.city) || null,
            } as Parameters<typeof deps.customers.createBranch>[1],
            ctx,
          );
        }
        if (kind === 'items') {
          let section = L.find(L.secs, v.section);
          if (!section) {
            const s = await deps.items.createSection(
              { name: text(v.section) } as Parameters<typeof deps.items.createSection>[0],
              ctx,
            );
            section = { id: s.id, name: text(v.section) };
            L.secs.push(section);
          }
          await deps.items.create(
            {
              code: text(v.code) || undefined,
              name: text(v.name),
              nameEn: text(v.nameEn) || null,
              sectionId: section.id,
              unit: unitOf(v.unit)!,
              basePrice: jod(v.basePrice)!,
            } as Parameters<typeof deps.items.create>[0],
            ctx,
          );
        }
        if (kind === 'contracts') {
          const pt = [t('نقدي'), 'cash'].includes(text(v.paymentType)) ? 'cash' : 'credit';
          await deps.contracts.create(
            {
              customerId: L.find(L.cs, v.customer)!.id,
              startDate: date(v.startDate)!,
              endDate: date(v.endDate)!,
              paymentType: pt,
              creditLimit: jod(v.creditLimit) ?? 0,
              paymentTermsDays: int(v.paymentTermsDays) ?? (pt === 'cash' ? 0 : 30),
              overdueGraceDays: int(v.overdueGraceDays) ?? 0,
              discountBps: Math.round(Number(digits(text(v.discount)) || 0) * 100),
              allowReturns: yes(v.allowReturns),
              maxReturnBps: Math.round(Number(digits(text(v.maxReturn)) || 0) * 100),
              renewalAlertDays: 30,
            } as Parameters<typeof deps.contracts.create>[0],
            ctx,
          );
        }
        if (kind === 'prices') {
          const c = L.find(L.cs, v.customer)!;
          const contract = (await currentContract(c.id))!;
          const group = priceGroups.get(contract.id) ?? new Map<string, number>();
          group.set(L.find(L.its, v.item)!.id, jod(v.price)!);
          priceGroups.set(contract.id, group);
        }
        if (kind === 'opening') {
          await deps.billing.createOpening(
            L.find(L.cs, v.customer)!.id,
            {
              amount: jod(v.amount)!,
              date: date(v.dueDate)!,
              note: text(v.note) || t('رصيد افتتاحي (استيراد Excel)'),
            },
            actor,
            ctx,
          );
        }
        created++;
        results.push({ row: r.row, ok: true });
      } catch (err) {
        results.push({
          row: r.row,
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    for (const [contractId, group] of priceGroups) {
      const existing = await db
        .select()
        .from(contractPrices)
        .where(eq(contractPrices.contractId, contractId));
      const merged = new Map(existing.map((p) => [p.itemId, p.price]));
      for (const [itemId, price] of group) merged.set(itemId, price);
      await deps.contracts.setPrices(
        contractId,
        [...merged].map(([itemId, price]) => ({ itemId, price })),
        ctx,
      );
    }
    return { created, failed: results.filter((r) => !r.ok), summary: preview.summary };
  }

  return {
    template,
    preview: async (kind: ImportKind, file: Buffer) => validate(kind, await read(kind, file)),
    commit,
    /** Checks imported opening balances against the totals the bakery expects. */
    async openingCheck() {
      const rows = await db.execute<{
        code: string;
        name: string;
        amount: number;
        paid: number;
        due_date: string;
      }>(sql`
        select c.code, c.name, v.total as amount, v.due_date::text as due_date,
          coalesce((select sum(amount) from payment_allocations pa where pa.invoice_id = v.id), 0)::int as paid
        from invoices v join customers c on c.id = v.customer_id
        where v.kind = 'opening' and v.status <> 'cancelled' order by c.code`);
      const list = (
        rows as unknown as {
          code: string;
          name: string;
          amount: number;
          paid: number;
          due_date: string;
        }[]
      ).map((r) => ({
        code: r.code,
        name: r.name,
        amount: Number(r.amount),
        paid: Number(r.paid),
        remaining: Number(r.amount) - Number(r.paid),
        dueDate: r.due_date,
      }));
      return {
        items: list,
        total: list.reduce((s, r) => s + r.amount, 0),
        remaining: list.reduce((s, r) => s + r.remaining, 0),
      };
    },
  };
}

export type ImportService = ReturnType<typeof createImportService>;
export { COLUMNS as IMPORT_COLUMNS };
