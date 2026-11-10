import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  addDays,
  AGING_BUCKETS,
  AGING_LABELS_AR,
  agingBucket,
  ammanDate,
  daysBetween,
  invoiceNumber,
  ITEM_UNIT_LABELS_AR,
  type AgingBucket,
  type AuthUser,
  type InvoiceLineKind,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentSource,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import {
  branches,
  contractPrices,
  contracts,
  customers,
  deliveries,
  invoiceLines,
  invoiceRevisions,
  invoices,
  items,
  orderItems,
  orders,
  paymentAllocations,
  payments,
  tradeNames,
  users,
} from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { Conn, Tx } from '../../lib/db-utils.js';
import type { PdfRenderer } from '../../lib/pdf.js';
import { brandHeader } from '../../lib/brand-header.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';
import type { FilesService } from '../files/files.service.js';
import type { OpenInvoicesProvider } from '../contracts/contracts.service.js';
import { effectivePrice } from '../credit/credit-engine.js';
import { invoiceHtml, statementHtml } from './billing-pdf.js';
import { t } from '../../lib/i18n.js';

export type LineInput = {
  kind: InvoiceLineKind;
  itemId?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  unitPrice: number;
  listPrice?: number;
};

export type DeliveredLine = { itemId: string; deliveredQty: number; returnedQty: number };

export type PaymentInput = {
  customerId: string;
  amount: number;
  method: PaymentMethod;
  receivedOn: string;
  reference?: string | null;
  chequeDueDate?: string | null;
  note?: string | null;
  /** Optional manual allocation; whatever is left is spread oldest-invoice-first. */
  allocations?: { invoiceId: string; amount: number }[];
};

const unitLabel = (u: string | null) =>
  u ? ((ITEM_UNIT_LABELS_AR as Record<string, string>)[u] ?? u) : null;

/** Totals of an invoice from its lines and second discount. */
export function invoiceTotals(lines: Omit<LineInput, 'description'>[], discount2Bps: number) {
  let grossTotal = 0;
  let sales = 0;
  let returnsTotal = 0;
  for (const l of lines) {
    const amount = l.unitPrice * l.quantity;
    if (l.kind === 'return') returnsTotal += amount;
    else {
      sales += amount;
      grossTotal += (l.listPrice ?? l.unitPrice) * l.quantity;
    }
  }
  const discount2Amount = Math.round((sales * discount2Bps) / 10_000);
  return {
    grossTotal,
    discount1Amount: grossTotal - sales,
    discount2Amount,
    returnsTotal,
    total: sales - discount2Amount - returnsTotal,
  };
}

