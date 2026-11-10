import { z } from 'zod';

const csv = (fallback = '') =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  CORS_ORIGINS: csv('http://localhost:3000,http://localhost:8081'),
  TZ: z.string().default('Asia/Amman'),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_PEPPER: z.string().min(16, 'OTP_PEPPER must be at least 16 characters'),
  OTP_TTL_MIN: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_MAX_PER_WINDOW: z.coerce.number().int().positive().default(5),
  OTP_WINDOW_MIN: z.coerce.number().int().positive().default(15),
  GOOGLE_CLIENT_IDS: csv(),

  // Uploaded files (logos, contract attachments). Relative paths are resolved from apps/api.
  UPLOAD_DIR: z.string().default('uploads'),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(5),

  // WhatsApp Cloud API (Meta). Leave WHATSAPP_TOKEN empty to only log messages.
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),
  WHATSAPP_APP_SECRET: z.string().default(''),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_TEMPLATE_LANG: z.string().default('ar'),

  // App push notifications through Expo.
  PUSH_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Scheduled jobs (reminders, drafts, cutoff). Run them in one process only if you scale out.
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Email (SMTP). If SMTP_HOST is empty, codes are printed to the console (development only).
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default('Mecca Bakeries <no-reply@localhost>'),

  // App store review: a restaurant account the reviewers can log into with a fixed code.
  // Leave empty except while the app is in review.
  STORE_REVIEW_EMAIL: z.string().default(''),
  STORE_REVIEW_CODE: z
    .string()
    .regex(/^(\d{6})?$/, 'STORE_REVIEW_CODE must be 6 digits')
    .default(''),

  // Monitoring: unexpected server errors are emailed here (at most one every 15 minutes).
  ALERT_EMAIL: z.string().default(''),
  // Requests per minute per IP across the whole API (login has its own stricter limit).
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
});

export type Env = z.infer<typeof EnvSchema>;

/** Validates process.env once at startup and fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (!env.SMTP_HOST) problems.push('SMTP_HOST is required (login codes are sent by email)');
    if (/change|example|secret/i.test(env.JWT_ACCESS_SECRET))
      problems.push('JWT_ACCESS_SECRET still has the example value');
    if (/change|example|pepper/i.test(env.OTP_PEPPER))
      problems.push('OTP_PEPPER still has the example value');
    if (env.CORS_ORIGINS.some((o) => o.startsWith('http://')))
      problems.push('CORS_ORIGINS must use https:// in production');
    if (problems.length)
      throw new Error(`Unsafe production settings:\n  - ${problems.join('\n  - ')}`);
  }
  return env;
}
