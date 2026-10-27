# ADR 0030 — Compensation and hourly rates (records only)

Status: accepted · Phase 5 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0006](0006-employees.md), [0011](0011-gdpr-export-erasure.md), [0026](0026-working-hours.md)

## Context

HR needs to keep what a person is paid and, for people paid by the hour, the rate. This is the most sensitive data in the
product, so it is visible to **HR and Admin only**. **Payroll calculation stays out of scope**: nothing here computes pay,
taxes, social contributions, overtime pay or costs, and no other module reads these numbers (time reports, capacity and
analytics stay in hours).

## Decisions

### 1. The record

- `compensation` (RLS, composite foreign key to `employee`): one row per person and `valid_from` date, like working hours
  (ADR 0026): changes are new rows, the row with the latest `valid_from` on or before a date is the one in force
  (`compensationFor`), the same date replaces, at most 50 rows per person (`CONFLICT`, `field: limit`).
- Fields: `basis` (`monthly` / `yearly` / `hourly`), `amount_minor` (a whole number of minor units, so cents; 1 to 100 000 000 000, i.e.
  never floating point), `currency` (a fixed list `EUR`, `BGN`, `USD`, `GBP`, `CHF`; default EUR) and `valid_from`. No free text, no
  note, no bonus or benefit lines.
- The pure helpers live in contracts and are unit-tested: `compensationFor`, `parseMoney` / `formatMoney` (typed `3 500,50` or
  `3500.50`, shown with `Intl` in the viewer's language; rejects more than two decimals, negatives, zero and absurd sizes) and
  `hourlyEquivalent` is **not** provided (no conversions between bases: that would be payroll).

### 2. Who can see and change it

- Permissions `compensation.view` and `compensation.manage` (already in the catalog, HR and Admin at scope `all`; their
  descriptions lose "module comes later"). Managers, employees and everybody else get `403` from the route guard and **never** see
  the card or a hint of it: an employee profile response carries no compensation field.
- Reading and changing go through the permission **and** `authz.assert(..., { ownerEmployeeId })`.
- **Nobody changes their own compensation**, whatever the role (`FORBIDDEN`): an Admin's or HR person's pay is changed by
  another HR/Admin person. Reading your own record is allowed for the two roles (they hold the permission), and every
  person can get their own records in the GDPR export (see 4).
- An unknown employee, or one of another workspace, is `404`.

### 3. Audit and notifications

- Every change is audited (`compensation.set`, `compensation.removed`) with the employee id, `valid_from`, `basis` and
  `currency`, **never the amount**. Reads are not audited (like profile data). No notification: pay changes are communicated
  by people, and a notification would reveal that something changed.
- Amounts are never logged, never put in notification or audit params, and never in error messages.

### 4. Data protection

- Export: `GET /privacy/export` lists the person's own compensation rows (they are data about them, Art. 15); the HR export
  of a person includes it too. Erasure deletes the rows (they are not statutory records kept by InTime, which holds no
  payroll). Deactivation keeps them (history). Automatic retention (ADR 0027) uses the same erasure.
- The API response is `Cache-Control: no-store` like other personal-data responses.

### 5. API and web

- `GET /employees/:id/compensation` (`compensation.view`), `PUT /employees/:id/compensation` (`compensation.manage`),
  `DELETE /employees/:id/compensation/:rowId` (`compensation.manage`). Every response is the complete list, newest first, with
  `current` marking the row in force today.
- Web: a "Compensation" card on the employee profile, rendered **only** for people who hold `compensation.view` (cosmetic;
  the server decides) and an editor for `compensation.manage`: basis, amount, currency, valid-from, and a delete button per
  row. Cards, no wide table, en/de/bg.

### 6. Out of scope

Payroll runs, taxes and contributions, overtime or leave pay, cost reports or margins (time x rate), budgets in money,
bonuses/equity/benefits, salary bands and reviews, currency conversion, approval workflows for pay changes, bulk import.
