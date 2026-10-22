import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import { AcceptInvitationPage } from '@/features/auth/AcceptInvitationPage';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { PublicOnly } from '@/features/auth/PublicOnly';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NotFoundPage } from '@/features/not-found/NotFoundPage';
import { ModulePlaceholderPage } from '@/features/placeholder/ModulePlaceholderPage';
import { NAV_ITEMS } from './nav';
import { AppShell } from './layout/AppShell';

export const routes: RouteObject[] = [
  {
    // Public pages: sign in, forgotten password, one-time links.
    element: <AuthLayout />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'accept-invitation', element: <AcceptInvitationPage /> },
    ],
  },
  {
    // Everything else needs a signed-in user.
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          ...NAV_ITEMS.filter((item) => item.path !== '/').map((item) => ({
            path: item.path.slice(1),
            element: <ModulePlaceholderPage labelKey={item.labelKey} />,
          })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (
  initialEntries: NonNullable<Parameters<typeof createMemoryRouter>[1]>['initialEntries'],
) => createMemoryRouter(routes, { initialEntries });
