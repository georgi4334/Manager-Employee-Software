-- CreateTable
CREATE TABLE "dashboard_layout" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "widgets" TEXT[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dashboard_layout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_layout_tenant_id_key" ON "dashboard_layout"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_layout_tenant_id_id_key" ON "dashboard_layout"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "dashboard_layout" ADD CONSTRAINT "dashboard_layout_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most 50 widgets (the API validates the ids; the database caps the size).
ALTER TABLE "dashboard_layout" ADD CONSTRAINT "dashboard_layout_size_check"
  CHECK ("widgets" IS NOT NULL AND cardinality("widgets") <= 50);

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.dashboard_layout');
