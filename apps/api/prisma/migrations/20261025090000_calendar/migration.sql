-- CreateTable
CREATE TABLE "calendar_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "scope" TEXT NOT NULL,
    "owner_employee_id" UUID NOT NULL,
    "team_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "all_day" BOOLEAN NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "calendar_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_event_tenant_id_start_date_end_date_idx" ON "calendar_event"("tenant_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "calendar_event_tenant_id_owner_employee_id_idx" ON "calendar_event"("tenant_id", "owner_employee_id");

-- CreateIndex
CREATE INDEX "calendar_event_tenant_id_team_id_idx" ON "calendar_event"("tenant_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_tenant_id_id_key" ON "calendar_event"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_tenant_id_owner_employee_id_fkey" FOREIGN KEY ("tenant_id", "owner_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_tenant_id_team_id_fkey" FOREIGN KEY ("tenant_id", "team_id") REFERENCES "team"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_scope_check"
  CHECK ("scope" IN ('personal', 'team', 'company'));
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_team_check"
  CHECK (("scope" = 'team') = ("team_id" IS NOT NULL));
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_text_check"
  CHECK (length("title") BETWEEN 1 AND 120
     AND ("description" IS NULL OR length("description") <= 1000)
     AND ("location" IS NULL OR length("location") <= 200));
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_dates_check"
  CHECK ("end_date" >= "start_date" AND "end_date" - "start_date" < 31);
-- All-day events have no instants; timed events have both, in order.
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_times_check"
  CHECK (("all_day" AND "starts_at" IS NULL AND "ends_at" IS NULL)
      OR (NOT "all_day" AND "starts_at" IS NOT NULL AND "ends_at" IS NOT NULL AND "ends_at" > "starts_at"));

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.calendar_event');
