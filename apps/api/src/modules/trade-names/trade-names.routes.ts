import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireAnyPermission, requirePermission } from '../../middleware/auth.js';
import { optionalText, phone } from '../../lib/validation.js';
import type { TradeNamesService } from './trade-names.service.js';

const TradeName = z.object({
  name: z.string().trim().min(2).max(150),
  nameEn: optionalText(150),
  logoFileId: z.string().uuid().nullable().optional(),
  phone,
  email: z
    .union([z.string().trim().email().max(254), z.literal('')])
    .nullable()
    .optional(),
  address: optionalText(300),
  invoicePrefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{1,6}$/, 'البادئة من 1 إلى 6 أحرف إنجليزية'),
  nextInvoiceNumber: z.number().int().min(1).max(99_999_999).optional(),
  invoiceFooter: optionalText(500),
  isActive: z.boolean().optional(),
});

const Id = z.object({ id: z.string().uuid() });

export function tradeNamesRouter(svc: TradeNamesService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);
  const manage = requirePermission('trade_names.manage');
  // Staff who pick a trade name for a customer or read contracts need the list.
  const view = requireAnyPermission('trade_names.manage', 'customers.view', 'contracts.view');

  router.get('/', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.list() });
  });
  router.get('/:id', view, async (req, res) => {
    res.json({ ok: true, data: await svc.get(Id.parse(req.params).id) });
  });
  router.post('/', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.create(TradeName.parse(req.body), req.audit) });
  });
  router.patch('/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.update(id, TradeName.partial().parse(req.body), req.audit),
    });
  });
  return router;
}
