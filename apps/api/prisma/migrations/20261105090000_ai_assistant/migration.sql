-- CreateTable
CREATE TABLE "ai_workspace_setting" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "retention_days" INTEGER NOT NULL DEFAULT 90,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_workspace_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credential" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "scope" TEXT NOT NULL,
    "user_id" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "last4" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_user_setting" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "user_id" UUID NOT NULL,
    "consent_at" TIMESTAMPTZ(6),
    "consent_version" INTEGER,
    "share_people_data" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_user_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_message" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT app_current_tenant(),
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tools_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_workspace_setting_tenant_id_key" ON "ai_workspace_setting"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_workspace_setting_tenant_id_id_key" ON "ai_workspace_setting"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credential_tenant_id_id_key" ON "ai_credential"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credential_tenant_id_user_id_key" ON "ai_credential"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_user_setting_tenant_id_id_key" ON "ai_user_setting"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_user_setting_tenant_id_user_id_key" ON "ai_user_setting"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "ai_conversation_tenant_id_user_id_updated_at_idx" ON "ai_conversation"("tenant_id", "user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversation_tenant_id_id_key" ON "ai_conversation"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "ai_message_tenant_id_conversation_id_created_at_idx" ON "ai_message"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_message_tenant_id_user_id_role_created_at_idx" ON "ai_message"("tenant_id", "user_id", "role", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_message_tenant_id_id_key" ON "ai_message"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "ai_workspace_setting" ADD CONSTRAINT "ai_workspace_setting_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "app_user"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_user_setting" ADD CONSTRAINT "ai_user_setting_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_user_setting" ADD CONSTRAINT "ai_user_setting_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "app_user"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "app_user"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "app_user"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "ai_conversation"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Value rules (the API validates too; the database is the last line of defence).
ALTER TABLE "ai_workspace_setting" ADD CONSTRAINT "ai_workspace_setting_retention_check"
  CHECK ("retention_days" BETWEEN 1 AND 365);
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_scope_check"
  CHECK (("scope" = 'user' AND "user_id" IS NOT NULL) OR ("scope" = 'workspace' AND "user_id" IS NULL));
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_provider_check"
  CHECK ("provider" IN ('groq', 'openrouter', 'mistral', 'gemini'));
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_role_check" CHECK ("role" IN ('user', 'assistant'));
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_content_check" CHECK (length("content") <= 20000);

-- One workspace key per workspace (NULL user ids never clash in the unique index above).
CREATE UNIQUE INDEX "ai_credential_one_workspace_key" ON "ai_credential"("tenant_id") WHERE "scope" = 'workspace';

-- Tenant isolation (docs/adr/0001-multi-tenancy-rls.md).
SELECT public.enable_tenant_rls('public.ai_workspace_setting');
SELECT public.enable_tenant_rls('public.ai_credential');
SELECT public.enable_tenant_rls('public.ai_user_setting');
SELECT public.enable_tenant_rls('public.ai_conversation');
SELECT public.enable_tenant_rls('public.ai_message');
