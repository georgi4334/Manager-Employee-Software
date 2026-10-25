-- CreateTable
CREATE TABLE "goal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "scope" TEXT NOT NULL,
    "owner_employee_id" UUID NOT NULL,
    "team_id" UUID,
    "parent_goal_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "due_date" DATE,
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_result" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "goal_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "unit" TEXT,
    "start_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "target_value" DECIMAL(14,2) NOT NULL,
    "current_value" DECIMAL(14,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "key_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_update" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "goal_id" UUID NOT NULL,
    "author_employee_id" UUID NOT NULL,
    "progress_pct" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_update_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_tenant_id_scope_status_idx" ON "goal"("tenant_id", "scope", "status");

-- CreateIndex
CREATE INDEX "goal_tenant_id_owner_employee_id_idx" ON "goal"("tenant_id", "owner_employee_id");

-- CreateIndex
CREATE INDEX "goal_tenant_id_team_id_idx" ON "goal"("tenant_id", "team_id");

-- CreateIndex
CREATE INDEX "goal_tenant_id_parent_goal_id_idx" ON "goal"("tenant_id", "parent_goal_id");

-- CreateIndex
CREATE UNIQUE INDEX "goal_tenant_id_id_key" ON "goal"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "key_result_tenant_id_goal_id_idx" ON "key_result"("tenant_id", "goal_id");

-- CreateIndex
CREATE UNIQUE INDEX "key_result_tenant_id_id_key" ON "key_result"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "goal_update_tenant_id_goal_id_created_at_idx" ON "goal_update"("tenant_id", "goal_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "goal_update_tenant_id_id_key" ON "goal_update"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_tenant_id_owner_employee_id_fkey" FOREIGN KEY ("tenant_id", "owner_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_tenant_id_team_id_fkey" FOREIGN KEY ("tenant_id", "team_id") REFERENCES "team"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_tenant_id_parent_goal_id_fkey" FOREIGN KEY ("tenant_id", "parent_goal_id") REFERENCES "goal"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_result" ADD CONSTRAINT "key_result_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_result" ADD CONSTRAINT "key_result_tenant_id_goal_id_fkey" FOREIGN KEY ("tenant_id", "goal_id") REFERENCES "goal"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_update" ADD CONSTRAINT "goal_update_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_update" ADD CONSTRAINT "goal_update_tenant_id_goal_id_fkey" FOREIGN KEY ("tenant_id", "goal_id") REFERENCES "goal"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_update" ADD CONSTRAINT "goal_update_tenant_id_author_employee_id_fkey" FOREIGN KEY ("tenant_id", "author_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "goal" ADD CONSTRAINT "goal_scope_check" CHECK ("scope" IN ('personal', 'team', 'company'));
ALTER TABLE "goal" ADD CONSTRAINT "goal_status_check" CHECK ("status" IN ('draft', 'active', 'done', 'cancelled'));
ALTER TABLE "goal" ADD CONSTRAINT "goal_team_check" CHECK (("scope" = 'team') = ("team_id" IS NOT NULL));
ALTER TABLE "goal" ADD CONSTRAINT "goal_progress_check" CHECK ("progress_pct" BETWEEN 0 AND 100);
ALTER TABLE "goal" ADD CONSTRAINT "goal_text_check"
  CHECK (length("title") BETWEEN 1 AND 120 AND ("description" IS NULL OR length("description") <= 1000));
ALTER TABLE "goal" ADD CONSTRAINT "goal_not_own_parent_check" CHECK ("parent_goal_id" IS NULL OR "parent_goal_id" <> "id");

ALTER TABLE "key_result" ADD CONSTRAINT "key_result_text_check"
  CHECK (length("title") BETWEEN 1 AND 120 AND ("unit" IS NULL OR length("unit") <= 20));
ALTER TABLE "key_result" ADD CONSTRAINT "key_result_target_check" CHECK ("target_value" <> "start_value");
ALTER TABLE "key_result" ADD CONSTRAINT "key_result_values_check"
  CHECK (abs("start_value") <= 1000000000 AND abs("target_value") <= 1000000000 AND abs("current_value") <= 1000000000);

ALTER TABLE "goal_update" ADD CONSTRAINT "goal_update_progress_check" CHECK ("progress_pct" BETWEEN 0 AND 100);
ALTER TABLE "goal_update" ADD CONSTRAINT "goal_update_comment_check" CHECK ("comment" IS NULL OR length("comment") <= 500);

-- Alignment goes to a strictly wider goal: personal -> team or company, team -> company. That rules out cycles.
CREATE FUNCTION public.goal_parent_wider() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_scope text;
  rank_child int;
  rank_parent int;
BEGIN
  IF NEW.parent_goal_id IS NULL THEN RETURN NEW; END IF;
  SELECT g.scope INTO parent_scope FROM public.goal g
    WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.parent_goal_id;
  rank_child := CASE NEW.scope WHEN 'personal' THEN 0 WHEN 'team' THEN 1 ELSE 2 END;
  rank_parent := CASE parent_scope WHEN 'personal' THEN 0 WHEN 'team' THEN 1 ELSE 2 END;
  IF rank_parent <= rank_child THEN
    RAISE EXCEPTION 'goal_parent_wider: a goal aligns to a wider goal only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "goal_parent_wider" BEFORE INSERT OR UPDATE OF "parent_goal_id", "scope" ON "goal"
  FOR EACH ROW EXECUTE FUNCTION public.goal_parent_wider();

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.goal');
SELECT public.enable_tenant_rls('public.key_result');
SELECT public.enable_tenant_rls('public.goal_update');
