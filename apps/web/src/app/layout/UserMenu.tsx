import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCurrentUser, useSignOut } from '@/features/auth/use-auth';
import { Button } from '@/shared/ui/button';

export function UserMenu() {
  const { t } = useTranslation('common');
  const { data: user } = useCurrentUser();
  const signOut = useSignOut();
  if (!user) return null;

  return (
    <div className="flex items-center gap-1">
      <div className="hidden min-w-0 text-right leading-tight md:block">
        <p className="truncate text-sm font-medium">{user.email}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[user.workspace.name, user.roles.map((role) => role.name).join(', ')]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('signOut')}
        title={t('signOut')}
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        <LogOut className="size-5" aria-hidden="true" />
      </Button>
    </div>
  );
}
