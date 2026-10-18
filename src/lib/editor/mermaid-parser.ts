// Subset parser for mermaid flowcharts. Supports the syntax the
// editor's visual UI can fully round-trip; anything else returns
// `{ ok: false, reason }` and the NodeView falls back to render-only.
//
// Supported:
//   - `flowchart TD/TB/LR/BT/RL` directive (TB reads as TD in the graph;
//     the source keeps whichever spelling it had)
//   - Node shapes: rect `A[label]`, rounded `A(label)`, circle `A((label))`,
//     diamond `A{label}`, hexagon `A{{label}}`, cylinder `A[(label)]`,
//     stadium `A([label])`, parallelogram `A[/label/]`
//   - Edges: arrow `A --> B`, line `A --- B`, dotted `A -.-> B`,
//     thick `A ==> B`, all with optional `|text|` labels
//   - Inline node definitions on edge lines: `A[a] --> B[b] --> C[c]`
//   - Quoted labels: `A["has [brackets]"]` (node and edge labels);
//     mermaid entity codes (`#quot;`, `#59;`, …) are decoded
//   - A node defined more than once: the LAST definition wins, as in
//     mermaid (flowDb overwrites text and shape on each definition)
//   - Blank lines and `%%` comments (including `%%{init: …}%%`)
//
// Not supported (parser bails to `ok: false`):
//   - Other diagram types (sequenceDiagram, classDiagram, etc.)
//   - The legacy `graph` keyword
//   - Subgraphs (`subgraph` ... `end`)
//   - classDef / class / click / style / linkStyle directives
//   - Other shapes (asymmetric `A>...]`, trapezoid `A[\...\]`, etc.)
//   - Other edge styles (`A -.- B` un-arrowed dotted, etc.)
//
// Besides the graph, parseMermaidSource returns a source map: where
// each statement, token, node definition and edge sits in the source
// text. The visual editor (mermaid-flowchart-edit.ts) uses it to
// change ONLY the text an edit is about, leaving every other line —
// comments, directives, blank lines, chain formatting — byte-identical.
import {
  emptyGraph,
  type MermaidGraph,
  type MermaidShape,
  type MermaidDirection,
  type EdgeStyle,
} from './mermaid-graph';

// Column range [start, end) within one source line.
export interface Span {
  start: number;
  end: number;
}

export type FlowToken =
  // labelSpan: the label exactly as written between the shape's opener
  // and closer (quotes included), so a shape change can keep it byte
  // for byte.
  | { kind: 'node'; id: string; shape: MermaidShape; label: string; span: Span; labelSpan: Span }
  | { kind: 'noderef'; id: string; span: Span }
  | { kind: 'arrow'; label?: string; style: EdgeStyle; span: Span };

// One body line that holds a statement (a chain of tokens).
export interface FlowStatement {
  line: number;
  tokens: FlowToken[];
}

// Points at one token: statements[stmt].tokens[token].
export interface TokenRef {
  stmt: number;
  token: number;
}

export interface FlowchartSourceMap {
  lines: string[];
  // Line separator of the source ('\n' or '\r\n'), reused on output.
  eol: string;
  directiveLine: number;
  // Span of the direction keyword (`TD`, `TB`, …) in the directive line.
  directionSpan: Span;
  // The direction exactly as written (TB stays TB).
  rawDirection: string;
  statements: FlowStatement[];
  // edges[i] of the graph ↔ the arrow token that created it.
  edgeArrows: TokenRef[];
  // Every token (definition or bare reference) naming a node, in
  // source order.
  nodeTokens: Map<string, TokenRef[]>;
}

type ParseResult =
  | { ok: true; graph: MermaidGraph }
  | { ok: false; reason: string };

export type SourceParseResult =
  | { ok: true; graph: MermaidGraph; map: FlowchartSourceMap }
  | { ok: false; reason: string };

