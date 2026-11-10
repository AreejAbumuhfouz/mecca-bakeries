import { activeLocale } from './i18n/translate.js';

/** Money is stored as integer fils: 1 JOD = 1000 fils. Never use floats for amounts. */
export const FILS_PER_JOD = 1000;

/**
 * Parses a JOD amount typed by a user ("1.250", "0.35", "12") into fils.
 * Returns null for empty or invalid input, or more than 3 decimal places.
 */
export function parseJod(input: string): number | null {
  const value = input.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const match = /^(\d{1,9})(?:\.(\d{0,3}))?$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? '').padEnd(3, '0'));
  return whole * FILS_PER_JOD + frac;
}

/** 1250 → "1.250" (always 3 decimals, no currency). */
export function filsToJodString(fils: number): string {
  const sign = fils < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(fils));
  return `${sign}${Math.floor(abs / FILS_PER_JOD)}.${String(abs % FILS_PER_JOD).padStart(3, '0')}`;
}

/** 1250 → "1.250 د.أ" (or "1.250 JOD" in English). */
export const formatJod = (fils: number) =>
  `${filsToJodString(fils)} ${activeLocale() === 'en' ? 'JOD' : 'د.أ'}`;

/**
 * Applies a percentage discount given in basis points (100 bps = 1%).
 * Rounds to the nearest fils.
 */
export function applyDiscount(fils: number, discountBps: number): number {
  return Math.round((fils * (10_000 - discountBps)) / 10_000);
}

/** "2.5" (percent typed by a user) → 250 bps. Null if invalid or out of 0–100. */
export function parsePercentToBps(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(input.trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

/** 250 → "2.5" */
export const bpsToPercentString = (bps: number) => String(bps / 100);
