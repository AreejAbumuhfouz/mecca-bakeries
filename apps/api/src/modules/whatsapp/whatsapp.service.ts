import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { customers, whatsappMessages } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { normalizePhone, renderTemplate, type TemplateName } from './templates.js';

export type WhatsAppConfig = {
  token: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
  apiVersion: string;
  language: string;
};

/** Sends through the Meta WhatsApp Cloud API. Replaceable in tests. */
export type WhatsAppTransport = (
  path: string,
  body: unknown,
) => Promise<{ ok: boolean; messageId?: string; error?: string }>;

export function metaTransport(cfg: WhatsAppConfig): WhatsAppTransport {
  return async (path, body) => {
    const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };
    return res.ok
      ? { ok: true, messageId: json.messages?.[0]?.id }
      : { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
  };
}

type WebhookBody = {
  entry?: {
    changes?: {
      value?: {
        messages?: { id: string; from: string; type: string; text?: { body?: string } }[];
        statuses?: { id: string; status: string; errors?: { title?: string }[] }[];
      };
    }[];
  }[];
};

export function createWhatsAppService(deps: {
  db: Db;
  config: WhatsAppConfig | null;
  transport?: WhatsAppTransport;
}) {
  const { db, config } = deps;
  const transport = deps.transport ?? (config ? metaTransport(config) : null);

  async function customerByPhone(phone: string) {
    const local = `0${phone.slice(3)}`;
    const row = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        or(
          eq(customers.phone, local),
          eq(customers.phone, phone),
          eq(customers.phone, `+${phone}`),
        ),
      )
      .limit(1);
    return row[0]?.id ?? null;
  }

  async function send(
    kind: { template: TemplateName; params: string[] } | { text: string },
    to: string,
    meta: { customerId?: string | null; orderId?: string | null; sentBy?: string | null },
  ) {
    const phone = normalizePhone(to);
    if (!phone) return null;
    const body = 'template' in kind ? renderTemplate(kind.template, kind.params) : kind.text;
    const [row] = await db
      .insert(whatsappMessages)
      .values({
        direction: 'out',
        phone,
        customerId: meta.customerId ?? null,
        orderId: meta.orderId ?? null,
        template: 'template' in kind ? kind.template : null,
        body,
        status: transport ? 'queued' : 'skipped',
        sentBy: meta.sentBy ?? null,
      })
      .returning();
    if (!transport) {
      logger.info(`[WHATSAPP not configured] to ${phone}: ${body}`);
      return row!;
    }
    const payload =
      'template' in kind
        ? {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: {
              name: kind.template,
              language: { code: config?.language ?? 'ar' },
              components: [
                { type: 'body', parameters: kind.params.map((text) => ({ type: 'text', text })) },
              ],
            },
          }
        : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: kind.text } };
    const result = await transport(`${config?.phoneNumberId ?? 'test'}/messages`, payload).catch(
      (err: unknown) => ({ ok: false, error: String(err), messageId: undefined }),
    );
    const [updated] = await db
      .update(whatsappMessages)
      .set(
        result.ok
          ? { status: 'sent', waMessageId: result.messageId ?? null }
          : { status: 'failed', error: result.error ?? 'unknown error' },
      )
      .where(eq(whatsappMessages.id, row!.id))
      .returning();
    if (!result.ok) logger.warn(`[WHATSAPP failed] to ${phone}: ${result.error}`);
    return updated!;
  }

  return {
    configured: Boolean(transport),

    sendTemplate: (
      to: string,
      template: TemplateName,
      params: string[],
      meta: { customerId?: string | null; orderId?: string | null } = {},
    ) => send({ template, params }, to, meta),

    /** Free text reply from the dashboard (only delivered within 24h of the customer's last message). */
    async sendText(to: string, text: string, sentBy: string) {
      const phone = normalizePhone(to);
      if (!phone) throw new AppError(400, 'BAD_PHONE', 'رقم الهاتف غير صالح');
      return send({ text }, phone, { customerId: await customerByPhone(phone), sentBy });
    },

    /** Meta signs webhook calls with the app secret (X-Hub-Signature-256). */
    verifySignature(rawBody: Buffer | undefined, header: string | undefined) {
      if (!config?.appSecret) return true; // not configured: development only
      if (!rawBody || !header?.startsWith('sha256=')) return false;
      const expected = createHmac('sha256', config.appSecret).update(rawBody).digest('hex');
      const given = header.slice(7);
      return (
        given.length === expected.length &&
        timingSafeEqual(Buffer.from(given), Buffer.from(expected))
      );
    },

    verifyToken: config?.verifyToken ?? null,

    /** Stores incoming messages and delivery status updates. */
    async handleWebhook(body: WebhookBody) {
      let received = 0;
      let statuses = 0;
      for (const entry of body.entry ?? [])
        for (const change of entry.changes ?? []) {
          for (const m of change.value?.messages ?? []) {
            const phone = normalizePhone(m.from) ?? m.from;
            await db
              .insert(whatsappMessages)
              .values({
                direction: 'in',
                phone,
                customerId: await customerByPhone(phone),
                body: m.text?.body ?? `[${m.type}]`,
                status: 'received',
                waMessageId: m.id,
              })
              .onConflictDoNothing();
            received++;
          }
          for (const s of change.value?.statuses ?? []) {
            if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
            await db
              .update(whatsappMessages)
              .set({
                status: s.status as 'sent' | 'delivered' | 'read' | 'failed',
                error: s.errors?.[0]?.title ?? null,
              })
              .where(eq(whatsappMessages.waMessageId, s.id));
            statuses++;
          }
        }
      return { received, statuses };
    },

    async list(q: {
      search?: string;
      customerId?: string;
      direction?: 'in' | 'out';
      page: number;
      pageSize: number;
    }) {
      const filters: SQL[] = [];
      if (q.customerId) filters.push(eq(whatsappMessages.customerId, q.customerId));
      if (q.direction) filters.push(eq(whatsappMessages.direction, q.direction));
      if (q.search) {
        const term = `%${q.search}%`;
        filters.push(
          or(
            ilike(whatsappMessages.phone, term),
            ilike(whatsappMessages.body, term),
            ilike(customers.name, term),
          )!,
        );
      }
      const where = filters.length ? and(...filters) : undefined;
      const [rows, [total]] = await Promise.all([
        db
          .select({ message: whatsappMessages, customerName: customers.name })
          .from(whatsappMessages)
          .leftJoin(customers, eq(customers.id, whatsappMessages.customerId))
          .where(where)
          .orderBy(desc(whatsappMessages.createdAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(whatsappMessages)
          .leftJoin(customers, eq(customers.id, whatsappMessages.customerId))
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({ ...r.message, customerName: r.customerName })),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  };
}

export type WhatsAppService = ReturnType<typeof createWhatsAppService>;
