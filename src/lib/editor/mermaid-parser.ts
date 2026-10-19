// Parser for mermaid flowcharts (`flowchart` and the legacy `graph`
// keyword). It reads what mermaid 11 reads — every classic node shape,
// v11 `A@{ shape: …, label: … }` nodes, `&` groups, every link kind
// (`-->` `---` `-.->` `==>` `~~~` `--o` `--x` `<-->` `o--o` `x--x`, any
// length, `|pipe|` and `-- inline --` labels, `e1@-->` edge ids),
// quoted / markdown-string / multi-line labels, nested subgraphs with
// their own `direction`, `classDef` / `class` / `:::` / `style` /
// `linkStyle` / `click`, `;`-separated statements, `%%` comments and
// directives, frontmatter — and checks it against mermaid's own parse
// (tests/unit/editor/mermaid-parser.test.ts uses mermaid's db as the
// oracle). Anything else returns `{ ok: false, reason }` and the node
// view shows the diagram read-only.
//
// Besides the graph, parseMermaidSource returns a source map: every
// statement and token with its ABSOLUTE offsets in the source (labels
// may span lines, so line/column spans won't do). The visual editor
// (mermaid-flowchart-edit.ts) uses it to change ONLY the text an edit
// is about, leaving every other line byte-identical.
import {
  emptyGraph,
  type MermaidGraph,
  type MermaidShape,
  type MermaidDirection,
  type EdgeStroke,
  type EdgeEnds,
  type StyleProps,
} from './mermaid-graph';
import { findPreamble } from './mermaid/source-text';

// Range [start, end). Absolute offsets in the source for the flowchart
// source map; the sequence parser uses the same shape for columns.
export interface Span {
  start: number;
  end: number;
}

export interface VertexShapePart {
  shape: Exclude<MermaidShape, 'other'>;
  open: string;
  close: string;
  // The label exactly as written between opener and closer (quotes
  // included), so a shape change can keep it byte for byte.
  labelSpan: Span;
}

export interface VertexAttrsPart {
  // The `@{ … }` block.
  span: Span;
  shape: MermaidShape;
  // Span of the shape name / label value, when present (label value
  // includes its quotes).
  shapeSpan: Span | null;
  labelSpan: Span | null;
}

export interface VertexToken {
  kind: 'vertex';
  id: string;
  span: Span;
  idSpan: Span;
  // Present when the token carries a label (a definition).
  label?: string;
  markdown?: boolean;
  shape?: VertexShapePart;
  attrs?: VertexAttrsPart;
}

export interface AmpToken {
  kind: 'amp';
  span: Span;
}

export interface ArrowToken {
  kind: 'arrow';
  span: Span;
  stroke: EdgeStroke;
  ends: EdgeEnds;
  length: number;
  label?: string;
  markdown?: boolean;
  edgeId?: string;
}

export type FlowToken = VertexToken | AmpToken | ArrowToken;

interface StatementBase {
  span: Span;
  // Innermost enclosing subgraph (null at the top level).
  group: string | null;
}

export interface ChainStatement extends StatementBase {
  kind: 'chain';
  tokens: FlowToken[];
  // Graph edge indexes this statement defines, and for each the arrow
  // token (index into tokens) and the vertex tokens of its two ends.
  edges: Array<{ edge: number; arrow: number; from: number; to: number }>;
}

export interface SubgraphStatement extends StatementBase {
  kind: 'subgraph';
  id: string;
  // The header's text after `subgraph ` (id and / or title).
  headSpan: Span;
  idGenerated: boolean;
  // Span of the title as written (quotes included) when it is separate
  // from the id; null for `subgraph Id` (title = id).
  titleSpan: Span | null;
  titleForm: 'bracket' | 'quoted' | 'bare';
  // The matching `end` statement.
  end: Span;
}

export interface DirectionStatement extends StatementBase {
  kind: 'direction';
  value: MermaidDirection;
  valueSpan: Span;
}

export interface StyleStatement extends StatementBase {
  kind: 'style';
  id: string;
  props: StyleProps;
  propsSpan: Span;
}

export interface LinkStyleStatement extends StatementBase {
  kind: 'linkStyle';
  targets: number[] | 'default';
  targetsSpan: Span;
  props: StyleProps;
  propsSpan: Span;
}

export interface ClassStatement extends StatementBase {
  kind: 'class';
  ids: string[];
  idsSpan: Span;
}

export interface OtherStatement extends StatementBase {
  // classDef, click, accTitle / accDescr, the end of a subgraph, and a
  // lone `e1@{ … }` configuring a named edge.
  kind: 'classDef' | 'click' | 'acc' | 'end' | 'edgeAttrs';
  // Node id a click statement / edge id an edgeAttrs statement is about.
  id?: string;
}

export type FlowStatement =
  | ChainStatement
  | SubgraphStatement
  | DirectionStatement
  | StyleStatement
  | LinkStyleStatement
  | ClassStatement
  | OtherStatement;

