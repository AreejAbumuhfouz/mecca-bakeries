import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { DELIVERY_REASONS, PAYMENT_METHODS } from '@mecca/shared';
import { requireAnyPermission, requirePermission } from '../../middleware/auth.js';
import { AppError } from '../../lib/errors.js';
import { fils, Id, isoDate, optionalText } from '../../lib/validation.js';
import { sendPdf } from '../billing/billing.routes.js';
import type { ConfirmInput, DistributionService } from './distribution.service.js';

const qty = z.number().int().min(0).max(1_000_000);
const Route = z.object({
  name: z.string().trim().min(2).max(80),
  vehicleId: z.string().uuid().nullable().optional(),
  driverId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});
const DateParam = z.object({ date: isoDate });

/** Signature strokes from the phone: plain path data only, so the stored SVG can't carry scripts. */
const Signature = z.object({
  width: z.number().min(50).max(3000),
  height: z.number().min(50).max(3000),
  paths: z
    .array(
      z
        .string()
        .max(20_000)
        .regex(/^[MLQCmlqc0-9.,\s-]+$/, 'توقيع غير صالح'),
    )
    .min(1)
    .max(300),
});
export function signatureToSvg(s: z.infer<typeof Signature>) {
  const paths = s.paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="#1a120b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.width} ${s.height}" width="${s.width}" height="${s.height}">${paths}</svg>`;
}

const Confirm = z.object({
  clientRef: z.string().trim().min(8).max(80),
  outcome: z.enum(['delivered', 'failed']),
  failReason: z.enum(DELIVERY_REASONS).nullable().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        deliveredQty: qty,
        shortReason: z.enum(DELIVERY_REASONS).nullable().optional(),
        returnedQty: qty.default(0),
        returnReason: z.enum(DELIVERY_REASONS).nullable().optional(),
      }),
    )
    .max(300),
  receiverName: optionalText(80),
  signature: Signature.nullable().optional(),
  deliveredAt: z.string().datetime({ offset: true }),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracyM: z.number().min(0).max(100_000).nullable().optional(),
  collected: z
    .object({ amount: fils, method: z.enum(PAYMENT_METHODS), reference: optionalText(80) })
    .nullable()
    .optional(),
  note: optionalText(500),
});
const toInput = ({ signature, ...rest }: z.infer<typeof Confirm>): ConfirmInput => ({
  ...rest,
  signatureSvg: signature ? signatureToSvg(signature) : null,
});

export function distributionRouter(svc: DistributionService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);
  const view = requirePermission('deliveries.view');
  const manage = requirePermission('deliveries.manage');

  router.get('/routes', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.listRoutes() });
  });
  router.post('/routes', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.saveRoute(null, Route.parse(req.body), req.audit) });
  });
  router.patch('/routes/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.saveRoute(id, Route.partial().parse(req.body), req.audit),
    });
  });
  router.put('/routes/:id/stops', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    const { branchIds } = z
      .object({ branchIds: z.array(z.string().uuid()).max(500) })
      .parse(req.body);
    res.json({ ok: true, data: await svc.setStops(id, branchIds, req.audit) });
  });
  router.get('/unassigned', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.unassignedBranches() });
  });
  router.get('/drivers', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.drivers() });
  });

  router.get('/days/:date', view, async (req, res) => {
    res.json({ ok: true, data: await svc.getDay(DateParam.parse(req.params).date) });
  });
  router.post('/days/:date/generate', manage, async (req, res) => {
    res.json({ ok: true, data: await svc.generate(DateParam.parse(req.params).date, req.audit) });
  });
  router.get('/trips/:id', view, async (req, res) => {
    res.json({ ok: true, data: await svc.trip(Id.parse(req.params).id) });
  });
  router.get(
    '/trips/:id/sheet',
    requireAnyPermission('deliveries.view', 'deliveries.confirm'),
    async (req, res) => {
      sendPdf(res, await svc.loadingSheetPdf(Id.parse(req.params).id));
    },
  );
  // Office confirmation (e.g. the driver's phone is broken).
  router.post('/deliveries/:id/confirm', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.confirm(id, toInput(Confirm.parse(req.body)), req.auth!, req.audit),
    });
  });
  router.get('/deliveries/:id/signature', view, async (req, res) => {
    const svg = await svc.signature(Id.parse(req.params).id);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.send(svg);
  });
  return router;
}

/** Driver app. Confirmations may arrive late and in batches from the offline queue. */
export function driverRouter(svc: DistributionService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate, requirePermission('deliveries.confirm'));

  router.get('/trips', async (req, res) => {
    const { date } = z.object({ date: isoDate.optional() }).parse(req.query);
    res.json({ ok: true, data: await svc.myTrips(req.auth!, date) });
  });
  router.post('/trips/:id/start', async (req, res) => {
    res.json({
      ok: true,
      data: await svc.startTrip(Id.parse(req.params).id, req.auth!, req.audit),
    });
  });
  router.post('/deliveries/:id/confirm', async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.confirm(id, toInput(Confirm.parse(req.body)), req.auth!, req.audit),
    });
  });
  /** Sends the whole offline queue; each item succeeds or fails on its own. */
  router.post('/sync', async (req, res) => {
    const { items } = z
      .object({
        items: z
          .array(z.object({ deliveryId: z.string().uuid(), confirmation: z.unknown() }))
          .max(200),
      })
      .parse(req.body);
    const results = [];
    for (const item of items) {
      try {
        const input = toInput(Confirm.parse(item.confirmation));
        const r = await svc.confirm(item.deliveryId, input, req.auth!, req.audit);
        results.push({ deliveryId: item.deliveryId, ok: true, duplicate: r.duplicate });
      } catch (err) {
        const e =
          err instanceof AppError
            ? { status: err.status, code: err.code, message: err.message }
            : err instanceof z.ZodError
              ? {
                  status: 422,
                  code: 'VALIDATION',
                  message: err.issues[0]?.message ?? 'بيانات غير صحيحة',
                }
              : { status: 500, code: 'ERROR', message: 'خطأ في الخادم' };
        results.push({ deliveryId: item.deliveryId, ok: false, error: e });
      }
    }
    res.json({ ok: true, data: { results, trips: await svc.myTrips(req.auth!) } });
  });
  return router;
}
