# ADR 0008 — Leave (types, policies, balances, requests, approvals, holidays)

Status: accepted · Phase 1 step 3 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0004](0004-notifications.md), [0006](0006-employees.md), [0007](0007-organization.md)

## Context

Employees request time off, managers approve, HR keeps the rules and the numbers. The module is rule-heavy
(working days, half days, balances, overlaps) and touches health-related data (sick leave), so the rules live in
one place on the server, are covered by pure unit tests, and the database enforces what it can.

## Decisions

### 1. Leave types and policies

`leave_type` per workspace. Four **system types** are created for every workspace (migration backfills existing
ones, provisioning creates them for new ones): annual, sick, unpaid, parental. HR may add custom types and edit
any type; system types cannot be removed (types are deactivated, never deleted, because requests refer to them).

| Field               | Meaning                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `key`               | set for system types (the web app translates it); custom types have a free-text `name` instead       |
| `tracks_balance`    | counts against a yearly allowance (annual leave); other types are unlimited                          |
| `requires_approval` | otherwise a request is approved on submission (default for sick leave: the manager is only informed) |
| `is_sick`           | **no reason is ever stored** for this type; the type can be hidden from colleagues (see 6)           |
| `color`             | one of the design-token colours (no hex values)                                                      |
| `is_active`         | inactive types cannot be requested; old requests keep working                                        |

`leave_policy` (one per balance-tracking type): `annual_allowance_days` (0–365, steps of 0.5) and
`carry_over_max_days`. The annual type starts with 20 days and a carry-over of 5. Country-specific legal minimums are
the responsibility of HR; the policy is a plain number.

### 2. Working days and holidays

- Days are counted on **dates without time zone**; "today" is the date in the workspace's time zone.
- Weekends (Sat/Sun) never count. Work schedules per employee are not modelled yet (everybody works Mon–Fri).
- **Public holidays** do not count. Built-in calendars for **Bulgaria and Germany (national days)** are computed in
  code for any year (fixed dates plus Easter-based days; Bulgaria uses the Orthodox Easter). Regional German holidays
  are not built in: HR adds them (and company days) as **custom holidays** (`holiday`: date, name, optional country,
  half day). An employee's holiday country is their `country`, else the workspace default (`leave_settings`), else none.
- **Half days:** a request may start in the afternoon (first day counts 0.5) and/or end at noon (last day counts 0.5).
  A single day can be a half day. Holidays that are half days count 0.5 less for that date.
- A request must contain at least one counted day; otherwise it is refused (`NO_WORKING_DAYS`).
- The counted days are **stored per request** (`leave_request_day`: date, 0.5 or 1). Later edits to holidays do
  not change approved requests or old balances, and calendars/absence queries need no recomputation.

### 3. Balances

`leave_balance(employee, type, year)` is created **lazily** the first time it is needed and then frozen:
`entitled` = policy allowance (prorated by the remaining days of the hire year, rounded to 0.5), `carried_over` =
the unused remainder of the previous year's row, capped by the policy (0 when there is no previous row),
`adjustment` = HR corrections (default 0; changes are audited). **Used** and **pending** are never stored: they are
sums over the stored request days, so they cannot drift. `remaining = entitled + carried_over + adjustment − used − pending`.
A request that would make `remaining` negative in any year it touches is refused (`INSUFFICIENT_BALANCE`, with the
numbers in `params`). Types that do not track a balance have no limit.

### 4. Requests and the approval flow

States: `pending → approved | rejected | cancelled`, `approved → cancelled`; rejected and cancelled are final.
All transitions are single conditional updates (a request decided twice by two people is decided once).

| Action         | Who                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| request        | an active employee, for themselves (`leave.request`); start at most 60 days in the past, end at most 2 years ahead; a reason of up to 300 characters is optional and **dropped for sick types**                                                                        |
| approve/reject | someone whose `leave.approve` scope covers the requester (manager of a direct report; HR/Admin everyone) — **never for their own request**, even as Admin: such requests escalate to the next manager or another HR/Admin; an optional comment of up to 300 characters |
| cancel         | the requester while pending, or while approved and not yet started; an approver may cancel any approved request                                                                                                                                                        |

