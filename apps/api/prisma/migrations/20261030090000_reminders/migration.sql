-- AlterTable
ALTER TABLE "attendance_record" ADD COLUMN     "reminded_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "time_entry" ADD COLUMN     "reminded_at" TIMESTAMPTZ(6);


-- The hourly reminder sweep looks only at what is still open and not yet reminded.
CREATE INDEX "attendance_record_open_reminder_idx" ON "attendance_record"("check_in_at")
  WHERE "check_out_at" IS NULL AND "reminded_at" IS NULL;
CREATE INDEX "time_entry_running_reminder_idx" ON "time_entry"("started_at")
  WHERE "source" = 'timer' AND "ended_at" IS NULL AND "reminded_at" IS NULL;
