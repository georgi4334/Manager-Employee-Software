import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isErrorCode, type Workspace } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { isApiError } from '@/shared/api/api-error';
import { apiUrl } from '@/shared/api/client';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { PasswordInput } from '@/shared/ui/password-input';
import { authKeys, fetchProviders, login } from './api';
import { loginFormSchema, workspaceFieldSchema, type LoginFormValues } from './forms';
import { useMessages } from './messages';
import { startSession } from './session';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const messages = useMessages();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [googleWorkspace, setGoogleWorkspace] = useState('');

  const providers = useQuery({
    queryKey: authKeys.providers,
    queryFn: fetchProviders,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;

  const signIn = useMutation({
    mutationFn: login,
    onMutate: () => setWorkspaces([]),
    // PublicOnly sees the user appear and moves on to the page the user came from.
    onSuccess: (user) => startSession(client, user),
    onError: (error) => {
      if (isApiError(error, 'TENANT_SELECTION_REQUIRED')) setWorkspaces(error.workspaces);
    },
  });

  const submit = (workspace?: string) =>
    form.handleSubmit((values) => {
      const parsed = loginFormSchema.parse(values);
      signIn.mutate({ ...parsed, ...(workspace ? { workspace } : {}) });
    });

  // The Google callback sends people back here with ?error=<code>.
  const urlError = params.get('error');
  const googleNeedsWorkspace = urlError === 'TENANT_SELECTION_REQUIRED';
  const shownUrlError =
    urlError && !googleNeedsWorkspace ? (isErrorCode(urlError) ? urlError : 'UNKNOWN') : null;
  const chosenGoogleWorkspace = workspaceFieldSchema.safeParse(googleWorkspace);
  const googleHref = apiUrl(
    `/auth/google/start${chosenGoogleWorkspace.success ? `?workspace=${encodeURIComponent(chosenGoogleWorkspace.data)}` : ''}`,
  );

  const chooserVisible = workspaces.length > 0;
  const submitError =
    signIn.error && !isApiError(signIn.error, 'TENANT_SELECTION_REQUIRED') ? signIn.error : null;

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <CardTitle className="text-xl">{t('login.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
      </div>

      {shownUrlError && <Alert tone="danger">{messages.apiCode(shownUrlError)}</Alert>}
      {submitError && <Alert tone="danger">{messages.apiError(submitError)}</Alert>}

      <form noValidate onSubmit={submit()} className="space-y-4">
        <Field label={t('login.email')} error={messages.validation(errors.email)}>
          {(field) => (
            <Input
              {...field}
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              {...form.register('email')}
            />
          )}
        </Field>
        <Field
          label={t('login.password')}
          error={messages.validation(errors.password)}
          action={
            <Link
              to="/forgot-password"
              className="text-sm font-medium text-primary hover:underline"
            >
              {t('login.forgot')}
            </Link>
          }
        >
          {(field) => (
            <PasswordInput
              {...field}
              autoComplete="current-password"
              {...form.register('password')}
            />
          )}
        </Field>

        {chooserVisible ? (
          <section aria-labelledby="choose-workspace" className="space-y-2">
            <h2 id="choose-workspace" className="text-sm font-semibold">
              {t('login.chooseWorkspace')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('login.chooseWorkspaceHelp')}</p>
            <ul className="space-y-2">
              {workspaces.map((workspace) => (
                <li key={workspace.slug}>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full justify-start"
                    disabled={signIn.isPending}
                    onClick={() => void submit(workspace.slug)()}
                  >
                    {workspace.name}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <Button type="submit" className="w-full" disabled={signIn.isPending}>
            {signIn.isPending ? t('login.submitting') : t('login.submit')}
          </Button>
        )}
      </form>

      {providers.data?.google && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            {t('login.or')}
            <span className="h-px flex-1 bg-border" />
          </div>
          {googleNeedsWorkspace && (
            <Field label={t('login.googleWorkspace')} hint={t('login.googleWorkspaceHint')}>
              {(field) => (
                <Input
                  {...field}
                  value={googleWorkspace}
                  onChange={(event) => setGoogleWorkspace(event.target.value)}
                  autoCapitalize="none"
                  spellCheck={false}
                />
              )}
            </Field>
          )}
          <Button asChild variant="secondary" className="w-full">
            <a href={googleHref}>{t('login.google')}</a>
          </Button>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">{t('login.inviteOnly')}</p>
    </Card>
  );
}
