# InTime — project instructions

Employee management SaaS (multi-tenant, GDPR, EU hosting, free tiers). Solo developer + Claude. Repo: `georgi4334/Manager-Employee-Software`.
Source of truth: `docs/data-model.md`, `docs/permission-matrix.md`, `docs/roadmap.md`. Read the relevant section before building a feature; update the docs when a decision changes.

## Stack

- Monorepo: pnpm + Turborepo. Packages: `@intime/web` (apps/web), `@intime/api` (apps/api), `@intime/contracts` (packages/contracts: Zod schemas, permission codes, shared types).
- Web: React 19, TypeScript, Vite, React Router (library mode), Zustand (UI state) + TanStack Query (server state), Tailwind with CSS-variable tokens, react-i18next (en, de, bg).
- API: NestJS 12 (ESM), PostgreSQL + Prisma 7 (pg driver adapter), Row Level Security per tenant, a transactional outbox for notifications (ADR 0004; no pg-boss), own auth module with `jose` (JWT, Google OIDC) and argon2id (`@node-rs/argon2`).

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
- First workspace: `pnpm --filter @intime/api build && pnpm --filter @intime/api tenant:create --name "Acme" --slug acme --admin-email a@acme.eu` (the admin gets the Admin role). Older accounts without roles: `pnpm --filter @intime/api roles:grant --workspace acme --email a@acme.eu --role admin`.

## Permissions (docs/adr/0003-roles-and-permissions.md) — security critical

- The permission catalog is `packages/contracts/src/permissions.ts` (code, module, description, allowed scopes, default grants of Admin/HR/Manager/Employee). After editing it run `pnpm --filter @intime/contracts docs:permissions` (a test fails if `docs/permission-matrix.md` is stale) and, on deploy, `pnpm --filter @intime/api roles:sync`.
- Every route must declare its protection: `@Public()`, `@Authenticated()` or `@RequirePermission('code')`. Undeclared routes are refused and `test/routes.inventory.test.ts` fails.
- A route permission only says the caller holds the permission at some scope. In the service, load the record and call `authz.assert(actor, 'code', { ownerUserId })` so the scope (own/reports/team/department/all) is applied. Get the actor with `@CurrentAuth()`.
- Permissions are read fresh from the database on every request; never cache them across requests.
- Anything that can remove an administrator takes the administrator lock and checks that another active administrator remains (see `UsersService`).
- Admin actions write `AuditService.record(...)` (ids and role ids only, never emails or secrets). The audit log is append-only.
- Web: `usePermission`, `<Can>`, `<RequirePermission>` are cosmetic. Add new nav entries with a `permission` in `app/nav.ts`.
- Test fixtures: `userWithRole('admin')` / `userWithPermissions({...})` in `apps/web/src/tests/server.ts`.

## Notifications (docs/adr/0004-notifications.md)

- A feature notifies by adding a type to `packages/contracts/src/notifications.ts` (params schema, defaults, locked channels) + web/email translations, and calling `OutboxService.publish(tx, type, params)` inside the same transaction as its change. Params: ids and non-sensitive labels only; emails never carry details.
- The queue is the `outbox_event` table (no pg-boss). The worker runs after commit, at startup and in sweeps only while the API is active; `WORKER_ENABLED=false` disables it (tests). Time-based features will need an external pinger.
- Inbox routes are `@Authenticated()` and scoped to the caller; every notification type needs an en/de/bg text in `notifications.json`.

## Employees (docs/adr/0006-employees.md)

- `employee` is the person, `app_user` the login: an employee may have no account yet, an account may be disabled while the record stays. Email lives on the account only.
- Scope checks on an employee record go through `EmployeesService.canScoped`: a record without an account is reachable only at scope `all` (a missing owner must never read as "anyone"). Profile data (phone, birth date, dates, employee no.) is `null` in responses unless `employee.view_profile_full` covers that record.
- Audit entries for employee changes carry field names only, never values. Deactivation disables the account through `UsersService.disableInTx` (self, last-administrator and "only Admin manages an administrator" rules apply). Application roles cannot delete employees.
- Avatar upload arrives with file storage (initials for now).

