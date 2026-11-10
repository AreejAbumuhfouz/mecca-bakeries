import { logger } from './logger.js';
import type { Mailer } from './mailer.js';

/**
 * Emails the person on call when the server hits an unexpected error. At most one email
 * per 15 minutes, so a bad night does not flood the inbox; the rest is in the logs.
 */
export function createErrorAlerts(opts: { mailer: Mailer; to: string; appName?: string }) {
  let lastSent = 0;
  let suppressed = 0;
  return function alert(err: unknown, context: Record<string, unknown> = {}) {
    if (!opts.to) return;
    const now = Date.now();
    if (now - lastSent < 15 * 60_000) {
      suppressed++;
      return;
    }
    lastSent = now;
    const extra = suppressed
      ? `\n(${suppressed} more errors in the last period, see the logs)`
      : '';
    suppressed = 0;
    const e = err instanceof Error ? err : new Error(String(err));
    void opts.mailer
      .send({
        to: opts.to,
        subject: `[${opts.appName ?? 'Mecca Bakeries'}] Server error: ${e.message.slice(0, 80)}`,
        text: `${new Date(now).toISOString()}\n${JSON.stringify(context, null, 2)}\n\n${e.stack ?? e.message}${extra}`,
      })
      .catch((mailErr: unknown) => logger.warn({ err: mailErr }, 'Could not send error alert'));
  };
}

export type ErrorAlert = ReturnType<typeof createErrorAlerts>;
