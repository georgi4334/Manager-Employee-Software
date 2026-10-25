# ADR 0019 — Goals: personal, team and company goals with key results

Status: accepted · Phase 3 step 1 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0007](0007-organization.md), [0010](0010-calendar.md), [0011](0011-gdpr-export-erasure.md)

## Context

People and teams should be able to say **what they want to achieve, how far they are, and how it connects to what the
company wants**. Phase 3 starts with goals; performance reviews (Phase 4) will later read them. Deliberately lean:
objectives with measurable key results, check-ins and alignment. Out of scope: weighting, scoring, cycles/quarters,
private goals, goal templates, notifications for every change.

## Decisions

### 1. Data model (three tables, all tenant-scoped with RLS and composite `(tenant_id, id)` foreign keys)

`goal`: `scope` (`personal` / `team` / `company`), `owner_employee_id` (for `personal` the person the goal belongs to;
for `team` and `company` the person who created it), `team_id` (exactly for `team`; deleting the team deletes its goals,
as for team calendar events), `parent_goal_id` (alignment), `title` (≤ 120), `description` (≤ 1000), `status`
(`draft` / `active` / `done` / `cancelled`), `due_date` (optional), `progress_pct` (0–100, the **manual** progress used
while the goal has no key results).

`key_result`: `goal_id`, `title` (≤ 120), `unit` (≤ 20, optional), `start_value`, `target_value`, `current_value`
(decimals), `position`. `target_value` differs from `start_value` (the database checks it); a target below the start is a
goal to **reduce** something (response time, defects).

`goal_update` (check-in): `goal_id`, `author_employee_id`, `progress_pct` (the progress at that moment, a snapshot) and a
`comment` (≤ 500). Append-only history; check-ins are never edited.

### 2. Progress is computed

A key result's progress is `(current − start) / (target − start)`, clamped to 0–100 %. A goal with key results has the
**average** of its key results (rounded); a goal without has its manual `progress_pct`. Both are pure functions in
contracts (`keyResultProgress`, `goalProgress`) with tests; the API sends the effective `progressPct`, the web never
recomputes. A goal is **overdue** when it is `draft` or `active` and its due date has passed (workspace time zone).

### 3. Alignment

A goal may point to a **strictly wider** goal: personal → team or company, team → company. A company goal has no parent.
Strictness makes cycles impossible. The parent must be visible to the person aligning. A goal with aligned goals under it
cannot be deleted (`CONFLICT`, `field: children`); it can be cancelled.

### 4. Who sees and changes what

| Scope      | Sees                                                                                                                                                 | Creates, changes, deletes, checks in                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company`  | everybody who holds `goal.view`                                                                                                                      | `goal.manage_company` (HR, Admin)                                                                                                                                         |
| `team`     | the team's members and lead; `goal.view` at scope `all`                                                                                              | `goal.manage_team`: scope `all` any team, otherwise only the **lead** of the team                                                                                         |
| `personal` | the owner and everybody whose `goal.view` scope reaches the owner (a manager sees the goals of their people, HR and Admin all); nobody else, **404** | `goal.manage_personal` through `authz` on the owner: the owner at `own`, a manager for their reports (`reports`), HR/Admin for all; a manager may create one for a report |

A goal the caller cannot see is `404`. `canEdit` is computed per caller. Personal goals are **not private** from the
management line: that is what the permission catalog already says ("managers: also their reports"); private goals are a
later decision.

### 5. API (`/goals`)

`GET /goals` (filters `scope`, `status`, `teamId`, `employeeId`, `q`, paging) and `GET /goals/:id` (key results,
check-ins, aligned goals the caller may see) need `goal.view`. Writes are `@Authenticated()` and check the permission of
the goal's scope in the service (the permission guard needs all listed codes, not any). `GET /goals/teams` lists the teams
the caller may create team goals for. Audit: ids, scope and changed field names, never titles or comments.
Notification `goal.assigned` (goal id only) when somebody else creates a personal goal for you.

### 6. Privacy

Personal goals can hold personal text. The data export lists goals of the person (personal goals with key results and
check-in comments, plus their check-ins on other goals). **Erasure** deletes their personal goals and clears the comments
of their check-ins; team and company goals they created stay. Deactivating an employee cancels their open personal goals.

### 7. Web

`/goals`: filter chips for Mine / Team / Company, status filter, goal cards with a progress bar (text as well as bar),
due date and overdue flag. `/goals/:id`: overview with edit, key results with an inline "current value" update,
check-in form and history, parent and aligned goals. Create form with scope-dependent fields. 375 px first; en/de/bg.

## Consequences

- Reviews (Phase 4) can read goals without changing them.
- Because progress is not stored for goals with key results, a corrected key result corrects everything above it at once.
- Check-in snapshots keep history truthful even when key results are later edited.
