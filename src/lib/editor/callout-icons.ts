// Single source of truth for the callout type → icon glyph mapping.
//
// Both the read-mode renderer (markdown-it-callouts.ts) and the editor
// (schema.ts via toDOM, plus callout-node-view.ts for in-editor
// rendering) need this exact same map — keeping it in one place avoids
// drift if we add or rename a callout variant.
//
// Aliases collapse to a canonical visual: `tip` and `hint` both render
// the lightbulb, `warning` / `caution` / `attention` all render the
// triangle, etc. The keys here ARE the markdown markers users type
// (`[!warning]`, `[!hint]`); the renderer lowercases the marker before
// lookup.
export const CALLOUT_ICONS: Record<string, string> = {
  note: 'ℹ',
  info: 'ⓘ',
  tip: '💡',
  hint: '💡',
  success: '✓',
  done: '✓',
  question: '❓',
  help: '❓',
  faq: '❓',
  warning: '⚠',
  caution: '⚠',
  attention: '⚠',
  failure: '✗',
  fail: '✗',
  missing: '✗',
  danger: '⚡',
  error: '⚡',
  bug: '🐛',
  example: '📝',
  quote: '❞',
  cite: '❞',
  abstract: '📋',
  summary: '📋',
  tldr: '📋',
};

// Convenience accessor: returns the icon for `type`, falling back to
// the `note` glyph for unknown types (matching the reader's behaviour).
export function calloutIcon(type: string): string {
  return CALLOUT_ICONS[type] ?? CALLOUT_ICONS.note;
}
