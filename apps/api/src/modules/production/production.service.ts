import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  cutoffAt,
  type AuthUser,
  type OrderStatus,
  type ProductionDayStatus,
  type StockLossKind,
  type StockLossReason,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import {
  itemSections,
  items,
  orderItems,
  orders,
  productionDays,
  productionItems,
  productionLines,
  stockLosses,
  users,
  varianceApprovals,
  vehicleLoads,
  vehicles,
} from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clean } from '../../lib/db-utils.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';
import type { SettingsService } from '../settings/settings.service.js';

export type ItemUpdate = {
  itemId: string;
  extraQty?: number;
  producedQty?: number | null;
  note?: string | null;
};
export type LossInput = {
  itemId: string;
  kind: StockLossKind;
  reason: StockLossReason;
  quantity: number;
  note?: string | null;
};

/** Ordered quantities used for each plan kind. */
const PRELIMINARY_STATUSES: OrderStatus[] = ['submitted', 'pending_approval', 'confirmed'];
const FINAL_STATUSES: OrderStatus[] = ['confirmed'];

/** Allowed difference for a base quantity: at least 1 unit when there is any tolerance. */
const allowance = (base: number, bps: number) =>
  bps === 0 ? 0 : Math.max(1, Math.ceil((base * bps) / 10_000));

export type VarianceRow = ReturnType<typeof varianceFor>;

/**
 * Variance of one item for the day.
 *   productionDiff = produced − planned
 *   loadingDiff    = loaded − ordered      (short or over loading against confirmed orders)
 *   leftover       = produced − loaded − waste   (stock left in the bakery; negative is impossible)
 */
export function varianceFor(
  row: {
    ordered: number;
    planned: number;
    produced: number | null;
    loaded: number;
    waste: number;
    returned: number;
  },
  toleranceBps: number,
) {
  const produced = row.produced ?? 0;
  const productionDiff = produced - row.planned;
  const loadingDiff = row.loaded - row.ordered;
  const leftover = produced - row.loaded - row.waste;
  const reasons: string[] = [];
  if (row.produced === null) reasons.push('لم تُسجَّل الكمية المنتجة');
  else if (Math.abs(productionDiff) > allowance(row.planned, toleranceBps))
    reasons.push(productionDiff > 0 ? 'إنتاج أكثر من المخطط' : 'إنتاج أقل من المخطط');
  if (Math.abs(loadingDiff) > allowance(row.ordered, toleranceBps))
    reasons.push(loadingDiff > 0 ? 'تحميل أكثر من المطلوب' : 'تحميل أقل من المطلوب');
  if (row.produced !== null && leftover < 0) reasons.push('المحمّل والتالف أكثر من المنتج');
  return { productionDiff, loadingDiff, leftover, reasons, needsApproval: reasons.length > 0 };
}

