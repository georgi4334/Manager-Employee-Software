# ADR 0011 — GDPR: data export and erasure of employee data

Status: accepted · Phase 1 step 7 (Hardening, part 1) · Builds on [ADR 0003](0003-roles-and-permissions.md), [0004](0004-notifications.md), [0006](0006-employees.md)–[0010](0010-calendar.md)

## Context

Every person has the right to a copy of their data (Art. 15/20) and, where the law allows, to have it erased
(Art. 17). An employer must however keep some employment records (working time, leave, payroll relevant dates)
for statutory periods, so "erase" cannot mean "delete every row". Decision: **export is self-service and HR-assisted;
erasure is irreversible anonymisation of a former employee** that removes everything identifying and everything
discretionary, and keeps the minimal records the law requires, detached from the person.

Out of scope here: configurable retention periods per data type (needs a legal decision per country; see
Consequences), erasure of a whole workspace, and a data-processing agreement template.

## Decisions

### 1. Export (`GET /api/v1/privacy/export`, `GET /api/v1/privacy/export/:employeeId`)

| Route                             | Permission                              | Who                                        |
| --------------------------------- | --------------------------------------- | ------------------------------------------ |
| `GET /privacy/export`             | `gdpr.export_own`                       | every role, own data only                  |
| `GET /privacy/export/:employeeId` | `gdpr.export_employee` (new, scope all) | HR and Admin, for a subject access request |

The answer is one JSON document (`personalDataExportSchema`, `schemaVersion: 1`) sent as an attachment. It is built
synchronously (a workspace holds ≤ 250 people; no export queue, no file storage on the free tier). Content:
account (email, language, time zone, status, dates, role names), employee record (all fields, unmasked: it is the
person's own data), team memberships (names), leave (requests with reason and decision comments, balances; sick
leave shows its type to its owner), attendance records, calendar events they created, notifications and preferences,
and the audit entries they caused (action, entity, time). Never included: password hashes, tokens, sessions, other
people's personal data (managers and approvers appear by name only where the record itself names them).

Every export of somebody else's data is audited (`privacy.exported`, ids only); own exports are not.

### 2. Erasure (`POST /api/v1/privacy/erase/:employeeId`, body `{ confirm: true }`)

Permission `gdpr.erase_employee` (HR and Admin). Preconditions, each a `CONFLICT` with `params.field`:
the employee is **inactive** (`active`: deactivate first, which already moves reports up and disables the login),
is not **yourself** (`self`) and was not erased before (`erased`).

In **one transaction** (system connection, because the application role may neither delete notifications nor edit
leave decisions; every statement is scoped by `tenant_id` and the employee):

| Data                                      | What happens                                                                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| employee                                  | name becomes `—` / `#<last 6 of id>`; job title, location, seniority, employee no., birth date, phone, country, department, manager are cleared; employment type, hire and termination date stay (statutory record); `erased_at` is set |
| account (`app_user`)                      | email becomes `erased-<id>@invalid`, language, time zone and last login are cleared, status `disabled`; sessions, refresh tokens, one-time tokens, identities (Google) and role assignments are deleted                                 |
| notifications, preferences, queued events | deleted (including outbox events addressed to the account)                                                                                                                                                                              |
| attendance records                        | kept without their notes (working-time records are statutory)                                                                                                                                                                           |
| leave                                     | requests, counted days and balances kept; free-text reasons and all decision comments about or by the person are cleared                                                                                                                |
| calendar                                  | personal events deleted; team and company events they created stay (owner is the anonymised record)                                                                                                                                     |
| audit log                                 | untouched: it holds only pseudonymous ids (never names, emails or content), appended with `privacy.erased`                                                                                                                              |

The erasure is **irreversible** and says so in the confirmation. A second `privacy.erased` audit entry carries the
employee id and nothing else. Erasure never touches other people's records except by clearing their comments about
the erased person's requests where they are the approver's own free text on that request.

### 3. Web

- Profile ("My profile"): **Download my data** (JSON file).
- Employee detail page (HR/Admin): **Download data**; for inactive employees **Erase personal data** with a
  confirmation that states what is removed and that it cannot be undone.
- Strings en/de/bg, 375 px first.

## Consequences

- One new permission (`gdpr.export_employee`, HR + Admin) and one nullable column (`employee.erased_at`, expand-only).
- `SystemPrismaService` is now also allowed in `modules/privacy/erasure.service.ts` (lint allowlist), nowhere else.
- Retention of operational data (attendance and leave after the statutory period, audit after N years) is **not**
  automated yet: periods differ per country and need the owner's decision before anything is deleted automatically.
  `gdpr.manage_retention` stays reserved for that follow-up.
