// Every user-facing option, described once. The Settings window renders
// its option cards from this list (so search, sections and the onboarding
// "Customize this layout" step all agree), and each entry names the small
// animated depiction that shows what the option does.

import type { Settings } from './settings-schema';
import { ZOOM_LEVELS } from '../stores/ui';
import { HIGHLIGHT_COLORS, DRAW_COLORS } from '../stores/tool';
import { READER_THEMES, READER_THEME_LABELS } from './reader-themes';

export type SectionId = 'appearance' | 'reading' | 'files' | 'annotations' | 'drawing' | 'updates' | 'about';

export const SECTIONS: Array<{ id: SectionId; title: string }> = [
  { id: 'appearance', title: 'Appearance' },
  { id: 'reading', title: 'Reading' },
  { id: 'files', title: 'Tabs & files' },
  { id: 'annotations', title: 'Annotations' },
  { id: 'drawing', title: 'Drawing' },
  { id: 'updates', title: 'Updates' },
  { id: 'about', title: 'About' },
];

type Key = keyof Settings;

export type Control =
  | { type: 'switch'; key: Key; invert?: boolean }
  | { type: 'segmented'; key: Key; options: Array<{ value: string | number; label: string }> }
  | { type: 'select'; key: Key; options: Array<{ value: string | number; label: string }> }
  | { type: 'slider'; key: Key; min: number; max: number; step: number; format: (v: number) => string }
  | { type: 'swatches'; key: Key; colors: readonly string[] }
  | { type: 'custom'; id: string };

export interface OptionDef {
  id: string;           // DOM id of the control (stable; tests and labels use it)
  section: SectionId;
  title: string;
  description: string;
  depiction: string;    // Depiction.svelte scene name
  control: Control;
  keywords?: string;    // extra search terms
  // Hide the card when this returns false (e.g. options that only apply to
  // one open mode).
  visible?: (s: Settings) => boolean;
  // Grey the card out (still visible) when this returns false.
  enabled?: (s: Settings) => boolean;
  badge?: string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const OPTIONS: OptionDef[] = [
  // Appearance
  {
    id: 'setting-theme', section: 'appearance', title: 'Theme', depiction: 'theme',
    description: 'Dark or light colours for the whole app.',
    control: { type: 'segmented', key: 'theme', options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] },
    keywords: 'colour color dark light mode',
  },
  {
    id: 'setting-splash', section: 'appearance', title: 'Splash screen', depiction: 'splash',
    description: 'Show the animated logo for a moment when remarkdown starts.',
    control: { type: 'switch', key: 'splashEnabled' },
    keywords: 'startup logo animation',
  },
  {
    id: 'setting-watermark', section: 'appearance', title: 'File name watermark', depiction: 'watermark',
    description: "Write the document's name faintly down the left side of the page.",
    control: { type: 'switch', key: 'watermarkEnabled' },
  },
  {
    id: 'setting-watermark-opacity', section: 'appearance', title: 'Watermark strength', depiction: 'watermark-opacity',
    description: 'How visible the file name watermark is.',
    control: { type: 'slider', key: 'watermarkOpacity', min: 0, max: 0.5, step: 0.01, format: pct },
    enabled: (s) => s.watermarkEnabled,
    keywords: 'opacity',
  },

