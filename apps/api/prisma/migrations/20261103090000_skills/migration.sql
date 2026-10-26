-- CreateTable
CREATE TABLE "skill_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "skill_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_skill" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "employee_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "assessed_by_employee_id" UUID,
    "assessed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_skill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skill_category_tenant_id_id_key" ON "skill_category"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_category_tenant_id_name_key" ON "skill_category"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "skill_tenant_id_category_id_idx" ON "skill"("tenant_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_tenant_id_id_key" ON "skill"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_tenant_id_name_key" ON "skill"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "employee_skill_tenant_id_skill_id_level_idx" ON "employee_skill"("tenant_id", "skill_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "employee_skill_tenant_id_id_key" ON "employee_skill"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_skill_tenant_id_employee_id_skill_id_key" ON "employee_skill"("tenant_id", "employee_id", "skill_id");

-- AddForeignKey
ALTER TABLE "skill_category" ADD CONSTRAINT "skill_category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill" ADD CONSTRAINT "skill_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill" ADD CONSTRAINT "skill_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "skill_category"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skill" ADD CONSTRAINT "employee_skill_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skill" ADD CONSTRAINT "employee_skill_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skill" ADD CONSTRAINT "employee_skill_tenant_id_skill_id_fkey" FOREIGN KEY ("tenant_id", "skill_id") REFERENCES "skill"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skill" ADD CONSTRAINT "employee_skill_tenant_id_assessed_by_employee_id_fkey" FOREIGN KEY ("tenant_id", "assessed_by_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "skill_category" ADD CONSTRAINT "skill_category_name_check" CHECK (length("name") BETWEEN 1 AND 60);
ALTER TABLE "skill" ADD CONSTRAINT "skill_text_check"
  CHECK (length("name") BETWEEN 1 AND 60 AND ("description" IS NULL OR length("description") <= 300));
ALTER TABLE "employee_skill" ADD CONSTRAINT "employee_skill_level_check" CHECK ("level" BETWEEN 1 AND 5);

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.skill_category');
SELECT public.enable_tenant_rls('public.skill');
SELECT public.enable_tenant_rls('public.employee_skill');
