import { describe, it, expect } from 'vitest';
import {
  READER_THEMES,
  READER_THEME_LABELS,
  readerThemeTone,
  diagramThemeFor,
} from '../../src/lib/reader-themes';

describe('reader themes', () => {
  it('offers the six themes, default first', () => {
    expect(READER_THEMES).toEqual(['default', 'paper', 'textured', 'sepia', 'night', 'eink']);
    expect(READER_THEMES.map((t) => READER_THEME_LABELS[t])).toEqual([
      'Default', 'Paper', 'Textured', 'Sepia', 'Night', 'E-ink',
    ]);
  });

  it('default follows the app theme; the others have a fixed tone', () => {
    expect(readerThemeTone('default', 'dark')).toBe('dark');
    expect(readerThemeTone('default', 'light')).toBe('light');
    for (const t of ['paper', 'textured', 'sepia', 'eink'] as const) {
      expect(readerThemeTone(t, 'dark')).toBe('light');
      expect(readerThemeTone(t, 'light')).toBe('light');
    }
    expect(readerThemeTone('night', 'light')).toBe('dark');
    expect(readerThemeTone('night', 'dark')).toBe('dark');
  });

  it('diagrams follow the app theme outside reader mode', () => {
    expect(diagramThemeFor('dark', false, 'paper')).toBe('dark');
    expect(diagramThemeFor('light', false, 'night')).toBe('light');
  });

  it('diagrams follow the reader theme in reader mode', () => {
    expect(diagramThemeFor('dark', true, 'paper')).toBe('light');
    expect(diagramThemeFor('dark', true, 'sepia')).toBe('light');
    expect(diagramThemeFor('dark', true, 'eink')).toBe('light');
    expect(diagramThemeFor('light', true, 'night')).toBe('dark');
    expect(diagramThemeFor('dark', true, 'default')).toBe('dark');
    expect(diagramThemeFor('light', true, 'default')).toBe('light');
  });
});
