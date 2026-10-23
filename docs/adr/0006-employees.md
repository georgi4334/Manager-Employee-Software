# ADR 0006 — Employees (profiles, directory, onboarding)

Status: accepted · Phase 1 step 1 · Builds on [ADR 0002](0002-authentication.md), [0003](0003-roles-and-permissions.md), [0004](0004-notifications.md)

## Context

A login account (`app_user`) says who may sign in; an **employee** says who works at the company. They are
different things: a contractor may exist before getting an account, an account may be disabled while the employment
record is kept for legal reasons. Employees are the base of Organization, Leave, Attendance and Calendar.

## Decisions

### 1. Data model

New tenant-scoped table `employee` (RLS, `tenant_id`, composite FK to `app_user`):

| Column                                        | Notes                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `user_id`                                     | nullable, unique per tenant (one employee per account); set when an account is invited |
| `employee_no`                                 | optional, unique per tenant                                                            |
| `first_name`, `last_name`                     | required, 1–100 characters                                                             |
| `job_title`, `location`                       | free text, optional (`position` becomes a table in the Organization step)              |
| `employment_type`                             | `full_time/part_time/contractor/outsourced`                                            |
| `seniority`                                   | optional: `intern/junior/mid/senior/lead/principal`                                    |
| `hire_date`, `termination_date`, `birth_date` | optional dates (no time zone); termination not before hire                             |
| `phone`, `country`                            | optional; country is ISO 3166 alpha-2                                                  |
| `status`                                      | `active/inactive` (inactive = deactivated, keeps the record)                           |

Decisions that differ from the first sketch in `data-model.md`:

- **No `work_email` column.** The email lives on the account only (one source of truth, no drift). An employee
  without an account has no email until they are invited. Changing an email is an account task (later).
- **Manager, department, team, position and work schedule come with Organization (step 2)**, avatar with file
  storage. Until then the avatar is the initials, and `reports/team/department` scopes still fail closed (ADR 0003).
- The admin created by `tenant:create` gets an employee record too (optional `--admin-first-name/--admin-last-name`).

### 2. Who sees what

| Data                                                                                                      | Permission                   | Rule                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| Directory: name, job title, location, email, status                                                       | `employee.view_directory`    | everybody (scope all); **active employees only**                                         |
| Profile: employee no., phone, birth date, hire/termination date, type, seniority, country, account status | `employee.view_profile_full` | scope applied per record; an employee **without account** is visible only at scope `all` |
| Inactive employees (list filter and detail)                                                               | `employee.deactivate`        | HR/Admin; others get `FORBIDDEN` on the filter and `NOT_FOUND` on the record             |

The profile is `null` in the response when the actor may not see it, so the client cannot mistake missing data for empty data.

### 3. Endpoints (`/api/v1`)

| Endpoint                         | Permission                   | Behaviour                                                                                                                                                                                                |
| -------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /employees`                 | `employee.view_directory`    | `q` (name, title, email), `status`, `page`, `pageSize` (≤100); sorted by last, first name; returns `total`                                                                                               |
| `GET /employees/me`              | `@Authenticated`             | the caller's own employee (404 if none)                                                                                                                                                                  |
| `GET /employees/:id`             | `employee.view_directory`    | directory data + profile when allowed                                                                                                                                                                    |
| `POST /employees`                | `employee.create`            | creates the employee; with `email` also invites an account (Employee role) and links it; emailed link, never returned                                                                                    |
| `PATCH /employees/:id`           | `employee.update`            | partial update of the fields above (not email)                                                                                                                                                           |
| `PATCH /employees/me`            | `employee.update_self_basic` | own phone only                                                                                                                                                                                           |
| `POST /employees/:id/invitation` | `admin.user.invite`          | invite or re-send for an employee without account / with open invitation; `409` if the account is already active                                                                                         |
| `POST /employees/:id/deactivate` | `employee.deactivate`        | `status=inactive`, termination date (default today), disables the account and ends its sessions; not yourself; last-administrator rule and "only Admin may manage an administrator" apply as in ADR 0003 |
| `POST /employees/:id/reactivate` | `employee.deactivate`        | back to `active`, clears the termination date, re-enables the account                                                                                                                                    |

Errors are codes: `VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` (`params.field` = `employeeNo` or `email`),
`CANNOT_DISABLE_SELF`, `LAST_ADMIN`.

### 4. Audit, privacy, GDPR

- Every create/update/deactivate/reactivate/invite is audited with the **names of changed fields only**, never
  values (phone, birth date are personal data).
- Logs contain ids only. Responses never include another person's birth date or phone without the permission.
- Deactivation keeps the record (legal retention); export and erasure/anonymization of employee data is part of the
  Phase 1 hardening step and builds on this table (all personal fields are in one place: `employee` + `app_user`).

### 5. Web

Navigation entry "Employees" (directory: search, status filter for HR; cards on mobile, table from `md`), profile
page, create/edit form for HR/Admin, "My profile" (own phone). Strings in the `employees` namespace (en/de/bg).
UI hiding is cosmetic; every rule above is enforced by the API.

## Consequences

- Organization (step 2, [ADR 0007](0007-organization.md)) adds `manager_id`, departments and teams and replaces
  `SelfOnlyOrgRelations`, which makes the Manager grants (`team` scope) real. It also lets employees without an
  account be reached by `reports`/`team`/`department` scopes (they have an employee record and a manager).
- Accounts created through `POST /users/invitations` (admin tool) have no employee record until HR creates one
  with the same email via this flow's invitation endpoint; the directory only lists employees.
