import { eq } from 'drizzle-orm';
import { cutoffAt, filsToJodString } from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { branches, customers, orders } from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import type { TemplateName } from '../whatsapp/templates.js';
import type { PushService } from './push.js';

export type OrderNotice = {
  type:
    | 'order_placed'
    | 'order_updated'
    | 'order_on_hold'
    | 'order_approved'
    | 'order_rejected'
    | 'order_cancelled'
    | 'draft_ready';
  orderId: string;
};

export type ReminderTarget = {
  branchId: string;
  branchName: string;
  branchPhone: string | null;
  customerId: string;
  customerPhone: string | null;
};

export type Notifier = {
  order(notice: OrderNotice): Promise<void>;
  reminder(target: ReminderTarget, deliveryDate: string): Promise<void>;
};

/** "03:00 يوم 2026-11-04" in Amman time. */
function formatCutoff(at: Date) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Amman',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(at);
  return `${time} يوم ${day}`;
}

const TEMPLATE_BY_TYPE: Record<OrderNotice['type'], TemplateName> = {
  order_placed: 'mb_order_confirmed',
  order_updated: 'mb_order_updated',
  order_on_hold: 'mb_order_on_hold',
  order_approved: 'mb_order_approved',
  order_rejected: 'mb_order_rejected',
  order_cancelled: 'mb_order_cancelled',
  draft_ready: 'mb_draft_ready',
};

const PUSH_TITLE: Record<OrderNotice['type'], string> = {
  order_placed: 'تم استلام طلبك',
  order_updated: 'تم تعديل طلبك',
  order_on_hold: 'طلبك بانتظار موافقة الإدارة',
  order_approved: 'تمت الموافقة على طلبك',
  order_rejected: 'لم تتم الموافقة على طلبك',
  order_cancelled: 'تم إلغاء الطلب',
  draft_ready: 'مسودة طلب جاهزة للتأكيد',
};

/** Sends order and reminder messages by WhatsApp and app push, as enabled in the settings. */
export function createNotifier(deps: {
  db: Db;
  settings: SettingsService;
  whatsapp: WhatsAppService;
  push: PushService;
}): Notifier {
  const { db, settings, whatsapp, push } = deps;

  return {
    async order(notice) {
      try {
        const [row] = await db
          .select({ order: orders, branch: branches, customer: customers })
          .from(orders)
          .innerJoin(branches, eq(branches.id, orders.branchId))
          .innerJoin(customers, eq(customers.id, orders.customerId))
          .where(eq(orders.id, notice.orderId));
        if (!row) return;
        const s = await settings.getOrderSettings();
        const { order, branch, customer } = row;
        const cutoff = formatCutoff(cutoffAt(order.deliveryDate, s.cutoffTime));
        const base = [order.number, branch.name, order.deliveryDate];
        const params: Record<OrderNotice['type'], string[]> = {
          order_placed: [...base, filsToJodString(order.total), cutoff],
          order_updated: [...base, filsToJodString(order.total)],
          order_on_hold: [...base, (order.creditReasons ?? []).map((r) => r.message).join('، ')],
          order_approved: base,
          order_rejected: base,
          order_cancelled: base,
          draft_ready: [branch.name, order.deliveryDate, cutoff],
        };
        if (s.whatsappEnabled) {
          const phone = branch.phone ?? customer.phone;
          if (phone)
            await whatsapp.sendTemplate(phone, TEMPLATE_BY_TYPE[notice.type], params[notice.type], {
              customerId: customer.id,
              orderId: order.id,
            });
        }
        if (s.pushEnabled)
          await push.toCustomer(customer.id, {
            title: PUSH_TITLE[notice.type],
            body: `${branch.name} — ${order.deliveryDate} — ${order.number}`,
            data: { orderId: order.id },
          });
      } catch (err) {
        logger.error({ err }, `notification ${notice.type} failed`);
      }
    },

    async reminder(target, deliveryDate) {
      try {
        const s = await settings.getOrderSettings();
        const cutoff = formatCutoff(cutoffAt(deliveryDate, s.cutoffTime));
        if (s.whatsappEnabled) {
          const phone = target.branchPhone ?? target.customerPhone;
          if (phone)
            await whatsapp.sendTemplate(
              phone,
              'mb_order_reminder',
              [target.branchName, deliveryDate, cutoff],
              { customerId: target.customerId },
            );
        }
        if (s.pushEnabled)
          await push.toCustomer(target.customerId, {
            title: 'تذكير بطلب الغد',
            body: `لم يصلنا طلب ${target.branchName} ليوم ${deliveryDate}. آخر موعد ${cutoff}`,
          });
      } catch (err) {
        logger.error({ err }, 'reminder failed');
      }
    },
  };
}

/** Collects notices instead of sending them (tests). */
export function captureNotifier() {
  const orders: OrderNotice[] = [];
  const reminders: { target: ReminderTarget; deliveryDate: string }[] = [];
  const notifier: Notifier = {
    order: async (n) => void orders.push(n),
    reminder: async (target, deliveryDate) => void reminders.push({ target, deliveryDate }),
  };
  return { notifier, orders, reminders };
}