  // Reading
  {
    id: 'setting-zoom', section: 'reading', title: 'Text size', depiction: 'zoom',
    description: 'How large documents open. Ctrl + and Ctrl − change it while reading.',
    control: { type: 'select', key: 'defaultZoom', options: ZOOM_LEVELS.map((z) => ({ value: z, label: pct(z) })) },
    keywords: 'zoom font size',
  },
  {
    id: 'setting-width', section: 'reading', title: 'Page width', depiction: 'width',
    description: 'How wide the column of text is.',
    control: { type: 'slider', key: 'articleWidth', min: 480, max: 1200, step: 20, format: (v) => `${v}px` },
    keywords: 'article column line length',
  },
  {
    id: 'setting-reader-theme', section: 'reading', title: 'Reader mode colours', depiction: 'reader-theme',
    description: "The page's colours while you're in reader mode.",
    control: {
      type: 'segmented', key: 'readerTheme',
      options: READER_THEMES.map((t) => ({ value: t, label: READER_THEME_LABELS[t] })),
    },
    keywords: 'reader theme paper sepia night e-ink eink',
  },
  {
    id: 'setting-smooth-scroll', section: 'reading', title: 'Smooth scrolling', depiction: 'smooth-scroll',
    description: 'Like Microsoft Edge: each turn of the mouse wheel or press of an arrow or Page key sets the page gliding, and it eases to a stop.',
    control: { type: 'switch', key: 'smoothScrolling' },
    keywords: 'smooth scrolling scroll wheel edge animation glide inertia',
  },
  {
    id: 'setting-smooth-scroll-glide', section: 'reading', title: 'Glide', depiction: 'smooth-scroll',
    description: "How long the page keeps gliding. Short is Microsoft Edge's own timing.",
    control: {
      type: 'segmented', key: 'smoothScrollGlide',
      options: [{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'long', label: 'Long' }],
    },
    enabled: (s) => s.smoothScrolling,
    keywords: 'smooth scrolling glide length duration speed inertia',
  },
  {
    id: 'setting-toc-glide', section: 'reading', title: 'Glide to a section from the contents', depiction: 'toc-glide',
    description: 'Picking a heading in the contents glides the page there, instead of jumping.',
    control: { type: 'switch', key: 'tocGlide' },
    keywords: 'table of contents toc glide scroll jump heading section smooth',
  },
  {
    id: 'setting-toc-ink', section: 'reading', title: 'Ink trail to the section', depiction: 'toc-ink',
    description: 'A drop of ink runs from the contents to the heading you picked, and settles under it.',
    control: { type: 'switch', key: 'tocInk' },
    keywords: 'table of contents toc ink animation trail heading goo',
  },
  {
    id: 'setting-reader-nav', section: 'reading', title: 'Section and time left', depiction: 'reader-nav',
    description: 'In reader mode: a quiet line above the page, or the contents beside it with the section you are in marked.',
    control: {
      type: 'segmented', key: 'readerNav',
      options: [{ value: 'top', label: 'Line at the top' }, { value: 'left', label: 'Contents on the left' }],
    },
    keywords: 'reader contents table of contents toc headings sidebar minutes left section',
  },
  {
    id: 'setting-reader-minimap', section: 'reading', title: 'Show the minimap in reader mode', depiction: 'reader-minimap',
    description: 'A small map of the whole document beside the page, showing where you are.',
    control: { type: 'switch', key: 'readerMinimap' },
    keywords: 'reader minimap map overview position',
  },
  {
    id: 'setting-reader-cursor-ink', section: 'reading', title: 'Ink from the pointer', depiction: 'cursor-ink',
    description: 'In reader mode, grey ink from the mouse soaks into the paper and dries away. Leak: rest the mouse and a spot spreads until you move on. Trail: drops along its path. Pen: a fine wet line.',
    control: {
      type: 'segmented', key: 'readerCursorInk',
      options: [{ value: 'leak', label: 'Leak' }, { value: 'trail', label: 'Trail' }, { value: 'pen', label: 'Pen' }, { value: 'off', label: 'Off' }],
    },
    keywords: 'reader mouse cursor pointer ink trail bleed paper animation',
  },
  {
    id: 'setting-open-edit', section: 'reading', title: 'Always open documents ready to edit', depiction: 'edit-mode',
    description: 'Every file opens in edit mode, as if you had pressed Ctrl+E.',
    control: { type: 'switch', key: 'openInEditMode' },
    keywords: 'writer edit mode editor',
  },
  {
    id: 'setting-open-focus', section: 'reading', title: 'Always open documents in reader mode', depiction: 'reader',
    description: 'Every file opens with nothing but the page. Press Esc to leave.',
    control: { type: 'switch', key: 'openInFocusMode' },
    keywords: 'focus distraction free fullscreen',
  },

