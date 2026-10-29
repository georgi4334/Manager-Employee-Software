import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { useRoles } from './hooks';
import { useRoleErrors } from './use-role-errors';

/** The roles of the workspace (ADR 0031): system roles to look at, custom roles to change. */
export function RolesPage() {
  const { t } = useTranslation('roles');
  const errors = useRoleErrors();
  const query = useRoles();
  const canManage = usePermission('admin.role.manage');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canManage && (
          <Button asChild>
            <Link to="/roles/new">{t('new')}</Link>
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {query.data && (
        <ul aria-label={t('list')} className="grid gap-3 sm:grid-cols-2">
          {query.data.map((role) => (
            <li key={role.id}>
              <Link
                to={`/roles/${role.id}`}
                className="block h-full rounded-xl glass p-4 hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{role.name}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {role.isSystem ? t('system') : t('custom')}
                  </span>
                </span>
                {role.description && (
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {role.description}
                  </span>
                )}
                <span className="mt-2 block text-sm">
                  {t('counts', { permissions: role.permissionCount, people: role.userCount })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
