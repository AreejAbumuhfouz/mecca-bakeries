import { z } from 'zod';

/** Optional free text; empty strings are turned into NULL by `clean()`. */
export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const phone = z
  .string()
  .trim()
  .regex(/^(\+?[0-9\s-]{7,20})?$/, 'رقم هاتف غير صالح')
  .nullable()
  .optional();

/** Codes typed by staff: English letters, digits and dashes. */
export const code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,20}$/, 'الكود يقبل أحرفاً إنجليزية وأرقاماً و - فقط')
  .optional();

/** Money in fils (integer, 1 JOD = 1000 fils). */
export const fils = z.number().int().min(0).max(100_000_000);

/** Calendar date "YYYY-MM-DD". */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح')
  // Round-trip check: rejects impossible days like 2026-02-30 that Date.parse rolls over.
  .refine((d) => {
    const tr = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(tr) && new Date(tr).toISOString().slice(0, 10) === d;
  }, 'تاريخ غير صالح');

export const Id = z.object({ id: z.string().uuid() });

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
