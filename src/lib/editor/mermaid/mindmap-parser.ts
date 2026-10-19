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

export interface MindmapNodeSource {
  // Line the node starts on, and the line its text ends on (a quoted
  // or unquoted body may run over several lines).
  line: number;
  endLine: number;
  // Leading whitespace on `line`.
  indent: Span;
  // Explicit id, on `line`.
  id: Span | null;
  // Opening delimiter on `line` / closing delimiter on `endLine`; both
  // null for a bare node.
  open: Span | null;
  close: Span | null;
  openText: string;
  closeText: string;
  // The text as written, quotes included: [start, end).
  body: { start: Pos; end: Pos };
  form: MindmapTextForm;
  // `::icon(…)` / `:::…` lines that decorate this node (every one, the
  // last of each kind is the one mermaid uses).
  iconLines: number[];
  classLines: number[];
  // Last line of the node's own statements (its text and decorations).
  ownLast: number;
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

// What may follow a node or decoration on its line: nothing, or a
// `%%` comment (mermaid's lexer treats `\s*%%.*` as a blank line).
const TAIL_OK = /^\s*(%%.*)?$/;

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

interface Scanned {
  src: MindmapNodeSource;
  raw: string;
  level: number;
  // The node's id as written (explicit id only).
  id: string | null;
}

// Scan one node starting at column `col` of line `line`. Bodies may
// span lines; the text is addressed as `lines` joined by '\n'.
function scanNode(lines: string[], line: number, col: number): Scanned | string {
  const first = lines[line];
  const rest = first.slice(col);
  if (/^mindmap\b/i.test(rest)) return 'a node may not start with the word "mindmap"';
  let pos = col;
  let id: Span | null = null;
  let open = OPENERS.find((o) => rest.startsWith(o));
  if (!open) {
    // NODE_ID: everything up to a delimiter or the end of the line.
    const m = /^[^([\n){}]+/.exec(rest);
    if (!m) return 'unrecognised text';
    if (m[0].length === rest.length) {
      // A bare node: the whole rest of the line, trailing spaces too
      // (mermaid keeps them).
      const span = { start: col, end: first.length };
      return {
        raw: rest,
        level: col,
        id: null,
        src: {
          line,
          endLine: line,
          indent: { start: 0, end: col },
          id: null,
          open: null,
          close: null,
          openText: '',
          closeText: '',
          body: { start: { line, col: span.start }, end: { line, col: span.end } },
          form: 'bare',
          iconLines: [],
          classLines: [],
          ownLast: line,
          lastLine: line,
          lastIndex: -1,
        },
      };
    }
    id = { start: col, end: col + m[0].length };
    pos = id.end;
    open = OPENERS.find((o) => first.startsWith(o, pos));
    if (!open) return 'unrecognised text after the node id';
  }
  const openSpan = { start: pos, end: pos + open.length };
  pos = openSpan.end;

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
  let form: MindmapTextForm;
  if (startsAt('"`')) {
    form = 'markdown';
    c += 2;
    while (at() !== '' && at() !== '`' && at() !== '"') {
      raw += at();
      advance();
    }
    if (!startsAt('`"')) return 'unterminated markdown string';
    c += 2;
  } else if (startsAt('"')) {
    form = 'quoted';
    c += 1;
    while (at() !== '' && at() !== '"') {
      raw += at();
      advance();
    }
    if (!startsAt('"')) return 'unterminated string';
    c += 1;
  } else {
    form = 'plain';
    while (at() !== '' && !')](}'.includes(at())) {
      raw += at();
      advance();
    }
  }
  if (raw === '') return 'empty node text';
  const bodyEnd: Pos = { line: l, col: c };
  const close = CLOSERS.find((d) => startsAt(d));
  if (!close) return 'unterminated node shape';
  const closeSpan = { start: c, end: c + close.length };
  if (!TAIL_OK.test(lines[l].slice(closeSpan.end))) return 'unexpected text after a node';
  return {
    raw,
    level: col,
    id: id ? first.slice(id.start, id.end) : null,
    src: {
      line,
      endLine: l,
      indent: { start: 0, end: col },
      id,
      open: openSpan,
      close: closeSpan,
      openText: open,
      closeText: close,
      body: { start: bodyStart, end: bodyEnd },
      form,
      iconLines: [],
      classLines: [],
      ownLast: l,
      lastLine: l,
      lastIndex: -1,
    },
  };
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
    const line = lines[k];
    if (isBlankOrComment(line)) continue;
    const col = indentOf(line).length;
    const rest = line.slice(col);
    const last = srcs[srcs.length - 1];

    if (/^::icon\(/i.test(rest)) {
      const m = /^::icon\(([^)]*)\)/i.exec(rest);
      if (!m || !TAIL_OK.test(rest.slice(m[0].length))) return fail('malformed icon');
      if (!last) return fail('an icon before the first node');
      if (m[1]) nodes[nodes.length - 1].icon = m[1];
      last.iconLines.push(k);
      last.ownLast = k;
      continue;
    }
    if (rest.startsWith(':::')) {
      if (!last) return fail('a class before the first node');
      // mermaid takes the whole rest of the line; a later one replaces it.
      const value = rest.slice(3);
      if (value) nodes[nodes.length - 1].classes = value.split(/\s+/).filter(Boolean);
      last.classLines.push(k);
      last.ownLast = k;
      continue;
    }

    const scanned = scanNode(lines, k, col);
    if (typeof scanned === 'string') return fail(`line ${k + 1}: ${scanned}`);
    const index = nodes.length;
    let level = scanned.level;
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
    const { src } = scanned;
    nodes.push({
      index,
      text: decodeMermaidEntities(scanned.raw),
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
