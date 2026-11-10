import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  addDays,
  ammanDate,
  contractState,
  type ContractState,
  type ContractStatus,
  type PaymentType,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import {
  contractAttachments,
  contractPrices,
  contracts,
  customers,
  files,
  itemSections,
  items,
} from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clean, type Tx } from '../../lib/db-utils.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';
import type { FilesService } from '../files/files.service.js';
import { effectivePrice, evaluateCredit, type OpenInvoice } from '../credit/credit-engine.js';
import { t } from '../../lib/i18n.js';

export type ContractTerms = {
  startDate: string;
  endDate: string;
  status?: ContractStatus;
  paymentType: PaymentType;
  creditLimit: number;
  paymentTermsDays: number;
  overdueGraceDays: number;
  discountBps: number;
  allowReturns: boolean;
  maxReturnBps: number;
  returnsNotes?: string | null;
  renewalAlertDays: number;
  notes?: string | null;
};
export type PriceInput = { itemId: string; price: number };
export type ContractCreate = ContractTerms & { customerId: string; prices?: PriceInput[] };

export type ContractListQuery = {
  search?: string;
  customerId?: string;
  state?: ContractState;
  page: number;
  pageSize: number;
};

/**
 * Supplies a customer's unpaid invoices to the credit engine.
 * Invoicing is built in a later phase; until then every customer has no open invoices.
 */
export type OpenInvoicesProvider = (customerId: string) => Promise<OpenInvoice[]>;
export const noOpenInvoices: OpenInvoicesProvider = async () => [];

type ContractRow = typeof contracts.$inferSelect;

const contractNumberFor = (n: number) => `CT-${String(n).padStart(4, '0')}`;

