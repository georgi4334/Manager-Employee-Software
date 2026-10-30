# ADR 0036 — Role hierarchy (tree of roles)

Status: accepted · Builds on [ADR 0003](0003-roles-and-permissions.md), [0031](0031-role-editor.md), [0021](0021-feedback.md)

## Context

The Roles page was a flat list of cards. People asked for an org-chart style tree that shows how roles relate (Admin above HR,
HR above Manager, a custom "Team lead" under Manager and so on), and for Admin **and HR** to place a new role in that tree and
move roles around later. Until now only Admin could create or change custom roles.

## Decisions

### 1. The tree is for display only

- `role.parent_id` (nullable, composite foreign key `(tenant_id, parent_id)` to `role (tenant_id, id)`) says which role a role
  sits under. A role without a parent is a root.
- **The tree never changes what anybody may do.** Every role keeps exactly its own grants; nothing is inherited from a parent and
  nothing is restricted by rank. Authorization does not read `parent_id`. So moving a role is not a security change, and the
  escalation and last-administrator rules of ADR 0031 do not apply to moves.
- System roles can be moved as well (only their place in the tree; their grants stay read-only). New workspaces and the migration
  start with Admin → HR → Manager → Employee; `roles:sync` never changes an existing placement.
- No cycles: a role cannot sit under itself or one of its own descendants. The service checks under a per-workspace advisory
  lock (`role-tree:<tenant>`), answering `VALIDATION_FAILED` with detail `role_cycle`; a database trigger re-checks. The parent
  must exist in the same workspace (`VALIDATION_FAILED`, detail `unknown_role`; another workspace's role is unknown by RLS).
- Deleting a custom role moves its sub-roles up to its own parent in the same transaction.
- Siblings are ordered system roles first, then by name; there is no manual ordering.

### 2. API

| Endpoint                | Rules                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /roles`            | each item also has `parentId` and `modules` (the modules its grants cover, catalog order) (additive) |
| `GET /roles/:id`        | also `parentId`                                                                                      |
| `POST /roles`           | optional `parentId` (`null` or missing = root)                                                       |
| `PUT /roles/:id`        | optional `parentId` (missing = unchanged); system roles stay `FORBIDDEN` here                        |
| `PUT /roles/:id/parent` | `{ parentId: uuid \| null }`, any role including system roles, `admin.role.manage`                   |

- Moves are audited as `role.moved` with the role id and the old and new parent ids only.

### 3. HR manages roles

- `admin.role.manage` is now granted to **HR and Admin** (scope `all`). HR creates, changes, deletes and moves custom roles under
  the unchanged ADR 0031 rules: nobody grants what they do not hold, system roles' grants are read-only, a role is deleted only
  while nobody holds it, and a change can never remove the last administrator. Assigning roles to people
  (`admin.role.assign`) stays with Admin.

### 4. Nobody assigns a custom role they could not have built

- HR holds `feedback.view_received` at `all`, which Admin deliberately does not (ADR 0021). Once HR builds roles, a custom role
  could carry it, and Admin (who assigns roles) could hand it to anyone, themselves included. To close that path, **assigning a
  custom role** (invitation or `PUT /users/:id/roles`) requires the assigner to hold every grant of that role at its scope or
  wider (the same `escalations` check as the editor). Otherwise `FORBIDDEN` with detail `cannot_assign`. Roles the person
  already has are not re-checked, and system roles are exempt (their grants are a product decision in the catalog).
- Before this change only Admin built custom roles, and every custom role was a subset of Admin's grants, so Admin's existing
  assignments are unaffected.

### 5. Web

- `/roles` shows the tree like an org chart: a card per role with its name, a System/Custom badge, the number of people who hold
  it, the number of permissions and the modules they cover, and the number of direct sub-roles. Levels connect with lines; each
  card can collapse its branch. On a phone the tree becomes indented cards (no horizontal scrolling).
- People with `admin.role.manage` get a "Move" button on each card (a dialog with a "Sits under" select; roles that would make a
  cycle are not offered) and a "Sits under" select in the role editor. Buttons, not drag and drop (ADR 0034 reasoning).

## Consequences

- One nullable column, one trigger, one endpoint; no permission behaviour changes except the assignment check of section 4.
- `roles:sync` must run on deploy (the catalog changed: HR gains `admin.role.manage`).
