-- Compensation records (docs/adr/0030-compensation.md). Additive: the previous release ignores the table.
CREATE TABLE "compensation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "employee_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "basis" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compensation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compensation_basis_check" CHECK ("basis" IN ('monthly', 'yearly', 'hourly')),
    CONSTRAINT "compensation_currency_check" CHECK ("currency" IN ('EUR', 'BGN', 'USD', 'GBP', 'CHF')),
    CONSTRAINT "compensation_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 100000000000)
);

CREATE UNIQUE INDEX "compensation_tenant_id_id_key" ON "compensation"("tenant_id", "id");
CREATE UNIQUE INDEX "compensation_tenant_id_employee_id_valid_from_key" ON "compensation"("tenant_id", "employee_id", "valid_from");

ALTER TABLE "compensation" ADD CONSTRAINT "compensation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compensation" ADD CONSTRAINT "compensation_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

SELECT public.enable_tenant_rls('public.compensation');
