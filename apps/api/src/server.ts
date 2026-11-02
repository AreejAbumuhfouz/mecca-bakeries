import { loadEnv } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { createMailer } from './lib/mailer.js';
import { createDb } from './db/client.js';
import { createGoogleVerifier } from './modules/auth/google.js';

const env = loadEnv();
process.env.TZ = env.TZ;

const database = createDb(env.DATABASE_URL);

const app = createApp({
  env,
  db: database.db,
  pingDb: database.ping,
  mailer: createMailer(env),
  google: createGoogleVerifier(env.GOOGLE_CLIENT_IDS),
  version: process.env.npm_package_version ?? '0.1.0',
});

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await database.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
