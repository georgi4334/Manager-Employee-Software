import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { forgotPassword } from './api';
import { forgotFormSchema, type ForgotFormValues } from './forms';
import { useMessages } from './messages';

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const messages = useMessages();
  const form = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotFormSchema),
    defaultValues: { email: '' },
  });
  const request = useMutation({ mutationFn: forgotPassword });

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <CardTitle className="text-xl">{t('forgot.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('forgot.subtitle')}</p>
      </div>

      {request.isError && <Alert tone="danger">{messages.apiError(request.error)}</Alert>}

      {request.isSuccess ? (
        // Same message whether or not the account exists, so this page cannot be used to probe for emails.
        <Alert tone="success">{t('forgot.sent')}</Alert>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((values) =>
            request.mutate({ email: forgotFormSchema.parse(values).email }),
          )}
        >
          <Field label={t('forgot.email')} error={messages.validation(form.formState.errors.email)}>
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
          <Button type="submit" className="w-full" disabled={request.isPending}>
            {request.isPending ? t('forgot.submitting') : t('forgot.submit')}
          </Button>
        </form>
      )}

      <p className="text-center text-sm">
        <Link to="/login" className="font-medium text-primary hover:underline">
          {t('forgot.backToLogin')}
        </Link>
      </p>
    </Card>
  );
}
