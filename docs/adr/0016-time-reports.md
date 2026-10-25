# ADR 0016 — Time reports: hours per project, person and client, budget versus actual, CSV export

Status: accepted · Phase 2 step 4 · Builds on [ADR 0015](0015-time-tracker.md), [0013](0013-clients-and-projects.md), [0003](0003-roles-and-permissions.md)

## Context

Logged time is only useful when somebody can add it up: how many hours went into a project, who spent them, what a client
costs, and whether a project stays inside its budget. Billing needs a file of **approved** hours. Nothing is stored for
this step: reports are queries over `time_entry` (and `timesheet` for the approval state).

## Decisions

### 1. What counts

Only **finished** entries (a running timer has no minutes yet). Every row shows three numbers over the chosen period:
`totalMinutes` (everything logged), `billableMinutes` and `approvedMinutes` (entries in a week whose sheet is `approved`).
An entry belongs to the sheet of its employee and Monday-based week (`date_trunc('week')`, as in ADR 0015).
Periods are inclusive dates, at most 366 days.

### 2. Reports (`GET /time/reports?from&to&groupBy&projectId`)

| `groupBy`           | Permission                                               | Rows the caller gets                                                                                                                          |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`, `client` | `time.report_project` (needs `client.view` for `client`) | all projects at scope `all`; at scope `own` only projects the caller **leads**. A `projectId` outside that set is `404`.                      |
| `person`            | `time.view`                                              | people inside the scope (`allowedEmployees`); with `projectId` the project must be inside the caller's project-report scope, otherwise `404`. |

Project rows also carry the **budget versus actual**: `budgetMinutes` (from `budget_hours`, null without a budget) and
`loggedMinutes` (everything ever logged on the project, not just the period). `budgetUsage` (pure, in contracts) turns
them into a percentage and a level: `ok` below 80 %, `warning` from 80 % to 100 %, `over` above 100 %. The web page shows
the level in words, never by colour alone.

### 3. CSV export (`GET /time/reports/export?from&to&projectId`)

Permission `time.export` (scope `all`, or `own` = projects the caller leads). Rows are **approved** entries only:
date, person, project code and name, task reference, hours (decimal, two places) and billable. **No notes** (free text).
The API returns the rows as JSON; the pure `timeExportCsv` in contracts builds the file and the browser downloads it
(the web app talks to the API only through `apiRequest`). The CSV escapes quotes, commas and line breaks and neutralises
formula injection (a cell starting with `=`, `+`, `-`, `@` or a tab gets a leading `'`). Every export is audited with ids
and counts only (`time.exported`: period, project id, number of rows).

### 4. Web

A third tab **Reports** on `/time` for people who hold `time.report_project` or `time.view` above `own`: period (default:
this month), grouping, optional project, a table (cards on phones) with the three numbers, budget bars for projects and the
export button for people with `time.export`.

### 5. Route guard fix found on the way

The web routes `/tasks` and `/time` had been placed behind the `project.view` guard. They now carry their own:
`task.view`, and `time.log` or `time.view`. On the API side `GET /time/week` and `GET /time/reports` are
`@Authenticated()` and check their permission in the service, because the permission guard requires **all** listed
codes, not any of them.

### 6. Out of scope

Daily targets and expected-versus-logged hours need working-day, holiday and leave data: they come with the
Integrations and Capacity steps. Hourly rates and money (Phase 4), scheduled or e-mailed reports, charts.

## Consequences

- No new tables, so nothing to erase or export beyond ADR 0015; the export file leaves the system (the downloader is
  responsible), which is why it is audited and approved-only.
- Managers see budget numbers only for projects they lead; HR and Admin see everything.
