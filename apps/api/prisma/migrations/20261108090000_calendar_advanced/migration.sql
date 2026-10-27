-- AlterTable
ALTER TABLE "calendar_event" ADD COLUMN     "recurrence_count" INTEGER,
ADD COLUMN     "recurrence_freq" TEXT,
ADD COLUMN     "recurrence_interval" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "recurrence_until" DATE,
ADD COLUMN     "recurrence_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "calendar_event_exception" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "event_id" UUID NOT NULL,
    "original_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_attendee" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "event_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "response" TEXT NOT NULL DEFAULT 'needs_action',
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_attendee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_exception_tenant_id_id_key" ON "calendar_event_exception"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_exception_tenant_id_event_id_original_date_key" ON "calendar_event_exception"("tenant_id", "event_id", "original_date");

-- CreateIndex
CREATE INDEX "calendar_attendee_tenant_id_employee_id_idx" ON "calendar_attendee"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_attendee_tenant_id_id_key" ON "calendar_attendee"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_attendee_tenant_id_event_id_employee_id_key" ON "calendar_attendee"("tenant_id", "event_id", "employee_id");

-- AddForeignKey
ALTER TABLE "calendar_event_exception" ADD CONSTRAINT "calendar_event_exception_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_exception" ADD CONSTRAINT "calendar_event_exception_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "calendar_event"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_attendee" ADD CONSTRAINT "calendar_attendee_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_attendee" ADD CONSTRAINT "calendar_attendee_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "calendar_event"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_attendee" ADD CONSTRAINT "calendar_attendee_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A repeating event: the rule is consistent (the API validates too; the database is the last line of defence).
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_recurrence_check" CHECK (
  "recurrence_weekdays" IS NOT NULL
  AND (
    ("recurrence_freq" IS NULL
      AND "recurrence_interval" = 1 AND cardinality("recurrence_weekdays") = 0
      AND "recurrence_until" IS NULL AND "recurrence_count" IS NULL)
    OR
    ("recurrence_freq" IS NOT NULL
      AND "recurrence_freq" IN ('daily', 'weekly', 'monthly', 'yearly')
      AND "recurrence_interval" BETWEEN 1 AND 30
      AND cardinality("recurrence_weekdays") <= 7
      AND 0 <= ALL ("recurrence_weekdays") AND 6 >= ALL ("recurrence_weekdays")
      AND ("recurrence_freq" = 'weekly' OR cardinality("recurrence_weekdays") = 0)
      AND ("recurrence_until" IS NULL OR "recurrence_count" IS NULL)
      AND ("recurrence_until" IS NULL OR "recurrence_until" >= "start_date")
      AND ("recurrence_count" IS NULL OR "recurrence_count" BETWEEN 1 AND 500))
  )
);

ALTER TABLE "calendar_attendee" ADD CONSTRAINT "calendar_attendee_response_check"
  CHECK ("response" IN ('needs_action', 'accepted', 'declined', 'tentative'));

-- Guests belong to personal events only, and the organizer is not a guest of their own event.
CREATE FUNCTION public.calendar_attendee_personal_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.calendar_event e
    WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.event_id
      AND e.scope = 'personal' AND e.owner_employee_id <> NEW.employee_id
  ) THEN
    RAISE EXCEPTION 'calendar_attendee_personal_only: guests need a personal event of another person' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "calendar_attendee_personal_only" BEFORE INSERT OR UPDATE OF "event_id", "employee_id" ON "calendar_attendee"
  FOR EACH ROW EXECUTE FUNCTION public.calendar_attendee_personal_only();

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.calendar_event_exception');
SELECT public.enable_tenant_rls('public.calendar_attendee');
