import { and, asc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { ROLES, type Permission, type Role } from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { userPermissionOverrides, users } from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';

export type UserInput = {
  email: string;
  name: string;
  phone?: string | null;
  role: Role;
  isActive?: boolean;
};
export type UserPatch = Partial<UserInput> & {
  overrides?: { permission: Permission; allowed: boolean }[];
};
export type UserListQuery = { search?: string; role?: Role; page: number; pageSize: number };

type UserRow = typeof users.$inferSelect;
const publicUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  role: u.role,
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});
export type PublicUser = ReturnType<typeof publicUser>;

export function createUsersService(db: Db) {
  async function getOverrides(userId: string) {
    return db
      .select({
        permission: userPermissionOverrides.permission,
        allowed: userPermissionOverrides.allowed,
      })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId));
  }

  /** Prevents locking everyone out: at least one active super admin must remain. */
  async function assertNotLastSuperAdmin(userId: string) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(eq(users.role, ROLES.SUPER_ADMIN), eq(users.isActive, true), ne(users.id, userId)),
      );
    if ((row?.n ?? 0) === 0)
      throw new AppError(409, 'LAST_SUPER_ADMIN', 'لا يمكن تعطيل أو تغيير دور آخر مدير للنظام');
  }

  return {
    async list(q: UserListQuery) {
      const filters: SQL[] = [];
      if (q.role) filters.push(eq(users.role, q.role));
      if (q.search) {
        const term = `%${q.search}%`;
        filters.push(
          or(ilike(users.name, term), ilike(users.email, term), ilike(users.phone, term))!,
        );
      }
      const where = filters.length ? and(...filters) : undefined;
      const [rows, [total]] = await Promise.all([
        db
          .select()
          .from(users)
          .where(where)
          .orderBy(asc(users.name))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(where),
      ]);
      return {
        items: rows.map(publicUser),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    async get(id: string) {
      const user = await db.query.users.findFirst({ where: eq(users.id, id) });
      if (!user) throw notFound('User');
      return { ...publicUser(user), overrides: await getOverrides(id) };
    },

    async create(input: UserInput, ctx: AuditContext) {
      const email = input.email.trim().toLowerCase();
      const exists = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (exists) throw new AppError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مستخدم مسبقاً');
      return db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({ ...input, email, phone: input.phone ?? null })
          .returning();
        await writeAudit(tx, ctx, {
          action: 'user.create',
          entity: 'user',
          entityId: created!.id,
          after: publicUser(created!),
        });
        return publicUser(created!);
      });
    },

    async update(id: string, patch: UserPatch, ctx: AuditContext) {
      const before = await db.query.users.findFirst({ where: eq(users.id, id) });
      if (!before) throw notFound('User');
      const losingAdmin =
        before.role === ROLES.SUPER_ADMIN &&
        ((patch.role && patch.role !== ROLES.SUPER_ADMIN) || patch.isActive === false);
      if (losingAdmin) await assertNotLastSuperAdmin(id);

      const { overrides, ...fields } = patch;
      if (fields.email) {
        fields.email = fields.email.trim().toLowerCase();
        const clash = await db.query.users.findFirst({
          where: and(eq(users.email, fields.email), ne(users.id, id)),
        });
        if (clash) throw new AppError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مستخدم مسبقاً');
      }
      const beforeOverrides = await getOverrides(id);

      return db.transaction(async (tx) => {
        const [after] = Object.keys(fields).length
          ? await tx.update(users).set(fields).where(eq(users.id, id)).returning()
          : [before];
        if (overrides) {
          await tx.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, id));
          if (overrides.length)
            await tx
              .insert(userPermissionOverrides)
              .values(overrides.map((o) => ({ userId: id, ...o })));
        }
        await writeAudit(tx, ctx, {
          action: 'user.update',
          entity: 'user',
          entityId: id,
          before: { ...publicUser(before), overrides: beforeOverrides },
          after: { ...publicUser(after!), overrides: overrides ?? beforeOverrides },
        });
        return { ...publicUser(after!), overrides: overrides ?? beforeOverrides };
      });
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
