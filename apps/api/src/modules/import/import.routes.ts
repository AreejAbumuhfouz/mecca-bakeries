import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { AppError } from '../../lib/errors.js';
import {
  IMPORT_COLUMNS,
  IMPORT_KINDS,
  IMPORT_LABELS_AR,
  type ImportService,
} from './import.service.js';

const Kind = z.object({ kind: z.enum(IMPORT_KINDS) });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function importRouter(svc: ImportService, authenticate: RequestHandler): Router {
  const router = Router();
  // Moving data in is a setup job for the system owner.
  router.use(authenticate, requirePermission('settings.manage'));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  const file = (req: { file?: Express.Multer.File }) => {
    if (!req.file) throw new AppError(422, 'NO_FILE', 'اختر ملف Excel');
    return req.file.buffer;
  };

  router.get('/', (_req, res) => {
    res.json({
      ok: true,
      data: IMPORT_KINDS.map((k) => ({
        kind: k,
        label: IMPORT_LABELS_AR[k],
        columns: IMPORT_COLUMNS[k].map((c) => ({
          key: c.key,
          label: c.label,
          required: Boolean(c.required),
        })),
      })),
    });
  });
  router.get('/opening-check', async (_req, res) => {
    res.json({ ok: true, data: await svc.openingCheck() });
  });
  router.get('/:kind/template', async (req, res) => {
    const { kind } = Kind.parse(req.params);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="template-${kind}.xlsx"`);
    res.send(await svc.template(kind));
  });
  router.post('/:kind/preview', upload.single('file'), async (req, res) => {
    const { kind } = Kind.parse(req.params);
    res.json({ ok: true, data: await svc.preview(kind, file(req)) });
  });
  router.post('/:kind/commit', upload.single('file'), async (req, res) => {
    const { kind } = Kind.parse(req.params);
    res.json({ ok: true, data: await svc.commit(kind, file(req), req.auth!, req.audit) });
  });
  return router;
}
