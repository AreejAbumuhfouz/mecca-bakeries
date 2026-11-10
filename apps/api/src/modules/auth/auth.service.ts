import { and, count, eq, gt, isNull } from 'drizzle-orm';
import {
  effectivePermissions,
  isPermission,
  type AuthUser,
  type Locale,
  type LoginResult,
  type PermissionOverride,
} from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { otpCodes, sessions, userPermissionOverrides, users } from '../../db/schema/index.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { generateOtp, generateToken, hmac, safeEqual } from '../../lib/crypto.js';
import type { Mailer } from '../../lib/mailer.js';
import { writeAudit, type AuditContext } from '../audit/audit.service.js';
import type { GoogleVerifier } from './google.js';
import type { TokenService } from './tokens.js';
import { t } from '../../lib/i18n.js';

export type AuthDeps = {
  db: Db;
  env: Pick<
    Env,
    | 'OTP_PEPPER'
    | 'OTP_TTL_MIN'
    | 'OTP_MAX_ATTEMPTS'
    | 'OTP_MAX_PER_WINDOW'
    | 'OTP_WINDOW_MIN'
    | 'REFRESH_TOKEN_TTL_DAYS'
  > &
    Partial<Pick<Env, 'STORE_REVIEW_EMAIL' | 'STORE_REVIEW_CODE'>>;
  mailer: Mailer;
  tokens: TokenService;
  google: GoogleVerifier | null;
  now?: () => Date;
};

type ClientInfo = { ip?: string | null; userAgent?: string | null };

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const minutes = (n: number) => n * 60_000;

const invalidCode = () => new AppError(401, 'INVALID_CODE', t('الرمز غير صحيح أو منتهي الصلاحية'));

