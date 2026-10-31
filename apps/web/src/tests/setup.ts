import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { initTestI18n } from './i18n';
import { API, server, signedInHandlers, unhandledRequests } from './server';

// The default 1 s for findBy/waitFor is too short when the whole monorepo's tests share the CPU (CI, `pnpm test`);
// paging tests timed out now and then. A longer wait only slows tests that would otherwise fail.
configure({ asyncUtilTimeout: 3000 });

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  // An API call nobody answers fails as a network error and would quietly test the error state instead.
  server.events.on('request:unhandled', ({ request }) => {
    if (request.url.startsWith(API)) {
      const url = new URL(request.url);
      unhandledRequests.push(`${request.method} ${url.pathname}${url.search}`);
    }
  });
});
afterAll(() => server.close());

beforeEach(async () => {
  server.use(...signedInHandlers());
  await initTestI18n('en');
});

afterEach(() => {
  const missed = unhandledRequests.splice(0);
  server.resetHandlers();
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  if (missed.length > 0) {
    throw new Error(
      `API calls without a handler (add one to the test or tests/server.ts):\n${missed.join('\n')}`,
    );
  }
});

export function mockMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

mockMatchMedia(false);
