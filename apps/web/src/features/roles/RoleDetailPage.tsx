import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/use-auth';
import { usePermission } from '@/features/auth/permissions';
import { isApiError } from '@/shared/api/api-error';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { grantsToMap, toRequest } from './forms';
import { useDeleteRole, useRole, useUpdateRole } from './hooks';
import { PermissionGrid } from './PermissionGrid';
import { RoleEditor } from './RoleEditor';
import { useRoleErrors } from './use-role-errors';
import { BackLink } from '@/shared/ui/back-link';

/** One role. System roles (and viewers without `admin.role.manage`) get a read-only list; custom roles an editor. */
export function RoleDetailPage() {
  const { t } = useTranslation('roles');
  const { id } = useParams();
  const navigate = useNavigate();
  const errors = useRoleErrors();
  const { data: user } = useCurrentUser();
  const canManage = usePermission('admin.role.manage');
  const query = useRole(id);
  const update = useUpdateRole(id ?? '');
  const remove = useDeleteRole(id ?? '');
  const [confirming, setConfirming] = useState(false);
  const role = query.data;
  const editable = Boolean(role && !role.isSystem && canManage);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink to="/roles">{t('back')}</BackLink>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {query.isError &&
        (isApiError(query.error, 'NOT_FOUND') ? (
          <Card className="space-y-1 text-center">
            <h1 className="text-base font-semibold">{t('notFoundTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('notFoundText')}</p>
          </Card>
        ) : (
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
        ))}
      {role && (
        <>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{role.name}</h1>
            <p className="text-sm text-muted-foreground">
              {role.isSystem ? t('systemNote') : t('customNote')}
              {' · '}
              {t('counts', { permissions: role.grants.length, people: role.userCount })}
            </p>
            {role.description && <p className="text-sm">{role.description}</p>}
          </div>

          {editable ? (
            <>
              <RoleEditor
                key={`${role.id}-${role.grants.length}-${role.name}`}
                role={role}
                mine={user?.permissions}
                pending={update.isPending}
                error={update.error}
                onSubmit={(values) => update.mutate(toRequest(values))}
                onCancel={() => navigate('/roles')}
              />
              {update.isSuccess && <Alert tone="success">{t('saved')}</Alert>}
              <Card className="space-y-2">
                <h2 className="text-base font-semibold">{t('delete.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('delete.text')}</p>
                {!confirming ? (
                  <Button variant="secondary" onClick={() => setConfirming(true)}>
                    {t('delete.button')}
                  </Button>
                ) : (
                  <div role="group" aria-label={t('delete.confirm')} className="space-y-2">
                    <p className="text-sm font-medium">{t('delete.confirm')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate(undefined, { onSuccess: () => navigate('/roles') })
                        }
                      >
                        {t('delete.yes')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(false)}>
                        {t('delete.keep')}
                      </Button>
                    </div>
                  </div>
                )}
                {remove.isError && <Alert tone="danger">{errors.apiError(remove.error)}</Alert>}
              </Card>
            </>
          ) : (
            <section aria-labelledby="role-permissions" className="space-y-2">
              <h2 id="role-permissions" className="text-base font-semibold">
                {t('form.permissions')}
              </h2>
              {role.grants.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noPermissions')}</p>
              ) : (
                <PermissionGrid
                  value={grantsToMap(role.grants)}
                  mine={user?.permissions}
                  readOnly
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
