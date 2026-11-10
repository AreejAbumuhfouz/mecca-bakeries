import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  ammanDate,
  ITEM_UNIT_LABELS_AR,
  PAYMENT_TYPE_LABELS_AR,
  type AuthUser,
  type DeliveryReason,
  type DeliveryStatus,
  type PaymentMethod,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import {
  branches,
  contracts,
  customers,
  deliveries,
  deliveryLines,
  invoices,
  items,
  orderEvents,
  orderItems,
  orders,
  payments,
  routeStops,
  routes,
  trips,
  users,
  vehicles,
} from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clean } from '../../lib/db-utils.js';
import type { PdfRenderer } from '../../lib/pdf.js';
import { brandHeader } from '../../lib/brand-header.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';
import type { FilesService } from '../files/files.service.js';
import type { BillingService } from '../billing/billing.service.js';
import { loadingSheetHtml } from '../billing/billing-pdf.js';
import { t } from '../../lib/i18n.js';

export type RouteInput = {
  name?: string;
  vehicleId?: string | null;
  driverId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type ConfirmInput = {
  /** Generated on the phone; re-sending the same confirmation is harmless. */
  clientRef: string;
  outcome: 'delivered' | 'failed';
  failReason?: DeliveryReason | null;
  lines: {
    itemId: string;
    deliveredQty: number;
    shortReason?: DeliveryReason | null;
    returnedQty: number;
    returnReason?: DeliveryReason | null;
  }[];
  receiverName?: string | null;
  signatureSvg?: string | null;
  deliveredAt: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  collected?: { amount: number; method: PaymentMethod; reference?: string | null } | null;
  note?: string | null;
};

const unitAr = (u: string) => t((ITEM_UNIT_LABELS_AR as Record<string, string>)[u] ?? u);

export function createDistributionService(deps: {
  db: Db;
  billing: BillingService;
  files: FilesService;
  pdf: PdfRenderer;
  now?: () => Date;
}) {
  const { db, billing } = deps;
  const now = () => deps.now?.() ?? new Date();

  async function tripOrThrow(id: string) {
    const tr = await db.query.trips.findFirst({ where: eq(trips.id, id) });
    if (!tr) throw notFound('Trip');
    return tr;
  }

  function assertDriver(trip: { driverId: string | null }, actor: AuthUser) {
    if (actor.permissions.includes('deliveries.manage')) return;
    if (trip.driverId !== actor.id)
      throw new AppError(403, 'NOT_YOUR_TRIP', t('هذا المسار ليس لك'));
  }

  /** Everything the driver needs for one trip, so the phone can work without a connection. */
  async function tripDetail(tripId: string) {
    const trip = await tripOrThrow(tripId);
    const [route, driver, vehicle] = await Promise.all([
      db.query.routes.findFirst({ where: eq(routes.id, trip.routeId) }),
      trip.driverId ? db.query.users.findFirst({ where: eq(users.id, trip.driverId) }) : null,
      trip.vehicleId
        ? db.query.vehicles.findFirst({ where: eq(vehicles.id, trip.vehicleId) })
        : null,
    ]);
    const stops = await db
      .select({
        delivery: deliveries,
        order: {
          id: orders.id,
          number: orders.number,
          total: orders.total,
          status: orders.status,
          notes: orders.notes,
        },
        customer: {
          id: customers.id,
          code: customers.code,
          name: customers.name,
          phone: customers.phone,
        },
        branch: {
          id: branches.id,
          name: branches.name,
          address: branches.address,
          phone: branches.phone,
        },
        contract: {
          paymentType: contracts.paymentType,
          allowReturns: contracts.allowReturns,
          maxReturnBps: contracts.maxReturnBps,
        },
      })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(branches, eq(branches.id, orders.branchId))
      .leftJoin(contracts, eq(contracts.id, orders.contractId))
      .where(eq(deliveries.tripId, tripId))
      .orderBy(asc(deliveries.position), asc(branches.name));
    const orderIds = stops.map((s) => s.order.id);
    const deliveryIds = stops.map((s) => s.delivery.id);
    const [ordered, done, invs, pays] = await Promise.all([
      orderIds.length
        ? db
            .select({
              orderId: orderItems.orderId,
              itemId: items.id,
              code: items.code,
              name: items.name,
              unit: items.unit,
              quantity: orderItems.quantity,
              unitPrice: orderItems.unitPrice,
              sortOrder: items.sortOrder,
            })
            .from(orderItems)
            .innerJoin(items, eq(items.id, orderItems.itemId))
            .where(inArray(orderItems.orderId, orderIds))
            .orderBy(asc(items.sortOrder))
        : [],
      deliveryIds.length
        ? db.select().from(deliveryLines).where(inArray(deliveryLines.deliveryId, deliveryIds))
        : [],
      deliveryIds.length
        ? db
            .select({
              deliveryId: invoices.deliveryId,
              id: invoices.id,
              number: invoices.number,
              total: invoices.total,
            })
            .from(invoices)
            .where(and(inArray(invoices.deliveryId, deliveryIds), ne(invoices.status, 'cancelled')))
        : [],
      deliveryIds.length
        ? db
            .select({
              deliveryId: payments.deliveryId,
              number: payments.number,
              amount: payments.amount,
            })
            .from(payments)
            .where(and(inArray(payments.deliveryId, deliveryIds), eq(payments.status, 'received')))
        : [],
    ]);
    const balances = new Map<string, number>();
    for (const s of stops)
      if (!balances.has(s.customer.id))
        balances.set(s.customer.id, (await billing.summary(s.customer.id)).balance);

    return {
      id: trip.id,
      deliveryDate: trip.deliveryDate,
      status: trip.status,
      startedAt: trip.startedAt,
      finishedAt: trip.finishedAt,
      route: { id: route!.id, name: route!.name },
      driver: driver ? { id: driver.id, name: driver.name } : null,
      vehicle: vehicle ? { id: vehicle.id, name: vehicle.name, plate: vehicle.plate } : null,
      stops: stops.map((s, i) => {
        const inv = invs.find((x) => x.deliveryId === s.delivery.id);
        const pay = pays.find((x) => x.deliveryId === s.delivery.id);
        const lines = done.filter((d) => d.deliveryId === s.delivery.id);
        return {
          deliveryId: s.delivery.id,
          position: i + 1,
          status: s.delivery.status,
          order: s.order,
          customer: s.customer,
          branch: s.branch,
          paymentType: s.contract?.paymentType ?? 'credit',
          allowReturns: s.contract?.allowReturns ?? false,
          maxReturnBps: s.contract?.maxReturnBps ?? 0,
          /** Owed by the customer now (after today's invoice if already delivered). */
          balance: balances.get(s.customer.id) ?? 0,
          items: ordered
            .filter((o) => o.orderId === s.order.id)
            .map(({ orderId: _o, sortOrder: _s, ...o }) => ({ ...o, unitLabel: unitAr(o.unit) })),
          result:
            s.delivery.status === 'pending'
              ? null
              : {
                  receiverName: s.delivery.receiverName,
                  deliveredAt: s.delivery.deliveredAt,
                  confirmedAt: s.delivery.confirmedAt,
                  failReason: s.delivery.failReason,
                  latitude: s.delivery.latitude,
                  longitude: s.delivery.longitude,
                  hasSignature: Boolean(s.delivery.signatureSvg),
                  collectedAmount: s.delivery.collectedAmount,
                  collectedMethod: s.delivery.collectedMethod,
                  note: s.delivery.note,
                  lines,
                  invoice: inv ?? null,
                  receipt: pay ?? null,
                },
        };
      }),
    };
  }

  async function markTripProgress(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    tripId: string,
  ) {
    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(deliveries)
      .where(and(eq(deliveries.tripId, tripId), eq(deliveries.status, 'pending')));
    await tx
      .update(trips)
      .set(
        (left?.n ?? 0) === 0
          ? {
              status: 'done',
              finishedAt: now(),
              startedAt: sql`coalesce(${trips.startedAt}, now())`,
            }
          : { status: 'out', startedAt: sql`coalesce(${trips.startedAt}, now())` },
      )
      .where(eq(trips.id, tripId));
  }

  return {
    // ---------------------------------------------------------- routes

    async listRoutes() {
      const rows = await db
        .select({
          route: routes,
          vehicleName: vehicles.name,
          driverName: users.name,
        })
        .from(routes)
        .leftJoin(vehicles, eq(vehicles.id, routes.vehicleId))
        .leftJoin(users, eq(users.id, routes.driverId))
        .orderBy(asc(routes.sortOrder), asc(routes.name));
      const stops = await db
        .select({
          routeId: routeStops.routeId,
          position: routeStops.position,
          branchId: branches.id,
          branchName: branches.name,
          branchCode: branches.code,
          customerName: customers.name,
          address: branches.address,
        })
        .from(routeStops)
        .innerJoin(branches, eq(branches.id, routeStops.branchId))
        .innerJoin(customers, eq(customers.id, branches.customerId))
        .orderBy(asc(routeStops.position));
      return rows.map((r) => ({
        ...r.route,
        vehicleName: r.vehicleName,
        driverName: r.driverName,
        stops: stops.filter((s) => s.routeId === r.route.id),
      }));
    },

    async unassignedBranches() {
      return db
        .select({
          branchId: branches.id,
          branchName: branches.name,
          branchCode: branches.code,
          customerName: customers.name,
          address: branches.address,
        })
        .from(branches)
        .innerJoin(customers, eq(customers.id, branches.customerId))
        .leftJoin(routeStops, eq(routeStops.branchId, branches.id))
        .where(
          and(
            isNull(routeStops.routeId),
            eq(branches.isActive, true),
            eq(customers.isActive, true),
          ),
        )
        .orderBy(asc(customers.name), asc(branches.name));
    },

    async drivers() {
      return db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(and(eq(users.role, 'driver'), eq(users.isActive, true)))
        .orderBy(asc(users.name));
    },

    async saveRoute(id: string | null, input: RouteInput, ctx: AuditContext) {
      const data = clean(input);
      if (data.driverId) {
        const d = await db.query.users.findFirst({ where: eq(users.id, data.driverId) });
        if (!d || d.role !== 'driver')
          throw new AppError(422, 'NOT_A_DRIVER', t('المستخدم ليس سائقاً'));
      }
      try {
        return await db.transaction(async (tx) => {
          const before = id ? await tx.query.routes.findFirst({ where: eq(routes.id, id) }) : null;
          if (id && !before) throw notFound('Route');
          const [row] = id
            ? await tx.update(routes).set(data).where(eq(routes.id, id)).returning()
            : await tx
                .insert(routes)
                .values({ ...data, name: data.name ?? '' })
                .returning();
          await writeAudit(tx, ctx, {
            action: id ? 'route.update' : 'route.create',
            entity: 'route',
            entityId: row!.id,
            before,
            after: row,
          });
          return row!;
        });
      } catch (err) {
        if ((err as { cause?: { code?: string } }).cause?.code === '23505')
          throw new AppError(409, 'NAME_TAKEN', t('يوجد مسار بنفس الاسم'));
        throw err;
      }
    },

    /** Sets the branches of a route in delivery order. A branch moves here from any other route. */
    async setStops(routeId: string, branchIds: string[], ctx: AuditContext) {
      const route = await db.query.routes.findFirst({ where: eq(routes.id, routeId) });
      if (!route) throw notFound('Route');
      const unique = [...new Set(branchIds)];
      await db.transaction(async (tx) => {
        const before = await tx.select().from(routeStops).where(eq(routeStops.routeId, routeId));
        await tx.delete(routeStops).where(eq(routeStops.routeId, routeId));
        if (unique.length) {
          await tx.delete(routeStops).where(inArray(routeStops.branchId, unique));
          await tx
            .insert(routeStops)
            .values(unique.map((branchId, i) => ({ routeId, branchId, position: i + 1 })));
        }
        await writeAudit(tx, ctx, {
          action: 'route.stops',
          entity: 'route',
          entityId: routeId,
          before: before.map((s) => s.branchId),
          after: unique,
        });
      });
      return (await this.listRoutes()).find((r) => r.id === routeId)!;
    },

    // ---------------------------------------------------------- daily trips

    /** Creates or refreshes the trips of a day from its confirmed orders. Safe to repeat. */
    async generate(date: string, ctx: AuditContext) {
      const confirmed = await db
        .select({
          orderId: orders.id,
          routeId: routeStops.routeId,
          position: routeStops.position,
          deliveryId: deliveries.id,
        })
        .from(orders)
        .innerJoin(routeStops, eq(routeStops.branchId, orders.branchId))
        .leftJoin(deliveries, eq(deliveries.orderId, orders.id))
        .where(
          and(eq(orders.deliveryDate, date), inArray(orders.status, ['confirmed', 'delivered'])),
        );
      const routeRows = await db.select().from(routes);
      let created = 0;
      await db.transaction(async (tx) => {
        const tripOf = new Map<string, string>();
        for (const routeId of new Set(confirmed.map((c) => c.routeId))) {
          const route = routeRows.find((r) => r.id === routeId)!;
          const [tr] = await tx
            .insert(trips)
            .values({
              deliveryDate: date,
              routeId,
              driverId: route.driverId,
              vehicleId: route.vehicleId,
            })
            .onConflictDoUpdate({
              target: [trips.deliveryDate, trips.routeId],
              // A trip that has not left yet follows the route's current driver and car.
              set: {
                driverId: sql`case when ${trips.status} = 'planned' then excluded.driver_id else ${trips.driverId} end`,
                vehicleId: sql`case when ${trips.status} = 'planned' then excluded.vehicle_id else ${trips.vehicleId} end`,
              },
            })
            .returning({ id: trips.id });
          tripOf.set(routeId, tr!.id);
        }
        for (const c of confirmed) {
          if (c.deliveryId) {
            // Follow route changes while the delivery is still pending.
            await tx
              .update(deliveries)
              .set({ tripId: tripOf.get(c.routeId)!, position: c.position })
              .where(and(eq(deliveries.id, c.deliveryId), eq(deliveries.status, 'pending')));
            continue;
          }
          await tx
            .insert(deliveries)
            .values({ tripId: tripOf.get(c.routeId)!, orderId: c.orderId, position: c.position });
          created++;
        }
        // Orders cancelled after the trips were made leave their trip.
        await tx.execute(sql`
          delete from deliveries d using orders o, trips t
          where d.order_id = o.id and d.trip_id = t.id and t.delivery_date = ${date}
            and d.status = 'pending' and o.status not in ('confirmed', 'delivered')`);
        await tx.execute(sql`
          delete from trips t where t.delivery_date = ${date} and t.status = 'planned'
            and not exists (select 1 from deliveries d where d.trip_id = t.id)`);
        await writeAudit(tx, ctx, {
          action: 'trips.generate',
          entity: 'trip_day',
          entityId: date,
          after: { orders: confirmed.length, created },
        });
      });
      return this.getDay(date);
    },

    async getDay(date: string) {
      const dayTrips = await db
        .select({
          trip: trips,
          routeName: routes.name,
          driverName: users.name,
          vehicleName: vehicles.name,
        })
        .from(trips)
        .innerJoin(routes, eq(routes.id, trips.routeId))
        .leftJoin(users, eq(users.id, trips.driverId))
        .leftJoin(vehicles, eq(vehicles.id, trips.vehicleId))
        .where(eq(trips.deliveryDate, date))
        .orderBy(asc(routes.sortOrder), asc(routes.name));
      const rows = dayTrips.length
        ? await db
            .select({
              id: deliveries.id,
              tripId: deliveries.tripId,
              position: deliveries.position,
              status: deliveries.status,
              receiverName: deliveries.receiverName,
              deliveredAt: deliveries.deliveredAt,
              collectedAmount: deliveries.collectedAmount,
              failReason: deliveries.failReason,
              latitude: deliveries.latitude,
              longitude: deliveries.longitude,
              orderId: orders.id,
              orderNumber: orders.number,
              orderTotal: orders.total,
              customerName: customers.name,
              branchName: branches.name,
              address: branches.address,
              invoiceId: invoices.id,
              invoiceNumber: invoices.number,
              invoiceTotal: invoices.total,
            })
            .from(deliveries)
            .innerJoin(orders, eq(orders.id, deliveries.orderId))
            .innerJoin(customers, eq(customers.id, orders.customerId))
            .innerJoin(branches, eq(branches.id, orders.branchId))
            .leftJoin(
              invoices,
              and(eq(invoices.deliveryId, deliveries.id), ne(invoices.status, 'cancelled')),
            )
            .where(
              inArray(
                deliveries.tripId,
                dayTrips.map((tr) => tr.trip.id),
              ),
            )
            .orderBy(asc(deliveries.position), asc(branches.name))
        : [];
      const unassigned = await db
        .select({
          orderId: orders.id,
          orderNumber: orders.number,
          customerName: customers.name,
          branchId: branches.id,
          branchName: branches.name,
          total: orders.total,
        })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .innerJoin(branches, eq(branches.id, orders.branchId))
        .leftJoin(deliveries, eq(deliveries.orderId, orders.id))
        .where(
          and(eq(orders.deliveryDate, date), eq(orders.status, 'confirmed'), isNull(deliveries.id)),
        );
      const [notConfirmed] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.deliveryDate, date),
            inArray(orders.status, ['submitted', 'pending_approval', 'draft']),
          ),
        );
      return {
        date,
        trips: dayTrips.map((tr) => {
          const ds = rows.filter((r) => r.tripId === tr.trip.id);
          const count = (s: DeliveryStatus) => ds.filter((d) => d.status === s).length;
          return {
            ...tr.trip,
            routeName: tr.routeName,
            driverName: tr.driverName,
            vehicleName: tr.vehicleName,
            counts: {
              total: ds.length,
              pending: count('pending'),
              delivered: count('delivered'),
              partial: count('partial'),
              failed: count('failed'),
            },
            collected: ds.reduce((s, d) => s + d.collectedAmount, 0),
            invoiced: ds.reduce((s, d) => s + (d.invoiceTotal ?? 0), 0),
            deliveries: ds,
          };
        }),
        unassigned,
        notConfirmed: notConfirmed?.n ?? 0,
      };
    },

    trip: tripDetail,

    async loadingSheetPdf(tripId: string) {
      const tr = await tripDetail(tripId);
      const totals = new Map<
        string,
        { code: string; name: string; unit: string; quantity: number }
      >();
      for (const s of tr.stops)
        for (const i of s.items) {
          const row = totals.get(i.itemId) ?? {
            code: i.code,
            name: i.name,
            unit: i.unitLabel,
            quantity: 0,
          };
          row.quantity += i.quantity;
          totals.set(i.itemId, row);
        }
      const bytes = await deps.pdf(
        loadingSheetHtml({
          brand: await brandHeader(db, deps.files),
          deliveryDate: tr.deliveryDate,
          routeName: tr.route.name,
          driverName: tr.driver?.name ?? null,
          vehicleName: tr.vehicle
            ? `${tr.vehicle.name}${tr.vehicle.plate ? ` (${tr.vehicle.plate})` : ''}`
            : null,
          totals: [...totals.values()].sort((a, b) => a.code.localeCompare(b.code)),
          stops: tr.stops.map((s) => ({
            position: s.position,
            customerName: s.customer.name,
            branchName: s.branch.name,
            address: s.branch.address,
            phone: s.branch.phone ?? s.customer.phone,
            orderNumber: s.order.number,
            orderTotal: s.order.total,
            previousBalance: s.balance,
            paymentType: t(PAYMENT_TYPE_LABELS_AR[s.paymentType]),
            lines: s.items.map((i) => ({ name: i.name, quantity: i.quantity })),
          })),
        }),
      );
      return { bytes, filename: `loading-${tr.deliveryDate}-${tr.route.name}.pdf` };
    },

    // ---------------------------------------------------------- driver

    /** The driver's trips of a day, in full (for offline use). */
    async myTrips(actor: AuthUser, day?: string) {
      const date = day ?? ammanDate(now());
      const mine = await db
        .select({ id: trips.id })
        .from(trips)
        .innerJoin(routes, eq(routes.id, trips.routeId))
        .where(and(eq(trips.driverId, actor.id), eq(trips.deliveryDate, date)))
        .orderBy(asc(routes.sortOrder));
      return {
        date,
        trips: await Promise.all(mine.map((tr) => tripDetail(tr.id))),
        catalog: await db
          .select({ id: items.id, code: items.code, name: items.name, unit: items.unit })
          .from(items)
          .where(eq(items.isActive, true))
          .orderBy(asc(items.sortOrder))
          .then((rows) => rows.map((r) => ({ ...r, unitLabel: unitAr(r.unit) }))),
      };
    },

    async startTrip(tripId: string, actor: AuthUser, ctx: AuditContext) {
      const trip = await tripOrThrow(tripId);
      assertDriver(trip, actor);
      if (trip.status === 'planned')
        await db.transaction(async (tx) => {
          await tx
            .update(trips)
            .set({ status: 'out', startedAt: now() })
            .where(eq(trips.id, tripId));
          await writeAudit(tx, ctx, { action: 'trip.start', entity: 'trip', entityId: tripId });
        });
      return tripDetail(tripId);
    },

    /**
     * Delivery confirmation from the driver: delivered / short / returned per item, receiver,
     * signature, time, location at this moment only, and cash collected. Creates the invoice
     * and the receipt in the same transaction.
     */
    async confirm(deliveryId: string, input: ConfirmInput, actor: AuthUser, ctx: AuditContext) {
      const d = await db.query.deliveries.findFirst({ where: eq(deliveries.id, deliveryId) });
      if (!d) throw notFound('Delivery');
      const trip = await tripOrThrow(d.tripId);
      assertDriver(trip, actor);
      if (d.status !== 'pending') {
        if (d.clientRef && d.clientRef === input.clientRef)
          return { duplicate: true, trip: await tripDetail(trip.id) };
        throw new AppError(409, 'ALREADY_CONFIRMED', t('تم تأكيد هذا التسليم من قبل'), {
          status: d.status,
          confirmedAt: d.confirmedAt,
        });
      }
      const order = await db.query.orders.findFirst({ where: eq(orders.id, d.orderId) });
      if (!order || order.status !== 'confirmed')
        throw new AppError(
          409,
          'ORDER_NOT_DELIVERABLE',
          t('الطلب ألغي أو تغيّر بعد تحميله؛ راجع المكتب'),
        );
      const ordered = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      const contract = order.contractId
        ? await db.query.contracts.findFirst({ where: eq(contracts.id, order.contractId) })
        : null;

      // ---- validate the per-item quantities
      const byItem = new Map(input.lines.map((l) => [l.itemId, l]));
      const lines = [
        ...ordered.map((o) => {
          const l = byItem.get(o.itemId);
          return {
            itemId: o.itemId,
            orderedQty: o.quantity,
            deliveredQty: input.outcome === 'failed' ? 0 : (l?.deliveredQty ?? o.quantity),
            shortReason: l?.shortReason ?? null,
            returnedQty: input.outcome === 'failed' ? 0 : (l?.returnedQty ?? 0),
            returnReason: l?.returnReason ?? null,
          };
        }),
        // Returns of items that were not ordered today.
        ...input.lines
          .filter((l) => !ordered.some((o) => o.itemId === l.itemId) && l.returnedQty > 0)
          .map((l) => ({
            itemId: l.itemId,
            orderedQty: 0,
            deliveredQty: 0,
            shortReason: null,
            returnedQty: input.outcome === 'failed' ? 0 : l.returnedQty,
            returnReason: l.returnReason ?? null,
          })),
      ];
      for (const l of lines) {
        if (l.deliveredQty < 0 || l.returnedQty < 0)
          throw new AppError(422, 'BAD_QTY', t('الكميات لا تكون سالبة'));
        if (l.deliveredQty > l.orderedQty)
          throw new AppError(
            422,
            'OVER_DELIVERED',
            t('الكمية المسلّمة أكبر من المطلوب؛ عدّل الطلب أولاً'),
          );
        if (input.outcome === 'delivered' && l.deliveredQty < l.orderedQty && !l.shortReason)
          throw new AppError(422, 'SHORT_REASON', t('اختر سبب النقص لكل صنف ناقص'));
        if (l.returnedQty > 0 && !l.returnReason)
          throw new AppError(422, 'RETURN_REASON', t('اختر سبب المرتجع'));
      }
      if (lines.some((l) => l.returnedQty > 0) && !contract?.allowReturns)
        throw new AppError(422, 'RETURNS_NOT_ALLOWED', t('عقد هذا العميل لا يسمح بالمرتجعات'));
      if (input.outcome === 'failed' && !input.failReason)
        throw new AppError(422, 'FAIL_REASON', t('اختر سبب عدم التسليم'));
      if (input.outcome === 'delivered') {
        if (!lines.some((l) => l.deliveredQty > 0 || l.returnedQty > 0))
          throw new AppError(
            422,
            'NOTHING_DELIVERED',
            t('لم تُسلَّم أي كمية؛ اختر «لم يُسلَّم» بدلاً من ذلك'),
          );
        if ((input.receiverName?.trim().length ?? 0) < 2 && !input.signatureSvg)
          throw new AppError(422, 'RECEIVER_REQUIRED', t('اكتب اسم المستلم أو خذ توقيعه'));
      }
      if (input.collected && input.collected.amount < 0)
        throw new AppError(422, 'BAD_AMOUNT', t('المبلغ المحصّل غير صحيح'));

      const status: DeliveryStatus =
        input.outcome === 'failed'
          ? 'failed'
          : lines.every((l) => l.deliveredQty === l.orderedQty)
            ? 'delivered'
            : 'partial';
      // Phone clocks drift; never accept a time in the future.
      const phoneTime = new Date(input.deliveredAt);
      const at = Number.isNaN(phoneTime.getTime()) || phoneTime > now() ? now() : phoneTime;
      const collected = input.collected && input.collected.amount > 0 ? input.collected : null;

      try {
        await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(deliveries)
            .set({
              status,
              failReason: input.outcome === 'failed' ? input.failReason : null,
              receiverName: input.receiverName?.trim() || null,
              signatureSvg: input.signatureSvg || null,
              deliveredAt: at,
              confirmedAt: now(),
              confirmedBy: actor.id,
              latitude: input.latitude ?? null,
              longitude: input.longitude ?? null,
              accuracyM: input.accuracyM ?? null,
              collectedAmount: collected?.amount ?? 0,
              collectedMethod: collected?.method ?? null,
              note: input.note?.trim() || null,
              clientRef: input.clientRef,
            })
            // Guards against two phones confirming at the same moment.
            .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'pending')))
            .returning();
          if (!updated)
            throw new AppError(409, 'ALREADY_CONFIRMED', t('تم تأكيد هذا التسليم من قبل'));
          await tx.insert(deliveryLines).values(lines.map((l) => ({ ...l, deliveryId })));

          let invoiceId: string | null = null;
          if (status !== 'failed') {
            await tx.update(orders).set({ status: 'delivered' }).where(eq(orders.id, order.id));
            const inv = await billing.createFromDelivery(tx, {
              orderId: order.id,
              deliveryId,
              lines,
              actorId: actor.id,
            });
            invoiceId = inv?.id ?? null;
          }
          await tx.insert(orderEvents).values({
            orderId: order.id,
            type: 'delivered',
            actorId: actor.id,
            note:
              status === 'failed'
                ? 'لم يُسلَّم'
                : status === 'partial'
                  ? 'تسليم ناقص'
                  : 'تم التسليم',
            data: { deliveryId, invoiceId, receiver: input.receiverName ?? null },
          });
          if (collected)
            await billing.insertPayment(
              tx,
              {
                customerId: order.customerId,
                amount: collected.amount,
                method: collected.method,
                receivedOn: ammanDate(at),
                reference: collected.reference ?? null,
                note: `تحصيل السائق عند التسليم (${order.number})`,
              },
              { source: 'driver', deliveryId, receivedBy: actor.id },
            );
          await billing.rebalance(tx, order.customerId);
          await markTripProgress(tx, trip.id);
          await writeAudit(tx, ctx, {
            action: 'delivery.confirm',
            entity: 'delivery',
            entityId: deliveryId,
            before: { status: 'pending' },
            after: {
              status,
              lines,
              receiverName: input.receiverName ?? null,
              location: input.latitude != null ? [input.latitude, input.longitude] : null,
              collected,
              invoiceId,
            },
          });
        });
      } catch (err) {
        if ((err as { cause?: { code?: string } }).cause?.code === '23505')
          throw new AppError(409, 'ALREADY_CONFIRMED', t('تم تأكيد هذا التسليم من قبل'));
        throw err;
      }
      return { duplicate: false, trip: await tripDetail(trip.id) };
    },

    /** The signature drawn on the phone, as an SVG document. */
    async signature(deliveryId: string) {
      const d = await db.query.deliveries.findFirst({ where: eq(deliveries.id, deliveryId) });
      if (!d?.signatureSvg) throw notFound('Signature');
      return d.signatureSvg;
    },
  };
}

export type DistributionService = ReturnType<typeof createDistributionService>;
