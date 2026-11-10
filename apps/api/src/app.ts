import type { IncomingMessage } from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { requestId } from './middleware/request-id.js';
import { createErrorAlerts } from './lib/alerts.js';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import type { Db } from './db/client.js';
import { logger } from './lib/logger.js';
import type { Mailer } from './lib/mailer.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
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
import { createSettingsService } from './modules/settings/settings.service.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { createOrdersService } from './modules/orders/orders.service.js';
import { appRouter, ordersRouter } from './modules/orders/orders.routes.js';
import {
  createWhatsAppService,
  type WhatsAppTransport,
} from './modules/whatsapp/whatsapp.service.js';
import { whatsappRouter } from './modules/whatsapp/whatsapp.routes.js';
import {
  createPushService,
  expoTransport,
  type PushTransport,
} from './modules/notifications/push.js';
import { createNotifier, type Notifier } from './modules/notifications/notifier.js';
import { createScheduler } from './modules/scheduler/scheduler.js';
import { createProductionService } from './modules/production/production.service.js';
import { productionRouter } from './modules/production/production.routes.js';
import { createPurchasingService } from './modules/purchasing/purchasing.service.js';
import { purchasingRouter } from './modules/purchasing/purchasing.routes.js';
import { createChromePdfRenderer, type PdfRenderer } from './lib/pdf.js';
import { createBillingService } from './modules/billing/billing.service.js';
import { accountRouter, billingRouter } from './modules/billing/billing.routes.js';
import { createBalanceAlerts } from './modules/billing/balance-alerts.js';
import { createDistributionService } from './modules/distribution/distribution.service.js';
import { distributionRouter, driverRouter } from './modules/distribution/distribution.routes.js';
import { createReportsService } from './modules/reports/reports.service.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { createImportService } from './modules/import/import.service.js';
import { importRouter } from './modules/import/import.routes.js';

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
  /** Test doubles; real Meta / Expo senders are used when these are omitted. */
  whatsappTransport?: WhatsAppTransport | null;
  pushTransport?: PushTransport | null;
  notifier?: Notifier;
  pdf?: PdfRenderer;
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
  app.use(
    express.json({
      limit: '1mb',
      // Raw bytes are kept for the WhatsApp webhook signature check.
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  app.use(requestId);
  app.use(auditContext);
  if (env.NODE_ENV !== 'test')
    app.use(
      '/api',
      rateLimit({
        windowMs: 60_000,
        limit: env.API_RATE_LIMIT_PER_MIN,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: (req) => req.path.startsWith('/health'),
        message: {
          ok: false,
          error: { code: 'RATE_LIMITED', message: 'طلبات كثيرة، حاول بعد دقيقة' },
        },
      }),
    );
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
        genReqId: (req) => (req as unknown as express.Request).requestId ?? '',
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
  const pdf = deps.pdf ?? createChromePdfRenderer();
  const billing = createBillingService({ db, files, pdf, now: deps.now });
  const openInvoices = billing.openInvoicesProvider;
  app.use('/api/files', filesRouter(files, requireAuth, env.UPLOAD_MAX_MB));
  app.use('/api/trade-names', tradeNamesRouter(createTradeNamesService(db, files), requireAuth));
  const customersSvc = createCustomersService(db);
  const itemsSvc = createItemsService(db, files);
  app.use('/api/customers', customersRouter(customersSvc, requireAuth));
  app.use('/api/items', itemsRouter(itemsSvc, requireAuth));
  const contracts = createContractsService({ db, files, openInvoices, now: deps.now });
  app.use('/api/contracts', contractsRouter(contracts, requireAuth));

  const settings = createSettingsService(db);
  app.use('/api/settings', settingsRouter(settings, requireAuth));

  const whatsappConfig =
    env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
      ? {
          token: env.WHATSAPP_TOKEN,
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          verifyToken: env.WHATSAPP_VERIFY_TOKEN,
          appSecret: env.WHATSAPP_APP_SECRET,
          apiVersion: env.WHATSAPP_API_VERSION,
          language: env.WHATSAPP_TEMPLATE_LANG,
        }
      : null;
  const whatsapp = createWhatsAppService({
    db,
    config: whatsappConfig,
    transport:
      deps.whatsappTransport === undefined ? undefined : (deps.whatsappTransport ?? undefined),
  });
  app.use('/api/whatsapp', whatsappRouter(whatsapp, requireAuth));

  const push = createPushService(
    db,
    deps.pushTransport !== undefined ? deps.pushTransport : env.PUSH_ENABLED ? expoTransport : null,
  );
  const notifier = deps.notifier ?? createNotifier({ db, settings, whatsapp, push });
  const orders = createOrdersService({ db, settings, notifier, openInvoices, now: deps.now });
  const production = createProductionService({ db, settings, now: deps.now });
  const distribution = createDistributionService({ db, billing, files, pdf, now: deps.now });
  const alerts = createBalanceAlerts({ db, billing, whatsapp, push, settings, now: deps.now });
  const scheduler = createScheduler({
    db,
    settings,
    orders,
    production,
    distribution,
    alerts,
    notifier,
    now: deps.now,
  });
  app.use('/api/production', productionRouter(production, requireAuth));
  const purchasing = createPurchasingService({
    db,
    whatsapp,
    files,
    pdf,
  });
  app.use('/api/purchasing', purchasingRouter(purchasing, requireAuth));
  app.use('/api/orders', ordersRouter(orders, scheduler, requireAuth));
  app.use('/api/app', appRouter({ orders, contracts, push }, requireAuth));
  app.use('/api/app/account', accountRouter(billing, requireAuth));
  app.use('/api/billing', billingRouter(billing, alerts, requireAuth));
  app.use('/api/distribution', distributionRouter(distribution, requireAuth));
  app.use('/api/driver', driverRouter(distribution, requireAuth));
  const reports = createReportsService({
    db,
    billing,
    orderSettings: () => settings.getOrderSettings(),
    now: deps.now,
  });
  app.use('/api/reports', reportsRouter(reports, { db, files, pdf }, requireAuth));
  const importer = createImportService({
    db,
    customers: customersSvc,
    items: itemsSvc,
    contracts,
    billing,
    now: deps.now,
  });
  app.use('/api/import', importRouter(importer, requireAuth));

  app.use(notFoundHandler);
  const alert = createErrorAlerts({ mailer: deps.mailer, to: env.ALERT_EMAIL });
  app.use(createErrorHandler(alert));
  return Object.assign(app, {
    alert,
    scheduler,
    orders,
    production,
    billing,
    distribution,
    alerts,
  });
}
