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

  it('a failed first load falls back to defaults', async () => {
    vi.resetModules();
    const api = await import('../../src/lib/tauri-api');
    vi.mocked(api.loadSettingsJson).mockImplementation(async () => { throw new Error('no host'); });
    const fresh = await import('../../src/stores/settings');
    fresh.updateSettings({ theme: 'light' }); // pollute, ensure it's reset
    await fresh.refreshSettings();
    expect(get(fresh.settings)).toEqual(DEFAULT_SETTINGS);
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

describe('reader mode and edit mode exclude each other', () => {
  it('turning on "always open ready to edit" turns off "always open in reader mode", and back', () => {
    updateSettings({ openInFocusMode: true });
    updateSettings({ openInEditMode: true });
    expect(get(settings).openInFocusMode).toBe(false);
    updateSettings({ openInFocusMode: true });
    expect(get(settings).openInEditMode).toBe(false);
  });
});

describe('settings that fail to load are never overwritten by defaults', () => {
  it('a failed reload keeps the settings already in use', async () => {
    vi.mocked(loadSettingsJson).mockResolvedValueOnce(JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'light' }));
    await refreshSettings();
    expect(get(settings).theme).toBe('light');
    vi.mocked(loadSettingsJson).mockImplementationOnce(async () => { throw new Error('locked'); });
    await refreshSettings();
    expect(get(settings).theme).toBe('light');
  });

  it('defaults used after a failed first load are not written back on their own', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const api = await import('../../src/lib/tauri-api');
    vi.mocked(api.loadSettingsJson).mockImplementation(async () => { throw new Error('locked'); });
    vi.mocked(api.saveSettingsJson).mockClear();
    const fresh = await import('../../src/stores/settings');
    const dispose = fresh.installSettingsAutosave();
    await fresh.refreshSettings();
    await vi.advanceTimersByTimeAsync(500);
    expect(api.saveSettingsJson).not.toHaveBeenCalled();
    dispose();
  });
});
