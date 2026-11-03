import { readFile } from 'node:fs/promises';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { files, tradeNames } from '../db/schema/index.js';
import type { FilesService } from '../modules/files/files.service.js';

export type BrandHeader = {
  name: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  footer: string | null;
  logoDataUrl: string | null;
};

/** Header of a printed document: the given trade name, or the first active one. Logo is embedded. */
export async function brandHeader(
  db: Db,
  filesService: FilesService,
  tradeNameId?: string | null,
): Promise<BrandHeader> {
  const tn = tradeNameId
    ? await db.query.tradeNames.findFirst({ where: eq(tradeNames.id, tradeNameId) })
    : await db.query.tradeNames.findFirst({
        where: eq(tradeNames.isActive, true),
        orderBy: [asc(tradeNames.createdAt)],
      });
  let logoDataUrl: string | null = null;
  if (tn?.logoFileId) {
    const f = await db.query.files.findFirst({ where: eq(files.id, tn.logoFileId) });
    if (f) {
      const path = await filesService
        .get(f.id)
        .then((x) => x.absolutePath)
        .catch(() => null);
      const bytes = path ? await readFile(path).catch(() => null) : null;
      if (bytes) logoDataUrl = `data:${f.mimeType};base64,${bytes.toString('base64')}`;
    }
  }
  return {
    name: tn?.name ?? 'مخابز مكة',
    nameEn: tn?.nameEn ?? null,
    phone: tn?.phone ?? null,
    email: tn?.email ?? null,
    address: tn?.address ?? null,
    footer: tn?.invoiceFooter ?? null,
    logoDataUrl,
  };
}
