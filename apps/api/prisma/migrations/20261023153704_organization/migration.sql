-- AlterTable
ALTER TABLE "employee" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "manager_id" UUID;

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "head_employee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "name" TEXT NOT NULL,
    "department_id" UUID NOT NULL,
    "lead_employee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_member" (
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "team_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_member_pkey" PRIMARY KEY ("team_id","employee_id")
);

-- CreateIndex
CREATE INDEX "department_tenant_id_parent_id_idx" ON "department"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_tenant_id_id_key" ON "department"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "team_tenant_id_department_id_idx" ON "team"("tenant_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_tenant_id_id_key" ON "team"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "team_member_tenant_id_employee_id_idx" ON "team_member"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_tenant_id_manager_id_idx" ON "employee"("tenant_id", "manager_id");

-- CreateIndex
CREATE INDEX "employee_tenant_id_department_id_idx" ON "employee"("tenant_id", "department_id");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_manager_id_fkey" FOREIGN KEY ("tenant_id", "manager_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "department"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_head_employee_id_fkey" FOREIGN KEY ("tenant_id", "head_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_tenant_id_lead_employee_id_fkey" FOREIGN KEY ("tenant_id", "lead_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_tenant_id_team_id_fkey" FOREIGN KEY ("tenant_id", "team_id") REFERENCES "team"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Value rules.
ALTER TABLE "employee" ADD CONSTRAINT "employee_not_own_manager_check" CHECK ("manager_id" IS NULL OR "manager_id" <> "id");
ALTER TABLE "department" ADD CONSTRAINT "department_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 100);
ALTER TABLE "department" ADD CONSTRAINT "department_not_own_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "team" ADD CONSTRAINT "team_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 100);

-- Names are unique ignoring case: per workspace for departments, per department for teams.
CREATE UNIQUE INDEX "department_name_unique_ci" ON "department" ("tenant_id", lower("name"));
CREATE UNIQUE INDEX "team_name_unique_ci" ON "team" ("tenant_id", "department_id", lower("name"));

-- Cycles are refused by the application (under a per-workspace lock); these triggers are the last line of
-- defence. They walk up from the proposed parent and fail when they meet the row being changed.
CREATE FUNCTION public.employee_manager_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT e.manager_id FROM employee e WHERE e.id = NEW.manager_id AND e.tenant_id = NEW.tenant_id
      UNION
      SELECT e.manager_id FROM employee e JOIN chain c ON e.id = c.id
       WHERE e.manager_id IS NOT NULL AND e.tenant_id = NEW.tenant_id
    )
    SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'reporting line would form a cycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_manager_cycle_guard BEFORE INSERT OR UPDATE OF manager_id ON "employee"
  FOR EACH ROW EXECUTE FUNCTION public.employee_manager_cycle_guard();

CREATE FUNCTION public.department_parent_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT d.parent_id FROM department d WHERE d.id = NEW.parent_id AND d.tenant_id = NEW.tenant_id
      UNION
      SELECT d.parent_id FROM department d JOIN chain c ON d.id = c.id
       WHERE d.parent_id IS NOT NULL AND d.tenant_id = NEW.tenant_id
    )
    SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'department tree would form a cycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER department_parent_cycle_guard BEFORE INSERT OR UPDATE OF parent_id ON "department"
  FOR EACH ROW EXECUTE FUNCTION public.department_parent_cycle_guard();

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.department');
SELECT public.enable_tenant_rls('public.team');
SELECT public.enable_tenant_rls('public.team_member');
