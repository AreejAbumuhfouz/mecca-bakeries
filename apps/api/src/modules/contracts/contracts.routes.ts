import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { CONTRACT_STATES, CONTRACT_STATUSES, PAYMENT_TYPES } from '@mecca/shared';
import { requireAnyPermission, requirePermission } from '../../middleware/auth.js';
import { fils, Id, isoDate, optionalText, pageQuery } from '../../lib/validation.js';
import type { ContractsService } from './contracts.service.js';

const bps = z.number().int().min(0).max(10_000);
const days = z.number().int().min(0).max(365);

const Terms = z.object({
  startDate: isoDate,
  endDate: isoDate,
  status: z.enum(CONTRACT_STATUSES).optional(),
  paymentType: z.enum(PAYMENT_TYPES),
  creditLimit: fils,
  paymentTermsDays: days,
  overdueGraceDays: days,
  discountBps: bps,
  allowReturns: z.boolean(),
  maxReturnBps: bps,
  returnsNotes: optionalText(1000),
  renewalAlertDays: days,
  notes: optionalText(2000),
});

const Prices = z.array(z.object({ itemId: z.string().uuid(), price: fils })).max(1000);

const CreateContract = Terms.extend({ customerId: z.string().uuid(), prices: Prices.optional() });

const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  customerId: z.string().uuid().optional(),
  state: z.enum(CONTRACT_STATES).optional(),
  ...pageQuery,
});

const Attachment = z.object({
  fileId: z.string().uuid(),
  label: z.string().trim().min(2).max(120),
});
const AttachmentIds = z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() });
const Renew = z.object({ startDate: isoDate.optional(), endDate: isoDate });
const CreditQuery = z.object({
  customerId: z.string().uuid(),
  orderAmount: z.coerce.number().int().min(0).max(100_000_000).default(0),
});

export function contractsRouter(svc: ContractsService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);
  const view = requirePermission('contracts.view');
  const manage = requirePermission('contracts.manage');

  router.get('/', view, async (req, res) => {
    res.json({ ok: true, data: await svc.list(ListQuery.parse(req.query)) });
  });
  router.get('/renewal-alerts', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.renewalAlerts() });
  });
  router.get(
    '/credit-check',
    requireAnyPermission('contracts.view', 'customers.view', 'orders.manage'),
    async (req, res) => {
      const q = CreditQuery.parse(req.query);
      res.json({ ok: true, data: await svc.creditCheck(q.customerId, q.orderAmount) });
    },
  );
  router.get('/:id', view, async (req, res) => {
    res.json({ ok: true, data: await svc.get(Id.parse(req.params).id) });
  });
  router.get('/:id/price-list', view, async (req, res) => {
    res.json({ ok: true, data: await svc.priceList(Id.parse(req.params).id) });
  });

  router.post('/', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.create(CreateContract.parse(req.body), req.audit) });
  });
  router.patch('/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({ ok: true, data: await svc.update(id, Terms.partial().parse(req.body), req.audit) });
  });
  router.put('/:id/prices', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({ ok: true, data: await svc.setPrices(id, Prices.parse(req.body), req.audit) });
  });
  router.post('/:id/renew', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.status(201).json({ ok: true, data: await svc.renew(id, Renew.parse(req.body), req.audit) });
  });
  router.post('/:id/attachments', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res
      .status(201)
      .json({ ok: true, data: await svc.addAttachment(id, Attachment.parse(req.body), req.audit) });
  });
  router.delete('/:id/attachments/:attachmentId', manage, async (req, res) => {
    const { id, attachmentId } = AttachmentIds.parse(req.params);
    await svc.removeAttachment(id, attachmentId, req.audit);
    res.json({ ok: true, data: { removed: true } });
  });
  return router;
}
