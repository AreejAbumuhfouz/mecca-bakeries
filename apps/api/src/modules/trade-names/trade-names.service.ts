import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { tradeNames } from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clean, type Tx } from '../../lib/db-utils.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';
import type { FilesService } from '../files/files.service.js';
import { t } from '../../lib/i18n.js';

export type TradeNameInput = {
  name: string;
  nameEn?: string | null;
  logoFileId?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  invoicePrefix: string;
  nextInvoiceNumber?: number;
  invoiceFooter?: string | null;
  isActive?: boolean;
};

/** Invoice number as printed: PREFIX-000123 */
export const formatInvoiceNumber = (prefix: string, n: number) =>
  `${prefix}-${String(n).padStart(6, '0')}`;

export function createTradeNamesService(db: Db, filesSvc: FilesService) {
  async function assertUnique(input: Partial<TradeNameInput>, exceptId?: string) {
    const notSelf = exceptId ? ne(tradeNames.id, exceptId) : undefined;
    if (input.name) {
      const clash = await db.query.tradeNames.findFirst({
        where: and(eq(tradeNames.name, input.name), notSelf),
      });
      if (clash) throw new AppError(409, 'NAME_TAKEN', t('الاسم التجاري موجود مسبقاً'));
    }
    if (input.invoicePrefix) {
      const clash = await db.query.tradeNames.findFirst({
        where: and(eq(tradeNames.invoicePrefix, input.invoicePrefix), notSelf),
      });
      if (clash)
        throw new AppError(409, 'PREFIX_TAKEN', t('بادئة الفواتير مستخدمة لاسم تجاري آخر'));
    }
  }

  return {
    async list() {
      // Written with explicit table names: Drizzle drops them on single-table selects.
      const customerCount = sql<number>`(select count(*)::int from customers c where c.trade_name_id = trade_names.id)`;
      const rows = await db
        .select({ tradeName: tradeNames, customerCount })
        .from(tradeNames)
        .orderBy(asc(tradeNames.name));
      return rows.map((r) => ({ ...r.tradeName, customerCount: r.customerCount }));
    },

    async get(id: string) {
      const row = await db.query.tradeNames.findFirst({ where: eq(tradeNames.id, id) });
      if (!row) throw notFound('Trade name');
      return row;
    },

    async create(input: TradeNameInput, ctx: AuditContext) {
      const data = clean({ ...input, invoicePrefix: input.invoicePrefix.toUpperCase() }, [
        'name',
        'invoicePrefix',
      ]);
      await assertUnique(data);
      await filesSvc.assertUsable(data.logoFileId, { image: true });
      return db.transaction(async (tx) => {
        const [created] = await tx.insert(tradeNames).values(data).returning();
        await writeAudit(tx, ctx, {
          action: 'trade_name.create',
          entity: 'trade_name',
          entityId: created!.id,
          after: created,
        });
        return created!;
      });
    },

    async update(id: string, patch: Partial<TradeNameInput>, ctx: AuditContext) {
      const before = await db.query.tradeNames.findFirst({ where: eq(tradeNames.id, id) });
      if (!before) throw notFound('Trade name');
      const fields = clean(
        patch.invoicePrefix
          ? { ...patch, invoicePrefix: patch.invoicePrefix.toUpperCase() }
          : patch,
        ['name', 'invoicePrefix'],
      );
      await assertUnique(fields, id);
      await filesSvc.assertUsable(fields.logoFileId, { image: true });
      if (
        fields.nextInvoiceNumber !== undefined &&
        fields.nextInvoiceNumber < before.nextInvoiceNumber
      )
        throw new AppError(
          409,
          'INVOICE_SEQUENCE_BACKWARDS',
          t(
            'لا يمكن إرجاع رقم الفاتورة التالي لأقل من {0} حتى لا تتكرر الأرقام',
            before.nextInvoiceNumber,
          ),
        );
      return db.transaction(async (tx) => {
        const [after] = Object.keys(fields).length
          ? await tx.update(tradeNames).set(fields).where(eq(tradeNames.id, id)).returning()
          : [before];
        await writeAudit(tx, ctx, {
          action: 'trade_name.update',
          entity: 'trade_name',
          entityId: id,
          before,
          after,
        });
        return after!;
      });
    },

    /**
     * Hands out the next invoice number for a trade name inside the caller's transaction.
     * The row update locks the trade name, so concurrent invoices never share a number.
     */
    async allocateInvoiceNumber(tx: Tx, tradeNameId: string) {
      const [row] = await tx
        .update(tradeNames)
        .set({ nextInvoiceNumber: sql`${tradeNames.nextInvoiceNumber} + 1` })
        .where(eq(tradeNames.id, tradeNameId))
        .returning({
          prefix: tradeNames.invoicePrefix,
          next: tradeNames.nextInvoiceNumber,
          isActive: tradeNames.isActive,
        });
      if (!row) throw notFound('Trade name');
      if (!row.isActive) throw new AppError(409, 'TRADE_NAME_INACTIVE', t('الاسم التجاري موقوف'));
      const number = row.next - 1;
      return { number, formatted: formatInvoiceNumber(row.prefix, number) };
    },
  };
}

export type TradeNamesService = ReturnType<typeof createTradeNamesService>;