const ID_RE = /^[A-Za-z][A-Za-z0-9_]*/;
// Priority matters: multi-char shape openers MUST come before
// single-char ones (e.g. `[(` before `[`) so the regex matches the
// longer pattern first.
const SHAPE_RE = /^(\[\[|\[\(|\[\/|\(\(|\(\[|\{\{|\[|\(|\{)/;

// Edge tokens: try styles in priority order (longest first so `-.->`
// doesn't get parsed as `-` plus `-->`). The captured `label` is
// optional — same `|text|` syntax for all styles.
const EDGE_PREFIXES: Array<{ prefix: string; style: EdgeStyle }> = [
  { prefix: '-.->', style: 'dotted' },
  { prefix: '-->', style: 'arrow' },
  { prefix: '---', style: 'line' },
  { prefix: '==>', style: 'thick' },
];

const OPEN_TO_SHAPE: Record<string, MermaidShape> = {
  '[': 'rect',
  '(': 'rounded',
  '((': 'circle',
  '{': 'diamond',
  '{{': 'hexagon',
  '[(': 'cylinder',
  '([': 'stadium',
  '[/': 'parallelogram',
};
const SHAPE_CLOSE: Record<MermaidShape, string> = {
  rect: ']',
  rounded: ')',
  circle: '))',
  diamond: '}',
  hexagon: '}}',
  cylinder: ')]',
  stadium: '])',
  parallelogram: '/]',
};

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  nbsp: ' ',
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

// Tokenize one line (positions are columns in the ORIGINAL line).
// Returns null on anything outside the subset.
function tokenizeLine(line: string): FlowToken[] | null {
  const tokens: FlowToken[] = [];
  let pos = 0;
  const n = line.length;
  while (pos < n) {
    if (line[pos] === ' ' || line[pos] === '\t') {
      pos++;
      continue;
    }
    const s = line.slice(pos);
    // Edge: all styles share the optional `|label|` syntax.
    const edge = EDGE_PREFIXES.find((e) => s.startsWith(e.prefix));
    if (edge) {
      const start = pos;
      let p = pos + edge.prefix.length;
      let label: string | undefined;
      if (line[p] === '|') {
        if (line[p + 1] === '"') {
          // Quoted edge label — pipes are allowed inside the quotes.
          const endQuote = line.indexOf('"', p + 2);
          if (endQuote === -1 || line[endQuote + 1] !== '|') return null;
          label = decodeMermaidEntities(line.slice(p + 2, endQuote));
          p = endQuote + 2;
        } else {
          const closeIdx = line.indexOf('|', p + 1);
          if (closeIdx === -1) return null;
          label = decodeMermaidEntities(line.slice(p + 1, closeIdx));
          p = closeIdx + 1;
        }
      }
      tokens.push({ kind: 'arrow', label, style: edge.style, span: { start, end: p } });
      pos = p;
      continue;
    }
    // ID (start of a node-def or node-ref)
    const idMatch = ID_RE.exec(s);
    if (!idMatch) return null;
    const start = pos;
    const id = idMatch[0];
    pos += id.length;
    const shapeMatch = SHAPE_RE.exec(line.slice(pos));
    if (!shapeMatch) {
      tokens.push({ kind: 'noderef', id, span: { start, end: pos } });
      continue;
    }
    const open = shapeMatch[0];
    const shape = OPEN_TO_SHAPE[open] ?? 'rect';
    const close = SHAPE_CLOSE[shape];
    pos += open.length;
    let label: string;
    const labelStart = pos;
    if (line[pos] === '"') {
      // Quoted label: read to the closing quote. Embedded quotes use
      // mermaid's #quot; entity — the doubled-"" escape is NOT valid
      // mermaid 11 grammar, so we don't accept it either.
      const endQuote = line.indexOf('"', pos + 1);
      if (endQuote === -1) return null;
      label = decodeMermaidEntities(line.slice(pos + 1, endQuote));
      pos = endQuote + 1;
    } else {
      const closeIdx = line.indexOf(close, pos);
      if (closeIdx === -1) return null;
      const raw = line.slice(pos, closeIdx);
      // The closer search can run past the real end of this node into
      // the next one (`A[/in\] --> B[/out/]` — a trapezoid, not in the
      // subset — "closes" at B's `/]`), and mermaid itself rejects
      // unquoted labels holding shape or link syntax. Either way it's
      // not ours to edit: bail rather than misread the line. Same for
      // the backslash trapezoid / parallelogram variants.
      if (
        /[[\](){}|"]/.test(raw) ||
        /-->|---|==>|-\.-|<--/.test(raw) ||
        (open === '[' && raw.startsWith('\\')) ||
        (open === '[/' && raw.endsWith('\\'))
      ) {
        return null;
      }
      label = decodeMermaidEntities(raw);
      pos = closeIdx;
    }
    if (!line.startsWith(close, pos)) return null;
    const labelSpan = { start: labelStart, end: pos };
    pos += close.length;
    tokens.push({ kind: 'node', id, shape, label, span: { start, end: pos }, labelSpan });
  }
  return tokens;
}

export function parseMermaidSource(source: string): SourceParseResult {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);

  // 1. Find the directive — must be the first non-blank, non-comment line.
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.length === 0 || t.startsWith('%%')) { i++; continue; }
    break;
  }
  if (i >= lines.length) {
    return { ok: false, reason: 'empty source' };
  }
  const directiveLine = i;
  const flowchartMatch = /^(\s*flowchart\s+)(TD|TB|LR|BT|RL)\s*$/.exec(lines[i]);
  if (!flowchartMatch) {
    return { ok: false, reason: `unsupported directive: ${lines[i].trim()}` };
  }
  const rawDirection = flowchartMatch[2];
  const directionSpan = {
    start: flowchartMatch[1].length,
    end: flowchartMatch[1].length + rawDirection.length,
  };
  const direction: MermaidDirection =
    rawDirection === 'TB' ? 'TD' : (rawDirection as MermaidDirection);
  i++;

  // 2. Walk the body.
  const graph: MermaidGraph = { ...emptyGraph(), direction };
  const statements: FlowStatement[] = [];
  const edgeArrows: TokenRef[] = [];
  const nodeTokens = new Map<string, TokenRef[]>();

  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length === 0 || t.startsWith('%%')) continue;

    // Reject deferred features explicitly.
    if (/^(subgraph|end|classDef|class\b|click\b|style\b|linkStyle\b)/.test(t)) {
      return { ok: false, reason: `unsupported directive: ${t}` };
    }

    const tokens = tokenizeLine(lines[i]);
    if (tokens === null) {
      return { ok: false, reason: `unparseable line: ${t}` };
    }
    const stmt = statements.length;
    statements.push({ line: i, tokens });

    // Process tokens left-to-right. A `node` token defines a node, a
    // `noderef` references an existing or implicit node, an `arrow`
    // connects the previous id to the next id.
    let previousId: string | null = null;
    let pendingArrow: { tok: Extract<FlowToken, { kind: 'arrow' }>; index: number } | null = null;

    tokens.forEach((tok, index) => {
      if (tok.kind === 'arrow') return;
      const refs = nodeTokens.get(tok.id) ?? [];
      refs.push({ stmt, token: index });
      nodeTokens.set(tok.id, refs);
    });

    for (let k = 0; k < tokens.length; k++) {
      const tok = tokens[k];
      if (tok.kind === 'arrow') {
        if (previousId === null) {
          return { ok: false, reason: `arrow with no source: ${t}` };
        }
        pendingArrow = { tok, index: k };
        continue;
      }
      if (tok.kind === 'node') {
        // Last definition wins for both label and shape (mermaid's
        // flowDb overwrites the vertex on each definition). Map order
        // stays first-appearance order.
        graph.nodes.set(tok.id, { id: tok.id, shape: tok.shape, label: tok.label });
      } else if (!graph.nodes.has(tok.id)) {
        // Implicit node — mermaid auto-creates a rect with the id as
        // the label.
        graph.nodes.set(tok.id, { id: tok.id, shape: 'rect', label: tok.id });
      }
      if (pendingArrow && previousId !== null) {
        // Only emit style when non-default; the serializer treats
        // missing style as 'arrow'.
        const a = pendingArrow.tok;
        graph.edges.push({
          from: previousId,
          to: tok.id,
          ...(a.label ? { label: a.label } : {}),
          ...(a.style !== 'arrow' ? { style: a.style } : {}),
        });
        edgeArrows.push({ stmt, token: pendingArrow.index });
        pendingArrow = null;
      }
      previousId = tok.id;
    }

    if (pendingArrow) {
      return { ok: false, reason: `arrow with no destination: ${t}` };
    }
  }

  return {
    ok: true,
    graph,
    map: {
      lines,
      eol,
      directiveLine,
      directionSpan,
      rawDirection,
      statements,
      edgeArrows,
      nodeTokens,
    },
  };
}

export function parseMermaid(source: string): ParseResult {
  const r = parseMermaidSource(source);
  return r.ok ? { ok: true, graph: r.graph } : r;
}
