import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';

// Every read starts at once; none of them resolves until the test says so.
const { pending, later } = vi.hoisted(() => {
  const pending: Record<string, (v: unknown) => void> = {};
  const later = (name: string) => () => new Promise((resolve) => { pending[name] = resolve; });
  return { pending, later };
});

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(later('settings')),
  listRecent: vi.fn(later('recent')),
  checkPathsExist: vi.fn(async (paths: string[]) => paths.map(() => true)),
  loadReadingProgressJson: vi.fn(later('progress')),
  saveSettingsJson: vi.fn(async () => {}),
  saveReadingProgressJson: vi.fn(async () => {}),
  windowLabel: vi.fn(() => 'main'),
}));

import { startStartupReads } from '../../src/lib/startup-reads';
import { loadSettingsJson, listRecent, loadReadingProgressJson } from '../../src/lib/tauri-api';
import { settings } from '../../src/stores/settings';
import { recent } from '../../src/stores/recent';

describe('startStartupReads', () => {
  it('asks for settings, recent files and reading progress together, not one after another', async () => {
    const reads = startStartupReads();
    expect(loadSettingsJson).toHaveBeenCalledTimes(1);
    expect(listRecent).toHaveBeenCalledTimes(1);
    expect(loadReadingProgressJson).toHaveBeenCalledTimes(1);

    // Asking again (App's onMount after main.ts) reuses the same reads.
    expect(startStartupReads()).toBe(reads);
    expect(loadSettingsJson).toHaveBeenCalledTimes(1);

    pending.settings(JSON.stringify({ schemaVersion: 1, theme: 'light' }));
    pending.recent(['/a.md']);
    pending.progress(null);
    await Promise.all([reads.settings, reads.recent, reads.progress]);
    expect(get(settings).theme).toBe('light');
    expect(get(recent)).toEqual(['/a.md']);
  });
});
