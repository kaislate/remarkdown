// Parser for mermaid `mindmap` diagrams (mermaid 11.14), with a source
// map for the source-preserving edits in mindmap-edit.ts.
//
// A mindmap is an indentation tree, one node per line:
//
//   mindmap
//     root((Big idea))          ← the one root (any indentation)
//       Plain text              ← default shape, the text is the id
//       id[Square]              ← optional id, then a shape
//       ::icon(fa fa-book)      ← decorates the node above it
//       :::urgent large         ← css classes, same rule
//
// The tree is built exactly the way mermaid builds it (mindmapDb.ts):
//   - a node's level is the number of whitespace characters before it
//     (a tab counts as ONE, like a space)
//   - its parent is the closest node above it with a smaller level —
//     so inconsistent indentation still yields mermaid's tree
//   - the first node is the root; any later node with no such parent
//     ("a second root") is an error
//   - `::icon(…)` / `:::…` lines decorate the LAST node before them in
//     source order, whatever their own indentation; a later one
//     replaces an earlier one
//
// Shapes (mermaid's getType): `[x]` square, `(x)` rounded, `((x))`
// circle, `))x((` bang, `)x(` cloud, `{{x}}` hexagon, bare text (or
// the `(-x-)` form) default. mermaid only looks at the opening
// delimiter (and, for `(`, whether the closing one is `)`), so `[x)`
// is a square — we read it the same way.
//
// Text is read as mermaid shows it: a body is unquoted (`[a b]`),
// quoted (`["a (b)"]`) or a markdown string (`["`**a**`"]`), entity
// codes (`#59;`, `#quot;`) are decoded, whitespace is kept. mermaid
// renders EVERY label as markdown, so a hand-written `**x**` reads
// back as the text `**x**` (the edit engine escapes typed text so it
// displays literally).
//
// Anything mermaid would reject — or that we can't map back to exact
// source positions — returns `{ ok: false, reason }`.
import { decodeMermaidEntities } from '../mermaid-parser';
import {
  findPreamble,
  indentOf,
  isBlankOrComment,
  splitLines,
  type Span,
} from './source-text';

export type MindmapShape = 'default' | 'square' | 'rounded' | 'circle' | 'bang' | 'cloud' | 'hexagon';

export interface MindmapNode {
  // Position in source order — also mermaid's own node number (the
  // `node_<index>` in the rendered SVG). nodes[0] is the root.
  index: number;
  // The label as mermaid shows it (entity codes decoded; markdown
  // syntax written by hand is kept as is).
  text: string;
  // The label as the markdown mermaid renders (every mindmap label is
  // markdown): like `text`, but a marker written as an entity code
  // (`#42;`, i.e. a literal `*`) comes back backslash-escaped (`\*`).
  // What a bold / italic field (rich-text.ts) edits.
  richText: string;
  shape: MindmapShape;
  // Written as a markdown string ("`…`").
  markdown: boolean;
  // Explicit id before the shape (`id[text]`); null when the node has
  // none (mermaid then uses the text as its id).
  id: string | null;
  // `::icon(…)` value (e.g. "fa fa-book"), null when none.
  icon: string | null;
  // `:::a b` class names.
  classes: string[];
  parent: number | null;
  children: number[];
  // 0 for the root.
  depth: number;
}

export interface MindmapModel {
  // Frontmatter `title:`, null when none.
  title: string | null;
  nodes: MindmapNode[];
}

// A position in the source: line and column.
export interface Pos {
  line: number;
  col: number;
}

// How a node's text is written.
//   bare:     `Plain text` (default shape; the text is also the id)
//   plain:    `[Plain text]` — unquoted inside delimiters
//   quoted:   `["Text"]`
//   markdown: `["`Text`"]`
export type MindmapTextForm = 'bare' | 'plain' | 'quoted' | 'markdown';

// One node statement as written — shared with kanban-parser.ts, whose
// grammar is mindmap's plus `@{…}` metadata.
export interface NodeToken {
  // Line the node starts on, and the line it ends on (a quoted or
  // unquoted text, or kanban metadata, may run over several lines).
  line: number;
  endLine: number;
  // Leading whitespace on `line`.
  indent: Span;
  // Explicit id, on `line`.
  id: Span | null;
  // Opening delimiter on `line` / closing delimiter on the line the
  // text ends on; both null for a bare node.
  open: Span | null;
  close: Span | null;
  openText: string;
  closeText: string;
  // The text as written, quotes included: [start, end).
  body: { start: Pos; end: Pos };
  form: MindmapTextForm;
  // kanban only: the `@{ … }` metadata, braces included, and the raw
  // text between the braces.
  meta: { start: Pos; end: Pos; raw: string } | null;
  // `::icon(…)` / `:::…` lines that decorate this node (every one, the
  // last of each kind is the one mermaid uses).
  iconLines: number[];
  classLines: number[];
  // Last line of the node's own statements (its text and decorations).
  ownLast: number;
}

