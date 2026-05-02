// markdown-it core rule that detects GitHub-flavored task list markers
// (`[ ]` / `[x]`) at the start of a list item's inline content. We DO
// NOT use the standard `markdown-it-task-lists` package here because
// that plugin emits a literal <input> token into the rendered HTML —
// the editor's parser would have to filter it out, and the editor's
// NodeView re-renders the checkbox itself. By keeping detection
// metadata-only (set an attribute on `list_item_open`, strip the
// marker from inline text) we avoid the round-trip headache and stay
// symmetric with markdown-it-callouts.
//
// The reader (MarkdownRenderer.ts) keeps its own use of the standard
// task-lists plugin for HTML output.
import type MarkdownIt from 'markdown-it';

// Matches `[ ]` or `[x]` (case-insensitive) at the start of inline
// content, optionally preceded by whitespace, with at least one
// trailing whitespace before the rest of the content.
const TASK_RE = /^\s*\[([ xX])\]\s+/;

export function tasksPlugin(md: MarkdownIt): void {
  md.core.ruler.after('block', 'tasks', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== 'list_item_open') continue;
      const para = tokens[i + 1];
      const inline = tokens[i + 2];
      if (para?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;

      const m = TASK_RE.exec(inline.content);
      if (!m) continue;

      const checked = m[1].toLowerCase() === 'x';
      tokens[i].attrSet('data-task-state', checked ? 'checked' : 'unchecked');

      // Strip the marker from the inline content and clear children so
      // the inline core rule re-parses the trimmed text on its next pass.
      inline.content = inline.content.substring(m[0].length);
      inline.children = [];
    }
    return false;
  });
}