export function createBillingService(deps: {
  db: Db;
  files: FilesService;
  pdf: PdfRenderer;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();

  // ------------------------------------------------------------ allocation

  /**
   * Spreads every payment of the customer over its invoices: manual allocations stay,
   * the rest goes to the oldest due invoice first. Money left over is customer credit.
   */
  async function rebalance(tx: Conn, customerId: string) {
    const invs = await tx
      .select({ id: invoices.id, total: invoices.total })
      .from(invoices)
      .where(and(eq(invoices.customerId, customerId), ne(invoices.status, 'cancelled')))
      .orderBy(asc(invoices.dueDate), asc(invoices.issueDate), asc(invoices.createdAt));
    const pays = await tx
      .select({ id: payments.id, amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.customerId, customerId), eq(payments.status, 'received')))
      .orderBy(asc(payments.receivedOn), asc(payments.createdAt));
    const payIds = pays.map((p) => p.id);
    if (payIds.length)
      await tx
        .delete(paymentAllocations)
        .where(
          and(inArray(paymentAllocations.paymentId, payIds), eq(paymentAllocations.manual, false)),
        );
    const manual = payIds.length
      ? await tx
          .select()
          .from(paymentAllocations)
          .where(inArray(paymentAllocations.paymentId, payIds))
      : [];
    const valid = new Set(invs.map((i) => i.id));
    const invLeft = new Map(invs.map((i) => [i.id, Math.max(0, i.total)]));
    const payLeft = new Map(pays.map((p) => [p.id, p.amount]));
    for (const m of manual) {
      // Manual rows on cancelled invoices are dropped; others are trimmed to what fits.
      const fits = valid.has(m.invoiceId)
        ? Math.min(m.amount, invLeft.get(m.invoiceId)!, payLeft.get(m.paymentId)!)
        : 0;
      if (fits !== m.amount) {
        await tx
          .delete(paymentAllocations)
          .where(
            and(
              eq(paymentAllocations.paymentId, m.paymentId),
              eq(paymentAllocations.invoiceId, m.invoiceId),
            ),
          );
        if (fits > 0) await tx.insert(paymentAllocations).values({ ...m, amount: fits });
      }
      if (fits > 0) {
        invLeft.set(m.invoiceId, invLeft.get(m.invoiceId)! - fits);
        payLeft.set(m.paymentId, payLeft.get(m.paymentId)! - fits);
      }
    }
    const rows: { paymentId: string; invoiceId: string; amount: number; manual: boolean }[] = [];
    let i = 0;
    for (const p of pays) {
      let left = payLeft.get(p.id)!;
      while (left > 0 && i < invs.length) {
        const inv = invs[i]!;
        const need = invLeft.get(inv.id)!;
        if (need <= 0) {
          i++;
          continue;
        }
        const amount = Math.min(left, need);
        const existing = rows.find((r) => r.paymentId === p.id && r.invoiceId === inv.id);
        if (existing) existing.amount += amount;
        else if (manual.some((m) => m.paymentId === p.id && m.invoiceId === inv.id))
          await tx
            .update(paymentAllocations)
            .set({ amount: sql`${paymentAllocations.amount} + ${amount}` })
            .where(
              and(eq(paymentAllocations.paymentId, p.id), eq(paymentAllocations.invoiceId, inv.id)),
            );
        else rows.push({ paymentId: p.id, invoiceId: inv.id, amount, manual: false });
        invLeft.set(inv.id, need - amount);
        left -= amount;
      }
    }
    if (rows.length) await tx.insert(paymentAllocations).values(rows);
  }

  /** Paid amount per invoice. */
  const paidSql = sql<number>`coalesce((select sum(pa.amount) from payment_allocations pa where pa.invoice_id = ${invoices.id}), 0)::int`;

  // ------------------------------------------------------------ invoices

  async function getRow(id: string) {
    const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
    if (!inv) throw notFound('Invoice');
    return inv;
  }

  async function nextNumber(tx: Tx, tradeNameId: string) {
    const [tn] = await tx
      .update(tradeNames)
      .set({ nextInvoiceNumber: sql`${tradeNames.nextInvoiceNumber} + 1` })
      .where(eq(tradeNames.id, tradeNameId))
      .returning({ prefix: tradeNames.invoicePrefix, n: tradeNames.nextInvoiceNumber });
    if (!tn) throw new AppError(409, 'NO_TRADE_NAME', t('العميل بدون اسم تجاري للفوترة'));
    return invoiceNumber(tn.prefix, tn.n - 1);
  }

  async function writeLines(tx: Tx, invoiceId: string, lines: LineInput[]) {
    await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    if (lines.length)
      await tx.insert(invoiceLines).values(
        lines.map((l, i) => ({
          invoiceId,
          position: i + 1,
          kind: l.kind,
          itemId: l.itemId ?? null,
          description: l.description,
          unit: l.unit ?? null,
          quantity: l.quantity,
          listPrice: l.listPrice ?? l.unitPrice,
          unitPrice: l.unitPrice,
          lineTotal: (l.kind === 'return' ? -1 : 1) * l.unitPrice * l.quantity,
        })),
      );
  }

  /**
   * Builds the invoice of a delivery inside the delivery transaction: delivered quantities
   * at the order's prices, returns at the contract price, under the customer's trade name.
   */
  async function createFromDelivery(
    tx: Tx,
    input: { orderId: string; deliveryId: string; lines: DeliveredLine[]; actorId: string | null },
  ) {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw notFound('Order');
    const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId));
    const contract = order.contractId
      ? (await tx.select().from(contracts).where(eq(contracts.id, order.contractId)))[0]
      : undefined;
    const ordered = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const itemIds = input.lines.map((l) => l.itemId);
    const itemRows = itemIds.length
      ? await tx.select().from(items).where(inArray(items.id, itemIds))
      : [];
    const special = contract
      ? await tx.select().from(contractPrices).where(eq(contractPrices.contractId, contract.id))
      : [];
    const specialOf = new Map(special.map((s) => [s.itemId, s.price]));

    const sale: LineInput[] = [];
    const ret: LineInput[] = [];
    for (const l of input.lines) {
      const item = itemRows.find((x) => x.id === l.itemId);
      if (!item) continue;
      const o = ordered.find((x) => x.itemId === l.itemId);
      const priced = o
        ? { price: o.unitPrice, source: o.priceSource }
        : effectivePrice(item.basePrice, specialOf.get(item.id), contract?.discountBps ?? 0);
      const listPrice = priced.source === 'discount' ? item.basePrice : priced.price;
      const base = { itemId: item.id, description: item.name, unit: unitLabel(item.unit) };
      if (l.deliveredQty > 0)
        sale.push({
          ...base,
          kind: 'sale',
          quantity: l.deliveredQty,
          unitPrice: priced.price,
          listPrice,
        });
      if (l.returnedQty > 0)
        ret.push({ ...base, kind: 'return', quantity: l.returnedQty, unitPrice: priced.price });
    }
    if (!sale.length && !ret.length) return null;
    const lines = [...sale, ...ret];
    const tr = invoiceTotals(lines, 0);

    const flags: string[] = [];
    if (tr.returnsTotal > 0) {
      if (!contract?.allowReturns) flags.push(t('المرتجعات غير مسموحة في عقد العميل'));
      else if (
        tr.returnsTotal >
        Math.round(((tr.grossTotal - tr.discount1Amount) * contract.maxReturnBps) / 10_000)
      )
        flags.push(t('المرتجعات أكثر من الحد المسموح ({0}%)', contract.maxReturnBps / 100));
    }

    const [inv] = await tx
      .insert(invoices)
      .values({
        number: await nextNumber(tx, customer!.tradeNameId!),
        kind: 'sale',
        tradeNameId: customer!.tradeNameId,
        customerId: order.customerId,
        branchId: order.branchId,
        orderId: order.id,
        deliveryId: input.deliveryId,
        issueDate: order.deliveryDate,
        dueDate: addDays(order.deliveryDate, contract?.paymentTermsDays ?? 0),
        ...tr,
        flags,
        createdBy: input.actorId,
      })
      .returning();
    await writeLines(tx, inv!.id, lines);
    return inv!;
  }

  // ------------------------------------------------------------ receivables

  /** Open (unpaid) invoices of a customer: what is still owed and when it is due. */
  async function open(conn: Conn, customerId: string) {
    const rows = await conn
      .select({
        id: invoices.id,
        number: invoices.number,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        total: invoices.total,
        paid: paidSql,
      })
      .from(invoices)
      .where(and(eq(invoices.customerId, customerId), ne(invoices.status, 'cancelled')))
      .orderBy(asc(invoices.dueDate));
    return rows.map((r) => ({ ...r, balance: r.total - r.paid })).filter((r) => r.balance > 0);
  }

  async function credit(conn: Conn, customerId: string) {
    const [r] = await conn.execute<{ credit: number }>(sql`
      select coalesce(sum(p.amount - coalesce((select sum(pa.amount) from payment_allocations pa where pa.payment_id = p.id), 0)), 0)::int as credit
      from payments p where p.customer_id = ${customerId} and p.status = 'received'`);
    return Number(r?.credit ?? 0);
  }

  async function summary(customerId: string, today = ammanDate(now())) {
    const openRows = await open(db, customerId);
    const aging = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<
      AgingBucket,
      number
    >;
    let overdue = 0;
    for (const r of openRows) {
      const late = daysBetween(r.dueDate, today);
      aging[agingBucket(late)] += r.balance;
      if (late > 0) overdue += r.balance;
    }
    const unallocated = await credit(db, customerId);
    const owed = openRows.reduce((s, r) => s + r.balance, 0);
    return {
      balance: owed - unallocated,
      owed,
      credit: unallocated,
      overdue,
      aging,
      openInvoices: openRows,
    };
  }

  const openInvoicesProvider: OpenInvoicesProvider = async (customerId) =>
    (await open(db, customerId)).map((r) => ({ balance: r.balance, dueDate: r.dueDate }));

  async function statementData(customerId: string, from: string, to: string) {
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    if (!customer) throw notFound('Customer');
    const [before] = await db.execute<{ inv: number; pay: number }>(sql`
      select
        (select coalesce(sum(total), 0) from invoices where customer_id = ${customerId} and status <> 'cancelled' and issue_date < ${from})::int as inv,
        (select coalesce(sum(amount), 0) from payments where customer_id = ${customerId} and status = 'received' and received_on < ${from})::int as pay`);
    const opening = Number(before!.inv) - Number(before!.pay);
    const invs = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          ne(invoices.status, 'cancelled'),
          gte(invoices.issueDate, from),
          lte(invoices.issueDate, to),
        ),
      );
    const pays = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.customerId, customerId),
          eq(payments.status, 'received'),
          gte(payments.receivedOn, from),
          lte(payments.receivedOn, to),
        ),
      );
    const entries = [
      ...invs.map((i) => ({
        date: i.issueDate,
        at: i.createdAt.getTime(),
        number: i.number,
        description: i.kind === 'opening' ? t('رصيد افتتاحي') : t('فاتورة مبيعات'),
        debit: Math.max(0, i.total),
        credit: Math.max(0, -i.total),
      })),
      ...pays.map((p) => ({
        date: p.receivedOn,
        at: p.createdAt.getTime(),
        number: p.number,
        description: t(
          'دفعة {0}',
          p.method === 'cash'
            ? t('نقدية')
            : p.method === 'cheque'
              ? t('بشيك {0}', p.reference ?? '')
              : t('بتحويل'),
        ).trim(),
        debit: 0,
        credit: p.amount,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
    let running = opening;
    const rows = entries.map(({ at: _at, ...r }) => {
      running += r.debit - r.credit;
      return { ...r, balance: running };
    });
    const s = await summary(customerId);
    return { customer, from, to, opening, rows, closing: running, summary: s };
  }

  async function invoiceDetail(id: string) {
    const inv = await getRow(id);
    const [lines, customer, branch, tn, allocs, revisions, delivery, order] = await Promise.all([
      db
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, id))
        .orderBy(asc(invoiceLines.position)),
      db.query.customers.findFirst({ where: eq(customers.id, inv.customerId) }),
      inv.branchId ? db.query.branches.findFirst({ where: eq(branches.id, inv.branchId) }) : null,
      inv.tradeNameId
        ? db.query.tradeNames.findFirst({ where: eq(tradeNames.id, inv.tradeNameId) })
        : null,
      db
        .select({
          paymentId: payments.id,
          number: payments.number,
          receivedOn: payments.receivedOn,
          method: payments.method,
          amount: paymentAllocations.amount,
          manual: paymentAllocations.manual,
        })
        .from(paymentAllocations)
        .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
        .where(eq(paymentAllocations.invoiceId, id))
        .orderBy(asc(payments.receivedOn)),
      db
        .select({
          id: invoiceRevisions.id,
          reason: invoiceRevisions.reason,
          before: invoiceRevisions.before,
          after: invoiceRevisions.after,
          createdAt: invoiceRevisions.createdAt,
          userName: users.name,
        })
        .from(invoiceRevisions)
        .leftJoin(users, eq(users.id, invoiceRevisions.userId))
        .where(eq(invoiceRevisions.invoiceId, id))
        .orderBy(desc(invoiceRevisions.createdAt)),
      inv.deliveryId
        ? db.query.deliveries.findFirst({ where: eq(deliveries.id, inv.deliveryId) })
        : null,
      inv.orderId ? db.query.orders.findFirst({ where: eq(orders.id, inv.orderId) }) : null,
    ]);
    const paid = allocs.reduce((s, a) => s + a.amount, 0);
    return {
      ...inv,
      lines,
      customer: {
        id: customer!.id,
        code: customer!.code,
        name: customer!.name,
        phone: customer!.phone,
        address: customer!.address,
      },
      branchName: branch?.name ?? null,
      tradeName: tn ? { id: tn.id, name: tn.name, prefix: tn.invoicePrefix } : null,
      orderNumber: order?.number ?? null,
      delivery: delivery
        ? {
            receiverName: delivery.receiverName,
            deliveredAt: delivery.deliveredAt,
            hasSignature: Boolean(delivery.signatureSvg),
            latitude: delivery.latitude,
            longitude: delivery.longitude,
          }
        : null,
      payments: allocs,
      paid,
      balance: inv.total - paid,
      revisions,
    };
  }

  function assertCanChange(
    inv: { status: InvoiceStatus },
    actor: AuthUser,
    reason?: string | null,
  ) {
    if (inv.status === 'cancelled')
      throw new AppError(409, 'INVOICE_CANCELLED', t('الفاتورة ملغاة'));
    if (inv.status === 'approved') {
      if (!actor.permissions.includes('invoices.edit_locked'))
        throw new AppError(
          403,
          'INVOICE_LOCKED',
          t('الفاتورة معتمدة ومقفلة؛ التعديل يحتاج صلاحية خاصة'),
        );
      if (!reason || reason.trim().length < 3)
        throw new AppError(422, 'REASON_REQUIRED', t('اكتب سبب تعديل الفاتورة المعتمدة'));
    }
  }

  // ------------------------------------------------------------ payments

  async function insertPayment(
    tx: Tx,
    input: PaymentInput,
    extra: { source: PaymentSource; deliveryId?: string | null; receivedBy: string | null },
  ) {
    if (input.amount <= 0)
      throw new AppError(422, 'BAD_AMOUNT', t('المبلغ يجب أن يكون أكبر من صفر'));
    const [n] = await tx.execute<{ n: string }>(sql`select nextval('payment_number_seq') as n`);
    const [p] = await tx
      .insert(payments)
      .values({
        number: `RC-${String(Number(n!.n)).padStart(6, '0')}`,
        customerId: input.customerId,
        amount: input.amount,
        method: input.method,
        source: extra.source,
        receivedOn: input.receivedOn,
        reference: input.reference?.trim() || null,
        chequeDueDate: input.chequeDueDate ?? null,
        deliveryId: extra.deliveryId ?? null,
        note: input.note?.trim() || null,
        receivedBy: extra.receivedBy,
      })
      .returning();
    const manual = (input.allocations ?? []).filter((a) => a.amount > 0);
    if (manual.length) {
      if (manual.reduce((s, a) => s + a.amount, 0) > input.amount)
        throw new AppError(422, 'OVER_ALLOCATED', t('مجموع التوزيع أكبر من مبلغ الدفعة'));
      const openRows = await open(tx, input.customerId);
      for (const a of manual) {
        const inv = openRows.find((r) => r.id === a.invoiceId);
        if (!inv)
          throw new AppError(422, 'BAD_INVOICE', t('الفاتورة غير موجودة أو مدفوعة بالكامل'));
        if (a.amount > inv.balance)
          throw new AppError(
            422,
            'OVER_INVOICE',
            t('المبلغ أكبر من المتبقي على الفاتورة {0}', inv.number),
          );
      }
      await tx.insert(paymentAllocations).values(
        manual.map((a) => ({
          paymentId: p!.id,
          invoiceId: a.invoiceId,
          amount: a.amount,
          manual: true,
        })),
      );
    }
    return p!;
  }

  // ------------------------------------------------------------ public API

  return {
    rebalance,
    createFromDelivery,
    insertPayment,
    openInvoicesProvider,
    summary,

    async list(q: {
      status?: InvoiceStatus;
      customerId?: string;
      tradeNameId?: string;
      from?: string;
      to?: string;
      search?: string;
      unpaid?: boolean;
      page: number;
      pageSize: number;
    }) {
      const where: (SQL | undefined)[] = [
        q.status ? eq(invoices.status, q.status) : undefined,
        q.customerId ? eq(invoices.customerId, q.customerId) : undefined,
        q.tradeNameId ? eq(invoices.tradeNameId, q.tradeNameId) : undefined,
        q.from ? gte(invoices.issueDate, q.from) : undefined,
        q.to ? lte(invoices.issueDate, q.to) : undefined,
        q.search
          ? or(ilike(invoices.number, `%${q.search}%`), ilike(customers.name, `%${q.search}%`))
          : undefined,
        q.unpaid
          ? sql`${invoices.total} > ${paidSql} and ${invoices.status} <> 'cancelled'`
          : undefined,
      ];
      const cond = and(...where);
      const [rows, [count], [sums]] = await Promise.all([
        db
          .select({
            id: invoices.id,
            number: invoices.number,
            kind: invoices.kind,
            status: invoices.status,
            issueDate: invoices.issueDate,
            dueDate: invoices.dueDate,
            total: invoices.total,
            paid: paidSql,
            flags: invoices.flags,
            customerId: invoices.customerId,
            customerName: customers.name,
            customerCode: customers.code,
            branchName: branches.name,
            tradeName: tradeNames.name,
          })
          .from(invoices)
          .innerJoin(customers, eq(customers.id, invoices.customerId))
          .leftJoin(branches, eq(branches.id, invoices.branchId))
          .leftJoin(tradeNames, eq(tradeNames.id, invoices.tradeNameId))
          .where(cond)
          .orderBy(desc(invoices.issueDate), desc(invoices.number))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(invoices)
          .innerJoin(customers, eq(customers.id, invoices.customerId))
          .where(cond),
        db
          .select({
            total: sql<number>`coalesce(sum(case when ${invoices.status} <> 'cancelled' then ${invoices.total} end), 0)::int`,
            drafts: sql<number>`count(*) filter (where ${invoices.status} = 'draft')::int`,
          })
          .from(invoices)
          .innerJoin(customers, eq(customers.id, invoices.customerId))
          .where(cond),
      ]);
      return {
        items: rows.map((r) => ({
          ...r,
          balance: r.status === 'cancelled' ? 0 : r.total - r.paid,
        })),
        total: count?.n ?? 0,
        sumTotal: sums?.total ?? 0,
        drafts: sums?.drafts ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    get: invoiceDetail,

    /** Drafts: invoices.manage. Approved: invoices.edit_locked + reason, kept as a revision. */
    async update(
      id: string,
      input: {
        discount2Bps?: number;
        notes?: string | null;
        lines?: LineInput[];
        reason?: string | null;
      },
      actor: AuthUser,
      ctx: AuditContext,
    ) {
      const before = await invoiceDetail(id);
      assertCanChange(before, actor, input.reason);
      if (before.kind === 'opening' && input.lines)
        throw new AppError(422, 'OPENING_NO_LINES', t('الرصيد الافتتاحي بدون أصناف'));
      const lines: LineInput[] =
        input.lines ??
        before.lines.map((l) => ({
          kind: l.kind,
          itemId: l.itemId,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          listPrice: l.listPrice,
        }));
      const discount2Bps = input.discount2Bps ?? before.discount2Bps;
      const tr = before.kind === 'opening' ? null : invoiceTotals(lines, discount2Bps);
      await db.transaction(async (tx) => {
        await tx
          .update(invoices)
          .set({
            ...(tr ?? {}),
            discount2Bps,
            ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
          })
          .where(eq(invoices.id, id));
        if (input.lines) await writeLines(tx, id, lines);
        const after = {
          discount2Bps,
          notes: input.notes,
          total: tr?.total ?? before.total,
          lines: input.lines,
        };
        if (before.status === 'approved')
          await tx.insert(invoiceRevisions).values({
            invoiceId: id,
            reason: input.reason!.trim(),
            before: {
              total: before.total,
              discount2Bps: before.discount2Bps,
              notes: before.notes,
              lines: before.lines,
            },
            after,
            userId: actor.id,
          });
        await rebalance(tx, before.customerId);
        await writeAudit(tx, ctx, {
          action: before.status === 'approved' ? 'invoice.edit_locked' : 'invoice.update',
          entity: 'invoice',
          entityId: id,
          before: { total: before.total, discount2Bps: before.discount2Bps, lines: before.lines },
          after: { ...after, reason: input.reason ?? null },
        });
      });
      return invoiceDetail(id);
    },

    async approve(ids: string[], actor: AuthUser, ctx: AuditContext) {
      const rows = await db
        .select()
        .from(invoices)
        .where(and(inArray(invoices.id, ids), eq(invoices.status, 'draft')));
      await db.transaction(async (tx) => {
        for (const r of rows) {
          await tx
            .update(invoices)
            .set({ status: 'approved', approvedBy: actor.id, approvedAt: now() })
            .where(eq(invoices.id, r.id));
          await writeAudit(tx, ctx, {
            action: 'invoice.approve',
            entity: 'invoice',
            entityId: r.id,
            before: { status: 'draft' },
            after: { status: 'approved' },
          });
        }
      });
      return { approved: rows.length };
    },

    async cancel(id: string, reason: string, actor: AuthUser, ctx: AuditContext) {
      const before = await getRow(id);
      assertCanChange(before, actor, reason);
      await db.transaction(async (tx) => {
        await tx
          .update(invoices)
          .set({ status: 'cancelled', cancelledAt: now(), cancelReason: reason.trim() })
          .where(eq(invoices.id, id));
        await rebalance(tx, before.customerId);
        await writeAudit(tx, ctx, {
          action: 'invoice.cancel',
          entity: 'invoice',
          entityId: id,
          before: { status: before.status, total: before.total },
          after: { status: 'cancelled', reason },
        });
      });
      return invoiceDetail(id);
    },

    /** The balance a customer owed before the system started. One per customer. */
    async createOpening(
      customerId: string,
      input: { amount: number; date: string; note?: string | null },
      actor: AuthUser,
      ctx: AuditContext,
    ) {
      const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
      if (!customer) throw notFound('Customer');
      const exists = await db.query.invoices.findFirst({
        where: and(
          eq(invoices.customerId, customerId),
          eq(invoices.kind, 'opening'),
          ne(invoices.status, 'cancelled'),
        ),
      });
      if (exists)
        throw new AppError(
          409,
          'OPENING_EXISTS',
          t('للعميل رصيد افتتاحي مسجل؛ عدّله أو ألغه أولاً'),
        );
      if (input.amount <= 0)
        throw new AppError(422, 'BAD_AMOUNT', t('المبلغ يجب أن يكون أكبر من صفر'));
      const id = await db.transaction(async (tx) => {
        const cancelled = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(invoices)
          .where(and(eq(invoices.customerId, customerId), eq(invoices.kind, 'opening')));
        const suffix = cancelled[0]?.n ? `-${cancelled[0].n + 1}` : '';
        const [inv] = await tx
          .insert(invoices)
          .values({
            number: `OB-${customer.code}${suffix}`,
            kind: 'opening',
            tradeNameId: customer.tradeNameId,
            customerId,
            issueDate: input.date,
            dueDate: input.date,
            status: 'approved',
            grossTotal: input.amount,
            total: input.amount,
            notes: input.note?.trim() || 'رصيد افتتاحي',
            approvedBy: actor.id,
            approvedAt: now(),
            createdBy: actor.id,
          })
          .returning();
        await rebalance(tx, customerId);
        await writeAudit(tx, ctx, {
          action: 'invoice.opening',
          entity: 'invoice',
          entityId: inv!.id,
          after: inv,
        });
        return inv!.id;
      });
      return invoiceDetail(id);
    },

    async pdf(id: string) {
      const inv = await invoiceDetail(id);
      const bytes = await deps.pdf(
        invoiceHtml({
          ...inv,
          brand: await brandHeader(db, deps.files, inv.tradeNameId),
          receiverName: inv.delivery?.receiverName ?? null,
        }),
      );
      return { bytes, filename: `${inv.number}.pdf` };
    },

    // ---------------------------------------------------------- payments

    async listPayments(q: {
      customerId?: string;
      from?: string;
      to?: string;
      method?: PaymentMethod;
      source?: PaymentSource;
      search?: string;
      page: number;
      pageSize: number;
    }) {
      const cond = and(
        q.customerId ? eq(payments.customerId, q.customerId) : undefined,
        q.from ? gte(payments.receivedOn, q.from) : undefined,
        q.to ? lte(payments.receivedOn, q.to) : undefined,
        q.method ? eq(payments.method, q.method) : undefined,
        q.source ? eq(payments.source, q.source) : undefined,
        q.search
          ? or(ilike(payments.number, `%${q.search}%`), ilike(customers.name, `%${q.search}%`))
          : undefined,
      );
      const [rows, [count]] = await Promise.all([
        db
          .select({
            id: payments.id,
            number: payments.number,
            customerId: payments.customerId,
            customerName: customers.name,
            customerCode: customers.code,
            amount: payments.amount,
            method: payments.method,
            source: payments.source,
            receivedOn: payments.receivedOn,
            reference: payments.reference,
            chequeDueDate: payments.chequeDueDate,
            status: payments.status,
            receivedByName: users.name,
            allocated: sql<number>`coalesce((select sum(pa.amount) from payment_allocations pa where pa.payment_id = ${payments.id}), 0)::int`,
          })
          .from(payments)
          .innerJoin(customers, eq(customers.id, payments.customerId))
          .leftJoin(users, eq(users.id, payments.receivedBy))
          .where(cond)
          .orderBy(desc(payments.receivedOn), desc(payments.number))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({
            n: sql<number>`count(*)::int`,
            sum: sql<number>`coalesce(sum(case when ${payments.status} = 'received' then ${payments.amount} end), 0)::int`,
          })
          .from(payments)
          .innerJoin(customers, eq(customers.id, payments.customerId))
          .where(cond),
      ]);
      return {
        items: rows,
        total: count?.n ?? 0,
        sumAmount: count?.sum ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    async getPayment(id: string) {
      const p = await db.query.payments.findFirst({ where: eq(payments.id, id) });
      if (!p) throw notFound('Payment');
      const [customer, allocs, by] = await Promise.all([
        db.query.customers.findFirst({ where: eq(customers.id, p.customerId) }),
        db
          .select({
            invoiceId: invoices.id,
            number: invoices.number,
            issueDate: invoices.issueDate,
            amount: paymentAllocations.amount,
            manual: paymentAllocations.manual,
          })
          .from(paymentAllocations)
          .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
          .where(eq(paymentAllocations.paymentId, id))
          .orderBy(asc(invoices.issueDate)),
        p.receivedBy ? db.query.users.findFirst({ where: eq(users.id, p.receivedBy) }) : null,
      ]);
      const allocated = allocs.reduce((s, a) => s + a.amount, 0);
      return {
        ...p,
        customer: { id: customer!.id, code: customer!.code, name: customer!.name },
        allocations: allocs,
        allocated,
        unallocated: p.status === 'received' ? p.amount - allocated : 0,
        receivedByName: by?.name ?? null,
      };
    },

    async createPayment(input: PaymentInput, actor: AuthUser, ctx: AuditContext) {
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, input.customerId),
      });
      if (!customer) throw new AppError(422, 'BAD_CUSTOMER', t('العميل غير موجود'));
      const id = await db.transaction(async (tx) => {
        const p = await insertPayment(tx, input, { source: 'office', receivedBy: actor.id });
        await rebalance(tx, input.customerId);
        await writeAudit(tx, ctx, {
          action: 'payment.create',
          entity: 'payment',
          entityId: p.id,
          after: p,
        });
        return p.id;
      });
      return this.getPayment(id);
    },

    async cancelPayment(id: string, reason: string, ctx: AuditContext) {
      const p = await db.query.payments.findFirst({ where: eq(payments.id, id) });
      if (!p) throw notFound('Payment');
      if (p.status === 'cancelled') throw new AppError(409, 'PAYMENT_CANCELLED', t('الدفعة ملغاة'));
      await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({ status: 'cancelled', cancelReason: reason.trim() })
          .where(eq(payments.id, id));
        await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, id));
        await rebalance(tx, p.customerId);
        await writeAudit(tx, ctx, {
          action: 'payment.cancel',
          entity: 'payment',
          entityId: id,
          before: { status: p.status, amount: p.amount },
          after: { status: 'cancelled', reason },
        });
      });
      return this.getPayment(id);
    },

    // ---------------------------------------------------------- receivables

    /** One row per customer with a balance: owed, overdue, aging, last payment. */
    async receivables(q: { search?: string; onlyOverdue?: boolean; tradeNameId?: string }) {
      const today = ammanDate(now());
      const rows = await db.execute<{
        customer_id: string;
        code: string;
        name: string;
        trade_name: string | null;
        balance_alerts: boolean;
        due_date: string;
        remaining: number;
      }>(sql`
        select c.id as customer_id, c.code, c.name, tn.name as trade_name, c.balance_alerts, i.due_date,
               (i.total - coalesce((select sum(pa.amount) from payment_allocations pa where pa.invoice_id = i.id), 0))::int as remaining
        from invoices i
        join customers c on c.id = i.customer_id
        left join trade_names tn on tn.id = c.trade_name_id
        where i.status <> 'cancelled'
          ${q.search ? sql`and (c.name ilike ${'%' + q.search + '%'} or c.code ilike ${'%' + q.search + '%'})` : sql``}
          ${q.tradeNameId ? sql`and c.trade_name_id = ${q.tradeNameId}` : sql``}`);
      const credits = await db.execute<{
        customer_id: string;
        credit: number;
        last_payment: string | null;
      }>(sql`
        select p.customer_id,
          coalesce(sum(case when p.status = 'received' then p.amount - coalesce((select sum(pa.amount) from payment_allocations pa where pa.payment_id = p.id), 0) end), 0)::int as credit,
          max(case when p.status = 'received' then p.received_on end)::text as last_payment
        from payments p group by p.customer_id`);
      const creditOf = new Map(credits.map((c) => [c.customer_id, c]));
      const byCustomer = new Map<
        string,
        {
          customerId: string;
          code: string;
          name: string;
          tradeName: string | null;
          balanceAlerts: boolean;
          owed: number;
          overdue: number;
          aging: Record<AgingBucket, number>;
          oldestDue: string | null;
        }
      >();
      for (const r of rows) {
        if (Number(r.remaining) <= 0) continue;
        let c = byCustomer.get(r.customer_id);
        if (!c) {
          c = {
            customerId: r.customer_id,
            code: r.code,
            name: r.name,
            tradeName: r.trade_name,
            balanceAlerts: r.balance_alerts,
            owed: 0,
            overdue: 0,
            aging: Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<
              AgingBucket,
              number
            >,
            oldestDue: null,
          };
          byCustomer.set(r.customer_id, c);
        }
        const due = String(r.due_date);
        const late = daysBetween(due, today);
        c.owed += Number(r.remaining);
        c.aging[agingBucket(late)] += Number(r.remaining);
        if (late > 0) c.overdue += Number(r.remaining);
        if (!c.oldestDue || due < c.oldestDue) c.oldestDue = due;
      }
      const list = [...byCustomer.values()]
        .map((c) => {
          const cr = creditOf.get(c.customerId);
          return {
            ...c,
            credit: cr?.credit ?? 0,
            balance: c.owed - (cr?.credit ?? 0),
            lastPaymentOn: cr?.last_payment ?? null,
          };
        })
        .filter((c) => !q.onlyOverdue || c.overdue > 0)
        .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
      const totals = list.reduce(
        (tr, c) => {
          tr.balance += c.balance;
          tr.overdue += c.overdue;
          for (const b of AGING_BUCKETS) tr.aging[b] += c.aging[b];
          return tr;
        },
        {
          balance: 0,
          overdue: 0,
          aging: Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<
            AgingBucket,
            number
          >,
        },
      );
      return { items: list, totals };
    },

    statement: statementData,

    async statementPdf(customerId: string, from: string, to: string) {
      const s = await statementData(customerId, from, to);
      const bytes = await deps.pdf(
        statementHtml({
          brand: await brandHeader(db, deps.files, s.customer.tradeNameId),
          customer: s.customer,
          from,
          to,
          opening: s.opening,
          rows: s.rows,
          closing: s.closing,
          overdue: s.summary.overdue,
          aging: AGING_BUCKETS.map((b) => ({
            label: t(AGING_LABELS_AR[b]),
            amount: s.summary.aging[b],
          })),
          printedOn: ammanDate(now()),
        }),
      );
      return { bytes, filename: `statement-${s.customer.code}-${to}.pdf` };
    },

    async setBalanceAlerts(customerId: string, enabled: boolean, ctx: AuditContext) {
      await db.transaction(async (tx) => {
        const [after] = await tx
          .update(customers)
          .set({ balanceAlerts: enabled })
          .where(eq(customers.id, customerId))
          .returning();
        if (!after) throw notFound('Customer');
        await writeAudit(tx, ctx, {
          action: 'customer.balance_alerts',
          entity: 'customer',
          entityId: customerId,
          after: { balanceAlerts: enabled },
        });
      });
      return { balanceAlerts: enabled };
    },

    /** Invoices of a day still in draft, for the "approve all" button. */
    async draftIds(issueDate: string) {
      const rows = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.status, 'draft'), eq(invoices.issueDate, issueDate)));
      return rows.map((r) => r.id);
    },

    /** Customers to remind today: alerts on, balance at least the minimum, overdue if required. */
    async alertTargets(settings: { minAmount: number; onlyOverdue: boolean }) {
      const r = await this.receivables({});
      return r.items.filter(
        (c) =>
          c.balanceAlerts &&
          c.balance >= settings.minAmount &&
          (!settings.onlyOverdue || c.overdue > 0),
      );
    },

    /** For tests and the scheduler: invoices dated before a day that are still drafts. */
    async staleDrafts(before: string) {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(invoices)
        .where(and(eq(invoices.status, 'draft'), lt(invoices.issueDate, before)));
      return r?.n ?? 0;
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
