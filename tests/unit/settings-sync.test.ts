import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(),
  saveSettingsJson: vi.fn(async () => {}),
  windowLabel: vi.fn(() => 'main'),
}));

// Capture the cross-window channel.
const emitted: Array<{ event: string; payload: unknown }> = [];
let listener: ((e: { payload: { from: string } }) => void) | null = null;
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(async (event: string, payload: unknown) => { emitted.push({ event, payload }); }),
  listen: vi.fn(async (_event: string, cb: (e: { payload: { from: string } }) => void) => {
    listener = cb;
    return () => { listener = null; };
  }),
}));

import { loadSettingsJson, saveSettingsJson } from '../../src/lib/tauri-api';
import { settings, updateSettings, resetSettings, installSettingsAutosave } from '../../src/stores/settings';
import { DEFAULT_SETTINGS } from '../../src/lib/settings-schema';

describe('settings sync across windows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitted.length = 0;
    vi.mocked(saveSettingsJson).mockClear();
    vi.mocked(loadSettingsJson).mockClear();
    resetSettings();
  });
  afterEach(() => vi.useRealTimers());

  it('announces a save to the other windows', async () => {
    const dispose = installSettingsAutosave();
    await vi.advanceTimersByTimeAsync(0);
    updateSettings({ theme: 'light' });
    await vi.advanceTimersByTimeAsync(250);
    expect(saveSettingsJson).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([{ event: 'settings-changed', payload: { from: 'main' } }]);
    dispose();
  });

  it('reloads when another window saved, without saving it back (no ping-pong)', async () => {
    const dispose = installSettingsAutosave();
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(loadSettingsJson).mockResolvedValueOnce(JSON.stringify({ ...DEFAULT_SETTINGS, openMode: 'windows' }));
    listener!({ payload: { from: 'doc-1' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(get(settings).openMode).toBe('windows');
    expect(saveSettingsJson).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
    dispose();
  });

  it('ignores its own announcements', async () => {
    const dispose = installSettingsAutosave();
    await vi.advanceTimersByTimeAsync(0);
    listener!({ payload: { from: 'main' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(loadSettingsJson).not.toHaveBeenCalled();
    dispose();
  });
});
