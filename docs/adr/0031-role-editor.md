# ADR 0031 — Role editor (custom roles)

Status: accepted · Phase 5 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0030](0030-compensation.md)

## Context

ADR 0003 stores roles and grants as data and promised custom roles "with the role editor UI". Until now only the four system
roles exist and they are defined in code. This step lets an administrator create, change and delete **custom roles** (for
example an outsourced contractor or a payroll clerk) in the app. A mistake here is a privilege escalation or a lock-out, so the
rules below are enforced by the server and covered by tests; the UI only mirrors them.

## Decisions

### 1. What can be edited

- **System roles are read-only** (`is_system`, their grants are synced from code by `roles:sync`). They can be viewed.
- **Custom roles** (`is_system = false`, no `key`): name (1 to 60 characters, unique without regard to case), an optional
  description (up to 200), and a set of grants `(permission code, scope)`. Names and descriptions are free text typed by the
  administrator and are not translated. At most 30 custom roles per workspace (`CONFLICT`, `field: limit`).
- Grants are validated against the catalog (`isValidGrant`): unknown codes, scopes the permission does not allow and duplicates
  are `VALIDATION_FAILED`. A role may have no grants at all.
- A role takes effect immediately for everybody who holds it: permissions are read fresh on every request.

### 2. API (`admin.role.view` to read, `admin.role.manage` to change; Admin only by default)

| Endpoint            | Rules                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /roles`        | now also returns `description`, `permissionCount` and `userCount` per role (additive)                          |
| `GET /roles/:id`    | one role with its grants; another workspace's id is `404`                                                      |
| `POST /roles`       | `{ name, description?, grants }`                                                                               |
| `PUT /roles/:id`    | replaces name, description and grants; a system role is `FORBIDDEN`                                            |
| `DELETE /roles/:id` | custom roles only; refused while any user holds it (`CONFLICT`, `field: in_use`); system roles are `FORBIDDEN` |

### 3. No privilege escalation

- **Nobody grants what they do not hold.** For every grant that is _new or wider_ than what the role already has, the actor must
  hold that permission at that scope or wider (`widerScope`). Otherwise `FORBIDDEN` with the detail code `cannot_grant` and the
  path of the grant. Grants already in the role and left unchanged are kept even when the actor lacks them (so a limited editor
  can still rename a role or remove grants), and removing or narrowing is always allowed.
- Consequently the permissions Admin does not hold (for example `feedback.view_received`, ADR 0021) can never be put into a
  custom role by an administrator, and a custom role with `admin.role.manage` cannot create something stronger than itself.
- Assigning roles keeps its own rules (`admin.role.assign`, ADR 0003).

### 4. No lock-out

- **An administrator is anyone holding `admin.role.assign`** (ADR 0003). A change that takes `admin.role.assign` away from a role
  (editing grants of a custom role) takes the same per-workspace **administrator lock** as every other change that can remove an
  administrator, applies the change, and is rolled back with `LAST_ADMIN` when no other active administrator would remain.
  Deleting is only possible for roles nobody holds, so it cannot remove one.

### 5. Audit

- `role.created`, `role.updated`, `role.deleted` with the role id; `created` and `updated` also list the permission codes (and
  scopes) that were added, changed or removed. **Never the name or description** (free text). No notification.

### 6. Web (`/roles`, nav entry for `admin.role.view` under Administration)

- A list of cards (name, "System" badge, description, number of permissions and people), mobile-first, no wide table.
- A role page: system roles and viewers without `admin.role.manage` see the grants read-only, grouped by module with the scope
  in words. The editor (custom roles, `admin.role.manage`): name, description, and per module one row per permission with a
  select of "No access" and the scopes the permission allows; scopes above what the actor holds are disabled and
  permissions the actor lacks are shown as unavailable (cosmetic, the server decides). "New role" can start from a copy of an
  existing role (only grants the actor holds are copied). Deleting asks for confirmation.
- Every permission has a **translated label** (`roles` namespace, en/de/bg); a test walks the catalog and fails when a
  permission or module has no text. The catalog descriptions stay English documentation for developers.

### 7. Out of scope

Editing system roles, role inheritance, per-user permission overrides, temporary roles, approval of role changes, importing or
exporting roles, a change history view (the audit log has it).
