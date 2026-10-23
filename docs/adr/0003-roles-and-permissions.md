# ADR 0003 — Roles and permissions

Status: accepted · Phase 0 step 7 · Builds on [ADR 0001](0001-multi-tenancy-rls.md) and [ADR 0002](0002-authentication.md)

## Context

Four seeded roles (Admin, HR, Manager, Employee) must decide who may do what, with scopes (own / direct
reports / team / department / all). New roles (e.g. outsourced employees) must be addable later **without a code
change**. The server is the only authority; the UI only hides things. Any mistake here is a data leak.

## Decisions

### 1. Permissions live in code, grants live in the database

- The **permission catalog** (code, module, description, allowed scopes, default grants of the four system
  roles) is defined once in `@intime/contracts` (`permissions.ts`). It is the single source of truth for the API,
  the web app, the tests and the generated documentation table.
- The database stores **roles, grants and assignments** (all tenant-scoped, RLS):
  `role`, `role_permission(role_id, permission_code, scope)`, `user_role`.
  There is deliberately **no global `permission` table**: a code constant cannot drift from a database copy.
  (This replaces the global `permission` table sketched in `docs/data-model.md`.)
- Unknown permission codes or scopes outside a permission's allowed scopes are rejected when grants are
  written (and ignored when read), so a typo can never silently grant access.

### 2. System roles

- Seeded **per tenant**: `admin`, `hr`, `manager`, `employee` (`role.is_system = true`, `role.key` set).
- Their grants are **defined in code** and copied into `role_permission` by `RoleSyncService`:
  at workspace creation, and for all workspaces by `pnpm --filter @intime/api roles:sync` (run after every
  deploy that changes the catalog). Not synced yet ⇒ permission missing ⇒ **denied** (fail closed).
- System roles cannot be edited or deleted through the API. Custom roles (`is_system = false`, no `key`)
  arrive with the role editor UI; they use the same tables and the same resolution path.

### 3. Scopes

Ordered `own < reports < team < department < all`; each includes the narrower ones.

| Scope        | Covers records of …                                     |
| ------------ | ------------------------------------------------------- |
| `own`        | the actor                                               |
| `reports`    | the actor and their direct reports                      |
| `team`       | the actor and everyone below them in the reporting tree |
| `department` | … plus everyone in the actor's department               |
| `all`        | everyone in the workspace                               |

A user with several roles gets, per permission, the **widest** scope among their roles (union).
How a record owner relates to the actor (`self`, `direct_report`, `subordinate`, `same_department`, `other`)
is answered by an `OrgRelations` provider. Until the Organization module exists the provider only knows
`self` and `other`, so `reports`/`team`/`department` grants **never reach beyond the actor** (fail closed).

### 4. Enforcement in three layers

1. **Route declaration (global `PermissionGuard`)** — every route must say how it is protected:
   `@Public()`, `@Authenticated()` (any signed-in user) or `@RequirePermission('code')`
   (any scope; the actor must hold the permission at all). A route that declares nothing is **rejected with
   403** and a test lists every route to prove none is undeclared.
2. **Resource check in services** — `AuthorizationService.assert(actor, 'leave.approve', { ownerUserId })`
   applies the scope to the concrete record. A permission without a resource is an "any scope" check.
3. **Database** — tenant isolation by RLS (ADR 0001) underneath everything.

Grants are loaded from the database **on every request** by `AuthGuard` (one indexed query), so role changes,
disabling and removals take effect immediately. They are also returned by `GET /auth/me` so the web app can
show/hide UI (`usePermission`, `<Can>`); that is cosmetic only.

### 5. Account administration (first consumers of the permissions)

`admin.user.view`, `admin.user.invite`, `admin.user.disable`, `admin.role.view`, `admin.role.assign`.

| Endpoint                  | Permission           | Rules                                                                                                                                                                                                       |
| ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /roles`              | `admin.role.view`    | lists the workspace's roles (ids, keys, names)                                                                                                                                                              |
| `GET /users`              | `admin.user.view`    | accounts with status and roles                                                                                                                                                                              |
| `POST /users/invitations` | `admin.user.invite`  | body `{ email, roleIds? }`; default role Employee; any other role additionally needs `admin.role.assign` (HR invites employees, only Admin creates admins/HR/managers); the link is emailed, never returned |
| `PUT /users/:id/roles`    | `admin.role.assign`  | `{ roleIds }` (at least one); last-administrator protection                                                                                                                                                 |
| `POST /users/:id/disable` | `admin.user.disable` | not yourself; last-administrator protection; ends all sessions                                                                                                                                              |
| `POST /users/:id/enable`  | `admin.user.disable` | back to `active`, or `invited` if the user never finished setting up                                                                                                                                        |

Rules that go beyond the matrix, all covered by tests:

- **An administrator is anyone holding `admin.role.assign`.** Disabling or re-enabling such an account needs
  `admin.role.assign` itself, so HR (who may disable people) cannot lock administrators out.
- **Last-administrator protection** (rule 8): a transaction-scoped advisory lock per workspace serialises every
  change that could remove an administrator, then the number of _other active_ administrators is checked
  (the change rolls back otherwise), so two administrators cannot remove each other concurrently.
- **The actor is re-checked after taking the lock**: a request from an account that was disabled while it
  waited is refused (401).
- Disabling ends all sessions, so re-enabling never revives old (possibly stolen) cookies.
- Foreign or unknown user ids answer 404 (Row Level Security hides other workspaces).
- Every change writes an audit entry (ids and role ids only; no email addresses).

### 5b. Operations

`roles:sync` (after deploys that change the catalog; safe to run any time, also concurrently) and
`roles:grant --workspace --email --role` (accounts created before roles existed, or recovery when
administrators are locked out). Both run with the system database role and write audit entries where relevant.

### 6. Audit log

`audit_log` (tenant-scoped, RLS): actor, action, entity, entity id, before/after (jsonb, no secrets, no
personal data beyond ids and role keys), timestamp. **Append-only by privilege**: `UPDATE` is revoked from both
runtime roles and `DELETE` from the app role (the system role keeps `DELETE` for the retention job). IP
addresses are not stored (personal data without a purpose yet).

### 7. Documentation cannot drift

The matrix table in `docs/permission-matrix.md` is **generated** from the catalog
(`pnpm --filter @intime/contracts docs:permissions`); a test fails when the committed file differs.

## Not in this step

Employees/Organization (so `reports`/`team`/`department` are not resolvable yet), role editor UI, user
management screens (they arrive with the Employees module), notifications about role changes.

## Consequences

- Adding a permission = add it to the catalog, regenerate the docs, run `roles:sync` on deploy.
- Every feature adds `@RequirePermission` on its routes and `assert(...)` with the record in its service, plus
  allowed/denied tests; the matrix test already covers who holds what.
- One extra query per authenticated request (grants); cacheable later if it ever matters.
