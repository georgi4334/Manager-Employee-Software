-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "user_id" UUID,
    "employee_no" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "job_title" TEXT,
    "location" TEXT,
    "employment_type" TEXT NOT NULL DEFAULT 'full_time',
    "seniority" TEXT,
    "hire_date" DATE,
    "termination_date" DATE,
    "birth_date" DATE,
    "phone" TEXT,
    "country" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_tenant_id_last_name_first_name_idx" ON "employee"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tenant_id_id_key" ON "employee"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tenant_id_user_id_key" ON "employee"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tenant_id_employee_no_key" ON "employee"("tenant_id", "employee_no");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "app_user"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "employee" ADD CONSTRAINT "employee_names_check"
  CHECK (length(btrim("first_name")) BETWEEN 1 AND 100 AND length(btrim("last_name")) BETWEEN 1 AND 100);
ALTER TABLE "employee" ADD CONSTRAINT "employee_employment_type_check"
  CHECK ("employment_type" IN ('full_time', 'part_time', 'contractor', 'outsourced'));
ALTER TABLE "employee" ADD CONSTRAINT "employee_seniority_check"
  CHECK ("seniority" IS NULL OR "seniority" IN ('intern', 'junior', 'mid', 'senior', 'lead', 'principal'));
ALTER TABLE "employee" ADD CONSTRAINT "employee_status_check" CHECK ("status" IN ('active', 'inactive'));
ALTER TABLE "employee" ADD CONSTRAINT "employee_country_check" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');
ALTER TABLE "employee" ADD CONSTRAINT "employee_dates_check"
  CHECK ("termination_date" IS NULL OR "hire_date" IS NULL OR "termination_date" >= "hire_date");
-- An inactive employee has left; an active one has not.
ALTER TABLE "employee" ADD CONSTRAINT "employee_termination_check"
  CHECK ("status" = 'inactive' OR "termination_date" IS NULL);

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.employee');

-- Employees are deactivated, never deleted by the application (legal retention; erasure anonymizes them).
REVOKE DELETE ON TABLE public.employee FROM intime_app;
