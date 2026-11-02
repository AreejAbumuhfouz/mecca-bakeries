import { Router, type CookieOptions, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { ApiSuccess, AuthUser, LoginResult } from '@mecca/shared';
import { AppError } from '../../lib/errors.js';
import type { AuthService } from './auth.service.js';
import type { RequestHandler } from 'express';

export const REFRESH_COOKIE = 'mb_refresh';

const EmailBody = z.object({ email: z.string().trim().email().max(254) });
const VerifyBody = EmailBody.extend({ code: z.string().regex(/^\d{6}$/) });
const GoogleBody = z.object({ idToken: z.string().min(20) });
const RefreshBody = z.object({ refreshToken: z.string().min(20).optional() });

export function authRouter(opts: {
  auth: AuthService;
  authenticate: RequestHandler;
  secureCookies: boolean;
  refreshTtlDays: number;
  rateLimitEnabled?: boolean;
}): Router {
  const { auth } = opts;
  const router = Router();

  const cookieOpts: CookieOptions = {
    httpOnly: true,
    secure: opts.secureCookies,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: opts.refreshTtlDays * 86_400_000,
  };
  const client = (req: Request) => ({
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });
  const sendLogin = (res: Response, result: LoginResult) => {
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
    const body: ApiSuccess<LoginResult> = { ok: true, data: result };
    res.json(body);
  };
  const readRefresh = (req: Request) => {
    const fromBody = RefreshBody.parse(req.body ?? {}).refreshToken;
    const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const token = fromBody ?? fromCookie;
    if (!token) throw new AppError(401, 'INVALID_REFRESH', 'انتهت الجلسة، يرجى تسجيل الدخول');
    return token;
  };

  // Per-IP limit on top of the per-email limit in the service.
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const maybeLimit: RequestHandler = opts.rateLimitEnabled === false ? (_q, _s, n) => n() : limiter;

  router.post('/otp/request', maybeLimit, async (req, res) => {
    const { email } = EmailBody.parse(req.body);
    await auth.requestOtp(email);
    res.json({ ok: true, data: { sent: true } } satisfies ApiSuccess<{ sent: boolean }>);
  });

  router.post('/otp/verify', maybeLimit, async (req, res) => {
    const { email, code } = VerifyBody.parse(req.body);
    sendLogin(res, await auth.verifyOtp(email, code, client(req)));
  });

  router.post('/google', maybeLimit, async (req, res) => {
    const { idToken } = GoogleBody.parse(req.body);
    sendLogin(res, await auth.loginWithGoogle(idToken, client(req)));
  });

  router.post('/refresh', async (req, res) => {
    sendLogin(res, await auth.refresh(readRefresh(req), client(req)));
  });

  router.post('/logout', async (req, res) => {
    const token = (() => {
      try {
        return readRefresh(req);
      } catch {
        return null;
      }
    })();
    if (token) await auth.logout(token, req.audit);
    res.clearCookie(REFRESH_COOKIE, { ...cookieOpts, maxAge: undefined });
    res.json({ ok: true, data: { loggedOut: true } } satisfies ApiSuccess<{ loggedOut: boolean }>);
  });

  router.get('/me', opts.authenticate, (req, res) => {
    res.json({ ok: true, data: req.auth } satisfies ApiSuccess<AuthUser | undefined>);
  });

  return router;
}
