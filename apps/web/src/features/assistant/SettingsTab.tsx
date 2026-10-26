import { zodResolver } from '@hookform/resolvers/zod';
import { AI_LIMITS, type AiStatus } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { retentionFormSchema, type RetentionFormValues } from './forms';
import { useConsent, useSaveWorkspace } from './hooks';
import { KeyForm } from './KeyForm';

export function SettingsTab({ status }: { status: AiStatus }) {
  const { t } = useTranslation('assistant');
  const canToggle = usePermission('ai.toggle_tenant');
  const canWorkspaceKey = usePermission('ai.manage_tenant_key');
  const canOwnKey = usePermission('ai.manage_own_key');

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">{t('consent.title')}</h2>
        <ConsentSection status={status} />
      </Card>
      {canOwnKey && (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">{t('key.ownTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('key.ownIntro')}</p>
          <KeyForm scope="me" current={status.ownKey} canStore={status.canStoreKeys} />
        </Card>
      )}
      {(canToggle || canWorkspaceKey) && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">{t('workspace.title')}</h2>
          {canToggle && <WorkspaceSection status={status} />}
          {canWorkspaceKey && (
            <section aria-labelledby="ai-workspace-key" className="space-y-3">
              <h3 id="ai-workspace-key" className="text-base font-semibold">
                {t('key.workspaceTitle')}
              </h3>
              <p className="text-sm text-muted-foreground">{t('key.workspaceIntro')}</p>
              <KeyForm
                scope="workspace"
                current={status.workspaceKey}
                canStore={status.canStoreKeys}
              />
            </section>
          )}
        </Card>
      )}
    </div>
  );
}

function ConsentSection({ status }: { status: AiStatus }) {
  const { t } = useTranslation('assistant');
  const messages = useMessages();
  const consent = useConsent();
  const [share, setShare] = useState(status.consent.sharePeopleData);
  return (
    <div className="space-y-3">
      <p className="text-sm">{t('consent.notice')}</p>
      <p className="text-sm text-muted-foreground">{t('consent.dataSent')}</p>
      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-5"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
        />
        <span>
          {t('consent.sharePeople')}
          <span className="block text-xs text-muted-foreground">
            {t('consent.sharePeopleHint')}
          </span>
        </span>
      </label>
      {status.consent.accepted && <Alert tone="success">{t('consent.accepted')}</Alert>}
      <Button disabled={consent.isPending} onClick={() => consent.mutate(share)}>
        {status.consent.accepted ? t('consent.update') : t('consent.accept')}
      </Button>
      {consent.isError && <Alert tone="danger">{messages.apiError(consent.error)}</Alert>}
    </div>
  );
}

function WorkspaceSection({ status }: { status: AiStatus }) {
  const { t } = useTranslation('assistant');
  const messages = useMessages();
  const save = useSaveWorkspace();
  const form = useForm<RetentionFormValues>({
    resolver: zodResolver(retentionFormSchema),
    defaultValues: { retentionDays: String(status.retentionDays) },
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('workspace.intro')}</p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={status.enabled}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ enabled: e.target.checked })}
        />
        {t('workspace.enabled')}
      </label>
      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        aria-label={t('workspace.retentionForm')}
        onSubmit={form.handleSubmit((v) => save.mutate({ retentionDays: Number(v.retentionDays) }))}
      >
        <Field
          label={t('workspace.retention')}
          hint={t('workspace.retentionHint', { max: AI_LIMITS.maxRetentionDays })}
          error={messages.validation(form.formState.errors.retentionDays)}
        >
          {(field) => (
            <Input
              {...field}
              inputMode="numeric"
              className="w-32"
              {...form.register('retentionDays')}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary" disabled={save.isPending}>
          {t('workspace.saveRetention')}
        </Button>
      </form>
      {save.isError && <Alert tone="danger">{messages.apiError(save.error)}</Alert>}
    </div>
  );
}