export function createAuthService(deps: AuthDeps) {
  const { db, env, mailer, tokens } = deps;
  const now = deps.now ?? (() => new Date());

  async function loadAuthUser(userId: string): Promise<AuthUser | null> {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user || !user.isActive) return null;
    const rows = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId));
    const overrides: PermissionOverride[] = rows
      .filter((r) => isPermission(r.permission))
      .map((r) => ({
        permission: r.permission as PermissionOverride['permission'],
        allowed: r.allowed,
      }));
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      customerId: user.customerId,
      permissions: [...effectivePermissions(user.role, overrides)].sort(),
      locale: user.locale,
    };
  }

  async function issueSession(userId: string, client: ClientInfo): Promise<LoginResult> {
    const user = await loadAuthUser(userId);
    if (!user) throw new AppError(403, 'ACCOUNT_DISABLED', t('الحساب غير مفعّل'));
    const refreshToken = generateToken();
    await db.insert(sessions).values({
      userId,
      tokenHash: hmac(refreshToken, env.OTP_PEPPER),
      ip: client.ip ?? null,
      userAgent: client.userAgent ?? null,
      expiresAt: new Date(now().getTime() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    });
    await db.update(users).set({ lastLoginAt: now() }).where(eq(users.id, userId));
    const accessToken = await tokens.signAccess({ sub: user.id, role: user.role });
    return { accessToken, refreshToken, expiresIn: tokens.accessTtlSeconds, user };
  }

  return {
    loadAuthUser,

    /** Saves the user's interface language. */
    async setLocale(userId: string, locale: Locale) {
      await db.update(users).set({ locale, updatedAt: now() }).where(eq(users.id, userId));
    },

    /** Sends a login code. Always succeeds from the caller's point of view, so emails can't be enumerated. */
    async requestOtp(rawEmail: string) {
      const email = normalizeEmail(rawEmail);
      const windowStart = new Date(now().getTime() - minutes(env.OTP_WINDOW_MIN));
      const [recent] = await db
        .select({ n: count() })
        .from(otpCodes)
        .where(and(eq(otpCodes.email, email), gt(otpCodes.createdAt, windowStart)));
      if ((recent?.n ?? 0) >= env.OTP_MAX_PER_WINDOW) {
        throw new AppError(429, 'TOO_MANY_REQUESTS', t('طلبات كثيرة، حاول مرة أخرى بعد قليل'));
      }
      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (!user || !user.isActive) return; // silently ignore unknown or disabled accounts

      // App store reviewers can't read our emails: one restaurant account may use a fixed code.
      const review =
        env.STORE_REVIEW_EMAIL &&
        env.STORE_REVIEW_CODE &&
        email === normalizeEmail(env.STORE_REVIEW_EMAIL) &&
        user.role === 'restaurant';
      const code = review ? env.STORE_REVIEW_CODE! : generateOtp();
      await db.insert(otpCodes).values({
        email,
        codeHash: hmac(`${email}:${code}`, env.OTP_PEPPER),
        expiresAt: new Date(now().getTime() + minutes(env.OTP_TTL_MIN)),
      });
      if (review) return;
      await mailer.send({
        to: email,
        subject: t('رمز الدخول — مخابز مكة'),
        text: t(
          'رمز الدخول الخاص بك: {0}\nصالح لمدة {1} دقائق. لا تشاركه مع أحد.',
          code,
          env.OTP_TTL_MIN,
        ),
      });
    },

    async verifyOtp(rawEmail: string, code: string, client: ClientInfo): Promise<LoginResult> {
      const email = normalizeEmail(rawEmail);
      const otp = await db.query.otpCodes.findFirst({
        where: and(
          eq(otpCodes.email, email),
          isNull(otpCodes.consumedAt),
          gt(otpCodes.expiresAt, now()),
        ),
        orderBy: (o, { desc }) => [desc(o.createdAt)],
      });
      if (!otp || otp.attempts >= env.OTP_MAX_ATTEMPTS) throw invalidCode();

      if (!safeEqual(otp.codeHash, hmac(`${email}:${code}`, env.OTP_PEPPER))) {
        await db
          .update(otpCodes)
          .set({ attempts: otp.attempts + 1 })
          .where(eq(otpCodes.id, otp.id));
        throw invalidCode();
      }
      await db.update(otpCodes).set({ consumedAt: now() }).where(eq(otpCodes.id, otp.id));

      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (!user || !user.isActive) throw invalidCode();
      const result = await issueSession(user.id, client);
      await writeAudit(
        db,
        { userId: user.id, ...client },
        { action: 'auth.login', entity: 'user', entityId: user.id, after: { method: 'otp' } },
      );
      return result;
    },

    async loginWithGoogle(idToken: string, client: ClientInfo): Promise<LoginResult> {
      if (!deps.google)
        throw new AppError(400, 'GOOGLE_DISABLED', t('تسجيل الدخول عبر Google غير مفعّل'));
      const identity = await deps.google(idToken).catch(() => {
        throw new AppError(401, 'INVALID_GOOGLE_TOKEN', t('تعذّر التحقق من حساب Google'));
      });
      if (!identity.emailVerified)
        throw new AppError(401, 'EMAIL_NOT_VERIFIED', t('البريد غير مؤكد لدى Google'));
      const user = await db.query.users.findFirst({ where: eq(users.email, identity.email) });
      if (!user || !user.isActive)
        throw new AppError(403, 'NO_ACCOUNT', t('لا يوجد حساب مفعّل بهذا البريد'));
      const result = await issueSession(user.id, client);
      await writeAudit(
        db,
        { userId: user.id, ...client },
        { action: 'auth.login', entity: 'user', entityId: user.id, after: { method: 'google' } },
      );
      return result;
    },

    /** Rotates the refresh token: the old one is revoked and a new pair is issued. */
    async refresh(refreshToken: string, client: ClientInfo): Promise<LoginResult> {
      const tokenHash = hmac(refreshToken, env.OTP_PEPPER);
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.tokenHash, tokenHash),
      });
      if (!session || session.revokedAt || session.expiresAt <= now()) {
        throw new AppError(401, 'INVALID_REFRESH', t('انتهت الجلسة، يرجى تسجيل الدخول'));
      }
      await db.update(sessions).set({ revokedAt: now() }).where(eq(sessions.id, session.id));
      return issueSession(session.userId, client);
    },

    async logout(refreshToken: string, ctx: AuditContext) {
      const tokenHash = hmac(refreshToken, env.OTP_PEPPER);
      const [revoked] = await db
        .update(sessions)
        .set({ revokedAt: now() })
        .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
        .returning({ userId: sessions.userId });
      if (revoked)
        await writeAudit(
          db,
          { ...ctx, userId: revoked.userId },
          { action: 'auth.logout', entity: 'user', entityId: revoked.userId },
        );
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
