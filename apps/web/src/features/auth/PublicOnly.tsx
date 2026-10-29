import { Navigate, Outlet, useLocation } from 'react-router';
import { Splash } from '@/shared/components/Splash';
import { safeRedirectPath } from './redirect';
import { useCurrentUser } from './use-auth';

/** Sign-in pages are pointless for someone who is already signed in. */
export function PublicOnly() {
  const location = useLocation();
  const { data: user } = useCurrentUser();
  if (user) {
    const from = (location.state as { from?: unknown } | null)?.from;
    // A redirect draws nothing for a frame; the boot screen covers it.
    return (
      <>
        <Splash />
        <Navigate to={safeRedirectPath(from)} replace />
      </>
    );
  }
  return <Outlet />;
}
