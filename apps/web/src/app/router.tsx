import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import { AcceptInvitationPage } from '@/features/auth/AcceptInvitationPage';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { PublicOnly } from '@/features/auth/PublicOnly';
import { RequirePermission } from '@/features/auth/RequirePermission';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { EmployeeDetailPage } from '@/features/employees/EmployeeDetailPage';
import { EmployeeFormPage } from '@/features/employees/EmployeeFormPage';
import { EmployeesPage } from '@/features/employees/EmployeesPage';
import { MyProfilePage } from '@/features/employees/MyProfilePage';
import { AttendancePage } from '@/features/attendance/AttendancePage';
import { LeavePage } from '@/features/leave/LeavePage';
import { OrganizationPage } from '@/features/organization/OrganizationPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NotFoundPage } from '@/features/not-found/NotFoundPage';
import { NotificationSettingsPage } from '@/features/notifications/NotificationSettingsPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { ModulePlaceholderPage } from '@/features/placeholder/ModulePlaceholderPage';
import { NAV_ITEMS } from './nav';
import { AppShell } from './layout/AppShell';

/** Modules that have real pages; the others still show the placeholder. */
const IMPLEMENTED_PATHS = ['/employees', '/organization', '/leave', '/attendance'];

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
          ...NAV_ITEMS.filter(
            (item) => item.path !== '/' && !IMPLEMENTED_PATHS.includes(item.path),
          ).map((item) => ({
            // Users without the item's permission see "no access" instead of the screen.
            element: item.permission ? (
              <RequirePermission permission={item.permission} />
            ) : undefined,
            children: [
              {
                path: item.path.slice(1),
                element: <ModulePlaceholderPage labelKey={item.labelKey} />,
              },
            ],
          })),
          {
            element: <RequirePermission permission="employee.view_directory" />,
            children: [
              { path: 'employees', element: <EmployeesPage /> },
              { path: 'employees/:id', element: <EmployeeDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={['attendance.record', 'attendance.view']} />,
            children: [{ path: 'attendance', element: <AttendancePage /> }],
          },
          {
            element: <RequirePermission permission={['leave.request', 'leave.view']} />,
            children: [{ path: 'leave', element: <LeavePage /> }],
          },
          {
            element: <RequirePermission permission="org.view" />,
            children: [{ path: 'organization', element: <OrganizationPage /> }],
          },
          {
            element: <RequirePermission permission="employee.create" />,
            children: [{ path: 'employees/new', element: <EmployeeFormPage /> }],
          },
          {
            element: <RequirePermission permission="employee.update" />,
            children: [{ path: 'employees/:id/edit', element: <EmployeeFormPage /> }],
          },
          { path: 'profile', element: <MyProfilePage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          {
            element: <RequirePermission permission="notification.manage_own_prefs" />,
            children: [{ path: 'notifications/settings', element: <NotificationSettingsPage /> }],
          },
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
