import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { PERMISSIONS, ROLE_VALUES } from '@mecca/shared';
import { requirePermission } from '../../middleware/auth.js';
import type { UsersService } from './users.service.js';

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{7,20}$/, 'رقم هاتف غير صالح')
  .nullable()
  .optional();

const CreateUser = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(120),
  phone,
  role: z.enum(ROLE_VALUES),
  customerId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const PatchUser = CreateUser.partial().extend({
  overrides: z
    .array(z.object({ permission: z.enum(PERMISSIONS), allowed: z.boolean() }))
    .max(PERMISSIONS.length)
    .optional(),
});

const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  role: z.enum(ROLE_VALUES).optional(),
  customerId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const IdParam = z.object({ id: z.string().uuid() });

export function usersRouter(users: UsersService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', requirePermission('users.view'), async (req, res) => {
    res.json({ ok: true, data: await users.list(ListQuery.parse(req.query)) });
  });

  router.get('/:id', requirePermission('users.view'), async (req, res) => {
    res.json({ ok: true, data: await users.get(IdParam.parse(req.params).id) });
  });

  router.post('/', requirePermission('users.manage'), async (req, res) => {
    res
      .status(201)
      .json({ ok: true, data: await users.create(CreateUser.parse(req.body), req.audit) });
  });

  router.patch('/:id', requirePermission('users.manage'), async (req, res) => {
    const { id } = IdParam.parse(req.params);
    res.json({ ok: true, data: await users.update(id, PatchUser.parse(req.body), req.audit) });
  });

  return router;
}
