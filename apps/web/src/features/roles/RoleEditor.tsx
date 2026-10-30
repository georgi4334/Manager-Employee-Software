import { zodResolver } from '@hookform/resolvers/zod';
import type { GrantedPermissions, RoleDetail } from '@intime/contracts';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/features/auth/messages';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { copyGrants, emptyRole, roleFormSchema, valuesOf, type RoleFormValues } from './forms';
import { fetchRole } from './api';
import { PermissionGrid } from './PermissionGrid';
import { useRoles } from './hooks';
import { indent, parentOptions } from './tree';
import { useRoleErrors } from './use-role-errors';

interface EditorProps {
  /** Editing this role; creating one when omitted. */
  role?: RoleDetail;
  mine: GrantedPermissions | undefined;
  pending: boolean;
  error: unknown;
  onSubmit: (values: RoleFormValues) => void;
  onCancel: () => void;
}

/** Name, description and the permission grid; the same form creates and changes a custom role. */
export function RoleEditor({ role, mine, pending, error, onSubmit, onCancel }: EditorProps) {
  const { t } = useTranslation('roles');
  const messages = useMessages();
  const errors = useRoleErrors();
  const roles = useRoles();
  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: role ? valuesOf(role) : emptyRole(),
  });
  const [copyError, setCopyError] = useState<unknown>(null);
  const e = form.formState.errors;

  const copyFrom = async (id: string) => {
    if (!id) return;
    try {
      const source = await fetchRole(id);
      setCopyError(null);
      form.setValue('grants', copyGrants(source.grants, mine), { shouldDirty: true });
    } catch (failure) {
      setCopyError(failure);
    }
  };

  return (
    <form
      noValidate
      className="space-y-4"
      aria-label={role ? t('form.editTitle') : t('form.newTitle')}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Field label={t('form.name')} error={messages.validation(e.name)}>
        {(field) => (
          <Input {...field} maxLength={60} autoComplete="off" {...form.register('name')} />
        )}
      </Field>
      <Field label={t('form.description')} error={messages.validation(e.description)}>
        {(field) => (
          <Input {...field} maxLength={200} autoComplete="off" {...form.register('description')} />
        )}
      </Field>
      <Controller
        control={form.control}
        name="parentId"
        render={({ field: { ref, ...value } }) => (
          <Field label={t('form.parent')} hint={t('form.parentHint')}>
            {(field) => (
              // Controlled: the options arrive with the role list, after the form has its values.
              <Select {...field} {...value} ref={ref}>
                <option value="">{t('move.top')}</option>
                {parentOptions(roles.data ?? [], role?.id).map((o) => (
                  <option key={o.id} value={o.id}>
                    {indent(o)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      />
      {!role && (roles.data?.length ?? 0) > 0 && (
        <Field label={t('form.copyFrom')} hint={t('form.copyHint')}>
          {(field) => (
            <Select {...field} defaultValue="" onChange={(ev) => void copyFrom(ev.target.value)}>
              <option value="">—</option>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {copyError !== null && <Alert tone="danger">{errors.apiError(copyError)}</Alert>}
      <section aria-labelledby="role-permissions" className="space-y-2">
        <h2 id="role-permissions" className="text-base font-semibold">
          {t('form.permissions')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('form.permissionsHint')}</p>
        <Controller
          control={form.control}
          name="grants"
          render={({ field }) => (
            <PermissionGrid value={field.value} mine={mine} onChange={field.onChange} />
          )}
        />
      </section>
      {error !== null && error !== undefined && (
        <Alert tone="danger">{errors.apiError(error)}</Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('form.saving') : t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
