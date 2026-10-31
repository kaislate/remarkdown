import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const WEBVIEW2_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // The first diagram test in a file loads mermaid itself; with every
    // file running at once that can take well over 15 seconds.
    testTimeout: 30000,
    // jsdom's default user agent names the host OS (process.platform), and
    // platform.ts reads the OS from the user agent. Pin the one WebView2 sends
    // so a test run on a Mac or Linux runner sees the same Windows app as one
    // here; tests that want another OS call setPlatformForTests.
    environmentOptions: {
      jsdom: {
        userAgent: WEBVIEW2_UA,
      },
    },
  },
});
