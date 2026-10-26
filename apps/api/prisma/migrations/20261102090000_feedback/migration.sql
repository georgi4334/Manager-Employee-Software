-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "from_employee_id" UUID NOT NULL,
    "to_employee_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'recipient',
    "body" TEXT NOT NULL,
    "reported_at" TIMESTAMPTZ(6),
    "kept_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_tenant_id_to_employee_id_created_at_idx" ON "feedback"("tenant_id", "to_employee_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_tenant_id_from_employee_id_created_at_idx" ON "feedback"("tenant_id", "from_employee_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_tenant_id_reported_at_idx" ON "feedback"("tenant_id", "reported_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_tenant_id_id_key" ON "feedback"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenant_id_from_employee_id_fkey" FOREIGN KEY ("tenant_id", "from_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenant_id_to_employee_id_fkey" FOREIGN KEY ("tenant_id", "to_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_people_check" CHECK ("from_employee_id" <> "to_employee_id");
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_kind_check" CHECK ("kind" IN ('praise', 'constructive'));
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_visibility_check" CHECK ("visibility" IN ('recipient', 'recipient_and_manager'));
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_body_check" CHECK (length("body") BETWEEN 1 AND 2000);
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_report_check" CHECK (NOT ("reported_at" IS NOT NULL AND "kept_at" IS NOT NULL));

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.feedback');
