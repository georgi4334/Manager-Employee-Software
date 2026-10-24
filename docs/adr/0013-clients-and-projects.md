# ADR 0013 — Clients and projects (staffing, milestones, health)

Status: accepted · Phase 2 step 1 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0007](0007-organization.md), [0008](0008-leave.md), [0011](0011-gdpr-export-erasure.md)

## Context

Phase 2 turns InTime from a people system into a planning system: who works on what, for whom, and is it on track.
Tasks, the time tracker and capacity follow in later steps and build on this one, so the data must be right:
**clients, projects, milestones and staffing with an allocation percentage**. Nothing here measures people (no hours
yet); allocation is a _plan_.

## Decisions

### 1. Data model (all tenant-scoped, RLS, composite `(tenant_id, id)` foreign keys)

- `client`: `name` (unique per workspace, case-insensitive), `contact_name`, `contact_email`, `notes` (≤ 1000),
  `status` (`active` / `archived`). Clients are never deleted (projects reference them); archiving hides them from
  pickers. Contact data is personal data of people _outside_ the company: optional and minimal.
- `project`: `code` (2–12 characters `A–Z 0–9 -`, unique per workspace), `name` (≤ 120), `description` (≤ 1000),
  `client_id` (optional: internal projects), `status` (`planned` / `active` / `paused` / `done`), `priority`
  (`low` / `normal` / `high`), `is_billable`, `budget_hours` (optional, ≥ 0), `start_date`, `end_date` (optional,
  not before the start), `lead_employee_id` (optional).
- `milestone`: `project_id`, `title` (≤ 120), `due_date`, `status` (`open` / `done`), `done_on`.
- `project_assignment`: `project_id`, `employee_id`, `role` (≤ 60, free text such as "Backend"), `allocation_pct`
  (integer 1–100), `from_date`, `to_date` (open end allowed, never before `from_date`).

Rules the database enforces, not only the API: allocation 1–100, date order, **no two overlapping assignments of
the same person on the same project** (exclusion constraint on the date range, open end = infinity), unique
project code and client name. The ER sketch in `docs/data-model.md` §6 stays the long-term picture; `project_skill_requirement`
arrives with the skills matrix.

### 2. Health is computed, never stored

`projectHealth` (pure function in `@intime/contracts`, unit-tested) answers `on_track` / `at_risk` / `off_track` for
**active** projects only (planned, paused and done projects have none):

- `off_track`: an open milestone is more than 7 days overdue, or the project's end date has passed while it is still active;
- `at_risk`: an open milestone is 1–7 days overdue, or the end date is within 7 days and an open milestone exists;
- otherwise `on_track`.

Budget versus logged hours joins the rule when the time tracker exists. "Today" is the workspace time zone (`todayIn`).

### 3. Over-allocation is a warning, not a block

The people planning decides: `peakAllocation` (pure sweep over date ranges) says how much of a person is planned
at the busiest moment of an assignment. Above 100 % the assignment is flagged `overAllocated` in every response and
the web shows a warning. Saving is still allowed (real life has short overlaps); capacity views build on it later.

### 4. Who sees and changes what (permissions already in the catalog)

| Action                   | Permission          | Scope meaning                                                                                                                                 |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| List / open projects     | `project.view`      | `own` = projects I lead or am assigned to; `team`/`reports`/`department` = those plus projects led by or staffing people in that scope; `all` |
| Create / change projects | `project.manage`    | `own` = projects I lead (and a new project must name me as lead); `all` = any                                                                 |
| Staff a project          | `assignment.manage` | `own` = projects I lead (any employee may be staffed); `all`                                                                                  |
| See clients              | `client.view`       | managers, HR, Admin; without it a project shows no client                                                                                     |
| Create / change clients  | `client.manage`     | HR, Admin                                                                                                                                     |

A project the caller cannot see is `404` (never `403`). `canEdit` / `canStaff` are computed per caller; the UI
only follows them. Milestones follow `project.manage` on their project.

### 5. Notifications, audit, offboarding, GDPR

- Staffing someone sends `project.assigned` (ids and the project name only) to that person's account, unless they staff themselves.
- Client, project, milestone and assignment changes are audited with ids and field names, never free text.
- Deactivating an employee ends their open assignments on the termination date and removes ones that would start later
  (same transaction as the other offboarding steps); a lead who leaves is cleared from their projects.
- Data export lists a person's staffing (project name, role, allocation, dates). Erasure keeps assignments as plain
  planning history attached to the anonymised record (no personal data in them).

### 6. Web

"Projects" in the main navigation: list with search and status/client filters, a **Clients** tab (for `client.view`),
a project page with overview (status, health, budget, lead, client), **timeline** (the project span with today and
milestones marked, then the milestone list), and **team** (assignments with allocation and over-allocation warnings).
Forms for create/edit follow the same inline pattern as leave and calendar. All strings en/de/bg, 375 px first.

## Consequences

- Four tables and their API surface in one step; tasks (`task`), time (`time_entry`, `timesheet`) and capacity follow as separate steps.
- Leave-conflict warnings on approval (roadmap "Integrations") will read `project_assignment` and `milestone`.
