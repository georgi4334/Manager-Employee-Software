-- AlterTable
ALTER TABLE "employee" ADD COLUMN     "retention_hold" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "retention_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "country" TEXT NOT NULL DEFAULT 'BG',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "former_employee_months" INTEGER NOT NULL DEFAULT 60,
    "last_run_at" TIMESTAMPTZ(6),
    "last_run_erased" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_tenant_id_key" ON "retention_policy"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_tenant_id_id_key" ON "retention_policy"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "retention_policy" ADD CONSTRAINT "retention_policy_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "retention_policy" ADD CONSTRAINT "retention_policy_rules_check"
  CHECK ("country" IN ('BG') AND "former_employee_months" BETWEEN 12 AND 600 AND "last_run_erased" >= 0);

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.retention_policy');
