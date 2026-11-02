import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { code, optionalText, phone } from '../../lib/validation.js';
import type { CustomersService } from './customers.service.js';

const Category = z.object({
  name: z.string().trim().min(2).max(80),
  nameEn: optionalText(80),
  isActive: z.boolean().optional(),
});

const CustomerFields = z.object({
  code,
  name: z.string().trim().min(2).max(150),
  nameEn: optionalText(150),
  categoryId: z.string().uuid().nullable().optional(),
  tradeNameId: z.string().uuid().nullable().optional(),
  contactName: optionalText(120),
  phone,
  email: z
    .union([z.string().trim().email().max(254), z.literal('')])
    .nullable()
    .optional(),
  city: optionalText(80),
  address: optionalText(300),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});
const CreateCustomer = CustomerFields.extend({ createMainBranch: z.boolean().optional() });

const Branch = z.object({
  code,
  name: z.string().trim().min(2).max(150),
  contactName: optionalText(120),
  phone,
  city: optionalText(80),
  address: optionalText(300),
  deliveryNotes: optionalText(1000),
  isActive: z.boolean().optional(),
});

const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  tradeNameId: z.string().uuid().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const Id = z.object({ id: z.string().uuid() });
const BranchIds = z.object({ id: z.string().uuid(), branchId: z.string().uuid() });

export function customersRouter(svc: CustomersService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);
  const view = requirePermission('customers.view');
  const manage = requirePermission('customers.manage');

  router.get('/categories', view, async (_req, res) => {
    res.json({ ok: true, data: await svc.listCategories() });
  });
  router.post('/categories', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.createCategory(Category.parse(req.body), req.audit) });
  });
  router.patch('/categories/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.updateCategory(id, Category.partial().parse(req.body), req.audit),
    });
  });

  router.get('/', view, async (req, res) => {
    res.json({ ok: true, data: await svc.list(ListQuery.parse(req.query)) });
  });
  router.get('/:id', view, async (req, res) => {
    res.json({ ok: true, data: await svc.get(Id.parse(req.params).id) });
  });
  router.post('/', manage, async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await svc.create(CreateCustomer.parse(req.body), req.audit) });
  });
  router.patch('/:id', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.update(id, CustomerFields.partial().parse(req.body), req.audit),
    });
  });

  router.post('/:id/branches', manage, async (req, res) => {
    const { id } = Id.parse(req.params);
    res
      .status(201)
      .json({ ok: true, data: await svc.createBranch(id, Branch.parse(req.body), req.audit) });
  });
  router.patch('/:id/branches/:branchId', manage, async (req, res) => {
    const { id, branchId } = BranchIds.parse(req.params);
    res.json({
      ok: true,
      data: await svc.updateBranch(id, branchId, Branch.partial().parse(req.body), req.audit),
    });
  });

  return router;
}
