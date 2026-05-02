import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { calloutIcon } from './editor/callout-icons';

// Matches [!TYPE], [!TYPE]+, [!TYPE]-, optionally followed by a title.
const CALLOUT_RE = /^\[!(\w+)\]([+-]?)(.*)$/;

function findMatchingOpen(tokens: Token[], closeIdx: number): Token | null {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    if (tokens[i].type === 'blockquote_close') depth += 1;
    if (tokens[i].type === 'blockquote_open') {
      depth -= 1;
      if (depth === 0) return tokens[i];
    }
  }
  return null;
}

export function calloutsPlugin(md: MarkdownIt): void {
  // Core rule: detect callout pattern in blockquotes and mark open tokens.
  md.core.ruler.after('block', 'callouts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;

      // Look for the first inline token directly inside this blockquote.
      // Pattern: blockquote_open, paragraph_open, inline, ...
      const para = tokens[i + 1];
      const inline = tokens[i + 2];
      if (para?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;

      // Examine the first line of inline content.
      const firstLine = (inline.content.split('\n')[0] ?? '').trim();
      const m = firstLine.match(CALLOUT_RE);
      if (!m) continue;

      const type = m[1].toLowerCase();
      const fold = m[2]; // '+', '-', or ''
      const rawTitle = m[3].trim();
      // Store ONLY the user-explicit title here. When the user wrote
      // `> [!note]` (no title text), data-title stays empty and the
      // renderer / NodeView fall back to the auto-derived display
      // title. The serializer round-trip relies on this distinction:
      // an empty data-title means "user didn't write one", a non-empty
      // value means "the user typed exactly this and we must preserve
      // it" — even when the typed title happens to equal the default
      // (`> [!note] Note`).
      tokens[i].attrSet('data-callout', type);
      tokens[i].attrSet('data-fold', fold === '+' ? 'open' : fold === '-' ? 'closed' : '');
      tokens[i].attrSet('data-title', rawTitle);
      (tokens[i] as Token & { meta: unknown }).meta = { callout: true };

      // Strip the marker line from the inline token's content so it doesn't appear in body.
      const lines = inline.content.split('\n');
      inline.content = lines.slice(1).join('\n');
      // Reset children to empty so the inline core rule re-parses the updated content.
      inline.children = [];
    }
    return false;
  });

  // Override blockquote rendering to emit callout HTML when the token is marked.
  // renderToken(tokens, idx, options) — 3 args; `self` is not a parameter.
  const originalRenderToken = md.renderer.renderToken.bind(md.renderer);

  md.renderer.rules.blockquote_open = (tokens, idx, opts, _env) => {
    const t = tokens[idx];
    const meta = (t as Token & { meta: unknown }).meta as { callout?: boolean } | null;
    if (!meta?.callout) return originalRenderToken(tokens, idx, opts);

    const type = t.attrGet('data-callout') ?? 'note';
    const fold = t.attrGet('data-fold') ?? '';
    const explicitTitle = t.attrGet('data-title') ?? '';
    // data-title is empty when the user didn't type one — fall back to
    // a Capitalised version of the type for display only (kept out of
    // the serialized markdown so we don't drift on round-trip).
    const title =
      explicitTitle || type.charAt(0).toUpperCase() + type.slice(1);
    const icon = calloutIcon(type);
    const foldable = fold !== '';
    const startsClosed = fold === 'closed';

    const foldBtn = foldable
      ? `<button type="button" class="callout-fold" aria-label="${startsClosed ? 'Expand' : 'Collapse'}">${startsClosed ? '▸' : '▾'}</button>`
      : '';

    const headerHtml =
      `<div class="callout-header"${foldable ? ' data-foldable="1"' : ''}>` +
      `<span class="callout-icon" aria-hidden="true">${icon}</span>` +
      `<span class="callout-title">${md.utils.escapeHtml(title)}</span>` +
      foldBtn +
      `</div>` +
      `<div class="callout-body"${startsClosed ? ' hidden' : ''}>`;

    return (
      `<div class="callout callout-${md.utils.escapeHtml(type)}" data-callout="${md.utils.escapeHtml(type)}">` +
      headerHtml
    );
  };

  md.renderer.rules.blockquote_close = (tokens, idx, opts, _env) => {
    const openToken = findMatchingOpen(tokens, idx);
    const meta = openToken ? (openToken as Token & { meta: unknown }).meta as { callout?: boolean } | null : null;
    if (!meta?.callout) return originalRenderToken(tokens, idx, opts);
    return `</div></div>\n`;
  };
}
