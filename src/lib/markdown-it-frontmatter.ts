// Front matter: the block of `key: value` settings some markdown files
// start with, between two `---` lines (closed by `---` or `...`):
//
//   ---
//   title: Field notes
//   tags: [reading, notes]
//   ---
//
// Without this rule markdown-it reads it as a horizontal rule and a
// heading. This turns it into one `front_matter` token carrying the text
// exactly as written, so the reader can show it quietly (as "Document
// details") and the editor can keep it byte for byte. Only at the very
// start of the document, and only when it looks like settings (at least
// one `key:` line) — a document that merely opens with a rule is left
// alone.

import type MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';

const KEY_LINE = /^[A-Za-z0-9_][\w .-]*:(\s|$)/;

function frontMatter(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (startLine !== 0 || state.blkIndent !== 0 || state.tShift[0] !== 0) return false;
  const lineText = (n: number) => state.src.slice(state.bMarks[n], state.eMarks[n]);
  if (lineText(0).trimEnd() !== '---') return false;
  let close = 1;
  let keys = 0;
  for (; close < endLine; close++) {
    const l = lineText(close).trimEnd();
    if (l === '---' || l === '...') break;
    if (KEY_LINE.test(l)) keys++;
  }
  if (close >= endLine || keys === 0) return false;
  if (silent) return true;
  const token = state.push('front_matter', '', 0);
  token.block = true;
  token.map = [0, close + 1];
  token.markup = lineText(close).trimEnd();
  // The settings exactly as written, lines and final newline included.
  token.content = state.src.slice(state.bMarks[1], state.bMarks[close]);
  state.line = close + 1;
  return true;
}

// The top-level `key: value` pairs, for showing (nested values, lists
// and anything unusual come through as their text).
export function frontMatterFields(content: string): Array<{ key: string; value: string }> {
  const fields: Array<{ key: string; value: string }> = [];
  for (const line of content.split('\n')) {
    const m = /^([A-Za-z0-9_][\w .-]*):\s*(.*)$/.exec(line);
    if (m) {
      fields.push({ key: m[1].trim(), value: m[2].trim().replace(/^(["'])(.*)\1$/, '$2') });
    } else if (fields.length && line.trim()) {
      // A continuation (a list item, a nested key): add it to the last value.
      const last = fields[fields.length - 1];
      const item = line.trim().replace(/^-\s+/, '');
      last.value = last.value ? `${last.value}, ${item}` : item;
    }
  }
  return fields;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function frontMatterPlugin(md: MarkdownIt): void {
  md.block.ruler.before('table', 'front_matter', frontMatter);
  // Shown folded away, as "Document details".
  md.renderer.rules.front_matter = (tokens, idx) => {
    const rows = frontMatterFields(tokens[idx].content)
      .map((f) => `<dt>${escapeHtml(f.key)}</dt><dd>${escapeHtml(f.value)}</dd>`)
      .join('');
    return `<details class="front-matter"><summary>Document details</summary><dl>${rows}</dl></details>\n`;
  };
}
