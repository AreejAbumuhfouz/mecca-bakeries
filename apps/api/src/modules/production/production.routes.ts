import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { addDays, ammanDate, STOCK_LOSS_KINDS, STOCK_LOSS_REASONS } from '@mecca/shared';
import { requirePermission } from '../../middleware/auth.js';
import { Id, isoDate, optionalText } from '../../lib/validation.js';
import type { ProductionService } from './production.service.js';

const qty = z.number().int().min(0).max(1_000_000);
const DateParam = z.object({ date: isoDate });
const Line = z.object({
  name: z.string().trim().min(2).max(80),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});
const Vehicle = z.object({
  name: z.string().trim().min(1).max(80),
  plate: optionalText(30),
  driverName: optionalText(80),
  isActive: z.boolean().optional(),
});
const ItemUpdates = z
  .array(
    z.object({
      itemId: z.string().uuid(),
      extraQty: qty.optional(),
      producedQty: qty.nullable().optional(),
      note: optionalText(300),
    }),
  )
  .min(1)
  .max(500);
const Loads = z.object({
  vehicleId: z.string().uuid(),
  lines: z.array(z.object({ itemId: z.string().uuid(), quantity: qty })).max(500),
});
const Loss = z.object({
  itemId: z.string().uuid(),
  kind: z.enum(STOCK_LOSS_KINDS),
  reason: z.enum(STOCK_LOSS_REASONS),
  quantity: qty.min(1),
  note: optionalText(300),
});
const Approve = z.object({
  itemId: z.string().uuid(),
  note: z.string().trim().min(3, 'اكتب سبب الفرق').max(500),
});
const HistoryQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

export function productionRouter(svc: ProductionService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);
  const view = requirePermission('production.view');
  const manage = requirePermission('production.manage');

  router.get('/lines', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.listLines() });
  });
  router.post('/lines', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.saveLine(null, Line.parse(req.body), req.audit) });
  });
  router.patch('/lines/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({ ok: true, data: await svc.saveLine(id, Line.partial().parse(req.body), req.audit) });
  });
  router.get('/vehicles', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.listVehicles() });
  });
  router.post('/vehicles', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.saveVehicle(null, Vehicle.parse(req.body), req.audit) });
  });
  router.patch('/vehicles/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.saveVehicle(id, Vehicle.partial().parse(req.body), req.audit),
    });
  });

  router.get('/history', view, async (req, res) => {
    const q = HistoryQuery.parse(req.query);
    const to = q.to ?? addDays(ammanDate(), 1);
    res.json({ ok: true, data: await svc.history(q.from ?? addDays(to, -30), to) });
  });

  router.get('/days/:date', view, async (req, res) => {
    res.json({ ok: true, data: await svc.getDay(DateParam.parse(req.params).date) });
  });
  router.post('/days/:date/generate', manage, async (req, res) => {
    res.json({ ok: true, data: await svc.generate(DateParam.parse(req.params).date, req.audit) });
  });
  router.patch('/days/:date/items', manage, async (req, res) => {
    const { date } = DateParam.parse(req.params);
    res.json({
      ok: true,
      data: await svc.updateItems(date, ItemUpdates.parse(req.body), req.auth!, req.audit),
    });
  });
  router.put('/days/:date/loads', manage, async (req, res) => {
    const { date } = DateParam.parse(req.params);
    const { vehicleId, lines } = Loads.parse(req.body);
    res.json({ ok: true, data: await svc.setLoads(date, vehicleId, lines, req.audit) });
  });
  router.post('/days/:date/losses', manage, async (req, res) => {
    const { date } = DateParam.parse(req.params);
    res
      .status(201)
      .json({
        ok: true,
        data: await svc.addLoss(date, Loss.parse(req.body), req.auth!, req.audit),
      });
  });
  router.delete('/days/:date/losses/:lossId', manage, async (req, res) => {
    const { date, lossId } = z
      .object({ date: isoDate, lossId: z.coerce.number().int().positive() })
      .parse(req.params);
    res.json({ ok: true, data: await svc.removeLoss(date, lossId, req.audit) });
  });
  router.post(
    '/days/:date/variances/approve',
    requirePermission('variances.approve'),
    async (req, res) => {
      const { date } = DateParam.parse(req.params);
      const { itemId, note } = Approve.parse(req.body);
      res.json({
        ok: true,
        data: await svc.approveVariance(date, itemId, note, req.auth!, req.audit),
      });
    },
  );
  router.post('/days/:date/close', manage, async (req, res) => {
    res.json({
      ok: true,
      data: await svc.close(DateParam.parse(req.params).date, req.auth!, req.audit),
    });
  });
  return router;
}
