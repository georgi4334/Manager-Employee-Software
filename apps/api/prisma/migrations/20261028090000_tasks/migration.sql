-- AlterTable
ALTER TABLE "project" ADD COLUMN     "task_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "milestone_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'functional',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assignee_employee_id" UUID,
    "estimate_hours" DECIMAL(6,1),
    "due_date" DATE,
    "done_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_tenant_id_project_id_status_idx" ON "task"("tenant_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "task_tenant_id_assignee_employee_id_idx" ON "task"("tenant_id", "assignee_employee_id");

-- CreateIndex
CREATE INDEX "task_tenant_id_milestone_id_idx" ON "task"("tenant_id", "milestone_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_tenant_id_id_key" ON "task"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "task_tenant_id_project_id_number_key" ON "task"("tenant_id", "project_id", "number");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "project"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_tenant_id_milestone_id_fkey" FOREIGN KEY ("tenant_id", "milestone_id") REFERENCES "milestone"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_tenant_id_assignee_employee_id_fkey" FOREIGN KEY ("tenant_id", "assignee_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "task" ADD CONSTRAINT "task_type_check" CHECK ("type" IN ('functional', 'non_functional'));
ALTER TABLE "task" ADD CONSTRAINT "task_status_check"
  CHECK ("status" IN ('todo', 'in_progress', 'review', 'done'));
ALTER TABLE "task" ADD CONSTRAINT "task_priority_check" CHECK ("priority" IN ('low', 'normal', 'high'));
ALTER TABLE "task" ADD CONSTRAINT "task_text_check"
  CHECK (length("title") BETWEEN 1 AND 120 AND ("description" IS NULL OR length("description") <= 2000));
ALTER TABLE "task" ADD CONSTRAINT "task_number_check" CHECK ("number" >= 1);
ALTER TABLE "task" ADD CONSTRAINT "task_estimate_check"
  CHECK ("estimate_hours" IS NULL OR ("estimate_hours" >= 0 AND "estimate_hours" <= 1000));
-- A finished task says when, an open one does not.
ALTER TABLE "task" ADD CONSTRAINT "task_done_check" CHECK (("status" = 'done') = ("done_on" IS NOT NULL));
ALTER TABLE "project" ADD CONSTRAINT "project_task_seq_check" CHECK ("task_seq" >= 0);

-- A task's milestone belongs to the task's project (the composite foreign key cannot say it for a nullable column).
CREATE FUNCTION public.task_milestone_same_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.milestone_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.milestone m
    WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.milestone_id AND m.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'task_milestone_same_project: the milestone belongs to another project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "task_milestone_same_project" BEFORE INSERT OR UPDATE OF "milestone_id", "project_id" ON "task"
  FOR EACH ROW EXECUTE FUNCTION public.task_milestone_same_project();

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.task');
