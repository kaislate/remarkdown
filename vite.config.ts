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
    sourcemap: true,
  },
  resolve: {
    conditions: ['browser'],
    alias: mode === 'e2e' ? {
      '@tauri-apps/api/core': resolve(__dirname, 'tests/e2e/support/tauri-mock.ts'),
    } : undefined,
  },
}));
