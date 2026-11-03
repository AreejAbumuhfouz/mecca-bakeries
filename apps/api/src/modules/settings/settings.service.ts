import { eq } from 'drizzle-orm';
import {
  DEFAULT_ORDER_SETTINGS,
  DEFAULT_PRODUCTION_SETTINGS,
  type OrderSettings,
  DEFAULT_RECEIVABLES_SETTINGS,
  type ProductionSettings,
  type ReceivablesSettings,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { appSettings } from '../../db/schema/index.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';

const ORDERS_KEY = 'orders';
const PRODUCTION_KEY = 'production';
const RECEIVABLES_KEY = 'receivables';

export function createSettingsService(db: Db) {
  async function getOrderSettings(): Promise<OrderSettings> {
    const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, ORDERS_KEY) });
    // Merge with defaults so settings added in later versions always have a value.
    return { ...DEFAULT_ORDER_SETTINGS, ...((row?.value as Partial<OrderSettings>) ?? {}) };
  }

  async function getProductionSettings(): Promise<ProductionSettings> {
    const row = await db.query.appSettings.findFirst({
      where: eq(appSettings.key, PRODUCTION_KEY),
    });
    return {
      ...DEFAULT_PRODUCTION_SETTINGS,
      ...((row?.value as Partial<ProductionSettings>) ?? {}),
    };
  }

  async function getReceivablesSettings(): Promise<ReceivablesSettings> {
    const row = await db.query.appSettings.findFirst({
      where: eq(appSettings.key, RECEIVABLES_KEY),
    });
    return {
      ...DEFAULT_RECEIVABLES_SETTINGS,
      ...((row?.value as Partial<ReceivablesSettings>) ?? {}),
    };
  }

  return {
    getOrderSettings,
    getProductionSettings,
    getReceivablesSettings,

    async updateReceivablesSettings(patch: Partial<ReceivablesSettings>, ctx: AuditContext) {
      const before = await getReceivablesSettings();
      const after: ReceivablesSettings = { ...before, ...patch };
      await db.transaction(async (tx) => {
        await tx
          .insert(appSettings)
          .values({ key: RECEIVABLES_KEY, value: after, updatedBy: ctx.userId })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: after, updatedBy: ctx.userId },
          });
        await writeAudit(tx, ctx, {
          action: 'settings.receivables',
          entity: 'settings',
          entityId: RECEIVABLES_KEY,
          before,
          after,
        });
      });
      return after;
    },

    async updateProductionSettings(patch: Partial<ProductionSettings>, ctx: AuditContext) {
      const before = await getProductionSettings();
      const after: ProductionSettings = { ...before, ...patch };
      await db.transaction(async (tx) => {
        await tx
          .insert(appSettings)
          .values({ key: PRODUCTION_KEY, value: after, updatedBy: ctx.userId })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: after, updatedBy: ctx.userId },
          });
        await writeAudit(tx, ctx, {
          action: 'settings.production',
          entity: 'settings',
          entityId: PRODUCTION_KEY,
          before,
          after,
        });
      });
      return after;
    },

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
