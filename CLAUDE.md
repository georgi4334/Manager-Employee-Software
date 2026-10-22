# InTime — project instructions

Employee management SaaS (multi-tenant, GDPR, EU hosting, free tiers). Solo developer + Claude. Repo: `georgi4334/Manager-Employee-Software`.
Source of truth: `docs/data-model.md`, `docs/permission-matrix.md`, `docs/roadmap.md`. Read the relevant section before building a feature; update the docs when a decision changes.

## Stack

- Monorepo: pnpm + Turborepo. Packages: `@intime/web` (apps/web), `@intime/api` (apps/api), `@intime/contracts` (packages/contracts: Zod schemas, permission codes, shared types).
- Web: React 19, TypeScript, Vite, React Router (library mode), Zustand (UI state) + TanStack Query (server state), Tailwind with CSS-variable tokens, react-i18next (en, de, bg).
- API: NestJS 12 (ESM), PostgreSQL + Prisma 7 (pg driver adapter), Row Level Security per tenant, pg-boss jobs, own auth module with `jose` (JWT, Google OIDC) and argon2id (`@node-rs/argon2`).

## Commands

- Local DB: `docker compose up -d`; copy `apps/api/.env.example` to `apps/api/.env`; `pnpm --filter @intime/api db:deploy` applies migrations.
- `pnpm dev` runs from each app (`apps/web` Vite on :5173, `apps/api` Nest watch on :3000, docs at `/api/docs`).
- Checks: `pnpm lint && pnpm typecheck && pnpm test` (API database tests `test/*.int.test.ts` run one file at a time when `TEST_DATABASE_URL` is set; CI always sets it).
- Schema change: edit `apps/api/prisma/schema.prisma`, then `pnpm --filter @intime/api db:migrate -- --name <what>`; commit the migration.

## Workflow

- Branches: `main` (stable, PR only) and `dev` (daily work). Never push to `main` directly. Open a PR `dev` -> `main` only when asked.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Small, focused commits.
- Do not start code for a module before its design is in `docs/`. Don't add features outside the current roadmap phase.

## Definition of Done (every feature)

1. Unit tests with positive AND negative cases (invalid input, forbidden role, wrong tenant, not found, duplicate, boundary).
2. Permission checks covered by the matrix test; the server is the only authority, UI hiding is cosmetic.
3. Mobile-first responsive (check 375px). No hard-coded colors: use design tokens only (`bg-primary`, etc.).
4. Every user-facing string translated in en, de, bg. Backend returns error codes, never display text.
5. Personal data minimal; GDPR export/erase considered; sick-leave reason is never stored.
6. `pnpm lint && pnpm typecheck && pnpm test` pass before committing.

## API conventions (apps/api)

- ESM + NodeNext: relative imports end in `.js`. Nest needs decorator metadata, so tests use Vitest with SWC (not esbuild/tsx) and constructor-injected classes stay normal (value) imports.
- Throw `AppException(code, { message, details, params })` for expected failures; codes and the response body shape live in `@intime/contracts` (`ERROR_CODES`, `apiErrorBodySchema`). The client translates the code; `message` is developer-facing English. Never put secrets or internals in a message.
- Validate request bodies/queries with `ZodValidationPipe(schema)` using schemas from `@intime/contracts`.
- Services needing field-specific conflicts catch/check themselves and throw `AppException('CONFLICT', { params: { field } })`; the generic Prisma P2002 mapping carries no field info.
- Health probes are `/health/live` and `/health/ready` (outside `/api/v1`). Config is validated at startup (`config/env.ts`); add new env vars there and in `.env.example`.
- Logs are structured JSON (pino) with request ids; credentials/cookies are redacted. Log ids, never personal data.

## Tenancy (docs/adr/0001-multi-tenancy-rls.md) — security critical

- All tenant data access goes through `TenantDb.tx(tx => ...)`; never query tenant tables with `PrismaService` directly. Use `SystemPrismaService` only for provisioning/login/jobs (ESLint enforces where it may be imported).
- Every new table: `tenant_id uuid NOT NULL DEFAULT public.app_current_tenant()` (Prisma: `@default(dbgenerated("app_current_tenant()"))`) and, in the same migration, `SELECT public.enable_tenant_rls('<table>');`. The schema guard test fails otherwise. Tables without `tenant_id` need an explicit allowlist entry in `test/tenancy.int.test.ts` and a reason.
- Connections: `DATABASE_URL` = `intime_app`, `SYSTEM_DATABASE_URL` = `intime_system`, `MIGRATION_DATABASE_URL` = table owner (migrations only). The API refuses to start if `DATABASE_URL` is a superuser/owner/BYPASSRLS role.
- Every tenant-scoped feature needs an isolation test: another tenant cannot read, update, delete or insert its rows.

## Authentication (docs/adr/0002-authentication.md) — security critical

- Every route requires authentication by default (global `AuthGuard`); opt out only with `@Public()`. Use `@CurrentAuth()` for the signed-in user; the guard has already set the tenant context.
- Tokens live only in httpOnly cookies; never return tokens in JSON or accept them in query strings. Never log them.
- Cross-tenant lookups (login, refresh/one-time token lookup) use `SystemPrismaService`; everything after the tenant is known runs through `TenantDb`.
- Child tables reference parents with composite `(tenant_id, id)` foreign keys.
- New error codes go in `@intime/contracts` `ERROR_CODES` (the web app translates them).
- First workspace: `pnpm --filter @intime/api build && pnpm --filter @intime/api tenant:create --name "Acme" --slug acme --admin-email a@acme.eu`.

## i18n rules

- Strings live in `apps/web/src/i18n/locales/{en,de,bg}/<namespace>.json`; add every key to all three languages (English is the reference). `pnpm test` fails on missing, extra, empty or placeholder-mismatched keys.
- Use `useTranslation('<ns>')` with typed keys; plurals use `_one` / `_other`. Never hard-code UI text, never build sentences by concatenation.
- Dates and numbers go through `shared/lib/format.ts` (Intl), never manual formatting.
- New namespace: add it to `NAMESPACES` in `i18n/languages.ts` and `i18n/types.d.ts`.

## Code conventions

- TypeScript strict, no `any` without a comment. Validate all input with Zod (schemas live in `@intime/contracts`).
- Every table has `tenant_id`; every query is tenant-scoped. Never trust ids from the client without a tenant + permission check.
- Never log secrets, tokens, AI keys or personal data. AI keys are encrypted at rest and never returned to the browser.
- Match surrounding code style; keep comments rare and only for non-obvious "why".

## Token/usage discipline

- Be specific: point to files/doc sections instead of broad searches. Start a fresh session per feature.
- Design for risky areas (tenancy, auth, permissions, leave rules, time tracker rules, AI keys) deserves the strongest model; routine CRUD/UI/tests use the mid-tier; translations/boilerplate the cheapest.
