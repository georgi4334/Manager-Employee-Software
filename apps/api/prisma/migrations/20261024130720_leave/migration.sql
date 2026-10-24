CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateTable
CREATE TABLE "leave_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "key" TEXT,
    "name" TEXT,
    "tracks_balance" BOOLEAN NOT NULL DEFAULT false,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "is_sick" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT NOT NULL DEFAULT 'primary',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "leave_type_id" UUID NOT NULL,
    "annual_allowance_days" DECIMAL(5,1) NOT NULL,
    "carry_over_max_days" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balance" (
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "entitled" DECIMAL(5,1) NOT NULL,
    "carried_over" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "adjustment" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_balance_pkey" PRIMARY KEY ("employee_id","leave_type_id","year")
);

-- CreateTable
CREATE TABLE "leave_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "half_day_start" BOOLEAN NOT NULL DEFAULT false,
    "half_day_end" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(4,1) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_request_day" (
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "request_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "fraction" DECIMAL(2,1) NOT NULL,

    CONSTRAINT "leave_request_day_pkey" PRIMARY KEY ("request_id","day")
);

-- CreateTable
CREATE TABLE "leave_approval" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "request_id" UUID NOT NULL,
    "approver_employee_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "is_half_day" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_settings" (
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "hide_sick_type_from_team" BOOLEAN NOT NULL DEFAULT false,
    "default_country" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_type_tenant_id_id_key" ON "leave_type"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_type_tenant_id_key_key" ON "leave_type"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "leave_policy_tenant_id_leave_type_id_key" ON "leave_policy"("tenant_id", "leave_type_id");

-- CreateIndex
CREATE INDEX "leave_balance_tenant_id_employee_id_idx" ON "leave_balance"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "leave_request_tenant_id_employee_id_start_date_idx" ON "leave_request"("tenant_id", "employee_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_request_tenant_id_status_start_date_idx" ON "leave_request"("tenant_id", "status", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_request_tenant_id_id_key" ON "leave_request"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "leave_request_day_tenant_id_day_idx" ON "leave_request_day"("tenant_id", "day");

-- CreateIndex
CREATE INDEX "leave_approval_tenant_id_request_id_idx" ON "leave_approval"("tenant_id", "request_id");

-- CreateIndex
CREATE INDEX "holiday_tenant_id_date_idx" ON "holiday"("tenant_id", "date");

-- AddForeignKey
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_tenant_id_leave_type_id_fkey" FOREIGN KEY ("tenant_id", "leave_type_id") REFERENCES "leave_type"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balance" ADD CONSTRAINT "leave_balance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balance" ADD CONSTRAINT "leave_balance_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balance" ADD CONSTRAINT "leave_balance_tenant_id_leave_type_id_fkey" FOREIGN KEY ("tenant_id", "leave_type_id") REFERENCES "leave_type"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_leave_type_id_fkey" FOREIGN KEY ("tenant_id", "leave_type_id") REFERENCES "leave_type"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request_day" ADD CONSTRAINT "leave_request_day_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request_day" ADD CONSTRAINT "leave_request_day_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "leave_request"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_approval" ADD CONSTRAINT "leave_approval_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_approval" ADD CONSTRAINT "leave_approval_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "leave_request"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_approval" ADD CONSTRAINT "leave_approval_tenant_id_approver_employee_id_fkey" FOREIGN KEY ("tenant_id", "approver_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_settings" ADD CONSTRAINT "leave_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_key_check"
  CHECK ("key" IS NULL OR "key" IN ('annual', 'sick', 'unpaid', 'parental'));
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_key_or_name_check"
  CHECK (("key" IS NOT NULL AND "name" IS NULL)
      OR ("key" IS NULL AND "name" IS NOT NULL AND length(btrim("name")) BETWEEN 1 AND 100));
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_color_check"
  CHECK ("color" IN ('primary', 'success', 'warning', 'danger', 'info', 'accent'));
CREATE UNIQUE INDEX "leave_type_name_unique_ci" ON "leave_type" ("tenant_id", lower("name")) WHERE "name" IS NOT NULL;

ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_days_check"
  CHECK ("annual_allowance_days" BETWEEN 0 AND 365 AND "annual_allowance_days" * 2 = trunc("annual_allowance_days" * 2)
     AND "carry_over_max_days" BETWEEN 0 AND 365 AND "carry_over_max_days" * 2 = trunc("carry_over_max_days" * 2));

ALTER TABLE "leave_balance" ADD CONSTRAINT "leave_balance_values_check"
  CHECK ("year" BETWEEN 2000 AND 2100 AND "entitled" >= 0 AND "carried_over" >= 0
     AND "entitled" * 2 = trunc("entitled" * 2) AND "carried_over" * 2 = trunc("carried_over" * 2)
     AND "adjustment" * 2 = trunc("adjustment" * 2));

ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_status_check"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'));
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_dates_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_days_check"
  CHECK ("days" > 0 AND "days" * 2 = trunc("days" * 2));
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_half_day_check"
  CHECK (NOT ("start_date" = "end_date" AND "half_day_start" AND "half_day_end"));
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_reason_check"
  CHECK ("reason" IS NULL OR length("reason") <= 300);

-- An employee cannot have two pending or approved requests that share a date.
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "employee_id" WITH =,
    daterange("start_date", "end_date", '[]') WITH &&
  ) WHERE ("status" IN ('pending', 'approved'));

ALTER TABLE "leave_request_day" ADD CONSTRAINT "leave_request_day_fraction_check" CHECK ("fraction" IN (0.5, 1.0));
ALTER TABLE "leave_approval" ADD CONSTRAINT "leave_approval_decision_check"
  CHECK ("decision" IN ('approved', 'rejected', 'cancelled'));
ALTER TABLE "leave_approval" ADD CONSTRAINT "leave_approval_comment_check"
  CHECK ("comment" IS NULL OR length("comment") <= 300);
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 100);
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_country_check" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');
CREATE UNIQUE INDEX "holiday_date_country_unique" ON "holiday" ("tenant_id", "date", coalesce("country", ''));
ALTER TABLE "leave_settings" ADD CONSTRAINT "leave_settings_country_check"
  CHECK ("default_country" IS NULL OR "default_country" ~ '^[A-Z]{2}$');

-- Existing workspaces get the four system leave types, the annual allowance and the settings row.
INSERT INTO "leave_type" ("id", "tenant_id", "key", "tracks_balance", "requires_approval", "is_sick", "color", "updated_at")
SELECT gen_random_uuid(), t."id", v."key", v."tracks_balance", v."requires_approval", v."is_sick", v."color", CURRENT_TIMESTAMP
  FROM "tenant" t
 CROSS JOIN (VALUES
   ('annual',   true,  true,  false, 'success'),
   ('sick',     false, false, true,  'warning'),
   ('unpaid',   false, true,  false, 'info'),
   ('parental', false, true,  false, 'accent')
 ) AS v("key", "tracks_balance", "requires_approval", "is_sick", "color");
INSERT INTO "leave_policy" ("id", "tenant_id", "leave_type_id", "annual_allowance_days", "carry_over_max_days", "updated_at")
SELECT gen_random_uuid(), lt."tenant_id", lt."id", 20, 5, CURRENT_TIMESTAMP FROM "leave_type" lt WHERE lt."key" = 'annual';
INSERT INTO "leave_settings" ("tenant_id", "updated_at") SELECT "id", CURRENT_TIMESTAMP FROM "tenant";

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.leave_type');
SELECT public.enable_tenant_rls('public.leave_policy');
SELECT public.enable_tenant_rls('public.leave_balance');
SELECT public.enable_tenant_rls('public.leave_request');
SELECT public.enable_tenant_rls('public.leave_request_day');
SELECT public.enable_tenant_rls('public.leave_approval');
SELECT public.enable_tenant_rls('public.holiday');
SELECT public.enable_tenant_rls('public.leave_settings');

-- Least privilege: leave records are never deleted by the application (cancelled requests stay), counted days
-- and decisions cannot be rewritten.
REVOKE DELETE ON TABLE public.leave_type, public.leave_request, public.leave_balance FROM intime_app;
REVOKE UPDATE, DELETE ON TABLE public.leave_request_day, public.leave_approval FROM intime_app;
