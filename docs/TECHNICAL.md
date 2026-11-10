# Mecca Bakeries — technical documentation

For the developer who runs, deploys or changes the system. The user guide for the bakery's
staff is [USER-GUIDE.md](USER-GUIDE.md).

## 1. What runs where

```
 restaurants & drivers ── Expo app (iOS / Android) ─┐
                                                    ├──▶ API  (Express 5, Node 22) ──▶ PostgreSQL 16
 bakery staff ─────────── dashboard (Next.js 15) ───┘        │
                                                             ├──▶ Meta WhatsApp Cloud API (templates)
                                                             ├──▶ Expo push service
                                                             ├──▶ SMTP (login codes, error alerts)
                                                             └──▶ Chrome (PDF rendering, on the server)
```

| Folder            | What                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `apps/api`        | REST API, scheduler, PDF rendering. Drizzle ORM, zod validation, pino logs.      |
| `apps/web`        | Dashboard for staff. Next.js App Router, Tailwind 4, Arabic RTL, light/dark.     |
| `apps/mobile`     | One Expo app: ordering for restaurants, deliveries for drivers (offline queue).  |
| `packages/shared` | Types and rules used by all three (money, dates, statuses, permissions, labels). |
| `infra`           | Server setup, nginx, systemd units, deploy and backup scripts.                   |

### Conventions

- Money is integer **fils** (1 JOD = 1000 fils) everywhere; only the screens format dinars.
- All scheduling is in **Asia/Amman**; reminders, drafts, cutoff and the balance reminder are settings.
- Every change to data writes to `audit_logs` in the same transaction (who, when, before, after).
- Every response is `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }`.
- Arabic is the interface language. English is not part of the agreed scope.

## 2. Modules and the daily cycle

| Module                        | Main tables                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Auth (email code, Google)     | `users`, `otp_codes`, `sessions`, `user_permission_overrides`                                |
| Customers, trade names, items | `customers`, `branches`, `trade_names`, `items`, `item_sections`                             |
| Contracts and credit          | `contracts`, `contract_prices`, `contract_attachments`                                       |
| Orders                        | `orders`, `order_items`, `order_events`                                                      |
| Production                    | `production_days`, `production_items`, `vehicle_loads`, `stock_losses`, `variance_approvals` |
| Purchasing                    | `suppliers`, `purchase_orders`, `purchase_order_lines`                                       |
| Distribution                  | `routes`, `route_stops`, `trips`, `deliveries`, `delivery_lines`                             |
| Billing                       | `invoices`, `invoice_lines`, `invoice_revisions`, `payments`, `payment_allocations`          |
| Messages                      | `whatsapp_messages`, `push_tokens`                                                           |
| Scheduler                     | `scheduler_runs` (each job runs once per key, safe across restarts)                          |

The scheduler ticks every minute inside the API (`SCHEDULER_ENABLED=true` on one process only):

| Amman time (default) | Job                                                                          |
| -------------------- | ---------------------------------------------------------------------------- |
| 21:00, 22:00, 23:00  | Reminder to branches without an order for the next delivery day              |
| 00:00                | Drafts copied from yesterday's orders (when enabled in settings)             |
| 03:00                | Cutoff: orders confirmed or cancelled → final production plan → driver trips |
| 10:00                | Balance reminder with statement PDF to overdue customers (WhatsApp + push)   |