export interface MindmapNodeSource extends NodeToken {
  // Last statement line of the node's whole subtree.
  lastLine: number;
  // Index of the last node in the subtree (== own index for a leaf).
  lastIndex: number;
}

export interface MindmapSourceMap {
  lines: string[];
  eol: string;
  headerLine: number;
  nodes: MindmapNodeSource[];
  // The file's indentation step (inferred from parent → child pairs;
  // '\t' or two spaces when there are none) for inserted lines.
  unit: string;
}

export type MindmapSourceParseResult =
  | { ok: true; model: MindmapModel; map: MindmapSourceMap }
  | { ok: false; reason: string };

export type MindmapParseResult = { ok: true; model: MindmapModel } | { ok: false; reason: string };

export const MINDMAP_STARTER = [
  'mindmap',
  '  root((Weekend plan))',
  '    Errands',
  '      Groceries',
  '      Post office',
  '    Fun',
  '      Hike',
  '      Movie night',
  '    Rest',
  '',
].join('\n');

// Opening delimiters, in mermaid's lexer order (first match wins).
const OPENERS = ['-)', '(-', '))', ')', '((', '{{', '(', '['];
// Closing delimiters, same.
const CLOSERS = ['))', ')', ']', '}}', '(-', '-)', '((', '('];

// mermaid's getType: only the opener matters, except `(`.
export function shapeOf(open: string, close: string): MindmapShape {
  switch (open) {
    case '[':
      return 'square';
    case '(':
      return close === ')' ? 'rounded' : 'cloud';
    case '((':
      return 'circle';
    case ')':
      return 'cloud';
    case '))':
      return 'bang';
    case '{{':
      return 'hexagon';
    default:
      return 'default';
  }
}