export function createProductionService(deps: {
  db: Db;
  settings: SettingsService;
  now?: () => Date;
}) {
  const { db, settings } = deps;
  const now = () => deps.now?.() ?? new Date();

  async function dayOrThrow(date: string) {
    const day = await db.query.productionDays.findFirst({
      where: eq(productionDays.deliveryDate, date),
    });
    if (!day) throw new AppError(404, 'NO_PLAN', 'لم تُنشأ خطة إنتاج لهذا اليوم بعد');
    return day;
  }
  function assertOpen(day: { status: ProductionDayStatus }) {
    if (day.status === 'closed')
      throw new AppError(409, 'DAY_CLOSED', 'يوم الإنتاج مغلق ولا يمكن تعديله');
  }

  /** Every number of the day per item, used by the plan, the variance report and the history. */
  async function dayRows(dayId: string) {
    const base = await db
      .select({
        itemId: items.id,
        code: items.code,
        name: items.name,
        unit: items.unit,
        sectionId: itemSections.id,
        sectionName: itemSections.name,
        lineName: productionLines.name,
        ordered: productionItems.orderedQty,
        extra: productionItems.extraQty,
        produced: productionItems.producedQty,
        note: productionItems.note,
      })
      .from(productionItems)
      .innerJoin(items, eq(items.id, productionItems.itemId))
      .innerJoin(itemSections, eq(itemSections.id, items.sectionId))
      .leftJoin(productionLines, eq(productionLines.id, itemSections.productionLineId))
      .where(eq(productionItems.dayId, dayId))
      .orderBy(
        asc(productionLines.sortOrder),
        asc(itemSections.sortOrder),
        asc(items.sortOrder),
        asc(items.code),
      );
    const loads = await db
      .select({ itemId: vehicleLoads.itemId, qty: sql<number>`sum(${vehicleLoads.quantity})::int` })
      .from(vehicleLoads)
      .where(eq(vehicleLoads.dayId, dayId))
      .groupBy(vehicleLoads.itemId);
    const losses = await db
      .select({
        itemId: stockLosses.itemId,
        kind: stockLosses.kind,
        qty: sql<number>`sum(${stockLosses.quantity})::int`,
      })
      .from(stockLosses)
      .where(eq(stockLosses.dayId, dayId))
      .groupBy(stockLosses.itemId, stockLosses.kind);
    const loadMap = new Map(loads.map((l) => [l.itemId, l.qty]));
    const lossOf = (itemId: string, kind: StockLossKind) =>
      losses.find((l) => l.itemId === itemId && l.kind === kind)?.qty ?? 0;
    return base.map((r) => ({
      ...r,
      planned: r.ordered + r.extra,
      loaded: loadMap.get(r.itemId) ?? 0,
      waste: lossOf(r.itemId, 'waste'),
      returned: lossOf(r.itemId, 'return'),
    }));
  }

  /** Makes sure an item has a plan row (for loads/losses of items that were not ordered). */
  async function ensureItemRow(dayId: string, itemId: string) {
    const item = await db.query.items.findFirst({
      where: eq(items.id, itemId),
      columns: { id: true },
    });
    if (!item) throw new AppError(400, 'BAD_ITEM', 'صنف غير موجود');
    await db.insert(productionItems).values({ dayId, itemId }).onConflictDoNothing();
  }

  return {
    // ------------------------------------------------------------ setup
    listLines: () =>
      db
        .select({
          line: productionLines,
          sectionCount: sql<number>`(select count(*)::int from item_sections s where s.production_line_id = production_lines.id)`,
        })
        .from(productionLines)
        .orderBy(asc(productionLines.sortOrder), asc(productionLines.name))
        .then((rows) => rows.map((r) => ({ ...r.line, sectionCount: r.sectionCount }))),

    async saveLine(
      id: string | null,
      input: { name?: string; sortOrder?: number; isActive?: boolean },
      ctx: AuditContext,
    ) {
      const data = clean(input);
      if (data.name) {
        const clash = await db.query.productionLines.findFirst({
          where: and(
            eq(productionLines.name, data.name),
            id ? ne(productionLines.id, id) : undefined,
          ),
        });
        if (clash) throw new AppError(409, 'NAME_TAKEN', 'اسم الخط موجود مسبقاً');
      }
      return db.transaction(async (tx) => {
        const before = id
          ? await tx.query.productionLines.findFirst({ where: eq(productionLines.id, id) })
          : null;
        if (id && !before) throw notFound('Line');
        const [row] = id
          ? await tx.update(productionLines).set(data).where(eq(productionLines.id, id)).returning()
          : await tx
              .insert(productionLines)
              .values({ name: data.name!, ...data })
              .returning();
        await writeAudit(tx, ctx, {
          action: id ? 'production_line.update' : 'production_line.create',
          entity: 'production_line',
          entityId: row!.id,
          before,
          after: row,
        });
        return row!;
      });
    },

    listVehicles: () => db.select().from(vehicles).orderBy(asc(vehicles.name)),

    async saveVehicle(
      id: string | null,
      input: {
        name?: string;
        plate?: string | null;
        driverName?: string | null;
        isActive?: boolean;
      },
      ctx: AuditContext,
    ) {
      const data = clean(input);
      if (data.name) {
        const clash = await db.query.vehicles.findFirst({
          where: and(eq(vehicles.name, data.name), id ? ne(vehicles.id, id) : undefined),
        });
        if (clash) throw new AppError(409, 'NAME_TAKEN', 'اسم السيارة موجود مسبقاً');
      }
      return db.transaction(async (tx) => {
        const before = id
          ? await tx.query.vehicles.findFirst({ where: eq(vehicles.id, id) })
          : null;
        if (id && !before) throw notFound('Vehicle');
        const [row] = id
          ? await tx.update(vehicles).set(data).where(eq(vehicles.id, id)).returning()
          : await tx
              .insert(vehicles)
              .values({ name: data.name!, ...data })
              .returning();
        await writeAudit(tx, ctx, {
          action: id ? 'vehicle.update' : 'vehicle.create',
          entity: 'vehicle',
          entityId: row!.id,
          before,
          after: row,
        });
        return row!;
      });
    },

    // ------------------------------------------------------------ plan

    /**
     * Builds or refreshes the plan from orders. Before the cutoff it is preliminary (all live
     * orders); after it, final (confirmed orders only). Extra and produced quantities are kept.
     */
    async generate(date: string, ctx: AuditContext) {
      const { cutoffTime } = await settings.getOrderSettings();
      const { defaultExtraBps } = await settings.getProductionSettings();
      const afterCutoff = now() >= cutoffAt(date, cutoffTime);
      const existing = await db.query.productionDays.findFirst({
        where: eq(productionDays.deliveryDate, date),
      });
      if (existing) assertOpen(existing);
      const status: ProductionDayStatus = afterCutoff ? 'final' : 'preliminary';

      const ordered = await db
        .select({ itemId: orderItems.itemId, qty: sql<number>`sum(${orderItems.quantity})::int` })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
          and(
            eq(orders.deliveryDate, date),
            inArray(orders.status, afterCutoff ? FINAL_STATUSES : PRELIMINARY_STATUSES),
          ),
        )
        .groupBy(orderItems.itemId);

      const day = await db.transaction(async (tx) => {
        const [d] = existing
          ? await tx
              .update(productionDays)
              .set({
                status,
                generatedAt: now(),
                finalizedAt: afterCutoff ? (existing.finalizedAt ?? now()) : null,
              })
              .where(eq(productionDays.id, existing.id))
              .returning()
          : await tx
              .insert(productionDays)
              .values({
                deliveryDate: date,
                status,
                generatedAt: now(),
                finalizedAt: afterCutoff ? now() : null,
              })
              .returning();
        const current = await tx
          .select()
          .from(productionItems)
          .where(eq(productionItems.dayId, d!.id));
        const byItem = new Map(ordered.map((o) => [o.itemId, o.qty]));
        for (const o of ordered) {
          const row = current.find((c) => c.itemId === o.itemId);
          if (row) {
            await tx
              .update(productionItems)
              .set({ orderedQty: o.qty })
              .where(and(eq(productionItems.dayId, d!.id), eq(productionItems.itemId, o.itemId)));
          } else {
            await tx.insert(productionItems).values({
              dayId: d!.id,
              itemId: o.itemId,
              orderedQty: o.qty,
              extraQty: Math.round((o.qty * defaultExtraBps) / 10_000),
            });
          }
        }
        // Items no longer ordered: zero them, or drop the row if nothing else was entered.
        for (const c of current.filter((c) => !byItem.has(c.itemId))) {
          if (c.extraQty === 0 && c.producedQty === null)
            await tx
              .delete(productionItems)
              .where(and(eq(productionItems.dayId, d!.id), eq(productionItems.itemId, c.itemId)));
          else
            await tx
              .update(productionItems)
              .set({ orderedQty: 0 })
              .where(and(eq(productionItems.dayId, d!.id), eq(productionItems.itemId, c.itemId)));
        }
        await writeAudit(tx, ctx, {
          action: `production.generate_${status}`,
          entity: 'production_day',
          entityId: d!.id,
          after: { date, status, items: ordered.length },
        });
        return d!;
      });
      return this.getDay(day.deliveryDate);
    },

    async getDay(date: string) {
      const day = await db.query.productionDays.findFirst({
        where: eq(productionDays.deliveryDate, date),
      });
      if (!day) return null;
      const { toleranceBps } = await settings.getProductionSettings();
      const rows = await dayRows(day.id);
      const loads = await db
        .select({
          vehicleId: vehicleLoads.vehicleId,
          itemId: vehicleLoads.itemId,
          quantity: vehicleLoads.quantity,
        })
        .from(vehicleLoads)
        .where(eq(vehicleLoads.dayId, day.id));
      const losses = await db
        .select({
          id: stockLosses.id,
          itemId: stockLosses.itemId,
          itemName: items.name,
          kind: stockLosses.kind,
          reason: stockLosses.reason,
          quantity: stockLosses.quantity,
          note: stockLosses.note,
          createdAt: stockLosses.createdAt,
          createdByName: users.name,
        })
        .from(stockLosses)
        .innerJoin(items, eq(items.id, stockLosses.itemId))
        .leftJoin(users, eq(users.id, stockLosses.createdBy))
        .where(eq(stockLosses.dayId, day.id))
        .orderBy(desc(stockLosses.id));
      const approvals = await db
        .select({
          itemId: varianceApprovals.itemId,
          note: varianceApprovals.note,
          approvedAt: varianceApprovals.approvedAt,
          approvedByName: users.name,
        })
        .from(varianceApprovals)
        .leftJoin(users, eq(users.id, varianceApprovals.approvedBy))
        .where(eq(varianceApprovals.dayId, day.id));
      const [pending] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.deliveryDate, date), eq(orders.status, 'pending_approval')));
      return {
        ...day,
        toleranceBps,
        pendingOrders: pending?.n ?? 0,
        items: rows.map((r) => {
          const v = varianceFor(r, toleranceBps);
          const approval = approvals.find((a) => a.itemId === r.itemId) ?? null;
          return { ...r, ...v, approval, open: v.needsApproval && !approval };
        }),
        loads,
        losses,
      };
    },

    async updateItems(date: string, updates: ItemUpdate[], actor: AuthUser, ctx: AuditContext) {
      const day = await dayOrThrow(date);
      assertOpen(day);
      if (
        updates.some((u) => u.producedQty !== undefined) &&
        !actor.permissions.includes('production.manage')
      )
        throw new AppError(403, 'FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
      const before = await db
        .select()
        .from(productionItems)
        .where(eq(productionItems.dayId, day.id));
      await db.transaction(async (tx) => {
        for (const u of updates) {
          await tx
            .insert(productionItems)
            .values({ dayId: day.id, itemId: u.itemId })
            .onConflictDoNothing();
          const fields = clean(
            { extraQty: u.extraQty, producedQty: u.producedQty, note: u.note },
            [],
          );
          if (Object.keys(fields).length)
            await tx
              .update(productionItems)
              .set(fields)
              .where(and(eq(productionItems.dayId, day.id), eq(productionItems.itemId, u.itemId)));
        }
        await writeAudit(tx, ctx, {
          action: 'production.update_items',
          entity: 'production_day',
          entityId: day.id,
          before: before.filter((b) => updates.some((u) => u.itemId === b.itemId)),
          after: updates,
        });
      });
      return this.getDay(date);
    },

    /** Replaces what is loaded on one vehicle for the day. */
    async setLoads(
      date: string,
      vehicleId: string,
      lines: { itemId: string; quantity: number }[],
      ctx: AuditContext,
    ) {
      const day = await dayOrThrow(date);
      assertOpen(day);
      const v = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) });
      if (!v) throw new AppError(400, 'BAD_VEHICLE', 'السيارة غير موجودة');
      for (const l of lines) await ensureItemRow(day.id, l.itemId);
      const before = await db
        .select()
        .from(vehicleLoads)
        .where(and(eq(vehicleLoads.dayId, day.id), eq(vehicleLoads.vehicleId, vehicleId)));
      await db.transaction(async (tx) => {
        await tx
          .delete(vehicleLoads)
          .where(and(eq(vehicleLoads.dayId, day.id), eq(vehicleLoads.vehicleId, vehicleId)));
        const rows = lines.filter((l) => l.quantity > 0);
        if (rows.length)
          await tx
            .insert(vehicleLoads)
            .values(rows.map((l) => ({ ...l, dayId: day.id, vehicleId })));
        await writeAudit(tx, ctx, {
          action: 'production.load',
          entity: 'production_day',
          entityId: day.id,
          before: { vehicleId, lines: before },
          after: { vehicleId, lines: rows },
        });
      });
      return this.getDay(date);
    },

    async addLoss(date: string, input: LossInput, actor: AuthUser, ctx: AuditContext) {
      const day = await dayOrThrow(date);
      assertOpen(day);
      await ensureItemRow(day.id, input.itemId);
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(stockLosses)
          .values({ ...clean(input, []), dayId: day.id, createdBy: actor.id })
          .returning();
        await writeAudit(tx, ctx, {
          action: `production.${input.kind}`,
          entity: 'stock_loss',
          entityId: String(row!.id),
          after: row,
        });
      });
      return this.getDay(date);
    },

    async removeLoss(date: string, id: number, ctx: AuditContext) {
      const day = await dayOrThrow(date);
      assertOpen(day);
      const row = await db.query.stockLosses.findFirst({
        where: and(eq(stockLosses.id, id), eq(stockLosses.dayId, day.id)),
      });
      if (!row) throw notFound('Entry');
      await db.transaction(async (tx) => {
        await tx.delete(stockLosses).where(eq(stockLosses.id, id));
        await writeAudit(tx, ctx, {
          action: 'production.loss_remove',
          entity: 'stock_loss',
          entityId: String(id),
          before: row,
        });
      });
      return this.getDay(date);
    },

    // ------------------------------------------------------------ variances

    async approveVariance(
      date: string,
      itemId: string,
      note: string,
      actor: AuthUser,
      ctx: AuditContext,
    ) {
      const day = await dayOrThrow(date);
      assertOpen(day);
      const full = await this.getDay(date);
      const row = full!.items.find((i) => i.itemId === itemId);
      if (!row) throw notFound('Item');
      if (!row.needsApproval)
        throw new AppError(409, 'NO_VARIANCE', 'لا يوجد فرق يحتاج اعتماداً لهذا الصنف');
      await db.transaction(async (tx) => {
        await tx
          .insert(varianceApprovals)
          .values({ dayId: day.id, itemId, note, approvedBy: actor.id, approvedAt: now() })
          .onConflictDoUpdate({
            target: [varianceApprovals.dayId, varianceApprovals.itemId],
            set: { note, approvedBy: actor.id, approvedAt: now() },
          });
        await writeAudit(tx, ctx, {
          action: 'production.variance_approve',
          entity: 'production_day',
          entityId: day.id,
          after: {
            itemId,
            reasons: row.reasons,
            productionDiff: row.productionDiff,
            loadingDiff: row.loadingDiff,
            leftover: row.leftover,
          },
          reason: note,
        });
      });
      return this.getDay(date);
    },

    /** Closes the day once every item has a produced quantity and every variance is approved. */
    async close(date: string, actor: AuthUser, ctx: AuditContext) {
      const day = await dayOrThrow(date);
      assertOpen(day);
      if (day.status !== 'final')
        throw new AppError(
          409,
          'NOT_FINAL',
          'لا يمكن إغلاق خطة مبدئية — انتظر إغلاق الطلبات واعتماد الخطة النهائية',
        );
      const full = await this.getDay(date);
      const open = full!.items.filter((i) => i.open);
      if (open.length)
        throw new AppError(409, 'OPEN_VARIANCES', 'يوجد فروقات لم تُعتمد بعد', {
          items: open.map((i) => ({ itemId: i.itemId, name: i.name, reasons: i.reasons })),
        });
      await db.transaction(async (tx) => {
        await tx
          .update(productionDays)
          .set({ status: 'closed', closedAt: now(), closedBy: actor.id })
          .where(eq(productionDays.id, day.id));
        await writeAudit(tx, ctx, {
          action: 'production.close',
          entity: 'production_day',
          entityId: day.id,
          before: day,
        });
      });
      return this.getDay(date);
    },

    /** Daily totals for the history page. */
    async history(from: string, to: string) {
      const days = await db
        .select()
        .from(productionDays)
        .where(and(gte(productionDays.deliveryDate, from), lte(productionDays.deliveryDate, to)))
        .orderBy(desc(productionDays.deliveryDate));
      const { toleranceBps } = await settings.getProductionSettings();
      const out = [];
      for (const d of days) {
        const rows = await dayRows(d.id);
        const sum = (k: 'ordered' | 'planned' | 'loaded' | 'waste' | 'returned') =>
          rows.reduce((s, r) => s + r[k], 0);
        out.push({
          ...d,
          itemCount: rows.length,
          ordered: sum('ordered'),
          planned: sum('planned'),
          produced: rows.reduce((s, r) => s + (r.produced ?? 0), 0),
          loaded: sum('loaded'),
          waste: sum('waste'),
          returned: sum('returned'),
          flagged: rows.filter((r) => varianceFor(r, toleranceBps).needsApproval).length,
        });
      }
      return out;
    },
  };
}

export type ProductionService = ReturnType<typeof createProductionService>;
