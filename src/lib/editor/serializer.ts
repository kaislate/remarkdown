// Custom MarkdownSerializer for the editor. Extends prosemirror-markdown's
// default node serializers with `callout`, emitting:
//
//   > [!type][fold] [optional title]
//   > body line 1
//   > body line 2
//
// Marks all default to prosemirror-markdown's behaviour. Future sub-
// phases (code blocks, tables, etc.) extend the nodes record here.
//
// Note: indented code blocks (4-space-leading-indent) are intentionally
// upgraded to fenced code blocks on round-trip. This is by design per
// the product framing ("a markdown editor for people who don't know
// markdown") — fenced fences are visually clearer and unambiguous about
// language. Future contributors: this is NOT a bug to "fix".

import { defaultMarkdownSerializer, MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node, NodeType } from 'prosemirror-model';
import { MarkdownSerializerStateImpl } from './serializer-internals';
import type { MarkdownSerializerStateInternals } from './serializer-internals';

// Composes the [!type][fold] title line that opens a callout block.
function calloutHeader(node: Node): string {
  const type = String(node.attrs.type || 'note');
  const fold = String(node.attrs.fold || '');
  const title = String(node.attrs.title || '');
  // attrs.title only contains the user-explicit title (the parser keeps
  // it empty when the user didn't write one). So we can safely emit
  // ANY non-empty title, including ones that happen to equal the
  // capitalized type — `> [!note] Note` round-trips intact.
  const titlePart = title ? ` ${title}` : '';
  return `[!${type}]${fold}${titlePart}`;
}

const callout = (state: MarkdownSerializerState, node: Node) => {
  // Use wrapBlock so every rendered line automatically gets the `> ` prefix
  // (via state.delim). The `firstDelim` is the full `> [!type][fold][title]`
  // opening line; wrapBlock passes it to `write()` which handles flushClose
  // and delimiter flushing correctly before we enter the content render.
  state.wrapBlock('> ', `> ${calloutHeader(node)}\n`, node, () =>
    state.renderContent(node),
  );
};

