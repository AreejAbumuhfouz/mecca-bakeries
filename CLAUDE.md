# Project guide for Claude

Mecca Bakeries ordering / contracts / production / distribution / invoicing system.
The developer (Areej) reviews and runs every change on her Mac before it goes to the client.

## Structure

- `apps/api` — Express 5 + TypeScript (ESM, NodeNext). DB via Drizzle ORM (`src/db`). Errors via `AppError`; every response uses the `ApiResponse` envelope from `@mecca/shared`.
- `apps/web` — Next.js 15 App Router, Tailwind 4, Arabic RTL first, brand tokens in `src/app/globals.css`.
- `apps/mobile` — Expo app for restaurants and drivers. Arabic RTL first.
- `packages/shared` — types and constants shared by all apps. Build it before typechecking others.

## Conventions

- TypeScript strict everywhere; no `any`.
- Validate all request input with zod.
- Every data-changing action must write to the audit log (from phase 1 onwards).
- Money is stored as integer fils (1 JOD = 1000 fils), never floats.
- Timezone is Asia/Amman for all scheduling (reminders 9/10/11 PM, cutoff 3 AM are configurable settings).
- UI text is Arabic by default with English available.
- No Jordanian e-invoicing (JoFotara) integration — explicitly out of scope.
- Follow the task order in `docs/development-plan.pdf`; one task per commit, clear commit messages.

## Before finishing a change

Run `pnpm typecheck`, `pnpm lint`, `pnpm --filter @mecca/api test`, `pnpm format:check`.
