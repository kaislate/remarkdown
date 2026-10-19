// Reader-mode colour themes. The palettes themselves live in
// styles/reader-mode.css as tokens under body.reader-mode[data-reader-theme];
// this module only knows each theme's name, its label in Settings, and
// whether it is a light or a dark page — which decides how diagrams are
// drawn (mermaid has a light and a dark theme, see mermaid-runtime.ts).
import type { AppTheme } from './mermaid-runtime';

export const READER_THEMES = ['default', 'paper', 'sepia', 'night', 'eink'] as const;
export type ReaderTheme = (typeof READER_THEMES)[number];

export const READER_THEME_LABELS: Record<ReaderTheme, string> = {
  default: 'Default',
  paper: 'Paper',
  sepia: 'Sepia',
  night: 'Night',
  eink: 'E-ink',
};

// Page and ink colours for the small pictures of each theme (Settings and
// the first-run layout picker) — the same values as reader-mode.css.
// 'default' follows the app's own tokens.
export const READER_THEME_SWATCHES: Record<ReaderTheme, { page: string; ink: string; accent: string }> = {
  default: { page: 'var(--bg-0)', ink: 'var(--fg-1)', accent: 'var(--accent)' },
  paper: { page: '#fbf9f4', ink: '#3d3a33', accent: '#5b51c8' },
  sepia: { page: '#f3e7cf', ink: '#4f4130', accent: '#8a5524' },
  night: { page: '#121417', ink: '#a9a59c', accent: '#c9a25e' },
  eink: { page: '#f2f2f0', ink: '#222222', accent: '#111111' },
};

// 'default' keeps the app's own colours, so it is whatever the app is.
export function readerThemeTone(theme: ReaderTheme, app: AppTheme): AppTheme {
  if (theme === 'default') return app;
  return theme === 'night' ? 'dark' : 'light';
}

// The theme diagrams are drawn for right now.
export function diagramThemeFor(app: AppTheme, readerMode: boolean, theme: ReaderTheme): AppTheme {
  return readerMode ? readerThemeTone(theme, app) : app;
}
