import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { PURCHASE_ORDER_STATUSES } from '@mecca/shared';
import { requirePermission } from '../../middleware/auth.js';
import { boolQuery, Id, isoDate, optionalText, pageQuery, phone } from '../../lib/validation.js';
import type { PurchasingService } from './purchasing.service.js';

const Supplier = z.object({
  name: z.string().trim().min(2).max(150),
  contactName: optionalText(120),
  phone,
  whatsappPhone: phone,
  address: optionalText(300),
  notes: optionalText(1000),
  isActive: z.boolean().optional(),
});

const Lines = z
  .array(
    z.object({
      description: z.string().trim().min(1).max(200),
      quantity: z.number().positive().max(1_000_000).multipleOf(0.001),
      unit: z.string().trim().min(1).max(30),
      note: optionalText(200),
    }),
  )
  .min(1)
  .max(100);

const Po = z.object({
  supplierId: z.string().uuid(),
  neededDate: isoDate.nullable().optional(),
  notes: optionalText(1000),
  lines: Lines,
});

const ListQuery = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  supplierId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  ...pageQuery,
});

export function purchasingRouter(svc: PurchasingService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);
  const view = requirePermission('purchasing.view');
  const manage = requirePermission('purchasing.manage');

  router.get('/suppliers', view, async (req, res) => {
    const q = z
      .object({ search: z.string().trim().max(100).optional(), isActive: boolQuery })
      .parse(req.query);
    res.json({ ok: true, data: await svc.listSuppliers(q) });
  });
  router.post('/suppliers', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.saveSupplier(null, Supplier.parse(req.body), req.audit) });
  });
  router.patch('/suppliers/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.saveSupplier(id, Supplier.partial().parse(req.body), req.audit),
    });
  });

  router.get('/orders', view, async (req, res) => {
    res.json({ ok: true, data: await svc.list(ListQuery.parse(req.query)) });
  });
  router.get('/orders/:id', view, async (req, res) => {
    res.json({ ok: true, data: await svc.get(Id.parse(req.params).id) });
  });
  router.get('/orders/:id/pdf', view, async (req, res) => {
    const { bytes, filename } = await svc.pdf(Id.parse(req.params).id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(bytes);
  });
  router.post('/orders', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.create(Po.parse(req.body), req.auth!, req.audit) });
  });
  router.patch('/orders/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({ ok: true, data: await svc.update(id, Po.partial().parse(req.body), req.audit) });
  });
  router.post('/orders/:id/status', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    const { status } = z.object({ status: z.enum(PURCHASE_ORDER_STATUSES) }).parse(req.body);
    res.json({ ok: true, data: await svc.setStatus(id, status, req.audit) });
  });
  router.post('/orders/:id/send', manage, async (req, res) => {
    res.json({ ok: true, data: await svc.send(Id.parse(req.params).id, req.auth!, req.audit) });
  });
  return router;
}
