import { Outlet } from 'react-router';
import { ForbiddenPage } from '@/features/forbidden/ForbiddenPage';
import { usePermission, type PermissionRequirement } from './permissions';

/** Route wrapper: users without the permission see the "no access" page instead of the screen. */
export function RequirePermission({ permission }: { permission: PermissionRequirement }) {
  return usePermission(permission) ? <Outlet /> : <ForbiddenPage />;
}
