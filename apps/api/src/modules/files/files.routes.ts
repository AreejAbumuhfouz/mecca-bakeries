import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAnyPermission } from '../../middleware/auth.js';
import type { FilesService } from './files.service.js';

const Id = z.object({ id: z.string().uuid() });

export function filesRouter(
  svc: FilesService,
  authenticate: RequestHandler,
  maxMb: number,
): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
  });
  const single: RequestHandler = (req, res, next) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
        return next(new AppError(413, 'FILE_TOO_LARGE', `حجم الملف أكبر من ${maxMb} ميغابايت`));
      next(err);
    });

  router.post(
    '/',
    authenticate,
    requireAnyPermission('trade_names.manage', 'items.manage', 'contracts.manage'),
    single,
    async (req, res) => {
      if (!req.file) throw new AppError(400, 'NO_FILE', 'لم يتم اختيار ملف');
      const saved = await svc.save(
        {
          buffer: req.file.buffer,
          originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
          mimeType: req.file.mimetype,
          isPublic: req.body?.isPublic === 'true',
        },
        req.audit,
      );
      res.status(201).json({ ok: true, data: saved });
    },
  );

  /** Public files (logos, item images) are served to anyone; private ones need a login. */
  router.get('/:id', async (req, res, next) => {
    const file = await svc.get(Id.parse(req.params).id);
    const send = () => {
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      if (file.isPublic) {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'public, max-age=86400');
      } else {
        res.setHeader('Cache-Control', 'private, no-store');
      }
      res.sendFile(file.absolutePath, (err) => {
        if (err && !res.headersSent) next(new AppError(404, 'NOT_FOUND', 'الملف غير موجود'));
      });
    };
    if (file.isPublic) return send();
    // Private files are contract attachments: only staff who can view contracts may open them.
    authenticate(req, res, (err?: unknown) => {
      if (err) return next(err);
      if (!req.auth?.permissions.includes('contracts.view'))
        return next(new AppError(403, 'FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء'));
      send();
    });
  });

  return router;
}
