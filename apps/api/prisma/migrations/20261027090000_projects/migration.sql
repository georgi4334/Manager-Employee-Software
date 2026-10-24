-- CreateTable
CREATE TABLE "client" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "client_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "is_billable" BOOLEAN NOT NULL DEFAULT true,
    "budget_hours" DECIMAL(9,1),
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "lead_employee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "done_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "project_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role" TEXT,
    "allocation_pct" INTEGER NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_tenant_id_id_key" ON "client"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "project_tenant_id_client_id_idx" ON "project"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "project_tenant_id_lead_employee_id_idx" ON "project"("tenant_id", "lead_employee_id");

-- CreateIndex
CREATE INDEX "project_tenant_id_status_idx" ON "project"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_tenant_id_id_key" ON "project"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_tenant_id_code_key" ON "project"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "milestone_tenant_id_project_id_due_date_idx" ON "milestone"("tenant_id", "project_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_tenant_id_id_key" ON "milestone"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "project_assignment_tenant_id_project_id_idx" ON "project_assignment"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "project_assignment_tenant_id_employee_id_from_date_idx" ON "project_assignment"("tenant_id", "employee_id", "from_date");

-- CreateIndex
CREATE UNIQUE INDEX "project_assignment_tenant_id_id_key" ON "project_assignment"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "client"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_lead_employee_id_fkey" FOREIGN KEY ("tenant_id", "lead_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "project"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "project"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
CREATE UNIQUE INDEX "client_name_unique_ci" ON "client" ("tenant_id", lower("name"));
ALTER TABLE "client" ADD CONSTRAINT "client_status_check" CHECK ("status" IN ('active', 'archived'));
ALTER TABLE "client" ADD CONSTRAINT "client_text_check"
  CHECK (length("name") BETWEEN 1 AND 120
     AND ("contact_name" IS NULL OR length("contact_name") <= 100)
     AND ("contact_email" IS NULL OR length("contact_email") <= 254)
     AND ("notes" IS NULL OR length("notes") <= 1000));

ALTER TABLE "project" ADD CONSTRAINT "project_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{1,11}$');
ALTER TABLE "project" ADD CONSTRAINT "project_status_check"
  CHECK ("status" IN ('planned', 'active', 'paused', 'done'));
ALTER TABLE "project" ADD CONSTRAINT "project_priority_check" CHECK ("priority" IN ('low', 'normal', 'high'));
ALTER TABLE "project" ADD CONSTRAINT "project_text_check"
  CHECK (length("name") BETWEEN 1 AND 120 AND ("description" IS NULL OR length("description") <= 1000));
ALTER TABLE "project" ADD CONSTRAINT "project_budget_check" CHECK ("budget_hours" IS NULL OR "budget_hours" >= 0);
ALTER TABLE "project" ADD CONSTRAINT "project_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

ALTER TABLE "milestone" ADD CONSTRAINT "milestone_status_check" CHECK ("status" IN ('open', 'done'));
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_title_check" CHECK (length("title") BETWEEN 1 AND 120);
-- A finished milestone says when, an open one does not.
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_done_check"
  CHECK (("status" = 'done') = ("done_on" IS NOT NULL));

ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_allocation_check"
  CHECK ("allocation_pct" BETWEEN 1 AND 100);
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_dates_check"
  CHECK ("to_date" IS NULL OR "to_date" >= "from_date");
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_role_check"
  CHECK ("role" IS NULL OR length("role") <= 60);
-- The same person cannot be staffed twice on a project at the same time.
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "project_id" WITH =,
    "employee_id" WITH =,
    daterange("from_date", COALESCE("to_date", 'infinity'::date), '[]') WITH &&
  );

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.client');
SELECT public.enable_tenant_rls('public.project');
SELECT public.enable_tenant_rls('public.milestone');
SELECT public.enable_tenant_rls('public.project_assignment');
