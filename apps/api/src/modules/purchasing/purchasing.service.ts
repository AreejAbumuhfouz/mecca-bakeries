import { readFile } from 'node:fs/promises';
import { and, asc, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { PURCHASE_ORDER_TRANSITIONS, type AuthUser, type PurchaseOrderStatus } from '@mecca/shared';
import type { Db } from '../../db/client.js';
import {
  files,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  tradeNames,
  users,
  whatsappMessages,
} from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clean, type Tx } from '../../lib/db-utils.js';
import type { PdfRenderer } from '../../lib/pdf.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';
import type { FilesService } from '../files/files.service.js';
import type { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { normalizePhone } from '../whatsapp/templates.js';
import { purchaseOrderHtml } from './purchase-order-pdf.js';
import { t, withLocale } from '../../lib/i18n.js';

export type SupplierInput = {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  whatsappPhone?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
};
export type PoLineInput = {
  description: string;
  quantity: number;
  unit: string;
  note?: string | null;
};
export type PoInput = {
  supplierId: string;
  neededDate?: string | null;
  notes?: string | null;
  lines: PoLineInput[];
};

const poNumberFor = (n: number) => `PO-${String(n).padStart(4, '0')}`;

export function createPurchasingService(deps: {
  db: Db;
  whatsapp: WhatsAppService;
  files: FilesService;
  pdf: PdfRenderer;
}) {
  const { db, whatsapp } = deps;

  async function getRow(id: string) {
    const po = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id) });
    if (!po) throw notFound('Purchase order');
    return po;
  }

  async function writeLines(tx: Tx, poId: string, lines: PoLineInput[]) {
    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, poId));
    await tx.insert(purchaseOrderLines).values(
      lines.map((l, i) => ({
        purchaseOrderId: poId,
        position: i + 1,
        description: l.description.trim(),
        quantity: String(l.quantity),
        unit: l.unit.trim(),
        note: l.note?.trim() || null,
      })),
    );
  }

  async function assertSupplier(id: string) {
    const s = await db.query.suppliers.findFirst({ where: eq(suppliers.id, id) });
    if (!s) throw new AppError(400, 'BAD_SUPPLIER', t('المورد غير موجود'));
    if (!s.isActive) throw new AppError(409, 'SUPPLIER_INACTIVE', t('المورد موقوف'));
    return s;
  }

  /** Bakery header for the PDF: the first active trade name (with its logo). */
  async function bakeryHeader() {
    const tn = await db.query.tradeNames.findFirst({
      where: eq(tradeNames.isActive, true),
      orderBy: [asc(tradeNames.createdAt)],
    });
    let logoDataUrl: string | null = null;
    if (tn?.logoFileId) {
      const f = await db.query.files.findFirst({ where: eq(files.id, tn.logoFileId) });
      if (f) {
        const bytes = await readFile((await deps.files.get(f.id)).absolutePath).catch(() => null);
        if (bytes) logoDataUrl = `data:${f.mimeType};base64,${bytes.toString('base64')}`;
      }
    }
    return {
      name: tn?.name ?? t('مخابز مكة'),
      phone: tn?.phone ?? null,
      address: tn?.address ?? null,
      logoDataUrl,
    };
  }

  return {
    // ------------------------------------------------------------ suppliers
    async listSuppliers(q: { search?: string; isActive?: boolean }) {
      const filters: SQL[] = [];
      if (q.isActive !== undefined) filters.push(eq(suppliers.isActive, q.isActive));
      if (q.search) {
        const term = `%${q.search}%`;
        filters.push(
          or(
            ilike(suppliers.name, term),
            ilike(suppliers.phone, term),
            ilike(suppliers.contactName, term),
          )!,
        );
      }
      const orderCount = sql<number>`(select count(*)::int from purchase_orders p where p.supplier_id = suppliers.id)`;
      const rows = await db
        .select({ supplier: suppliers, orderCount })
        .from(suppliers)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(suppliers.name));
      return rows.map((r) => ({ ...r.supplier, orderCount: r.orderCount }));
    },

    async saveSupplier(id: string | null, input: Partial<SupplierInput>, ctx: AuditContext) {
      const data = clean(input);
      if (data.name) {
        data.name = data.name.trim();
        const clash = await db.query.suppliers.findFirst({
          where: and(eq(suppliers.name, data.name), id ? ne(suppliers.id, id) : undefined),
        });
        if (clash) throw new AppError(409, 'NAME_TAKEN', t('اسم المورد موجود مسبقاً'));
      }
      return db.transaction(async (tx) => {
        const before = id
          ? await tx.query.suppliers.findFirst({ where: eq(suppliers.id, id) })
          : null;
        if (id && !before) throw notFound('Supplier');
        const [row] = id
          ? await tx.update(suppliers).set(data).where(eq(suppliers.id, id)).returning()
          : await tx
              .insert(suppliers)
              .values({ name: data.name!, ...data })
              .returning();
        await writeAudit(tx, ctx, {
          action: id ? 'supplier.update' : 'supplier.create',
          entity: 'supplier',
          entityId: row!.id,
          before,
          after: row,
        });
        return row!;
      });
    },

    // ------------------------------------------------------------ purchase orders
    async list(q: {
      status?: PurchaseOrderStatus;
      supplierId?: string;
      search?: string;
      page: number;
      pageSize: number;
    }) {
      const filters: SQL[] = [];
      if (q.status) filters.push(eq(purchaseOrders.status, q.status));
      if (q.supplierId) filters.push(eq(purchaseOrders.supplierId, q.supplierId));
      if (q.search) {
        const term = `%${q.search}%`;
        filters.push(or(ilike(purchaseOrders.number, term), ilike(suppliers.name, term))!);
      }
      const where = filters.length ? and(...filters) : undefined;
      const lineCount = sql<number>`(select count(*)::int from purchase_order_lines l where l.purchase_order_id = purchase_orders.id)`;
      const [rows, [total]] = await Promise.all([
        db
          .select({ po: purchaseOrders, supplierName: suppliers.name, lineCount })
          .from(purchaseOrders)
          .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
          .where(where)
          .orderBy(desc(purchaseOrders.createdAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(purchaseOrders)
          .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({ ...r.po, supplierName: r.supplierName, lineCount: r.lineCount })),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    async get(id: string) {
      const po = await getRow(id);
      const [supplier, lines, creator, messages] = await Promise.all([
        db.query.suppliers.findFirst({ where: eq(suppliers.id, po.supplierId) }),
        db
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, id))
          .orderBy(asc(purchaseOrderLines.position)),
        po.createdBy
          ? db.query.users.findFirst({ where: eq(users.id, po.createdBy), columns: { name: true } })
          : null,
        db
          .select({
            id: whatsappMessages.id,
            status: whatsappMessages.status,
            error: whatsappMessages.error,
            createdAt: whatsappMessages.createdAt,
            phone: whatsappMessages.phone,
          })
          .from(whatsappMessages)
          .where(
            and(
              eq(whatsappMessages.template, 'mb_purchase_order'),
              sql`${whatsappMessages.body} like ${`%${po.number}%`}`,
            ),
          )
          .orderBy(desc(whatsappMessages.createdAt)),
      ]);
      return { ...po, supplier: supplier!, lines, createdByName: creator?.name ?? null, messages };
    },

    async create(input: PoInput, actor: AuthUser, ctx: AuditContext) {
      await assertSupplier(input.supplierId);
      const created = await db.transaction(async (tx) => {
        const [n] = await tx.execute<{ n: string }>(
          sql`select nextval('purchase_order_number_seq') as n`,
        );
        const [po] = await tx
          .insert(purchaseOrders)
          .values({
            number: poNumberFor(Number(n!.n)),
            supplierId: input.supplierId,
            neededDate: input.neededDate ?? null,
            notes: input.notes?.trim() || null,
            createdBy: actor.id,
          })
          .returning();
        await writeLines(tx, po!.id, input.lines);
        await writeAudit(tx, ctx, {
          action: 'purchase_order.create',
          entity: 'purchase_order',
          entityId: po!.id,
          after: { ...po, lines: input.lines },
        });
        return po!;
      });
      return this.get(created.id);
    },

    /** Editing is allowed while the order is a draft. */
    async update(id: string, input: Partial<PoInput>, ctx: AuditContext) {
      const before = await getRow(id);
      if (before.status !== 'draft')
        throw new AppError(
          409,
          'PO_LOCKED',
          t('لا يمكن تعديل طلب الشراء بعد إرساله — ألغِه وأنشئ طلباً جديداً'),
        );
      if (input.supplierId) await assertSupplier(input.supplierId);
      const beforeLines = await db
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, id));
      await db.transaction(async (tx) => {
        const { lines, ...fields } = input;
        const set = clean(fields, []);
        if (Object.keys(set).length)
          await tx.update(purchaseOrders).set(set).where(eq(purchaseOrders.id, id));
        if (lines) await writeLines(tx, id, lines);
        await writeAudit(tx, ctx, {
          action: 'purchase_order.update',
          entity: 'purchase_order',
          entityId: id,
          before: { ...before, lines: beforeLines },
          after: input,
        });
      });
      return this.get(id);
    },

    async setStatus(id: string, status: PurchaseOrderStatus, ctx: AuditContext) {
      const before = await getRow(id);
      if (!PURCHASE_ORDER_TRANSITIONS[before.status].includes(status))
        throw new AppError(409, 'BAD_TRANSITION', t('لا يمكن تغيير حالة الطلب بهذا الشكل'));
      await db.transaction(async (tx) => {
        const [after] = await tx
          .update(purchaseOrders)
          .set({ status })
          .where(eq(purchaseOrders.id, id))
          .returning();
        await writeAudit(tx, ctx, {
          action: `purchase_order.${status}`,
          entity: 'purchase_order',
          entityId: id,
          before,
          after,
        });
      });
      return this.get(id);
    },

    async pdf(id: string) {
      const po = await this.get(id);
      const bytes = await deps.pdf(
        purchaseOrderHtml({
          number: po.number,
          createdAt: po.createdAt,
          neededDate: po.neededDate,
          notes: po.notes,
          supplier: po.supplier,
          bakery: await bakeryHeader(),
          lines: po.lines,
        }),
      );
      return { bytes, filename: `${po.number}.pdf` };
    },

    /** Sends the PDF to the supplier's WhatsApp; a draft becomes "sent". Can be re-sent. */
    async send(id: string, actor: AuthUser, ctx: AuditContext) {
      const po = await this.get(id);
      if (!['draft', 'sent', 'confirmed'].includes(po.status))
        throw new AppError(409, 'PO_CLOSED', t('الطلب مستلم أو ملغى'));
      const phone = normalizePhone(po.supplier.whatsappPhone ?? po.supplier.phone);
      if (!phone) throw new AppError(400, 'NO_PHONE', t('لا يوجد رقم واتساب صحيح للمورد'));
      // The supplier gets the Arabic PDF and template, whatever language the sender uses.
      const message = await withLocale('ar', async () => {
        const { bytes, filename } = await this.pdf(id);
        return whatsapp.sendDocumentTemplate(
          phone,
          'mb_purchase_order',
          [po.number, po.neededDate ?? t('أقرب وقت')],
          { buffer: bytes, mimeType: 'application/pdf', filename },
          { sentBy: actor.id },
        );
      });
      if (!message || message.status === 'failed')
        throw new AppError(
          502,
          'SEND_FAILED',
          t('تعذّر الإرسال عبر واتساب{0}', message?.error ? `: ${message.error}` : ''),
        );
      await db.transaction(async (tx) => {
        await tx
          .update(purchaseOrders)
          .set({
            status: po.status === 'draft' ? 'sent' : po.status,
            sentAt: new Date(),
            lastMessageId: message.id,
          })
          .where(eq(purchaseOrders.id, id));
        await writeAudit(tx, ctx, {
          action: 'purchase_order.send',
          entity: 'purchase_order',
          entityId: id,
          after: { to: phone, messageStatus: message.status },
        });
      });
      return { ...(await this.get(id)), delivered: message.status !== 'skipped' };
    },
  };
}

export type PurchasingService = ReturnType<typeof createPurchasingService>;
