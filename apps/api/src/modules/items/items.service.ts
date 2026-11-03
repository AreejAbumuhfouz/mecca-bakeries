import { and, asc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import type { ItemUnit } from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { itemSections, items } from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clean, type Conn, type Tx } from '../../lib/db-utils.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';
import type { FilesService } from '../files/files.service.js';

export type SectionInput = {
  name: string;
  nameEn?: string | null;
  sortOrder?: number;
  productionLineId?: string | null;
  isActive?: boolean;
};

export type ItemInput = {
  code?: string;
  name: string;
  nameEn?: string | null;
  sectionId: string;
  unit: ItemUnit;
  basePrice: number;
  imageFileId?: string | null;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type ItemListQuery = {
  search?: string;
  sectionId?: string;
  isActive?: boolean;
  page: number;
  pageSize: number;
};

const itemCodeFor = (n: number) => `I${String(n).padStart(4, '0')}`;
const codeTaken = () => new AppError(409, 'CODE_TAKEN', 'كود الصنف مستخدم مسبقاً');

export function createItemsService(db: Db, filesSvc: FilesService) {
  async function codeExists(conn: Conn, code: string, exceptId?: string) {
    const row = await conn.query.items.findFirst({
      columns: { id: true },
      where: and(eq(items.code, code), exceptId ? ne(items.id, exceptId) : undefined),
    });
    return Boolean(row);
  }

  async function nextCode(tx: Tx) {
    for (;;) {
      const [row] = await tx.execute<{ n: string }>(sql`select nextval('item_code_seq') as n`);
      const code = itemCodeFor(Number(row!.n));
      if (!(await codeExists(tx, code))) return code;
    }
  }

  async function assertSection(sectionId: string | undefined) {
    if (!sectionId) return;
    const s = await db.query.itemSections.findFirst({ where: eq(itemSections.id, sectionId) });
    if (!s) throw new AppError(400, 'BAD_SECTION', 'القسم غير موجود');
  }

  async function assertSectionName(name: string | undefined, exceptId?: string) {
    if (!name) return;
    const clash = await db.query.itemSections.findFirst({
      where: and(eq(itemSections.name, name), exceptId ? ne(itemSections.id, exceptId) : undefined),
    });
    if (clash) throw new AppError(409, 'NAME_TAKEN', 'اسم القسم موجود مسبقاً');
  }

  return {
    // ---------- sections ----------
    async listSections() {
      const itemCount = sql<number>`(select count(*)::int from items i where i.section_id = item_sections.id)`;
      const rows = await db
        .select({ section: itemSections, itemCount })
        .from(itemSections)
        .orderBy(asc(itemSections.sortOrder), asc(itemSections.name));
      return rows.map((r) => ({ ...r.section, itemCount: r.itemCount }));
    },

    async createSection(input: SectionInput, ctx: AuditContext) {
      const data = clean({ ...input, name: input.name.trim() });
      await assertSectionName(data.name);
      return db.transaction(async (tx) => {
        const [created] = await tx.insert(itemSections).values(data).returning();
        await writeAudit(tx, ctx, {
          action: 'item_section.create',
          entity: 'item_section',
          entityId: created!.id,
          after: created,
        });
        return created!;
      });
    },

    async updateSection(id: string, patch: Partial<SectionInput>, ctx: AuditContext) {
      const before = await db.query.itemSections.findFirst({ where: eq(itemSections.id, id) });
      if (!before) throw notFound('Section');
      const fields = clean(patch);
      if (fields.name) fields.name = fields.name.trim();
      await assertSectionName(fields.name, id);
      return db.transaction(async (tx) => {
        const [after] = await tx
          .update(itemSections)
          .set(fields)
          .where(eq(itemSections.id, id))
          .returning();
        await writeAudit(tx, ctx, {
          action: 'item_section.update',
          entity: 'item_section',
          entityId: id,
          before,
          after,
        });
        return after!;
      });
    },

    // ---------- items ----------
    async list(q: ItemListQuery) {
      const filters: SQL[] = [];
      if (q.sectionId) filters.push(eq(items.sectionId, q.sectionId));
      if (q.isActive !== undefined) filters.push(eq(items.isActive, q.isActive));
      if (q.search) {
        const term = `%${q.search}%`;
        filters.push(
          or(ilike(items.code, term), ilike(items.name, term), ilike(items.nameEn, term))!,
        );
      }
      const where = filters.length ? and(...filters) : undefined;
      const [rows, [total]] = await Promise.all([
        db
          .select({ item: items, sectionName: itemSections.name })
          .from(items)
          .innerJoin(itemSections, eq(itemSections.id, items.sectionId))
          .where(where)
          .orderBy(asc(itemSections.sortOrder), asc(items.sortOrder), asc(items.name))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(items)
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({ ...r.item, sectionName: r.sectionName })),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    async get(id: string) {
      const item = await db.query.items.findFirst({ where: eq(items.id, id) });
      if (!item) throw notFound('Item');
      return item;
    },

    async create(input: ItemInput, ctx: AuditContext) {
      const data = clean({ ...input, name: input.name.trim() });
      await assertSection(data.sectionId);
      await filesSvc.assertUsable(data.imageFileId, { image: true });
      return db.transaction(async (tx) => {
        let code: string;
        if (data.code) {
          code = data.code.trim().toUpperCase();
          if (await codeExists(tx, code)) throw codeTaken();
        } else {
          code = await nextCode(tx);
        }
        const [created] = await tx
          .insert(items)
          .values({ ...data, code })
          .returning();
        await writeAudit(tx, ctx, {
          action: 'item.create',
          entity: 'item',
          entityId: created!.id,
          after: created,
        });
        return created!;
      });
    },

    async update(id: string, patch: Partial<ItemInput>, ctx: AuditContext) {
      const before = await db.query.items.findFirst({ where: eq(items.id, id) });
      if (!before) throw notFound('Item');
      const fields = clean(patch);
      if (fields.name) fields.name = fields.name.trim();
      if (fields.code) {
        fields.code = fields.code.trim().toUpperCase();
        if (await codeExists(db, fields.code, id)) throw codeTaken();
      }
      await assertSection(fields.sectionId);
      await filesSvc.assertUsable(fields.imageFileId, { image: true });
      return db.transaction(async (tx) => {
        const [after] = Object.keys(fields).length
          ? await tx.update(items).set(fields).where(eq(items.id, id)).returning()
          : [before];
        await writeAudit(tx, ctx, {
          // A separate action name makes price changes easy to find in the audit log.
          action:
            fields.basePrice !== undefined && fields.basePrice !== before.basePrice
              ? 'item.price_change'
              : 'item.update',
          entity: 'item',
          entityId: id,
          before,
          after,
        });
        return after!;
      });
    },
  };
}

export type ItemsService = ReturnType<typeof createItemsService>;
