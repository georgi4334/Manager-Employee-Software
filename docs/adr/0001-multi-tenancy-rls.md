# ADR 0001 — Multi-tenancy with PostgreSQL Row Level Security

Status: accepted · Phase 0 step 5

## Context

InTime is multi-tenant SaaS: one database, one schema, every tenant-owned row carries `tenant_id`.
A single missing `WHERE tenant_id = …` in application code would leak one company's HR data to another, so isolation must not depend on every developer remembering the filter.

## Decision

Isolation is enforced **inside PostgreSQL** with Row Level Security, and the application filters as well.

### Database roles

| Role                  | Used by                                                                                                    | Rights                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| owner (e.g. `intime`) | migrations only (`MIGRATION_DATABASE_URL`)                                                                 | owns tables; never used by the running API                       |
| `intime_app`          | the API for normal requests (`DATABASE_URL`)                                                               | SELECT/INSERT/UPDATE/DELETE, **only rows of the current tenant** |
| `intime_system`       | narrow cross-tenant operations (`SYSTEM_DATABASE_URL`): tenant provisioning, login lookup, background jobs | DML on all rows, no DDL                                          |

- Neither runtime role is superuser, has `BYPASSRLS`, or owns tables. The API **refuses to start** if `DATABASE_URL` connects as such a role (`DatabaseSafetyService`).
- Roles are created (NOLOGIN) by the migration; LOGIN + password are set outside migrations (`docker/postgres/init.sql` locally, the hosting console in production) so no secret lives in git.
- `intime_system` access is restricted in code: an ESLint rule only allows importing `SystemPrismaService` from `infrastructure/`, `modules/tenants/` and `modules/auth/`.

### How the tenant reaches the database

1. Every request runs inside an `AsyncLocalStorage` context (`TenantContext`). Authentication (step 6) sets the tenant id from the verified token; it cannot be changed afterwards within that request.
2. Data access goes through `TenantDb.tx(fn)`: it opens a transaction and runs `set_config('app.tenant_id', <id>, true)` first. `true` = transaction-local, so the value disappears at commit/rollback and can never leak to the next request on a pooled connection (safe with PgBouncer/Neon pooler in transaction mode).
3. Nested `tx()` calls reuse the same transaction.
4. No tenant in context → `TenantDb` throws before touching the database.

### Policies

- SQL helper `public.app_current_tenant()` returns the setting as `uuid` (NULL when unset).
- Every tenant-scoped table is enabled with one call in its migration: `SELECT public.enable_tenant_rls('<table>');` which does `ENABLE` + **`FORCE`** RLS and creates:
  - `tenant_isolation` for `intime_app`: `USING` and `WITH CHECK` `tenant_id = app_current_tenant()` — cannot read, update, delete **or insert** rows of another tenant.
  - `system_access` for `intime_system`: all rows.
- New tables should declare `tenant_id uuid NOT NULL DEFAULT public.app_current_tenant()` (Prisma: `@default(dbgenerated("app_current_tenant()"))`), so inserts are stamped automatically.
- `tenant` table: `intime_app` may only SELECT/UPDATE its own row; creating/deleting tenants is `intime_system` only.
- **Fail closed**: no tenant set → no rows visible, inserts rejected.

### Guard rails (tests)

- Schema guard test: every table in `public` either has `tenant_id` with RLS enabled + forced + both policies, or is on an explicit allowlist (`tenant`, `_prisma_migrations`). Forgetting `enable_tenant_rls` on a new table fails CI.
- Integration tests prove, against a real Postgres: cross-tenant reads/updates/deletes affect 0 rows, cross-tenant inserts fail, missing tenant sees nothing, the setting does not leak across pooled connections, and the system role sees everything.

## Consequences

- Every repository uses `TenantDb.tx`; a forgotten filter returns nothing instead of leaking.
- One extra `set_config` per transaction (negligible).
- Two extra connection strings per environment.
- Superusers always bypass RLS; that is why runtime roles must not be superusers (enforced at startup).
- Hosting: Neon/Supabase allow creating roles via SQL; document role passwords in the deployment step.