**Overlap:** two pending/approved requests of one employee may not share a date; a database exclusion constraint
enforces it (`CONFLICT`, `params.field = "dates"`). Types that do not require approval are approved immediately.
Every change is audited (ids, dates, status; never reasons or comments).

**Deactivation (decision):** pending requests are **never withdrawn** when an employee is deactivated; they stay
pending and visible so the next approver can inherit them. Nothing is copied or reassigned: the approver is always
computed from the reporting line at the time. A leaver's own request stays with the manager they had (HR/Admin
with scope `all` otherwise). When a manager leaves, their reports move up (ADR 0007), so those reports' pending
requests belong to the new manager, who is notified with the existing `leave.requested` notification (request id,
dates, days only) once per request, in the same transaction as the deactivation. Pending days keep counting in the
balance until someone decides (or the requester's request is cancelled by an approver).

### 5. Who sees what (endpoints under `/api/v1/leave`)

| Endpoint                                     | Permission                    | Rules                                                                                           |
| -------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /types`                                 | authenticated                 | active types (HR sees inactive ones too)                                                        |
| `POST/PATCH /types[/:id]`                    | `leave.manage_types_policies` | includes the policy fields                                                                      |
| `GET/PUT /settings`                          | `leave.manage_types_policies` | `hideSickTypeFromTeam`, `defaultCountry`                                                        |
| `GET /holidays?year&country`                 | authenticated                 | built-in + custom days for a country (own country by default)                                   |
| `POST/DELETE /holidays[/:id]`                | `leave.manage_types_policies` | custom holidays                                                                                 |
| `GET /balances?employeeId&year`              | `leave.view_balance`          | own by default; others only inside the scope                                                    |
| `POST /balances/adjustments`                 | `leave.adjust_balance`        | `{ employeeId, leaveTypeId, year, delta }`, audited                                             |
| `POST /requests`                             | `leave.request`               | create                                                                                          |
| `GET /requests`                              | `leave.view`                  | filters `employeeId`, `status`, `from`, `to`, `approvable`; only people inside the scope; paged |
| `POST /requests/:id/{approve,reject,cancel}` | `leave.approve` / owner       | rules above                                                                                     |
| `POST /requests/preview`                     | `leave.request`               | counted days and balance effect for a date range, without saving (live feedback in the form)    |

### 6. Privacy

- Sick leave: the request stores the type and dates only. If the workspace enables `hideSickTypeFromTeam`, anybody
  who is not the owner and does not hold `leave.view` at scope `all` sees "absent" with no type for sick requests.
- The reason and the approver's comment are visible only to the owner and to people who may approve that request.
- Notifications and emails carry names and dates, never the type of a sick request and never reasons.

### 7. Notifications

`leave.requested` (to the approvers: the manager, or all HR/Admin approvers when there is no manager or the manager
is the requester), `leave.decided` (to the requester), `leave.cancelled` (to the other party). Published in the
same transaction as the change (ADR 0004). Parameters: ids, dates, day count and the person's name.

### 8. Web

"Leave" entry: **My leave** (balance cards, request form with live day count, own requests with cancel),
**Approvals** (pending requests the user may decide), **Team** (who is off, by date range, inside the scope),
**Settings** (HR: types and policies, holidays, privacy switch, balance adjustments). Strings en/de/bg.

## Consequences

- Attendance and the Calendar later read `leave_request` / `leave_request_day` instead of re-deriving absences.
- Work schedules (part-time weekdays) will refine "working day" per employee; the stored days keep old data valid.
- Without a scheduler there is no automatic year rollover: balances are created when first used (see 3).

## Not in this step

Attachments (sick notes), multi-step approvals, substitute/handover, accrual per month, per-employee schedules,
regional German holidays, bulk import of balances, leave export (payroll export comes with time reports).
