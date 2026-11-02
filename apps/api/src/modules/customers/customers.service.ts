import { and, asc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { branches, customerCategories, customers } from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

export type CategoryInput = { name: string; nameEn?: string | null; isActive?: boolean };

export type CustomerInput = {
  code?: string;
  name: string;
  nameEn?: string | null;
  categoryId?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
};
export type CustomerCreate = CustomerInput & { createMainBranch?: boolean };

export type BranchInput = {
  code?: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  deliveryNotes?: string | null;
  isActive?: boolean;
};

export type CustomerListQuery = {
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  page: number;
  pageSize: number;
};

export const MAIN_BRANCH_NAME = 'الفرع الرئيسي';

const normalizeCode = (code: string) => code.trim().toUpperCase();
const customerCodeFor = (n: number) => `C${String(n).padStart(4, '0')}`;
const branchCodeFor = (customerCode: string, n: number) =>
  `${customerCode}-${String(n).padStart(2, '0')}`;

/** Empty strings from forms are stored as NULL. */
function clean<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'string' && v.trim() === '' && k !== 'name' ? null : v;
  }
  return out as T;
}

const codeTaken = () => new AppError(409, 'CODE_TAKEN', 'الكود مستخدم مسبقاً');

export function createCustomersService(db: Db) {
  async function customerCodeExists(conn: Conn, code: string, exceptId?: string) {
    const row = await conn.query.customers.findFirst({
      columns: { id: true },
      where: exceptId
        ? and(eq(customers.code, code), ne(customers.id, exceptId))
        : eq(customers.code, code),
    });
    return Boolean(row);
  }

  async function branchCodeExists(conn: Conn, code: string, exceptId?: string) {
    const row = await conn.query.branches.findFirst({
      columns: { id: true },
      where: exceptId
        ? and(eq(branches.code, code), ne(branches.id, exceptId))
        : eq(branches.code, code),
    });
    return Boolean(row);
  }

  /** Next free automatic code. Skips numbers already taken by manually entered codes. */
  async function nextCustomerCode(tx: Tx) {
    for (;;) {
      const [row] = await tx.execute<{ n: string }>(sql`select nextval('customer_code_seq') as n`);
      const code = customerCodeFor(Number(row!.n));
      if (!(await customerCodeExists(tx, code))) return code;
    }
  }

  /** Locks the customer row and hands out the next branch number for it. */
  async function nextBranchCode(tx: Tx, customerId: string, customerCode: string) {
    for (;;) {
      const [row] = await tx
        .update(customers)
        .set({ branchSeq: sql`${customers.branchSeq} + 1` })
        .where(eq(customers.id, customerId))
        .returning({ n: customers.branchSeq });
      const code = branchCodeFor(customerCode, row!.n);
      if (!(await branchCodeExists(tx, code))) return code;
    }
  }

  async function assertCategory(conn: Conn, categoryId: string | null | undefined) {
    if (!categoryId) return;
    const cat = await conn.query.customerCategories.findFirst({
      where: eq(customerCategories.id, categoryId),
    });
    if (!cat) throw new AppError(400, 'BAD_CATEGORY', 'الفئة غير موجودة');
  }

  async function insertBranch(
    tx: Tx,
    customer: { id: string; code: string },
    input: BranchInput,
    ctx: AuditContext,
  ) {
    let code: string;
    if (input.code) {
      code = normalizeCode(input.code);
      if (await branchCodeExists(tx, code)) throw codeTaken();
    } else {
      code = await nextBranchCode(tx, customer.id, customer.code);
    }
    const [created] = await tx
      .insert(branches)
      .values({ ...clean(input), code, customerId: customer.id })
      .returning();
    await writeAudit(tx, ctx, {
      action: 'branch.create',
      entity: 'branch',
      entityId: created!.id,
      after: created,
    });
    return created!;
  }

  return {
    // ---------- categories ----------
    async listCategories() {
      return db.select().from(customerCategories).orderBy(asc(customerCategories.name));
    },

    async createCategory(input: CategoryInput, ctx: AuditContext) {
      const name = input.name.trim();
      const exists = await db.query.customerCategories.findFirst({
        where: eq(customerCategories.name, name),
      });
      if (exists) throw new AppError(409, 'NAME_TAKEN', 'اسم الفئة موجود مسبقاً');
      return db.transaction(async (tx) => {
        const [created] = await tx
          .insert(customerCategories)
          .values({ ...clean(input), name })
          .returning();
        await writeAudit(tx, ctx, {
          action: 'customer_category.create',
          entity: 'customer_category',
          entityId: created!.id,
          after: created,
        });
        return created!;
      });
    },

    async updateCategory(id: string, patch: Partial<CategoryInput>, ctx: AuditContext) {
      const before = await db.query.customerCategories.findFirst({
        where: eq(customerCategories.id, id),
      });
      if (!before) throw notFound('Category');
      const fields = clean(patch);
      if (fields.name) {
        fields.name = fields.name.trim();
        const clash = await db.query.customerCategories.findFirst({
          where: and(eq(customerCategories.name, fields.name), ne(customerCategories.id, id)),
        });
        if (clash) throw new AppError(409, 'NAME_TAKEN', 'اسم الفئة موجود مسبقاً');
      }
      return db.transaction(async (tx) => {
        const [after] = await tx
          .update(customerCategories)
          .set(fields)
          .where(eq(customerCategories.id, id))
          .returning();
        await writeAudit(tx, ctx, {
          action: 'customer_category.update',
          entity: 'customer_category',
          entityId: id,
          before,
          after,
        });
        return after!;
      });
    },

    // ---------- customers ----------
    async list(q: CustomerListQuery) {
      const filters: SQL[] = [];
      if (q.categoryId) filters.push(eq(customers.categoryId, q.categoryId));
      if (q.isActive !== undefined) filters.push(eq(customers.isActive, q.isActive));
      if (q.search) {
        const term = `%${q.search}%`;
        filters.push(
          or(
            ilike(customers.code, term),
            ilike(customers.name, term),
            ilike(customers.nameEn, term),
            ilike(customers.phone, term),
            ilike(customers.contactName, term),
          )!,
        );
      }
      const where = filters.length ? and(...filters) : undefined;
      const branchCount = sql<number>`(select count(*)::int from ${branches} where ${branches.customerId} = ${customers.id})`;
      const [rows, [total]] = await Promise.all([
        db
          .select({
            id: customers.id,
            code: customers.code,
            name: customers.name,
            nameEn: customers.nameEn,
            categoryId: customers.categoryId,
            categoryName: customerCategories.name,
            contactName: customers.contactName,
            phone: customers.phone,
            city: customers.city,
            isActive: customers.isActive,
            branchCount,
          })
          .from(customers)
          .leftJoin(customerCategories, eq(customerCategories.id, customers.categoryId))
          .where(where)
          .orderBy(asc(customers.code))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(customers)
          .where(where),
      ]);
      return { items: rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
    },

    async get(id: string) {
      const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });
      if (!customer) throw notFound('Customer');
      const [category, branchRows] = await Promise.all([
        customer.categoryId
          ? db.query.customerCategories.findFirst({
              where: eq(customerCategories.id, customer.categoryId),
            })
          : undefined,
        db.select().from(branches).where(eq(branches.customerId, id)).orderBy(asc(branches.code)),
      ]);
      return { ...customer, category: category ?? null, branches: branchRows };
    },

    async create(input: CustomerCreate, ctx: AuditContext) {
      const { createMainBranch = true, ...data } = input;
      await assertCategory(db, data.categoryId);
      return db.transaction(async (tx) => {
        let code: string;
        if (data.code) {
          code = normalizeCode(data.code);
          if (await customerCodeExists(tx, code)) throw codeTaken();
        } else {
          code = await nextCustomerCode(tx);
        }
        const [created] = await tx
          .insert(customers)
          .values({ ...clean(data), code, name: data.name.trim() })
          .returning();
        await writeAudit(tx, ctx, {
          action: 'customer.create',
          entity: 'customer',
          entityId: created!.id,
          after: created,
        });
        const createdBranches = createMainBranch
          ? [
              await insertBranch(
                tx,
                created!,
                {
                  name: MAIN_BRANCH_NAME,
                  contactName: data.contactName,
                  phone: data.phone,
                  city: data.city,
                  address: data.address,
                },
                ctx,
              ),
            ]
          : [];
        const [fresh] = await tx.select().from(customers).where(eq(customers.id, created!.id));
        return { ...fresh!, branches: createdBranches };
      });
    },

    async update(id: string, patch: Partial<CustomerInput>, ctx: AuditContext) {
      const before = await db.query.customers.findFirst({ where: eq(customers.id, id) });
      if (!before) throw notFound('Customer');
      const fields = clean(patch);
      if (fields.code) {
        fields.code = normalizeCode(fields.code);
        if (await customerCodeExists(db, fields.code, id)) throw codeTaken();
      }
      if (fields.name) fields.name = fields.name.trim();
      await assertCategory(db, fields.categoryId);
      return db.transaction(async (tx) => {
        const [after] = Object.keys(fields).length
          ? await tx.update(customers).set(fields).where(eq(customers.id, id)).returning()
          : [before];
        await writeAudit(tx, ctx, {
          action: 'customer.update',
          entity: 'customer',
          entityId: id,
          before,
          after,
        });
        return after!;
      });
    },

    // ---------- branches ----------
    async createBranch(customerId: string, input: BranchInput, ctx: AuditContext) {
      const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
      if (!customer) throw notFound('Customer');
      return db.transaction((tx) => insertBranch(tx, customer, input, ctx));
    },

    async updateBranch(
      customerId: string,
      branchId: string,
      patch: Partial<BranchInput>,
      ctx: AuditContext,
    ) {
      const before = await db.query.branches.findFirst({
        where: and(eq(branches.id, branchId), eq(branches.customerId, customerId)),
      });
      if (!before) throw notFound('Branch');
      const fields = clean(patch);
      if (fields.code) {
        fields.code = normalizeCode(fields.code);
        if (await branchCodeExists(db, fields.code, branchId)) throw codeTaken();
      }
      return db.transaction(async (tx) => {
        const [after] = Object.keys(fields).length
          ? await tx.update(branches).set(fields).where(eq(branches.id, branchId)).returning()
          : [before];
        await writeAudit(tx, ctx, {
          action: 'branch.update',
          entity: 'branch',
          entityId: branchId,
          before,
          after,
        });
        return after!;
      });
    },
  };
}

export type CustomersService = ReturnType<typeof createCustomersService>;
