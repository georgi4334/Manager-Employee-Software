import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { initTestI18n } from './i18n';
import { server, signedInHandlers } from './server';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

beforeEach(async () => {
  server.use(...signedInHandlers());
  await initTestI18n('en');
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
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