// A label as written → the markdown mermaid renders, for MindmapNode.
// richText: entity codes decoded, except that a markdown marker written
// as one (meant literally) becomes a backslash escape.
export function richTextOf(raw: string): string {
  return raw.replace(/#\w+;/g, (m) => {
    const ch = decodeMermaidEntities(m);
    return ch !== m && /^[*_\\`]$/.test(ch) ? `\\${ch}` : ch;
  });
}

// What may follow a node or decoration on its line: nothing, or a
// `%%` comment (mermaid's lexer treats `\s*%%.*` as a blank line).
const TAIL_OK = /^\s*(%%.*)?$/;

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

// mindmap and kanban share one lexer design; kanban adds `@{…}`
// metadata after a node and keeps `@` out of node ids.
export type NodeFlavor = 'mindmap' | 'kanban';

export interface ScannedNode {
  token: NodeToken;
  // The text between the delimiters / quotes, as written.
  raw: string;
  // The explicit id as written, null when none.
  id: string | null;
}

export type ScannedStatement =
  | { kind: 'icon'; value: string }
  | { kind: 'class'; value: string }
  | { kind: 'node'; node: ScannedNode };

// One statement starting on line `k` (neither blank nor a comment):
// a node, or an `::icon(…)` / `:::…` decoration. A string is the
// reason mermaid would reject it.
export function scanStatement(lines: string[], k: number, flavor: NodeFlavor): ScannedStatement | string {
  const line = lines[k];
  const col = indentOf(line).length;
  const rest = line.slice(col);
  if (/^::icon\(/i.test(rest)) {
    const m = /^::icon\(([^)]*)\)/i.exec(rest);
    if (!m || !TAIL_OK.test(rest.slice(m[0].length))) return 'malformed icon';
    return { kind: 'icon', value: m[1] };
  }
  // mermaid takes the whole rest of the line as the class names.
  if (rest.startsWith(':::')) return { kind: 'class', value: rest.slice(3) };
  const node = scanNodeToken(lines, k, col, flavor);
  return typeof node === 'string' ? node : { kind: 'node', node };
}

function emptyToken(line: number, col: number): NodeToken {
  return {
    line,
    endLine: line,
    indent: { start: 0, end: col },
    id: null,
    open: null,
    close: null,
    openText: '',
    closeText: '',
    body: { start: { line, col }, end: { line, col } },
    form: 'bare',
    meta: null,
    iconLines: [],
    classLines: [],
    ownLast: line,
  };
}

// Scan one node starting at column `col` of line `line`. Texts and
// metadata may span lines (addressed as `lines` joined by '\n').
function scanNodeToken(lines: string[], line: number, col: number, flavor: NodeFlavor): ScannedNode | string {
  const first = lines[line];
  const rest = first.slice(col);
  if (new RegExp(`^${flavor}\\b`, 'i').test(rest)) return `a node may not start with the word "${flavor}"`;
  const token = emptyToken(line, col);
  let pos = col;
  let open = OPENERS.find((o) => rest.startsWith(o));
  if (!open) {
    // NODE_ID: everything up to a delimiter or the end of the line.
    const m = (flavor === 'kanban' ? /^[^([\n){}@]+/ : /^[^([\n){}]+/).exec(rest);
    if (!m) return 'unrecognised text';
    const end = col + m[0].length;
    if (end === first.length || (flavor === 'kanban' && first.startsWith('@{', end))) {
      // A bare node: the rest of the line (trailing spaces too —
      // mermaid keeps them), or up to kanban metadata.
      token.body = { start: { line, col }, end: { line, col: end } };
      return finish(lines, token, line, end, rest.slice(0, m[0].length), null, flavor);
    }
    token.id = { start: col, end };
    pos = end;
    open = OPENERS.find((o) => first.startsWith(o, pos));
    if (!open) return 'unrecognised text after the node id';
  }
  token.open = { start: pos, end: pos + open.length };
  token.openText = open;
  pos = token.open.end;

  // The body, which may run over several lines.
  let l = line;
  let c = pos;
  const at = (): string => (c < lines[l].length ? lines[l][c] : l + 1 < lines.length ? '\n' : '');
  const advance = (): void => {
    if (c < lines[l].length) c++;
    else {
      l++;
      c = 0;
    }
  };
  const startsAt = (s: string): boolean => lines[l].startsWith(s, c);
  const bodyStart: Pos = { line: l, col: c };
  let raw = '';
  if (startsAt('"`')) {
    token.form = 'markdown';
    c += 2;
    while (at() !== '' && at() !== '`' && at() !== '"') {
      raw += at();
      advance();
    }
    if (!startsAt('`"')) return 'unterminated markdown string';
    c += 2;
  } else if (startsAt('"')) {
    token.form = 'quoted';
    c += 1;
    while (at() !== '' && at() !== '"') {
      raw += at();
      advance();
    }
    if (!startsAt('"')) return 'unterminated string';
    c += 1;
  } else {
    token.form = 'plain';
    while (at() !== '' && !')](}'.includes(at())) {
      raw += at();
      advance();
    }
  }
  if (raw === '') return 'empty node text';
  token.body = { start: bodyStart, end: { line: l, col: c } };
  const close = CLOSERS.find((d) => startsAt(d));
  if (!close) return 'unterminated node shape';
  token.close = { start: c, end: c + close.length };
  token.closeText = close;
  return finish(lines, token, l, token.close.end, raw, token.id ? first.slice(token.id.start, token.id.end) : null, flavor);
}

// After the text: kanban metadata, then nothing but an optional `%%`
// comment up to the end of the line.
function finish(
  lines: string[],
  token: NodeToken,
  l: number,
  c: number,
  raw: string,
  id: string | null,
  flavor: NodeFlavor,
): ScannedNode | string {
  if (flavor === 'kanban' && lines[l].startsWith('@{', c)) {
    // mermaid's shapeData lexer: `"…"` strings may hold `}`; outside
    // them `}` ends the data and `^` is an error.
    const start: Pos = { line: l, col: c };
    c += 2;
    let data = '';
    let inString = false;
    for (;;) {
      if (c >= lines[l].length) {
        if (l + 1 >= lines.length) return 'unterminated metadata';
        l++;
        c = 0;
        data += '\n';
        continue;
      }
      const ch = lines[l][c];
      if (!inString && ch === '}') break;
      if (!inString && ch === '^') return 'unexpected ^ in metadata';
      if (ch === '"') inString = !inString;
      data += ch;
      c++;
    }
    c++;
    token.meta = { start, end: { line: l, col: c }, raw: data };
  }
  if (!TAIL_OK.test(lines[l].slice(c))) return 'unexpected text after a node';
  token.endLine = l;
  token.ownLast = l;
  return { token, raw, id };
}

// The indentation step of the file, for lines the edit engine inserts.
function inferUnit(lines: string[], srcs: MindmapNodeSource[], parents: (number | null)[]): string {
  const counts = new Map<string, number>();
  srcs.forEach((s, i) => {
    const p = parents[i];
    if (p === null) return;
    const mine = lines[s.line].slice(0, s.indent.end);
    const theirs = lines[srcs[p].line].slice(0, srcs[p].indent.end);
    if (mine.length > theirs.length && mine.startsWith(theirs)) {
      const step = mine.slice(theirs.length);
      counts.set(step, (counts.get(step) ?? 0) + 1);
    }
  });
  let best = '';
  let n = 0;
  for (const [step, k] of counts) {
    if (k > n) {
      best = step;
      n = k;
    }
  }
  if (best) return best;
  return srcs.some((s) => lines[s.line].slice(0, s.indent.end).includes('\t')) ? '\t' : '  ';
}

export function parseMindmapSource(source: string): MindmapSourceParseResult {
  const { lines, eol } = splitLines(source);
  const { frontmatter, headerLine } = findPreamble(lines);
  if (headerLine < 0 || lines[headerLine].trim() !== 'mindmap') return fail('not a mindmap');

  const srcs: MindmapNodeSource[] = [];
  const nodes: MindmapNode[] = [];
  const levels: number[] = [];
  let base = 0;

  for (let k = headerLine + 1; k < lines.length; k++) {
    if (isBlankOrComment(lines[k])) continue;
    const st = scanStatement(lines, k, 'mindmap');
    if (typeof st === 'string') return fail(`line ${k + 1}: ${st}`);
    const last = srcs[srcs.length - 1];
    if (st.kind !== 'node') {
      if (!last) return fail(`line ${k + 1}: a decoration before the first node`);
      // A later icon / class line replaces an earlier one.
      if (st.kind === 'icon') {
        if (st.value) nodes[nodes.length - 1].icon = st.value;
        last.iconLines.push(k);
      } else {
        if (st.value) nodes[nodes.length - 1].classes = st.value.split(/\s+/).filter(Boolean);
        last.classLines.push(k);
      }
      last.ownLast = k;
      continue;
    }

    const scanned = st.node;
    const index = nodes.length;
    let level = scanned.token.indent.end;
    let parent: number | null = null;
    if (index === 0) {
      base = level;
      level = 0;
    } else {
      level -= base;
      for (let i = index - 1; i >= 0; i--) {
        if (levels[i] < level) {
          parent = i;
          break;
        }
      }
      if (parent === null) return fail(`line ${k + 1}: a mindmap has exactly one root`);
    }
    const src: MindmapNodeSource = { ...scanned.token, lastLine: scanned.token.ownLast, lastIndex: index };
    nodes.push({
      index,
      text: decodeMermaidEntities(scanned.raw),
      richText: richTextOf(scanned.raw),
      shape: src.form === 'bare' ? 'default' : shapeOf(src.openText, src.closeText),
      markdown: src.form === 'markdown',
      id: scanned.id,
      icon: null,
      classes: [],
      parent,
      children: [],
      depth: parent === null ? 0 : nodes[parent].depth + 1,
    });
    if (parent !== null) nodes[parent].children.push(index);
    levels.push(level);
    srcs.push(src);
    k = src.endLine;
  }

  // Subtree extents: in source order a subtree is contiguous, so its
  // last node is the last descendant and its last line that node's.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const kids = nodes[i].children;
    const lastKid = kids[kids.length - 1];
    srcs[i].lastIndex = lastKid === undefined ? i : srcs[lastKid].lastIndex;
    srcs[i].lastLine = srcs[srcs[i].lastIndex].ownLast;
  }

  const unit = inferUnit(lines, srcs, nodes.map((n) => n.parent));
  return {
    ok: true,
    model: { title: frontmatter?.title?.value ?? null, nodes },
    map: { lines, eol, headerLine, nodes: srcs, unit },
  };
}

export function parseMindmap(source: string): MindmapParseResult {
  const r = parseMindmapSource(source);
  return r.ok ? { ok: true, model: r.model } : r;
}
