-- One-time production database setup, run as the database owner (Neon: the default owner role):
--   psql "$MIGRATION_DATABASE_URL" -v app_password="$APP_PW" -v system_password="$SYS_PW" -f ops/bootstrap-db.sql
-- Creates the two runtime login roles of docs/adr/0001-multi-tenancy-rls.md with generated passwords.
-- Migrations (pnpm --filter @intime/api db:deploy) grant their table privileges; run this BEFORE the first one.
-- Safe to re-run: it only sets the passwords again (rotation).
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intime_app') AS create_app \gset
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intime_system') AS create_system \gset

\if :create_app
  CREATE ROLE intime_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
\endif
\if :create_system
  CREATE ROLE intime_system LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
\endif

ALTER ROLE intime_app LOGIN PASSWORD :'app_password';
ALTER ROLE intime_system LOGIN PASSWORD :'system_password';
