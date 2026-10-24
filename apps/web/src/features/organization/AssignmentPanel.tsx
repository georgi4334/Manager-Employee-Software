import { zodResolver } from '@hookform/resolvers/zod';
import type { ChartNode, Department, Employee } from '@intime/contracts';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Select } from '@/shared/ui/select';
import { assignmentFormSchema, toAssignmentRequest, type AssignmentFormValues } from './forms';
import { useAssignEmployee, useChart, useDepartments } from './hooks';
import { PersonSelect } from './PersonSelect';
import { useOrgErrors } from './use-org-errors';

/** HR/Admin: change an employee's manager and department. The API refuses reporting loops. */
export function AssignmentPanel({ employee, onDone }: { employee: Employee; onDone: () => void }) {
  const { t } = useTranslation('organization');
  const errors = useOrgErrors();
  const chart = useChart();
  const departments = useDepartments();
  // The selects need their options before they can show the current values.
  if (chart.isPending || departments.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (chart.isError || departments.isError) {
    return <Alert tone="danger">{errors.apiError(chart.error ?? departments.error)}</Alert>;
  }
  return (
    <AssignmentForm
      employee={employee}
      people={chart.data.nodes}
      departments={departments.data}
      onDone={onDone}
    />
  );
}

function AssignmentForm({
  employee,
  people,
  departments,
  onDone,
}: {
  employee: Employee;
  people: ChartNode[];
  departments: Department[];
  onDone: () => void;
}) {
  const { t } = useTranslation('organization');
  const errors = useOrgErrors();
  const assign = useAssignEmployee(employee.id);
  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentFormSchema),
    defaultValues: {
      managerId: employee.manager?.id ?? '',
      departmentId: employee.department?.id ?? '',
    },
  });

  return (
    <Card className="space-y-3" role="group" aria-label={t('assign.title')}>
      <CardTitle>{t('assign.title')}</CardTitle>
      <form
        noValidate
        className="space-y-3"
        onSubmit={form.handleSubmit((values) =>
          assign.mutate(toAssignmentRequest(values), { onSuccess: onDone }),
        )}
      >
        <Field label={t('fields.manager')}>
          {(field) => (
            <PersonSelect
              {...field}
              people={people}
              exclude={employee.id}
              emptyLabel={t('noManager')}
              {...form.register('managerId')}
            />
          )}
        </Field>
        <Field label={t('fields.department')}>
          {(field) => (
            <Select {...field} {...form.register('departmentId')}>
              <option value="">{t('noDepartment')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {assign.isError && <Alert tone="danger">{errors.apiError(assign.error)}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" disabled={assign.isPending}>
            {assign.isPending ? t('assign.saving') : t('assign.save')}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t('actions.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
