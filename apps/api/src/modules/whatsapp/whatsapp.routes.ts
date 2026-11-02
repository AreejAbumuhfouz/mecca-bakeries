import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireAnyPermission, requirePermission } from '../../middleware/auth.js';
import { pageQuery } from '../../lib/validation.js';
import { WHATSAPP_TEMPLATES } from './templates.js';
import type { WhatsAppService } from './whatsapp.service.js';

const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  customerId: z.string().uuid().optional(),
  direction: z.enum(['in', 'out']).optional(),
  ...pageQuery,
});
const Send = z.object({
  to: z.string().trim().min(7).max(20),
  text: z.string().trim().min(1).max(1000),
});

export function whatsappRouter(svc: WhatsAppService, authenticate: RequestHandler): Router {
  const router = Router();

  // Meta webhook (public). GET = subscription check, POST = messages and delivery statuses.
  router.get('/webhook', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    if (
      q['hub.mode'] === 'subscribe' &&
      svc.verifyToken &&
      q['hub.verify_token'] === svc.verifyToken
    ) {
      res.status(200).send(q['hub.challenge'] ?? '');
      return;
    }
    res.sendStatus(403);
  });
  router.post('/webhook', async (req, res) => {
    if (!svc.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) {
      res.sendStatus(401);
      return;
    }
    await svc.handleWebhook(req.body);
    res.sendStatus(200);
  });

  router.get(
    '/messages',
    authenticate,
    requireAnyPermission('orders.view', 'customers.view'),
    async (req, res) => {
      res.json({ ok: true, data: await svc.list(ListQuery.parse(req.query)) });
    },
  );
  router.post('/messages', authenticate, requirePermission('orders.manage'), async (req, res) => {
    const { to, text } = Send.parse(req.body);
    res.status(201).json({ ok: true, data: await svc.sendText(to, text, req.auth!.id) });
  });
  router.get(
    '/templates',
    authenticate,
    requireAnyPermission('orders.view', 'settings.manage'),
    (_req, res) => {
      res.json({
        ok: true,
        data: {
          configured: svc.configured,
          templates: Object.entries(WHATSAPP_TEMPLATES).map(([name, t]) => ({ name, ...t })),
        },
      });
    },
  );
  return router;
}