export interface FlowchartSourceMap {
  source: string;
  // Line separator of the source ('\n' or '\r\n'), reused on output.
  eol: string;
  keyword: 'flowchart' | 'graph' | 'flowchart-elk';
  // The header statement (`flowchart LR`), and the direction token in
  // it (null for a bare `graph`).
  header: Span;
  directionSpan: Span | null;
  // The direction exactly as written (TB stays TB).
  rawDirection: string | null;
  statements: FlowStatement[];
  // graph.edges[i] ↔ the statement and arrow that define it.
  edgeSource: Array<{ stmt: number; arrow: number }>;
  // Every vertex token naming a node, in source order.
  nodeTokens: Map<string, Array<{ stmt: number; token: number }>>;
}

type ParseResult =
  | { ok: true; graph: MermaidGraph }
  | { ok: false; reason: string };

export type SourceParseResult =
  | { ok: true; graph: MermaidGraph; map: FlowchartSourceMap }
  | { ok: false; reason: string };

class FlowParseError extends Error {}

function fail(reason: string): never {
  throw new FlowParseError(reason);
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  nbsp: ' ',
};

// Decode mermaid's entity codes (`#quot;`, `#59;`, …) the way mermaid
// displays them — the inverse of the serializer's escaping. Unknown
// names are left as written.
export function decodeMermaidEntities(text: string): string {
  return text.replace(/#(\w+);/g, (m, name: string) => {
    if (/^\d+$/.test(name)) {
      // Out of Unicode range: fromCodePoint would throw. Keep as written.
      const n = Number(name);
      return n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[name] ?? m;
  });
}

// A label as mermaid shows it: quoted text loses its quotes, a
// "`…`" markdown string keeps its markdown (shown formatted), `<br>`
// reads as a line break, entity codes are decoded.
export function readLabel(raw: string): { label: string; markdown: boolean } {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    const inner = t.slice(1, -1);
    if (inner.length >= 2 && inner.startsWith('`') && inner.endsWith('`')) {
      return { label: dedentMarkdown(inner.slice(1, -1)), markdown: true };
    }
    return { label: breaks(decodeMermaidEntities(inner)), markdown: false };
  }
  return { label: breaks(decodeMermaidEntities(raw)), markdown: false };
}

const BR_RE = /<br\s*\/?>/gi;

function breaks(text: string): string {
  return text.replace(BR_RE, '\n');
}

// mermaid drops the indentation a multi-line markdown string's later
// lines carry in the source.
function dedentMarkdown(md: string): string {
  return md
    .split(/\r?\n/)
    .map((l, i) => (i === 0 ? l : l.replace(/^\s+/, '')))
    .join('\n');
}

const DIRECTIONS = new Set(['TB', 'TD', 'BT', 'RL', 'LR']);

function toDirection(raw: string): MermaidDirection {
  return raw === 'TB' ? 'TD' : (raw as MermaidDirection);
}

// Node ids: letters / digits / `_`, plus `-` and `.` when they can't
// start a link (mermaid's NODE_STRING rule: a dash not followed by
// `-`, `>` or `.`).
const ID_CHAR = /[\p{L}\p{N}_]/u;

function readId(text: string, pos: number): number {
  let p = pos;
  while (p < text.length) {
    const c = text[p];
    if (ID_CHAR.test(c)) p++;
    else if (c === '-' && p > pos && !/[->.]/.test(text[p + 1] ?? '') && ID_CHAR.test(text[p + 1] ?? '')) p++;
    else if (c === '.' && p > pos && ID_CHAR.test(text[p + 1] ?? '')) p++;
    else break;
  }
  return p;
}

// Classic shapes, longest opener first.
const SHAPES: Array<{ open: string; close: string[]; shapes: Array<Exclude<MermaidShape, 'other'>> }> = [
  { open: '(((', close: [')))'], shapes: ['doubleCircle'] },
  { open: '((', close: ['))'], shapes: ['circle'] },
  { open: '([', close: ['])'], shapes: ['stadium'] },
  { open: '(', close: [')'], shapes: ['rounded'] },
  { open: '[[', close: [']]'], shapes: ['subroutine'] },
  { open: '[(', close: [')]'], shapes: ['cylinder'] },
  { open: '[/', close: ['/]', '\\]'], shapes: ['parallelogram', 'trapezoid'] },
  { open: '[\\', close: ['\\]', '/]'], shapes: ['parallelogramAlt', 'trapezoidAlt'] },
  { open: '[', close: [']'], shapes: ['rect'] },
  { open: '{{', close: ['}}'], shapes: ['hexagon'] },
  { open: '{', close: ['}'], shapes: ['diamond'] },
  { open: '>', close: [']'], shapes: ['asymmetric'] },
];

