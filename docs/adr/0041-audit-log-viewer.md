# ADR 0041: Audit log viewer

Status: accepted (2026-11-03)

## Context

Since ADR 0003 every administrative change writes an append-only `audit_log` row (actor user id, a dotted action,
entity, entity id, `before`/`after` with ids, field names, scopes and statuses only). Nobody can read it in the app:
the permission `admin.audit_log.view` (HR and Admin, scope `all`) exists, described as "HR sees HR-related events
only", but there is no page and no endpoint. Administrators need to answer "who changed this, and when?".

## Decision

- **No new table, no migration.** `GET /api/v1/audit-log` (`@RequirePermission('admin.audit_log.view')`,
  `Cache-Control: no-store`) reads the existing table through `TenantDb` (RLS), newest first.
- **A catalog of actions** (`AUDIT_AREAS` in `@intime/contracts`): every recorded action belongs to exactly one
  area (workspace, users, roles, people, compensation, privacy, leave, attendance, time, projects, calendar, goals,
  reviews, feedback, skills, checklists). `AuditService.record` only accepts an `AuditAction` from it, so a new action
  fails typecheck until it has an area, and a web test fails until it has an en/de/bg text.
- **Who sees what** (`visibleAuditAreas`, pure and tested): `admin.audit_log.view` at scope `all` **and** the area's
  own administrative permission at scope `all` (e.g. `compensation.view` for pay, `admin.tenant.settings` for the
  workspace, `gdpr.export_employee` for data protection, `feedback.moderate` for feedback). People see the history of
  what they administer. With the default roles Admin sees every area and HR every area except the workspace
  settings, which makes "HR sees HR-related events only" concrete. Asking for an area one may not see is `403`
  `FORBIDDEN`; rows whose action is outside the catalog (older or unknown) are never returned.
- **Filters**: `area`, `from`/`to` (workspace-local days, both included; `to` before `from` is `VALIDATION_FAILED`),
  `entityId` (the history of one record), `actorUserId` (what one person did), `page`/`pageSize` (≤ 100).
- **Names are looked up at read time, never stored**: the actor's current employee name (null for the system and for
  accounts without an employee), and for entries about an employee that person's name. An erased person
  (`erased_at`) shows no name, so erasure (ADR 0011) keeps working without rewriting the log. `before`/`after` are
  returned as stored; ADR 0003's rule that they hold ids and field names only is what keeps them safe to show.
- **Read-only**: nothing in the viewer writes, and reading the log is not itself audited.

## Web

`/audit-log` (menu entry "Audit log" in Administration, own `admin.audit_log.view` guard). Filters live in the
address (`area`, `from`, `to`, `entity`, `actor`, `page`); entries are grouped by workspace day with the time, the
translated action, who did it (a link to their profile) and whom it is about; "Recorded data" opens the stored
before/after as plain text, with "History of this record" and "More by this person" as filters. Phones get the same
single column.

Card design (2026-11-04): each day is a timeline (a line with one dot per entry; green = something added, red =
removed, orange = changed, decoration only since the action is in words). A card shows the area's icon, the action
and area, the actor's initials and name, whom it is about as a chip, and the time with a "Recorded data" toggle in the
header. Opened, the stored data shows changed field names as chips and one row per key with the value before (struck
through) and after; the actions are "History of this record", the profiles of the actor and the person, and "More by
this person".

## Consequences

- New audited actions need an entry in `AUDIT_AREAS` and texts in `audit.json` (en/de/bg).
- Export to CSV, retention of audit rows, and alerts on actions are out of scope.
