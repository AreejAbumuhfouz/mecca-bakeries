import { sql } from 'drizzle-orm';
import {
  AGING_BUCKETS,
  AGING_LABELS_AR,
  addDays,
  ammanDate,
  contractState,
  currentDeliveryDate,
  DELIVERY_REASON_LABELS_AR,
  ITEM_UNIT_LABELS_AR,
  STOCK_LOSS_REASON_LABELS_AR,
  type AuthUser,
  type ContractStatus,
  type DeliveryReason,
  type OrderSettings,
  type StockLossReason,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import type { BillingService } from '../billing/billing.service.js';
import { t } from '../../lib/i18n.js';

/** Every report is a table: the screen, Excel and PDF all render the same shape. */
export type ColumnKind = 'text' | 'int' | 'money' | 'percent' | 'date';
export type Column = { key: string; label: string; kind: ColumnKind };
export type Row = Record<string, string | number | null | undefined>;
export type ReportTable = {
  key: ReportKey;
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Row[];
  totals: Row | null;
  /** Which numeric column a bar chart of this report should show. */
  chart: { label: string; value: string } | null;
};
export type ReportParams = { from: string; to: string; groupBy?: string };

export const REPORTS = {
  sales: { title: 'المبيعات', groups: ['customer', 'item', 'region', 'trade_name', 'day'] },
  credit: { title: 'حدود الائتمان والعملاء المتجاوزون', groups: [] },
  aging: { title: 'أعمار الذمم', groups: [] },
  orders: { title: 'الطلبات', groups: ['day', 'customer'] },
  delivery: { title: 'التسليم', groups: ['day', 'route'] },
  drivers: { title: 'إنتاجية السائقين', groups: [] },
  returns: { title: 'المرتجعات', groups: ['item', 'customer', 'reason'] },
  waste: { title: 'الهدر والتالف', groups: ['item', 'reason'] },
  variances: { title: 'فروقات الإنتاج اليومية', groups: [] },
  lines: { title: 'إنتاجية خطوط الإنتاج', groups: [] },
} as const;
export type ReportKey = keyof typeof REPORTS;

export const GROUP_LABELS_AR: Record<string, string> = {
  customer: 'العميل',
  item: 'الصنف',
  region: 'المنطقة',
  trade_name: 'الاسم التجاري',
  day: 'اليوم',
  route: 'المسار',
  reason: 'السبب',
};

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const sumBy = (rows: Row[], keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + n(r[k]), 0)]));
const unitAr = (u: string) => t((ITEM_UNIT_LABELS_AR as Record<string, string>)[u] ?? u);

