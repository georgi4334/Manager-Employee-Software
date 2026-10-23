import { zodResolver } from '@hookform/resolvers/zod';
import type { Employee } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { isApiError } from '@/shared/api/api-error';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { AssignmentPanel } from '@/features/organization/AssignmentPanel';
import { EmployeeSummary } from './EmployeeSummary';
import {
  deactivateFormSchema,
  inviteFormSchema,
  type DeactivateFormValues,
  type InviteFormValues,
} from './forms';
import {
  useDeactivateEmployee,
  useEmployee,
  useInviteEmployee,
  useReactivateEmployee,
} from './hooks';
import { useEmployeeErrors } from './use-employee-messages';

export function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation(['employees', 'common']);
  const errors = useEmployeeErrors();
  const query = useEmployee(id);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        to="/employees"
        className="inline-flex min-h-11 items-center text-sm text-primary underline"
      >
        {t('back')}
      </Link>

      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common:loading')}
        </p>
      )}
      {query.isError &&
        (isApiError(query.error, 'NOT_FOUND') ? (
          <Card className="space-y-1 text-center">
            <CardTitle>{t('notFoundTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('notFoundText')}</p>
          </Card>
        ) : (
          <Card className="space-y-3 text-center">
            <Alert tone="danger">{errors.apiError(query.error)}</Alert>
            <Button onClick={() => void query.refetch()}>{t('common:retry')}</Button>
          </Card>
        ))}
      {query.data && (
        <>
          <EmployeeActions employee={query.data} />
          <EmployeeSummary employee={query.data} />
        </>
      )}
    </div>
  );
}

type Panel = 'invite' | 'deactivate' | 'assign' | null;

/** Buttons for people who may manage employees. Hidden for everyone else (the API refuses them anyway). */
function EmployeeActions({ employee }: { employee: Employee }) {
  const { t } = useTranslation('employees');
  const errors = useEmployeeErrors();
  const canEdit = usePermission('employee.update');
  const canInvite = usePermission('admin.user.invite');
  const canDeactivate = usePermission('employee.deactivate');
  const canOrganize = usePermission('org.manage');
  const { t: tOrg } = useTranslation('organization');
  const [panel, setPanel] = useState<Panel>(null);
  const reactivate = useReactivateEmployee(employee.id);
  const [notice, setNotice] = useState<string | null>(null);

  const accountStatus = employee.profile?.accountStatus ?? null;
  const showInvite =
    canInvite &&
    employee.status === 'active' &&
    (accountStatus === null || accountStatus === 'invited');
  const showEdit = canEdit && employee.profile !== null;
  const showAssign = canOrganize && employee.status === 'active';
  if (!showEdit && !showInvite && !canDeactivate && !showAssign) return null;

  const name = `${employee.firstName} ${employee.lastName}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {showEdit && (
          <Button asChild variant="secondary">
            <Link to={`/employees/${employee.id}/edit`}>{t('actions.edit')}</Link>
          </Button>
        )}
        {showAssign && (
          <Button
            variant="secondary"
            onClick={() => setPanel(panel === 'assign' ? null : 'assign')}
          >
            {tOrg('actions.change')}
          </Button>
        )}
        {showInvite && (
          <Button
            variant="secondary"
            onClick={() => setPanel(panel === 'invite' ? null : 'invite')}
          >
            {accountStatus === 'invited' ? t('actions.resendInvite') : t('actions.invite')}
          </Button>
        )}
        {canDeactivate &&
          !employee.isSelf &&
          (employee.status === 'active' ? (
            <Button
              variant="secondary"
              onClick={() => setPanel(panel === 'deactivate' ? null : 'deactivate')}
            >
              {t('actions.deactivate')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={reactivate.isPending}
              onClick={() =>
                reactivate.mutate(undefined, { onSuccess: () => setNotice(t('reactivated')) })
              }
            >
              {t('actions.reactivate')}
            </Button>
          ))}
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {reactivate.isError && <Alert tone="danger">{errors.apiError(reactivate.error)}</Alert>}

      {panel === 'invite' && (
        <InvitePanel
          employee={employee}
          name={name}
          onDone={(message) => {
            setPanel(null);
            setNotice(message);
          }}
        />
      )}
      {panel === 'assign' && <AssignmentPanel employee={employee} onDone={() => setPanel(null)} />}
      {panel === 'deactivate' && (
        <DeactivatePanel employee={employee} name={name} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

function InvitePanel({
  employee,
  name,
  onDone,
}: {
  employee: Employee;
  name: string;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation('employees');
  const messages = useMessages();
  const errors = useEmployeeErrors();
  const invite = useInviteEmployee(employee.id);
  const resend = employee.profile?.accountStatus === 'invited';
  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: employee.email ?? '' },
  });

  const send = (values: InviteFormValues) =>
    invite.mutate(resend ? {} : { email: values.email }, {
      onSuccess: () => onDone(t('invite.sent')),
    });

  return (
    <Card className="space-y-3">
      <CardTitle>{t('invite.title', { name })}</CardTitle>
      <form noValidate className="space-y-3" onSubmit={form.handleSubmit(send)}>
        <Field
          label={t('invite.email')}
          hint={t('invite.hint')}
          error={messages.validation(form.formState.errors.email)}
        >
          {(field) => (
            <Input
              {...field}
              type="email"
              autoComplete="off"
              readOnly={resend}
              {...form.register('email')}
            />
          )}
        </Field>
        {invite.isError && <Alert tone="danger">{errors.apiError(invite.error)}</Alert>}
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? t('invite.sending') : t('invite.send')}
        </Button>
      </form>
    </Card>
  );
}

function DeactivatePanel({
  employee,
  name,
  onClose,
}: {
  employee: Employee;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('employees');
  const messages = useMessages();
  const errors = useEmployeeErrors();
  const deactivate = useDeactivateEmployee(employee.id);
  const form = useForm<DeactivateFormValues>({
    resolver: zodResolver(deactivateFormSchema),
    defaultValues: { terminationDate: '' },
  });

  return (
    <Card className="space-y-3" role="group" aria-label={t('deactivate.title', { name })}>
      <CardTitle>{t('deactivate.title', { name })}</CardTitle>
      <p className="text-sm text-muted-foreground">{t('deactivate.text')}</p>
      <form
        noValidate
        className="space-y-3"
        onSubmit={form.handleSubmit((values) =>
          deactivate.mutate(
            values.terminationDate ? { terminationDate: values.terminationDate } : {},
            { onSuccess: onClose },
          ),
        )}
      >
        <Field
          label={t('deactivate.date')}
          hint={t('deactivate.dateHint')}
          error={messages.validation(form.formState.errors.terminationDate)}
        >
          {(field) => <Input {...field} type="date" {...form.register('terminationDate')} />}
        </Field>
        {deactivate.isError && <Alert tone="danger">{errors.apiError(deactivate.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" disabled={deactivate.isPending}>
            {deactivate.isPending ? t('deactivate.working') : t('deactivate.confirm')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
