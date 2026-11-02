import type { RequestHandler } from 'express';
import type { Permission } from '@mecca/shared';
import { AppError } from '../lib/errors.js';
import type { AuthService } from '../modules/auth/auth.service.js';
import type { TokenService } from '../modules/auth/tokens.js';

/** Attaches request metadata used by audit logging. */
export const auditContext: RequestHandler = (req, _res, next) => {
  req.audit = { userId: null, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
  next();
};

/** Requires a valid access token and an active user; loads fresh permissions on every request. */
export function authenticate(tokens: TokenService, auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'يرجى تسجيل الدخول'));
    try {
      const claims = await tokens.verifyAccess(token);
      const user = await auth.loadAuthUser(claims.sub);
      if (!user) return next(new AppError(401, 'UNAUTHENTICATED', 'الحساب غير مفعّل'));
      req.auth = user;
      req.audit.userId = user.id;
      next();
    } catch {
      next(new AppError(401, 'UNAUTHENTICATED', 'انتهت صلاحية الجلسة'));
    }
  };
}

/** Requires every listed permission. Use after `authenticate`. */
export function requirePermission(...needed: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const have = new Set(req.auth?.permissions ?? []);
    const missing = needed.filter((p) => !have.has(p));
    if (missing.length)
      return next(new AppError(403, 'FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء', { missing }));
    next();
  };
}

/** Requires at least one of the listed permissions. Use after `authenticate`. */
export function requireAnyPermission(...anyOf: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const have = new Set(req.auth?.permissions ?? []);
    if (anyOf.some((p) => have.has(p))) return next();
    next(new AppError(403, 'FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء', { anyOf }));
  };
}
