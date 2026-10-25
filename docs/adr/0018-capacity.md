# ADR 0018 — Capacity: planned versus actual load and availability

Status: accepted · Phase 2 step 6 (last of Phase 2) · Builds on [ADR 0008](0008-leave.md), [0013](0013-clients-and-projects.md), [0015](0015-time-tracker.md), [0016](0016-time-reports.md)

## Context

Staffing says "Dan is on Alpha at 50 %". Capacity answers the questions behind it: **how many hours does a person really
have in a week (holidays and leave taken out), how many of them are already planned, how many were actually logged, and who
is free?** Nothing is stored: capacity is computed from what exists, as the data model already says.

## Decisions

### 1. The model (pure functions in contracts, `capacity.ts`)

- A **standard day has 8 working hours** (`WORKDAY_MINUTES = 480`), Monday to Friday. Public and company holidays of the
  person's country (leave settings, `holidayMap`) take the day out; a half-day holiday leaves half. Days before the hire
  date or after the termination date do not count.
- **Available** minutes of a day = the working minutes minus approved leave (a whole leave day takes everything, a half day
  half). Pending leave does not reduce availability (it is not decided).
- **Planned** minutes of a day = the available minutes × the sum of the allocation percentages of the person's
  assignments that cover the day (projects that are not finished). The sum may exceed 100 %: that is over-booking, shown,
  not blocked (ADR 0013).
- **Logged** minutes = finished time entries of the day (all projects, approved or not).
- **Free** minutes of a period = available − planned, never negative.
- **Level** of a period from planned / available: `none` (nothing available), `free` (nothing planned), `busy`
  (up to 80 %), `full` (80 % up to 100 %), `over` (above 100 %). A **day status** says the same in words for the day,
  plus `off` (weekend, holiday or outside employment) and `leave` / `partly_leave`.

Limits of this first version, written down on purpose: everybody is measured against the **same 8-hour day**; part-time
and contractor schedules need a per-person working-time setting, which comes with the work schedule in a later phase.
Nobody is told that their numbers are "wrong" because of this: the page states the standard day.

### 2. API (`GET /capacity?from&to&projectId&q&page&pageSize`, permission `capacity.view`)

- Period at most 31 days (`end_before_start`, `too_long`). People: active employees inside the caller's `capacity.view`
  scope (`own` = themselves, `team`, `all`), ordered by name, paged (default 50, at most 100); `q` filters by name;
  `projectId` keeps people staffed on that project in the period (the project must be visible through `project.view`,
  otherwise `404`).
- Per person: available, planned, logged and free minutes, level, and one entry per day (date, available, planned, logged,
  status). **Per-project breakdown** (planned and logged minutes per project) only for projects the caller may see
  (`project.view`); the rest is summed in one row without a project, so the totals always add up and nothing about a
  project leaks.
- No stored result, no export, no history, no notification.

### 3. Web

A **Capacity** page (`/capacity`, nav entry for `capacity.view`): a week at a time (previous / next / this week), filters
for project and name, a switch "most free first". Each person is a card with the four numbers, the level in words and a
details section with the seven days and the projects. Phones get the same list (cards), no wide table.

### 4. Out of scope

Per-person working hours and part-time schedules, planned load per task, forecasting, capacity of teams or departments as
a unit, skills-based search ("who has React and time?", Phase 3 with the skills matrix), exports.

## Consequences

- Without a schema change, capacity needs no migration, no erasure and no export entry: it reads data that is already
  exported or erased.
- Numbers for part-time people are optimistic until the work schedule exists; the standard day is stated in the UI.
