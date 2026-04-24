import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(),
  saveSettingsJson: vi.fn(),
}));

import { loadSettingsJson, saveSettingsJson } from '../../src/lib/tauri-api';
import {
  settings,
  refreshSettings,
  updateSettings,
  resetSettings,
  installSettingsAutosave,
} from '../../src/stores/settings';
import { DEFAULT_SETTINGS } from '../../src/lib/settings-schema';

beforeEach(() => {
  vi.mocked(loadSettingsJson).mockReset();
  vi.mocked(saveSettingsJson).mockReset();
  resetSettings();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('settings store', () => {
  it('starts with defaults', () => {
    expect(get(settings)).toEqual(DEFAULT_SETTINGS);
  });

  it('refreshSettings loads persisted JSON and parses it into the store', async () => {
    vi.mocked(loadSettingsJson).mockResolvedValue(
      JSON.stringify({ theme: 'light', watermarkOpacity: 0.15 }),
    );
    await refreshSettings();
    expect(get(settings).theme).toBe('light');
    expect(get(settings).watermarkOpacity).toBe(0.15);
    expect(get(settings).splashEnabled).toBe(DEFAULT_SETTINGS.splashEnabled);
  });

  it('refreshSettings falls back to defaults on IPC failure', async () => {
    vi.mocked(loadSettingsJson).mockRejectedValue(new Error('no host'));
    updateSettings({ theme: 'light' }); // pollute, ensure it's reset
    await refreshSettings();
    expect(get(settings)).toEqual(DEFAULT_SETTINGS);
  });

  it('updateSettings merges a partial patch into the store', () => {
    updateSettings({ theme: 'light', maxRecent: 25 });
    const s = get(settings);
    expect(s.theme).toBe('light');
    expect(s.maxRecent).toBe(25);
    expect(s.splashEnabled).toBe(DEFAULT_SETTINGS.splashEnabled);
  });

  it('installSettingsAutosave debounces and persists changes', async () => {
    vi.useFakeTimers();
    vi.mocked(saveSettingsJson).mockResolvedValue(undefined);
    const dispose = installSettingsAutosave();

    // First emission (current value at subscribe time) is skipped.
    updateSettings({ theme: 'light' });
    updateSettings({ maxRecent: 5 });
    expect(saveSettingsJson).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(saveSettingsJson).toHaveBeenCalledTimes(1);
    const written = JSON.parse(vi.mocked(saveSettingsJson).mock.calls[0][0]);
    expect(written.theme).toBe('light');
    expect(written.maxRecent).toBe(5);

    dispose();
  });
});
