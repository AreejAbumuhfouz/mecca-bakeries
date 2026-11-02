import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { pushTokens, users } from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';

export type PushMessage = { title: string; body: string; data?: Record<string, string> };

/** Sends to the Expo push service. Replaceable in tests. */
export type PushTransport = (messages: ({ to: string } & PushMessage)[]) => Promise<void>;

export const expoTransport: PushTransport = async (messages) => {
  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100).map((m) => ({ ...m, sound: 'default' }))),
    });
    if (!res.ok) logger.warn(`[PUSH failed] HTTP ${res.status}`);
  }
};

export function createPushService(db: Db, transport: PushTransport | null) {
  return {
    async register(userId: string, token: string, platform: string | null) {
      await db
        .insert(pushTokens)
        .values({ token, userId, platform, lastSeenAt: new Date() })
        .onConflictDoUpdate({
          target: pushTokens.token,
          set: { userId, platform, lastSeenAt: new Date() },
        });
    },

    async unregister(token: string) {
      await db.delete(pushTokens).where(eq(pushTokens.token, token));
    },

    /** Sends to every device of the customer's active restaurant accounts. */
    async toCustomer(customerId: string, message: PushMessage) {
      const accounts = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.customerId, customerId));
      const active = accounts.map((a) => a.id);
      if (!active.length) return 0;
      const tokens = await db
        .select({ token: pushTokens.token })
        .from(pushTokens)
        .where(inArray(pushTokens.userId, active));
      if (!tokens.length) return 0;
      if (!transport) {
        logger.info(
          `[PUSH disabled] ${tokens.length} device(s): ${message.title} — ${message.body}`,
        );
        return tokens.length;
      }
      await transport(tokens.map((t) => ({ to: t.token, ...message }))).catch((err: unknown) =>
        logger.warn(`[PUSH failed] ${String(err)}`),
      );
      return tokens.length;
    },
  };
}

export type PushService = ReturnType<typeof createPushService>;
