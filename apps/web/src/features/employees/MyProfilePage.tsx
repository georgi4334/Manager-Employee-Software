import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { isApiError } from '@/shared/api/api-error';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { EmployeeSummary } from './EmployeeSummary';
import { phoneFormSchema, type PhoneFormValues } from './forms';
import { useOwnEmployee, useUpdateOwnEmployee } from './hooks';
import { useEmployeeErrors } from './use-employee-messages';

export function MyProfilePage() {
  const { t } = useTranslation(['employees', 'common']);
  const errors = useEmployeeErrors();
  const query = useOwnEmployee();
  const canEditPhone = usePermission('employee.update_self_basic');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common:loading')}
        </p>
      )}
      {query.isError &&
        (isApiError(query.error, 'NOT_FOUND') ? (
          <Card className="space-y-1">
            <CardTitle>{t('profile.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('profile.noRecord')}</p>
          </Card>
        ) : (
          <Card className="space-y-3 text-center">
            <Alert tone="danger">{errors.apiError(query.error)}</Alert>
            <Button onClick={() => void query.refetch()}>{t('common:retry')}</Button>
          </Card>
        ))}
      {query.data && (
        <>
          <EmployeeSummary employee={query.data} />
          {canEditPhone && <PhoneForm initial={query.data.profile?.phone ?? ''} />}
        </>
      )}
    </div>
  );
}

function PhoneForm({ initial }: { initial: string }) {
  const { t } = useTranslation('employees');
  const messages = useMessages();
  const errors = useEmployeeErrors();
  const update = useUpdateOwnEmployee();
  const form = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneFormSchema),
    defaultValues: { phone: initial },
  });

  return (
    <Card className="space-y-3">
      <CardTitle>{t('profile.phoneTitle')}</CardTitle>
      <form
        noValidate
        className="space-y-3"
        onSubmit={form.handleSubmit((values) => update.mutate({ phone: values.phone }))}
      >
        <Field label={t('fields.phone')} error={messages.validation(form.formState.errors.phone)}>
          {(field) => (
            <Input {...field} type="tel" autoComplete="tel" {...form.register('phone')} />
          )}
        </Field>
        {update.isError && <Alert tone="danger">{errors.apiError(update.error)}</Alert>}
        {update.isSuccess && <Alert tone="success">{t('profile.saved')}</Alert>}
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('profile.saving') : t('profile.save')}
        </Button>
      </form>
    </Card>
  );
}
