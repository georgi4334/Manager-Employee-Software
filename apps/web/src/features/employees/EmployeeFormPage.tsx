import { zodResolver } from '@hookform/resolvers/zod';
import { EMPLOYMENT_TYPES, SENIORITIES, type Employee } from '@intime/contracts';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useMessages } from '@/features/auth/messages';
import { isApiError } from '@/shared/api/api-error';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import {
  EMPTY_EMPLOYEE_FORM,
  employeeFormSchema,
  formValuesOf,
  toCreateRequest,
  toUpdateRequest,
  type EmployeeFormValues,
} from './forms';
import { useCreateEmployee, useEmployee, useUpdateEmployee } from './hooks';
import { useEmployeeErrors } from './use-employee-messages';

/** Create (/employees/new) and edit (/employees/:id/edit) share one form. */
export function EmployeeFormPage() {
  const { id } = useParams();
  const { t } = useTranslation(['employees', 'common']);
  const errors = useEmployeeErrors();
  const query = useEmployee(id ?? '');

  if (!id) return <EmployeeForm />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common:loading')}
        </p>
      )}
      {query.isError &&
        (isApiError(query.error, 'NOT_FOUND') ? (
          <Card className="text-center">
            <CardTitle>{t('notFoundTitle')}</CardTitle>
          </Card>
        ) : (
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
        ))}
      {query.data &&
        (query.data.profile ? (
          <EmployeeForm employee={query.data} />
        ) : (
          <Alert tone="info">{t('form.limited')}</Alert>
        ))}
    </div>
  );
}

function EmployeeForm({ employee }: { employee?: Employee }) {
  const { t } = useTranslation('employees');
  const messages = useMessages();
  const errors = useEmployeeErrors();
  const navigate = useNavigate();
  const create = useCreateEmployee();
  const update = useUpdateEmployee(employee?.id ?? '');
  const mutation = employee ? update : create;
  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: employee ? formValuesOf(employee) : EMPTY_EMPLOYEE_FORM,
  });
  const fieldErrors = form.formState.errors;
  const name = employee ? `${employee.firstName} ${employee.lastName}` : '';

  const submit = (values: EmployeeFormValues) => {
    const done = (saved: Employee) => void navigate(`/employees/${saved.id}`);
    if (employee) update.mutate(toUpdateRequest(values), { onSuccess: done });
    else create.mutate(toCreateRequest(values), { onSuccess: done });
  };

  const text = (
    key: keyof EmployeeFormValues,
    label: string,
    extra: { hint?: string; type?: string; maxLength?: number; autoComplete?: string } = {},
  ) => (
    <Field label={label} hint={extra.hint} error={messages.validation(fieldErrors[key])}>
      {(field) => (
        <Input
          {...field}
          type={extra.type ?? 'text'}
          maxLength={extra.maxLength}
          autoComplete={extra.autoComplete ?? 'off'}
          {...form.register(key)}
        />
      )}
    </Field>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        to={employee ? `/employees/${employee.id}` : '/employees'}
        className="inline-flex min-h-11 items-center text-sm text-primary underline"
      >
        {t('form.cancel')}
      </Link>
      <h1 className="text-2xl font-semibold">
        {employee ? t('form.editTitle', { name }) : t('form.createTitle')}
      </h1>

      <form noValidate className="space-y-4" onSubmit={form.handleSubmit(submit)}>
        <Card className="grid gap-4 sm:grid-cols-2">
          {text('firstName', t('fields.firstName'))}
          {text('lastName', t('fields.lastName'))}
          {!employee && (
            <div className="sm:col-span-2">
              {text('email', t('fields.email'), { hint: t('form.emailHint'), type: 'email' })}
            </div>
          )}
          {text('jobTitle', t('fields.jobTitle'))}
          {text('location', t('fields.location'))}
        </Card>

        <Card className="grid gap-4 sm:grid-cols-2">
          {text('employeeNo', t('fields.employeeNo'))}
          <Field
            label={t('fields.employmentType')}
            error={messages.validation(fieldErrors.employmentType)}
          >
            {(field) => (
              <Select {...field} {...form.register('employmentType')}>
                {EMPLOYMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`employmentType.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('fields.seniority')} error={messages.validation(fieldErrors.seniority)}>
            {(field) => (
              <Select {...field} {...form.register('seniority')}>
                <option value="">{t('form.notSpecified')}</option>
                {SENIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`seniority.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {text('hireDate', t('fields.hireDate'), { type: 'date' })}
        </Card>

        <Card className="grid gap-4 sm:grid-cols-2">
          {text('birthDate', t('fields.birthDate'), { type: 'date' })}
          {text('phone', t('fields.phone'), { type: 'tel', autoComplete: 'tel' })}
          {text('country', t('fields.country'), { hint: t('form.countryHint'), maxLength: 2 })}
        </Card>

        {mutation.isError && <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>}
        <Button type="submit" className="w-full sm:w-auto" disabled={mutation.isPending}>
          {employee
            ? mutation.isPending
              ? t('form.saving')
              : t('form.save')
            : mutation.isPending
              ? t('form.creating')
              : t('form.create')}
        </Button>
      </form>
    </div>
  );
}
