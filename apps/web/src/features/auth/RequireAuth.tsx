import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Splash } from '@/shared/components/Splash';
import { Button } from '@/shared/ui/button';
import { Card, CardTitle } from '@/shared/ui/card';
import { useCurrentUser } from './use-auth';

export function FullPageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">{children}</div>
  );
}

/** Routes inside require a signed-in user; everyone else is sent to the login page and back afterwards. */
export function RequireAuth() {
  const { t } = useTranslation('common');
  const location = useLocation();
  const { data: user, isPending, isError, refetch } = useCurrentUser();

  if (isPending) {
    return <Splash />;
  }

  if (isError) {
    return (
      <FullPageMessage>
        <Card className="max-w-sm space-y-3 text-center">
          <CardTitle>{t('connectionProblemTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('connectionProblemText')}</p>
          <Button onClick={() => void refetch()}>{t('retry')}</Button>
        </Card>
      </FullPageMessage>
    );
  }

  if (!user) {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }
  return <Outlet />;
}
