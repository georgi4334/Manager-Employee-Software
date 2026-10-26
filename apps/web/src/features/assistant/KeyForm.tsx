import { zodResolver } from '@hookform/resolvers/zod';
import { AI_PROVIDERS, type AiCredentialSummary } from '@intime/contracts';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import type { KeyScope } from './api';
import { emptyKey, keyFormSchema, toKeyRequest, type KeyFormValues } from './forms';
import { useRemoveKey, useSaveKey, useTestKey } from './hooks';

/** Store, test and remove one provider key. The key is never shown again, only its last characters. */
export function KeyForm({
  scope,
  current,
  canStore,
}: {
  scope: KeyScope;
  current: AiCredentialSummary | null;
  canStore: boolean;
}) {
  const { t } = useTranslation('assistant');
  const messages = useMessages();
  const save = useSaveKey(scope);
  const remove = useRemoveKey(scope);
  const test = useTestKey(scope);
  const form = useForm<KeyFormValues>({
    resolver: zodResolver(keyFormSchema),
    defaultValues: current
      ? { ...emptyKey(), provider: current.provider, model: current.model }
      : emptyKey(),
  });
  const e = form.formState.errors;

  return (
    <div className="space-y-3">
      {current ? (
        <p className="text-sm">
          {t('key.stored', {
            provider: t(`providers.${current.provider}`),
            model: current.model,
            last4: current.last4,
          })}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('key.none')}</p>
      )}
      {!canStore && <Alert tone="info">{t('key.cannotStore')}</Alert>}
      <form
        noValidate
        className="space-y-3"
        aria-label={t(`key.form.${scope}`)}
        onSubmit={form.handleSubmit((v) =>
          save.mutate(toKeyRequest(v), { onSuccess: () => form.resetField('apiKey') }),
        )}
      >
        <Field label={t('key.provider')} error={messages.validation(e.provider)}>
          {(field) => (
            <Select {...field} {...form.register('provider')}>
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`providers.${p}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('key.model')}
          error={messages.validation(e.model)}
          hint={t('key.modelHint')}
        >
          {(field) => (
            <Input {...field} autoComplete="off" spellCheck={false} {...form.register('model')} />
          )}
        </Field>
        <Field
          label={t('key.apiKey')}
          error={messages.validation(e.apiKey)}
          hint={t('key.apiKeyHint')}
        >
          {(field) => (
            <Input
              {...field}
              type="password"
              autoComplete="off"
              spellCheck={false}
              {...form.register('apiKey')}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!canStore || save.isPending}>
            {current ? t('key.replace') : t('key.save')}
          </Button>
          {current && (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                {t('key.test')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => remove.mutate(undefined)}
              >
                {t('key.remove')}
              </Button>
            </>
          )}
        </div>
      </form>
      {save.isError && <Alert tone="danger">{messages.apiError(save.error)}</Alert>}
      {remove.isError && <Alert tone="danger">{messages.apiError(remove.error)}</Alert>}
      {test.isError && <Alert tone="danger">{messages.apiError(test.error)}</Alert>}
      {test.isSuccess && <Alert tone="success">{t('key.testOk')}</Alert>}
    </div>
  );
}
