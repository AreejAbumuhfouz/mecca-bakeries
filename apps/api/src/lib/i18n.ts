import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import { DEFAULT_LOCALE, LOCALES, translate, translateDeep, type Locale } from '@mecca/shared';

/**
 * The language of the current request (or background job). Requests carry it in the
 * X-Locale header that the dashboard and the app send; outside a request it is Arabic
 * unless a job sets it for the person it writes to.
 */
const store = new AsyncLocalStorage<{ locale: Locale }>();

export const asLocale = (v: unknown): Locale | null =>
  typeof v === 'string' && (LOCALES as readonly string[]).includes(v) ? (v as Locale) : null;

export const currentLocale = (): Locale => store.getStore()?.locale ?? DEFAULT_LOCALE;

/** Translates Arabic text into the current language. */
export const t = (text: string, ...args: unknown[]) => translate(currentLocale(), text, args);

/** Translates every known Arabic string inside a value (report tables, import labels). */
export const tr = <T>(value: T): T => translateDeep(currentLocale(), value);

/** Runs fn with the given language, e.g. an email written to one user. */
export const withLocale = <T>(locale: Locale | null | undefined, fn: () => T): T =>
  store.run({ locale: locale ?? DEFAULT_LOCALE }, fn);

export const isRtlNow = () => currentLocale() === 'ar';

export const localeMiddleware: RequestHandler = (req, _res, next) => {
  const header = req.get('x-locale') ?? req.get('accept-language')?.slice(0, 2);
  store.run({ locale: asLocale(header) ?? DEFAULT_LOCALE }, next);
};