Delivery confirmation (`POST /api/driver/deliveries/:id/confirm` or the batch `POST /api/driver/sync`)
does in one transaction: delivery lines → order `delivered` → draft invoice (contract prices, trade
name's own sequence) → driver receipt → oldest-first allocation → trip progress → audit. The phone
sends a `clientRef`; the same reference again is answered as a duplicate, so retries are safe.

## 3. Local development

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # fill DATABASE_URL, secrets
pnpm run bootstrap                          # build shared, migrate, create the first admin
pnpm run demo:reset                         # demo customers, orders, a delivered day, invoices…
pnpm dev:api    # http://localhost:4000      (login codes are printed here as [DEV MAIL])
pnpm dev:web    # http://localhost:3000
pnpm dev:mobile # Expo Go, same Wi-Fi; or: pnpm --filter @mecca/mobile web
```

Checks before every change (CLAUDE.md): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm --filter @mecca/api test` (needs `TEST_DATABASE_URL`, a separate empty database).
`test/scenarios.test.ts` runs a whole day from order to collection.

## 4. Production server (Hostinger VPS, Ubuntu 24.04)

Recommended: 2 vCPU, 4 GB RAM (KVM 2). Domains: `app.<domain>` for the dashboard and `api.<domain>`.

1. Point both DNS names at the VPS.
2. As root: `APP_DOMAIN=… API_DOMAIN=… ADMIN_EMAIL=… infra/setup-server.sh`
   (Node 22, pnpm, PostgreSQL, nginx, SSL with certbot, Google Chrome for PDFs, rclone, firewall,
   automatic security updates, the `mecca` user, systemd units). It prints the database password.
3. As `mecca`: `git clone … /opt/mecca`, then create
   - `apps/api/.env` from `.env.example` with `NODE_ENV=production`, the database URL, new
     random `JWT_ACCESS_SECRET` / `OTP_PEPPER` (`openssl rand -hex 32`), SMTP, WhatsApp,
     `CORS_ORIGINS=https://app.<domain>`, `ALERT_EMAIL` (Chrome for PDFs is found at `/usr/bin/google-chrome`)
   - `apps/web/.env.production` with `NEXT_PUBLIC_API_URL=https://api.<domain>` and the privacy contact
   - `/etc/mecca/backup.env` from `infra/backup/backup.env.example` (chmod 600)
4. `infra/deploy.sh` — backup, pull, install, build, migrate, restart, health check.
5. `pnpm --filter @mecca/api db:seed` once, to create the first super admin.

The API refuses to start in production with example secrets, `http://` origins or no SMTP.

### Updating

`infra/deploy.sh` every time. It takes a backup first; if a migration goes wrong, stop the API and
restore that backup (section 6).

### Logs and monitoring

- `journalctl -u mecca-api -f` — one line per request with its id (`X-Request-Id`), errors with stack.
- Unexpected errors are emailed to `ALERT_EMAIL` (at most one email per 15 minutes).
- `GET /api/health` returns 200 with database status — add it to a free uptime monitor
  (UptimeRobot, Better Stack) to get an alert when the site is down.
- The backup pings `HEALTHCHECK_URL` (healthchecks.io) — you get an email if a nightly backup is missed.
- Dashboard → الإعدادات → «آخر المهام المجدولة» shows that reminders, cutoff and balance alerts ran.

### Security in place

HTTPS only (HSTS), helmet security headers, CORS limited to the dashboard, login by email code
(hashed, 10 minutes, 5 attempts, rate limited) or Google, short access tokens with rotating refresh
cookies (HttpOnly, Secure), permission check on every route, zod validation of every input, request
size limits, API rate limit per IP (`API_RATE_LIMIT_PER_MIN`) plus nginx limit, WhatsApp webhook
signature check, signatures stored as path data only (no script can be stored), audit log of every
change, firewall with only SSH/HTTP/HTTPS, database not exposed to the internet, `systemd` hardening.

## 5. WhatsApp templates to register at Meta (language: Arabic)

| Template               | Header   | Used for                                  |
| ---------------------- | -------- | ----------------------------------------- |
| `mb_order_confirmed`   | —        | Order received                            |
| `mb_order_updated`     | —        | Order changed                             |
| `mb_order_on_hold`     | —        | Order waits for credit approval           |
| `mb_order_approved`    | —        | Held order approved                       |
| `mb_order_rejected`    | —        | Held order rejected                       |
| `mb_order_cancelled`   | —        | Order cancelled                           |
| `mb_draft_ready`       | —        | Draft from yesterday's order ready        |
| `mb_order_reminder`    | —        | 9/10/11 PM reminder                       |
| `mb_purchase_order`    | Document | Purchase order PDF to a supplier          |
| `mb_balance_statement` | Document | Daily balance reminder with statement PDF |

The exact texts are in `apps/api/src/modules/whatsapp/templates.ts`. Until WhatsApp is connected,
messages are logged as «لم يُرسل فعلياً» and everything else works.

## 6. Backups and restore

- Daily at 04:30 (`mecca-backup.timer`): `pg_dump` + uploads archive + SHA-256 file, kept 14 days
  on the server and copied off the server with `rclone` (`RCLONE_REMOTE`, e.g. Backblaze B2 —
  about 1–3 JOD a month — or Google Drive).
- Restore: `infra/backup/restore.sh <db_….dump> <database url> [uploads_….tar.gz]`.
- **Test the restore every month**: `infra/backup/restore-test.sh` restores the latest backup into
  a scratch database, compares counts and totals with live, and deletes it. It was run on the
  development database on 2026-11-10: restored copy matched exactly (12 customers, 17 orders,
  11 invoices, 6 payments, totals equal).
- Full data export for the owner: dashboard → الإعدادات → «تنزيل كل البيانات (Excel)».

## 7. Mobile app release (EAS)

Accounts in the bakery's name: Expo, Apple Developer (99 USD/year), Google Play (25 USD once).

```bash
cd apps/mobile
npm i -g eas-cli && eas login
eas init                                   # links the project to the bakery's Expo account
# set EXPO_PUBLIC_API_URL / EXPO_PUBLIC_PRIVACY_URL in eas.json, and the App Store Connect app id
eas build --platform android --profile preview      # APK to try on the drivers' phones
eas build --platform all --profile production
eas submit --platform android                        # internal testing track first
eas submit --platform ios                            # TestFlight, then review
```

Store texts, screenshots and the review notes are in [STORE-LISTING.md](STORE-LISTING.md).
For the review, set `STORE_REVIEW_EMAIL` / `STORE_REVIEW_CODE` on a demo restaurant account and
empty them again after approval. The privacy policy is served at `https://app.<domain>/privacy`.

## 8. Moving the bakery's data in

Dashboard → الإعدادات → «نقل البيانات من Excel». Order: items → customers → contracts → special
prices → opening balances. Each file is checked row by row; only a file without errors imports.
Rows that already exist (same name, or an opening balance already recorded) are skipped, so a file
can be uploaded again safely. «التحقق من الأرصدة الافتتاحية» lists what was imported, for comparing
with the bakery's books before going live.
