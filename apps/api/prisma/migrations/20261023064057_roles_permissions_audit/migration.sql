-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,
    "scope" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "user_role" (
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_id_key" ON "role"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_key_key" ON "role"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_name_key" ON "role"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "user_role_role_id_idx" ON "user_role"("role_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "role"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "app_user"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "role"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allowed values (the permission codes themselves are validated in the application, against the catalog).
ALTER TABLE "role" ADD CONSTRAINT "role_key_check"
  CHECK ("key" IS NULL OR "key" IN ('admin', 'hr', 'manager', 'employee'));
ALTER TABLE "role" ADD CONSTRAINT "role_system_has_key_check"
  CHECK (("key" IS NOT NULL) = "is_system");
ALTER TABLE "role" ADD CONSTRAINT "role_name_check"
  CHECK (btrim("name") <> '');
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_scope_check"
  CHECK ("scope" IN ('own', 'reports', 'team', 'department', 'all'));
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_code_check"
  CHECK ("permission_code" ~ '^[a-z_]+(\.[a-z_]+)+$');
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check"
  CHECK (btrim("action") <> '' AND btrim("entity") <> '');

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.role');
SELECT public.enable_tenant_rls('public.role_permission');
SELECT public.enable_tenant_rls('public.user_role');
SELECT public.enable_tenant_rls('public.audit_log');

-- The audit log is append-only: nobody can rewrite history. The system role keeps DELETE for the
-- retention job (GDPR); the application role can only add and read entries.
REVOKE UPDATE, DELETE ON TABLE public.audit_log FROM intime_app;
REVOKE UPDATE ON TABLE public.audit_log FROM intime_system;
