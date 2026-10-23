-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "recipient_user_id" UUID NOT NULL,
    "event_id" UUID,
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "link" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "read_at" TIMESTAMPTZ(6),
    "email_status" TEXT NOT NULL DEFAULT 'none',
    "email_attempts" INTEGER NOT NULL DEFAULT 0,
    "email_next_at" TIMESTAMPTZ(6),
    "email_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("user_id","type","channel")
);

-- CreateIndex
CREATE INDEX "outbox_event_status_available_at_idx" ON "outbox_event"("status", "available_at");

-- CreateIndex
CREATE INDEX "notification_recipient_user_id_id_idx" ON "notification"("recipient_user_id", "id");

-- CreateIndex
CREATE INDEX "notification_email_status_email_next_at_idx" ON "notification"("email_status", "email_next_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_id_recipient_user_id_key" ON "notification"("event_id", "recipient_user_id");

-- AddForeignKey
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_recipient_user_id_fkey" FOREIGN KEY ("tenant_id", "recipient_user_id") REFERENCES "app_user"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "app_user"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allowed values.
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_status_check"
  CHECK ("status" IN ('pending', 'processing', 'done', 'dead'));
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_type_check"
  CHECK ("type" ~ '^[a-z_]+(\.[a-z_]+)+$');
ALTER TABLE "notification" ADD CONSTRAINT "notification_email_status_check"
  CHECK ("email_status" IN ('none', 'pending', 'sending', 'sent', 'failed', 'skipped'));
ALTER TABLE "notification" ADD CONSTRAINT "notification_type_check"
  CHECK ("type" ~ '^[a-z_]+(\.[a-z_]+)+$');
ALTER TABLE "notification" ADD CONSTRAINT "notification_link_check"
  CHECK ("link" LIKE '/%' AND "link" NOT LIKE '//%');
ALTER TABLE "notification" ADD CONSTRAINT "notification_attempts_check" CHECK ("email_attempts" >= 0);
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_channel_check"
  CHECK ("channel" IN ('in_app', 'email'));
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_type_check"
  CHECK ("type" ~ '^[a-z_]+(\.[a-z_]+)+$');

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.outbox_event');
SELECT public.enable_tenant_rls('public.notification');
SELECT public.enable_tenant_rls('public.notification_preference');

-- Least privilege. Requests may only ADD events; reading, claiming and finishing them is the worker's job
-- (system role). People may read their notifications and mark them read, nothing else; cleaning up is the
-- retention job's (system role).
REVOKE SELECT, UPDATE, DELETE ON TABLE public.outbox_event FROM intime_app;
REVOKE UPDATE, DELETE ON TABLE public.notification FROM intime_app;
GRANT UPDATE (read_at) ON TABLE public.notification TO intime_app;
