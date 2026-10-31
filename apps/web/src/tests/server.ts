import {
  DEFAULT_WEEK,
  SYSTEM_ROLE_LABELS,
  mergeGrants,
  systemRoleGrants,
  type CurrentUser,
  type GrantedPermissions,
  type SystemRole,
} from '@intime/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const API = 'http://localhost:3000/api/v1';

const emptyPage = { items: [], total: 0, page: 1, pageSize: 25 };

/**
 * Neutral answers for reads that many pages make on the side (org chart, counts, cards). They stay after
 * `resetHandlers()`; a test that cares about one of them overrides it with `server.use(...)`.
 */
const defaultHandlers = [
  http.get(`${API}/org/chart`, () => HttpResponse.json({ nodes: [] })),
  http.get(`${API}/org/departments`, () => HttpResponse.json([])),
  http.get(`${API}/roles`, () => HttpResponse.json([])),
  http.get(`${API}/tasks`, () => HttpResponse.json(emptyPage)),
  http.get(`${API}/employees`, () => HttpResponse.json(emptyPage)),
  http.get(`${API}/employees/me`, () =>
    HttpResponse.json(errorBody('NOT_FOUND', 404), { status: 404 }),
  ),
  http.get(`${API}/employees/:id/schedule`, ({ params }) =>
    HttpResponse.json({
      employeeId: params.id,
      effective: [...DEFAULT_WEEK],
      isDefault: true,
      items: [],
      canManage: false,
    }),
  ),
  http.get(`${API}/employees/:id/compensation`, ({ params }) =>
    HttpResponse.json({ employeeId: params.id, items: [], canManage: false }),
  ),
  http.get(`${API}/notifications`, () =>
    HttpResponse.json({ items: [], unreadCount: 0, nextCursor: null }),
  ),
  http.get(`${API}/notifications/preferences`, () => HttpResponse.json([])),
  http.get(`${API}/attendance/status`, () =>
    HttpResponse.json({
      today: new Date().toISOString().slice(0, 10),
      open: null,
      records: [],
      minutes: 0,
    }),
  ),
  http.get(`${API}/time/compare`, () =>
    HttpResponse.json(errorBody('NOT_FOUND', 404), { status: 404 }),
  ),
];

/** One mock API for all component tests. Tests add or override handlers with server.use(...). */
export const server = setupServer(...defaultHandlers);

/** API calls nothing answered during the current test; the setup fails the test when there are any. */
export const unhandledRequests: string[] = [];

/** A signed-in user holding one system role, with that role's permissions from the catalog. */
export function userWithRole(role: SystemRole): CurrentUser {
  return {
    id: '0192f5a0-0000-7000-8000-00000000000a',
    email: 'maria@acme.eu',
    locale: null,
    timezone: null,
    workspace: { slug: 'acme', name: 'Acme GmbH' },
    roles: [{ key: role, name: SYSTEM_ROLE_LABELS[role] }],
    permissions: mergeGrants([systemRoleGrants(role)]),
  };
}

/** A user with arbitrary permissions (e.g. a future custom role such as "Outsourced"). */
export function userWithPermissions(
  permissions: GrantedPermissions,
  roleName = 'Outsourced',
): CurrentUser {
  return { ...userWithRole('employee'), roles: [{ key: null, name: roleName }], permissions };
}

/** The default test user: a plain employee (the least-privileged system role). */
export const testUser: CurrentUser = userWithRole('employee');

export function errorBody(code: string, status: number, extra: object = {}) {
  return { error: { code, message: 'dev message', status, requestId: 'req-1', ...extra } };
}

export const errorResponse = (code: string, status: number, extra: object = {}) =>
  HttpResponse.json(errorBody(code, status, extra), { status });

/** Default state of most tests: signed in, Google sign-in not configured. */
export function signedInHandlers(user: CurrentUser = testUser) {
  return [
    http.get(`${API}/auth/me`, () => HttpResponse.json(user)),
    http.get(`${API}/auth/providers`, () => HttpResponse.json({ google: false })),
    http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ unreadCount: 0 })),
    // An empty dashboard, so pages rendered at "/" make no widget requests (dashboard tests set their own).
    http.get(`${API}/dashboard/layout`, () =>
      HttpResponse.json({ widgets: [], isDefault: false, canEdit: false }),
    ),
  ];
}

/** Signed-out state: /auth/me and the refresh both answer 401. */
export function signedOutHandlers({ google = false } = {}) {
  return [
    http.get(`${API}/auth/me`, () => errorResponse('UNAUTHENTICATED', 401)),
    http.post(`${API}/auth/refresh`, () => errorResponse('UNAUTHENTICATED', 401)),
    http.get(`${API}/auth/providers`, () => HttpResponse.json({ google })),
  ];
}
