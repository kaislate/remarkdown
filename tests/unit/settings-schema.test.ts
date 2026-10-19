import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, SettingsSchema } from '../../src/lib/settings-schema';

describe('settings-schema', () => {
  it('returns defaults when raw is null', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when raw is malformed JSON', () => {
    expect(parseSettings('{not-json')).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when raw is not an object', () => {
    expect(parseSettings('"a string"')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a valid settings object', () => {
    const json = JSON.stringify(DEFAULT_SETTINGS);
    expect(parseSettings(json)).toEqual(DEFAULT_SETTINGS);
  });

  it('merges partial settings over defaults so missing fields pick up defaults', () => {
    const partial = JSON.stringify({ theme: 'light', watermarkOpacity: 0.12 });
    const result = parseSettings(partial);
    expect(result.theme).toBe('light');
    expect(result.watermarkOpacity).toBe(0.12);
    // Untouched fields fall back to defaults.
    expect(result.splashEnabled).toBe(DEFAULT_SETTINGS.splashEnabled);
    expect(result.defaultZoom).toBe(DEFAULT_SETTINGS.defaultZoom);
  });

  it('rejects unknown theme values and falls back to defaults', () => {
    const bad = JSON.stringify({ theme: 'sepia' });
    expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects out-of-range numeric fields', () => {
    expect(parseSettings(JSON.stringify({ watermarkOpacity: 5 }))).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ articleWidth: 50 }))).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ maxRecent: 0 }))).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ saveDebounceMs: 99 }))).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects defaultHighlightColor not in the preset palette', () => {
    const bad = JSON.stringify({ defaultHighlightColor: '#000000' });
    expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects defaultZoom not in ZOOM_LEVELS', () => {
    const bad = JSON.stringify({ defaultZoom: 1.234 });
    expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it('overrides whatever schemaVersion is in the file with the current one', () => {
    // Future-proofing: a stored file that says version 99 still loads, with
    // the schemaVersion forced back to 1.
    const future = JSON.stringify({ ...DEFAULT_SETTINGS, schemaVersion: 99 });
    expect(parseSettings(future).schemaVersion).toBe(1);
  });

  it('SettingsSchema accepts a fully-valid object directly', () => {
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe('open-mode settings', () => {
  it('defaults openMode to tabs and reopenTabsOnLaunch to true', () => {
    const s = parseSettings(null);
    expect(s.openMode).toBe('tabs');
    expect(s.reopenTabsOnLaunch).toBe(true);
  });

  it('older settings files without the new keys pick up the defaults', () => {
    const s = parseSettings(JSON.stringify({ schemaVersion: 1, theme: 'light' }));
    expect(s.theme).toBe('light');
    expect(s.openMode).toBe('tabs');
    expect(s.reopenTabsOnLaunch).toBe(true);
  });

  it('accepts each valid openMode', () => {
    for (const m of ['tabs', 'replace', 'windows'] as const) {
      expect(parseSettings(JSON.stringify({ openMode: m })).openMode).toBe(m);
    }
  });

  it('an unknown openMode falls back to defaults', () => {
    expect(parseSettings(JSON.stringify({ openMode: 'bogus' })).openMode).toBe('tabs');
  });
});

describe('reader-mode settings', () => {
  it('defaults readerTheme to default (the app colours)', () => {
    expect(parseSettings(null).readerTheme).toBe('default');
  });

  it('older settings files without readerTheme pick up the default', () => {
    expect(parseSettings(JSON.stringify({ schemaVersion: 1, theme: 'light' })).readerTheme).toBe('default');
  });

  it('accepts each reader theme', () => {
    for (const t of ['default', 'paper', 'sepia', 'night', 'eink'] as const) {
      expect(parseSettings(JSON.stringify({ readerTheme: t })).readerTheme).toBe(t);
    }
  });

  it('an unknown readerTheme falls back to defaults', () => {
    expect(parseSettings(JSON.stringify({ readerTheme: 'neon' })).readerTheme).toBe('default');
  });

  it('keeps the retired minimap-popout key loadable', () => {
    const s = parseSettings(JSON.stringify({ minimapPopoutInFocusMode: true, openInFocusMode: true }));
    expect(s.minimapPopoutInFocusMode).toBe(true);
    expect(s.openInFocusMode).toBe(true);
  });
});
