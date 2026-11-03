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
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  addDays,
  ammanDate,
  currentDeliveryDate,
  cutoffAt,
  LIVE_ORDER_STATUSES,
  type AuthUser,
  type OrderEventType,
  type OrderSource,
  type OrderStatus,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import {
  branches,
  contractPrices,
  contracts,
  customers,
  itemSections,
  items,
  orderEvents,
  orderItems,
  orders,
  users,
} from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { isUniqueViolation, type Tx } from '../../lib/db-utils.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';
import { effectivePrice, evaluateCredit } from '../credit/credit-engine.js';
import { noOpenInvoices, type OpenInvoicesProvider } from '../contracts/contracts.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { Notifier, OrderNotice } from '../notifications/notifier.js';

export type OrderLineInput = { itemId: string; quantity: number };
export type PlaceInput = {
  branchId: string;
  deliveryDate?: string;
  lines: OrderLineInput[];
  notes?: string | null;
};
export type OrderListQuery = {
  deliveryDate?: string;
  status?: OrderStatus;
  customerId?: string;
  branchId?: string;
  search?: string;
  page: number;
  pageSize: number;
};

type OrderRow = typeof orders.$inferSelect;
type Line = {
  itemId: string;
  quantity: number;
  unitPrice: number;
  priceSource: string;
  lineTotal: number;
};

/** How far ahead a restaurant may order. */
const MAX_DAYS_AHEAD = 7;
const MAX_QUANTITY = 100_000;
const orderNumberFor = (n: number) => `ORD-${String(n).padStart(6, '0')}`;