## Organization (docs/adr/0007-organization.md)

- Scopes are real: `DbOrgRelations` (`common/auth`) answers self / direct_report / subordinate / same_department / other from `employee.manager_id` and `department_id`; anything unknown (no employee record, other workspace) is `other`. Check records with `authz.can/assert(actor, code, { ownerEmployeeId })` (or `ownerUserId`); for lists use `authz.allowedEmployees(...)` (one query). Never join org tables in feature code.
- All org writes take `OrganizationService.lock` (per-workspace advisory lock) and refuse cycles with `ORG_CYCLE`; DB triggers re-check. Deactivating an employee calls `onEmployeeDeactivated` (reports move up, head/lead/teams cleared) in the same transaction.
- `org.view`/`org.manage` are workspace-wide (scope `all`) only. Teams group people; they grant no access.

## Leave (docs/adr/0008-leave.md)

- Rules live in `@intime/contracts` as pure functions (`countLeaveDays`, `builtInHolidays`, `proratedAllowance`, `carryOver`) with unit tests; the API only supplies holidays and balances to them. Dates are `YYYY-MM-DD` strings, "today" is the workspace time zone (`todayIn`).
- Counted days are stored per request (`leave_request_day`); balances freeze `entitled`/`carried_over` when first created, used/pending are always sums over request days. Creating a request takes the per-employee advisory lock; overlaps are also enforced by an exclusion constraint.
- Nobody decides their own request (even Admin); approval scope comes from `leave.approve` through `authz` (`ownerEmployeeId`). Sick types never store a reason; masking of the type for colleagues is decided server-side (`hideSickTypeFromTeam`). Notifications and audit never contain reasons, comments or the sick type.
- New built-in holiday keys must be added to `BUILT_IN_HOLIDAY_KEYS` and translated in en/de/bg (a test fails otherwise).

## Attendance (docs/adr/0009-attendance.md)

- Self-reported only: no location, IP or device is ever stored. Times are typed as `HH:MM` in the workspace time zone and stored as instants (`zonedToUtc`/`utcToZoned` in contracts; a time inside a DST gap is `nonexistent_time`).
- The database enforces the rules too: one open record per employee (partial unique index), no overlaps (exclusion constraint, open = infinity), at most 16 h, end after start. The service maps them to `CONFLICT` with `field` `open`/`overlap`.
- Owners type or change their own records only for the last 7 days (`ATTENDANCE_SELF_EDIT_DAYS`); older days and other people's records need `attendance.correct` through `authz`, and nobody corrects their own old records. Corrections are audited (ids only) and notify the owner (`attendance.corrected`: date and action only). `canEdit` in responses is computed for the caller; the UI never decides.
- Lists and presence are scoped with `allowedEmployees`; presence combines today's records with approved leave (`leave_request_day`). Break/overtime rules and exports are out of scope for now.

## Calendar (docs/adr/0010-calendar.md)

- Only events are stored (`calendar_event`: scope `personal` / `team` / `company`). Leave and public holidays are read-only layers the web page merges from the existing scoped endpoints (`/leave/requests`, `/leave/holidays`), so sick-leave masking stays in one place. No recurrence, sharing, invitations or reminders until Phase 4.
- Visibility is decided in `CalendarService.visibleTo`: personal = owner only, team = members and lead (or `calendar.manage_team_calendars` at scope `all`), company = everybody. An event the caller cannot see is `404`, never `403`. Changes follow `mayManage`: owner (personal), team lead/member or scope `all` (team), `calendar.manage_company_calendar` (company). `canEdit` is computed per caller.
- Every event has local `start_date`/`end_date` (range queries are plain date comparisons); timed events also store instants. Times are typed as `HH:MM` in the workspace time zone like attendance. The database re-checks shapes (all-day vs timed, team iff team scope, 31 days max).
- Team and company changes are audited with ids only (never titles); personal events are not audited.