export function createContractsService(deps: {
  db: Db;
  files: FilesService;
  openInvoices?: OpenInvoicesProvider;
  now?: () => Date;
}) {
  const { db } = deps;
  const openInvoices = deps.openInvoices ?? noOpenInvoices;
  const today = () => ammanDate(deps.now?.() ?? new Date());
  const withState = <T extends ContractRow>(c: T) => ({ ...c, state: contractState(c, today()) });

  function assertDates(startDate: string, endDate: string) {
    if (endDate < startDate)
      throw new AppError(400, 'BAD_DATES', t('تاريخ نهاية العقد قبل تاريخ بدايته'));
  }

  /** A customer may not have two non-terminated contracts covering the same day. */
  async function assertNoOverlap(
    conn: Db | Tx,
    customerId: string,
    startDate: string,
    endDate: string,
    exceptId?: string,
  ) {
    const clash = await conn.query.contracts.findFirst({
      where: and(
        eq(contracts.customerId, customerId),
        ne(contracts.status, 'terminated'),
        lte(contracts.startDate, endDate),
        gte(contracts.endDate, startDate),
        exceptId ? ne(contracts.id, exceptId) : undefined,
      ),
    });
    if (clash)
      throw new AppError(
        409,
        'CONTRACT_OVERLAP',
        t(
          'يوجد عقد آخر لهذا العميل في نفس الفترة ({0}: {1} إلى {2})',
          clash.number,
          clash.startDate,
          clash.endDate,
        ),
      );
  }

  async function assertItems(prices: PriceInput[]) {
    const ids = [...new Set(prices.map((p) => p.itemId))];
    if (ids.length !== prices.length)
      throw new AppError(400, 'DUPLICATE_ITEM', t('الصنف مكرر في قائمة الأسعار'));
    if (!ids.length) return;
    const found = await db.select({ id: items.id }).from(items).where(inArray(items.id, ids));
    if (found.length !== ids.length) throw new AppError(400, 'BAD_ITEM', t('صنف غير موجود'));
  }

  async function nextNumber(tx: Tx) {
    const [row] = await tx.execute<{ n: string }>(sql`select nextval('contract_number_seq') as n`);
    return contractNumberFor(Number(row!.n));
  }

  async function loadPrices(contractId: string) {
    return db
      .select({
        itemId: contractPrices.itemId,
        price: contractPrices.price,
        code: items.code,
        name: items.name,
        unit: items.unit,
        basePrice: items.basePrice,
      })
      .from(contractPrices)
      .innerJoin(items, eq(items.id, contractPrices.itemId))
      .where(eq(contractPrices.contractId, contractId))
      .orderBy(asc(items.code));
  }

  async function insertContract(tx: Tx, input: ContractCreate, ctx: AuditContext, action: string) {
    const { prices = [], ...terms } = input;
    const [created] = await tx
      .insert(contracts)
      .values({ ...clean(terms), number: await nextNumber(tx) })
      .returning();
    if (prices.length)
      await tx
        .insert(contractPrices)
        .values(prices.map((p) => ({ ...p, contractId: created!.id })));
    await writeAudit(tx, ctx, {
      action,
      entity: 'contract',
      entityId: created!.id,
      after: { ...created, prices },
    });
    return created!;
  }

  /** The contract that applies on a day, else the latest non-terminated one (to explain why not). */
  async function currentContract(customerId: string) {
    const day = today();
    const inForce = await db.query.contracts.findFirst({
      where: and(
        eq(contracts.customerId, customerId),
        ne(contracts.status, 'terminated'),
        lte(contracts.startDate, day),
        gte(contracts.endDate, day),
      ),
    });
    if (inForce) return inForce;
    return db.query.contracts.findFirst({
      where: and(eq(contracts.customerId, customerId), ne(contracts.status, 'terminated')),
      orderBy: [desc(contracts.endDate)],
    });
  }

  return {
    today,

    async list(q: ContractListQuery) {
      const day = today();
      const filters: SQL[] = [];
      if (q.customerId) filters.push(eq(contracts.customerId, q.customerId));
      if (q.search) {
        const term = `%${q.search}%`;
        filters.push(
          or(
            ilike(contracts.number, term),
            ilike(customers.name, term),
            ilike(customers.code, term),
          )!,
        );
      }
      const live = and(ne(contracts.status, 'terminated'), ne(contracts.status, 'suspended'));
      const alertFrom = sql`(${contracts.endDate} - ${contracts.renewalAlertDays})`;
      switch (q.state) {
        case 'terminated':
        case 'suspended':
          filters.push(eq(contracts.status, q.state));
          break;
        case 'not_started':
          filters.push(and(live, sql`${contracts.startDate} > ${day}`)!);
          break;
        case 'expired':
          filters.push(and(live, lt(contracts.endDate, day))!);
          break;
        case 'expiring':
          filters.push(
            and(
              live,
              lte(contracts.startDate, day),
              gte(contracts.endDate, day),
              sql`${alertFrom} <= ${day}::date`,
            )!,
          );
          break;
        case 'active':
          filters.push(and(live, lte(contracts.startDate, day), sql`${alertFrom} > ${day}::date`)!);
          break;
      }
      const where = filters.length ? and(...filters) : undefined;
      const [rows, [total]] = await Promise.all([
        db
          .select({
            contract: contracts,
            customerName: customers.name,
            customerCode: customers.code,
          })
          .from(contracts)
          .innerJoin(customers, eq(customers.id, contracts.customerId))
          .where(where)
          .orderBy(asc(contracts.endDate))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(contracts)
          .innerJoin(customers, eq(customers.id, contracts.customerId))
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({
          ...withState(r.contract),
          customerName: r.customerName,
          customerCode: r.customerCode,
        })),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    async get(id: string) {
      const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
      if (!contract) throw notFound('Contract');
      const [customer, prices, attachments] = await Promise.all([
        db.query.customers.findFirst({
          where: eq(customers.id, contract.customerId),
          columns: { id: true, code: true, name: true, tradeNameId: true },
        }),
        loadPrices(id),
        db
          .select({
            id: contractAttachments.id,
            label: contractAttachments.label,
            createdAt: contractAttachments.createdAt,
            fileId: files.id,
            fileName: files.originalName,
            mimeType: files.mimeType,
            size: files.size,
          })
          .from(contractAttachments)
          .innerJoin(files, eq(files.id, contractAttachments.fileId))
          .where(eq(contractAttachments.contractId, id))
          .orderBy(asc(contractAttachments.createdAt)),
      ]);
      return { ...withState(contract), customer: customer!, prices, attachments };
    },

    async create(input: ContractCreate, ctx: AuditContext) {
      assertDates(input.startDate, input.endDate);
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, input.customerId),
      });
      if (!customer) throw new AppError(400, 'BAD_CUSTOMER', t('العميل غير موجود'));
      await assertItems(input.prices ?? []);
      return db.transaction(async (tx) => {
        // Lock the customer row so two simultaneous creates cannot both pass the overlap check.
        await tx.execute(sql`select id from customers where id = ${input.customerId} for update`);
        await assertNoOverlap(tx, input.customerId, input.startDate, input.endDate);
        return withState(await insertContract(tx, input, ctx, 'contract.create'));
      });
    },

    async update(id: string, patch: Partial<ContractTerms>, ctx: AuditContext) {
      const before = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
      if (!before) throw notFound('Contract');
      if (before.status === 'terminated')
        throw new AppError(409, 'CONTRACT_TERMINATED', t('لا يمكن تعديل عقد ملغى'));
      const fields = clean(patch);
      const startDate = fields.startDate ?? before.startDate;
      const endDate = fields.endDate ?? before.endDate;
      assertDates(startDate, endDate);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select id from customers where id = ${before.customerId} for update`);
        if (fields.status !== 'terminated')
          await assertNoOverlap(tx, before.customerId, startDate, endDate, id);
        const [after] = await tx
          .update(contracts)
          .set(fields)
          .where(eq(contracts.id, id))
          .returning();
        await writeAudit(tx, ctx, {
          action:
            fields.status && fields.status !== before.status
              ? `contract.${fields.status === 'active' ? 'reactivate' : fields.status}`
              : 'contract.update',
          entity: 'contract',
          entityId: id,
          before,
          after,
        });
        return withState(after!);
      });
    },

    /** Replaces the whole special-price list of a contract. */
    async setPrices(id: string, prices: PriceInput[], ctx: AuditContext) {
      const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
      if (!contract) throw notFound('Contract');
      await assertItems(prices);
      const before = await db
        .select({ itemId: contractPrices.itemId, price: contractPrices.price })
        .from(contractPrices)
        .where(eq(contractPrices.contractId, id));
      await db.transaction(async (tx) => {
        await tx.delete(contractPrices).where(eq(contractPrices.contractId, id));
        if (prices.length)
          await tx.insert(contractPrices).values(prices.map((p) => ({ ...p, contractId: id })));
        await writeAudit(tx, ctx, {
          action: 'contract.prices',
          entity: 'contract',
          entityId: id,
          before: { prices: before },
          after: { prices },
        });
      });
      return loadPrices(id);
    },

    /** Every active item with the price this contract gives (what the restaurant app will show). */
    async priceList(id: string) {
      const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
      if (!contract) throw notFound('Contract');
      const special = new Map(
        (
          await db
            .select({ itemId: contractPrices.itemId, price: contractPrices.price })
            .from(contractPrices)
            .where(eq(contractPrices.contractId, id))
        ).map((p) => [p.itemId, p.price]),
      );
      const rows = await db
        .select({
          id: items.id,
          code: items.code,
          name: items.name,
          unit: items.unit,
          basePrice: items.basePrice,
          sectionName: itemSections.name,
        })
        .from(items)
        .innerJoin(itemSections, eq(itemSections.id, items.sectionId))
        .where(and(eq(items.isActive, true), eq(itemSections.isActive, true)))
        .orderBy(asc(itemSections.sortOrder), asc(items.sortOrder), asc(items.name));
      return rows.map((r) => ({
        ...r,
        ...effectivePrice(r.basePrice, special.get(r.id), contract.discountBps),
      }));
    },

    async addAttachment(id: string, input: { fileId: string; label: string }, ctx: AuditContext) {
      const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
      if (!contract) throw notFound('Contract');
      await deps.files.assertUsable(input.fileId);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(contractAttachments)
          .values({ contractId: id, ...input })
          .returning();
        await writeAudit(tx, ctx, {
          action: 'contract.attachment_add',
          entity: 'contract',
          entityId: id,
          after: row,
        });
        return row!;
      });
    },

    async removeAttachment(id: string, attachmentId: string, ctx: AuditContext) {
      const row = await db.query.contractAttachments.findFirst({
        where: and(
          eq(contractAttachments.id, attachmentId),
          eq(contractAttachments.contractId, id),
        ),
      });
      if (!row) throw notFound('Attachment');
      await db.transaction(async (tx) => {
        await tx.delete(contractAttachments).where(eq(contractAttachments.id, attachmentId));
        await writeAudit(tx, ctx, {
          action: 'contract.attachment_remove',
          entity: 'contract',
          entityId: id,
          before: row,
        });
      });
    },

    /** New contract with the same terms and prices, starting the day after the old one ends. */
    async renew(id: string, input: { startDate?: string; endDate: string }, ctx: AuditContext) {
      const old = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
      if (!old) throw notFound('Contract');
      if (old.status === 'terminated')
        throw new AppError(409, 'CONTRACT_TERMINATED', t('لا يمكن تجديد عقد ملغى'));
      const startDate = input.startDate ?? addDays(old.endDate, 1);
      assertDates(startDate, input.endDate);
      const prices = await db
        .select({ itemId: contractPrices.itemId, price: contractPrices.price })
        .from(contractPrices)
        .where(eq(contractPrices.contractId, id));
      return db.transaction(async (tx) => {
        await tx.execute(sql`select id from customers where id = ${old.customerId} for update`);
        await assertNoOverlap(tx, old.customerId, startDate, input.endDate);
        const created = await insertContract(
          tx,
          {
            customerId: old.customerId,
            startDate,
            endDate: input.endDate,
            paymentType: old.paymentType,
            creditLimit: old.creditLimit,
            paymentTermsDays: old.paymentTermsDays,
            overdueGraceDays: old.overdueGraceDays,
            discountBps: old.discountBps,
            allowReturns: old.allowReturns,
            maxReturnBps: old.maxReturnBps,
            returnsNotes: old.returnsNotes,
            renewalAlertDays: old.renewalAlertDays,
            notes: old.notes,
            prices,
          },
          ctx,
          'contract.renew',
        );
        const [linked] = await tx
          .update(contracts)
          .set({ renewedFromId: id })
          .where(eq(contracts.id, created.id))
          .returning();
        return withState(linked!);
      });
    },

    /** Credit decision for a customer and an order amount (0 = status only). */
    async creditCheck(customerId: string, orderAmount: number) {
      const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
      if (!customer) throw notFound('Customer');
      const contract = await currentContract(customerId);
      const decision = evaluateCredit({
        today: today(),
        contract: contract ?? null,
        openInvoices: await openInvoices(customerId),
        orderAmount,
      });
      return {
        ...decision,
        contract: contract
          ? { id: contract.id, number: contract.number, endDate: contract.endDate }
          : null,
      };
    },

    /** Contracts that end within their alert window, plus ones that already ended (not renewed). */
    async renewalAlerts() {
      const day = today();
      const rows = await db
        .select({ contract: contracts, customerName: customers.name, customerCode: customers.code })
        .from(contracts)
        .innerJoin(customers, eq(customers.id, contracts.customerId))
        .where(
          and(
            eq(contracts.status, 'active'),
            sql`(${contracts.endDate} - ${contracts.renewalAlertDays}) <= ${day}::date`,
            // Skip contracts that already have a later contract for the same customer.
            sql`not exists (select 1 from contracts n where n.customer_id = ${contracts.customerId}
                 and n.status <> 'terminated' and n.start_date > ${contracts.endDate})`,
            // Customers that stopped long ago are not an alert any more.
            sql`${contracts.endDate} >= (${day}::date - 60)`,
          ),
        )
        .orderBy(asc(contracts.endDate));
      return rows.map((r) => ({
        ...withState(r.contract),
        customerName: r.customerName,
        customerCode: r.customerCode,
      }));
    },
  };
}

export type ContractsService = ReturnType<typeof createContractsService>;
