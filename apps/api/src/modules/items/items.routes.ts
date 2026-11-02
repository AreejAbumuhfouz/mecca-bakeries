import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ITEM_UNITS } from '@mecca/shared';
import { requirePermission } from '../../middleware/auth.js';
import { boolQuery, code, fils, Id, optionalText, pageQuery } from '../../lib/validation.js';
import type { ItemsService } from './items.service.js';

const Section = z.object({
  name: z.string().trim().min(2).max(80),
  nameEn: optionalText(80),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});

const Item = z.object({
  code,
  name: z.string().trim().min(2).max(150),
  nameEn: optionalText(150),
  sectionId: z.string().uuid(),
  unit: z.enum(ITEM_UNITS),
  basePrice: fils,
  imageFileId: z.string().uuid().nullable().optional(),
  description: optionalText(1000),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});

const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  sectionId: z.string().uuid().optional(),
  isActive: boolQuery,
  ...pageQuery,
});

export function itemsRouter(svc: ItemsService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);
  const view = requirePermission('items.view');
  const manage = requirePermission('items.manage');

  router.get('/sections', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.listSections() });
  });
  router.post('/sections', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.createSection(Section.parse(req.body), req.audit) });
  });
  router.patch('/sections/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.updateSection(id, Section.partial().parse(req.body), req.audit),
    });
  });

  router.get('/', view, async (req, res) => {
    res.json({ ok: true, data: await svc.list(ListQuery.parse(req.query)) });
  });
  router.get('/:id', view, async (req, res) => {
    res.json({ ok: true, data: await svc.get(Id.parse(req.params).id) });
  });
  router.post('/', manage, async (req, res) => {
    res.status(201).json({ ok: true, data: await svc.create(Item.parse(req.body), req.audit) });
  });
  router.patch('/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({ ok: true, data: await svc.update(id, Item.partial().parse(req.body), req.audit) });
  });
  return router;
}
