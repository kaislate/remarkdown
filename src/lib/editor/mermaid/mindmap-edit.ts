// Source-preserving visual edits for mindmaps — the mindmap
// counterpart of mermaid-flowchart-edit.ts (see there for the why).
//
// The editor works like an outliner: click a node, then rename it,
// change its shape, add a child or a sibling, delete it, indent /
// outdent it or move it among its siblings. Edits take user-level
// values (plain text, a shape, node indexes) and write mermaid syntax
// that shows exactly that:
//   - text / shape edits splice the node's own text or delimiters
//     (`id[Old]` → `id[New]`, `id[x]` → `id((x))`); the id, the
//     markdown-string form and everything else on other lines stay
//   - additions insert one line after the subtree they belong to, with
//     the file's own indentation (tabs or spaces, its step width)
//   - delete removes the node's whole subtree (lines included in it:
//     decorations, comments between its nodes); the root can't go —
//     mermaid needs exactly one
//   - indent / outdent / move re-indent and move whole subtrees, with
//     their `::icon` / `:::class` lines (which belong to the node
//     above them) — those are the only lines they touch
// Lines an edit doesn't touch — comments, blank lines, the init
// directive, frontmatter, other nodes — are never re-emitted.
//
// Node indexes are positions in source order (MindmapNode.index);
// results report where the affected node ended up.
import {
  parseMindmapSource,
  type MindmapShape,
  type MindmapNodeSource,
  type MindmapSourceMap,
  type MindmapModel,
  type NodeFlavor,
} from './mindmap-parser';
import { setFrontmatterTitle } from './source-text';

export type MindmapEdit =
  // Text as the user typed it; written so mermaid shows exactly that.
  // An empty text is written as one space (mermaid needs some text).
  | { kind: 'rename'; index: number; text: string }
  | { kind: 'setShape'; index: number; shape: MindmapShape }
  // New node as the LAST child of `index`.
  | { kind: 'addChild'; index: number; text: string; shape?: MindmapShape }
  // New node right after `index` (and its subtree); not for the root.
  | { kind: 'addSibling'; index: number; text: string; shape?: MindmapShape }
  // The first node of an empty mindmap.
  | { kind: 'addRoot'; text: string; shape?: MindmapShape }
  // Removes the node AND its subtree; refused for the root.
  | { kind: 'delete'; index: number }
  // Become the last child of the previous sibling.
  | { kind: 'indent'; index: number }
  // Become the next sibling of the parent (refused for the root's
  // children: that would make a second root).
  | { kind: 'outdent'; index: number }
  // Swap with the previous / next sibling (subtrees move along).
  | { kind: 'moveUp'; index: number }
  | { kind: 'moveDown'; index: number }
  // Icon class names (e.g. "fa fa-book"); '' removes the icon.
  | { kind: 'setIcon'; index: number; icon: string }
  // Frontmatter title; '' removes it.
  | { kind: 'setTitle'; title: string };

export interface MindmapEditResult {
  source: string;
  // Index of the node the edit created or moved (or renamed / reshaped)
  // in the new source.
  index?: number;
}

const OPEN: Record<Exclude<MindmapShape, 'default'>, string> = {
  square: '[',
  rounded: '(',
  circle: '((',
  bang: '))',
  cloud: ')',
  hexagon: '{{',
};
const CLOSE: Record<Exclude<MindmapShape, 'default'>, string> = {
  square: ']',
  rounded: ')',
  circle: '))',
  bang: '((',
  cloud: '(',
  hexagon: '}}',
};

// ── Writing text ─────────────────────────────────────────────────────

// mermaid renders every mindmap (and kanban) label as markdown and
// decodes `#…;` entity codes in it. Typed characters that would mean
// something there are written as entity codes, so the label shows
// exactly what was typed:
//   - `#` that would start an entity code → #35;
//   - `"` (ends a string), `&` / `<` (HTML) → #quot; #amp; #lt;
//   - `*` `_` `\` (markdown emphasis / escapes) → #42; #95; #92;
//   - `%%` (comment / directive start) → #37;%
//   - in a markdown string also the backtick (ends it) → #96;
const ENTITY: Record<string, string> = {
  '"': '#quot;',
  '&': '#amp;',
  '<': '#lt;',
  '*': '#42;',
  _: '#95;',
  '\\': '#92;',
  '`': '#96;',
};

