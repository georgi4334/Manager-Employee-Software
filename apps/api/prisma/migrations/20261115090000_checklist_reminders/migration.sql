-- Reminders before a checklist step is due (docs/adr/0040-onboarding-checklists.md, Follow-ups).
ALTER TABLE "checklist_item" ADD COLUMN "reminded_at" TIMESTAMPTZ(6);

-- The sweep looks for open, unreminded steps by due date.
CREATE INDEX "checklist_item_tenant_id_due_date_idx"
  ON "checklist_item" ("tenant_id", "due_date")
  WHERE "done_at" IS NULL AND "reminded_at" IS NULL;
