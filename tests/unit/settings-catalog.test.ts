import { describe, it, expect } from 'vitest';
import { OPTIONS, SECTIONS, searchOptions } from '../../src/lib/settings-catalog';
import { SettingsSchema, DEFAULT_SETTINGS } from '../../src/lib/settings-schema';

describe('settings catalog', () => {
  it('every option has a unique control id and a known section', () => {
    const ids = OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = new Set(SECTIONS.map((s) => s.id));
    for (const o of OPTIONS) expect(sections.has(o.section)).toBe(true);
  });

  it('every option controls a real setting', () => {
    const keys = Object.keys(SettingsSchema.shape);
    for (const o of OPTIONS) {
      if (o.control.type === 'custom') continue;
      expect(keys, o.id).toContain(o.control.key);
    }
  });

  it('every user-facing setting has a card (except internal ones)', () => {
    const internal = new Set(['schemaVersion', 'minimapPopoutInFocusMode', 'onboardingCompleted']);
    const covered = new Set(OPTIONS.flatMap((o) => (o.control.type === 'custom' ? [] : [o.control.key])));
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (internal.has(key)) continue;
      expect(covered.has(key as never), `no card for ${key}`).toBe(true);
    }
  });

  it('copy is plain words: no "markdown", "sidecar" or "focus mode" in titles', () => {
    for (const o of OPTIONS) {
      expect(o.title).not.toMatch(/sidecar|focus mode|markdown/i);
      expect(o.description).not.toMatch(/sidecar|json|focus mode/i);
    }
  });

  it('search matches titles, descriptions and keywords, all words required', () => {
    expect(searchOptions('zoom').map((o) => o.id)).toEqual(['setting-zoom']);
    expect(searchOptions('reader mode').map((o) => o.id)).toContain('setting-open-focus');
    expect(searchOptions('pen colour').map((o) => o.id)).toEqual(['setting-ink-color']);
    expect(searchOptions('  ')).toHaveLength(OPTIONS.length);
    expect(searchOptions('nothing-matches-this')).toEqual([]);
  });

  it('mode-specific options show only in their mode', () => {
    const reopen = OPTIONS.find((o) => o.id === 'setting-reopen-tabs')!;
    const last = OPTIONS.find((o) => o.id === 'setting-open-last')!;
    expect(reopen.visible!({ ...DEFAULT_SETTINGS, openMode: 'tabs' })).toBe(true);
    expect(last.visible!({ ...DEFAULT_SETTINGS, openMode: 'tabs' })).toBe(false);
    expect(last.visible!({ ...DEFAULT_SETTINGS, openMode: 'replace' })).toBe(true);
  });
});