export const SHAPE_DELIMS: Record<Exclude<MermaidShape, 'other'>, [string, string]> = {
  rect: ['[', ']'],
  rounded: ['(', ')'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  cylinder: ['[(', ')]'],
  circle: ['((', '))'],
  doubleCircle: ['(((', ')))'],
  asymmetric: ['>', ']'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  parallelogram: ['[/', '/]'],
  parallelogramAlt: ['[\\', '\\]'],
  trapezoid: ['[/', '\\]'],
  trapezoidAlt: ['[\\', '/]'],
};

// v11 `@{ shape: … }` names for the classic shapes (first is the one
// written), and every alias mermaid accepts for them.
export const ATTR_SHAPE_NAMES: Record<Exclude<MermaidShape, 'other'>, string[]> = {
  rect: ['rect', 'rectangle', 'proc', 'process', 'square'],
  rounded: ['rounded', 'event'],
  stadium: ['stadium', 'pill', 'terminal'],
  subroutine: ['subproc', 'fr-rect', 'subprocess', 'subroutine', 'framed-rectangle'],
  cylinder: ['cyl', 'cylinder', 'database', 'db'],
  circle: ['circle', 'circ'],
  doubleCircle: ['dbl-circ', 'double-circle'],
  asymmetric: ['odd'],
  diamond: ['diam', 'diamond', 'decision', 'question'],
  hexagon: ['hex', 'hexagon', 'prepare'],
  parallelogram: ['lean-r', 'lean-right', 'in-out'],
  parallelogramAlt: ['lean-l', 'lean-left', 'out-in'],
  trapezoid: ['trap-b', 'trapezoid-bottom', 'priority', 'trapezoid'],
  trapezoidAlt: ['trap-t', 'trapezoid-top', 'manual', 'inv-trapezoid'],
};

function shapeFromAttrName(name: string): MermaidShape {
  for (const [shape, names] of Object.entries(ATTR_SHAPE_NAMES)) {
    if (names.includes(name)) return shape as MermaidShape;
  }
  return 'other';
}

// End of a quoted string starting at `pos` (the opening quote): the
// offset just past the closing quote. Quotes may span lines.
function readQuoted(text: string, pos: number, limit: number): number {
  const close = text.indexOf('"', pos + 1);
  if (close === -1 || close >= limit) fail('unterminated string');
  return close + 1;
}

// One vertex token at `pos`: id, then an optional shape or `@{…}`, then
// optional `:::class` names.
function readVertex(text: string, pos: number, limit: number): VertexToken {
  const idEnd = readId(text, pos);
  if (idEnd === pos) fail(`unexpected text: ${text.slice(pos, Math.min(limit, pos + 20))}`);
  const id = text.slice(pos, idEnd);
  let p = idEnd;
  const tok: VertexToken = { kind: 'vertex', id, span: { start: pos, end: p }, idSpan: { start: pos, end: idEnd } };

  if (text.startsWith('@{', p)) {
    const end = matchBrace(text, p + 1, limit);
    const body = text.slice(p + 2, end - 1);
    const bodyStart = p + 2;
    let shape: MermaidShape = 'rect';
    let shapeSpan: Span | null = null;
    let labelSpan: Span | null = null;
    const sm = /(^|[\s,{])shape\s*:\s*([\w-]+)/.exec(body);
    if (sm) {
      const s = bodyStart + sm.index + sm[1].length + sm[0].slice(sm[1].length).indexOf(sm[2]);
      shapeSpan = { start: s, end: s + sm[2].length };
      shape = shapeFromAttrName(sm[2]);
    }
    const lm = /(^|[\s,{])label\s*:\s*/.exec(body);
    if (lm) {
      const vs = bodyStart + lm.index + lm[0].length;
      let ve: number;
      if (text[vs] === '"') ve = readQuoted(text, vs, end);
      else {
        const rest = text.slice(vs, end - 1);
        const stop = rest.search(/[,\n}]/);
        ve = vs + (stop === -1 ? rest.length : stop);
        while (ve > vs && /\s/.test(text[ve - 1])) ve--;
      }
      labelSpan = { start: vs, end: ve };
      const raw = text.slice(vs, ve);
      const quoted = raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2;
      // mermaid reads every @{} label as markdown.
      tok.label = quoted ? dedentMarkdown(raw.slice(1, -1).replace(/^`([\s\S]*)`$/, '$1')) : raw;
      tok.markdown = true;
    }
    tok.attrs = { span: { start: p, end }, shape, shapeSpan, labelSpan };
    p = end;
  } else {
    const shape = SHAPES.find((s) => text.startsWith(s.open, p));
    if (shape) {
      const labelStart = p + shape.open.length;
      let labelEnd: number;
      let closeAt: number;
      let close: string;
      let kind: Exclude<MermaidShape, 'other'>;
      if (text[labelStart] === '"') {
        labelEnd = readQuoted(text, labelStart, limit);
        const i = shape.close.findIndex((c) => text.startsWith(c, labelEnd));
        // Spaces may follow the closing quote before the closer.
        let q = labelEnd;
        while (i === -1 && q < limit && /[ \t]/.test(text[q])) q++;
        const j = i !== -1 ? i : shape.close.findIndex((c) => text.startsWith(c, q));
        if (j === -1) fail(`unclosed shape after: ${id}`);
        close = shape.close[j];
        kind = shape.shapes[j];
        closeAt = i !== -1 ? labelEnd : q;
        labelEnd = closeAt;
      } else {
        // Unquoted: the nearest closer. mermaid rejects unquoted labels
        // holding shape or link syntax, so finding the wrong closer
        // means the label isn't one we (or mermaid) can read.
        let best = -1;
        let which = -1;
        shape.close.forEach((c, k) => {
          const at = text.indexOf(c, labelStart);
          if (at !== -1 && at < limit && (best === -1 || at < best)) {
            best = at;
            which = k;
          }
        });
        if (best === -1) fail(`unclosed shape after: ${id}`);
        const raw = text.slice(labelStart, best);
        if (/[[\](){}"]/.test(raw) || /\n/.test(raw)) fail(`unreadable label: ${raw}`);
        // `[/x\]` closes with `\]` — but so might a parallelogram label
        // ending in a backslash; the closer list order decides.
        close = shape.close[which];
        kind = shape.shapes[which];
        closeAt = best;
        labelEnd = best;
      }
      const rawLabel = text.slice(labelStart, labelEnd);
      const read = readLabel(rawLabel);
      tok.label = read.label;
      if (read.markdown) tok.markdown = true;
      tok.shape = { shape: kind, open: shape.open, close, labelSpan: { start: labelStart, end: labelEnd } };
      p = closeAt + close.length;
    }
  }
  // `:::class` (one or more, comma separated in mermaid's grammar).
  if (text.startsWith(':::', p)) {
    let q = p + 3;
    while (q < limit && /[\p{L}\p{N}_,-]/u.test(text[q])) q++;
    p = q;
  }
  tok.span = { start: pos, end: p };
  return tok;
}

// `{` at `pos` → offset just past its matching `}` (quotes skipped).
function matchBrace(text: string, pos: number, limit: number): number {
  let depth = 0;
  for (let p = pos; p < limit; p++) {
    const c = text[p];
    if (c === '"') {
      p = readQuoted(text, p, limit) - 1;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return p + 1;
    }
  }
  fail('unclosed {');
}

const ENDS_BY_HEAD: Record<string, Record<string, EdgeEnds | undefined>> = {
  '': { '>': 'arrow', x: 'cross', o: 'circle', '': 'none', '-': 'none', '=': 'none', '.': 'none' },
  '<': { '>': 'both-arrow' },
  x: { x: 'both-cross' },
  o: { o: 'both-circle' },
};

function endsOf(head: string, tail: string): EdgeEnds {
  const ends = ENDS_BY_HEAD[head]?.[tail];
  if (!ends) fail(`unsupported link ends: ${head}…${tail}`);
  return ends;
}

// A link with no inline text: `-->`, `---`, `-.->`, `==>`, `~~~`, `<-->`,
// `x--x`, … of any length. Returns null when `pos` doesn't start one.
function readPlainLink(text: string, pos: number): { end: number; stroke: EdgeStroke; ends: EdgeEnds; length: number } | null {
  const s = text.slice(pos, pos + 64);
  let m = /^~~~+/.exec(s);
  if (m) return { end: pos + m[0].length, stroke: 'invisible', ends: 'none', length: m[0].length - 2 };
  m = /^([xo<]?)(--+)([->xo])/.exec(s);
  // mermaid's length: `-->` and `---` are 1, each extra dash adds one
  // (`---->` is 3).
  if (m) return { end: pos + m[0].length, stroke: 'solid', ends: endsOf(m[1], m[3]), length: m[2].length - 1 };
  m = /^([xo<]?)(==+)([=>xo])/.exec(s);
  if (m) return { end: pos + m[0].length, stroke: 'thick', ends: endsOf(m[1], m[3]), length: m[2].length - 1 };
  m = /^([xo<]?)-?(\.+)-([>xo]?)/.exec(s);
  if (m) return { end: pos + m[0].length, stroke: 'dotted', ends: endsOf(m[1], m[3]), length: m[2].length };
  return null;
}

// `-- text -->`, `== text ==>`, `-. text .->`: start marker, free text,
// then the closing link of the same family.
function readInlineLink(text: string, pos: number, limit: number) {
  const m = /^([xo<]?)(--|==|-\.)(?![->=.xo])/.exec(text.slice(pos, pos + 4));
  if (!m) return null;
  const family = m[2];
  const textStart = pos + m[0].length;
  const closer = family === '--' ? /(--+)([->xo])/g : family === '==' ? /(==+)([=>xo])/g : /(\.+)-([>xo]?)/g;
  closer.lastIndex = textStart;
  let c: RegExpExecArray | null;
  let textEnd = -1;
  let closeEnd = -1;
  let tail = '';
  let length = 1;
  // Quoted inline text may hold anything; skip over it.
  let from = textStart;
  while (from < limit && /\s/.test(text[from])) from++;
  if (text[from] === '"') closer.lastIndex = readQuoted(text, from, limit);
  while ((c = closer.exec(text)) && c.index < limit) {
    textEnd = c.index;
    closeEnd = c.index + c[0].length;
    tail = c[2];
    length = family === '-.' ? c[1].length : c[1].length - 1;
    break;
  }
  if (textEnd === -1) return null;
  const raw = text.slice(textStart, textEnd);
  if (/\n/.test(raw.replace(/"[^"]*"/g, ''))) return null;
  const stroke: EdgeStroke = family === '--' ? 'solid' : family === '==' ? 'thick' : 'dotted';
  return { end: closeEnd, stroke, ends: endsOf(m[1], tail), length, raw };
}

function tokenizeChain(text: string, start: number, end: number): FlowToken[] {
  const tokens: FlowToken[] = [];
  let p = start;
  const skipWs = () => {
    while (p < end && /\s/.test(text[p])) p++;
  };
  let expectVertex = true;
  while (true) {
    skipWs();
    if (p >= end) break;
    if (expectVertex) {
      const v = readVertex(text, p, end);
      tokens.push(v);
      p = v.span.end;
      expectVertex = false;
      continue;
    }
    if (text[p] === '&') {
      tokens.push({ kind: 'amp', span: { start: p, end: p + 1 } });
      p++;
      expectVertex = true;
      continue;
    }
    // Link, optionally with an edge id prefix (`e1@-->`).
    const arrowStart = p;
    let edgeId: string | undefined;
    const idEnd = readId(text, p);
    if (idEnd > p && text[idEnd] === '@' && text[idEnd + 1] !== '{') {
      edgeId = text.slice(p, idEnd);
      p = idEnd + 1;
    }
    let label: string | undefined;
    let markdown = false;
    const inline = readInlineLink(text, p, end);
    const plain = inline ? null : readPlainLink(text, p);
    if (!inline && !plain) fail(`unexpected text: ${text.slice(p, Math.min(end, p + 20))}`);
    let q: number;
    let stroke: EdgeStroke;
    let ends: EdgeEnds;
    let length: number;
    if (inline) {
      ({ stroke, ends, length } = inline);
      q = inline.end;
      const read = readLabel(inline.raw);
      label = read.label.trim();
      markdown = read.markdown;
    } else {
      ({ stroke, ends, length } = plain!);
      q = plain!.end;
      // `|label|` right after the link (spaces allowed before it).
      let r = q;
      while (r < end && /[ \t]/.test(text[r])) r++;
      if (text[r] === '|') {
        let close: number;
        if (text[r + 1] === '"') {
          const qe = readQuoted(text, r + 1, end);
          if (text[qe] !== '|') fail('bad link label');
          close = qe;
        } else {
          close = text.indexOf('|', r + 1);
          if (close === -1 || close >= end) fail('unclosed link label');
        }
        const read = readLabel(text.slice(r + 1, close));
        label = read.label;
        markdown = read.markdown;
        q = close + 1;
      }
    }
    const tok: ArrowToken = { kind: 'arrow', span: { start: arrowStart, end: q }, stroke, ends, length };
    if (label) tok.label = label;
    if (label && markdown) tok.markdown = true;
    if (edgeId) tok.edgeId = edgeId;
    tokens.push(tok);
    p = q;
    expectVertex = true;
  }
  if (expectVertex && tokens.length) fail('link with no destination');
  return tokens;
}

function parseStyleProps(text: string, start: number, end: number): { props: StyleProps; span: Span } {
  let s = start;
  while (s < end && /\s/.test(text[s])) s++;
  let e = end;
  while (e > s && /[\s;]/.test(text[e - 1])) e--;
  const props = text
    .slice(s, e)
    .split(',')
    .map((part) => {
      const i = part.indexOf(':');
      return i === -1 ? null : { name: part.slice(0, i).trim(), value: part.slice(i + 1).trim() };
    })
    .filter((p): p is { name: string; value: string } => !!p && !!p.name);
  return { props, span: { start: s, end: e } };
}

// Split the body into statements: up to a newline or `;` that is not
// inside a quoted string, bracket or brace. `%%` starts a comment that
// runs to the end of the line.
function splitStatements(text: string, from: number): Span[] {
  const out: Span[] = [];
  let p = from;
  const n = text.length;
  while (p < n) {
    while (p < n && /[\s;]/.test(text[p])) p++;
    if (p >= n) break;
    if (text.startsWith('%%', p)) {
      const nl = text.indexOf('\n', p);
      p = nl === -1 ? n : nl + 1;
      continue;
    }
    const start = p;
    // Open brackets, innermost last. Only a `{` block (`@{ … }`,
    // `accDescr { … }`) may run over several lines; an unbalanced `(` or
    // `[` must not swallow the lines after it.
    const stack: string[] = [];
    while (p < n) {
      const c = text[p];
      if (c === '"') {
        p = readQuoted(text, p, n);
        continue;
      }
      if (c === '[' || c === '(' || c === '{') stack.push(c);
      else if ((c === ']' || c === ')' || c === '}') && stack.length) stack.pop();
      else if (c === '\n' && stack.length && !stack.includes('{')) stack.length = 0;
      if (!stack.length && (c === '\n' || c === ';')) break;
      if (!stack.length && c === '%' && text[p + 1] === '%') break;
      p++;
    }
    let end = p;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end > start) out.push({ start, end });
  }
  return out;
}

export function parseMermaidSource(source: string): SourceParseResult {
  try {
    return parseOrThrow(source);
  } catch (e) {
    if (e instanceof FlowParseError) return { ok: false, reason: e.message };
    throw e;
  }
}

function parseOrThrow(source: string): SourceParseResult {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const { headerLine } = findPreamble(lines);
  if (headerLine === -1) return { ok: false, reason: 'empty source' };
  let headerOffset = 0;
  for (let i = 0; i < headerLine; i++) headerOffset += lines[i].length + (source.startsWith('\r\n', headerOffset + lines[i].length) ? 2 : 1);

  const hm = /^(\s*)(flowchart-elk|flowchart|graph)(?:([ \t]+)(TB|TD|BT|RL|LR))?[ \t]*(?=;|$|\r?\n)/.exec(source.slice(headerOffset));
  if (!hm) return { ok: false, reason: `unsupported directive: ${lines[headerLine].trim()}` };
  const keyword = hm[2] as FlowchartSourceMap['keyword'];
  const rawDirection = hm[4] ?? null;
  const dirStart = headerOffset + hm[1].length + hm[2].length + (hm[3]?.length ?? 0);
  const header = { start: headerOffset + hm[1].length, end: headerOffset + hm[0].trimEnd().length };
  const directionSpan = rawDirection ? { start: dirStart, end: dirStart + rawDirection.length } : null;

  const graph: MermaidGraph = { ...emptyGraph(), direction: rawDirection && DIRECTIONS.has(rawDirection) ? toDirection(rawDirection) : 'TD' };
  const statements: FlowStatement[] = [];
  const edgeSource: FlowchartSourceMap['edgeSource'] = [];
  const nodeTokens: FlowchartSourceMap['nodeTokens'] = new Map();

  // Subgraph blocks being read, innermost last, with what they mention.
  const open: Array<{ stmt: number; id: string; mentions: string[] }> = [];
  // Subgraphs in the order mermaid registers them (when closed).
  const closed: Array<{ id: string; mentions: string[] }> = [];
  const firstSeen: string[] = [];
  const seen = new Set<string>();
  const mention = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      firstSeen.push(id);
    }
    open[open.length - 1]?.mentions.push(id);
  };
  const userEdgeIds = new Set<string>();
  const styleStmts: StyleStatement[] = [];
  const linkStyleStmts: LinkStyleStatement[] = [];

  for (const span of splitStatements(source, header.end)) {
    const text = source.slice(span.start, span.end);
    const group = open.length ? open[open.length - 1].id : null;
    const kw = /^([A-Za-z]+)\b/.exec(text)?.[1] ?? '';
    const stmtIndex = statements.length;

    if (kw === 'subgraph' && /^subgraph\s/.test(text)) {
      const headStart = span.start + /^subgraph\s+/.exec(text)![0].length;
      const head = source.slice(headStart, span.end);
      let id: string;
      let title: string;
      let titleSpan: Span | null = null;
      let titleForm: SubgraphStatement['titleForm'] = 'bare';
      let idGenerated = false;
      let markdown = false;
      const bm = /^([^\s[\]"]+)\s*\[([\s\S]*)\]$/.exec(head);
      if (bm) {
        id = bm[1];
        const ts = headStart + head.indexOf('[', bm[1].length) + 1;
        titleSpan = { start: ts, end: span.end - 1 };
        titleForm = 'bracket';
        const read = readLabel(bm[2]);
        title = read.label;
        markdown = read.markdown;
      } else if (head.startsWith('"')) {
        if (!head.endsWith('"')) fail(`unreadable subgraph: ${text}`);
        titleSpan = { start: headStart, end: span.end };
        titleForm = 'quoted';
        const read = readLabel(head);
        title = read.label;
        markdown = read.markdown;
        id = '';
        idGenerated = true;
      } else {
        title = head.trim();
        id = title;
        // mermaid generates an id when the bare title has spaces.
        if (/\s/.test(title)) {
          id = '';
          idGenerated = true;
          titleSpan = { start: headStart, end: span.end };
        }
        if (/["[\]]/.test(title)) fail(`unreadable subgraph: ${text}`);
      }
      // An id-less subgraph gets its id when it closes (see `end`);
      // until then a placeholder no real id can collide with stands in.
      if (idGenerated) id = `#pending${stmtIndex}`;
      statements.push({ kind: 'subgraph', span, group, id, headSpan: { start: headStart, end: span.end }, idGenerated, titleSpan, titleForm, end: span });
      if (!idGenerated) mention(id);
      open.push({ stmt: stmtIndex, id, mentions: [] });
      graph.subgraphs.set(id, { id, title, parent: group, ...(markdown ? { markdown: true as const } : {}) });
      continue;
    }
    if (text === 'end') {
      const block = open.pop();
      if (!block) fail('end without subgraph');
      const sg = statements[block.stmt] as SubgraphStatement;
      sg.end = span;
      if (sg.idGenerated) {
        // mermaid names an id-less subgraph after how many subgraphs it
        // has registered so far.
        const id = `subGraph${closed.length}`;
        const tmpKey = block.id;
        const entry = graph.subgraphs.get(tmpKey)!;
        graph.subgraphs.delete(tmpKey);
        sg.id = id;
        block.id = id;
        graph.subgraphs.set(id, { ...entry, id });
        // Children recorded the placeholder as their parent.
        for (const [k, s] of graph.subgraphs) if (s.parent === tmpKey) graph.subgraphs.set(k, { ...s, parent: id });
        for (const st of statements) if (st.group === tmpKey) st.group = id;
        open[open.length - 1]?.mentions.push(id);
      }
      closed.push({ id: block.id, mentions: block.mentions });
      statements.push({ kind: 'end', span, group: open.length ? open[open.length - 1].id : null });
      continue;
    }
    if (kw === 'direction') {
      const m = /^direction\s+(TB|TD|BT|RL|LR)$/.exec(text);
      if (!m) fail(`unreadable direction: ${text}`);
      const vs = span.start + text.length - m[1].length;
      statements.push({ kind: 'direction', span, group, value: toDirection(m[1]), valueSpan: { start: vs, end: span.end } });
      // Outside any subgraph `direction` sets the chart's direction.
      if (!group) graph.direction = toDirection(m[1]);
      continue;
    }
    if (kw === 'style' && /^style\s/.test(text)) {
      const m = /^style\s+(\S+)\s+/.exec(text);
      if (!m) fail(`unreadable style: ${text}`);
      const { props, span: propsSpan } = parseStyleProps(source, span.start + m[0].length, span.end);
      const st: StyleStatement = { kind: 'style', span, group, id: m[1], props, propsSpan };
      statements.push(st);
      styleStmts.push(st);
      continue;
    }
    if (kw === 'linkStyle' && /^linkStyle\s/.test(text)) {
      const m = /^linkStyle\s+(default|\d+(?:\s*,\s*\d+)*)\s*/.exec(text);
      if (!m) fail(`unreadable linkStyle: ${text}`);
      const ts = span.start + text.indexOf(m[1], 9);
      const targets = m[1] === 'default' ? 'default' : m[1].split(',').map((x) => Number(x.trim()));
      // `linkStyle 0 interpolate basis …` sets a curve, not a style.
      if (/^interpolate\b/.test(text.slice(m[0].length))) {
        statements.push({ kind: 'classDef', span, group });
        continue;
      }
      const { props, span: propsSpan } = parseStyleProps(source, span.start + m[0].length, span.end);
      const st: LinkStyleStatement = { kind: 'linkStyle', span, group, targets, targetsSpan: { start: ts, end: ts + m[1].length }, props, propsSpan };
      statements.push(st);
      linkStyleStmts.push(st);
      continue;
    }
    if (kw === 'classDef' && /^classDef\s/.test(text)) {
      statements.push({ kind: 'classDef', span, group });
      continue;
    }
    if (kw === 'class' && /^class\s/.test(text)) {
      const m = /^class\s+([^\s]+)\s+\S+$/.exec(text);
      if (!m) fail(`unreadable class: ${text}`);
      const is = span.start + 'class'.length + /^\s+/.exec(text.slice(5))![0].length;
      statements.push({ kind: 'class', span, group, ids: m[1].split(','), idsSpan: { start: is, end: is + m[1].length } });
      continue;
    }
    if ((kw === 'click' || kw === 'call') && /^(click|call)\s/.test(text)) {
      statements.push({ kind: 'click', span, group, id: /^\w+\s+(\S+)/.exec(text)?.[1] });
      continue;
    }
    if (/^acc(Title|Descr)\b/.test(text)) {
      statements.push({ kind: 'acc', span, group });
      continue;
    }

    // A chain: vertex groups joined by links.
    const tokens = tokenizeChain(source, span.start, span.end);
    // A lone `e1@{…}` statement configures an edge, not a node.
    if (tokens.length === 1 && tokens[0].kind === 'vertex' && userEdgeIds.has(tokens[0].id)) {
      statements.push({ kind: 'edgeAttrs', span, group, id: tokens[0].id });
      continue;
    }
    const st: ChainStatement = { kind: 'chain', span, group, tokens, edges: [] };
    statements.push(st);
    // Groups of vertex token indexes between arrows.
    const groups: number[][] = [[]];
    const arrows: number[] = [];
    tokens.forEach((t, k) => {
      if (t.kind === 'vertex') groups[groups.length - 1].push(k);
      else if (t.kind === 'arrow') {
        arrows.push(k);
        groups.push([]);
      }
    });
    for (const g of groups) {
      for (const k of g) {
        const t = tokens[k] as VertexToken;
        mention(t.id);
        const refs = nodeTokens.get(t.id) ?? [];
        refs.push({ stmt: stmtIndex, token: k });
        nodeTokens.set(t.id, refs);
        const existing = graph.nodes.get(t.id);
        // Last definition wins, field by field (mermaid's addVertex
        // overwrites text and type only when given).
        const shape = t.attrs ? t.attrs.shape : t.shape ? t.shape.shape : undefined;
        const node = existing ?? { id: t.id, shape: 'rect' as MermaidShape, label: t.id };
        const next = { ...node };
        if (shape && (!t.attrs || t.attrs.shapeSpan)) next.shape = shape;
        if (t.label !== undefined) {
          next.label = t.label;
          if (t.markdown) next.markdown = true;
          else delete next.markdown;
        }
        graph.nodes.set(t.id, next);
      }
    }
    arrows.forEach((ak, i) => {
      const a = tokens[ak] as ArrowToken;
      const left = groups[i];
      const right = groups[i + 1];
      if (a.edgeId && left.length * right.length > 1) fail('edge id on a group link');
      if (a.edgeId) userEdgeIds.add(a.edgeId);
      for (const fk of left) {
        for (const tk of right) {
          const from = (tokens[fk] as VertexToken).id;
          const to = (tokens[tk] as VertexToken).id;
          const edge: MermaidGraph['edges'][number] = { from, to };
          if (a.label) edge.label = a.label;
          if (a.label && a.markdown) edge.markdown = true;
          if (a.stroke !== 'solid') edge.stroke = a.stroke;
          if (a.ends !== 'arrow') edge.ends = a.ends;
          if (a.length !== 1) edge.length = a.length;
          if (a.edgeId) edge.id = a.edgeId;
          st.edges.push({ edge: graph.edges.length, arrow: ak, from: fk, to: tk });
          edgeSource.push({ stmt: stmtIndex, arrow: ak });
          graph.edges.push(edge);
        }
      }
    });
  }
  if (open.length) fail('subgraph without end');

  // Subgraphs in source order (an id-less one was re-keyed on close).
  const sgOrder = statements.filter((s): s is SubgraphStatement => s.kind === 'subgraph').map((s) => s.id);
  graph.subgraphs = new Map(sgOrder.map((id) => [id, graph.subgraphs.get(id)!]));
  // Subgraph ids are clusters, not nodes (mermaid creates a vertex for
  // an edge's subgraph end but draws the cluster).
  for (const id of graph.subgraphs.keys()) graph.nodes.delete(id);
  // Map order = first appearance (mermaid's vertex order).
  const ordered = new Map<string, MermaidGraph['nodes'] extends Map<string, infer N> ? N : never>();
  for (const id of firstSeen) {
    const n = graph.nodes.get(id);
    if (n) ordered.set(id, n);
  }
  graph.nodes = ordered;

  // Membership (mermaid's makeUniq): in the order subgraphs close, each
  // claims what its block mentions directly and nobody claimed before.
  const claimed = new Set<string>();
  for (const c of closed) {
    for (const id of c.mentions) {
      if (claimed.has(id) || id === c.id) continue;
      claimed.add(id);
      if (graph.subgraphs.has(id)) {
        const s = graph.subgraphs.get(id)!;
        graph.subgraphs.set(id, { ...s, parent: c.id });
      } else {
        graph.groupOf.set(id, c.id);
      }
    }
  }
  // Re-derive structural parents for subgraphs nobody claimed.
  for (const [id, s] of graph.subgraphs) {
    if (s.parent && !claimed.has(id)) graph.subgraphs.set(id, { ...s, parent: null });
  }

  // Effective styles: for nodes, `style` statements accumulate; for
  // edges, each linkStyle naming an edge replaces its style.
  for (const st of styleStmts) {
    const cur = graph.nodeStyles.get(st.id) ?? [];
    let next = cur;
    for (const p of st.props) {
      const i = next.findIndex((q) => q.name === p.name);
      next = i === -1 ? [...next, p] : next.map((q, k) => (k === i ? p : q));
    }
    graph.nodeStyles.set(st.id, next);
  }
  for (const st of linkStyleStmts) {
    if (st.targets === 'default') continue;
    for (const i of st.targets) {
      if (i >= graph.edges.length) fail(`linkStyle ${i} is out of bounds`);
      graph.edgeStyles.set(i, st.props);
    }
  }

  return {
    ok: true,
    graph,
    map: { source, eol, keyword, header, directionSpan, rawDirection, statements, edgeSource, nodeTokens },
  };
}

export function parseMermaid(source: string): ParseResult {
  const r = parseMermaidSource(source);
  return r.ok ? { ok: true, graph: r.graph } : r;
}
