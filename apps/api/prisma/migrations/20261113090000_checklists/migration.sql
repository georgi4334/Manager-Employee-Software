
-- CreateTable
CREATE TABLE "checklist_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "checklist_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "responsible" TEXT NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "checklist_template_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "employee_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "anchor_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "checklist_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "responsible" TEXT NOT NULL,
    "assignee_employee_id" UUID,
    "due_date" DATE NOT NULL,
    "done_at" TIMESTAMPTZ(6),
    "done_by_employee_id" UUID,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "checklist_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklist_template_tenant_id_kind_idx" ON "checklist_template"("tenant_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_template_tenant_id_id_key" ON "checklist_template"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "checklist_template_item_tenant_id_template_id_position_idx" ON "checklist_template_item"("tenant_id", "template_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_template_item_tenant_id_id_key" ON "checklist_template_item"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "checklist_tenant_id_employee_id_idx" ON "checklist"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "checklist_tenant_id_status_created_at_idx" ON "checklist"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_tenant_id_id_key" ON "checklist"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "checklist_item_tenant_id_checklist_id_position_idx" ON "checklist_item"("tenant_id", "checklist_id", "position");

-- CreateIndex
CREATE INDEX "checklist_item_tenant_id_assignee_employee_id_done_at_idx" ON "checklist_item"("tenant_id", "assignee_employee_id", "done_at");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_item_tenant_id_id_key" ON "checklist_item"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "checklist_template" ADD CONSTRAINT "checklist_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_item" ADD CONSTRAINT "checklist_template_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_item" ADD CONSTRAINT "checklist_template_item_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "checklist_template"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist" ADD CONSTRAINT "checklist_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist" ADD CONSTRAINT "checklist_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_tenant_id_checklist_id_fkey" FOREIGN KEY ("tenant_id", "checklist_id") REFERENCES "checklist"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_tenant_id_assignee_employee_id_fkey" FOREIGN KEY ("tenant_id", "assignee_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_tenant_id_done_by_employee_id_fkey" FOREIGN KEY ("tenant_id", "done_by_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "checklist_template" ADD CONSTRAINT "checklist_template_kind_check" CHECK ("kind" IN ('onboarding', 'offboarding'));
ALTER TABLE "checklist_template" ADD CONSTRAINT "checklist_template_name_check" CHECK (length("name") BETWEEN 1 AND 80);
ALTER TABLE "checklist_template_item" ADD CONSTRAINT "checklist_template_item_values_check"
  CHECK (length("title") BETWEEN 1 AND 120
    AND ("description" IS NULL OR length("description") <= 500)
    AND "responsible" IN ('employee', 'manager', 'hr')
    AND "offset_days" BETWEEN -60 AND 180);
ALTER TABLE "checklist" ADD CONSTRAINT "checklist_values_check"
  CHECK ("kind" IN ('onboarding', 'offboarding')
    AND "status" IN ('open', 'done', 'cancelled')
    AND length("name") BETWEEN 1 AND 80
    AND ("status" = 'done') = ("completed_at" IS NOT NULL)
    AND ("status" = 'cancelled') = ("cancelled_at" IS NOT NULL));
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_values_check"
  CHECK (length("title") BETWEEN 1 AND 120
    AND ("description" IS NULL OR length("description") <= 500)
    AND "responsible" IN ('employee', 'manager', 'hr')
    -- a ticker without a tick makes no sense (the ticker may be cleared by erasure, the tick stays)
    AND ("done_by_employee_id" IS NULL OR "done_at" IS NOT NULL));

-- At most one default template per kind, and one open checklist per person and kind.
CREATE UNIQUE INDEX "checklist_template_default_key" ON "checklist_template"("tenant_id", "kind") WHERE "is_default";
CREATE UNIQUE INDEX "checklist_open_key" ON "checklist"("tenant_id", "employee_id", "kind") WHERE "status" = 'open';

SELECT public.enable_tenant_rls('public.checklist_template');
SELECT public.enable_tenant_rls('public.checklist_template_item');
SELECT public.enable_tenant_rls('public.checklist');
SELECT public.enable_tenant_rls('public.checklist_item');