  // Tabs & files
  {
    id: 'setting-open-mode', section: 'files', title: 'When opening a file', depiction: 'open-mode',
    description: 'For double-clicked files, Open…, recent files and drag-and-drop.',
    control: {
      type: 'segmented', key: 'openMode',
      options: [{ value: 'tabs', label: 'New tab' }, { value: 'replace', label: 'Replace' }, { value: 'windows', label: 'New window' }],
    },
    keywords: 'tabs window replace double-click',
  },
  {
    id: 'setting-tab-position', section: 'files', title: 'Tab position', depiction: 'tab-position',
    description: 'Along the top like a browser, or in a sidebar on the left.',
    control: { type: 'segmented', key: 'tabPosition', options: [{ value: 'top', label: 'Top' }, { value: 'left', label: 'Left' }] },
    visible: (s) => s.openMode === 'tabs',
    keywords: 'tabs sidebar vertical',
  },
  {
    id: 'setting-show-tabs', section: 'files', title: 'Show tabs', depiction: 'show-tabs',
    description: 'Hidden, your documents stay open: Ctrl+Tab still switches between them. Also in the menu, or Ctrl+Shift+B.',
    control: { type: 'switch', key: 'showTabs' },
    visible: (s) => s.openMode === 'tabs',
    keywords: 'tabs hide show tab bar shortcut',
  },
  {
    id: 'setting-hide-single-tab', section: 'files', title: 'Hide the tab bar with only one document open', depiction: 'single-tab',
    description: 'The tabs appear as soon as you open a second document.',
    control: { type: 'switch', key: 'hideSingleTab' },
    visible: (s) => s.openMode === 'tabs',
    enabled: (s) => s.showTabs,
    keywords: 'tabs hide single one document tab bar',
  },
  {
    id: 'setting-tab-sidebar-pinned', section: 'files', title: 'Keep the tab sidebar open', depiction: 'sidebar-pin',
    description: 'Off: the sidebar shrinks to initials and opens when you point at it.',
    control: { type: 'switch', key: 'tabSidebarPinned' },
    visible: (s) => s.openMode === 'tabs' && s.tabPosition === 'left',
    keywords: 'tabs sidebar collapse pin',
  },
  {
    id: 'setting-reopen-tabs', section: 'files', title: 'Reopen tabs from last time', depiction: 'restore',
    description: 'Pick up where you left off: the tabs you had open come back on launch.',
    control: { type: 'switch', key: 'reopenTabsOnLaunch' },
    visible: (s) => s.openMode === 'tabs',
    keywords: 'session restore startup',
  },
  {
    id: 'setting-open-last', section: 'files', title: 'Reopen the last file on launch', depiction: 'restore',
    description: 'Open the document you were reading most recently.',
    control: { type: 'switch', key: 'openLastOnStartup' },
    visible: (s) => s.openMode !== 'tabs',
    keywords: 'startup recent',
  },
  {
    id: 'setting-default-app', section: 'files', title: 'Default app for .md files', depiction: 'default-app',
    description: 'Double-clicking a .md file in Explorer opens it in remarkdown.',
    control: { type: 'custom', id: 'default-app' },
    keywords: 'file association explorer double-click windows',
  },
  {
    id: 'setting-show-welcome', section: 'files', title: 'Welcome document on launch', depiction: 'welcome',
    description: 'Open the short tour of remarkdown when nothing else is opened.',
    control: { type: 'switch', key: 'dontShowWelcomeOnLaunch', invert: true },
    keywords: 'tour intro help',
  },
  {
    id: 'setting-show-tutorial', section: 'files', title: 'Tutorial overlay', depiction: 'tutorial',
    description: 'Show the hand-drawn hints on top of the welcome document.',
    control: { type: 'switch', key: 'welcomeTutorialDismissed', invert: true },
    enabled: (s) => !s.dontShowWelcomeOnLaunch,
    keywords: 'help hints',
  },
  {
    id: 'setting-max-recent', section: 'files', title: 'Recent files to remember', depiction: 'recent',
    description: 'How many files the Open recent list keeps.',
    control: { type: 'slider', key: 'maxRecent', min: 1, max: 50, step: 1, format: (v) => String(v) },
  },
  {
    id: 'setting-save-debounce', section: 'files', title: 'Save delay', depiction: 'autosave',
    description: 'How long remarkdown waits after a change before saving your annotations.',
    control: { type: 'slider', key: 'saveDebounceMs', min: 100, max: 2000, step: 50, format: (v) => `${(v / 1000).toFixed(v < 1000 ? 2 : 1)}s` },
    keywords: 'autosave sidecar',
  },

