import { useMutation } from '@tanstack/react-query';
import { PASSWORD_MIN_LENGTH, tokenSchema } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { isApiError } from '@/shared/api/api-error';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { resetPassword } from './api';
import { InvalidLinkCard } from './InvalidLinkCard';
import { useMessages } from './messages';
import { PasswordForm } from './PasswordForm';

export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const messages = useMessages();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const reset = useMutation({ mutationFn: resetPassword });

  const linkRejected =
    !tokenSchema.safeParse(token).success || isApiError(reset.error, 'TOKEN_INVALID');
  if (linkRejected) {
    return (
      <InvalidLinkCard title={t('reset.invalidTitle')}>
        <p className="text-sm text-muted-foreground">{messages.apiCode('TOKEN_INVALID')}</p>
        <Button asChild>
          <Link to="/forgot-password">{t('reset.requestNew')}</Link>
        </Button>
      </InvalidLinkCard>
    );
  }

  if (reset.isSuccess) {
    return (
      <Card className="space-y-4">
        <CardTitle className="text-xl">{t('reset.title')}</CardTitle>
        <Alert tone="success">{t('reset.done')}</Alert>
        <Button asChild className="w-full">
          <Link to="/login">{t('reset.signIn')}</Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card className="space-y-5">
      <CardTitle className="text-xl">{t('reset.title')}</CardTitle>
      {reset.isError && <Alert tone="danger">{messages.apiError(reset.error)}</Alert>}
      <PasswordForm
        email=""
        pending={reset.isPending}
        labels={{
          password: t('reset.password'),
          confirm: t('reset.confirm'),
          hint: t('reset.hint', { min: PASSWORD_MIN_LENGTH }),
          submit: t('reset.submit'),
          submitting: t('reset.submitting'),
        }}
        onSubmit={(password) => reset.mutate({ token, password })}
      />
    </Card>
  );
}
