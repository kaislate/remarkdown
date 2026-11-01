// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { loadEnv, type UserConfig } from 'vite';
import viteConfig from '../../vite.config';

// `tauri build` runs `vite build` with the updater's signing key and its
// password in the environment. Vite copies every variable whose name starts
// with an envPrefix into import.meta.env, so a prefix that matches them could
// put the key in the shipped bundle (GHSA-2rcp-jvr4-r259).

const SECRETS = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'];

function envPrefixFor(mode: string): string | string[] | undefined {
  const config = (viteConfig as (env: { mode: string; command: 'build' }) => UserConfig)({ mode, command: 'build' });
  return config.envPrefix;
}

describe('vite envPrefix', () => {
  afterEach(() => {
    for (const k of SECRETS) delete process.env[k];
  });

  for (const mode of ['production', 'development', 'e2e']) {
    it(`never exposes the updater signing secrets (${mode})`, () => {
      for (const k of SECRETS) process.env[k] = 'secret';
      const env = loadEnv(mode, process.cwd(), envPrefixFor(mode));
      for (const k of SECRETS) expect(env).not.toHaveProperty(k);
    });
  }
});
