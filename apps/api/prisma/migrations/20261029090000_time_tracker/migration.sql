-- CreateTable
CREATE TABLE "time_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "employee_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "work_date" DATE NOT NULL,
    "minutes" INTEGER,
    "is_billable" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "source" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "time_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "employee_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_by_employee_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entry_tenant_id_employee_id_work_date_idx" ON "time_entry"("tenant_id", "employee_id", "work_date");

-- CreateIndex
CREATE INDEX "time_entry_tenant_id_project_id_work_date_idx" ON "time_entry"("tenant_id", "project_id", "work_date");

-- CreateIndex
CREATE INDEX "time_entry_tenant_id_task_id_idx" ON "time_entry"("tenant_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "time_entry_tenant_id_id_key" ON "time_entry"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "timesheet_tenant_id_status_idx" ON "timesheet"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_tenant_id_id_key" ON "timesheet"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_tenant_id_employee_id_week_start_key" ON "timesheet"("tenant_id", "employee_id", "week_start");

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "project"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_tenant_id_task_id_fkey" FOREIGN KEY ("tenant_id", "task_id") REFERENCES "task"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_tenant_id_decided_by_employee_id_fkey" FOREIGN KEY ("tenant_id", "decided_by_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_source_check" CHECK ("source" IN ('timer', 'manual'));
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_minutes_check"
  CHECK ("minutes" IS NULL OR ("minutes" BETWEEN 1 AND 960));
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_note_check" CHECK ("note" IS NULL OR length("note") <= 500);
-- Manual entries carry minutes and no timestamps; a timer has a start, and minutes exactly when it has stopped.
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_shape_check" CHECK (
  ("source" = 'manual' AND "started_at" IS NULL AND "ended_at" IS NULL AND "minutes" IS NOT NULL)
  OR ("source" = 'timer' AND "started_at" IS NOT NULL
      AND ("ended_at" IS NULL) = ("minutes" IS NULL)
      AND ("ended_at" IS NULL OR "ended_at" >= "started_at"))
);
-- One running timer per person.
CREATE UNIQUE INDEX "time_entry_one_running_idx" ON "time_entry"("tenant_id", "employee_id")
  WHERE "source" = 'timer' AND "ended_at" IS NULL;

ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_status_check"
  CHECK ("status" IN ('submitted', 'approved', 'rejected', 'open'));
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_week_start_check" CHECK (EXTRACT(ISODOW FROM "week_start") = 1);

-- A time entry's task belongs to the entry's project (the composite foreign key cannot say it for a nullable column).
CREATE FUNCTION public.time_entry_task_same_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.task t
    WHERE t.tenant_id = NEW.tenant_id AND t.id = NEW.task_id AND t.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'time_entry_task_same_project: the task belongs to another project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "time_entry_task_same_project" BEFORE INSERT OR UPDATE OF "task_id", "project_id" ON "time_entry"
  FOR EACH ROW EXECUTE FUNCTION public.time_entry_task_same_project();

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.time_entry');
SELECT public.enable_tenant_rls('public.timesheet');
