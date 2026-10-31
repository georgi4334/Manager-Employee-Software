# InTime — project instructions

Employee management SaaS (multi-tenant, GDPR, EU hosting, free tiers). Solo developer + Claude. Repo: `georgi4334/Manager-Employee-Software`.
Source of truth: `docs/data-model.md`, `docs/permission-matrix.md`, `docs/roadmap.md`. Read the relevant section before building a feature; update the docs when a decision changes.

## Stack

- Monorepo: pnpm + Turborepo. Packages: `@intime/web` (apps/web), `@intime/api` (apps/api), `@intime/contracts` (packages/contracts: Zod schemas, permission codes, shared types).
- Web: React 19, TypeScript 6, Vite, React Router (library mode), Zustand (UI state) + TanStack Query (server state), Tailwind with CSS-variable tokens, react-i18next (en, de, bg).
- TypeScript is `~6.0` everywhere (root and `apps/web`, kept aligned). `typescript-eslint` supports `<6.1`, so do not move to TypeScript 7 until it does. TS 6 deprecates `baseUrl`: path aliases use `paths` relative to the tsconfig (`"@/*": ["./src/*"]`).
- API: NestJS 12 (ESM), PostgreSQL + Prisma 7 (pg driver adapter), Row Level Security per tenant, a transactional outbox for notifications (ADR 0004; no pg-boss), own auth module with `jose` (JWT, Google OIDC) and argon2id (`@node-rs/argon2`).

## Commands

- Local DB: `docker compose up -d`; copy `apps/api/.env.example` to `apps/api/.env`; `pnpm --filter @intime/api db:deploy` applies migrations.
- `pnpm dev` at the root builds `@intime/contracts`, keeps it rebuilding (`tsc --watch`) and runs both apps (`apps/web` Vite on :5173, `apps/api` Nest watch on :3000, docs at `/api/docs`); a stale contracts `dist` otherwise shows up as a missing export in the browser.
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
- Web chart (`features/organization/ChartTab.tsx`): an org chart of cards (initials, department badge, More/Less with direct reports, branch size and department, View profile) with a +/− per branch and Expand/Collapse all; on `md+` reports sit side by side under their manager with connector lines and the chart scrolls inside its frame, on phones the cards stack indented. The first two levels start open.

## Leave (docs/adr/0008-leave.md)

