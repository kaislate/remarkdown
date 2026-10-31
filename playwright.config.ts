import { defineConfig } from '@playwright/test';

// E2E_PORT lets two checkouts (e.g. git worktrees) run their suites side
// by side without one silently reusing the other's preview server.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  // Shared CI runners are slow and uneven, and much here is animation: one
  // retry there keeps a test that lost a race with the machine from failing
  // the run. Such a test still shows: the summary lists it as flaky, the
  // github reporter puts a warning on the run, and its retry keeps a trace.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    viewport: { width: 1100, height: 780 },
  },
  // Windows renders with WebView2 (Chromium); macOS and Linux render with
  // WebKit (WKWebView, WebKitGTK). The whole suite runs in both engines so
  // a WebKit-only break shows up here rather than on a Mac nobody tested.
  // The Tauri mock still reports Windows unless a test says otherwise:
  // these projects test the engine, not the platform chrome.
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `npm run build:e2e && npx vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  testMatch: '**/*.spec.ts',
});
