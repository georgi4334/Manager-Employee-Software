import type { GrantedPermissions } from '@intime/contracts';
import { useCurrentUser } from '@/features/auth/use-auth';
import { visibleNavItems, type NavItem } from './nav';

export function useNavItems(): NavItem[] {
  const { data: user } = useCurrentUser();
  return visibleNavItems(user?.permissions as GrantedPermissions | undefined);
}
