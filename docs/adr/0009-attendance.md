# ADR 0009 — Attendance (manual check-in/out, history, team presence)

Status: accepted · Phase 1 step 4 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0007](0007-organization.md), [0008](0008-leave.md)

## Context

People record when they work and from where (office, remote, field). It is **self-reported and manual**: no
monitoring, no location, no IP address, no device data (works-council friendly, GDPR data minimisation).
Managers see their people's records, HR everybody's; corrections are possible but visible to the person concerned.

## Decisions

### 1. Data model (`attendance_record`, tenant-scoped, RLS)

`employee_id`, `work_date` (date in the workspace time zone at check-in), `check_in_at`, `check_out_at` (null while
open), `mode` (`office/remote/field`), `note` (≤ 200 characters, optional), `source` (`clock` = check-in/out
buttons, `entry` = typed in afterwards, `correction` = changed by somebody else), timestamps.

Rules the database enforces (not only the application):

- **One open record** per employee (partial unique index on records without a check-out).
- **No overlaps** between the records of one employee (exclusion constraint on the time range, open records
  extend to infinity).
- Check-out after check-in, **at most 16 hours** per record; records never span more than that, a night shift
  is two records. Manually entered records lie within one calendar day.

### 2. Who may do what (`/api/v1/attendance`)

| Action                             | Permission                    | Rules                                                                                                                                                                |
| ---------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /check-in` `{ mode, note? }` | `attendance.record`           | the server clock decides the time; refused while a record is open (`CONFLICT`, field `open`)                                                                         |
| `POST /check-out` `{ at? }`        | `attendance.record`           | closes the own open record now, or at `at` (after the check-in, not in the future); refused if it would exceed 16 h                                                  |
| `POST /records` (type in a day)    | `attendance.record`           | own records for today and the last 7 days; for other people `attendance.correct` within its scope, never for yourself on older days                                  |
| `PATCH/DELETE /records/:id`        | owner or `attendance.correct` | owner: own records of the last 7 days; otherwise `attendance.correct` covering the owner — **never your own old records** (ask your manager/HR, like leave approval) |
| `GET /records`                     | `attendance.view`             | only people inside the scope, date range of at most 93 days, paged                                                                                                   |
| `GET /status`                      | `attendance.record`           | the own open record, today's records and total                                                                                                                       |
| `GET /today`                       | `attendance.view`             | presence of the people inside the scope: working (mode, since), done, on approved leave, not recorded                                                                |

Times are typed as `HH:MM` in the **workspace time zone** and stored as instants; the API answers with both the
instants and the local `date`/`HH:MM`, so the client never converts time zones. Daylight-saving gaps and
overlaps are resolved deterministically (the first matching instant).

### 3. Transparency and privacy

- A change by somebody else (create, edit, delete) **notifies the person** (`attendance.corrected`: date and kind
  only) and is audited with ids and the action, never times or notes.
- No attendance data in notification emails (only the usual notice and link).
- Self check-in/out is not audited separately: the record with `source = clock` is the log.
- Retention (automatic purging after the legal period) and employee data export/erasure are part of the Phase 1
  hardening step; attendance records are included there.

### 4. Web

"Attendance" entry with tabs: **Today** (check in with a mode, check out, today's records and total, a form to
type in a missed period), **History** (own records by week with daily totals, edit/delete within the 7 day window),
**Team** (presence today, and records of people in scope for a period; HR/managers can add, edit, delete).
All strings en/de/bg, 375 px first.

## Consequences

- Leave and attendance meet in the presence view (approved leave today). Comparing attendance with logged hours
  and "missed check-out" reminders arrive in Phase 2 (time tracking, ADR later); reminders need an external pinger.
- Export for payroll is the approved-hours CSV of Phase 2, not an attendance export (`attendance.export` stays
  in the catalog without a route until then).

## Not in this step

Shift schedules and overtime rules, geofencing or any automatic check-in, break tracking (use several records),
night-shift records across midnight in one entry, attendance export, retention job.
