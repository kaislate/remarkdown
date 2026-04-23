import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    viewport: { width: 1100, height: 780 },
  },
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  testMatch: '**/*.spec.ts',
});
