import { DEFAULT_LOCALE, LOCALES, translate, type Locale } from '@mecca/shared';

/**
 * Interface language. Arabic is the default; the choice is kept in this browser and on
 * the user's account. Changing it reloads the page so every text, and the page direction,
 * switches together.
 */
export const LOCALE_KEY = 'mb-locale';

function readLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    if (v && (LOCALES as readonly string[]).includes(v)) return v as Locale;
  } catch {
    // storage blocked
  }
  return DEFAULT_LOCALE;
}

const current: Locale = readLocale();

export const getLocale = () => current;
export const isRtl = () => current === 'ar';

/** Translates Arabic source text; {0}, {1}... are filled from args. */
export const t = (text: string, ...args: unknown[]) => translate(current, text, args);

/** Saves the language and reloads. */
export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // storage blocked: the account setting still applies after the next login
  }
  if (locale !== current) window.location.reload();
}

/** Date/number formatting locale; Latin digits in both languages. */
export const intlLocale = () => (current === 'en' ? 'en-GB' : 'ar-JO-u-nu-latn');

/** Sets <html lang/dir> before the page paints (runs inline in the root layout). */
export const localeInitScript = `(function(){try{var l=localStorage.getItem('${LOCALE_KEY}');if(l==='en'){document.documentElement.lang='en';document.documentElement.dir='ltr';}}catch(e){}})();`;
