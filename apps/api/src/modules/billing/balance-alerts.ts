import { and, eq } from 'drizzle-orm';
import { addDays, ammanDate, filsToJodString } from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { branches, customers } from '../../db/schema/index.js';
import type { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import type { PushService } from '../notifications/push.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { BillingService } from './billing.service.js';

/**
 * Daily reminder of the unpaid balance: WhatsApp message with the statement PDF
 * (last 60 days) plus an app notification. Per customer it can be switched off.
 */
export function createBalanceAlerts(deps: {
  db: Db;
  billing: BillingService;
  whatsapp: WhatsAppService;
  push: PushService;
  settings: SettingsService;
  now?: () => Date;
}) {
  const { db, billing, whatsapp, push } = deps;
  const now = () => deps.now?.() ?? new Date();

  async function phoneOf(customerId: string) {
    const c = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    if (c?.phone) return { customer: c, phone: c.phone };
    const b = await db.query.branches.findFirst({
      where: and(eq(branches.customerId, customerId), eq(branches.isActive, true)),
    });
    return { customer: c, phone: b?.phone ?? null };
  }

  async function sendTo(customerId: string, sentBy: string | null) {
    const today = ammanDate(now());
    const { customer, phone } = await phoneOf(customerId);
    if (!customer) return { whatsapp: 'skipped' as const, push: 0 };
    const s = await billing.summary(customerId);
    const params = [customer.name, filsToJodString(s.balance), filsToJodString(s.overdue)];
    let wa: 'sent' | 'skipped' | 'failed' | 'no_phone' = 'no_phone';
    if (phone) {
      const pdf = await billing.statementPdf(customerId, addDays(today, -60), today);
      const msg = await whatsapp.sendDocumentTemplate(
        phone,
        'mb_balance_statement',
        params,
        { buffer: pdf.bytes, mimeType: 'application/pdf', filename: pdf.filename },
        { sentBy, customerId },
      );
      wa = !msg
        ? 'no_phone'
        : msg.status === 'failed'
          ? 'failed'
          : msg.status === 'skipped'
            ? 'skipped'
            : 'sent';
    }
    await push.toCustomer(customerId, {
      title: 'رصيد حسابكم',
      body: `المستحق ${filsToJodString(s.balance)} د.أ${s.overdue ? ` — متأخر ${filsToJodString(s.overdue)} د.أ` : ''}`,
      data: { screen: 'account' },
    });
    return { whatsapp: wa, balance: s.balance, overdue: s.overdue };
  }

  return {
    sendTo,
    /** Runs once a day from the scheduler. */
    async runDaily() {
      const cfg = await deps.settings.getReceivablesSettings();
      if (!cfg.alertsEnabled) return { sent: 0, skipped: 'disabled' };
      const targets = await billing.alertTargets(cfg);
      let sent = 0;
      for (const t of targets) {
        await sendTo(t.customerId, null);
        sent++;
      }
      return { sent };
    },
  };
}

export type BalanceAlerts = ReturnType<typeof createBalanceAlerts>;
