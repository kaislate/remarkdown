import { z } from 'zod';
import { ZOOM_LEVELS } from '../stores/ui';
import { HIGHLIGHT_COLORS, DRAW_COLORS } from '../stores/tool';
import { READER_THEMES } from './reader-themes';
import { CURSOR_INK_STYLES } from './cursor-ink';

// Schema version is incremented when an incompatible change is made to the
// shape so a future loader can branch on it. Today the only version is 1.
export const SETTINGS_SCHEMA_VERSION = 1;

export const SettingsSchema = z.object({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),

  // Appearance
  theme: z.enum(['dark', 'light']),
  splashEnabled: z.boolean(),
  watermarkEnabled: z.boolean(),
  watermarkOpacity: z.number().min(0).max(0.5),

  // Reading
  defaultZoom: z
    .number()
    .refine((v) => (ZOOM_LEVELS as readonly number[]).includes(v), {
      message: 'defaultZoom must be one of the predefined ZOOM_LEVELS',
    }),
  articleWidth: z.number().int().min(480).max(1200),
  maxRecent: z.number().int().min(1).max(50),
  openLastOnStartup: z.boolean(),
  // How files open (double-click, Open…, recents, drag-and-drop): as tabs
  // in this window, replacing the current document, or in a new window.
  openMode: z.enum(['tabs', 'replace', 'windows']),
  // Tabs mode only: restore the previous session's tabs on launch.
  reopenTabsOnLaunch: z.boolean(),
  // Tabs along the top of the window, or as a sidebar on the left. The
  // sidebar either stays open (pinned) or shrinks to initials until hovered.
  tabPosition: z.enum(['top', 'left']),
  tabSidebarPinned: z.boolean(),
  // Show the tabs at all (menu → Hide tabs / Ctrl+Shift+B). Hidden, the
  // documents stay open and Ctrl+Tab still switches between them.
  showTabs: z.boolean(),
  // Hide the tab bar while only one document is open.
  hideSingleTab: z.boolean(),
  // "Always open documents in reader mode" (the key predates the rename).
  openInFocusMode: z.boolean(),
  // Open documents straight into edit mode (the "Writer" starting layout).
  openInEditMode: z.boolean(),
  // Retired: an old reader-mode minimap option (see readerMinimap). Kept so
  // settings files that carry it still load; nothing reads it.
  minimapPopoutInFocusMode: z.boolean(),
  // Reader mode's page colours (styles/reader-mode.css). 'default' keeps the
  // app's own colours.
  readerTheme: z.enum(READER_THEMES),
  // Show the minimap in reader mode too (beside the column, in the reader
  // theme's colours).
  readerMinimap: z.boolean(),
  // Where reader mode shows your place: the line at the top ("Chapter 3 ·
  // 6 min left") or a contents list on the left.
  readerNav: z.enum(['top', 'left']),
  // Grey ink from the mouse in reader mode, and in which style
  // (lib/cursor-ink.ts): a spot leaking while it rests, a trail of drops,
  // a fine pen line — or none.
  readerCursorInk: z.enum(CURSOR_INK_STYLES),
  // Edge-style smooth scrolling for the mouse wheel and keys
  // (lib/smooth-scroll.ts).
  smoothScrolling: z.boolean(),
  // How long a smooth-scroll glide lasts: Edge's own timing, 2× or 3×.
  smoothScrollGlide: z.enum(['short', 'medium', 'long']),
  // Picking a heading from the contents glides there (else it jumps)…
  tocGlide: z.boolean(),
  // …and a drop of ink runs from the contents to the heading.
  tocInk: z.boolean(),
  dontShowWelcomeOnLaunch: z.boolean(),
  welcomeTutorialDismissed: z.boolean(),
  hideAnnotationControls: z.boolean(),
  autoCheckForUpdates: z.boolean(),
  receivePrereleaseUpdates: z.boolean(),

  // Annotation
  defaultHighlightColor: z
    .string()
    .refine((c) => (HIGHLIGHT_COLORS as readonly string[]).includes(c), {
      message: 'defaultHighlightColor must be one of HIGHLIGHT_COLORS',
    }),
  defaultInkColor: z
    .string()
    .refine((c) => (DRAW_COLORS as readonly string[]).includes(c), {
      message: 'defaultInkColor must be one of DRAW_COLORS',
    }),
  showDrawingRecognitionConfidence: z.boolean(),
  autoTransformDrawings: z.boolean(),
  drawingRoughness: z.number().min(0).max(3),

  // Save / annotation timing
  saveDebounceMs: z.number().int().min(100).max(5000),
  drawIdleFinalizeMs: z.number().int().min(500).max(15000),

  // re.marks panel — how much context to show with each entry.
  remarkContextSentences: z.number().int().min(1).max(5),
  remarkContextStopAtParagraph: z.boolean(),
  remarkContextStopAtListItem: z.boolean(),

  // re.marks as cards in the right margin (MarginaliaColumn.svelte).
  marginaliaEnabled: z.boolean(),

  // First-run "How do you want to use remarkdown?" has been answered.
  onboardingCompleted: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type OpenMode = Settings['openMode'];
export type TabPosition = Settings['tabPosition'];

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  theme: 'dark',
  splashEnabled: true,
  watermarkEnabled: true,
  watermarkOpacity: 0.08,
  defaultZoom: 1.0,
  articleWidth: 720,
  maxRecent: 10,
  openLastOnStartup: false,
  openMode: 'tabs',
  reopenTabsOnLaunch: true,
  tabPosition: 'top',
  tabSidebarPinned: true,
  showTabs: true,
  hideSingleTab: false,
  openInFocusMode: false,
  openInEditMode: false,
  minimapPopoutInFocusMode: false,
  readerTheme: 'default',
  readerMinimap: true,
  readerNav: 'left',
  readerCursorInk: 'leak',
  smoothScrolling: true,
  smoothScrollGlide: 'medium',
  tocGlide: true,
  tocInk: true,
  dontShowWelcomeOnLaunch: false,
  welcomeTutorialDismissed: false,
  hideAnnotationControls: false,
  autoCheckForUpdates: true,
  receivePrereleaseUpdates: false,
  defaultHighlightColor: HIGHLIGHT_COLORS[0],
  defaultInkColor: DRAW_COLORS[0],
  showDrawingRecognitionConfidence: false,
  autoTransformDrawings: false,
  drawingRoughness: 1.4,
  saveDebounceMs: 500,
  drawIdleFinalizeMs: 3000,
  remarkContextSentences: 1,
  remarkContextStopAtParagraph: true,
  remarkContextStopAtListItem: true,
  marginaliaEnabled: false,
  onboardingCompleted: false,
};

// Parse a JSON string from disk, falling back to defaults for any field that's
// missing, unknown, or fails validation. We deep-merge over defaults so older
// versions of settings.json still load — they simply pick up new defaults for
// any newly-introduced fields.
export function parseSettings(raw: string | null): Settings {
  if (raw == null) return DEFAULT_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (parsed == null || typeof parsed !== 'object') return DEFAULT_SETTINGS;

  const merged = { ...DEFAULT_SETTINGS, ...(parsed as Record<string, unknown>) };
  // Force the schema version to the current one — this is what makes
  // forward-compatible loads possible. If the stored version was older we
  // treat any missing fields as defaults; if it was newer we still attempt to
  // read the known keys.
  merged.schemaVersion = SETTINGS_SCHEMA_VERSION;

  const result = SettingsSchema.safeParse(merged);
  if (result.success) return result.data;
  return DEFAULT_SETTINGS;
}
