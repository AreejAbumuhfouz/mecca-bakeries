import nodemailer from 'nodemailer';
import type { Env } from '../config/env.js';
import { logger } from './logger.js';

export type Mail = { to: string; subject: string; text: string; html?: string };
export type Mailer = { send(mail: Mail): Promise<void> };

/** SMTP mailer; falls back to logging the email in development when SMTP is not configured. */
export function createMailer(
  env: Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'MAIL_FROM'>,
): Mailer {
  if (!env.SMTP_HOST) {
    return {
      async send(mail) {
        // Printed on its own so the login code is easy to spot in the terminal.
        logger.warn(`[DEV MAIL] to ${mail.to}\n${mail.text}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
    },
  };
}
