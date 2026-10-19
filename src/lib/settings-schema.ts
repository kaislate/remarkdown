import { z } from 'zod';
import { ZOOM_LEVELS } from '../stores/ui';
import { HIGHLIGHT_COLORS, DRAW_COLORS } from '../stores/tool';
import { READER_THEMES } from './reader-themes';

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
  // "Always open documents in reader mode" (the key predates the rename).
  openInFocusMode: z.boolean(),
  // Open documents straight into edit mode (the "Writer" starting layout).
  openInEditMode: z.boolean(),
  // Retired: reader mode has no minimap at all now. Kept so settings files
  // that carry it still load; nothing reads it.
  minimapPopoutInFocusMode: z.boolean(),
  // Reader mode's page colours (styles/reader-mode.css). 'default' keeps the
  // app's own colours.
  readerTheme: z.enum(READER_THEMES),
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

  // Right-margin marginalia column for re.marks (prototype).
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
  openInFocusMode: false,
  openInEditMode: false,
  minimapPopoutInFocusMode: false,
  readerTheme: 'default',
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
