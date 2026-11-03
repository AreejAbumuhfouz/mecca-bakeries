import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { TIME_RE } from '@mecca/shared';
import { requireAnyPermission, requirePermission } from '../../middleware/auth.js';
import type { SettingsService } from './settings.service.js';

const time = z.string().regex(TIME_RE, 'الوقت بصيغة HH:MM');

const OrderSettings = z
  .object({
    reminderTimes: z.array(time).max(6),
    remindersEnabled: z.boolean(),
    draftTime: time,
    draftsEnabled: z.boolean(),
    cutoffTime: time,
    autoSubmitDrafts: z.boolean(),
    whatsappEnabled: z.boolean(),
    pushEnabled: z.boolean(),
  })
  .partial();

const Receivables = z
  .object({
    alertsEnabled: z.boolean(),
    alertTime: time,
    minAmount: z.number().int().min(0).max(100_000_000),
    onlyOverdue: z.boolean(),
  })
  .partial();

export function settingsRouter(svc: SettingsService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);

  // Order staff and restaurants need the schedule (cutoff time) to work with orders.
  router.get(
    '/orders',
    requireAnyPermission('settings.manage', 'orders.view', 'orders.place'),
    async (_req, res) => {
      res.json({ ok: true, data: await svc.getOrderSettings() });
    },
  );
  router.put('/orders', requirePermission('settings.manage'), async (req, res) => {
    res.json({
      ok: true,
      data: await svc.updateOrderSettings(OrderSettings.parse(req.body), req.audit),
    });
  });
  const Production = z
    .object({
      toleranceBps: z.number().int().min(0).max(5_000),
      defaultExtraBps: z.number().int().min(0).max(5_000),
    })
    .partial();
  router.get(
    '/production',
    requireAnyPermission('settings.manage', 'production.view'),
    async (_req, res) => {
      res.json({ ok: true, data: await svc.getProductionSettings() });
    },
  );
  router.put('/production', requirePermission('settings.manage'), async (req, res) => {
    res.json({
      ok: true,
      data: await svc.updateProductionSettings(Production.parse(req.body), req.audit),
    });
  });
  router.get(
    '/receivables',
    requireAnyPermission('settings.manage', 'payments.view'),
    async (_req, res) => {
      res.json({ ok: true, data: await svc.getReceivablesSettings() });
    },
  );
  router.put('/receivables', requirePermission('settings.manage'), async (req, res) => {
    res.json({
      ok: true,
      data: await svc.updateReceivablesSettings(Receivables.parse(req.body), req.audit),
    });
  });
  return router;
}
