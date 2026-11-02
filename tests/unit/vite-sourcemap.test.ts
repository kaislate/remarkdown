// @vitest-environment node
import { describe, it, expect } from 'vitest';
import config from '../../vite.config';

type ConfigFn = (env: { mode: string; command: 'build' | 'serve' }) => { build?: { sourcemap?: unknown } };

// The app embeds every file in dist/ in its executable: source maps there
// only make the download bigger (the page never asks for them).
describe('vite build source maps', () => {
  it('are left out of the release build', () => {
    expect((config as unknown as ConfigFn)({ mode: 'production', command: 'build' }).build?.sourcemap).toBeFalsy();
  });

  it('are kept for the e2e build, where failures are debugged', () => {
    expect((config as unknown as ConfigFn)({ mode: 'e2e', command: 'build' }).build?.sourcemap).toBe(true);
  });
});
