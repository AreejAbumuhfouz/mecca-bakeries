import { eq } from 'drizzle-orm';
import { DEFAULT_ORDER_SETTINGS, type OrderSettings } from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { appSettings } from '../../db/schema/index.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';

const ORDERS_KEY = 'orders';

export function createSettingsService(db: Db) {
  async function getOrderSettings(): Promise<OrderSettings> {
    const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, ORDERS_KEY) });
    // Merge with defaults so settings added in later versions always have a value.
    return { ...DEFAULT_ORDER_SETTINGS, ...((row?.value as Partial<OrderSettings>) ?? {}) };
  }

  return {
    getOrderSettings,

    async updateOrderSettings(patch: Partial<OrderSettings>, ctx: AuditContext) {
      const before = await getOrderSettings();
      const after: OrderSettings = { ...before, ...patch };
      if (patch.reminderTimes) after.reminderTimes = [...new Set(patch.reminderTimes)].sort();
      await db.transaction(async (tx) => {
        await tx
          .insert(appSettings)
          .values({ key: ORDERS_KEY, value: after, updatedBy: ctx.userId })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: after, updatedBy: ctx.userId },
          });
        await writeAudit(tx, ctx, {
          action: 'settings.orders',
          entity: 'settings',
          entityId: ORDERS_KEY,
          before,
          after,
        });
      });
      return after;
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
