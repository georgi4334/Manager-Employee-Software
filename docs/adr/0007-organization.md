# ADR 0007 — Organization (departments, teams, reporting lines)

Status: accepted · Phase 1 step 2 · Builds on [ADR 0003](0003-roles-and-permissions.md) and [ADR 0006](0006-employees.md)

## Context

Managers must see and approve for "their" people, HR for everybody, a department head for the department. ADR 0003
defined the scopes (`own < reports < team < department < all`) and a fail-closed `OrgRelations` provider that only
knew "self" and "other". This step supplies the real answer from the reporting tree and the departments, and the
screens to maintain them. Every later module (leave approval, attendance, goals, reviews) relies on it, so a
mistake here is a data leak or a lock-out.

## Decisions

### 1. Data model (tenant-scoped, RLS, composite `(tenant_id, id)` foreign keys)

| Table / column           | Notes                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `employee.manager_id`    | the direct manager (an active employee), nullable, never the employee itself                     |
| `employee.department_id` | at most one department per employee                                                              |
| `department`             | `name` (unique per workspace, case-insensitive), `parent_id` (tree), `head_employee_id`          |
| `team`                   | `name` (unique per department, case-insensitive), `department_id` (required), `lead_employee_id` |
| `team_member`            | `(team_id, employee_id)`; an employee can be in several teams                                    |

- **Position** stays free text (`employee.job_title`): a separate table would only add upkeep for a 250-person company.
- **Employment history** (promotion, transfer, manager change) is not stored yet; changes are in the audit log (ids only).
- Teams are for grouping and later features (calendar, goals); **permissions follow the reporting tree and the
  department, not team membership**.

### 2. Relations behind the scopes

`DbOrgRelations` replaces `SelfOnlyOrgRelations`. For an actor and a record owner (an employee) it answers:

| Relation          | When                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `self`            | the owner is the actor                                                                              |
| `direct_report`   | the owner's `manager_id` is the actor                                                               |
| `subordinate`     | the actor is any ancestor in the owner's manager chain (recursive query)                            |
| `same_department` | both have a department and it is the same one (no roll-up of sub-departments)                       |
| `other`           | everything else, **including every case where actor or owner has no employee record** (fail closed) |

The first matching row wins (order above); scopes cover them as defined in ADR 0003 (`team` = self, reports and all
below them, `department` adds the department). `AuthorizationService` gains `ownerEmployeeId` next to
`ownerUserId` (employees without an account have no user), and a batch lookup so a list of 100 people costs one
query. Permissions and relations are read fresh on every request; nothing is cached.

### 3. Integrity

- **No cycles.** Setting a manager (or a department parent) that would make a node its own ancestor is refused
  (`ORG_CYCLE`). Writes take a per-workspace advisory lock (concurrent "A under B" and "B under A" cannot both
  succeed), and a database trigger re-checks as a last line of defence.
- A manager must be an **active** employee. An employee cannot be their own manager.
- A department cannot be deleted while it has employees, sub-departments or teams (`CONFLICT`, `params.field = "in_use"`).
- **Deactivating an employee** (ADR 0006) keeps the tree whole in the same transaction: their direct reports move
  to the deactivated person's own manager (or to nobody), they stop being department head / team lead and leave all
  teams. **Reactivating** restores them without manager if the former manager is no longer active.

### 4. Endpoints (`/api/v1`)

| Endpoint                                   | Permission   | Behaviour                                                                  |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------------- |
| `GET /org/chart`                           | `org.view`   | all active employees as a flat list (id, name, title, manager, department) |
| `GET /org/departments`, `GET /org/teams`   | `org.view`   | with member counts, head / lead names; teams with their members            |
| `POST/PATCH/DELETE /org/departments[/:id]` | `org.manage` | name, parent, head (head must be an active employee)                       |
| `POST/PATCH/DELETE /org/teams[/:id]`       | `org.manage` | name, department, lead                                                     |
| `PUT /org/teams/:id/members`               | `org.manage` | replaces the member list (active employees, at most 200)                   |
| `PUT /org/employees/:id/assignment`        | `org.manage` | `{ managerId, departmentId }` (both nullable); cycle check                 |

`org.view` and `org.manage` exist only at scope `all` (catalog), so there is no partial view of the structure.
The employee payload gains `department`, `manager` and `teams` (names only) and the directory can be filtered by
department. All changes are audited with ids only.

### 4. Web

"Organization" (existing nav entry): three tabs — **Chart** (collapsible tree; on a phone a nested list),
**Departments**, **Teams**. HR/Admin additionally get add/edit/delete and member editing; the employee page shows
manager, department and teams, and HR can change manager and department there. All strings en/de/bg.

## Consequences

- The Manager role's `team`/`reports` grants (profiles, later leave approval, attendance, goals…) become real.
  Until a manager is assigned to people, nothing changes for them; a mis-assigned manager sees that person's data,
  so assignment is HR/Admin only and audited.
- Teams do not grant access. If "team lead may approve" is wanted later, it is a new scope, decided separately.
- Future consumers call `authz.assert(actor, code, { ownerEmployeeId })`; they never join the org tables themselves.

## Not in this step

Employment history view, position catalog, matrix (dotted-line) reporting, department-head based permissions,
org chart export/print, drag-and-drop editing.
