import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';

// Settings are asked for while the platform check is still out, but what a
// fresh install gets depends on the OS (the glide starts off on a Mac). The
// defaults must come from the OS the backend reports, not from the user
// agent's guess, which can differ (WebKit's user agent says "Macintosh").

const { pending } = vi.hoisted(() => ({ pending: {} as Record<string, (v: unknown) => void> }));

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(async () => null),
  listRecent: vi.fn(async () => []),
  checkPathsExist: vi.fn(async (paths: string[]) => paths.map(() => true)),
  loadReadingProgressJson: vi.fn(async () => null),
  saveSettingsJson: vi.fn(async () => {}),
  saveReadingProgressJson: vi.fn(async () => {}),
  windowLabel: vi.fn(() => 'main'),
  desktopEnv: vi.fn(() => new Promise((resolve) => { pending.env = resolve; })),
}));

import { startStartupReads } from '../../src/lib/startup-reads';
import { initPlatform, osFromUserAgent } from '../../src/lib/platform';
import { loadSettingsJson } from '../../src/lib/tauri-api';
import { settings } from '../../src/stores/settings';

describe('settings read before the platform is known', () => {
  it("a fresh install gets the defaults of the OS the backend reports", async () => {
    // jsdom's user agent reads as Windows, where the glide starts on.
    expect(osFromUserAgent(navigator.userAgent)).toBe('windows');
    const platformReady = initPlatform();
    const reads = startStartupReads(platformReady);
    // Still asked for at once, not after the platform check.
    expect(loadSettingsJson).toHaveBeenCalledTimes(1);

    pending.env({ os: 'macos', tiling: false });
    await platformReady;
    await reads.settings;
    expect(get(settings).smoothScrolling).toBe(false);
  });
});