## Privacy (docs/adr/0011-gdpr-export-erasure.md)

- Export is `GET /privacy/export` (own, `gdpr.export_own`) or `/privacy/export/:employeeId` (HR/Admin, `gdpr.export_employee`, audited). It is built from `PrivacyService.collect`: **add every new table that holds personal data of an employee to the export and to `ErasureService`** (and to the erasure test's "nothing of Dan is left" check).
- Erasure anonymises an inactive employee irreversibly (`POST /privacy/erase/:employeeId`, `{ confirm: true }`): it clears identifying and free-text data and keeps statutory records (hire/termination dates, attendance times, leave days) detached from the person. It runs on the system connection, allowed only in `modules/privacy/erasure.service.ts` (ESLint); every statement there must be scoped by `tenantId`.
- Audit entries and notifications carry only ids and non-identifying labels; names in notification params (`employeeName`) are replaced on erasure. Never put free text (titles, notes, reasons) into audit or notification params.
- Automatic retention periods are not implemented (they need a per-country decision); `gdpr.manage_retention` is reserved for it.

## End-to-end and accessibility (docs/adr/0012-e2e-and-accessibility.md)

- `e2e/` (Playwright, Chromium) is a separate package, not part of `pnpm test`: `pnpm --filter @intime/e2e e2e` (needs `E2E_DATABASE_URL`, a Postgres owner URL, and a built API; locally `PW_CHROMIUM` can point at an installed Chromium). It starts its own API (fresh database, real `tenant:create`, log mail transport) and the Vite dev server; specs run in order. Use roles and visible labels as selectors.
- `06-accessibility.spec.ts` scans every page with axe (WCAG 2.1 A/AA, phone and desktop, light and dark). A new page must be added to its list; fix violations in the components or the design tokens, never by excluding rules.

## Projects (docs/adr/0013-clients-and-projects.md)

- `client`, `project`, `milestone`, `project_assignment` (all RLS). Rules are pure functions in `@intime/contracts` with unit tests: `projectHealth` (computed, never stored; only active projects have one) and `peakAllocation` (over-allocation is a warning, not a block). "Today" is the workspace time zone.
- Visibility/rights live in `ProjectAccess`: `project.view` scope is about people (a project is visible through its lead or an assignee inside the scope; `own` = led or staffed), `project.manage`/`assignment.manage` at `own` mean "projects I lead", managers create projects they lead themselves, only scope `all` changes the lead. A project the caller cannot see is `404`. Clients are hidden from people without `client.view` (the response says `client: null`).
- The database enforces: allocation 1–100, date order, no overlapping assignment of one person on one project (exclusion constraint), unique project code and client name. Services map these to `CONFLICT` with a `field`.
- Deactivating an employee calls `AssignmentsService.onEmployeeDeactivated` (ends running assignments at the termination date, drops future ones, clears them as project lead) in the same transaction. Data export lists staffing; erasure clears assignment roles.
- Audit entries carry ids and field names only; `project.assigned` notifications carry the project id and name.

## Tasks (docs/adr/0014-tasks.md)

- `task` (RLS, composite foreign keys). Numbering is per project: `project.task_seq` is incremented under the project row lock; the reference is `CODE-number` (`taskKey`). Never compute numbers from `max(number)`.
- Rights: `task.view` scope is about people and projects (`ProjectAccess.visibleWhere(..., 'task.view')` plus tasks assigned to people in scope). Full edit/create/delete needs `task.manage` and either scope `all` or leading the project (`project.manage` covers the lead); the assignee may change only the status (`canMove`). A task the caller cannot see is `404`.
- The assignee must be an active person staffed on the project or its lead (`assignee_not_on_project`, `unknown_employee`); the milestone must belong to the same project (`milestone_not_in_project`, also a DB trigger). `done_on` is set exactly when the status is `done`.
- `task.assigned` notifications carry the project id and task key, never the title. Audit entries carry ids and field names only. Deactivating an employee un-assigns their open tasks (`AssignmentsService.onEmployeeDeactivated`); the data export lists assigned tasks.
- Web: `/tasks` (list and board views, filters in the query string for `project` and `view`), move via the status select (no drag and drop), a task count on the project page. The project picker lists the first page of projects only.
- e2e: the start script always builds the API through turbo; a stale `dist/` once hid a missing route.

## Deployment (docs/adr/0005-deployment.md, docs/deployment.md)

- Free EU stack: Cloudflare Pages (web + `/api` proxy function in `apps/web/functions`, logic in `apps/web/edge`), Render (API, `render.yaml`), Neon (Postgres), Resend (email). Releases only through `.github/workflows/deploy.yml` on `main` after CI (gated by repo variable `DEPLOY_ENABLED`).
- Migrations run before the new code: keep every migration compatible with the previous release (expand, then contract). Never edit a deployed migration.
- Production env: `MAIL_TRANSPORT=resend`, `TRUST_PROXY_HOPS=2` (Render + proxy function). New env vars go in `config/env.ts`, `.env.example`, `render.yaml` and the runbook.

## Web conventions (apps/web)

- Call the API only through `apiRequest` (`shared/api/client.ts`); never `fetch` directly, never store tokens in JS/localStorage. Server data goes through TanStack Query; who is signed in is `useCurrentUser()`.
- API errors are shown with `useMessages().apiError(error)` (keys `errors:api.<CODE>`). A new `ErrorCode` in `@intime/contracts` fails typecheck until it is translated in en/de/bg.
- Forms: react-hook-form + `zodResolver` with schemas in `features/*/forms.ts` whose messages are keys of `errors:validation` (not text). Keep them in line with the API schemas; add a parity test.
- Reusable UI: `shared/ui` (Button, Card, Input, Field, Alert, PasswordInput). Inputs use a 16px font on mobile; every control is at least 44px high.
- Component tests use the shared MSW server in `tests/server.ts` (signed in by default; `signedOutHandlers()` for visitors) and `renderApp(path)` from `tests/utils.tsx`, which waits for the first requests. Use `findBy…` for anything that happens after navigation.
- Dev: run the API (`apps/api`, :3000) and `pnpm dev` in `apps/web` (:5173, proxies `/api`). Set `WEB_APP_URL=http://localhost:5173` in the API `.env`.

## i18n rules

- Strings live in `apps/web/src/i18n/locales/{en,de,bg}/<namespace>.json`; add every key to all three languages (English is the reference). `pnpm test` fails on missing, extra, empty or placeholder-mismatched keys.
- Use `useTranslation('<ns>')` with typed keys; plurals use `_one` / `_other`. Never hard-code UI text, never build sentences by concatenation.
- Dates and numbers go through `shared/lib/format.ts` (Intl), never manual formatting.
- New namespace (also touch `src/tests/i18n.ts` if tests do not see the new files, the Vite glob is cached): add it to `NAMESPACES` in `i18n/languages.ts` and `i18n/types.d.ts`.

## Code conventions

- TypeScript strict, no `any` without a comment. Validate all input with Zod (schemas live in `@intime/contracts`).
- Every table has `tenant_id`; every query is tenant-scoped. Never trust ids from the client without a tenant + permission check.
- Never log secrets, tokens, AI keys or personal data. AI keys are encrypted at rest and never returned to the browser.
- Match surrounding code style; keep comments rare and only for non-obvious "why".

## Token/usage discipline

- Be specific: point to files/doc sections instead of broad searches. Start a fresh session per feature.
- Design for risky areas (tenancy, auth, permissions, leave rules, time tracker rules, AI keys) deserves the strongest model; routine CRUD/UI/tests use the mid-tier; translations/boilerplate the cheapest.
