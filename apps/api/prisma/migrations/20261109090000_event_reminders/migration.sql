-- Event reminders (docs/adr/0029-event-reminders.md). Additive: the previous release ignores both.
ALTER TABLE "calendar_event" ADD COLUMN "reminder_minutes" INTEGER;

-- A lead of one hour or one day, only on personal and team events.
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_reminder_check" CHECK (
  "reminder_minutes" IS NULL
  OR ("reminder_minutes" IN (60, 1440) AND "scope" IN ('personal', 'team'))
);

-- CreateTable
CREATE TABLE "calendar_reminder" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "event_id" UUID NOT NULL,
    "occurrence_date" DATE NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_reminder_tenant_id_id_key" ON "calendar_reminder"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_reminder_tenant_id_event_id_occurrence_date_key" ON "calendar_reminder"("tenant_id", "event_id", "occurrence_date");

-- AddForeignKey
ALTER TABLE "calendar_reminder" ADD CONSTRAINT "calendar_reminder_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_reminder" ADD CONSTRAINT "calendar_reminder_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "calendar_event"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

SELECT public.enable_tenant_rls('public.calendar_reminder');
