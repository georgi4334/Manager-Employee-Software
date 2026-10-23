import { zodResolver } from '@hookform/resolvers/zod';
import type { ChartNode, Department } from '@intime/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { departmentFormSchema, toDepartmentRequest, type DepartmentFormValues } from './forms';
import {
  useChart,
  useCreateDepartment,
  useDeleteDepartment,
  useDepartments,
  useUpdateDepartment,
} from './hooks';
import { PersonSelect, usePersonName } from './PersonSelect';
import { useOrgErrors } from './use-org-errors';

export function DepartmentsTab() {
  const { t } = useTranslation('organization');
  const errors = useOrgErrors();
  const canManage = usePermission('org.manage');
  const departments = useDepartments();
  const chart = useChart();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const people = chart.data?.nodes ?? [];
  // Forms need the people list for their selects before they can show the current values.
  const canEdit = canManage && chart.isSuccess;
  const list = departments.data ?? [];
  const nameOf = new Map(list.map((d) => [d.id, d.name]));

  if (departments.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (departments.isError) return <Alert tone="danger">{errors.apiError(departments.error)}</Alert>;

  return (
    <div className="space-y-3">
      {canEdit && editing !== 'new' && (
        <Button onClick={() => setEditing('new')}>{t('departments.add')}</Button>
      )}
      {canEdit && editing === 'new' && (
        <DepartmentForm departments={list} people={people} onDone={() => setEditing(null)} />
      )}
      {list.length === 0 ? (
        <Card>
          <p className="text-center text-sm text-muted-foreground">{t('departments.empty')}</p>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label={t('departments.list')}>
          {list.map((department) => (
            <li key={department.id}>
              {canEdit && editing === department.id ? (
                <DepartmentForm
                  department={department}
                  departments={list}
                  people={people}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <DepartmentRow
                  department={department}
                  parentName={department.parentId ? nameOf.get(department.parentId) : undefined}
                  canManage={canManage}
                  onEdit={() => setEditing(department.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DepartmentRow({
  department,
  parentName,
  canManage,
  onEdit,
}: {
  department: Department;
  parentName?: string;
  canManage: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('organization');
  const personName = usePersonName();
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteDepartment(department.id);
  const errors = useOrgErrors();

  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{department.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {[
              parentName ? t('departments.parent', { name: parentName }) : null,
              t('departments.counts', { count: department.employeeCount }),
              t('departments.teamCount', { count: department.teamCount }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="text-sm text-muted-foreground">
            {department.head
              ? t('departments.head', { name: personName(department.head) })
              : t('noHead')}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onEdit}>
              {t('actions.edit')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming((v) => !v)}>
              {t('actions.delete')}
            </Button>
          </div>
        )}
      </div>
      {confirming && (
        <div
          role="group"
          aria-label={t('deleteTitle', { name: department.name })}
          className="space-y-2"
        >
          <p className="text-sm font-medium">{t('deleteTitle', { name: department.name })}</p>
          <p className="text-sm text-muted-foreground">{t('deleteText')}</p>
          {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
          <div className="flex gap-2">
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t('actions.confirmDelete')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('actions.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DepartmentForm({
  department,
  departments,
  people,
  onDone,
}: {
  department?: Department;
  departments: Department[];
  people: ChartNode[];
  onDone: () => void;
}) {
  const { t } = useTranslation('organization');
  const messages = useMessages();
  const errors = useOrgErrors();
  const create = useCreateDepartment();
  const update = useUpdateDepartment(department?.id ?? '');
  const mutation = department ? update : create;
  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentFormSchema),
    defaultValues: {
      name: department?.name ?? '',
      parentId: department?.parentId ?? '',
      headEmployeeId: department?.head?.id ?? '',
    },
  });

  return (
    <Card>
      <form
        noValidate
        className="space-y-3"
        onSubmit={form.handleSubmit((values) =>
          mutation.mutate(toDepartmentRequest(values), { onSuccess: onDone }),
        )}
      >
        <Field label={t('fields.name')} error={messages.validation(form.formState.errors.name)}>
          {(field) => <Input {...field} autoComplete="off" {...form.register('name')} />}
        </Field>
        <Field label={t('fields.parent')}>
          {(field) => (
            <Select {...field} {...form.register('parentId')}>
              <option value="">{t('none')}</option>
              {departments
                .filter((d) => d.id !== department?.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t('fields.head')}>
          {(field) => (
            <PersonSelect
              {...field}
              people={people}
              emptyLabel={t('noHead')}
              {...form.register('headEmployeeId')}
            />
          )}
        </Field>
        {mutation.isError && <Alert tone="danger">{errors.apiError(mutation.error)}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('actions.saving') : t('actions.save')}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t('actions.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
