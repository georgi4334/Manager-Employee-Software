import { buildRoleTree, type RoleListItem } from '@intime/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePermission } from '@/features/auth/permissions';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Skeleton, SkeletonGroup } from '@/shared/ui/skeleton';
import { useRoles } from './hooks';
import { MoveRoleDialog } from './MoveRoleDialog';
import { RoleTree } from './RoleTree';
import { useRoleErrors } from './use-role-errors';

/** The roles of the workspace as a tree (ADR 0031, 0036): system roles to look at, custom roles to change. */
export function RolesPage() {
  const { t } = useTranslation('roles');
  const errors = useRoleErrors();
  const query = useRoles();
  const canManage = usePermission('admin.role.manage');
  const tree = useMemo(() => buildRoleTree(query.data ?? []), [query.data]);
  const [moving, setMoving] = useState<RoleListItem | null>(null);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canManage && (
          <Button asChild>
            <Link to="/roles/new">{t('new')}</Link>
          </Button>
        )}
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('tree.hint')}</p>
      {query.isPending && (
        <SkeletonGroup label={t('loading')} className="space-y-6">
          <Skeleton className="mx-auto h-36 max-w-sm rounded-xl" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} className="h-36 rounded-xl" />
            ))}
          </div>
        </SkeletonGroup>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {query.data && <RoleTree nodes={tree} canManage={canManage} onMove={setMoving} />}
      <MoveRoleDialog role={moving} roles={query.data ?? []} onClose={() => setMoving(null)} />
    </div>
  );
}
