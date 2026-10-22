import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN_LENGTH, tokenSchema } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { isApiError } from '@/shared/api/api-error';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { acceptInvitation, authKeys, inspectInvitation } from './api';
import { InvalidLinkCard } from './InvalidLinkCard';
import { useMessages } from './messages';
import { PasswordForm } from './PasswordForm';
import { startSession } from './session';

export function AcceptInvitationPage() {
  const { t } = useTranslation(['auth', 'common']);
  const messages = useMessages();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const tokenLooksValid = tokenSchema.safeParse(token).success;

  const invitation = useQuery({
    queryKey: authKeys.invitation(token),
    queryFn: () => inspectInvitation(token),
    enabled: tokenLooksValid,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  const accept = useMutation({
    mutationFn: acceptInvitation,
    onSuccess: (user) => {
      startSession(client, user);
      void navigate('/', { replace: true });
    },
  });

  const linkRejected =
    !tokenLooksValid ||
    isApiError(invitation.error, 'TOKEN_INVALID') ||
    isApiError(invitation.error, 'VALIDATION_FAILED');

  if (linkRejected) {
    return (
      <InvalidLinkCard title={t('accept.invalidTitle')}>
        <p className="text-sm text-muted-foreground">{t('accept.invalidHelp')}</p>
        <Button asChild>
          <Link to="/login">{t('accept.backToLogin')}</Link>
        </Button>
      </InvalidLinkCard>
    );
  }

  if (invitation.isError) {
    return (
      <Card className="space-y-3 text-center">
        <Alert tone="danger">{messages.apiError(invitation.error)}</Alert>
        <Button onClick={() => void invitation.refetch()}>{t('common:retry')}</Button>
      </Card>
    );
  }

  if (invitation.isPending) {
    return (
      <Card>
        <p role="status" className="text-center text-sm text-muted-foreground">
          {t('accept.checking')}
        </p>
      </Card>
    );
  }

  const { email, workspace } = invitation.data;
  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <CardTitle className="text-xl">
          {t('accept.title', { workspace: workspace.name })}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('accept.subtitle')}</p>
      </div>

      {accept.isError && <Alert tone="danger">{messages.apiError(accept.error)}</Alert>}

      <Field label={t('accept.email')}>
        {(field) => (
          <Input {...field} type="email" value={email} readOnly autoComplete="username" />
        )}
      </Field>
      <PasswordForm
        email={email}
        pending={accept.isPending}
        labels={{
          password: t('accept.password'),
          confirm: t('accept.confirm'),
          hint: t('accept.hint', { min: PASSWORD_MIN_LENGTH }),
          submit: t('accept.submit'),
          submitting: t('accept.submitting'),
        }}
        onSubmit={(password) => accept.mutate({ token, password })}
      />
    </Card>
  );
}
