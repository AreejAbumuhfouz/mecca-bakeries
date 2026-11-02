# Mecca Bakeries — نظام مخابز مكة

نظام إدارة الطلبات والعقود والإنتاج والتوزيع والفوترة لمخابز مكة.

| Part                               | Path              | Stack                                                             |
| ---------------------------------- | ----------------- | ----------------------------------------------------------------- |
| API                                | `apps/api`        | Node.js 22, Express 5, TypeScript, Drizzle ORM, PostgreSQL, Redis |
| Dashboard                          | `apps/web`        | Next.js 15, React 19, Tailwind CSS 4 (RTL Arabic)                 |
| Mobile app (restaurants + drivers) | `apps/mobile`     | Expo (React Native), TypeScript                                   |
| Shared types                       | `packages/shared` | TypeScript                                                        |

The full phase/task plan is in [`docs/development-plan.pdf`](docs/development-plan.pdf).
Progress, setup troubleshooting and the manual QA checklists are in [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Local setup (macOS)

```bash
# 1) Tools (once)
brew install node@22 pnpm git postgresql@16 redis
brew services start postgresql@16
brew services start redis
createdb mecca_bakeries
createdb mecca_bakeries_test   # used by the API tests

# 2) Install
pnpm install

# 3) Environment files
cp apps/api/.env.example apps/api/.env        # put your Mac username in DATABASE_URL
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env  # put your Mac Wi-Fi IP

#    In apps/api/.env generate the two secrets:
#    openssl rand -hex 32   -> JWT_ACCESS_SECRET
#    openssl rand -hex 16   -> OTP_PEPPER
#    and set SEED_ADMIN_EMAIL / SEED_ADMIN_NAME to your own account.

# 4) Build shared types, create tables and the first super admin (safe to re-run)
pnpm run bootstrap
```

## First login

1. Run `pnpm dev:api` and `pnpm dev:web`, then open http://localhost:3000.
2. Enter the `SEED_ADMIN_EMAIL` address.
3. In development no email is sent: the 6-digit code is printed in the API terminal.
4. After login, add staff accounts from **المستخدمون والصلاحيات**. Only accounts added by an admin can log in.

In production set `SMTP_*` and `MAIL_FROM` so codes are emailed.

## Run

```bash
pnpm dev:api      # http://localhost:4000/api/health
pnpm dev:web      # http://localhost:3000
pnpm dev:mobile   # scan the QR code with Expo Go (iPhone camera / Android Expo Go app)
```

The phone and the Mac must be on the same Wi-Fi network.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm --filter @mecca/api test   # needs the mecca_bakeries_test database
pnpm format
```

## Database (Drizzle)

```bash
pnpm --filter @mecca/api db:generate   # create a migration from schema changes
pnpm --filter @mecca/api db:migrate    # apply migrations
pnpm --filter @mecca/api db:studio     # browse data
```

## Ownership

Source code ownership transfers to the client after full payment, per the signed agreement.