export function createReportsService(deps: {
  db: Db;
  billing: BillingService;
  orderSettings: () => Promise<OrderSettings>;
  now?: () => Date;
}) {
  const { db, billing } = deps;
  const now = () => deps.now?.() ?? new Date();
  const q = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];

  // ------------------------------------------------------------ sales

  async function sales({ from, to, groupBy = 'customer' }: ReportParams): Promise<ReportTable> {
    const base = {
      key: 'sales' as const,
      title: t('المبيعات'),
      subtitle: t('من {0} إلى {1} — حسب {2}', from, to, t(GROUP_LABELS_AR[groupBy] ?? '')),
    };
    if (groupBy === 'item') {
      const rows = await q<Row>(sql`
        select coalesce(i.code, '') as code, l.description as name, coalesce(i.unit, '') as unit,
          sum(case when l.kind = 'sale' then l.quantity else 0 end)::bigint as qty,
          sum(case when l.kind = 'sale' then l.line_total else 0 end)::bigint as sales,
          sum(case when l.kind = 'return' then l.quantity else 0 end)::bigint as returned_qty,
          sum(case when l.kind = 'return' then -l.line_total else 0 end)::bigint as returns
        from invoice_lines l join invoices v on v.id = l.invoice_id
        left join items i on i.id = l.item_id
        where v.status <> 'cancelled' and v.kind = 'sale' and v.issue_date between ${from} and ${to}
        group by i.code, l.description, i.unit order by sales desc`);
      const out = rows.map((r) => ({
        code: r.code,
        name: r.name,
        unit: unitAr(String(r.unit)),
        qty: n(r.qty),
        sales: n(r.sales),
        returned_qty: n(r.returned_qty),
        returns: n(r.returns),
        net: n(r.sales) - n(r.returns),
      }));
      return {
        ...base,
        columns: [
          { key: 'code', label: t('الكود'), kind: 'text' },
          { key: 'name', label: t('الصنف'), kind: 'text' },
          { key: 'unit', label: t('الوحدة'), kind: 'text' },
          { key: 'qty', label: t('الكمية المباعة'), kind: 'int' },
          { key: 'sales', label: t('المبيعات'), kind: 'money' },
          { key: 'returned_qty', label: t('كمية المرتجع'), kind: 'int' },
          { key: 'returns', label: t('قيمة المرتجع'), kind: 'money' },
          { key: 'net', label: t('الصافي'), kind: 'money' },
        ],
        rows: out,
        totals: {
          name: t('المجموع'),
          ...sumBy(out, ['qty', 'sales', 'returned_qty', 'returns', 'net']),
        },
        chart: { label: 'name', value: 'net' },
      };
    }
    const key =
      groupBy === 'region'
        ? sql`coalesce(c.city, 'غير محدد')`
        : groupBy === 'trade_name'
          ? sql`coalesce(tn.name, 'بدون اسم تجاري')`
          : groupBy === 'day'
            ? sql`v.issue_date::text`
            : sql`c.name`;
    const rows = await q<Row>(sql`
      select ${key} as name, count(*)::int as invoices, count(distinct v.customer_id)::int as customers,
        sum(v.gross_total - v.discount1_amount)::bigint as sales,
        sum(v.discount1_amount)::bigint as discount1,
        sum(v.discount2_amount)::bigint as discount2,
        sum(v.returns_total)::bigint as returns,
        sum(v.total)::bigint as net
      from invoices v join customers c on c.id = v.customer_id
      left join trade_names tn on tn.id = v.trade_name_id
      where v.status <> 'cancelled' and v.kind = 'sale' and v.issue_date between ${from} and ${to}
      group by 1 order by ${groupBy === 'day' ? sql`1` : sql`net desc`}`);
    const out = rows.map((r) => ({
      name: String(r.name),
      invoices: n(r.invoices),
      customers: n(r.customers),
      sales: n(r.sales),
      discount1: n(r.discount1),
      discount2: n(r.discount2),
      returns: n(r.returns),
      net: n(r.net),
    }));
    const columns: Column[] = [
      {
        key: 'name',
        label: t(GROUP_LABELS_AR[groupBy] ?? 'البند'),
        kind: groupBy === 'day' ? 'date' : 'text',
      },
      { key: 'invoices', label: t('الفواتير'), kind: 'int' },
      ...(groupBy === 'customer'
        ? []
        : [{ key: 'customers', label: t('العملاء'), kind: 'int' as const }]),
      { key: 'sales', label: t('المبيعات بعد خصم العقد'), kind: 'money' },
      { key: 'discount1', label: t('خصم العقد'), kind: 'money' },
      { key: 'discount2', label: t('الخصم الثاني'), kind: 'money' },
      { key: 'returns', label: t('المرتجعات'), kind: 'money' },
      { key: 'net', label: t('الصافي'), kind: 'money' },
    ];
    return {
      ...base,
      columns,
      rows: out,
      totals: {
        name: t('المجموع'),
        ...sumBy(out, ['invoices', 'sales', 'discount1', 'discount2', 'returns', 'net']),
      },
      chart: { label: 'name', value: 'net' },
    };
  }

  // ------------------------------------------------------------ credit and aging

  async function credit(): Promise<ReportTable> {
    const today = ammanDate(now());
    const contracts = await q<Row>(sql`
      select k.customer_id, c.code, c.name, k.number, k.status, k.start_date::text as start_date,
        k.end_date::text as end_date, k.payment_type, k.credit_limit, k.overdue_grace_days, k.renewal_alert_days
      from contracts k join customers c on c.id = k.customer_id
      where c.is_active order by k.start_date desc`);
    const rec = await billing.receivables({});
    const bal = new Map(rec.items.map((r) => [r.customerId, r]));
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const k of contracts) {
      const id = String(k.customer_id);
      const state = contractState(
        {
          startDate: String(k.start_date),
          endDate: String(k.end_date),
          status: k.status as ContractStatus,
          renewalAlertDays: n(k.renewal_alert_days),
        },
        today,
      );
      if (seen.has(id) || !['active', 'expiring'].includes(state)) continue;
      seen.add(id);
      const r = bal.get(id);
      const balance = r?.balance ?? 0;
      const limit = n(k.credit_limit);
      const overdue = r?.overdue ?? 0;
      const over = k.payment_type === 'credit' && balance > limit;
      rows.push({
        code: k.code,
        name: k.name,
        contract: k.number,
        payment: k.payment_type === 'cash' ? t('نقدي') : t('آجل'),
        limit,
        balance,
        usage: limit ? pct(balance, limit) : 0,
        available: Math.max(0, limit - balance),
        overdue,
        state:
          over && overdue
            ? t('متجاوز ومتأخر')
            : over
              ? t('متجاوز السقف')
              : overdue
                ? t('عليه متأخرات')
                : t('ضمن الحد'),
      });
    }
    rows.sort((a, b) => n(b.usage) - n(a.usage));
    return {
      key: 'credit',
      title: t('حدود الائتمان والعملاء المتجاوزون'),
      subtitle: t('العقود السارية في {0}', today),
      columns: [
        { key: 'code', label: t('الكود'), kind: 'text' },
        { key: 'name', label: t('العميل'), kind: 'text' },
        { key: 'contract', label: t('العقد'), kind: 'text' },
        { key: 'payment', label: t('الدفع'), kind: 'text' },
        { key: 'limit', label: t('سقف الائتمان'), kind: 'money' },
        { key: 'balance', label: t('الرصيد'), kind: 'money' },
        { key: 'usage', label: t('نسبة الاستخدام'), kind: 'percent' },
        { key: 'available', label: t('المتاح'), kind: 'money' },
        { key: 'overdue', label: t('المتأخر'), kind: 'money' },
        { key: 'state', label: t('الحالة'), kind: 'text' },
      ],
      rows,
      totals: { name: t('المجموع'), ...sumBy(rows, ['limit', 'balance', 'available', 'overdue']) },
      chart: { label: 'name', value: 'usage' },
    };
  }

  async function aging(): Promise<ReportTable> {
    const rec = await billing.receivables({});
    const rows: Row[] = rec.items.map((c) => ({
      code: c.code,
      name: c.name,
      trade_name: c.tradeName,
      balance: c.balance,
      overdue: c.overdue,
      ...Object.fromEntries(AGING_BUCKETS.map((b) => [b, c.aging[b]])),
      oldest_due: c.oldestDue,
      last_payment: c.lastPaymentOn,
    }));
    return {
      key: 'aging',
      title: t('أعمار الذمم'),
      subtitle: t('حتى {0}', ammanDate(now())),
      columns: [
        { key: 'code', label: t('الكود'), kind: 'text' },
        { key: 'name', label: t('العميل'), kind: 'text' },
        { key: 'trade_name', label: t('الاسم التجاري'), kind: 'text' },
        { key: 'balance', label: t('الرصيد'), kind: 'money' },
        { key: 'overdue', label: t('المتأخر'), kind: 'money' },
        ...AGING_BUCKETS.map((b) => ({
          key: b,
          label: t(AGING_LABELS_AR[b]),
          kind: 'money' as const,
        })),
        { key: 'oldest_due', label: t('أقدم استحقاق'), kind: 'date' },
        { key: 'last_payment', label: t('آخر دفعة'), kind: 'date' },
      ],
      rows,
      totals: { name: t('المجموع'), ...sumBy(rows, ['balance', 'overdue', ...AGING_BUCKETS]) },
      chart: { label: 'name', value: 'balance' },
    };
  }

  // ------------------------------------------------------------ orders and delivery

  async function orders({ from, to, groupBy = 'day' }: ReportParams): Promise<ReportTable> {
    const key = groupBy === 'customer' ? sql`c.name` : sql`o.delivery_date::text`;
    const rows = await q<Row>(sql`
      select ${key} as name, count(*)::int as total,
        count(*) filter (where o.status in ('confirmed', 'delivered'))::int as confirmed,
        count(*) filter (where o.status = 'delivered')::int as delivered,
        count(*) filter (where o.status = 'pending_approval')::int as pending,
        count(*) filter (where o.status in ('cancelled', 'rejected'))::int as cancelled,
        coalesce(sum(o.total) filter (where o.status in ('confirmed', 'delivered')), 0)::bigint as value
      from orders o join customers c on c.id = o.customer_id
      where o.delivery_date between ${from} and ${to} and o.status <> 'draft'
      group by 1 order by ${groupBy === 'customer' ? sql`value desc` : sql`1`}`);
    const out = rows.map((r) => ({
      ...r,
      total: n(r.total),
      confirmed: n(r.confirmed),
      delivered: n(r.delivered),
      pending: n(r.pending),
      cancelled: n(r.cancelled),
      value: n(r.value),
    }));
    return {
      key: 'orders',
      title: t('الطلبات'),
      subtitle: t('تواريخ التسليم من {0} إلى {1}', from, to),
      columns: [
        {
          key: 'name',
          label: t(GROUP_LABELS_AR[groupBy] ?? 'اليوم'),
          kind: groupBy === 'customer' ? 'text' : 'date',
        },
        { key: 'total', label: t('الطلبات'), kind: 'int' },
        { key: 'confirmed', label: t('مؤكدة'), kind: 'int' },
        { key: 'delivered', label: t('سُلِّمت'), kind: 'int' },
        { key: 'pending', label: t('بانتظار موافقة'), kind: 'int' },
        { key: 'cancelled', label: t('ملغاة/مرفوضة'), kind: 'int' },
        { key: 'value', label: t('قيمة المؤكدة'), kind: 'money' },
      ],
      rows: out,
      totals: {
        name: t('المجموع'),
        ...sumBy(out, ['total', 'confirmed', 'delivered', 'pending', 'cancelled', 'value']),
      },
      chart: { label: 'name', value: 'value' },
    };
  }

  async function delivery({ from, to, groupBy = 'day' }: ReportParams): Promise<ReportTable> {
    const key = groupBy === 'route' ? sql`r.name` : sql`t.delivery_date::text`;
    const rows = await q<Row>(sql`
      select ${key} as name, count(*)::int as stops,
        count(*) filter (where d.status = 'delivered')::int as full_,
        count(*) filter (where d.status = 'partial')::int as partial,
        count(*) filter (where d.status = 'failed')::int as failed,
        count(*) filter (where d.status = 'pending')::int as pending,
        coalesce(sum(d.collected_amount), 0)::bigint as collected,
        count(*) filter (where d.latitude is not null)::int as located
      from deliveries d join trips t on t.id = d.trip_id join routes r on r.id = t.route_id
      where t.delivery_date between ${from} and ${to}
      group by 1 order by 1`);
    const out = rows.map((r) => {
      const stops = n(r.stops);
      const done = n(r.full_) + n(r.partial);
      return {
        name: String(r.name),
        stops,
        full: n(r.full_),
        partial: n(r.partial),
        failed: n(r.failed),
        pending: n(r.pending),
        success: pct(done, stops - n(r.pending)),
        collected: n(r.collected),
        located: n(r.located),
      };
    });
    return {
      key: 'delivery',
      title: t('التسليم'),
      subtitle: t('من {0} إلى {1} — حسب {2}', from, to, t(GROUP_LABELS_AR[groupBy] ?? '')),
      columns: [
        {
          key: 'name',
          label: t(GROUP_LABELS_AR[groupBy] ?? 'اليوم'),
          kind: groupBy === 'route' ? 'text' : 'date',
        },
        { key: 'stops', label: t('التوصيلات'), kind: 'int' },
        { key: 'full', label: t('كامل'), kind: 'int' },
        { key: 'partial', label: t('ناقص'), kind: 'int' },
        { key: 'failed', label: t('لم يُسلَّم'), kind: 'int' },
        { key: 'pending', label: t('معلّق'), kind: 'int' },
        { key: 'success', label: t('نسبة النجاح'), kind: 'percent' },
        { key: 'collected', label: t('المحصّل'), kind: 'money' },
        { key: 'located', label: t('بموقع مسجّل'), kind: 'int' },
      ],
      rows: out,
      totals: {
        name: t('المجموع'),
        ...sumBy(out, ['stops', 'full', 'partial', 'failed', 'pending', 'collected', 'located']),
      },
      chart: { label: 'name', value: 'stops' },
    };
  }

  async function drivers({ from, to }: ReportParams): Promise<ReportTable> {
    const rows = await q<Row>(sql`
      select coalesce(u.name, 'بدون سائق') as name, count(distinct t.id)::int as trips, count(d.id)::int as stops,
        count(d.id) filter (where d.status in ('delivered', 'partial'))::int as delivered,
        count(d.id) filter (where d.status = 'failed')::int as failed,
        count(d.id) filter (where d.status = 'pending')::int as pending,
        coalesce(sum(d.collected_amount), 0)::bigint as collected,
        coalesce(sum(v.total) filter (where v.status <> 'cancelled'), 0)::bigint as invoiced,
        round(avg(extract(epoch from (t.finished_at - t.started_at)) / 60) filter (where t.finished_at is not null))::int as trip_minutes
      from trips t left join users u on u.id = t.driver_id
      left join deliveries d on d.trip_id = t.id
      left join invoices v on v.delivery_id = d.id
      where t.delivery_date between ${from} and ${to}
      group by 1 order by delivered desc`);
    const out = rows.map((r) => ({
      name: String(r.name),
      trips: n(r.trips),
      stops: n(r.stops),
      delivered: n(r.delivered),
      failed: n(r.failed),
      pending: n(r.pending),
      success: pct(n(r.delivered), n(r.stops) - n(r.pending)),
      invoiced: n(r.invoiced),
      collected: n(r.collected),
      trip_minutes: r.trip_minutes === null ? null : n(r.trip_minutes),
    }));
    return {
      key: 'drivers',
      title: t('إنتاجية السائقين'),
      subtitle: t('من {0} إلى {1}', from, to),
      columns: [
        { key: 'name', label: t('السائق'), kind: 'text' },
        { key: 'trips', label: t('الرحلات'), kind: 'int' },
        { key: 'stops', label: t('التوصيلات'), kind: 'int' },
        { key: 'delivered', label: t('سُلِّمت'), kind: 'int' },
        { key: 'failed', label: t('لم تُسلَّم'), kind: 'int' },
        { key: 'success', label: t('نسبة النجاح'), kind: 'percent' },
        { key: 'invoiced', label: t('قيمة الفواتير'), kind: 'money' },
        { key: 'collected', label: t('المحصّل'), kind: 'money' },
        { key: 'trip_minutes', label: t('متوسط الرحلة (دقيقة)'), kind: 'int' },
      ],
      rows: out,
      totals: {
        name: t('المجموع'),
        ...sumBy(out, ['trips', 'stops', 'delivered', 'failed', 'invoiced', 'collected']),
      },
      chart: { label: 'name', value: 'delivered' },
    };
  }

  // ------------------------------------------------------------ returns, waste, variances, lines

  async function returns({ from, to, groupBy = 'item' }: ReportParams): Promise<ReportTable> {
    const key =
      groupBy === 'customer'
        ? sql`c.name`
        : groupBy === 'reason'
          ? sql`coalesce(l.return_reason, 'other')`
          : sql`i.name`;
    const rows = await q<Row>(sql`
      select ${key} as name, sum(l.returned_qty)::bigint as qty, sum(l.delivered_qty)::bigint as delivered,
        count(distinct o.customer_id)::int as customers
      from delivery_lines l join deliveries d on d.id = l.delivery_id join trips t on t.id = d.trip_id
      join orders o on o.id = d.order_id join customers c on c.id = o.customer_id join items i on i.id = l.item_id
      where l.returned_qty > 0 and t.delivery_date between ${from} and ${to}
      group by 1 order by qty desc`);
    const value = await q<Row>(sql`
      select ${groupBy === 'customer' ? sql`c.name` : groupBy === 'reason' ? sql`null` : sql`l.description`} as name,
        sum(-l.line_total)::bigint as value
      from invoice_lines l join invoices v on v.id = l.invoice_id join customers c on c.id = v.customer_id
      where l.kind = 'return' and v.status <> 'cancelled' and v.issue_date between ${from} and ${to}
      group by 1`);
    const valueOf = new Map(value.map((v) => [String(v.name), n(v.value)]));
    const out = rows.map((r) => ({
      name:
        groupBy === 'reason'
          ? t(DELIVERY_REASON_LABELS_AR[r.name as DeliveryReason] ?? String(r.name))
          : String(r.name),
      qty: n(r.qty),
      customers: n(r.customers),
      value: groupBy === 'reason' ? null : (valueOf.get(String(r.name)) ?? 0),
    }));
    return {
      key: 'returns',
      title: t('المرتجعات'),
      subtitle: t('من {0} إلى {1} — حسب {2}', from, to, t(GROUP_LABELS_AR[groupBy] ?? '')),
      columns: [
        { key: 'name', label: t(GROUP_LABELS_AR[groupBy] ?? 'الصنف'), kind: 'text' },
        { key: 'qty', label: t('الكمية المرتجعة'), kind: 'int' },
        { key: 'customers', label: t('عدد العملاء'), kind: 'int' },
        ...(groupBy === 'reason'
          ? []
          : [{ key: 'value', label: t('القيمة'), kind: 'money' as const }]),
      ],
      rows: out,
      totals: {
        name: t('المجموع'),
        ...sumBy(out, ['qty', ...(groupBy === 'reason' ? [] : ['value'])]),
      },
      chart: { label: 'name', value: 'qty' },
    };
  }

  async function waste({ from, to, groupBy = 'item' }: ReportParams): Promise<ReportTable> {
    const key = groupBy === 'reason' ? sql`s.reason` : sql`i.name`;
    const rows = await q<Row>(sql`
      select ${key} as name,
        coalesce(sum(s.quantity) filter (where s.kind = 'waste'), 0)::bigint as waste,
        coalesce(sum(s.quantity) filter (where s.kind = 'return'), 0)::bigint as returned,
        count(distinct s.day_id)::int as days
      from stock_losses s join production_days p on p.id = s.day_id join items i on i.id = s.item_id
      where p.delivery_date between ${from} and ${to}
      group by 1 order by waste desc`);
    const produced = await q<Row>(sql`
      select i.name, coalesce(sum(pi.produced_qty), 0)::bigint as produced
      from production_items pi join production_days p on p.id = pi.day_id join items i on i.id = pi.item_id
      where p.delivery_date between ${from} and ${to} group by i.name`);
    const prodOf = new Map(produced.map((p) => [String(p.name), n(p.produced)]));
    const out = rows.map((r) => {
      const name =
        groupBy === 'reason'
          ? t(STOCK_LOSS_REASON_LABELS_AR[r.name as StockLossReason] ?? String(r.name))
          : String(r.name);
      const made = groupBy === 'item' ? (prodOf.get(String(r.name)) ?? 0) : null;
      return {
        name,
        waste: n(r.waste),
        returned: n(r.returned),
        days: n(r.days),
        produced: made,
        rate: made ? pct(n(r.waste), made) : null,
      };
    });
    return {
      key: 'waste',
      title: t('الهدر والتالف'),
      subtitle: t('أيام الإنتاج من {0} إلى {1}', from, to),
      columns: [
        { key: 'name', label: t(GROUP_LABELS_AR[groupBy] ?? 'الصنف'), kind: 'text' },
        { key: 'waste', label: t('التالف'), kind: 'int' },
        { key: 'returned', label: t('المرتجع للمخبز'), kind: 'int' },
        { key: 'days', label: t('عدد الأيام'), kind: 'int' },
        ...(groupBy === 'item'
          ? [
              { key: 'produced', label: t('المنتج'), kind: 'int' as const },
              { key: 'rate', label: t('نسبة الهدر'), kind: 'percent' as const },
            ]
          : []),
      ],
      rows: out,
      totals: { name: t('المجموع'), ...sumBy(out, ['waste', 'returned']) },
      chart: { label: 'name', value: 'waste' },
    };
  }

  async function variances({ from, to }: ReportParams): Promise<ReportTable> {
    const rows = await q<Row>(sql`
      select p.delivery_date::text as day, i.name, pi.ordered_qty + pi.extra_qty as planned, pi.produced_qty as produced,
        coalesce((select sum(quantity) from vehicle_loads vl where vl.day_id = p.id and vl.item_id = pi.item_id), 0)::bigint as loaded,
        coalesce((select sum(quantity) from stock_losses sl where sl.day_id = p.id and sl.item_id = pi.item_id and sl.kind = 'waste'), 0)::bigint as waste,
        va.note as approval, u.name as approved_by
      from production_items pi join production_days p on p.id = pi.day_id join items i on i.id = pi.item_id
      left join variance_approvals va on va.day_id = p.id and va.item_id = pi.item_id
      left join users u on u.id = va.approved_by
      where p.delivery_date between ${from} and ${to}
        and ((pi.produced_qty is not null and pi.produced_qty <> pi.ordered_qty + pi.extra_qty) or va.note is not null)
      order by p.delivery_date desc, i.name`);
    const out = rows.map((r) => ({
      day: String(r.day),
      name: String(r.name),
      planned: n(r.planned),
      produced: r.produced === null ? null : n(r.produced),
      diff: r.produced === null ? null : n(r.produced) - n(r.planned),
      loaded: n(r.loaded),
      waste: n(r.waste),
      approval: r.approval ? `${r.approval} — ${r.approved_by ?? ''}` : t('غير معتمد'),
    }));
    return {
      key: 'variances',
      title: t('فروقات الإنتاج اليومية'),
      subtitle: t('من {0} إلى {1}', from, to),
      columns: [
        { key: 'day', label: t('اليوم'), kind: 'date' },
        { key: 'name', label: t('الصنف'), kind: 'text' },
        { key: 'planned', label: t('المخطط'), kind: 'int' },
        { key: 'produced', label: t('المنتج'), kind: 'int' },
        { key: 'diff', label: t('الفرق'), kind: 'int' },
        { key: 'loaded', label: t('المحمّل'), kind: 'int' },
        { key: 'waste', label: t('التالف'), kind: 'int' },
        { key: 'approval', label: t('الاعتماد'), kind: 'text' },
      ],
      rows: out,
      totals: null,
      chart: null,
    };
  }

  async function lines({ from, to }: ReportParams): Promise<ReportTable> {
    const rows = await q<Row>(sql`
      select coalesce(pl.name, 'بدون خط') as name, count(distinct p.id)::int as days,
        sum(pi.ordered_qty)::bigint as ordered, sum(pi.ordered_qty + pi.extra_qty)::bigint as planned,
        coalesce(sum(pi.produced_qty), 0)::bigint as produced,
        coalesce(sum((select sum(quantity) from stock_losses sl where sl.day_id = p.id and sl.item_id = pi.item_id and sl.kind = 'waste')), 0)::bigint as waste
      from production_items pi join production_days p on p.id = pi.day_id join items i on i.id = pi.item_id
      join item_sections s on s.id = i.section_id left join production_lines pl on pl.id = s.production_line_id
      where p.delivery_date between ${from} and ${to}
      group by 1 order by produced desc`);
    const out = rows.map((r) => ({
      name: String(r.name),
      days: n(r.days),
      ordered: n(r.ordered),
      planned: n(r.planned),
      produced: n(r.produced),
      achievement: pct(n(r.produced), n(r.planned)),
      waste: n(r.waste),
      waste_rate: pct(n(r.waste), n(r.produced)),
      per_day: n(r.days) ? Math.round(n(r.produced) / n(r.days)) : 0,
    }));
    return {
      key: 'lines',
      title: t('إنتاجية خطوط الإنتاج'),
      subtitle: t('من {0} إلى {1}', from, to),
      columns: [
        { key: 'name', label: t('خط الإنتاج'), kind: 'text' },
        { key: 'days', label: t('الأيام'), kind: 'int' },
        { key: 'ordered', label: t('المطلوب'), kind: 'int' },
        { key: 'planned', label: t('المخطط'), kind: 'int' },
        { key: 'produced', label: t('المنتج'), kind: 'int' },
        { key: 'achievement', label: t('نسبة الإنجاز'), kind: 'percent' },
        { key: 'waste', label: t('التالف'), kind: 'int' },
        { key: 'waste_rate', label: t('نسبة الهدر'), kind: 'percent' },
        { key: 'per_day', label: t('متوسط يومي'), kind: 'int' },
      ],
      rows: out,
      totals: { name: t('المجموع'), ...sumBy(out, ['ordered', 'planned', 'produced', 'waste']) },
      chart: { label: 'name', value: 'produced' },
    };
  }

  const builders: Record<ReportKey, (p: ReportParams) => Promise<ReportTable>> = {
    sales,
    credit,
    aging,
    orders,
    delivery,
    drivers,
    returns,
    waste,
    variances,
    lines,
  };

  // ------------------------------------------------------------ home KPIs

  async function kpis(actor: AuthUser) {
    const can = (p: string) => actor.permissions.includes(p as never);
    const today = ammanDate(now());
    const settings = await deps.orderSettings();
    const ordering = currentDeliveryDate(now(), settings.cutoffTime);
    const out: Record<string, unknown> = { today, orderingFor: ordering };

    if (can('orders.view')) {
      const [o] = await q<Row>(sql`
        select count(*) filter (where status in ('submitted', 'confirmed'))::int as placed,
          coalesce(sum(total) filter (where status in ('submitted', 'confirmed')), 0)::bigint as value,
          count(*) filter (where status = 'pending_approval')::int as pending,
          (select count(*) from branches b join customers c on c.id = b.customer_id
            where b.is_active and c.is_active)::int as branches
        from orders where delivery_date = ${ordering}`);
      out.orders = {
        placed: n(o?.placed),
        value: n(o?.value),
        pending: n(o?.pending),
        branches: n(o?.branches),
      };
    }
    if (can('deliveries.view')) {
      const [d] = await q<Row>(sql`
        select count(*)::int as total, count(*) filter (where d.status = 'pending')::int as pending,
          count(*) filter (where d.status in ('delivered', 'partial'))::int as delivered,
          count(*) filter (where d.status = 'failed')::int as failed,
          coalesce(sum(d.collected_amount), 0)::bigint as collected
        from deliveries d join trips t on t.id = d.trip_id where t.delivery_date = ${today}`);
      out.deliveries = {
        total: n(d?.total),
        pending: n(d?.pending),
        delivered: n(d?.delivered),
        failed: n(d?.failed),
        collected: n(d?.collected),
      };
    }
    if (can('invoices.view') || can('payments.view')) {
      const [v] = await q<Row>(sql`
        select coalesce(sum(total) filter (where status <> 'cancelled' and kind = 'sale'), 0)::bigint as sales,
          count(*) filter (where status = 'draft')::int as drafts
        from invoices where issue_date = ${today}`);
      const [p] = await q<Row>(sql`
        select coalesce(sum(amount), 0)::bigint as received from payments where status = 'received' and received_on = ${today}`);
      const rec = await billing.receivables({});
      const trend = await q<Row>(sql`
        select d::date::text as day, coalesce((select sum(total) from invoices v where v.issue_date = d::date
          and v.status <> 'cancelled' and v.kind = 'sale'), 0)::bigint as sales
        from generate_series(${addDays(today, -13)}::date, ${today}::date, interval '1 day') d order by d`);
      out.money = {
        salesToday: n(v?.sales),
        drafts: n(v?.drafts),
        receivedToday: n(p?.received),
        receivables: rec.totals.balance,
        overdue: rec.totals.overdue,
        overdueCustomers: rec.items.filter((c) => c.overdue > 0).length,
        trend: trend.map((tr) => ({ day: String(tr.day), sales: n(tr.sales) })),
      };
    }
    if (can('production.view')) {
      const [p] = await q<Row>(sql`
        select status, (select count(*) from production_items pi where pi.day_id = p.id)::int as items
        from production_days p where delivery_date = ${today}`);
      out.production = { status: p?.status ?? null, items: n(p?.items) };
    }
    if (can('contracts.view')) {
      const [c] = await q<Row>(sql`
        select count(*)::int as expiring from contracts
        where status = 'active' and end_date between ${today} and ${addDays(today, 30)}`);
      out.contracts = { expiring: n(c?.expiring) };
    }
    if (can('purchasing.view')) {
      const [p] = await q<Row>(sql`
        select count(*) filter (where status in ('draft', 'sent', 'confirmed'))::int as open from purchase_orders`);
      out.purchasing = { open: n(p?.open) };
    }
    return out;
  }

  return {
    async run(key: ReportKey, params: ReportParams) {
      const groups = REPORTS[key].groups as readonly string[];
      const groupBy =
        params.groupBy && groups.includes(params.groupBy) ? params.groupBy : groups[0];
      return builders[key]({ ...params, groupBy });
    },
    kpis,
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