export function createOrdersService(deps: {
  db: Db;
  settings: SettingsService;
  notifier: Notifier;
  openInvoices?: OpenInvoicesProvider;
  now?: () => Date;
}) {
  const { db, settings, notifier } = deps;
  const openInvoices = deps.openInvoices ?? noOpenInvoices;
  const now = () => deps.now?.() ?? new Date();

  const isStaff = (actor: AuthUser) => actor.permissions.includes('orders.manage');

  /** Notifications run in the background and never break an order (the notifier logs failures). */
  const pending = new Set<Promise<void>>();
  const notify = (notice: OrderNotice) => {
    const p: Promise<void> = notifier
      .order(notice)
      .catch(() => undefined)
      .finally(() => pending.delete(p));
    pending.add(p);
  };

  // ------------------------------------------------------------ helpers

  async function loadBranch(branchId: string, actor: AuthUser | null) {
    const [row] = await db
      .select({ branch: branches, customer: customers })
      .from(branches)
      .innerJoin(customers, eq(customers.id, branches.customerId))
      .where(eq(branches.id, branchId));
    if (!row) throw new AppError(400, 'BAD_BRANCH', 'الفرع غير موجود');
    if (actor && !isStaff(actor) && row.customer.id !== actor.customerId)
      throw new AppError(403, 'FORBIDDEN', 'هذا الفرع لا يتبع حسابك');
    if (!row.branch.isActive || !row.customer.isActive)
      throw new AppError(409, 'BRANCH_INACTIVE', 'الفرع أو العميل موقوف');
    return row;
  }

  /** The contract in force on the delivery date, else the latest non-terminated one. */
  async function contractFor(customerId: string, deliveryDate: string) {
    const inForce = await db.query.contracts.findFirst({
      where: and(
        eq(contracts.customerId, customerId),
        ne(contracts.status, 'terminated'),
        lte(contracts.startDate, deliveryDate),
        gte(contracts.endDate, deliveryDate),
      ),
    });
    if (inForce) return inForce;
    return db.query.contracts.findFirst({
      where: and(eq(contracts.customerId, customerId), ne(contracts.status, 'terminated')),
      orderBy: [desc(contracts.endDate)],
    });
  }

  /** Prices lines from the contract (special price, else base minus discount). */
  async function priceLines(
    lines: OrderLineInput[],
    contract: Awaited<ReturnType<typeof contractFor>>,
    allowInactive: Set<string> = new Set(),
  ): Promise<{ lines: Line[]; total: number }> {
    const merged = new Map<string, number>();
    for (const l of lines) {
      if (!Number.isInteger(l.quantity) || l.quantity < 0 || l.quantity > MAX_QUANTITY)
        throw new AppError(400, 'BAD_QUANTITY', 'الكمية غير صالحة');
      merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.quantity);
    }
    for (const [id, q] of merged) if (q === 0) merged.delete(id);
    if (merged.size === 0) throw new AppError(400, 'EMPTY_ORDER', 'الطلب لا يحتوي على أصناف');

    const ids = [...merged.keys()];
    const rows = await db
      .select({
        id: items.id,
        basePrice: items.basePrice,
        active: items.isActive,
        sectionActive: itemSections.isActive,
      })
      .from(items)
      .innerJoin(itemSections, eq(itemSections.id, items.sectionId))
      .where(inArray(items.id, ids));
    if (rows.length !== ids.length) throw new AppError(400, 'BAD_ITEM', 'صنف غير موجود');
    const inactive = rows.find((r) => !(r.active && r.sectionActive) && !allowInactive.has(r.id));
    if (inactive) throw new AppError(409, 'ITEM_INACTIVE', 'أحد الأصناف لم يعد متوفراً');

    const special = new Map<string, number>();
    if (contract) {
      const sp = await db
        .select({ itemId: contractPrices.itemId, price: contractPrices.price })
        .from(contractPrices)
        .where(
          and(eq(contractPrices.contractId, contract.id), inArray(contractPrices.itemId, ids)),
        );
      for (const p of sp) special.set(p.itemId, p.price);
    }
    const priced = rows.map((r) => {
      const quantity = merged.get(r.id)!;
      const { price, source } = effectivePrice(
        r.basePrice,
        special.get(r.id),
        contract?.discountBps ?? 0,
      );
      return {
        itemId: r.id,
        quantity,
        unitPrice: price,
        priceSource: source,
        lineTotal: price * quantity,
      };
    });
    return { lines: priced, total: priced.reduce((s, l) => s + l.lineTotal, 0) };
  }

  /** Credit decision for this order, counting the customer's other open (not yet invoiced) orders. */
  async function creditFor(
    customerId: string,
    deliveryDate: string,
    total: number,
    contract: Awaited<ReturnType<typeof contractFor>>,
    excludeOrderId?: string,
  ) {
    const [other] = await db
      .select({ sum: sql<number>`coalesce(sum(${orders.total}), 0)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.customerId, customerId),
          inArray(orders.status, ['submitted', 'pending_approval', 'confirmed']),
          gte(orders.deliveryDate, ammanDate(now())),
          excludeOrderId ? ne(orders.id, excludeOrderId) : undefined,
        ),
      );
    return evaluateCredit({
      today: deliveryDate,
      contract: contract ?? null,
      openInvoices: await openInvoices(customerId),
      orderAmount: total + (other?.sum ?? 0),
    });
  }

  async function addEvent(
    tx: Tx,
    orderId: string,
    type: OrderEventType,
    actorId: string | null,
    extra: { note?: string | null; data?: unknown } = {},
  ) {
    await tx
      .insert(orderEvents)
      .values({ orderId, type, actorId, note: extra.note ?? null, data: extra.data ?? null });
  }

  async function writeLines(tx: Tx, orderId: string, lines: Line[]) {
    await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
    if (lines.length) await tx.insert(orderItems).values(lines.map((l) => ({ ...l, orderId })));
  }

  async function currentLines(orderId: string) {
    return db
      .select({
        itemId: orderItems.itemId,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
  }

  async function nextNumber(tx: Tx) {
    const [row] = await tx.execute<{ n: string }>(sql`select nextval('order_number_seq') as n`);
    return orderNumberFor(Number(row!.n));
  }

  async function getRow(id: string) {
    const row = await db.query.orders.findFirst({ where: eq(orders.id, id) });
    if (!row) throw notFound('Order');
    return row;
  }

  function assertCanSee(actor: AuthUser, order: OrderRow) {
    if (
      !isStaff(actor) &&
      !actor.permissions.includes('orders.view') &&
      order.customerId !== actor.customerId
    )
      throw notFound('Order');
  }

  /** Restaurants may change an order only until the cutoff; staff any time. */
  async function assertEditable(actor: AuthUser, order: OrderRow) {
    if (['cancelled', 'rejected'].includes(order.status))
      throw new AppError(409, 'ORDER_CLOSED', 'الطلب ملغى أو مرفوض');
    if (order.status === 'delivered')
      throw new AppError(409, 'ORDER_DELIVERED', 'تم تسليم الطلب؛ أي تصحيح يكون على الفاتورة');
    if (isStaff(actor)) return;
    if (order.customerId !== actor.customerId) throw notFound('Order');
    const { cutoffTime } = await settings.getOrderSettings();
    if (now() >= cutoffAt(order.deliveryDate, cutoffTime) || order.status === 'confirmed')
      throw new AppError(409, 'ORDER_LOCKED', 'انتهى وقت تعديل الطلب، تواصل مع المخبز');
  }

  /** Status after saving: held if credit fails, confirmed if the cutoff already passed. */
  function statusAfterSave(
    decision: ReturnType<typeof evaluateCredit>,
    deliveryDate: string,
    cutoffTime: string,
    keepApproval: boolean,
  ): OrderStatus {
    if (!decision.allowed && !keepApproval) return 'pending_approval';
    return now() >= cutoffAt(deliveryDate, cutoffTime) ? 'confirmed' : 'submitted';
  }

  const auditCtx = (actor: AuthUser | null, ctx?: AuditContext): AuditContext =>
    ctx ?? { userId: actor?.id ?? null, ip: null, userAgent: null };

  // ------------------------------------------------------------ public API

  return {
    /** Resolves when background notifications have finished (tests, graceful shutdown). */
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },

    /** What a restaurant is ordering for right now, and until when. */
    async window() {
      const { cutoffTime } = await settings.getOrderSettings();
      const deliveryDate = currentDeliveryDate(now(), cutoffTime);
      return {
        deliveryDate,
        cutoffAt: cutoffAt(deliveryDate, cutoffTime).toISOString(),
        now: now().toISOString(),
      };
    },

    /** Price list a restaurant sees for a branch and date (from its contract). */
    async catalog(actor: AuthUser, branchId: string, deliveryDate?: string) {
      const { customer } = await loadBranch(branchId, actor);
      const { cutoffTime } = await settings.getOrderSettings();
      const date = deliveryDate ?? currentDeliveryDate(now(), cutoffTime);
      const contract = await contractFor(customer.id, date);
      const special = new Map(
        contract
          ? (
              await db
                .select({ itemId: contractPrices.itemId, price: contractPrices.price })
                .from(contractPrices)
                .where(eq(contractPrices.contractId, contract.id))
            ).map((p) => [p.itemId, p.price])
          : [],
      );
      const rows = await db
        .select({
          id: items.id,
          code: items.code,
          name: items.name,
          nameEn: items.nameEn,
          unit: items.unit,
          basePrice: items.basePrice,
          imageFileId: items.imageFileId,
          sectionId: itemSections.id,
          sectionName: itemSections.name,
        })
        .from(items)
        .innerJoin(itemSections, eq(itemSections.id, items.sectionId))
        .where(and(eq(items.isActive, true), eq(itemSections.isActive, true)))
        .orderBy(asc(itemSections.sortOrder), asc(items.sortOrder), asc(items.name));
      return rows.map((r) => ({
        ...r,
        ...effectivePrice(r.basePrice, special.get(r.id), contract?.discountBps ?? 0),
      }));
    },

    async place(actor: AuthUser, input: PlaceInput, source: OrderSource, ctx?: AuditContext) {
      const { branch, customer } = await loadBranch(input.branchId, actor);
      const s = await settings.getOrderSettings();
      const current = currentDeliveryDate(now(), s.cutoffTime);
      const deliveryDate = input.deliveryDate ?? current;
      if (!isStaff(actor)) {
        if (deliveryDate < current)
          throw new AppError(409, 'ORDER_LOCKED', 'انتهى وقت الطلب لهذا اليوم');
        if (deliveryDate > addDays(current, MAX_DAYS_AHEAD))
          throw new AppError(400, 'TOO_FAR_AHEAD', `يمكن الطلب حتى ${MAX_DAYS_AHEAD} أيام مقدماً`);
      } else if (deliveryDate < ammanDate(now())) {
        throw new AppError(400, 'PAST_DATE', 'لا يمكن إنشاء طلب لتاريخ سابق');
      }

      const existing = await db.query.orders.findFirst({
        where: and(
          eq(orders.branchId, branch.id),
          eq(orders.deliveryDate, deliveryDate),
          inArray(orders.status, LIVE_ORDER_STATUSES),
        ),
      });
      // A waiting draft becomes the order; anything else is a duplicate.
      if (existing && existing.status !== 'draft')
        throw new AppError(409, 'ORDER_EXISTS', 'يوجد طلب لهذا الفرع في نفس اليوم — يمكنك تعديله', {
          orderId: existing.id,
        });
      if (existing)
        return this.update(actor, existing.id, { lines: input.lines, notes: input.notes }, ctx);

      const contract = await contractFor(customer.id, deliveryDate);
      const { lines, total } = await priceLines(input.lines, contract);
      const decision = await creditFor(customer.id, deliveryDate, total, contract);
      const status = statusAfterSave(decision, deliveryDate, s.cutoffTime, false);

      try {
        const order = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(orders)
            .values({
              number: await nextNumber(tx),
              customerId: customer.id,
              branchId: branch.id,
              contractId: contract?.id ?? null,
              deliveryDate,
              status,
              source,
              total,
              itemCount: lines.length,
              notes: input.notes?.trim() || null,
              creditReasons: status === 'pending_approval' ? decision.reasons : null,
              createdBy: actor.id,
              submittedAt: now(),
              confirmedAt: status === 'confirmed' ? now() : null,
            })
            .returning();
          await writeLines(tx, created!.id, lines);
          await addEvent(tx, created!.id, 'created', actor.id, { data: { lines, total } });
          if (status === 'pending_approval')
            await addEvent(tx, created!.id, 'approval_requested', null, { data: decision.reasons });
          await writeAudit(tx, auditCtx(actor, ctx), {
            action: 'order.create',
            entity: 'order',
            entityId: created!.id,
            after: { ...created, lines },
          });
          return created!;
        });
        notify({
          type: status === 'pending_approval' ? 'order_on_hold' : 'order_placed',
          orderId: order.id,
        });
        return this.get(actor, order.id);
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError(
            409,
            'ORDER_EXISTS',
            'يوجد طلب لهذا الفرع في نفس اليوم — يمكنك تعديله',
          );
        throw err;
      }
    },

    async update(
      actor: AuthUser,
      id: string,
      input: { lines?: OrderLineInput[]; notes?: string | null },
      ctx?: AuditContext,
    ) {
      const before = await getRow(id);
      await assertEditable(actor, before);
      const s = await settings.getOrderSettings();
      const beforeLines = await currentLines(id);
      const contract = await contractFor(before.customerId, before.deliveryDate);
      // Items already on the order may stay even if they were deactivated since.
      const { lines, total } = await priceLines(
        input.lines ?? beforeLines,
        contract,
        new Set(beforeLines.map((l) => l.itemId)),
      );
      const decision = await creditFor(before.customerId, before.deliveryDate, total, contract, id);
      // A manager's approval still covers the order if it did not grow.
      const keepApproval = Boolean(before.approvedBy) && total <= before.total;
      const status = statusAfterSave(decision, before.deliveryDate, s.cutoffTime, keepApproval);
      const wasDraft = before.status === 'draft';

      const updated = await db.transaction(async (tx) => {
        const [after] = await tx
          .update(orders)
          .set({
            status,
            total,
            itemCount: lines.length,
            contractId: contract?.id ?? null,
            ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
            creditReasons: status === 'pending_approval' ? decision.reasons : null,
            ...(keepApproval ? {} : { approvedBy: null, approvedAt: null, approvalNote: null }),
            submittedAt: wasDraft ? now() : before.submittedAt,
            confirmedAt: status === 'confirmed' ? (before.confirmedAt ?? now()) : null,
          })
          .where(eq(orders.id, id))
          .returning();
        await writeLines(tx, id, lines);
        await addEvent(tx, id, wasDraft ? 'submitted' : 'updated', actor.id, {
          data: { before: { lines: beforeLines, total: before.total }, after: { lines, total } },
        });
        if (status === 'pending_approval' && before.status !== 'pending_approval')
          await addEvent(tx, id, 'approval_requested', null, { data: decision.reasons });
        await writeAudit(tx, auditCtx(actor, ctx), {
          action: wasDraft ? 'order.submit' : 'order.update',
          entity: 'order',
          entityId: id,
          before: { ...before, lines: beforeLines },
          after: { ...after, lines },
        });
        return after!;
      });
      notify({
        type:
          updated.status === 'pending_approval'
            ? 'order_on_hold'
            : wasDraft
              ? 'order_placed'
              : 'order_updated',
        orderId: id,
      });
      return this.get(actor, id);
    },

    /** Restaurant confirms a draft as it is. */
    async submitDraft(actor: AuthUser, id: string, ctx?: AuditContext) {
      const order = await getRow(id);
      if (order.status !== 'draft') throw new AppError(409, 'NOT_DRAFT', 'الطلب ليس مسودة');
      return this.update(actor, id, {}, ctx);
    },

    async cancel(actor: AuthUser, id: string, reason: string | null, ctx?: AuditContext) {
      const before = await getRow(id);
      await assertEditable(actor, before);
      await db.transaction(async (tx) => {
        const [after] = await tx
          .update(orders)
          .set({ status: 'cancelled', cancelledAt: now(), cancelReason: reason })
          .where(eq(orders.id, id))
          .returning();
        await addEvent(tx, id, 'cancelled', actor.id, { note: reason });
        await writeAudit(tx, auditCtx(actor, ctx), {
          action: 'order.cancel',
          entity: 'order',
          entityId: id,
          before,
          after,
          reason,
        });
      });
      notify({ type: 'order_cancelled', orderId: id });
      return this.get(actor, id);
    },

    /** Manager decision on an order held by the credit rules (needs credit.override). */
    async decide(actor: AuthUser, id: string, approve: boolean, note: string, ctx?: AuditContext) {
      const before = await getRow(id);
      if (before.status !== 'pending_approval')
        throw new AppError(409, 'NOT_PENDING', 'الطلب ليس بانتظار الموافقة');
      const { cutoffTime } = await settings.getOrderSettings();
      const status: OrderStatus = !approve
        ? 'rejected'
        : now() >= cutoffAt(before.deliveryDate, cutoffTime)
          ? 'confirmed'
          : 'submitted';
      await db.transaction(async (tx) => {
        const [after] = await tx
          .update(orders)
          .set({
            status,
            approvedBy: approve ? actor.id : null,
            approvedAt: approve ? now() : null,
            approvalNote: note,
            confirmedAt: status === 'confirmed' ? now() : null,
          })
          .where(eq(orders.id, id))
          .returning();
        await addEvent(tx, id, approve ? 'approved' : 'rejected', actor.id, {
          note,
          data: before.creditReasons,
        });
        await writeAudit(tx, auditCtx(actor, ctx), {
          action: approve ? 'order.credit_approve' : 'order.credit_reject',
          entity: 'order',
          entityId: id,
          before,
          after,
          reason: note,
        });
      });
      notify({ type: approve ? 'order_approved' : 'order_rejected', orderId: id });
      return this.get(actor, id);
    },

    /** Copies the branch's last order (before the current delivery date) into a new order. */
    async repeatLast(actor: AuthUser, branchId: string, ctx?: AuditContext) {
      await loadBranch(branchId, actor);
      const { cutoffTime } = await settings.getOrderSettings();
      const deliveryDate = currentDeliveryDate(now(), cutoffTime);
      const last = await db.query.orders.findFirst({
        where: and(
          eq(orders.branchId, branchId),
          lt(orders.deliveryDate, deliveryDate),
          inArray(orders.status, ['submitted', 'confirmed']),
        ),
        orderBy: [desc(orders.deliveryDate)],
      });
      if (!last) throw new AppError(404, 'NO_PREVIOUS_ORDER', 'لا يوجد طلب سابق لهذا الفرع');
      const lines = await currentLines(last.id);
      const activeIds = new Set(
        (
          await db
            .select({ id: items.id })
            .from(items)
            .innerJoin(itemSections, eq(itemSections.id, items.sectionId))
            .where(
              and(
                inArray(
                  items.id,
                  lines.map((l) => l.itemId),
                ),
                eq(items.isActive, true),
                eq(itemSections.isActive, true),
              ),
            )
        ).map((r) => r.id),
      );
      return this.place(
        actor,
        { branchId, deliveryDate, lines: lines.filter((l) => activeIds.has(l.itemId)) },
        isStaff(actor) ? 'dashboard' : 'app',
        ctx,
      );
    },

    async get(actor: AuthUser, id: string) {
      const order = await getRow(id);
      assertCanSee(actor, order);
      const [info] = await db
        .select({
          customerName: customers.name,
          customerCode: customers.code,
          branchName: branches.name,
          branchCode: branches.code,
        })
        .from(branches)
        .innerJoin(customers, eq(customers.id, branches.customerId))
        .where(eq(branches.id, order.branchId));
      const lines = await db
        .select({
          itemId: orderItems.itemId,
          quantity: orderItems.quantity,
          unitPrice: orderItems.unitPrice,
          priceSource: orderItems.priceSource,
          lineTotal: orderItems.lineTotal,
          code: items.code,
          name: items.name,
          unit: items.unit,
        })
        .from(orderItems)
        .innerJoin(items, eq(items.id, orderItems.itemId))
        .where(eq(orderItems.orderId, id))
        .orderBy(asc(items.code));
      const events = await db
        .select({
          id: orderEvents.id,
          type: orderEvents.type,
          note: orderEvents.note,
          data: orderEvents.data,
          createdAt: orderEvents.createdAt,
          actorName: users.name,
        })
        .from(orderEvents)
        .leftJoin(users, eq(users.id, orderEvents.actorId))
        .where(eq(orderEvents.orderId, id))
        .orderBy(asc(orderEvents.id));
      const { cutoffTime } = await settings.getOrderSettings();
      const cutoff = cutoffAt(order.deliveryDate, cutoffTime);
      return {
        ...order,
        ...info!,
        lines,
        events,
        cutoffAt: cutoff.toISOString(),
        editableByRestaurant:
          now() < cutoff && ['draft', 'submitted', 'pending_approval'].includes(order.status),
      };
    },

    async list(actor: AuthUser, q: OrderListQuery) {
      const filters: SQL[] = [];
      if (!isStaff(actor) && !actor.permissions.includes('orders.view'))
        filters.push(
          eq(orders.customerId, actor.customerId ?? '00000000-0000-0000-0000-000000000000'),
        );
      if (q.deliveryDate) filters.push(eq(orders.deliveryDate, q.deliveryDate));
      if (q.status) filters.push(eq(orders.status, q.status));
      if (q.customerId) filters.push(eq(orders.customerId, q.customerId));
      if (q.branchId) filters.push(eq(orders.branchId, q.branchId));
      if (q.search) {
        const term = `%${q.search}%`;
        filters.push(
          or(ilike(orders.number, term), ilike(customers.name, term), ilike(customers.code, term))!,
        );
      }
      const where = filters.length ? and(...filters) : undefined;
      const [rows, [total]] = await Promise.all([
        db
          .select({
            order: orders,
            customerName: customers.name,
            customerCode: customers.code,
            branchName: branches.name,
            branchCode: branches.code,
          })
          .from(orders)
          .innerJoin(customers, eq(customers.id, orders.customerId))
          .innerJoin(branches, eq(branches.id, orders.branchId))
          .where(where)
          .orderBy(desc(orders.deliveryDate), asc(customers.name), asc(branches.code))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(orders)
          .innerJoin(customers, eq(customers.id, orders.customerId))
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({
          ...r.order,
          customerName: r.customerName,
          customerCode: r.customerCode,
          branchName: r.branchName,
          branchCode: r.branchCode,
        })),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    /** Preliminary summary for production: totals per item for a delivery date. */
    async summary(deliveryDate: string) {
      const live = ['submitted', 'pending_approval', 'confirmed'] as OrderStatus[];
      const perItem = await db
        .select({
          itemId: items.id,
          code: items.code,
          name: items.name,
          unit: items.unit,
          sectionName: itemSections.name,
          quantity: sql<number>`sum(${orderItems.quantity})::int`,
          confirmedQuantity: sql<number>`sum(case when ${orders.status} = 'confirmed' then ${orderItems.quantity} else 0 end)::int`,
          amount: sql<number>`sum(${orderItems.lineTotal})::int`,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .innerJoin(items, eq(items.id, orderItems.itemId))
        .innerJoin(itemSections, eq(itemSections.id, items.sectionId))
        .where(and(eq(orders.deliveryDate, deliveryDate), inArray(orders.status, live)))
        .groupBy(
          items.id,
          items.code,
          items.name,
          items.unit,
          itemSections.name,
          itemSections.sortOrder,
        )
        .orderBy(asc(itemSections.sortOrder), asc(items.code));
      const counts = await db
        .select({
          status: orders.status,
          n: sql<number>`count(*)::int`,
          total: sql<number>`sum(${orders.total})::int`,
        })
        .from(orders)
        .where(eq(orders.deliveryDate, deliveryDate))
        .groupBy(orders.status);
      const missing = await this.branchesWithoutOrder(deliveryDate);
      return { deliveryDate, items: perItem, counts, branchesWithoutOrder: missing };
    },

    /** Active branches of active customers with an in-force contract and no live order for the date. */
    async branchesWithoutOrder(deliveryDate: string) {
      return db
        .select({
          branchId: branches.id,
          branchName: branches.name,
          branchCode: branches.code,
          branchPhone: branches.phone,
          customerId: customers.id,
          customerName: customers.name,
          customerPhone: customers.phone,
        })
        .from(branches)
        .innerJoin(customers, eq(customers.id, branches.customerId))
        .where(
          and(
            eq(branches.isActive, true),
            eq(customers.isActive, true),
            sql`exists (select 1 from contracts c where c.customer_id = ${customers.id}
                  and c.status = 'active' and c.start_date <= ${deliveryDate} and c.end_date >= ${deliveryDate})`,
            sql`not exists (select 1 from orders o where o.branch_id = ${branches.id}
                  and o.delivery_date = ${deliveryDate}
                  and o.status in ('draft','submitted','pending_approval','confirmed','delivered'))`,
          ),
        )
        .orderBy(asc(customers.name), asc(branches.code));
    },

    // ------------------------------------------------------------ scheduler jobs

    /** Midnight job: a draft for each branch without an order, copied from its previous day's order. */
    async createDrafts(deliveryDate: string) {
      const candidates = await this.branchesWithoutOrder(deliveryDate);
      let created = 0;
      for (const b of candidates) {
        const prev = await db.query.orders.findFirst({
          where: and(
            eq(orders.branchId, b.branchId),
            eq(orders.deliveryDate, addDays(deliveryDate, -1)),
            inArray(orders.status, ['submitted', 'confirmed']),
          ),
        });
        if (!prev) continue;
        const contract = await contractFor(b.customerId, deliveryDate);
        let priced: { lines: Line[]; total: number };
        try {
          const prevLines = await currentLines(prev.id);
          const activeRows = await db
            .select({ id: items.id })
            .from(items)
            .innerJoin(itemSections, eq(itemSections.id, items.sectionId))
            .where(
              and(
                inArray(
                  items.id,
                  prevLines.map((l) => l.itemId),
                ),
                eq(items.isActive, true),
                eq(itemSections.isActive, true),
              ),
            );
          const active = new Set(activeRows.map((r) => r.id));
          priced = await priceLines(
            prevLines.filter((l) => active.has(l.itemId)),
            contract,
          );
        } catch {
          continue; // nothing left to copy
        }
        try {
          const id = await db.transaction(async (tx) => {
            const [draft] = await tx
              .insert(orders)
              .values({
                number: await nextNumber(tx),
                customerId: b.customerId,
                branchId: b.branchId,
                contractId: contract?.id ?? null,
                deliveryDate,
                status: 'draft',
                source: 'auto_draft',
                total: priced.total,
                itemCount: priced.lines.length,
              })
              .returning();
            await writeLines(tx, draft!.id, priced.lines);
            await addEvent(tx, draft!.id, 'draft_created', null, {
              data: { fromOrderId: prev.id },
            });
            await writeAudit(
              tx,
              { userId: null, ip: 'scheduler' },
              {
                action: 'order.draft',
                entity: 'order',
                entityId: draft!.id,
                after: draft,
              },
            );
            return draft!.id;
          });
          created++;
          notify({ type: 'draft_ready', orderId: id });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err; // the restaurant ordered meanwhile
        }
      }
      return { created };
    },

    /** Cutoff job: confirm submitted orders; drafts are submitted or cancelled per settings. */
    async closeOrdering(deliveryDate: string) {
      const s = await settings.getOrderSettings();
      const ctx: AuditContext = { userId: null, ip: 'scheduler' };
      const drafts = await db.query.orders.findMany({
        where: and(eq(orders.deliveryDate, deliveryDate), eq(orders.status, 'draft')),
      });
      let draftsSubmitted = 0;
      let draftsCancelled = 0;
      for (const d of drafts) {
        if (s.autoSubmitDrafts) {
          const contract = await contractFor(d.customerId, deliveryDate);
          const decision = await creditFor(d.customerId, deliveryDate, d.total, contract, d.id);
          const status: OrderStatus = decision.allowed ? 'confirmed' : 'pending_approval';
          await db.transaction(async (tx) => {
            await tx
              .update(orders)
              .set({
                status,
                submittedAt: now(),
                confirmedAt: status === 'confirmed' ? now() : null,
                creditReasons: decision.allowed ? null : decision.reasons,
              })
              .where(eq(orders.id, d.id));
            await addEvent(
              tx,
              d.id,
              status === 'confirmed' ? 'confirmed' : 'approval_requested',
              null,
              {
                note: 'إرسال تلقائي للمسودة عند الإغلاق',
              },
            );
            await writeAudit(tx, ctx, {
              action: 'order.auto_submit',
              entity: 'order',
              entityId: d.id,
              before: d,
            });
          });
          draftsSubmitted++;
        } else {
          await db.transaction(async (tx) => {
            await tx
              .update(orders)
              .set({
                status: 'cancelled',
                cancelledAt: now(),
                cancelReason: 'لم تُؤكَّد المسودة قبل الإغلاق',
              })
              .where(eq(orders.id, d.id));
            await addEvent(tx, d.id, 'cancelled', null, { note: 'لم تُؤكَّد المسودة قبل الإغلاق' });
            await writeAudit(tx, ctx, {
              action: 'order.draft_expire',
              entity: 'order',
              entityId: d.id,
              before: d,
            });
          });
          draftsCancelled++;
        }
      }
      const confirmed = await db.transaction(async (tx) => {
        const rows = await tx
          .update(orders)
          .set({ status: 'confirmed', confirmedAt: now() })
          .where(and(eq(orders.deliveryDate, deliveryDate), eq(orders.status, 'submitted')))
          .returning({ id: orders.id });
        for (const r of rows) await addEvent(tx, r.id, 'confirmed', null);
        if (rows.length)
          await writeAudit(tx, ctx, {
            action: 'order.cutoff_confirm',
            entity: 'orders',
            entityId: deliveryDate,
            after: { count: rows.length },
          });
        return rows.length;
      });
      const [pending] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.deliveryDate, deliveryDate), eq(orders.status, 'pending_approval')));
      return { confirmed, draftsSubmitted, draftsCancelled, pendingApproval: pending?.n ?? 0 };
    },

    /** For reminders: branches that still have no submitted order (drafts count as "not yet"). */
    async branchesToRemind(deliveryDate: string) {
      const withoutOrder = await this.branchesWithoutOrder(deliveryDate);
      const draftBranches = await db
        .select({
          branchId: branches.id,
          branchName: branches.name,
          branchCode: branches.code,
          branchPhone: branches.phone,
          customerId: customers.id,
          customerName: customers.name,
          customerPhone: customers.phone,
        })
        .from(orders)
        .innerJoin(branches, eq(branches.id, orders.branchId))
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(and(eq(orders.deliveryDate, deliveryDate), eq(orders.status, 'draft')));
      return [...withoutOrder, ...draftBranches];
    },

    /** Restaurant: its branches with their order for the current delivery date. */
    async myDay(actor: AuthUser) {
      if (!actor.customerId) throw new AppError(403, 'FORBIDDEN', 'هذا الحساب غير مرتبط بعميل');
      const win = await this.window();
      const branchRows = await db
        .select({
          id: branches.id,
          code: branches.code,
          name: branches.name,
          address: branches.address,
        })
        .from(branches)
        .where(and(eq(branches.customerId, actor.customerId), eq(branches.isActive, true)))
        .orderBy(asc(branches.code));
      const dayOrders = await db.query.orders.findMany({
        where: and(
          eq(orders.customerId, actor.customerId),
          eq(orders.deliveryDate, win.deliveryDate),
          notInArray(orders.status, ['cancelled', 'rejected']),
        ),
      });
      return {
        ...win,
        branches: branchRows.map((b) => ({
          ...b,
          order: dayOrders.find((o) => o.branchId === b.id) ?? null,
        })),
      };
    },
  };
}

export type OrdersService = ReturnType<typeof createOrdersService>;
