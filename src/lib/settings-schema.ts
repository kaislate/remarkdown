import { z } from 'zod';
import { ZOOM_LEVELS } from '../stores/ui';
import { HIGHLIGHT_COLORS, DRAW_COLORS } from '../stores/tool';

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
  dontShowWelcomeOnLaunch: z.boolean(),
  welcomeTutorialDismissed: z.boolean(),
  hideAnnotationControls: z.boolean(),

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

  // Save / annotation timing
  saveDebounceMs: z.number().int().min(100).max(5000),
  drawIdleFinalizeMs: z.number().int().min(500).max(15000),
});

export type Settings = z.infer<typeof SettingsSchema>;

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
  dontShowWelcomeOnLaunch: false,
  welcomeTutorialDismissed: false,
  hideAnnotationControls: false,
  defaultHighlightColor: HIGHLIGHT_COLORS[0],
  defaultInkColor: DRAW_COLORS[0],
  saveDebounceMs: 500,
  drawIdleFinalizeMs: 3000,
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