  // Annotations
  {
    id: 'setting-hide-controls', section: 'annotations', title: 'Annotation tools', depiction: 'tools',
    description: 'Show the highlighter, re.mark and pen tools at the bottom of the window.',
    control: { type: 'switch', key: 'hideAnnotationControls', invert: true },
    keywords: 'tool rail highlight pen',
  },
  {
    id: 'setting-highlight-color', section: 'annotations', title: 'Highlighter colour', depiction: 'highlight-color',
    description: 'The colour a new highlight starts with.',
    control: { type: 'swatches', key: 'defaultHighlightColor', colors: HIGHLIGHT_COLORS },
  },
  {
    id: 'setting-remark-sentences', section: 'annotations', title: 're.mark context', depiction: 're-context',
    description: 'How many sentences around a re.mark are shown in the notes panel.',
    control: { type: 'slider', key: 'remarkContextSentences', min: 1, max: 5, step: 1, format: (v) => `${v} sentence${v === 1 ? '' : 's'}` },
    keywords: 'notes context',
  },
  {
    id: 'setting-remark-stop-paragraph', section: 'annotations', title: 'Keep context within the paragraph', depiction: 're-paragraph',
    description: "Don't pull sentences from the paragraphs before or after.",
    control: { type: 'switch', key: 'remarkContextStopAtParagraph' },
  },
  {
    id: 'setting-remark-stop-listitem', section: 'annotations', title: 'Keep context within the bullet', depiction: 're-listitem',
    description: 'A re.mark in a list shows only its own bullet point.',
    control: { type: 'switch', key: 'remarkContextStopAtListItem' },
  },
  {
    id: 'setting-marginalia', section: 'annotations', title: 'Margin notes', depiction: 'marginalia',
    description: 'Show re.marks as cards in the right margin, next to what they are about (in windows at least 1000 pixels wide).',
    control: { type: 'switch', key: 'marginaliaEnabled' },
    keywords: 'marginalia cards',
  },

  // Drawing
  {
    id: 'setting-ink-color', section: 'drawing', title: 'Pen colour', depiction: 'ink-color',
    description: 'The colour the pen starts with.',
    control: { type: 'swatches', key: 'defaultInkColor', colors: DRAW_COLORS },
    keywords: 'ink draw',
  },
  {
    id: 'setting-auto-transform', section: 'drawing', title: 'Tidy up shapes', depiction: 'shapes',
    description: 'Turn rough circles, boxes, underlines, arrows and brackets into clean shapes.',
    control: { type: 'switch', key: 'autoTransformDrawings' },
    keywords: 'recognize recognise circle rectangle underline arrow bracket',
  },
  {
    id: 'setting-drawing-roughness', section: 'drawing', title: 'Hand-drawn look', depiction: 'roughness',
    description: 'From clean lines to sketchy, pencil-like strokes.',
    control: { type: 'slider', key: 'drawingRoughness', min: 0, max: 3, step: 0.1, format: (v) => (v < 0.5 ? 'Clean' : v < 1.8 ? 'Sketchy' : 'Very sketchy') },
    keywords: 'roughness',
  },
  {
    id: 'setting-draw-idle', section: 'drawing', title: 'Finish a drawing after', depiction: 'draw-idle',
    description: 'How long the pen waits before treating your strokes as one drawing.',
    control: { type: 'slider', key: 'drawIdleFinalizeMs', min: 500, max: 15000, step: 500, format: (v) => `${(v / 1000).toFixed(1)}s` },
  },
  {
    id: 'setting-drawing-confidence', section: 'drawing', title: 'Show shape confidence', depiction: 'confidence',
    description: 'Display how sure remarkdown is about each recognised shape.',
    control: { type: 'switch', key: 'showDrawingRecognitionConfidence' },
    keywords: 'developer debug',
  },

  // Updates
  {
    id: 'setting-auto-update', section: 'updates', title: 'Check for updates on launch', depiction: 'updates',
    description: "Look for a new version quietly when remarkdown starts. Nothing installs without asking.",
    control: { type: 'switch', key: 'autoCheckForUpdates' },
  },
  {
    id: 'setting-prerelease', section: 'updates', title: 'Show beta releases', depiction: 'prerelease',
    description: "Include beta and release-candidate notes in the update window.",
    control: { type: 'switch', key: 'receivePrereleaseUpdates' },
    keywords: 'beta rc pre-release',
  },
];

// Case-insensitive match on title, description and keywords.
export function searchOptions(query: string, options: OptionDef[] = OPTIONS): OptionDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const words = q.split(/\s+/);
  return options.filter((o) => {
    const hay = `${o.title} ${o.description} ${o.keywords ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
