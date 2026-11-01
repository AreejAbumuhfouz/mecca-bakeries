import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter, type DbPing } from './routes/health.js';

export type AppDeps = {
  env: Pick<Env, 'CORS_ORIGINS' | 'NODE_ENV'>;
  pingDb: DbPing;
  version: string;
};

/** Builds the Express app. Kept separate from server.ts so tests can create it without listening. */
export function createApp({ env, pingDb, version }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  if (env.NODE_ENV !== 'test') app.use(pinoHttp({ logger }));

  app.use('/api/health', healthRouter(pingDb, version));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
