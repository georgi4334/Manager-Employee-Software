-- Runs once when the local Postgres volume is created. Local-only passwords; production uses secrets.
-- Runtime roles (docs/adr/0001-multi-tenancy-rls.md). Migrations grant their table privileges.
CREATE ROLE intime_app LOGIN PASSWORD 'intime_app' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE intime_system LOGIN PASSWORD 'intime_system' NOSUPERUSER NOBYPASSRLS;

-- Separate database for integration tests so they never touch development data.
CREATE DATABASE intime_test OWNER intime;
