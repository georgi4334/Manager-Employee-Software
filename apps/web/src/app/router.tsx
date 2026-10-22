import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NotFoundPage } from '@/features/not-found/NotFoundPage';
import { ModulePlaceholderPage } from '@/features/placeholder/ModulePlaceholderPage';
import { NAV_ITEMS } from './nav';
import { AppShell } from './layout/AppShell';

export const routes: RouteObject[] = [
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
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) =>
  createMemoryRouter(routes, { initialEntries });
