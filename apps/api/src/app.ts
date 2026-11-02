import type { IncomingMessage } from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import type { Db } from './db/client.js';
import { logger } from './lib/logger.js';
import type { Mailer } from './lib/mailer.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { auditContext, authenticate } from './middleware/auth.js';
import { healthRouter, type DbPing } from './routes/health.js';
import { createTokenService } from './modules/auth/tokens.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { authRouter } from './modules/auth/auth.routes.js';
import type { GoogleVerifier } from './modules/auth/google.js';
import { createUsersService } from './modules/users/users.service.js';
import { usersRouter } from './modules/users/users.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { createCustomersService } from './modules/customers/customers.service.js';
import { createFilesService } from './modules/files/files.service.js';
import { filesRouter } from './modules/files/files.routes.js';
import { createTradeNamesService } from './modules/trade-names/trade-names.service.js';
import { tradeNamesRouter } from './modules/trade-names/trade-names.routes.js';
import { createItemsService } from './modules/items/items.service.js';
import { itemsRouter } from './modules/items/items.routes.js';
import { createContractsService } from './modules/contracts/contracts.service.js';
import { contractsRouter } from './modules/contracts/contracts.routes.js';
import { customersRouter } from './modules/customers/customers.routes.js';

/** Express keeps the full path in originalUrl; req.url is relative to the mounted router. */
const fullUrl = (req: IncomingMessage) =>
  (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url;

export type AppDeps = {
  env: Env;
  db: Db;
  pingDb: DbPing;
  mailer: Mailer;
  google: GoogleVerifier | null;
  version: string;
  now?: () => Date;
};

/** Builds the Express app. Kept separate from server.ts so tests can create it without listening. */
export function createApp(deps: AppDeps) {
  const { env, db } = deps;
  const tokens = createTokenService(env.JWT_ACCESS_SECRET, env.ACCESS_TOKEN_TTL_MIN);
  const auth = createAuthService({
    db,
    env,
    mailer: deps.mailer,
    tokens,
    google: deps.google,
    now: deps.now,
  });
  const requireAuth = authenticate(tokens, auth);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(auditContext);
  if (env.NODE_ENV !== 'test')
    app.use(
      pinoHttp({
        logger,
        // One short line per request: "POST /api/auth/otp/request 200 12ms".
        quietReqLogger: true,
        serializers: { req: () => undefined, res: () => undefined },
        customSuccessMessage: (req, res, ms) =>
          `${req.method} ${fullUrl(req)} ${res.statusCode} ${Math.round(ms)}ms`,
        customErrorMessage: (req, res) => `${req.method} ${fullUrl(req)} ${res.statusCode}`,
        customLogLevel: (_req, res, err) =>
          err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        customAttributeKeys: { responseTime: 'ms' },
      }),
    );

  app.use('/api/health', healthRouter(deps.pingDb, deps.version));
  app.use(
    '/api/auth',
    authRouter({
      auth,
      authenticate: requireAuth,
      secureCookies: env.NODE_ENV === 'production',
      refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      rateLimitEnabled: env.NODE_ENV !== 'test',
    }),
  );
  app.use('/api/users', usersRouter(createUsersService(db), requireAuth));
  app.use('/api/audit', auditRouter(db, requireAuth));
  const files = createFilesService(db, env.UPLOAD_DIR);
  app.use('/api/files', filesRouter(files, requireAuth, env.UPLOAD_MAX_MB));
  app.use('/api/trade-names', tradeNamesRouter(createTradeNamesService(db, files), requireAuth));
  app.use('/api/customers', customersRouter(createCustomersService(db), requireAuth));
  app.use('/api/items', itemsRouter(createItemsService(db, files), requireAuth));
  app.use(
    '/api/contracts',
    contractsRouter(createContractsService({ db, files, now: deps.now }), requireAuth),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