const code_block = (state: MarkdownSerializerState, node: Node) => {
  const lang = String(node.attrs.language || '');
  // Pick a fence length one longer than the longest run of backticks in
  // the body, with a 3-tick floor (CommonMark minimum). Without this a
  // user who writes markdown-about-markdown would see their fence "swallow"
  // the inner content's literal triple-backticks on round-trip.
  const text = node.textContent;
  const longestRun = (text.match(/`+/g) ?? []).reduce(
    (m, run) => Math.max(m, run.length),
    0,
  );
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  state.write(fence + lang + '\n');
  state.text(text, false); // false = don't escape markdown chars
  // Ensure the closing fence sits on its own line. wrapBlock-friendly.
  state.ensureNewLine();
  state.write(fence);
  state.closeBlock(node);
};

const list_item = (state: MarkdownSerializerState, node: Node) => {
  const checked = node.attrs.checked;
  if (checked === true) {
    state.write('[x] ');
  } else if (checked === false) {
    state.write('[ ] ');
  }
  // Default behavior: just render the children. The bullet (`*`) is
  // emitted by the parent bullet_list's renderList; our optional
  // `[ ] ` / `[x] ` lands AFTER that bullet on the same line because
  // state.write doesn't insert a newline.
  state.renderContent(node);
};

// GFM table emitter. We don't lean on default per-row/per-cell renderers
// because the layout is two-dimensional: column widths depend on every
// row's contents, and the separator row sits between row 0 and row 1
// regardless of any individual node's own callbacks. So we walk the
// table once, materialize a string matrix, then render it whole.
const table = (state: MarkdownSerializerState, node: Node) => {
  const matrix: string[][] = [];
  const isHeader: boolean[] = [];
  node.forEach((row) => {
    const rowCells: string[] = [];
    let allHeader = true;
    row.forEach((cell) => {
      // Render each cell to its own buffer via a fresh sub-state. Cells
      // are inline-only per the schema (Task 1), so renderInline is the
      // right entry point — it produces the raw markdown for the cell's
      // children without touching block-level delimiters or `state.out`.
      const parentInternals = state as MarkdownSerializerStateInternals;
      const sub = new MarkdownSerializerStateImpl(
        parentInternals.nodes,
        parentInternals.marks,
        state.options,
      );
      sub.renderInline(cell);
      rowCells.push(sub.out.trim());
      if (cell.type.name !== 'table_header') allHeader = false;
    });
    matrix.push(rowCells);
    isHeader.push(allHeader);
  });

  if (matrix.length === 0) return;
  const colCount = Math.max(...matrix.map((r) => r.length));
  // Pad each row to colCount so the matrix is rectangular.
  for (const r of matrix) while (r.length < colCount) r.push('');
  // Per-column width = max of every cell's rendered length in that
  // column, floored at 3 so the separator row always has at least
  // `---` (some markdown parsers require ≥3 dashes; markdown-it
  // accepts shorter, but 3 is the de-facto convention). Content rows
  // pad with trailing spaces to the column width so the output reads
  // as a clean rectangle. GFM strips this padding on parse, so the
  // round-trip property still holds.
  const widths: number[] = new Array(colCount).fill(3);
  for (const r of matrix) {
    for (let c = 0; c < colCount; c++) {
      if (r[c].length > widths[c]) widths[c] = r[c].length;
    }
  }
  const renderRow = (r: string[]) =>
    '| ' + r.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  const sepRow =
    '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |';

  // GFM requires a header row. If row 0 is all table_header cells, use
  // it; otherwise emit an empty header row so the body stays well-formed.
  const out: string[] = [];
  if (isHeader[0]) {
    out.push(renderRow(matrix[0]));
    out.push(sepRow);
    for (let i = 1; i < matrix.length; i++) out.push(renderRow(matrix[i]));
  } else {
    out.push(renderRow(new Array(colCount).fill('')));
    out.push(sepRow);
    for (let i = 0; i < matrix.length; i++) out.push(renderRow(matrix[i]));
  }
  state.write(out.join('\n'));
  state.closeBlock(node);
};

// Row/cell/header serializers exist so MarkdownSerializer doesn't throw
// "no serializer for X" while validating the schema's node types — but
// they're never directly invoked because the `table` serializer above
// performs the entire walk itself.
const table_row = (_state: MarkdownSerializerState, _node: Node) => {};
const table_cell = (_state: MarkdownSerializerState, _node: Node) => {};
const table_header = (_state: MarkdownSerializerState, _node: Node) => {};

// Footnote inline atom — emits `[^label]` at the reference site. The
// definition body is appended to the doc tail by serializeDocToMarkdown
// below (NOT here), since the def can't be inserted at the reference
// position in the markdown stream.
const footnote = (state: MarkdownSerializerState, node: Node) => {
  const label = String(node.attrs.label || '');
  state.write(`[^${label}]`);
};

// Maths and front matter go back out exactly as they came in: their text
// is written raw, never escaped.
// An empty formula (inserted, then left empty) isn't written: `$$` would
// read back as the start of a formula block.
const math_inline = (state: MarkdownSerializerState, node: Node) => {
  if (!String(node.attrs.tex).trim()) return;
  const fence = node.attrs.display ? '$$' : '$';
  state.write(fence + String(node.attrs.tex) + fence);
};

const math_block = (state: MarkdownSerializerState, node: Node) => {
  const tex = String(node.attrs.tex);
  if (!tex.trim()) return;
  if (node.attrs.oneLine && !tex.includes('\n')) {
    state.write(`$$${tex}$$`);
  } else {
    // Line by line, so a formula inside a quote or a list keeps its prefix.
    state.write('$$');
    state.ensureNewLine();
    state.text(tex, false);
    state.ensureNewLine();
    state.write('$$');
  }
  state.closeBlock(node);
};

const front_matter = (state: MarkdownSerializerState, node: Node) => {
  state.write('---');
  state.ensureNewLine();
  // content ends with its own newline; text() would write it as a blank line.
  state.text(String(node.attrs.content).replace(/\n$/, ''), false);
  state.ensureNewLine();
  state.write(String(node.attrs.close || '---'));
  state.closeBlock(node);
};

const editorMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    callout,
    math_inline,
    math_block,
    front_matter,
    code_block,
    footnote,
    list_item,
    table,
    table_row,
    table_cell,
    table_header,
  },
  {
    ...defaultMarkdownSerializer.marks,
    // Strikethrough mark — `~~text~~`. `mixable: true` lets it overlap
    // cleanly with **bold** / *italic*; `expelEnclosingWhitespace`
    // pushes leading/trailing whitespace OUTSIDE the marker so we
    // don't emit `~~ text ~~` (invalid GFM).
    strike: {
      open: '~~',
      close: '~~',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    // Subscript — `~text~` (markdown-it-sub). Single tilde, distinct
    // from strike's double-tilde. mixable + expelEnclosingWhitespace
    // for the same reasons strike sets them.
    sub: {
      open: '~',
      close: '~',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    // Superscript — `^text^` (markdown-it-sup).
    sup: {
      open: '^',
      close: '^',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
  },
);

// ── Per-block serializing ─────────────────────────────────────────────
//
// prosemirror-markdown builds its output by appending to one string and
// looking at that string's tail before every block (atBlank), which copies
// the whole output each time: quadratic, so a 2 MB document took seconds
// and froze the editor. Here each top-level block is rendered with its own
// serializer state, and the result is kept per block Node: an edit makes a
// new Node only for the block it touched, so the rest come from the memo.
//
// Joining the blocks reproduces exactly what the whole-document pass writes
// between them. That pass, at the top level (no delimiter, never in a tight
// list), only carries three things from one block to the next:
//   - `closed`, the block a blank line is still owed for. The next block
//     that writes anything pays it: a newline if the output doesn't end
//     with one, then one more (two more when a list follows a list of the
//     same type: renderList's flushClose(3)). A block that writes nothing
//     can still close (an empty paragraph), which changes what is owed.
//   - whether the output so far ends with a newline (atBlank).
//   - the output's last characters, which text() checks for a `!` before a
//     `[`; after a paid blank line they are always a newline.
// Anything outside that model (a block that writes but never closes) falls
// back to the whole-document pass, so the bytes never differ.
// Each top-level serializer must depend on its node alone (none of them
// reads `parent` or `index`), or the memo would hand back a stale string.

interface BlockOut {
  out: string;
  // Called write() (so a blank line owed before it was paid), even if it
  // wrote nothing visible.
  wrote: boolean;
  // The type of the node left closed at the end, or null.
  closed: NodeType | null;
}

const blockMemo = new WeakMap<Node, BlockOut>();

// Counts blocks actually rendered (memo misses) and whole-document
// fallbacks, so tests can check how much work an edit costs.
export const serializerWork = { blocksRendered: 0, fallbacks: 0 };

const stateOptions = Object.assign({}, editorMarkdownSerializer.options);

// Inside one block, prosemirror-markdown still checks the end of its output
// with regexes that scan all of it: atBlank() before every line it writes,
// and text()'s look for a `!` before every link. One block can be a whole
// document (a changelog that is a single list), which made that quadratic
// again: seconds for a 400 KB list. So a block's state never holds more
// than about SPILL_AT characters; the rest is set aside as it is written
// and joined back at the end. Those checks only ever look at the last two
// characters (a newline, or a `!` and the one before it), and nothing else
// reads the state's output, so leaving SPILL_KEEP characters behind changes
// no byte. The byte-identity tests cover lists, quotes and long paragraphs.
const SPILL_AT = 1024;
const SPILL_KEEP = 64;

function renderBlock(node: Node, parent: Node, index: number): BlockOut {
  const hit = blockMemo.get(node);
  if (hit) return hit;
  serializerWork.blocksRendered += 1;
  const internals = editorMarkdownSerializer as unknown as {
    nodes: MarkdownSerializerStateInternals['nodes'];
    marks: MarkdownSerializerStateInternals['marks'];
  };
  const state = new MarkdownSerializerStateImpl(internals.nodes, internals.marks, stateOptions) as
    MarkdownSerializerStateInternals & { flushClose(size?: number): void; closed: Node | null };
  let wrote = false;
  const flushClose = state.flushClose;
  state.flushClose = function (size?: number) {
    wrote = true;
    flushClose.call(this, size);
  };
  // Keep the state's own output short (see SPILL_AT): what is written past
  // it moves to `spilled`, and only the last characters stay behind.
  const spilled: string[] = [];
  const write = state.write;
  state.write = function (content?: string) {
    if (this.out.length > SPILL_AT) {
      const cut = this.out.length - SPILL_KEEP;
      spilled.push(this.out.slice(0, cut));
      this.out = this.out.slice(cut);
    }
    write.call(this, content);
  };
  state.render(node, parent, index);
  const out = spilled.length ? spilled.join('') + state.out : state.out;
  const result: BlockOut = { out, wrote, closed: state.closed ? state.closed.type : null };
  blockMemo.set(node, result);
  return result;
}

const LIST_TYPES = new Set(['bullet_list', 'ordered_list']);

// The body (before footnote definitions) as the whole-document pass would
// write it, or null when a block falls outside the join model above.
function serializeBlocks(doc: Node): string | null {
  const parts: string[] = [];
  let closed: NodeType | null = null;
  // An unclosed block has written: the next one would continue its line.
  let open = false;
  let atBlank = true;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const r = renderBlock(child, doc, i);
    if (!r.wrote) {
      if (r.out) return null;
      if (r.closed) closed = r.closed;
      continue;
    }
    if (open) return null;
    if (closed) {
      const size = LIST_TYPES.has(child.type.name) && closed === child.type ? 3 : 2;
      parts.push((atBlank ? '' : '\n') + '\n'.repeat(size - 1));
      atBlank = true;
    }
    if (r.out) {
      parts.push(r.out);
      atBlank = r.out.endsWith('\n');
    }
    closed = r.closed;
    open = !r.closed;
  }
  return parts.join('');
}

// The whole-document pass, kept for the fallback and to check the per-block
// output against.
export function serializeWholeDocForTests(doc: Node): string {
  return withFootnotes(doc, editorMarkdownSerializer.serialize(doc));
}

export function serializeDocToMarkdown(doc: Node): string {
  let body = serializeBlocks(doc);
  if (body === null) {
    serializerWork.fallbacks += 1;
    body = editorMarkdownSerializer.serialize(doc);
  }
  return withFootnotes(doc, body);
}

function withFootnotes(doc: Node, body: string): string {
  let out = body;

  // Walk the doc once to collect footnote definitions in document
  // order, deduped by label. The first occurrence wins — subsequent
  // references to the same label keep referencing the same body so
  // there's only ONE [^label]: ... block per label in the output.
  const seen = new Set<string>();
  const definitions: Array<{ label: string; body: string }> = [];
  doc.descendants(node => {
    if (node.type.name !== 'footnote') return;
    const label = String(node.attrs.label || '');
    if (!label || seen.has(label)) return;
    seen.add(label);
    definitions.push({ label, body: String(node.attrs.body || '') });
  });

  if (definitions.length > 0) {
    if (!out.endsWith('\n')) out += '\n';
    out += '\n'; // blank line between body and definitions
    for (let d = 0; d < definitions.length; d++) {
      const def = definitions[d];
      // markdown-it-footnote requires continuation lines (paragraph 2+)
      // to be indented by 4 spaces. Treat each \n\n as a paragraph break
      // and indent every line after the first.
      const lines = def.body.split('\n');
      const indented = lines
        .map((line, i) => (i === 0 ? line : line === '' ? '' : '    ' + line))
        .join('\n');
      out += `[^${def.label}]: ${indented}\n`;
      // Blank line between definitions so each `[^label]:` block is
      // its own paragraph for markdown-it-footnote to re-parse cleanly.
      if (d < definitions.length - 1) out += '\n';
    }
  }

  // POSIX trailing newline (same convention as Phase 1's serializer).
  return out.endsWith('\n') ? out : out + '\n';
}
