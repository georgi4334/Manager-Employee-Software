-- Erasure marker (docs/adr/0011-gdpr-export-erasure.md). Expand-only: old code ignores the column.
ALTER TABLE "employee" ADD COLUMN "erased_at" TIMESTAMPTZ(6);
