import type { CurrentUser } from '@intime/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/** One mock API for all component tests. Tests add or override handlers with server.use(...). */
export const server = setupServer();

export const API = 'http://localhost:3000/api/v1';

export const testUser: CurrentUser = {
  id: '0192f5a0-0000-7000-8000-00000000000a',
  email: 'maria@acme.eu',
  locale: null,
  timezone: null,
  workspace: { slug: 'acme', name: 'Acme GmbH' },
};

export function errorBody(code: string, status: number, extra: object = {}) {
  return { error: { code, message: 'dev message', status, requestId: 'req-1', ...extra } };
}

export const errorResponse = (code: string, status: number, extra: object = {}) =>
  HttpResponse.json(errorBody(code, status, extra), { status });

/** Default state of most tests: signed in, Google sign-in not configured. */
export function signedInHandlers() {
  return [
    http.get(`${API}/auth/me`, () => HttpResponse.json(testUser)),
    http.get(`${API}/auth/providers`, () => HttpResponse.json({ google: false })),
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
