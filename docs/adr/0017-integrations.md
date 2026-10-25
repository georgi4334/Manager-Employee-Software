# ADR 0017 — Integrations: leave conflicts, attendance versus logged time, reminders

Status: accepted · Phase 2 step 5 · Builds on [ADR 0008](0008-leave.md), [0009](0009-attendance.md), [0013](0013-clients-and-projects.md), [0014](0014-tasks.md), [0015](0015-time-tracker.md), [0004](0004-notifications.md)

## Context

Leave, attendance, projects and time were built as separate modules. Three small connections make them more useful
without turning any of them into a surveillance tool: the person approving leave should see what the absence collides
with, a person (and their approver) should be able to spot days where presence and logged time disagree, and forgotten
check-outs and timers should be reported once. Everything below is **informational**: nothing blocks, nothing is changed
automatically, nothing new is collected.

## Decisions

### 1. Leave-conflict warnings (`GET /leave/requests/:id/conflicts`, permission `leave.approve`)

For the dates of a leave request of the employee, the approver sees:

- **projects the person is staffed on** in that period (assignment overlaps the dates; finished projects are left out),
- **open milestones** of those projects that fall due in the period,
- **open tasks assigned to the person** whose due date falls in the period (reference and date only, never the title).

Scope: the request must be inside the approver's `leave.approve` scope (otherwise `404`). Each part is
filtered to what the caller may see anyway: projects through `project.view`, tasks through `task.view` (`ProjectAccess`).
A manager without project access simply sees no warnings. Warnings never change the decision; the web shows them on
demand in the approvals tab ("Check project impact"). No role text, comments or leave type are used.

### 2. Attendance versus logged time (`GET /time/compare?weekStart&employeeId`)

Per day of a week: minutes present (finished attendance records), minutes logged (finished time entries), whether the
day is approved leave, whether an attendance record is still open, and a `flag`: `more_logged` (logged exceeds presence
by more than 30 minutes), `less_logged` (presence exceeds logged by more than 30 minutes) or `none`. Approved leave days,
days with an open record and days with neither number are never flagged (`compareDay`, pure, in contracts).

Who may look: **the person themself** (needs `attendance.view`) and people whose scope covers them for **both**
`time.view` and `attendance.view` (`allowedEmployees`); anybody else gets `404`. It is a mirror for the person and their
approver while reviewing a week, not a monitoring report: there is no list across people, no export, no notification and
no stored result. Daily targets and expected hours belong to Capacity.

### 3. Reminders (time-based, so an external trigger)

Two reminders, each sent **once** per record, to the owner only, as in-app and e-mail notifications (preferences apply):

| Type                  | When                                                       | Params |
| --------------------- | ---------------------------------------------------------- | ------ |
| `attendance.reminder` | an attendance record is still open 12 hours after check-in | date   |
| `time.timer_reminder` | a timer is still running 10 hours after it started         | date   |

"Once" is stored: nullable `reminded_at` on `attendance_record` and `time_entry` (additive migration, compatible with the
previous release); a record is claimed with a conditional update inside the same transaction that publishes the event.

`RemindersService.run(now)` lives with the notification delivery code (the only place besides auth that may use the
system connection; it uses it only to list workspaces, everything else runs through `TenantDb`). It is called

1. from the existing hourly sweep of the outbox worker, **only while the API is active** (as retention), and
2. by an external pinger: `POST /api/v1/internal/reminders/run` with `Authorization: Bearer <REMINDERS_TOKEN>`. The route
   is `@Public()` but answers `404` when `REMINDERS_TOKEN` is not configured and `401` for a wrong token (constant-time
   comparison). A scheduled GitHub Actions workflow (`reminders.yml`, hourly, gated by the repository variable
   `REMINDERS_URL` and the secret `REMINDERS_TOKEN`) is the free pinger; it also wakes a sleeping free-tier API.

Notification params carry the date only. The e-mail never carries details (ADR 0004).

### 4. Web

Leave approvals: "Check project impact" per pending request. My time: "Compare with attendance" under the week (hidden
without `attendance.view`), also shown in the approvals detail of a timesheet. Notification texts and settings entries
for the two reminders in en/de/bg.

### 5. Out of scope

Blocking approvals, conflict checks for team members' leave overlapping each other, automatic corrections, reminder
digests, push notifications, configurable thresholds (constants for now), daily targets and expected hours (Capacity).

## Consequences

- The external pinger is the first piece of scheduled infrastructure; its secret is a new deployment setting
  (`REMINDERS_TOKEN`, documented in the runbook and `render.yaml`).
- Erasure and export are unaffected: `reminded_at` is a timestamp on records that are already exported or erased.
