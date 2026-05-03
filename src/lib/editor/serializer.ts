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
import type { Node } from 'prosemirror-model';

// prosemirror-markdown's dist .d.ts marks the MarkdownSerializerState
// constructor, `nodes`, `marks`, and `out` as @internal (stripped during
// the d.ts build), even though they exist at runtime and are required
// for spawning a sub-state to render a single cell to a string buffer.
// This typed shim re-exposes them so the table serializer below can
// instantiate a sub-state and read its accumulated output without
// triggering svelte-check / tsc errors.
type MarkdownSerializerStateInternals = MarkdownSerializerState & {
  out: string;
  // The shapes here mirror the runtime types declared in
  // node_modules/prosemirror-markdown/src/to_markdown.ts (lines 187-193).
  nodes: { [name: string]: (state: MarkdownSerializerState, node: Node, parent: Node, index: number) => void };
  marks: Record<string, unknown>;
};
type MarkdownSerializerStateCtor = new (
  nodes: MarkdownSerializerStateInternals['nodes'],
  marks: MarkdownSerializerStateInternals['marks'],
  options: MarkdownSerializerState['options'],
) => MarkdownSerializerStateInternals;
const MarkdownSerializerStateImpl =
  MarkdownSerializerState as unknown as MarkdownSerializerStateCtor;

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
  // Per-column widths are fixed at 1 — NOT max-of-column. GFM accepts
  // single-dash separators, and the canonical round-trip shape from
  // markdown-it's table parser uses single-space cell padding without
  // column alignment. Wider content (e.g. `**a**`) is left as-is by
  // padEnd(1) (which is a no-op when the string is already longer);
  // empty cells get padded to a single space so `|   |` stays well-
  // formed; the separator row is always `-` per column.
  const widths: number[] = new Array(colCount).fill(1);
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

const editorMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    callout,
    code_block,
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
  },
);

export function serializeDocToMarkdown(doc: Node): string {
  const out = editorMarkdownSerializer.serialize(doc);
  // POSIX trailing newline (same convention as Phase 1's serializer).
  return out.endsWith('\n') ? out : out + '\n';
}
