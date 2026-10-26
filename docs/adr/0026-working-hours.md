# ADR 0026 — Working hours per person

Status: accepted · Phase 5 · Builds on [ADR 0018](0018-capacity.md), [0006](0006-employees.md), [0011](0011-gdpr-export-erasure.md)

## Context

Capacity (ADR 0018) measures everybody against the same 8-hour day, Monday to Friday. Part-time people, people who work other
days, and people who regularly work overtime make its numbers wrong: a half-time person looks half-empty, and an hour logged
on a Saturday looks like nothing. This ADR gives every person **their own weekly working hours** and makes overtime visible.
It stays informational: nothing is blocked, nothing is paid or approved here (no payroll, no statutory overtime rules).

## Decisions

### 1. The schedule

- `work_schedule` (RLS, composite foreign key to `employee`): one row per person and `valid_from` date with the contractual
  minutes for each weekday (`minutes_mon` … `minutes_sun`, 0–960 each, so a Saturday can be a working day). The schedule in
  force on a date is the row with the latest `valid_from` on or before it. Changes are new rows, so past weeks keep the hours
  that applied then.
- A person **without a row** has the default week: 8 hours Monday to Friday (`DEFAULT_WEEK`), exactly as before. Nobody has to
  be migrated.
- Pure functions in `@intime/contracts` (`schedule.ts`): `scheduleFor` (the row in force), `scheduledMinutes` (the day's
  contractual minutes), `weekMinutes`. Unit-tested, including the boundary of `valid_from`.

### 2. Capacity uses it

- `workingMinutes` takes the day's scheduled minutes: the schedule replaces "weekends are off" (a person may work a Saturday).
  Public and company holidays still take the day out; a half-day holiday leaves half of the scheduled minutes. Hire and
  termination dates still bound the employment. Without a scheduled value the old behaviour stays (the function keeps working
  for callers that pass none).
- Approved leave removes its **fraction of that day's scheduled minutes** (half a day off a 4-hour day is 2 hours).
- The "8-hour day" note on the page is replaced by a statement that each person is measured against their own working hours.
- Leave day counting (ADR 0008) is unchanged: it still counts Monday to Friday minus holidays.

### 3. Overtime

- **Overtime is logged time beyond available time**, per day: `max(0, logged − available)`, summed over the period
  (`overtimeMinutes`). Time logged on a day off (weekend, holiday, leave) is overtime in full. It is shown on the capacity card
  as information and never blocks logging (a day still holds at most 24 hours, ADR 0015). Planning is unaffected: planned time
  is still a share of available time, so over-booking and overtime stay separate ideas.
- No rates, limits, approvals or statutory checks (for example yearly overtime caps) are computed; those are a payroll/legal
  concern and out of scope.

### 4. Who can see and change it

- Reading a person's schedule needs `employee.view_profile_full` covering that person (own, team, all), the same as the
  rest of the contract details. Capacity numbers already reveal availability to whoever has `capacity.view`; the schedule itself
  is only shown on the profile.
- Changing it needs the new permission `employee.manage_schedule` (HR and Admin, scope `all`). Every change is audited with ids
  and the `valid_from` date (never the minutes). A schedule row can be deleted (undo); at least the default week remains.
- Validation: seven values, each 0–960 minutes, a week of at most 7 × 16 hours; `valid_from` is a date; the same date replaces
  the existing row. Unknown or foreign employees are `404`.

### 5. Data protection

- Export lists the person's schedule rows. Erasure deletes them (they are not statutory records). Deactivation keeps them.

### 6. Web

- The employee profile shows a "Working hours" card (a list of the seven days, the weekly total, and upcoming changes).
  People with `employee.manage_schedule` get an editor: a valid-from date and one `h:mm` field per weekday (the same duration
  parsing as the time tracker). The capacity card shows overtime when there is some.

### 7. Out of scope

Shift rotas, flexible-time accounts, per-person holidays by region (still the person's country), automatic overtime
compensation, schedule templates.
