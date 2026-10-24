-- CreateTable
CREATE TABLE "attendance_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "check_in_at" TIMESTAMPTZ(6) NOT NULL,
    "check_out_at" TIMESTAMPTZ(6),
    "mode" TEXT NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'clock',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_record_tenant_id_employee_id_work_date_idx" ON "attendance_record"("tenant_id", "employee_id", "work_date");

-- CreateIndex
CREATE INDEX "attendance_record_tenant_id_work_date_idx" ON "attendance_record"("tenant_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_record_tenant_id_id_key" ON "attendance_record"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_mode_check"
  CHECK ("mode" IN ('office', 'remote', 'field'));
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_source_check"
  CHECK ("source" IN ('clock', 'entry', 'correction'));
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_note_check"
  CHECK ("note" IS NULL OR length("note") <= 200);
-- Check-out comes after check-in, and one record is at most 16 hours (a night shift is two records).
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_duration_check"
  CHECK ("check_out_at" IS NULL
      OR ("check_out_at" > "check_in_at" AND "check_out_at" - "check_in_at" <= interval '16 hours'));

-- One open record per employee.
CREATE UNIQUE INDEX "attendance_record_one_open" ON "attendance_record" ("tenant_id", "employee_id")
  WHERE "check_out_at" IS NULL;

-- The records of one employee never overlap; an open record extends to infinity.
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "employee_id" WITH =,
    tstzrange("check_in_at", COALESCE("check_out_at", 'infinity'::timestamptz), '[)') WITH &&
  );

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.attendance_record');
