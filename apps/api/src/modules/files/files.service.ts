import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { files } from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';

/** Allowed uploads and the extension stored on disk. */
export const ALLOWED_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export type UploadInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  isPublic: boolean;
};

export function createFilesService(db: Db, uploadDir: string) {
  const root = path.resolve(uploadDir);

  return {
    root,

    async save(input: UploadInput, ctx: AuditContext) {
      const ext = ALLOWED_TYPES[input.mimeType];
      if (!ext)
        throw new AppError(400, 'BAD_FILE_TYPE', 'نوع الملف غير مسموح (PNG أو JPG أو WEBP أو PDF)');
      // Public images may be shown on invoices and in the app; PDFs are always private.
      const isPublic = input.isPublic && IMAGE_TYPES.includes(input.mimeType);
      const storageKey = `${randomUUID()}${ext}`;
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, storageKey), input.buffer);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(files)
          .values({
            originalName: input.originalName.slice(0, 200),
            mimeType: input.mimeType,
            size: input.buffer.length,
            storageKey,
            isPublic,
            uploadedBy: ctx.userId,
          })
          .returning();
        await writeAudit(tx, ctx, {
          action: 'file.upload',
          entity: 'file',
          entityId: row!.id,
          after: row,
        });
        return row!;
      });
    },

    async get(id: string) {
      const row = await db.query.files.findFirst({ where: eq(files.id, id) });
      if (!row) throw notFound('File');
      return { ...row, absolutePath: path.join(root, row.storageKey) };
    },

    /** Ensures a referenced file exists (and is an image when required). */
    async assertUsable(id: string | null | undefined, opts: { image?: boolean } = {}) {
      if (!id) return;
      const row = await db.query.files.findFirst({ where: eq(files.id, id) });
      if (!row) throw new AppError(400, 'BAD_FILE', 'الملف غير موجود');
      if (opts.image && !IMAGE_TYPES.includes(row.mimeType))
        throw new AppError(400, 'BAD_FILE', 'يجب أن يكون الملف صورة');
    },
  };
}

export type FilesService = ReturnType<typeof createFilesService>;
