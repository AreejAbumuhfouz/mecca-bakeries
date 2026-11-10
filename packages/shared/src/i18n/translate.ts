import type { Locale } from '../locales.js';
import { EN } from './en.js';

export type TArg = string | number | boolean | null | undefined;

/** Fills {0}, {1}, ... with the given values. */
export function interpolate(text: string, args: readonly unknown[]): string {
  if (!args.length) return text;
  return text.replace(/\{(\d+)\}/g, (m, i: string) => {
    const v = args[Number(i)];
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * Translates Arabic source text. The Arabic text is the key, so text that comes from
 * anywhere (labels in shared constants, server messages) can be passed through as well.
 * Unknown text is returned unchanged.
 */
export function translate(locale: Locale, text: string, args: readonly unknown[] = []): string {
  const base = locale === 'en' ? (EN[text] ?? text) : text;
  return interpolate(base, args);
}

/** True when the Arabic text has an English translation. */
export const hasTranslation = (text: string) => Object.prototype.hasOwnProperty.call(EN, text);

/** Translates every string in a JSON-like value that is a known Arabic key. */
export function translateDeep<T>(locale: Locale, value: T): T {
  if (locale !== 'en') return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return EN[v] ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
