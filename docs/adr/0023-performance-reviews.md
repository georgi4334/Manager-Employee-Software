# ADR 0023 — Performance reviews: cycles, self and manager reviews, calibration, release

Status: accepted · Phase 4 step 1 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0004](0004-notifications.md), [0007](0007-organization.md), [0011](0011-gdpr-export-erasure.md), [0019](0019-goals.md)

## Context

Once or twice a year HR wants every employee to **reflect on a period (self-review)**, every manager to **assess their
people against the same competencies**, HR to **calibrate** the ratings across managers, and each employee to **receive
the result**. The permission catalog already has `review.write_self` (everybody, own), `review.write_for_report`
(Manager `reports`, HR/Admin `all`), `review.view` (own / reports / all), `review.manage_cycles` and `review.calibrate`
(HR, Admin). Out of scope: peer (360°) reviews, anonymous input, weights and formulas, salary links (compensation is a later
module), goals scoring (goals are shown for reference only later), PDF export, automatic reminders.

## Decisions

### 1. Data (four tables, RLS, composite `(tenant_id, id)` foreign keys)

- `review_cycle`: `name` (≤ 80), `period_start`, `period_end`, `self_due`, `manager_due`, `status` (`draft` / `open` /
  `calibration` / `closed`), `opened_at`, `closed_at`.
- `review_competency`: `cycle_id`, `name` (≤ 60), `description` (≤ 300), `position`. Competencies belong to a **cycle**
  (no global catalog); a new cycle can copy those of an earlier one.
- `review`: one per employee and cycle (unique): `cycle_id`, `employee_id`, `self_summary`, `self_submitted_at`,
  `manager_summary`, `overall_rating` (1–5), `manager_submitted_at`, `manager_author_id` (who wrote it),
  `calibrated_rating` (1–5), `released_at`.
- `review_rating`: `review_id`, `competency_id`, `part` (`self` / `manager`), `score` (1–5), `comment` (≤ 500); unique per
  review, competency and part.

### 2. The lifecycle of a cycle

| Status        | What happens                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft`       | HR sets the dates and the competencies (1–12). Nothing is visible to others. Can be deleted.                                                                   |
| `open`        | Opening creates **one review for every active employee**. Employees write and submit their self-review; managers write and submit theirs. Competencies freeze. |
| `calibration` | Writing stops (HR can reopen a part). HR sees all submitted ratings and sets a **calibrated rating** per review.                                               |
| `closed`      | Every review whose manager part is submitted is **released** to its employee (`released_at`). Nothing changes any more.                                        |

Transitions only go forward: `draft → open → calibration → closed`. Each transition is audited (ids and the new status).
Closing with manager reviews still missing is allowed; those reviews are never released.

### 3. Writing

- **Self-review** (`review.write_self`, only the employee on their own review, cycle `open`): a score 1–5 and an optional
  comment per competency, plus an optional summary (≤ 2000). Saving a draft is allowed with a partial set; **submit**
  needs every competency scored and then locks the part.
- **Manager review** (`review.write_for_report` through `authz` on the employee, cycle `open`): the same, plus an
  **overall rating** 1–5 (needed to submit). **Nobody writes the manager part of their own review**, whatever their role.
  The author is recorded; if the reporting line changes, whoever holds the permission over the employee now writes.
- **Reopen** (`review.calibrate`, cycle `open` or `calibration`): clears the submitted mark of one part so it can be
  corrected; audited. A released review is final.

### 4. Who sees what

| Reader                                                                              | Self part                          | Manager part, overall rating             | Calibrated rating                           |
| ----------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------- | ------------------------------------------- |
| the employee (on their own review)                                                  | always (own drafts too)            | only after **release**                   | only after release, as the **final rating** |
| a manager or other reader through `review.view` (`reports`/`all`) without calibrate | once the employee **submitted** it | their own drafts; others' once submitted | after release only                          |
| a calibrator (`review.calibrate`: HR, Admin)                                        | once submitted                     | once submitted                           | always                                      |

The **final rating** is `calibrated_rating`, else `overall_rating`. A review the caller may not see is `404`. Cycles in
`draft` are visible to `review.manage_cycles` only.

### 5. API (`/reviews`)

Cycles: `GET /reviews/cycles`, `GET /reviews/cycles/:id`, `POST`, `PATCH` and `DELETE` (draft), competencies
`POST/PATCH/DELETE /reviews/cycles/:id/competencies[/:cid]` (draft), `POST /reviews/cycles/:id/open|calibrate|close`.
Reviews: `GET /reviews?cycleId=&box=mine|team|all` (paged), `GET /reviews/:id`, `PUT /reviews/:id/self|manager`,
`POST /reviews/:id/self/submit|manager/submit`, `PUT /reviews/:id/calibration`, `POST /reviews/:id/reopen`. Reads and
writes are `@Authenticated()` or carry the matching permission; the service applies the scope with `authz` on the employee.

### 6. Notifications, audit, privacy

- `review.cycle_opened` to every participant (the cycle id) and `review.released` to the employee (the review id).
  Neither carries names, texts or ratings.
- Audit: cycle transitions, calibrations, reopen (ids, the new status, the part) — never ratings or texts.
- Export: the person's own self-review, and the manager part and final rating **only if released**. Erasure deletes the
  reviews **about** the person; reviews they wrote about others stay with the other person's file (author shown as the
  placeholder).

### 7. Web

`/reviews`: **My reviews** (the employee's reviews per cycle: write and submit the self-review, read the released
result), **Team** (the manager's reports in the open cycle: write and submit), and for HR **Cycles** (create, competencies,
open, calibrate, close) with a **Calibration** list per cycle. Nav entry for `review.view`.

## Consequences

- Because a review exists for every active employee at opening, someone hired later has no review in that cycle.
- Ratings are not averaged or weighted anywhere; the system holds the numbers and the texts, people decide.
