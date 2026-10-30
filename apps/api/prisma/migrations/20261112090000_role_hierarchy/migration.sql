-- Role tree (docs/adr/0036-role-hierarchy.md). Display only: authorization never reads parent_id.
ALTER TABLE "role" ADD COLUMN "parent_id" UUID;

-- CreateIndex
CREATE INDEX "role_tenant_id_parent_id_idx" ON "role"("tenant_id", "parent_id");

-- AddForeignKey (same workspace only)
ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "role"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Cycles are refused by the application under a per-workspace lock; this trigger is the last line of defence.
CREATE FUNCTION public.role_parent_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id OR EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT r.parent_id FROM role r WHERE r.id = NEW.parent_id AND r.tenant_id = NEW.tenant_id
      UNION
      SELECT r.parent_id FROM role r JOIN chain c ON r.id = c.id
       WHERE r.parent_id IS NOT NULL AND r.tenant_id = NEW.tenant_id
    )
    SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'role tree would form a cycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER role_parent_cycle_guard BEFORE INSERT OR UPDATE OF parent_id ON "role"
  FOR EACH ROW EXECUTE FUNCTION public.role_parent_cycle_guard();

-- Existing workspaces start with Admin > HR > Manager > Employee (the table forces RLS, so lift it for this update only).
ALTER TABLE "role" NO FORCE ROW LEVEL SECURITY;
UPDATE "role" child
   SET "parent_id" = parent."id"
  FROM "role" parent
 WHERE parent."tenant_id" = child."tenant_id"
   AND child."parent_id" IS NULL
   AND (child."key", parent."key") IN (('hr', 'admin'), ('manager', 'hr'), ('employee', 'manager'));
ALTER TABLE "role" FORCE ROW LEVEL SECURITY;
