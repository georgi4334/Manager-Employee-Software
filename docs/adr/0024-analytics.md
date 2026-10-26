# ADR 0024 — Analytics dashboards

Status: accepted · Phase 4 step 2 · Builds on [ADR 0007](0007-organization.md), [0008](0008-leave.md), [0009](0009-attendance.md), [0013](0013-clients-and-projects.md), [0014](0014-tasks.md), [0015](0015-time-tracker.md), [0016](0016-time-reports.md), [0019](0019-goals.md), [0023](0023-performance-reviews.md)

## Context

Managers and HR ask questions that no single module answers: how many people do we have and where, how much leave was
taken, how much time went into projects, are projects on track, are reviews and goals moving? Analytics is **one read-only
page** that summarises what already exists. Nothing is stored (no table, nothing to export or erase) and nothing new is
collected.

## Decisions

### 1. Aggregates only

- The API returns **numbers and counts, never rows about a person**: no names, no per-person lists, no ratings, no
  free text. Per-person views stay in their own modules (capacity, time reports) with their own rules.
- The model is pure functions in `@intime/contracts` (`analytics.ts`): `suppressSmallGroup`, `share`, `weekStarts`,
  `bucketByWeek`. Unit-tested; the API only supplies rows.

### 2. Who sees what

- `GET /analytics?from&to` is `@RequirePermission('analytics.view_team')`: Manager (`team`), HR and Admin (`all`).
  The **population** is the active employees inside that scope (`allowedEmployees`). Everything about people (headcount,
  leave, attendance, time) is computed for that population only.
- Company-only sections (`goals`, `reviews`) are `null` unless the caller also holds `analytics.view_company`
  (scope `all`: HR and Admin). A manager therefore never sees company-wide goal or review numbers.
- Project figures are limited to projects the caller may see (`ProjectAccess.visibleWhere`, `project.view`); hours
  logged on other projects count only in the total.
- No permission → `403`. The web page has its own route guard; the server is the authority.

### 3. Small groups

- Breakdowns (by department, employment type, leave type, attendance mode) are **suppressed (`null`) when the population
  is smaller than 5** (`MIN_GROUP_SIZE`), so a figure can never point at one person. Totals stay visible: a manager knows
  their own team's size. Suppression is decided by `suppressSmallGroup` in contracts and applied in the service.
- Sick leave: the sick type appears in the by-type breakdown only inside that rule. Sick reasons are never stored.

### 4. Sections (period `from`..`to`, at most 366 days)

- **People**: active headcount, by department and by employment type, hires and leavers in the period.
- **Absence**: approved leave days in the period (sum of `leave_request_day.fraction`), by leave type, days per person on
  average, and pending requests waiting.
- **Attendance**: records and total worked hours (finished records), by mode (office / remote / field).
- **Time**: logged hours (finished entries), billable share, approved share (timesheets), hours per ISO week (series for
  the chart) and the top five projects the caller may see.
- **Projects**: visible projects by status, open and overdue tasks, projects over or near budget (`budgetUsage`).
- **Goals** (company only): goals by status, share overdue.
- **Reviews** (company only): the newest cycle that is not a draft: reviews total, self part submitted, manager part
  submitted, released. Counts only.

### 5. Web

- `/analytics` with its own `analytics.view_team` route guard, a period picker (default last 30 days), stat cards and
  simple CSS bar charts with the value in text (no chart library, accessible without colour). No wide tables; cards on
  mobile. Suppressed breakdowns say so in words.

### 6. Out of scope

Exports, saved dashboards, comparisons across periods, forecasting, attrition or risk scoring (ethical and legal review
first), compensation figures (Phase 5).
