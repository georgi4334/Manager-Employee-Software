-- Multi-tenancy with Row Level Security. Design: docs/adr/0001-multi-tenancy-rls.md

-- Runtime roles (cluster-wide, so created only if missing). LOGIN and passwords are set outside
-- migrations: docker/postgres/init.sql locally, the hosting console in production.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intime_app') THEN
    CREATE ROLE intime_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intime_system') THEN
    CREATE ROLE intime_system NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO intime_app, intime_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO intime_app, intime_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO intime_app, intime_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO intime_app, intime_system;
-- Migration history is not application data. (Absent in Prisma's shadow database, hence the check.)
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM intime_app, intime_system;
  END IF;
END
$$;

-- Current tenant of the transaction (set by TenantDb via set_config(..., true)); NULL when unset.
CREATE FUNCTION public.app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Call once per tenant-scoped table in its migration: SELECT public.enable_tenant_rls('my_table');
CREATE FUNCTION public.enable_tenant_rls(target regclass) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s TO intime_app '
    'USING (tenant_id = public.app_current_tenant()) '
    'WITH CHECK (tenant_id = public.app_current_tenant())',
    target
  );
  EXECUTE format(
    'CREATE POLICY system_access ON %s TO intime_system USING (true) WITH CHECK (true)',
    target
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.enable_tenant_rls(regclass) FROM PUBLIC;

-- The tenant table: a tenant may read and update only itself; creating/deleting tenants is system-only.
ALTER TABLE public.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant FORCE ROW LEVEL SECURITY;
REVOKE INSERT, DELETE ON TABLE public.tenant FROM intime_app;
CREATE POLICY tenant_self_select ON public.tenant FOR SELECT TO intime_app
  USING (id = public.app_current_tenant());
CREATE POLICY tenant_self_update ON public.tenant FOR UPDATE TO intime_app
  USING (id = public.app_current_tenant())
  WITH CHECK (id = public.app_current_tenant());
CREATE POLICY system_access ON public.tenant TO intime_system USING (true) WITH CHECK (true);
