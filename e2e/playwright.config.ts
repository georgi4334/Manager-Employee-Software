import { defineConfig, devices } from '@playwright/test';

// A local machine without a downloaded browser can point PW_CHROMIUM at an installed Chromium.
const executablePath = process.env.PW_CHROMIUM;

export default defineConfig({
  testDir: './tests',
  // The specs build on each other (one workspace, people created in order), so they run in sequence.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Pixel 5'],
    viewport: { width: 375, height: 800 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    {
      command: 'node scripts/start-api.mjs',
      url: 'http://localhost:3000/health/ready',
      timeout: 180_000,
      reuseExistingServer: Boolean(process.env.E2E_REUSE),
    },
    {
      command: 'pnpm --filter @intime/web exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      timeout: 60_000,
      reuseExistingServer: Boolean(process.env.E2E_REUSE),
    },
  ],
});
