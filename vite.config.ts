import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1566,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
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
