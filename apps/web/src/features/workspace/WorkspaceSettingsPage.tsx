import { zodResolver } from '@hookform/resolvers/zod';
import {
  timeZoneOptions,
  WORKSPACE_COUNTRIES,
  WORKSPACE_LANGUAGES,
  type WorkspaceSettings,
} from '@intime/contracts';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { SkeletonCard, SkeletonGroup } from '@/shared/ui/skeleton';
import { useSaveWorkspaceSettings, useWorkspaceSettings } from './api';
import { changedRequest, formValues, workspaceFormSchema, type WorkspaceFormValues } from './forms';

/** Workspace settings (docs/adr/0043-workspace-settings.md): name, time zone, default language and country. */
export function WorkspaceSettingsPage() {
  const { t } = useTranslation('settings');
  const messages = useMessages();
  const query = useWorkspaceSettings();
  // Kept here: the form remounts with the saved values, the success message must survive that.
  const save = useSaveWorkspaceSettings();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      {query.isPending && (
        <SkeletonGroup label={t('loading')}>
          <SkeletonCard rows={4} />
        </SkeletonGroup>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{messages.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {query.data && (
        <SettingsForm key={JSON.stringify(query.data)} current={query.data} save={save} />
      )}
    </div>
  );
}

function SettingsForm({
  current,
  save,
}: {
  current: WorkspaceSettings;
  save: ReturnType<typeof useSaveWorkspaceSettings>;
}) {
  const { t } = useTranslation('settings');
  const messages = useMessages();
  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceFormSchema),
    defaultValues: formValues(current),
  });
  const errors = form.formState.errors;
  const zones = useMemo(() => timeZoneOptions(current.timeZone), [current.timeZone]);
  const countries = [
    ...WORKSPACE_COUNTRIES,
    ...(current.country && !(WORKSPACE_COUNTRIES as readonly string[]).includes(current.country)
      ? [current.country]
      : []),
  ];
  const disabled = !current.canEdit || save.isPending;
  // A country outside the app's list keeps its code as its name.
  const countryLabel = (code: string) =>
    (WORKSPACE_COUNTRIES as readonly string[]).includes(code)
      ? t(`countries.${code as (typeof WORKSPACE_COUNTRIES)[number]}`)
      : code;

  return (
    <Card>
      <form
        noValidate
        aria-label={t('formLabel')}
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => {
          const body = changedRequest(values, current);
          if (body) save.mutate(body);
        })}
      >
        <CardTitle>{t('general')}</CardTitle>
        <Field label={t('name')} error={messages.validation(errors.name)}>
          {(field) => (
            <Input {...field} {...form.register('name')} maxLength={100} disabled={disabled} />
          )}
        </Field>
        <Field label={t('slug')} hint={t('slugHint')}>
          {(field) => <Input {...field} value={current.slug} readOnly disabled />}
        </Field>
        <Field
          label={t('timeZone')}
          hint={t('timeZoneHint')}
          error={messages.validation(errors.timeZone)}
        >
          {(field) => (
            <Select {...field} {...form.register('timeZone')} disabled={disabled}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('language')} hint={t('languageHint')}>
            {(field) => (
              <Select {...field} {...form.register('language')} disabled={disabled}>
                {WORKSPACE_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {t(`languages.${language}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('country')}
            hint={t('countryHint')}
            error={messages.validation(errors.country)}
          >
            {(field) => (
              <Select {...field} {...form.register('country')} disabled={disabled}>
                <option value="">{t('noCountry')}</option>
                {countries.map((code) => (
                  <option key={code} value={code}>
                    {countryLabel(code)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {!current.canEdit && <Alert tone="info">{t('readOnly')}</Alert>}
        {save.isError && <Alert tone="danger">{messages.apiError(save.error)}</Alert>}
        {save.isSuccess && <Alert tone="success">{t('saved')}</Alert>}
        {current.canEdit && (
          <Button type="submit" disabled={disabled || !form.formState.isDirty}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        )}
      </form>
    </Card>
  );
}
