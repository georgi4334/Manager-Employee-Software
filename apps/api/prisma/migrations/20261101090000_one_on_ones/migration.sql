-- CreateTable
CREATE TABLE "one_on_one" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "manager_employee_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "agenda" TEXT,
    "shared_notes" TEXT,
    "private_notes_manager" TEXT,
    "private_notes_employee" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "one_on_one_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_on_one_action_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "one_on_one_id" UUID NOT NULL,
    "owner_employee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" DATE,
    "done_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "one_on_one_action_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "one_on_one_tenant_id_manager_employee_id_scheduled_at_idx" ON "one_on_one"("tenant_id", "manager_employee_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "one_on_one_tenant_id_employee_id_scheduled_at_idx" ON "one_on_one"("tenant_id", "employee_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "one_on_one_tenant_id_id_key" ON "one_on_one"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "one_on_one_action_item_tenant_id_one_on_one_id_idx" ON "one_on_one_action_item"("tenant_id", "one_on_one_id");

-- CreateIndex
CREATE INDEX "one_on_one_action_item_tenant_id_owner_employee_id_idx" ON "one_on_one_action_item"("tenant_id", "owner_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_on_one_action_item_tenant_id_id_key" ON "one_on_one_action_item"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "one_on_one" ADD CONSTRAINT "one_on_one_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_on_one" ADD CONSTRAINT "one_on_one_tenant_id_manager_employee_id_fkey" FOREIGN KEY ("tenant_id", "manager_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_on_one" ADD CONSTRAINT "one_on_one_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_on_one_action_item" ADD CONSTRAINT "one_on_one_action_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_on_one_action_item" ADD CONSTRAINT "one_on_one_action_item_tenant_id_one_on_one_id_fkey" FOREIGN KEY ("tenant_id", "one_on_one_id") REFERENCES "one_on_one"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_on_one_action_item" ADD CONSTRAINT "one_on_one_action_item_tenant_id_owner_employee_id_fkey" FOREIGN KEY ("tenant_id", "owner_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "one_on_one" ADD CONSTRAINT "one_on_one_people_check" CHECK ("manager_employee_id" <> "employee_id");
ALTER TABLE "one_on_one" ADD CONSTRAINT "one_on_one_status_check" CHECK ("status" IN ('scheduled', 'done', 'cancelled'));
ALTER TABLE "one_on_one" ADD CONSTRAINT "one_on_one_duration_check" CHECK ("duration_minutes" BETWEEN 15 AND 240);
ALTER TABLE "one_on_one" ADD CONSTRAINT "one_on_one_text_check"
  CHECK (("agenda" IS NULL OR length("agenda") <= 1000)
    AND ("shared_notes" IS NULL OR length("shared_notes") <= 2000)
    AND ("private_notes_manager" IS NULL OR length("private_notes_manager") <= 2000)
    AND ("private_notes_employee" IS NULL OR length("private_notes_employee") <= 2000));
ALTER TABLE "one_on_one_action_item" ADD CONSTRAINT "one_on_one_action_item_title_check"
  CHECK (length("title") BETWEEN 1 AND 120);

-- An action item belongs to one of the two people of its meeting.
CREATE FUNCTION public.one_on_one_item_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.one_on_one m
    WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.one_on_one_id
      AND NEW.owner_employee_id IN (m.manager_employee_id, m.employee_id)
  ) THEN
    RAISE EXCEPTION 'one_on_one_item_owner: the owner must take part in the meeting' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "one_on_one_item_owner" BEFORE INSERT OR UPDATE OF "owner_employee_id", "one_on_one_id" ON "one_on_one_action_item"
  FOR EACH ROW EXECUTE FUNCTION public.one_on_one_item_owner();

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.one_on_one');
SELECT public.enable_tenant_rls('public.one_on_one_action_item');