export function escapeText(text: string, markdown: boolean): string {
  const out = text
    .replace(/#(?=\w+;)/g, '#35;')
    .replace(/%(?=%)/g, '#37;')
    .replace(markdown ? /["&<*_\\`]/g : /["&<*_\\]/g, (c) => ENTITY[c]);
  return out;
}

// Can `text` be written bare (default shape, no delimiters)? mermaid
// reads a bare node as everything up to the end of the line, so it
// must avoid the delimiters and anything the lexer matches first.
// kanban's lexer also stops a bare node at `@` (metadata).
export function bareSafe(written: string, flavor: NodeFlavor = 'mindmap'): boolean {
  return (
    written.length > 0 &&
    !(flavor === 'kanban' ? /[()[\]{}@\n\r]/ : /[()[\]{}\n\r]/).test(written) &&
    !/^\s/.test(written) &&
    !new RegExp(`^(${flavor}\\b|::icon\\(|:::|-\\)|%%)`, 'i').test(written)
  );
}

// Can `written` sit unquoted inside delimiters (`[text]`)? mermaid
// would keep edge spaces too, but quotes make them obvious.
export function plainSafe(written: string): boolean {
  return written.length > 0 && !/[()[\]{}"\n\r]/.test(written) && !/^\s|\s$/.test(written);
}

// Mermaid needs some text; an empty label is written as one space.
export function nonEmpty(text: string): string {
  return text === '' ? ' ' : text;
}

// A body (between delimiters) for typed text, in the given form.
export function emitBody(text: string, form: 'plain' | 'quoted' | 'markdown'): string {
  if (form === 'markdown') return `"\`${escapeText(text, true)}\`"`;
  const written = escapeText(text, false);
  if (form === 'plain' && plainSafe(written)) return written;
  return `"${written}"`;
}

// A whole node token (no id) for typed text.
function emitNode(text: string, shape: MindmapShape): string {
  const t = nonEmpty(text);
  if (shape === 'default') {
    const written = escapeText(t, false);
    // The `(-"…"-)` form is mermaid's default shape with a quoted text.
    return bareSafe(written) ? written : `(-"${written}"-)`;
  }
  return OPEN[shape] + emitBody(t, 'plain') + CLOSE[shape];
}

// ── Source helpers ───────────────────────────────────────────────────

// The text of a node exactly as written (quotes included).
function bodyText(map: MindmapSourceMap, s: MindmapNodeSource): string {
  const { start, end } = s.body;
  if (start.line === end.line) return map.lines[start.line].slice(start.col, end.col);
  const parts = [map.lines[start.line].slice(start.col)];
  for (let l = start.line + 1; l < end.line; l++) parts.push(map.lines[l]);
  parts.push(map.lines[end.line].slice(0, end.col));
  return parts.join('\n');
}

// Replace a node's whole token (id through closing delimiter) with
// `token`, which may hold newlines (a multi-line quoted text).
function replaceNodeToken(lines: string[], s: MindmapNodeSource, token: string): void {
  const head = lines[s.line].slice(0, s.indent.end);
  const tailCol = s.close ? s.close.end : s.body.end.col;
  const tail = lines[s.endLine].slice(tailCol);
  const out = (head + token + tail).split('\n');
  lines.splice(s.line, s.endLine - s.line + 1, ...out);
}

function indentStr(map: MindmapSourceMap, s: MindmapNodeSource): string {
  return map.lines[s.line].slice(0, s.indent.end);
}

// Lines a node's subtree consists of: [line, lastLine].
function blockOf(map: MindmapSourceMap, i: number): [number, number] {
  return [map.nodes[i].line, map.nodes[i].lastLine];
}

// Re-indent the subtree of node `i` in `lines` (same line numbers as
// the map): each node line's indentation `old + rest` becomes
// `next + rest`, so the subtree keeps its inner shape. Decoration
// lines follow along when they share the prefix (mermaid ignores
// their indentation); comments and continuation lines of multi-line
// texts stay as they are. False when a line doesn't start with `old`
// (mixed tabs and spaces) — the caller bails.
function reindent(lines: string[], map: MindmapSourceMap, i: number, next: string): boolean {
  const old = indentStr(map, map.nodes[i]);
  const last = map.nodes[i].lastIndex;
  for (let k = i; k <= last; k++) {
    const s = map.nodes[k];
    if (!lines[s.line].startsWith(old)) return false;
  }
  for (let k = i; k <= last; k++) {
    const s = map.nodes[k];
    lines[s.line] = next + lines[s.line].slice(old.length);
    for (const d of [...s.iconLines, ...s.classLines]) {
      if (lines[d].startsWith(old)) lines[d] = next + lines[d].slice(old.length);
    }
  }
  return true;
}

// Indentation for a new child of node `i`: the one its least-indented
// child has (so the new node can't land inside another child's
// subtree), else the parent's plus the file's step.
function childIndent(map: MindmapSourceMap, model: MindmapModel, i: number): string {
  const kids = model.nodes[i].children;
  if (!kids.length) return indentStr(map, map.nodes[i]) + map.unit;
  let best = kids[0];
  for (const k of kids) if (map.nodes[k].indent.end < map.nodes[best].indent.end) best = k;
  return indentStr(map, map.nodes[best]);
}

function siblingsOf(model: MindmapModel, i: number): number[] {
  const p = model.nodes[i].parent;
  return p === null ? [i] : model.nodes[p].children;
}

// Move lines [from, to] so they start right after line `after` (which
// lies outside the range); returns the new array.
export function moveBlock(lines: string[], from: number, to: number, after: number): string[] {
  const block = lines.slice(from, to + 1);
  const rest = [...lines.slice(0, from), ...lines.slice(to + 1)];
  const at = after > to ? after - block.length + 1 : after + 1;
  rest.splice(at, 0, ...block);
  return rest;
}

// Swap the adjacent sibling subtrees `a` (first) and `b`: b's block,
// then whatever lay between them (comments, blank lines), then a's.
// When b is indented less than a it's indented to a's level — else a
// would become its child.
function swapSiblings(map: MindmapSourceMap, a: number, b: number): string[] | null {
  const lines = [...map.lines];
  const sa = map.nodes[a];
  const sb = map.nodes[b];
  if (sb.indent.end < sa.indent.end && !reindent(lines, map, b, indentStr(map, sa))) return null;
  const [a0, a1] = blockOf(map, a);
  const [b0, b1] = blockOf(map, b);
  return [
    ...lines.slice(0, a0),
    ...lines.slice(b0, b1 + 1),
    ...lines.slice(a1 + 1, b0),
    ...lines.slice(a0, a1 + 1),
    ...lines.slice(b1 + 1),
  ];
}

// Apply one visual edit to mindmap `source`. Returns null when the
// source isn't a mindmap we can read, the edit names a node that
// doesn't exist, or the edit makes no sense there (deleting the root,
// indenting a first child, …).
export function applyMindmapEdit(source: string, edit: MindmapEdit): MindmapEditResult | null {
  const parsed = parseMindmapSource(source);
  if (!parsed.ok) return null;
  const { model, map } = parsed;
  const join = (lines: string[]): string => lines.join(map.eol);

  if (edit.kind === 'setTitle') return { source: setFrontmatterTitle(source, edit.title) };
  if (edit.kind === 'addRoot') {
    if (model.nodes.length) return null;
    const lines = [...map.lines];
    lines.splice(map.headerLine + 1, 0, map.unit + emitNode(edit.text, edit.shape ?? 'default'));
    return { source: join(lines), index: 0 };
  }

  const node = model.nodes[edit.index];
  if (!node) return null;
  const i = edit.index;
  const s = map.nodes[i];

  switch (edit.kind) {
    case 'rename': {
      const lines = [...map.lines];
      const text = nonEmpty(edit.text);
      let token: string;
      if (s.form === 'bare') {
        token = emitNode(text, 'default');
      } else {
        const id = s.id ? map.lines[s.line].slice(s.id.start, s.id.end) : '';
        // `(-…-)` needs a quoted text: mermaid's unquoted text would
        // swallow the `-` of `-)`.
        const form = s.form === 'plain' && s.openText !== '(-' && s.openText !== '-)' ? 'plain' : s.form === 'markdown' ? 'markdown' : 'quoted';
        token = id + s.openText + emitBody(text, form) + s.closeText;
      }
      replaceNodeToken(lines, s, token);
      return { source: join(lines), index: i };
    }
    case 'setShape': {
      // Already that shape (`[x)`-style oddities included): nothing to do.
      if (edit.shape === node.shape) return { source, index: i };
      const lines = [...map.lines];
      const id = s.id ? map.lines[s.line].slice(s.id.start, s.id.end) : '';
      const body = bodyText(map, s);
      // The text as written, unchanged: re-quoted only when the new
      // delimiters can't hold it unquoted.
      const quoted = (): string =>
        s.form === 'quoted' || s.form === 'markdown' ? body : `"${body.replace(/"/g, '#quot;')}"`;
      let token: string;
      if (edit.shape === 'default') {
        const inner = s.form === 'quoted' ? body.slice(1, -1) : body;
        if (!id && s.form !== 'markdown' && bareSafe(inner)) token = inner;
        else token = `${id}(-${quoted()}-)`;
      } else {
        const fits = s.form !== 'bare' ? s.form !== 'plain' || plainSafe(body) : plainSafe(body) && !body.startsWith('"');
        token = id + OPEN[edit.shape] + (fits ? body : quoted()) + CLOSE[edit.shape];
      }
      replaceNodeToken(lines, s, token);
      return { source: join(lines), index: i };
    }
    case 'addChild': {
      const lines = [...map.lines];
      lines.splice(s.lastLine + 1, 0, childIndent(map, model, i) + emitNode(edit.text, edit.shape ?? 'default'));
      return { source: join(lines), index: s.lastIndex + 1 };
    }
    case 'addSibling': {
      if (node.parent === null) return null;
      const lines = [...map.lines];
      lines.splice(s.lastLine + 1, 0, indentStr(map, s) + emitNode(edit.text, edit.shape ?? 'default'));
      return { source: join(lines), index: s.lastIndex + 1 };
    }
    case 'delete': {
      if (node.parent === null) return null;
      const lines = [...map.lines];
      lines.splice(s.line, s.lastLine - s.line + 1);
      return { source: join(lines) };
    }
    case 'indent': {
      const sibs = siblingsOf(model, i);
      const at = sibs.indexOf(i);
      if (at <= 0) return null;
      // The subtree already follows the previous sibling's: only its
      // indentation changes.
      const lines = [...map.lines];
      if (!reindent(lines, map, i, childIndent(map, model, sibs[at - 1]))) return null;
      return { source: join(lines), index: i };
    }
    case 'outdent': {
      const p = node.parent;
      if (p === null || model.nodes[p].parent === null) return null;
      const sp = map.nodes[p];
      let lines = [...map.lines];
      if (!reindent(lines, map, i, indentStr(map, sp))) return null;
      // After the parent's subtree, so later siblings stay its children.
      if (sp.lastLine > s.lastLine) lines = moveBlock(lines, s.line, s.lastLine, sp.lastLine);
      return { source: join(lines), index: sp.lastIndex - s.lastIndex + i };
    }
    case 'moveUp':
    case 'moveDown': {
      const sibs = siblingsOf(model, i);
      const at = sibs.indexOf(i);
      const other = sibs[edit.kind === 'moveUp' ? at - 1 : at + 1];
      if (other === undefined) return null;
      const [a, b] = edit.kind === 'moveUp' ? [other, i] : [i, other];
      const lines = swapSiblings(map, a, b);
      if (!lines) return null;
      const size = (k: number) => map.nodes[k].lastIndex - k + 1;
      return { source: join(lines), index: edit.kind === 'moveUp' ? a : i + size(b) };
    }
    case 'setIcon': {
      const icon = edit.icon.trim();
      if (/[)\n\r]/.test(icon)) return null;
      const lines = [...map.lines];
      const own = s.iconLines;
      if (!icon) {
        const drop = new Set(own);
        return { source: join(lines.filter((_, k) => !drop.has(k))), index: i };
      }
      if (own.length) {
        // Rewrite the value of the icon line mermaid uses (the last).
        const k = own[own.length - 1];
        lines[k] = lines[k].replace(/(::icon\()[^)]*(\))/i, `$1${icon}$2`);
      } else {
        // After the node's own lines, indented one step deeper (the
        // usual style; mermaid ignores decoration indentation).
        lines.splice(s.ownLast + 1, 0, `${indentStr(map, s)}${map.unit}::icon(${icon})`);
      }
      return { source: join(lines), index: i };
    }
  }
  return null;
}