- Rules live in `@intime/contracts` as pure functions (`countLeaveDays`, `builtInHolidays`, `proratedAllowance`, `carryOver`) with unit tests; the API only supplies holidays and balances to them. Dates are `YYYY-MM-DD` strings, "today" is the workspace time zone (`todayIn`).
- Counted days are stored per request (`leave_request_day`); balances freeze `entitled`/`carried_over` when first created, used/pending are always sums over request days. Creating a request takes the per-employee advisory lock; overlaps are also enforced by an exclusion constraint.
- Nobody decides their own request (even Admin); approval scope comes from `leave.approve` through `authz` (`ownerEmployeeId`). Sick types never store a reason; masking of the type for colleagues is decided server-side (`hideSickTypeFromTeam`). Notifications and audit never contain reasons, comments or the sick type.
- Deactivating an employee **never withdraws pending requests**: they stay visible and are decided by whoever the reporting line says (the leaver's manager, else HR/Admin). Reports of a leaving manager move up (ADR 0007) and their pending requests are announced once to the new approvers (`LeaveRequestsService.notifyInheritedApprovals`, called from `EmployeesService.deactivate`).
- New built-in holiday keys must be added to `BUILT_IN_HOLIDAY_KEYS` and translated in en/de/bg (a test fails otherwise).

## Attendance (docs/adr/0009-attendance.md)

- Self-reported only: no location, IP or device is ever stored. Times are typed as `HH:MM` in the workspace time zone and stored as instants (`zonedToUtc`/`utcToZoned` in contracts; a time inside a DST gap is `nonexistent_time`).
- The database enforces the rules too: one open record per employee (partial unique index), no overlaps (exclusion constraint, open = infinity), at most 16 h, end after start. The service maps them to `CONFLICT` with `field` `open`/`overlap`.
- Owners type or change their own records only for the last 7 days (`ATTENDANCE_SELF_EDIT_DAYS`); older days and other people's records need `attendance.correct` through `authz`, and nobody corrects their own old records. Corrections are audited (ids only) and notify the owner (`attendance.corrected`: date and action only). `canEdit` in responses is computed for the caller; the UI never decides.
- Lists and presence are scoped with `allowedEmployees`; presence combines today's records with approved leave (`leave_request_day`). Break/overtime rules and exports are out of scope for now.
- Web lists show days, not loose records: `groupAttendanceDays` / `attendanceDayLevel` / `attendanceTarget` / `sortAttendanceDays` / `sortPresence` (contracts, pure) give each person-day a total, an 8-hour line (`DayProgress`) and a level in words (short < 7 h, almost, complete up to 8:15, over; in progress while open; weekends are days off). Informational only.

## Calendar (docs/adr/0010-calendar.md)

- Only events are stored (`calendar_event`: scope `personal` / `team` / `company`). Leave and public holidays are read-only layers the web page merges from the existing scoped endpoints (`/leave/requests`, `/leave/holidays`), so sick-leave masking stays in one place. Recurrence, invitations and find-a-time are in ADR 0028 (below); reminders and sharing beyond guests are not built.
- Visibility is decided in `CalendarService.visibleTo`: personal = owner only, team = members and lead (or `calendar.manage_team_calendars` at scope `all`), company = everybody. An event the caller cannot see is `404`, never `403`. Changes follow `mayManage`: owner (personal), team lead/member or scope `all` (team), `calendar.manage_company_calendar` (company). `canEdit` is computed per caller.
- Every event has local `start_date`/`end_date` (range queries are plain date comparisons); timed events also store instants. Times are typed as `HH:MM` in the workspace time zone like attendance. The database re-checks shapes (all-day vs timed, team iff team scope, 31 days max).
- Team and company changes are audited with ids only (never titles); personal events are not audited.
- Every item opens in `EventDialog` (shared `Modal`) from every view: details for anyone who can see it, Edit/Delete/RSVP inside it only as the server's `canEdit`/`myResponse` allow. Cards carry no inline actions.

## Calendar, advanced (docs/adr/0028-calendar-advanced.md)

- A series is **one `calendar_event` row** with rule columns (`recurrence_freq/interval/weekdays/until/count`, a CHECK keeps them consistent). Occurrences are expanded at read time by the pure functions in `@intime/contracts` (`occurrenceStarts`, `occurrencesIn`, `isOccurrence`); nothing is stored per occurrence. Monthly/yearly on a missing day use the last day of the month. Occurrences carry local dates and times, so a series keeps its local time across daylight saving.
- Edit/delete take `?mode=all|this|following&occurrence=YYYY-MM-DD` (`seriesScopeQuerySchema`). `this` writes a `calendar_event_exception` (an edit also creates a one-off copy), `following` ends the old series the day before and starts a new one (exceptions from the occurrence on move along, `count` is adjusted), the first occurrence turns `following` into `all`. Editing an occurrence "for all" moves the series by the same shift. A non-repeating event with `mode` other than `all` is `VALIDATION_FAILED` (`not_recurring`).
- Guests (`calendar_attendee`, RLS, composite foreign keys, answers `needs_action/accepted/declined/tentative`) exist **only on personal events** (trigger plus service); visibility = owner and guests, everybody else `404`. Guests answer through `PUT /calendar/events/:id/response` (whole series), cannot change or delete the event. A schedule change resets the answers and notifies the guests. Notifications (`calendar.invited`, `calendar.response`, `calendar.changed`) carry ids, the date and the action/answer only, never titles or names. Personal events are still not audited.
- Find-a-time is `POST /calendar/find-time` (`calendar.manage_own`): slots only (30-minute grid, 09:00-18:00 workspace time, at most 10, at most 14 days and 20 people), never the reason someone is busy. Unavailable days come from weekends/holidays of the person's country, working hours (ADR 0026), approved leave and hire/termination dates; busy time from timed events the person organizes or has not declined, company events and their teams' events. The pure `findSlots` lives in contracts.
- Export lists organized events with guests' answers and the invitations the person received; erasure deletes the person's invitations (`tx.calendarAttendee.deleteMany`) and organized personal events.
- Web: repeat fields, guest picker (from the org chart), find-a-time panel and the series-scope choice live in `features/calendar`; the update request carries `recurrence`/`attendeeIds` only when they changed, and never the rule when a single occurrence is edited. Event rows are keyed by event id **and** `occurrenceDate`.
- Event reminders (docs/adr/0029-event-reminders.md): `calendar_event.reminder_minutes` is `60` or `1440` (personal and team events only; a CHECK and `reminder_not_allowed` enforce it), set in the create/update request (`null` removes). The sweep (`remindEvents` in `notifications/delivery/calendar-reminders.ts`, called from `RemindersService`, so from the hourly worker sweep and the external hook, which now also returns `events`) expands occurrences of the next two days, and is due when `eventReminderDue` (`start − lead ≤ now < start`; never after the start). "Once" is the unique `calendar_reminder` row `(event, occurrence_date)` claimed with `createMany(skipDuplicates)`; a changed time or lead deletes the event's claims. Recipients: owner and non-declined guests (personal), lead and members (team), active people with an account only. `calendar.reminder` carries the event id and date, never the title. Granularity is one hour and the form says so.
- Public holidays layer (docs/adr/0035-public-holidays-feed.md): `GET /calendar/public-holidays?from&to&language` (`calendar.manage_own`, 93 days) returns Bulgaria, Germany and **England** (`GB`) from openholidaysapi.org. Only the API calls it (`HolidayFeedClient` DI token, fixed host, tests use a fake and `PUBLIC_HOLIDAYS_FEED=false`); a request carries country, year and language only. Nationwide holidays only (GB: whole kingdom plus `GB-ENG`); cached 24 h in memory, stale copy on failure, else built-in BG/DE (`source: 'builtin'`). **Informational: leave counting, balances and capacity never read it.** `test/holiday-feed.live.test.ts` checks the real feed only with `HOLIDAY_FEED_LIVE=1` (`.github/workflows/holiday-feed.yml`, weekly and on demand). The web page shows one toggle per country next to the "Public holidays" layer and still merges the workspace's own custom days from `/leave/holidays`.
- ICS, rooms and per-occurrence answers are out of scope.

## Privacy (docs/adr/0011-gdpr-export-erasure.md)

- Export is `GET /privacy/export` (own, `gdpr.export_own`) or `/privacy/export/:employeeId` (HR/Admin, `gdpr.export_employee`, audited). It is built from `PrivacyService.collect`: **add every new table that holds personal data of an employee to the export and to `ErasureService`** (and to the erasure test's "nothing of Dan is left" check).
- Erasure anonymises an inactive employee irreversibly (`POST /privacy/erase/:employeeId`, `{ confirm: true }`): it clears identifying and free-text data and keeps statutory records (hire/termination dates, attendance times, leave days) detached from the person. It runs on the system connection, allowed only in `modules/privacy/erasure.service.ts` (ESLint); every statement there must be scoped by `tenantId`.
- Audit entries and notifications carry only ids and non-identifying labels; names in notification params (`employeeName`) are replaced on erasure. Never put free text (titles, notes, reasons) into audit or notification params.
- Automatic retention exists for **Bulgaria only** (ADR 0027, below); other countries need a reviewed preset first.

## End-to-end and accessibility (docs/adr/0012-e2e-and-accessibility.md)

- `e2e/` (Playwright, Chromium) is a separate package, not part of `pnpm test`: `pnpm --filter @intime/e2e e2e` (needs `E2E_DATABASE_URL`, a Postgres owner URL, and a built API; locally `PW_CHROMIUM` can point at an installed Chromium). It starts its own API (fresh database, real `tenant:create`, log mail transport) and the Vite dev server; specs run in order. Use roles and visible labels as selectors.
- `06-accessibility.spec.ts` scans every page with axe (WCAG 2.1 A/AA, phone and desktop, light and dark). A new page must be added to its list (`e2e/support/pages.ts`); fix violations in the components or the design tokens, never by excluding rules. `08-layout.spec.ts` opens the same pages in German on a 375px phone and fails on horizontal scrolling (headings wrap long words via `globals.css`).

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

## Time tracker (docs/adr/0015-time-tracker.md)

- `time_entry` and `timesheet` (RLS). Self-reported only: nothing but the entry is stored (no idle detection, location or device). A running timer is a `timer` entry with `started_at` set and `minutes` null (one per person, partial unique index); stopping rounds up to whole minutes, at least 1, capped at 16 h (`timerMinutes` in contracts). `work_date` is the workspace-local date the entry started on.
- Timesheets are per employee and Monday-based week (`weekStartOf`), created on first submit; entries belong to the sheet of their week by date, not by a link. `submitted` and `approved` lock the week (`CONFLICT`, `field: locked`) for create, change, delete, timer start and moving an entry in or out; `rejected` and `open` (reopened) are editable. Never lock-check by hand: use `assertUnlocked`.
- Logging needs an active employee record, a project the person is staffed on or leads, not a finished project; the task must belong to the project (trigger plus `task_not_in_project`). A day holds at most 24 h (`day_too_long`, per-employee advisory lock `lockEmployee`). Own entries only: other people's are `404`, also for managers, HR and Admin.
- Approval goes through `authz` on the owner with `timesheet.approve`; **nobody decides or reopens their own sheet**, whatever the role; out-of-scope sheets are `404`. `timesheet.decided` notifications carry the week and the decision only. Audit has ids and the week, never notes.
- Deactivation stops a running timer (`TimeService.onEmployeeDeactivated`); the export lists entries and sheets; erasure clears notes and keeps hours detached from the person.
- Web: `/time` (My time: timer, week navigator, entries, submit; Approvals tab). My time shows `WeekChart` instead of a day list: billable vs not billable hours per day, an 8-hour line, a per-project split (pure `timeWeekChart` in contracts, finished entries only, informational; entries hold hours not clock times). Each day is a button that lists that day's entries (edit/delete/add) under the chart; `openDay` picks the day to open on. Durations are typed as `1:30` or `1.5` (`parseDuration`/`formatDuration`, pure and tested). Reports, CSV export and budgets are the next step (Time reports).

## Time reports (docs/adr/0016-time-reports.md)

- No new tables: reports are queries over `time_entry` (finished entries only) joined to `timesheet` for the approved share (`TimeReportsService`). Project and client reports need `time.report_project` (scope `all`, otherwise only projects led by people inside the scope; clients also need `client.view`), person reports need `time.view` (people in scope). A project outside the caller's scope is `404`.
- `GET /time/week` and `GET /time/reports` are `@Authenticated()` and check their permission in the service: the permission guard requires **all** listed codes, so "this or that" must not use `@RequirePermission(a, b)`.
- Budget versus actual is `budgetUsage` in contracts (`ok` below 80 %, `warning` up to 100 %, `over` above); logged minutes are all-time, not the period. The page says the level in words.
- The CSV export (`time.export`, same project scoping) returns JSON rows of **approved** hours without notes; contracts' `timeExportCsv` builds the file (quotes, line breaks, formula neutralising) and the browser saves it. Every export is audited (`time.exported`: period, project id, row count).
- Web routes carry their own guards (`/tasks`: `task.view`; `/time`: `time.log` or `time.view`), never the project guard. Daily targets wait for the Integrations step.

## Integrations (docs/adr/0017-integrations.md)

- Everything here is **informational**: nothing blocks, changes or reports by itself, and nothing new is collected.
- Leave conflicts: `GET /leave/requests/:id/conflicts` (`leave.approve` scope over the owner, else `404`) lists staffed projects, open milestones and the owner's open tasks that fall in the dates. Each part is filtered through `ProjectAccess` (`project.view` / `task.view`); tasks show reference and date, never the title.
- Attendance versus logged time: `GET /time/compare` (`@Authenticated()`, checked in the service) shows one week for yourself (needs `attendance.view` and `time.log`/`time.view`) or for people covered by **both** `attendance.view` and `time.view`; otherwise `404`. `compareDay` (contracts) flags only differences above 30 minutes and never approved-leave days, open records or empty days. No lists across people, no export, no notification.
- Reminders: `RemindersService` (in `notifications/delivery`, the only code besides auth allowed to use the system connection, and only to list workspaces) reports an attendance record open for 12 h and a timer running for 10 h, **once** (`reminded_at`, claimed with a conditional update). It runs from the worker's hourly sweep while the API is active and from `POST /api/v1/internal/reminders/run` (`@Public()`, bearer `REMINDERS_TOKEN`, constant-time compare, `404` when unset, `401` otherwise). `.github/workflows/reminders.yml` is the hourly pinger (needs variable `REMINDERS_URL` and secret `REMINDERS_TOKEN`). `RemindersService` must not depend on `OutboxService` (the worker depends on it): it queues events with `outboxEvent.createMany`.
- A new notification type needs a text in `NotificationText`, a settings entry and en/de/bg `notifications.json` keys: a web test walks the whole catalog and fails otherwise.

## Capacity (docs/adr/0018-capacity.md)

- Computed, never stored (no table, nothing to export or erase). The model is pure functions in `@intime/contracts` (`capacity.ts`): `workingMinutes` (weekends, holidays of the person's country, hire and termination dates), `availableMinutes` (minus approved leave; pending leave changes nothing), `plannedMinutes` (each covering assignment claims its percentage of the available time, rounded **per assignment** so project parts add up to the whole), `loadLevel` / `dayStatus`.
- Everybody without a schedule is measured against the standard **8-hour day** (`WORKDAY_MINUTES`); per-person hours override it (ADR 0026).
- `GET /capacity` (`capacity.view`; people = active employees inside the scope via `allowedEmployees`; period at most 31 days). The per-project breakdown shows only projects the caller may see (`project.view`); the rest is one row without an id so totals still add up. A `projectId` the caller cannot see is `404`. Over-booking is information, never a block.
- Week navigation (Capacity and My time) is the shared `WeekNav` (`shared/ui/week-nav.tsx`): Previous/Next are icon buttons that never move; "This week" keeps its place and is only hidden (`invisible`, `aria-hidden`, disabled) in the current week.
- Web: `/capacity` has its own route guard (`capacity.view`); cards, a week at a time, no wide table. A person card shows initials, level, a planned-versus-available bar and four figures; "Days and projects" is a collapsed `details` with day-by-day planned/logged bars and a per-project split (values always in text).

## Goals (docs/adr/0019-goals.md)

- `goal`, `key_result`, `goal_update` (all RLS, composite foreign keys). Scope `personal` / `team` / `company`. Progress is **computed**, never stored: a key result is `(current − start) / (target − start)` clamped 0–100; a goal with key results is their average, otherwise its manual `progress_pct` (pure functions `keyResultProgress`, `goalProgress`, `canAlign`, `isGoalOverdue` in contracts).
- Alignment only goes to a strictly wider scope (personal → team/company, team → company), checked in the service (`parent_not_wider`, `parent_not_found`) and by a DB trigger; the parent must be visible to the caller. A goal that others align to cannot be deleted (`CONFLICT`, `field: children`).
- Visibility in `GoalsService.visibleWhere`: company = everybody with `goal.view`; team = members and lead (scope `all` sees all); personal = owner and whoever's `goal.view` scope reaches the owner. Invisible = `404`. Manage rights: personal through `authz` on the owner; team only the **lead** or scope `all` (members cannot); company only `goal.manage_company`. Key results and check-ins follow manage rights; a key result is always looked up through its own goal.
- Setting a goal for someone else notifies them (`goal.assigned`, goal id only). Audit has ids, scope and field names, never titles. Deactivation cancels open personal goals; deleting a team deletes its team goals (aligned goals are released first); the export lists personal goals and check-ins, erasure deletes personal goals and clears check-in comments.
- Web: `/goals` (scope chips, status filter, search; the "All" view is grouped company → team → personal — the API pages it group after group (`pageAcrossGroups`, `GOAL_GROUP_ORDER`) and returns `scopeTotals` for the headings, each goal a card with a scope edge/icon, status pill, progress bar coloured by state and a meta line) and `/goals/:id` (key results with inline current value, check-ins, alignment), own `goal.view` guard. Feedback and Skills follow in Phase 3.

## 1:1 meetings (docs/adr/0020-one-on-ones.md)

- `one_on_one` and `one_on_one_action_item` (RLS, composite foreign keys). Two participants only, fixed at creation: the employee and their **direct manager at that moment**. Everybody else, HR and Admin included, gets `404`; every lookup goes through the caller's own participation (`OneOnOnesService.find`). `one_on_one.manage` is `own` (Employee) or `reports` (Manager, HR, Admin) and never wider.
- **Private notes** live in `private_notes_manager` / `private_notes_employee`; a response carries only the caller's own (`privateNotes`). Agenda, shared notes, time, duration and status are shared. A cancelled meeting is locked (`CONFLICT`, `field: status`).
- An employee schedules with their own manager (`no_manager` if none), a manager with a direct report. Times are `HH:MM` in the workspace time zone (`nonexistent_time`). `one_on_one.changed` (meeting id, date, action only) goes to the other person on schedule, reschedule and cancel; notes and action items notify nobody. **No audit entries**: a 1:1 is a conversation, not an admin action.
- An action item belongs to one of the two participants (DB trigger plus `not_participant`), at most 20 per meeting under an advisory lock, always looked up through its own meeting.
- Deactivation and a manager change cancel `scheduled` meetings (`onEmployeeDeactivated`, and inline in `OrganizationService.assign`); held ones stay with the people who held them. Export lists the person's meetings with **their own** private notes; erasure deletes every meeting they took part in.
- Web: `/one-on-ones` and `/one-on-ones/:id` with their own `one_on_one.manage` guard. Recurring series, calendar events and reminders come later (Phase 5).

## Feedback (docs/adr/0021-feedback.md)

- `feedback` (RLS, composite foreign keys): named, no anonymous feedback, no edits (take it back and write again). `kind` `praise` / `constructive`; the giver picks `visibility` `recipient` or `recipient_and_manager` and cannot widen it later.
- Readers: the giver and the recipient; the recipient's manager (`feedback.view_received` at `reports`) and HR (`all`) read **only** `recipient_and_manager` items through `authz` on the recipient (`403` otherwise); Admin has no read grant. A moderator (`feedback.moderate`: HR, Admin) sees an item only after the **recipient reported it** (`reported_at`), and never decides on their own feedback (given or received). Moderators keep (`kept_at`, closes the report for good) or remove; removal is the only audited action (ids and kind, never the text).
- One list endpoint (`GET /feedback?box=received|given|reported`) is `@Authenticated()` and checks the box's permission in the service. `feedback.received` notifies the recipient with the feedback id only (not who, not kind).
- Export lists feedback given and received (with the other person's name); erasure deletes every item the person gave or received.
- Web: `/feedback` with Received / Given / Reported tabs (the last for moderators), a give form, own guard (`feedback.give` or `feedback.view_received`); the recipient list comes from the org chart.

## Skills matrix (docs/adr/0022-skills-matrix.md)

- `skill_category`, `skill`, `employee_skill` (all RLS, composite foreign keys). Names belong to the workspace, are **not translated** and unique without regard to case (checked in the service in memory, plus a unique index). Levels 1–5 have fixed meanings translated in the web app; `assessed_by` shows a self-assessment (`selfAssessed`); the last writer wins, no history.
- Catalog changes need `skill.manage_catalog` (HR, Admin; route permission) and are audited with ids and field names, never names. A skill is deleted only while nobody rated it, a category only while empty (`CONFLICT`, `field: in_use`); an archived skill keeps its ratings but cannot be newly rated (`skill_archived`).
- Reading and rating go through `authz` on the **employee**: `skill.view` / `skill.update` at `own` (Employee), `team` (Manager: self, reports and their reports) or `all`. A person outside the scope is `404` for reads and rating; inactive people are not listed. Ratings are personal data: not audited, exported with category/skill/level, deleted on erasure.
- `GET /skills/people` filters by category, skill + minimum level (`minLevel` needs `skillId`) and name; web shows cards, never a wide table. Project skill requirements and staffing suggestions are later.
- Web: `/skills` with tabs My skills / People / Catalog (the last for catalog managers), own `skill.view` guard.

## Performance reviews (docs/adr/0023-performance-reviews.md)

- `review_cycle`, `review_competency` (belongs to a cycle, no global catalog), `review` (one per employee and cycle), `review_rating` (RLS, composite foreign keys; a trigger keeps a rating on a competency of the review's own cycle). Cycle status only moves forward, one step: `draft → open → calibration → closed` (`canMoveCycle`, claimed with a conditional update). Competencies and dates change only in `draft`; opening creates a review for every active employee who had started by `period_end` and queues `review.cycle_opened`; closing releases every review whose manager part is submitted (`released_at`, `review.released`).
- Writing: the self part by the employee only (`review.write_self`), the manager part through `authz` on the employee with `review.write_for_report` — **nobody writes the manager part of, calibrates or reopens their own review**. Drafts may be partial; **submit** needs every competency scored (and an overall rating for the manager) and locks the part. Rows are locked (`FOR UPDATE`) while writing.
- Visibility is the pure function `reviewVisibility` (contracts): the employee sees their own part always and the manager part, final rating **only after release**; reviewers see a part once submitted (their own manager draft too); calibrators (`review.calibrate`) see calibrated ratings. The final rating is `calibrated ?? overall`. `managerSubmitted` is `null` for an employee before release. Reviews the caller may not see are `404`; draft cycles are visible to `review.manage_cycles` only.
- Audit has cycle steps, calibration (`cleared` only) and reopening (`part`) — never ratings or texts. Notifications carry the cycle or review id only. Export: own self part always, manager part only once released; erasure deletes the reviews about the person.
- Web: `/reviews` (tabs My reviews / Team / All reviews / Cycles by scope and permission) and `/reviews/:id` (editor, read view, calibration, reopen), own `review.view` guard. Moving a cycle always asks for confirmation. Shared pieces in `features/reviews/ui.tsx`: `StatusPill` and a status edge per cycle stage, `ReviewSteps` (self-review → manager review → released, each state in words; `compact` in list cards), `RatingDots`, `ScoreBar` (5 segments + number + words). Review cards are a grid with a stretched link; cycle cards show the four stages, dates and progress bars; the review page has a header with the final-rating panel and one card per part with its state.

## Analytics (docs/adr/0024-analytics.md)

- Read-only and computed, never stored (no table, nothing to export or erase). `GET /analytics?from&to` (`analytics.view_team`, period at most 366 days) returns **counts and sums only**: no names, no per-person rows, no ratings, no free text. Pure helpers in `@intime/contracts` (`analytics.ts`: `suppressSmallGroup`, `percentOf`, `weekStarts`, `bucketByWeek`).
- Population = active employees inside the caller's `analytics.view_team` scope (`allowedEmployees`); activity figures include people who left during the period. **Breakdowns (department, employment type, leave type, attendance mode) are `null` when the population is below `MIN_GROUP_SIZE` (5)**; totals stay.
- Projects and tasks are filtered through `ProjectAccess.visibleWhere` (`project.view` / `task.view`). The `company` block (goals by status, newest review cycle progress as counts) is `null` unless the caller holds `analytics.view_company` (HR, Admin).
- Web: `/analytics` with its own `analytics.view_team` guard, a period select (7/30/90/365 days), stat cards and CSS bars that always carry the value in text (no chart library). A new figure must say in words when it is withheld.

## AI assistant (docs/adr/0025-ai-assistant.md)

- `ai_workspace_setting`, `ai_credential`, `ai_user_setting`, `ai_conversation`, `ai_message` (all RLS, composite foreign keys). **Off by default**: the workspace switch (`ai.toggle_tenant`, audited) must be on, and each person must have accepted the notice (`ai_user_setting.consent_version` = `AI_LIMITS.consentVersion`; raising it asks everybody again). Errors: `AI_DISABLED`, `AI_CONSENT_REQUIRED`, `AI_NOT_CONFIGURED`, `AI_PROVIDER_ERROR` (params.reason is a status class, never the provider's text), `RATE_LIMITED` (30 messages per hour per person).
- **Bring your own key**: the person's key, else the workspace key. Providers are a fixed allowlist with fixed base URLs (`AI_PROVIDER_BASE_URLS`; never accept a URL from a client). Keys are AES-256-GCM encrypted with `AI_KEY_ENCRYPTION_KEY` (`ai-crypto.ts`, tenant|scope|user bound as AAD), **never returned, logged or audited** (the API shows provider, model and last four characters). Audit has scope and provider only.
- **The assistant acts as the user**: the model only calls read-only tools (`AiToolsService`) that run existing services with the caller's `RequestAuth`, so scopes, masking and 404s hold. Tools about other people are offered only when the person set `share_people_data`; unknown or not-offered tool names are answered with an error, not run. Tool results are trimmed to a few fields, capped (`toolResultMaxChars`) and never stored; only the question and the final answer are kept. Max 4 tool rounds, then one answer without tools. A new tool = definition + executor in `ai-tools.service.ts`, name in `AI_OWN_TOOLS` / `AI_PEOPLE_TOOLS`, label in `assistant.json` `tools`, and a test with the people-scope case.
- The provider is behind `AiProviderClient` (DI token): tests and e2e never reach a real provider (tests use a fake; no e2e spec sends a question). Conversations are visible to their owner only (everybody else `404`), purged after the workspace retention on every chat; export lists them (never the key) and erasure deletes conversations, key and consent.
- Web: `/assistant` (`ai.use` guard): Chat and Settings tabs; answers are rendered as plain text, never HTML.

## Working hours (docs/adr/0026-working-hours.md)

- `work_schedule` (RLS, composite foreign key): effective-dated weekly minutes, Monday first (`minutes` has exactly 7 values, 0–960). The schedule in force on a date is the row with the latest `valid_from` on or before it (`scheduleFor`, `scheduledMinutes` in contracts); **no row = the default week, 8 h Monday to Friday** (`DEFAULT_WEEK`), so nobody needs a migration. Changes are new rows (past weeks keep their hours); the same date replaces; at most 50 rows per person (`CONFLICT`, `field: limit`).
- Capacity uses it: `workingMinutes(date, { scheduledMinutes })` (a weekend can be a working day; a half-day holiday halves the scheduled minutes), leave takes its fraction of **that day's** scheduled minutes (`availableMinutes(working, leave, dayMinutes)`). Leave day counting (ADR 0008) is unchanged (Monday to Friday).
- **Overtime is informational**: per day `max(0, logged − available)`, summed (`overtimeMinutes`, `CapacityPerson.overtimeMinutes`); a day off counts in full. Never blocks, never approved, no statutory caps.
- Read: `employee.view_profile_full` covering the person (else `404`); change: `employee.manage_schedule` (HR, Admin; audited with employee id and `valid_from`, never the minutes). `GET|PUT /employees/:id/schedule`, `DELETE /employees/:id/schedule/:scheduleId`. Export lists schedules; erasure deletes them.
- Web: the "Working hours" card on the employee profile (only when the profile is visible, `h:mm`/`7,5` typed; empty = day off).

## Retention, Bulgaria (docs/adr/0027-retention-bulgaria.md)

- `retention_policy` (RLS, one row per workspace; no row = Bulgarian preset, **off**) and `employee.retention_hold`. Country is `BG` only (API and a check constraint); the period is 12–600 months, preset `RETENTION_PRESETS.BG` = 60. The numbers are product defaults, **not legal advice**; the page says so and the employer confirms them.
- What it does: a former employee (`inactive`, termination date set, not on hold, not erased) is anonymised through the existing `ErasureService` (ADR 0011) once `isRetentionDue(termination, months, today)`; hire/termination dates, attendance times and leave days stay detached. People without a termination date are never erased automatically.
- `RetentionRunner` (the only extra code allowed to use the system connection, to list workspaces) runs from the worker's hourly sweep and from `POST /internal/reminders/run` (which now also returns `erased`). Per workspace: checked once a day (`lastRunAt`), at most `RETENTION_BATCH` (25) people per run (a full batch leaves `lastRunAt` alone so the next hour continues). Audit: `privacy.erased` with **no actor** and `{ reason: 'retention' }`. A hold is also checked in the erasure's conditional update (reactivated or held people lose the race cleanly). HR can still erase a person on hold by hand.
- `GET|PUT /privacy/retention`, `PUT /privacy/retention/holds/:employeeId` need `gdpr.manage_retention` (HR, Admin); changes are audited (policy values, hold set/released with ids only). The preview lists who is due now or within 90 days (names HR already sees).
- Web: `/retention` (own `gdpr.manage_retention` guard; turning on asks for confirmation; hold buttons per person).

## Compensation (docs/adr/0030-compensation.md) — security critical

- `compensation` (RLS, composite foreign key): effective-dated records like working hours (`compensationFor`: latest `valid_from` on or before a date; the same date replaces; at most 50 per person). `basis` monthly/yearly/hourly, `amount_minor` a whole number of minor units (1 to 100 000 000 000, never floating point), `currency` from a fixed list (default EUR). **Records only: nothing computes pay, and no other module reads these numbers** (time reports, capacity and analytics stay in hours).
- Money text goes through the pure `parseMoney`/`moneyInput` in contracts (and `formatMoney` in `shared/lib/format.ts` for display). `parseMoney` refuses what is ambiguous (`1.234`, `10.505`: a lone separator with three digits) because a wrong guess is a hundredfold error.
- `GET|PUT /employees/:id/compensation`, `DELETE …/:rowId` need `compensation.view` / `compensation.manage` (HR and Admin, scope `all`, route permission **and** `authz.assert` on the owner); everybody else gets `403` and never sees the card. **Nobody changes their own pay** (`FORBIDDEN`, also Admin and HR); another HR/Admin does. Responses are `Cache-Control: no-store`; the employee profile response carries no pay.
- Audit (`compensation.set` / `compensation.removed`) has the employee id, `valid_from`, basis and currency, **never the amount**; no notification; amounts are never logged or put in an error. Export: the person always gets their own rows; an HR export (`gdpr.export_employee`) includes them only when the caller also holds `compensation.view`. Erasure deletes the rows; deactivation keeps them.
- Web: `CompensationCard` on the employee profile, rendered only with `compensation.view` (and not requested otherwise), `gcTime: 0` so pay is not kept in the cache; editing hidden on one's own profile (cosmetic).

## Role editor (docs/adr/0031-role-editor.md) — security critical

- Custom roles are `role` rows with `is_system = false` and no `key`; their grants are `role_permission` rows validated against the catalog (`roleRequestSchema`: known code, an allowed scope, each code once). **System roles are read-only** (`FORBIDDEN`); the API is `GET /roles`, `GET /roles/:id` (`admin.role.view`) and `POST|PUT|DELETE /roles` (`admin.role.manage`, Admin by default) in `modules/roles` (`RolesController`, `RolesAdminService`); `GET /roles` moved out of `UsersController`.
- **Nobody grants what they do not hold**: `escalations(actor.permissions, current, requested)` (contracts) flags every grant that is new or wider than the role already has and that the actor does not hold at that scope or wider; the service answers `FORBIDDEN` with detail `cannot_grant`. Unchanged and narrower grants are never escalations (a limited editor can still rename a role or remove grants). So permissions Admin does not hold (e.g. `feedback.view_received`) can never be put into a custom role.
- **No lock-out**: updates take `UserRolesService.lockAdministrators` (the same advisory lock as `UsersService`; `ADMIN_POWER = admin.role.assign` and `countAdministrators` live there), and a change that removes `admin.role.assign` is rolled back with `LAST_ADMIN` unless an active administrator remains. A role is deleted only while nobody holds it (`CONFLICT`, `field: in_use`); names are unique without regard to case, also against system role names (`field: name`); at most 30 custom roles (`field: limit`).
- Audit `role.created|updated|deleted` has the role id and `code:scope` strings of what changed, **never the name or description**. Changes apply to the next request of everybody holding the role.
- Web: `/roles` (list cards), `/roles/:id` (read-only grid for system roles and viewers; editor + delete for custom roles with `admin.role.manage`), `/roles/new` (can start from a copy: only what the user may hand out is copied). The permission grid disables scopes the user does not hold (cosmetic). **Every permission, module and scope needs a text in `roles.json` (en/de/bg)**: `labels.test.ts` walks the catalog and fails otherwise. Editing system roles, per-user overrides and role history are out of scope.

## Role hierarchy (docs/adr/0036-role-hierarchy.md) — security critical

- `role.parent_id` (composite foreign key, cycle trigger) places a role in a tree. **Display only: authorization never reads it**, nothing is inherited; moves are `PUT /roles/:id/parent` (`admin.role.manage`, any role incl. system roles), `parentId` on create/update, audited `role.moved` (ids only). Cycles are `VALIDATION_FAILED` `role_cycle` (checked under the `role-tree` advisory lock, `wouldCycle` in contracts); deleting a role moves its sub-roles up. New workspaces start with Admin > HR > Manager > Employee (`SYSTEM_ROLE_PARENTS`); `roles:sync` never moves a role.
- `admin.role.manage` is HR and Admin. **Nobody assigns a custom role they could not have built**: invitations and `PUT /users/:id/roles` check newly assigned custom roles with `escalations` (`FORBIDDEN`, `cannot_assign`; `UserRolesService.assertMayAssign`); system roles are exempt. This keeps HR-only grants (`feedback.view_received`) away from Admin.
- Web: `/roles` is an org chart (`RoleTree`: roots on top, direct sub-roles as columns, deeper levels stacked; cards with people, permissions, sub-roles and modules; Hide/Show per branch), `MoveRoleDialog` and a "Sits under" select in the editor (`parentOptions` never offers the role itself or its sub-roles; options read as paths, `Admin › HR › Manager`).

## Motion (docs/adr/0032-motion.md)

- CSS only (transform/opacity); curves and durations are tokens in `tokens.css` (`--ease-ios`, `--ease-spring`, `--dur-*`). Never animate width, height, top or left.
- Anything that appears and disappears (drawer, sheet, menu, popover, toast) uses `usePresence(open, exitMs)` and a `motion-*` class from `globals.css` with `data-state`, not a bare `{open && …}`. Tabs are `TabList`/`TabPanel` (`shared/ui/tabs.tsx`), never hand-written.
- Reduced motion is honoured in CSS and in `usePresence`; unit tests run without motion; Playwright specs run with `reducedMotion: 'reduce'` (only `07-motion.spec.ts` turns motion on).
- The notification toast says how many, never what; it skips the first answer and the inbox page.

## Visual style (docs/adr/0033-visual-style.md)

- Colours and radii live only in `tokens.css`. Dark side panel (`bg-sidebar`, `text-sidebar-*`) with a curved content panel; cards outlined (`rounded-xl border`), secondary buttons outlined, tabs an orange pill. `--primary` carries text (AA); `--brand` is for fills without text.
- A new colour pair must be checked for 4.5:1 in light and dark before it is used for text.
- Progress (ADR 0033): target-based values use `TargetBar` (marker + striped overflow), the one number of a card `Capsule` (glass tube), dated sequences `MilestoneTrack` (evenly spaced, Today pin, vertical on phones), an attendance day `DayRibbon` (clock blocks). All are decoration: values and states are written in text.
- **Liquid glass**: information containers use the `.glass` class (and `.glass-hover` when interactive) over the tinted `.glass-canvas` content panel, never `border border-border bg-surface shadow-card`. Inputs, alerts, drop-downs and the calendar grids stay solid; reduced transparency and missing `backdrop-filter` fall back to `--glass-solid`.
- The logo is `LogoMark`/`Logo` (`shared/ui/logo.tsx`); `public/favicon.svg` and the splash copy in `index.html` repeat the drawing, so change all three together. Buttons come only from `Button` (filled variants carry a thin light line inside the edge: `.btn-ring` with `--btn-bg`). Every drop-down (menu, popover, picker, drawer list) uses `.menu-panel` / `.menu-item` (white with an orange wash, raised active item; tokens `--menu-*`); native selects get the same open list through `appearance: base-select` where supported. Sub-pages (details, forms, settings) start with `BackLink` (`shared/ui/back-link.tsx`, outlined pill with an arrow) to their list, never a bare text link. Boot shows `Splash` (the static copy in `index.html` has an inline `<style>` whose colours a test keeps equal to the tokens; redirects and loading keep the splash, never an empty frame); card pages show skeletons (`shared/ui/skeleton.tsx`) inside one `SkeletonGroup` (`role="status"`), never a bare "Loading…" line.

## Dashboard (docs/adr/0034-dashboard.md)

- One layout per workspace: `dashboard_layout` (RLS, `widgets text[]`, ≤ 50; no row = `DEFAULT_DASHBOARD`). `GET /dashboard/layout` is `@Authenticated()` (answers `canEdit`); `PUT`/`DELETE` need `admin.tenant.settings` and are audited (`dashboard.updated` with ids, `dashboard.reset`). No personal data: not exported or erased.
- The catalog is `DASHBOARD_WIDGETS` in contracts; unknown or repeated ids are refused, stored ids that left the catalog are dropped on read (`normalizeLayout`). A new widget = id in contracts + component and permission in `features/dashboard/widgets.tsx` + en/de/bg texts in `dashboard.json`.
- Widgets read through the existing endpoints with the viewer's rights and are hidden without their permission (cosmetic). Charts are hand-made SVG/CSS, `aria-hidden`, with the values in text. Editing uses buttons (move up/down, remove, add), not drag and drop. The test server answers an empty layout by default.

## Deployment (docs/adr/0005-deployment.md, docs/deployment.md)

- Free EU stack: Cloudflare Pages (web + `/api` proxy function in `apps/web/functions`, logic in `apps/web/edge`), Render (API, `render.yaml`), Neon (Postgres), Resend (email). Releases only through `.github/workflows/deploy.yml` on `main` after CI (gated by repo variable `DEPLOY_ENABLED`).
- Migrations run before the new code: keep every migration compatible with the previous release (expand, then contract). Never edit a deployed migration.
- Production env: `MAIL_TRANSPORT=resend`, `TRUST_PROXY_HOPS=2` (Render + proxy function). New env vars go in `config/env.ts`, `.env.example`, `render.yaml` and the runbook.

## Web conventions (apps/web)

- Call the API only through `apiRequest` (`shared/api/client.ts`); never `fetch` directly, never store tokens in JS/localStorage. Server data goes through TanStack Query; who is signed in is `useCurrentUser()`.
- API errors are shown with `useMessages().apiError(error)` (keys `errors:api.<CODE>`). A new `ErrorCode` in `@intime/contracts` fails typecheck until it is translated in en/de/bg.
- Forms: react-hook-form + `zodResolver` with schemas in `features/*/forms.ts` whose messages are keys of `errors:validation` (not text). Keep them in line with the API schemas; add a parity test.
- Reusable UI: `shared/ui` (Button, Card, Input, Field, Alert, PasswordInput). Inputs use a 16px font on mobile; every control is at least 44px high.
- Component tests use the shared MSW server in `tests/server.ts` (signed in by default; `signedOutHandlers()` for visitors; neutral `defaultHandlers` for side reads like the org chart) and `renderApp(path)` from `tests/utils.tsx`, which waits for the first requests. Use `findBy…` for anything that happens after navigation (waits up to 3 s). **An API call no handler answers fails the test** (`tests/setup.ts`): mock it in the test or add a neutral default.
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
