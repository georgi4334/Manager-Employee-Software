import { Navigate, Outlet, useLocation } from 'react-router';
import { safeRedirectPath } from './redirect';
import { useCurrentUser } from './use-auth';

/** Sign-in pages are pointless for someone who is already signed in. */
export function PublicOnly() {
  const location = useLocation();
  const { data: user } = useCurrentUser();
  if (user) {
    const from = (location.state as { from?: unknown } | null)?.from;
    return <Navigate to={safeRedirectPath(from)} replace />;
  }
  return <Outlet />;
}
