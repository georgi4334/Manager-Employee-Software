-- CreateTable
CREATE TABLE "review_cycle" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "name" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "self_due" DATE NOT NULL,
    "manager_due" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "opened_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_competency" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "cycle_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "cycle_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "self_summary" TEXT,
    "self_submitted_at" TIMESTAMPTZ(6),
    "manager_summary" TEXT,
    "overall_rating" INTEGER,
    "manager_submitted_at" TIMESTAMPTZ(6),
    "manager_author_id" UUID,
    "calibrated_rating" INTEGER,
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_rating" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "review_id" UUID NOT NULL,
    "competency_id" UUID NOT NULL,
    "part" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_cycle_tenant_id_status_idx" ON "review_cycle"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_cycle_tenant_id_id_key" ON "review_cycle"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "review_competency_tenant_id_cycle_id_idx" ON "review_competency"("tenant_id", "cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_competency_tenant_id_id_key" ON "review_competency"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "review_tenant_id_employee_id_idx" ON "review"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_tenant_id_id_key" ON "review"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "review_tenant_id_cycle_id_employee_id_key" ON "review"("tenant_id", "cycle_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_rating_tenant_id_id_key" ON "review_rating"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "review_rating_tenant_id_review_id_competency_id_part_key" ON "review_rating"("tenant_id", "review_id", "competency_id", "part");

-- AddForeignKey
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_competency" ADD CONSTRAINT "review_competency_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_competency" ADD CONSTRAINT "review_competency_tenant_id_cycle_id_fkey" FOREIGN KEY ("tenant_id", "cycle_id") REFERENCES "review_cycle"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_tenant_id_cycle_id_fkey" FOREIGN KEY ("tenant_id", "cycle_id") REFERENCES "review_cycle"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_tenant_id_manager_author_id_fkey" FOREIGN KEY ("tenant_id", "manager_author_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_rating" ADD CONSTRAINT "review_rating_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_rating" ADD CONSTRAINT "review_rating_tenant_id_review_id_fkey" FOREIGN KEY ("tenant_id", "review_id") REFERENCES "review"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_rating" ADD CONSTRAINT "review_rating_tenant_id_competency_id_fkey" FOREIGN KEY ("tenant_id", "competency_id") REFERENCES "review_competency"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_status_check" CHECK ("status" IN ('draft', 'open', 'calibration', 'closed'));
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_name_check" CHECK (length("name") BETWEEN 1 AND 80);
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_dates_check" CHECK ("period_end" >= "period_start" AND "manager_due" >= "self_due");
ALTER TABLE "review_competency" ADD CONSTRAINT "review_competency_text_check"
  CHECK (length("name") BETWEEN 1 AND 60 AND ("description" IS NULL OR length("description") <= 300));
ALTER TABLE "review" ADD CONSTRAINT "review_ratings_check"
  CHECK (("overall_rating" IS NULL OR "overall_rating" BETWEEN 1 AND 5) AND ("calibrated_rating" IS NULL OR "calibrated_rating" BETWEEN 1 AND 5));
ALTER TABLE "review" ADD CONSTRAINT "review_text_check"
  CHECK (("self_summary" IS NULL OR length("self_summary") <= 2000) AND ("manager_summary" IS NULL OR length("manager_summary") <= 2000));
-- A review cannot be released before its manager part is submitted.
ALTER TABLE "review" ADD CONSTRAINT "review_release_check" CHECK ("released_at" IS NULL OR "manager_submitted_at" IS NOT NULL);
ALTER TABLE "review_rating" ADD CONSTRAINT "review_rating_part_check" CHECK ("part" IN ('self', 'manager'));
ALTER TABLE "review_rating" ADD CONSTRAINT "review_rating_score_check" CHECK ("score" BETWEEN 1 AND 5);
ALTER TABLE "review_rating" ADD CONSTRAINT "review_rating_comment_check" CHECK ("comment" IS NULL OR length("comment") <= 500);

-- A rating belongs to a competency of the review's own cycle.
CREATE FUNCTION public.review_rating_same_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.review r
    JOIN public.review_competency c ON c.tenant_id = r.tenant_id AND c.cycle_id = r.cycle_id
    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.review_id AND c.id = NEW.competency_id
  ) THEN
    RAISE EXCEPTION 'review_rating_same_cycle: the competency belongs to another cycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "review_rating_same_cycle" BEFORE INSERT OR UPDATE OF "review_id", "competency_id" ON "review_rating"
  FOR EACH ROW EXECUTE FUNCTION public.review_rating_same_cycle();

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.review_cycle');
SELECT public.enable_tenant_rls('public.review_competency');
SELECT public.enable_tenant_rls('public.review');
SELECT public.enable_tenant_rls('public.review_rating');
