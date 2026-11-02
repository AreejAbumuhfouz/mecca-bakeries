import type { Db } from '../db/client.js';

/** A transaction handle, usable wherever `Db` is. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Conn = Db | Tx;

/**
 * Prepares form input for the database: drops undefined keys and stores
 * empty strings as NULL (except the keys listed in `keep`, e.g. required names).
 */
export function clean<T extends Record<string, unknown>>(input: T, keep: string[] = ['name']): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'string' && v.trim() === '' && !keep.includes(k) ? null : v;
  }
  return out as T;
}

/** Postgres unique-violation check, for races that slip past the pre-checks. */
export const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  ((err as { code?: string }).code === '23505' ||
    (err as { cause?: { code?: string } }).cause?.code === '23505');
