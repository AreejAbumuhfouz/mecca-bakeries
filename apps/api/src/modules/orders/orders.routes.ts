import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ammanDate, ORDER_STATUSES } from '@mecca/shared';
import { requireAnyPermission, requirePermission } from '../../middleware/auth.js';
import { Id, isoDate, optionalText, pageQuery } from '../../lib/validation.js';
import type { OrdersService } from './orders.service.js';
import type { ContractsService } from '../contracts/contracts.service.js';
import type { PushService } from '../notifications/push.js';
import type { Scheduler } from '../scheduler/scheduler.js';

const Lines = z
  .array(z.object({ itemId: z.string().uuid(), quantity: z.number().int().min(0).max(100_000) }))
  .min(1)
  .max(300);

const Place = z.object({
  branchId: z.string().uuid(),
  deliveryDate: isoDate.optional(),
  lines: Lines,
  notes: optionalText(500),
});
const Update = z.object({ lines: Lines.optional(), notes: optionalText(500) });
const Cancel = z.object({ reason: optionalText(300) });
const Decision = z.object({ note: z.string().trim().min(3, 'اكتب سبب القرار').max(500) });
const ListQuery = z.object({
  deliveryDate: isoDate.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  ...pageQuery,
});
const DateQuery = z.object({ date: isoDate.optional() });

/** Staff routes: /api/orders */
export function ordersRouter(
  svc: OrdersService,
  scheduler: Scheduler | null,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate);
  const view = requirePermission('orders.view');
  const manage = requirePermission('orders.manage');

  router.get('/', view, async (req, res) => {
    res.json({ ok: true, data: await svc.list(req.auth!, ListQuery.parse(req.query)) });
  });
  router.get('/window', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.window() });
  });
  router.get(
    '/summary',
    requireAnyPermission('orders.view', 'production.view'),
    async (req, res) => {
      const { date } = DateQuery.parse(req.query);
      res.json({ ok: true, data: await svc.summary(date ?? (await svc.window()).deliveryDate) });
    },
  );
  router.get(
    '/scheduler-runs',
    requireAnyPermission('settings.manage', 'orders.view'),
    async (_req, res) => {
      res.json({ ok: true, data: scheduler ? await scheduler.recentRuns() : [] });
    },
  );
  router.get('/:id', view, async (req, res) => {
    res.json({ ok: true, data: await svc.get(req.auth!, Id.parse(req.params).id) });
  });
  router.post('/', manage, async (req, res) => {
    res
      .status(201)
      .json({
        ok: true,
        data: await svc.place(req.auth!, Place.parse(req.body), 'dashboard', req.audit),
      });
  });
  router.patch('/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.update(req.auth!, id, Update.parse(req.body), req.audit),
    });
  });
  router.post('/:id/submit', manage, async (req, res) => {
    res.json({
      ok: true,
      data: await svc.submitDraft(req.auth!, Id.parse(req.params).id, req.audit),
    });
  });
  router.post('/:id/cancel', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    const { reason } = Cancel.parse(req.body ?? {});
    res.json({ ok: true, data: await svc.cancel(req.auth!, id, reason ?? null, req.audit) });
  });
  router.post('/:id/approve', requirePermission('credit.override'), async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.decide(req.auth!, id, true, Decision.parse(req.body).note, req.audit),
    });
  });
  router.post('/:id/reject', requirePermission('credit.override'), async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.decide(req.auth!, id, false, Decision.parse(req.body).note, req.audit),
    });
  });
  return router;
}

const PushToken = z.object({
  token: z.string().trim().min(10).max(300),
  platform: z.enum(['ios', 'android', 'web']).nullable().optional(),
});

/** Restaurant app routes: /api/app (scoped to the account's customer). */
export function appRouter(
  deps: { orders: OrdersService; contracts: ContractsService; push: PushService },
  authenticate: RequestHandler,
): Router {
  const { orders: svc } = deps;
  const router = Router();
  router.use(authenticate, requirePermission('orders.place'));

  router.get('/me', async (req, res) => {
    const day = await svc.myDay(req.auth!);
    const credit = await deps.contracts.creditCheck(req.auth!.customerId!, 0);
    res.json({ ok: true, data: { ...day, user: req.auth, credit, today: ammanDate() } });
  });
  router.get('/catalog', async (req, res) => {
    const q = z.object({ branchId: z.string().uuid(), date: isoDate.optional() }).parse(req.query);
    res.json({ ok: true, data: await svc.catalog(req.auth!, q.branchId, q.date) });
  });
  router.get('/orders', async (req, res) => {
    const q = ListQuery.parse({ pageSize: 30, ...req.query });
    res.json({ ok: true, data: await svc.list(req.auth!, q) });
  });
  router.get('/orders/:id', async (req, res) => {
    res.json({ ok: true, data: await svc.get(req.auth!, Id.parse(req.params).id) });
  });
  router.post('/orders', async (req, res) => {
    res
      .status(201)
      .json({
        ok: true,
        data: await svc.place(req.auth!, Place.parse(req.body), 'app', req.audit),
      });
  });
  router.post('/orders/repeat', async (req, res) => {
    const { branchId } = z.object({ branchId: z.string().uuid() }).parse(req.body);
    res.status(201).json({ ok: true, data: await svc.repeatLast(req.auth!, branchId, req.audit) });
  });
  router.patch('/orders/:id', async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.update(req.auth!, id, Update.parse(req.body), req.audit),
    });
  });
  router.post('/orders/:id/submit', async (req, res) => {
    res.json({
      ok: true,
      data: await svc.submitDraft(req.auth!, Id.parse(req.params).id, req.audit),
    });
  });
  router.post('/orders/:id/cancel', async (req, res) => {
    const { id } = Id.parse(req.params);
    const { reason } = Cancel.parse(req.body ?? {});
    res.json({ ok: true, data: await svc.cancel(req.auth!, id, reason ?? null, req.audit) });
  });
  router.post('/push-token', async (req, res) => {
    const { token, platform } = PushToken.parse(req.body);
    await deps.push.register(req.auth!.id, token, platform ?? null);
    res.json({ ok: true, data: { registered: true } });
  });
  router.delete('/push-token', async (req, res) => {
    const { token } = PushToken.pick({ token: true }).parse(req.body);
    await deps.push.unregister(token);
    res.json({ ok: true, data: { removed: true } });
  });
  return router;
}
