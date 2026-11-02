import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { e2eCsp } from './tests/e2e/support/csp';

export default defineConfig(({ mode }) => ({
  // e2e builds carry the app's CSP, so the suite runs under it.
  plugins: mode === 'e2e' ? [svelte(), e2eCsp()] : [svelte()],
  clearScreen: false,
  server: {
    port: 1566,
    strictPort: true,
  },
  // Only VITE_ variables reach import.meta.env. `tauri build` runs this with
  // the updater's signing key in TAURI_SIGNING_PRIVATE_KEY, so a 'TAURI_'
  // prefix could inline the key into the shipped bundle. The app reads no
  // TAURI_ENV_* variables either (desktop_env tells it the platform).
  envPrefix: 'VITE_',
  build: {
    target: 'es2022',
    minify: 'esbuild',
    // Kept for the e2e build. The release build leaves them out: Tauri
    // embeds every file in dist/ in the executable, and the page never
    // asks for a map, so they only made each download bigger.
    sourcemap: mode === 'e2e',
  },
  resolve: {
    conditions: ['browser'],
    alias: mode === 'e2e' ? {
      '@tauri-apps/api/core': resolve(__dirname, 'tests/e2e/support/tauri-mock.ts'),
      '@tauri-apps/api/app': resolve(__dirname, 'tests/e2e/support/tauri-app-mock.ts'),
    } : undefined,
  },
}));
