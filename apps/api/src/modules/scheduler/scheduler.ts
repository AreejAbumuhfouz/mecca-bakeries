import { desc, eq, and } from 'drizzle-orm';
import {
  addDays,
  ammanDate,
  ammanTime,
  ammanToUtc,
  currentDeliveryDate,
  cutoffAt,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { schedulerRuns } from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { OrdersService } from '../orders/orders.service.js';
import type { ProductionService } from '../production/production.service.js';
import type { Notifier } from '../notifications/notifier.js';
import type { DistributionService } from '../distribution/distribution.service.js';
import type { BalanceAlerts } from '../billing/balance-alerts.js';

/**
 * Minute-by-minute scheduler for the ordering day (Amman time):
 *   reminders (9, 10, 11 PM)   → branches with no order for the coming delivery date
 *   drafts (12:00 AM)          → drafts copied from yesterday's orders
 *   cutoff (3:00 AM)           → orders confirmed, drafts submitted or cancelled, final plan and
 *                                driver trips built
 *   balance alerts (10:00 AM)  → customers with unpaid balances get their statement
 * Each run is recorded in scheduler_runs, so a job never runs twice for the same slot,
 * even with several API processes or after a restart. Missed slots are caught up within a
 * short window (reminders 60 min, drafts 2 h, cutoff 12 h) instead of firing late.
 */
export function createScheduler(deps: {
  db: Db;
  settings: SettingsService;
  orders: OrdersService;
  production?: ProductionService;
  distribution?: DistributionService;
  alerts?: BalanceAlerts;
  notifier: Notifier;
  now?: () => Date;
}) {
  const { db, settings, orders, notifier, production, distribution, alerts } = deps;
  const now = () => deps.now?.() ?? new Date();
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  /** Runs `fn` once per (job, runKey). Returns null if it already ran. */
  async function once<T>(job: string, runKey: string, fn: () => Promise<T>) {
    const [claimed] = await db
      .insert(schedulerRuns)
      .values({ job, runKey })
      .onConflictDoNothing()
      .returning();
    if (!claimed) return null;
    try {
      const result = await fn();
      await db
        .update(schedulerRuns)
        .set({ finishedAt: new Date(), result: result as object })
        .where(and(eq(schedulerRuns.job, job), eq(schedulerRuns.runKey, runKey)));
      logger.info(`[scheduler] ${job} ${runKey} ${JSON.stringify(result)}`);
      return result;
    } catch (err) {
      await db
        .update(schedulerRuns)
        .set({ finishedAt: new Date(), error: String(err) })
        .where(and(eq(schedulerRuns.job, job), eq(schedulerRuns.runKey, runKey)));
      logger.error({ err }, `[scheduler] ${job} ${runKey} failed`);
      return null;
    }
  }

  /** Was the local time `hhmm` on `day` reached within the last `windowMin` minutes? */
  function dueWithin(day: string, hhmm: string, windowMin: number) {
    const at = ammanToUtc(day, hhmm);
    const diff = now().getTime() - at.getTime();
    return diff >= 0 && diff < windowMin * 60_000;
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const s = await settings.getOrderSettings();
      const today = ammanDate(now());
      const days = [addDays(today, -1), today];

      // Cutoff for today's / tomorrow's delivery date.
      for (const deliveryDate of [today, addDays(today, 1)]) {
        const cut = cutoffAt(deliveryDate, s.cutoffTime);
        const diff = now().getTime() - cut.getTime();
        if (diff >= 0 && diff < 12 * 3_600_000)
          await once('cutoff', deliveryDate, async () => {
            const result = await orders.closeOrdering(deliveryDate);
            // The final production plan is ready as soon as ordering closes.
            if (production)
              await production
                .generate(deliveryDate, { userId: null, ip: 'scheduler' })
                .catch((err: unknown) =>
                  logger.warn(`[scheduler] plan ${deliveryDate}: ${String(err)}`),
                );
            // Driver trips follow from the confirmed orders and the routes.
            if (distribution)
              await distribution
                .generate(deliveryDate, { userId: null, ip: 'scheduler' })
                .catch((err: unknown) =>
                  logger.warn(`[scheduler] trips ${deliveryDate}: ${String(err)}`),
                );
            return result;
          });
      }

      const deliveryDate = currentDeliveryDate(now(), s.cutoffTime);

      if (s.draftsEnabled)
        for (const day of days)
          if (dueWithin(day, s.draftTime, 120))
            await once('drafts', deliveryDate, () => orders.createDrafts(deliveryDate));

      if (s.remindersEnabled)
        for (const time of s.reminderTimes)
          for (const day of days)
            if (dueWithin(day, time, 60))
              await once('reminder', `${deliveryDate}@${time}`, async () => {
                const targets = await orders.branchesToRemind(deliveryDate);
                for (const t of targets) await notifier.reminder(t, deliveryDate);
                return { reminded: targets.length };
              });

      if (alerts) {
        const r = await settings.getReceivablesSettings();
        if (r.alertsEnabled && dueWithin(today, r.alertTime, 120))
          await once('balance_alerts', today, () => alerts.runDaily());
      }
    } catch (err) {
      logger.error({ err }, '[scheduler] tick failed');
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(intervalMs = 60_000) {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
      logger.info(`[scheduler] started (Amman time now ${ammanTime(now())})`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    recentRuns: (limit = 30) =>
      db.select().from(schedulerRuns).orderBy(desc(schedulerRuns.startedAt)).limit(limit),
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
