# ADR 0015 — Time tracker: timer, manual entries, weekly timesheets

Status: accepted · Phase 2 step 3 · Builds on [ADR 0009](0009-attendance.md), [0013](0013-clients-and-projects.md), [0014](0014-tasks.md), [0003](0003-roles-and-permissions.md), [0011](0011-gdpr-export-erasure.md)

## Context

People need to say **how long they worked on which project (and task)**, and a manager or HR needs to **approve the
week** before the hours count. Attendance (ADR 0009) answers "was the person at work"; time tracking answers "on what".
The two stay separate: no link, no comparison (that is the later Integrations step). Like attendance it is
**self-reported only**: no screenshots, no activity monitoring, no location, no device, no idle detection.

## Decisions

### 1. Data model (both tables tenant-scoped with RLS, composite `(tenant_id, id)` foreign keys)

`time_entry`: `employee_id`, `project_id`, `task_id` (optional), `work_date`, `minutes` (1–960), `is_billable`, `note`
(≤ 500), `source` (`timer` / `manual`), `started_at` / `ended_at` (timer entries only).

- A **running timer** is a timer entry with `started_at` set and `ended_at` / `minutes` null. At most one per employee
  (partial unique index). Stopping sets `ended_at` and `minutes` = elapsed time rounded **up** to whole minutes
  (at least 1), capped at 16 h (a forgotten timer is capped, the owner corrects the entry afterwards).
- `work_date` is the local date (workspace time zone) the entry **started** on; an entry never splits at midnight.
- The task must belong to the entry's project: a database trigger enforces it (as for a task's milestone), the service reports `task_not_in_project`.
- `is_billable` can only be true when the project is billable (service sets it, the database checks nothing about the
  project). Default: the project's flag.
- Database checks: minutes range, `source` / timestamp shape (manual: no timestamps; timer: `started_at` set; minutes
  null exactly while running), note length.

`timesheet`: `employee_id`, `week_start` (a Monday), `status` (`submitted` / `approved` / `rejected` / `open`),
`submitted_at`, `decided_by_employee_id`, `decided_at`. Unique per employee and week. **Rows are created on first
submit**; a week without a row is simply "not submitted". Entries are not linked to the timesheet: an entry belongs to
the sheet of its employee and `week_start(work_date)`. This keeps entries and sheet consistent without a copy.

Weeks run Monday to Sunday (`weekStart`, pure function in contracts).

### 2. Rules

| Rule                  | Detail                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who may log time      | An active employee with an account, **on projects they are staffed on or lead** (same rule as task assignees; any period), and not on a finished project (`project.status = done` → `project_closed`).       |
| Future                | A manual entry may not lie in the future (`future_date`). A timer starts now.                                                                                                                                |
| Day total             | All entries of one person and day add up to at most 24 h (`day_too_long`), checked under a per-employee advisory lock.                                                                                       |
| Locked weeks          | While the sheet of a week is `submitted` or `approved`, its entries cannot be created, changed, deleted or started as a timer (`CONFLICT`, `field: locked`). `rejected` and `open` weeks are editable again. |
| Submit                | Own sheet, current or a past week (not a future one), at least one entry, **no running timer in that week** (`timer_running`). From none / `rejected` / `open`.                                              |
| Approve / reject      | `timesheet.approve` through `authz` on the owner (`ownerEmployeeId`), only a `submitted` sheet. **Nobody decides their own sheet, whatever their role.** Reject sends it back (no comment text is stored).   |
| Reopen                | `timesheet.reopen` (HR, Admin; scope all) turns an `approved` sheet into `open`; audited. Never on the caller's own sheet (same rule as approval).                                                           |
| Timer on a locked day | Starting a timer when today's week is locked is refused like any other entry.                                                                                                                                |
| Offboarding           | Deactivating an employee stops a running timer (same cap) in the same transaction. Their sheets stay.                                                                                                        |

### 3. API (`/time`, all routes carry a permission)

| Route                                                       | Permission                 | Notes                                                                                                                      |
| ----------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /time/timer`                                           | `time.log`                 | the caller's running timer or `null`                                                                                       |
| `POST /time/timer/start` · `/stop`                          | `time.log`                 | start: project, optional task, note, billable flag; one at a time (`CONFLICT`, `field: running`)                           |
| `GET /time/week?weekStart=&employeeId=`                     | `time.log` / `time.view`   | the caller's own week by default; another person's through `time.view` scope. Entries, day totals, sheet status, `canEdit` |
| `POST /time/entries` · `PATCH/DELETE /time/entries/:id`     | `time.log`                 | own entries only (scope `own`); a running timer entry cannot be edited, only stopped                                       |
| `POST /time/timesheets/submit`                              | `timesheet.submit`         | `{ weekStart }`                                                                                                            |
| `GET /time/timesheets?status=`                              | `timesheet.approve`        | sheets inside the approver's scope (default `submitted`) with totals                                                       |
| `POST /time/timesheets/:id/approve` · `/reject` · `/reopen` | approve / approve / reopen | `404` for sheets outside the scope                                                                                         |

Not-visible rows are `404`, not `403`. `canEdit` is computed per caller.

### 4. Notifications, audit, privacy

- **`timesheet.decided`** (approved / rejected) to the owner; params are `weekStart` and `decision` only. Approvers are
  not notified of submissions (they open the approvals tab); this avoids a second approver-resolution copy and can be
  added with the Integrations step.
- Audit: `timesheet.submitted`, `.approved`, `.rejected`, `.reopened` with ids and week; time entries are not audited
  (they are the record itself). Never the note.
- GDPR: the export lists time entries and sheets; erasure clears **notes** and keeps hours, dates and project links
  detached from the person like attendance (statutory working-time records).

### 5. Web

`/time` with two tabs: **My time** (timer card, week navigator, entries per day, add/edit entry, submit) and
**Approvals** (submitted sheets in scope, expand to read entries, approve / reject). Duration is typed as `H:MM` or
decimal hours (`parseDuration`, pure, tested). Nav entry for `time.log` / `time.view`. No global header timer yet.

### 6. Out of scope (later steps)

Reports, budgets versus actual and CSV export (next step: Time reports), daily targets, comparison with attendance or
leave (Integrations), hourly rates (Phase 4), approver notifications on submit, rejection comments, overtime rules,
drag-and-drop calendar entry, mobile timer widget in the header.

## Consequences

- No timesheet row for most weeks; the approvals list queries only submitted rows.
- A forgotten timer costs at most 16 h and is easy to correct while the week is open.
- Because entries are not linked to sheets, moving an entry's date into a locked week is refused by the same rule as
  creating one.

## Update: billable time chart on My time

My time shows a week chart under the week summary, drawn like the calendar's week view: one column per day, the hours
stacked with billable at the bottom and not billable above it, grid lines every four hours and a dashed line at the 8-hour day
(weekends are shaded days off). Below it the same week per project, biggest first, with the billable and not billable hours in
words. It only reads `GET /time/week`: nothing new is stored or sent. The sums are the pure `timeWeekChart` in contracts
(finished entries only, so a running timer adds nothing until it stops; the scale is at least 8 hours and grows to the next
whole hour for a longer day). **Entries hold hours, not clock times**, so a column is the time spent that day, not when it
happened; the card says so. The plot is `aria-hidden`: the totals, the per-day values, the project list and the day list below
carry the same numbers in text. Approvals and Reports are unchanged.
