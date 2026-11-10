import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright-core';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import { t } from './i18n.js';

/** Turns an HTML document into PDF bytes. Replaceable in tests. */
export type PdfRenderer = (html: string) => Promise<Buffer>;

/**
 * Chrome / Chromium locations tried in order. Set CHROME_PATH to override.
 * Mac: Google Chrome. Server (Ubuntu): `apt install chromium` or Google Chrome.
 */
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

function findChrome(): string | undefined {
  const found = CANDIDATES.find((p) => p && existsSync(p));
  if (found) return found;
  try {
    // Development fallback: a Playwright-managed Chromium, if one is installed.
    const require = createRequire(import.meta.url);
    const pw = require('playwright') as { chromium: { executablePath(): string } };
    const path = pw.chromium.executablePath();
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Cairo font embedded in every PDF so Arabic looks the same on any machine. */
let fontCss: string | null = null;
export function embeddedFontCss() {
  if (fontCss !== null) return fontCss;
  try {
    const require = createRequire(import.meta.url);
    const face = (weight: number) => {
      const file = require.resolve(`@fontsource/cairo/files/cairo-arabic-${weight}-normal.woff2`);
      const data = readFileSync(file).toString('base64');
      return `@font-face{font-family:Cairo;font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    };
    fontCss = face(400) + face(700);
  } catch {
    fontCss = '';
  }
  return fontCss;
}

export function createChromePdfRenderer(): PdfRenderer {
  let browser: Promise<Browser> | null = null;
  const getBrowser = () => {
    browser ??= (async () => {
      const executablePath = findChrome();
      if (!executablePath)
        throw new AppError(
          503,
          'PDF_UNAVAILABLE',
          t('إنشاء PDF يحتاج متصفح Chrome على الجهاز (أو CHROME_PATH)'),
        );
      const b = await chromium.launch({
        executablePath,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      b.on('disconnected', () => {
        browser = null;
      });
      return b;
    })().catch((err: unknown) => {
      browser = null;
      throw err;
    });
    return browser;
  };

  return async (html) => {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
      });
    } catch (err) {
      logger.error({ err }, 'PDF rendering failed');
      throw new AppError(500, 'PDF_FAILED', t('تعذّر إنشاء ملف PDF'));
    } finally {
      await page.close().catch(() => undefined);
    }
  };
}

export const escapeHtml = (s: string | null | undefined) =>
  (s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
