-- CreateTable
CREATE TABLE "work_schedule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "employee_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "minutes" INTEGER[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_schedule_tenant_id_id_key" ON "work_schedule"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "work_schedule_tenant_id_employee_id_valid_from_key" ON "work_schedule"("tenant_id", "employee_id", "valid_from");

-- AddForeignKey
ALTER TABLE "work_schedule" ADD CONSTRAINT "work_schedule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_schedule" ADD CONSTRAINT "work_schedule_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "work_schedule" ADD CONSTRAINT "work_schedule_minutes_check"
  CHECK ("minutes" IS NOT NULL AND cardinality("minutes") = 7 AND 0 <= ALL ("minutes") AND 960 >= ALL ("minutes"));

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.work_schedule');
