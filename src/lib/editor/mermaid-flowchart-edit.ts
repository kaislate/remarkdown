// Source-preserving visual edits for flowcharts.
//
// The visual editor used to rebuild the whole diagram source from the
// parsed graph after every popover edit — which threw away everything
// the graph doesn't model: `%%` comments, `%%{init}%%` directives,
// blank lines, chain formatting (`A --> B --> C`), `TB` spelled as
// `TB`, implicit nodes, indentation, styling. That is data loss for
// anyone whose diagram came from somewhere else.
//
// Each edit here instead changes only the source text it is about,
// located through the parser's source map (mermaid-parser.ts, absolute
// offsets — labels may span lines):
//   - label / shape / link edits splice one token in place; the rest of
//     its line stays byte-identical
//   - a delete removes the affected tokens; a chain it cuts through is
//     rewritten as its surviving pieces (one per line, same indentation)
//   - editing one edge of an `A & B --> C` fan splits that link into
//     one statement per edge, keeping node and edge order
//   - new statements go after the last top-level statement, with its
//     indentation; a node joins a group through a line inside the
//     group's block
//   - moving a node out of a group moves the statements that mention it
//     there to just after the group, leaving the other nodes mentioned
//   - colours write / update one `style` / `linkStyle` statement
//   - whenever edges are removed or reordered, `linkStyle` indexes are
//     renumbered so every other edge keeps its colour
// Invariant (property-tested over the corpora): every line the edit did
// not semantically touch is byte-identical, and parsing the result
// gives exactly the graph the pure mermaid-graph.ts helper would.
import {
  parseMermaidSource,
  ATTR_SHAPE_NAMES,
  type ArrowToken,
  type ChainStatement,
  type FlowchartSourceMap,
  type LinkStyleStatement,
  type Span,
  type SubgraphStatement,
  type VertexToken,
} from './mermaid-parser';
import { emitAnyLabel, emitArrow, emitLabel, emitNode, shapeDelims } from './mermaid-serializer';
import {
  nextNodeId,
  nextGroupId,
  withProp,
  type EdgeEnds,
  type EdgeStroke,
  type MermaidDirection,
  type MermaidEdge,
  type MermaidGraph,
  type MermaidShape,
  type StyleProps,
} from './mermaid-graph';

export type ClassicShape = Exclude<MermaidShape, 'other'>;
export type NodeColorProp = 'fill' | 'stroke' | 'color';
export type EdgeColorProp = 'stroke' | 'color';

export type FlowchartEdit =
  | { kind: 'setNodeLabel'; id: string; label: string; markdown?: boolean }
  | { kind: 'setNodeShape'; id: string; shape: ClassicShape }
  | { kind: 'deleteNode'; id: string }
  | { kind: 'setEdgeLabel'; index: number; label: string; markdown?: boolean }
  | { kind: 'setEdgeStroke'; index: number; stroke: EdgeStroke }
  | { kind: 'setEdgeEnds'; index: number; ends: EdgeEnds }
  | { kind: 'deleteEdge'; index: number }
  // New node (next free id), optionally with an edge from `connectFrom`
  // (the new node then joins connectFrom's group).
  | { kind: 'addNode'; shape: ClassicShape; label: string; connectFrom?: string; group?: string }
  | { kind: 'addEdge'; from: string; to: string }
  | { kind: 'setDirection'; direction: MermaidDirection }
  | { kind: 'setNodeColor'; id: string; prop: NodeColorProp; value: string | null }
  | { kind: 'setEdgeColor'; index: number; prop: EdgeColorProp; value: string | null }
  | { kind: 'setGroupTitle'; id: string; title: string; markdown?: boolean }
  // A new group at the top level, holding `members` (moved out of the
  // groups they were in).
  | { kind: 'addGroup'; title: string; members: string[] }
  // Remove a group, keeping what was in it (it moves up a level).
  | { kind: 'ungroup'; id: string }
  // Move a node into a group (null: out of every group).
  | { kind: 'setNodeGroup'; id: string; group: string | null };

export interface FlowchartEditResult {
  source: string;
  // Id of the node / group an add edit created.
  id?: string;
}

// Indentation for statements added to a chart that has none to copy.
const DEFAULT_INDENT = '    ';

class Patcher {
  private patches: Array<{ start: number; end: number; text: string; seq: number }> = [];
  private seq = 0;
  constructor(readonly src: string, readonly eol: string) {}

  replace(start: number, end: number, text: string): void {
    this.patches.push({ start, end, text, seq: this.seq++ });
  }

  apply(): string {
    // Deletions may overlap (two adjacent last lines each taking a line
    // break with them): merge those first.
    const dels = this.patches.filter((p) => p.text === '' && p.end > p.start).sort((a, b) => a.start - b.start);
    const merged: typeof dels = [];
    for (const d of dels) {
      const last = merged[merged.length - 1];
      if (last && d.start <= last.end) last.end = Math.max(last.end, d.end);
      else merged.push({ ...d });
    }
    const rest = this.patches.filter((p) => !(p.text === '' && p.end > p.start));
    // Later positions first; inserts at one position keep their order.
    const sorted = [...rest, ...merged].sort((a, b) => b.start - a.start || b.end - a.end || b.seq - a.seq);
    let out = this.src;
    let floor = Infinity;
    for (const p of sorted) {
      if (p.end > floor) throw new Error('overlapping flowchart patches');
      out = out.slice(0, p.start) + p.text + out.slice(p.end);
      floor = p.start;
    }
    return out;
  }
}

function lineStart(src: string, pos: number): number {
  return src.lastIndexOf('\n', pos - 1) + 1;
}

// Offset of the line break ending the line `pos` is on (its `\r` for
// CRLF), or the source length.
function lineEnd(src: string, pos: number): number {
  const nl = src.indexOf('\n', pos);
  if (nl === -1) return src.length;
  return src[nl - 1] === '\r' ? nl - 1 : nl;
}

function indentAt(src: string, pos: number): string {
  return /^[ \t]*/.exec(src.slice(lineStart(src, pos)))![0];
}

// Is the statement the only thing on its line(s) (bar `;` separators)?
function aloneOnLines(src: string, span: Span): boolean {
  const before = src.slice(lineStart(src, span.start), span.start);
  const after = src.slice(span.end, lineEnd(src, span.end));
  return before.trim() === '' && after.replace(/[\s;]/g, '') === '';
}

// Replace a statement by `texts` (possibly none): one per line with the
// statement's indentation when it had its line(s) to itself, else
// `; `-joined in place.
function replaceStatement(p: Patcher, span: Span, texts: string[]): void {
  const src = p.src;
  if (aloneOnLines(src, span)) {
    const ls = lineStart(src, span.start);
    const le = lineEnd(src, span.end);
    if (!texts.length) {
      // Drop the whole line, with its line break.
      const next = src.indexOf('\n', le);
      if (next !== -1) p.replace(ls, next + 1, '');
      else p.replace(ls > 0 ? ls - (src[ls - 2] === '\r' ? 2 : 1) : 0, le, '');
      return;
    }
    const indent = indentAt(src, span.start);
    p.replace(ls, le, texts.map((t) => indent + t).join(p.eol));
    return;
  }
  if (texts.length) {
    p.replace(span.start, span.end, texts.join('; '));
    return;
  }
  // Remove the statement and one separator next to it.
  let end = span.end;
  while (end < src.length && /[ \t]/.test(src[end])) end++;
  if (src[end] === ';') {
    end++;
    while (end < src.length && /[ \t]/.test(src[end])) end++;
    p.replace(span.start, end, '');
  } else {
    let start = span.start;
    while (start > 0 && /[ \t;]/.test(src[start - 1])) start--;
    p.replace(start, span.end, '');
  }
}

// Add lines after the line `pos` is on.
function insertLinesAfter(p: Patcher, pos: number, lines: string[]): void {
  const le = lineEnd(p.src, pos);
  p.replace(le, le, lines.map((l) => p.eol + l).join(''));
}

function groupStatement(map: FlowchartSourceMap, id: string): SubgraphStatement | undefined {
  return map.statements.find((s): s is SubgraphStatement => s.kind === 'subgraph' && s.id === id);
}

// Where a statement for `group` goes (after the block's last statement,
// or after the top-level last statement), and its indentation.
function insertionPoint(map: FlowchartSourceMap, group: string | null): { pos: number; indent: string } {
  const src = map.source;
  // Statements whose group is `group` all sit in its block (a nested
  // group's `end` included).
  const inGroup = map.statements.filter((s) => s.group === group);
  const last = inGroup[inGroup.length - 1];
  if (group === null) {
    // On the header line (`graph TD;A-->B`) there's no indentation to copy.
    if (!last || lineStart(src, last.span.start) <= map.header.start) {
      return { pos: last ? last.span.end : map.header.end, indent: DEFAULT_INDENT };
    }
    return { pos: last.span.end, indent: indentAt(src, last.span.start) };
  }
  if (last) return { pos: last.span.end, indent: indentAt(src, last.span.start) };
  const sg = groupStatement(map, group)!;
  return { pos: sg.span.end, indent: indentAt(src, sg.span.start) + DEFAULT_INDENT };
}

function emitProps(props: StyleProps): string {
  return props.map((x) => `${x.name}:${x.value}`).join(',');
}

// ── chains ───────────────────────────────────────────────────────────

interface Piece {
  // Token index ranges of the vertex groups / arrows that survive.
  groups: number[][];
  arrows: number[];
}

function chainGroups(st: ChainStatement): { groups: number[][]; arrows: number[] } {
  const groups: number[][] = [[]];
  const arrows: number[] = [];
  st.tokens.forEach((t, k) => {
    if (t.kind === 'vertex') groups[groups.length - 1].push(k);
    else if (t.kind === 'arrow') {
      arrows.push(k);
      groups.push([]);
    }
  });
  return { groups, arrows };
}

function tokenText(src: string, st: ChainStatement, k: number): string {
  const t = st.tokens[k];
  return src.slice(t.span.start, t.span.end);
}

// Text of a vertex group: verbatim when nothing in it was removed.
function groupText(src: string, st: ChainStatement, original: number[], kept: number[]): string {
  if (kept.length === original.length) {
    return src.slice(st.tokens[original[0]].span.start, st.tokens[original[original.length - 1]].span.end);
  }
  return kept.map((k) => tokenText(src, st, k)).join(' & ');
}

function pieceText(src: string, st: ChainStatement, piece: Piece, originalGroups: Map<number, number[]>): string {
  let out = '';
  piece.groups.forEach((g, i) => {
    out += groupText(src, st, originalGroups.get(g[0] ?? -1) ?? g, g);
    const a = piece.arrows[i];
    if (a !== undefined) {
      // Keep the spacing the source had around this link.
      const prevEnd = st.tokens[a - 1].span.end;
      const nextStart = st.tokens[a + 1].span.start;
      out += src.slice(prevEnd, nextStart);
    }
  });
  return out;
}

// Rewrite chain `st` without the vertex tokens in `dropVertices` and
// the arrows in `dropArrows`. A vertex group that loses every member
// takes its adjacent links with it and splits the chain there.
function cutChain(
  map: FlowchartSourceMap,
  st: ChainStatement,
  dropVertices: Set<number>,
  dropArrows: Set<number>,
  seenBefore: Set<string>,
): string[] {
  const src = map.source;
  const { groups, arrows } = chainGroups(st);
  const keptGroups = groups.map((g) => g.filter((k) => !dropVertices.has(k)));
  const original = new Map<number, number[]>();
  const pieces: Piece[] = [];
  let cur: Piece = { groups: [], arrows: [] };
  keptGroups.forEach((g, i) => {
    if (!g.length) {
      if (cur.groups.length) pieces.push(cur);
      cur = { groups: [], arrows: [] };
      return;
    }
    original.set(g[0], groups[i]);
    if (cur.groups.length) {
      const a = arrows[i - 1];
      if (dropArrows.has(a)) {
        pieces.push(cur);
        cur = { groups: [], arrows: [] };
      } else {
        cur.arrows.push(a);
      }
    }
    cur.groups.push(g);
  });
  if (cur.groups.length) pieces.push(cur);
  const out: string[] = [];
  const seen = new Set(seenBefore);
  for (const piece of pieces) {
    const ids = piece.groups.flat().map((k) => (st.tokens[k] as VertexToken).id);
    const only = piece.groups.length === 1 && piece.groups[0].length === 1 ? (st.tokens[piece.groups[0][0]] as VertexToken) : null;
    // A lone bare reference to a node already seen carries no
    // information at the top level (inside a group it is membership).
    if (only && only.label === undefined && !only.attrs && st.group === null && seen.has(only.id)) continue;
    out.push(pieceText(src, st, piece, original));
    ids.forEach((id) => seen.add(id));
  }
  return out;
}

// Nodes mentioned before statement `stmt`.
function seenBefore(map: FlowchartSourceMap, stmt: number): Set<string> {
  const seen = new Set<string>();
  map.statements.slice(0, stmt).forEach((s) => {
    if (s.kind === 'chain') s.tokens.forEach((t) => t.kind === 'vertex' && seen.add(t.id));
  });
  return seen;
}

// One edge of a fan (`A & B --> C & D`) changed or removed: split the
// link it shares into one statement per edge. The chain up to the link's
// left group, the per-edge statements, then the chain from its right
// group on — node first appearance and edge order stay as they were.
function splitFan(
  map: FlowchartSourceMap,
  stmtIndex: number,
  edgeIndex: number,
  replacement: string | null,
): string[] {
  const src = map.source;
  const st = map.statements[stmtIndex] as ChainStatement;
  const { groups, arrows } = chainGroups(st);
  const arrowTok = map.edgeSource[edgeIndex].arrow;
  const k = arrows.indexOf(arrowTok);
  const left = groups[k];
  const right = groups[k + 1];
  const prefix = src.slice(st.tokens[0].span.start, st.tokens[left[left.length - 1]].span.end);
  const rest = src.slice(st.tokens[right[0]].span.start, st.span.end);
  const arrow = tokenText(src, st, arrowTok);
  const edgeLines: string[] = [];
  const appear: string[] = [];
  for (const e of st.edges.filter((x) => x.arrow === arrowTok)) {
    const from = (st.tokens[e.from] as VertexToken).id;
    const to = (st.tokens[e.to] as VertexToken).id;
    if (e.edge === edgeIndex && replacement === null) continue;
    edgeLines.push(`${from} ${e.edge === edgeIndex ? replacement : arrow} ${to}`);
    if (!appear.includes(to)) appear.push(to);
  }
  // The right group's nodes must still first appear in their order: when
  // the per-edge lines would mention them differently, name the group
  // first (the chain from it on, when that's all it is).
  const rightIds = right.map((k) => (st.tokens[k] as VertexToken).id).filter((id, i, a) => a.indexOf(id) === i);
  const inOrder = appear.join(' ') === rightIds.filter((id) => appear.includes(id)).join(' ') && appear.length === rightIds.length;
  const restIsGroup = right[right.length - 1] === st.tokens.length - 1;
  if (inOrder) return [prefix, ...edgeLines, rest];
  if (restIsGroup) return [prefix, rest, ...edgeLines];
  return [prefix, rightIds.join(' & '), ...edgeLines, rest];
}

function isFan(map: FlowchartSourceMap, edgeIndex: number): boolean {
  const { stmt, arrow } = map.edgeSource[edgeIndex];
  return (map.statements[stmt] as ChainStatement).edges.filter((e) => e.arrow === arrow).length > 1;
}

// ── linkStyle renumbering ────────────────────────────────────────────

// `order[newIndex] = oldIndex` (undefined entries: new edges). Every
// linkStyle naming an edge follows it to its new index; one naming only
// removed edges goes.
function renumberLinkStyles(p: Patcher, map: FlowchartSourceMap, oldToNew: Map<number, number>, edgeCount: number): void {
  let identity = oldToNew.size === edgeCount;
  for (const [o, n] of oldToNew) if (o !== n) identity = false;
  if (identity) return;
  for (const s of map.statements) {
    if (s.kind !== 'linkStyle' || s.targets === 'default') continue;
    const next = s.targets.map((i) => oldToNew.get(i)).filter((i): i is number => i !== undefined);
    if (next.length === s.targets.length && next.every((v, i) => v === (s.targets as number[])[i])) continue;
    if (!next.length) {
      replaceStatement(p, s.span, []);
      continue;
    }
    const sep = /,\s/.test(map.source.slice(s.targetsSpan.start, s.targetsSpan.end)) ? ', ' : ',';
    p.replace(s.targetsSpan.start, s.targetsSpan.end, next.join(sep));
  }
}

// A removed edge's `e1@{ … }` statement would otherwise become a node.
function dropEdgeAttrs(p: Patcher, map: FlowchartSourceMap, graph: MermaidGraph, dropped: Set<number>): void {
  const ids = new Set([...dropped].map((i) => graph.edges[i]?.id).filter((x): x is string => !!x));
  for (const s of map.statements) {
    if (s.kind === 'edgeAttrs' && s.id && ids.has(s.id)) replaceStatement(p, s.span, []);
  }
}

function dropEdgesMapping(count: number, dropped: Set<number>): Map<number, number> {
  const map = new Map<number, number>();
  let n = 0;
  for (let i = 0; i < count; i++) if (!dropped.has(i)) map.set(i, n++);
  return map;
}

// ── statements naming a node ─────────────────────────────────────────

// Remove `id` from style / class / click statements (a style for a node
// that no longer exists would bring it back).
function dropNodeReferences(p: Patcher, map: FlowchartSourceMap, id: string): void {
  for (const s of map.statements) {
    if ((s.kind === 'style' && s.id === id) || (s.kind === 'click' && s.id === id)) {
      replaceStatement(p, s.span, []);
    } else if (s.kind === 'class' && s.ids.includes(id)) {
      const rest = s.ids.filter((x) => x !== id);
      if (!rest.length) replaceStatement(p, s.span, []);
      else p.replace(s.idsSpan.start, s.idsSpan.end, rest.join(','));
    }
  }
}

// Remove every vertex token of the ids in `ids` (with the links their
// groups lose). Returns the edge indexes that went.
function removeVertices(p: Patcher, map: FlowchartSourceMap, graph: MermaidGraph, ids: Set<string>): Set<number> {
  const droppedEdges = new Set<number>();
  graph.edges.forEach((e, i) => {
    if (ids.has(e.from) || ids.has(e.to)) droppedEdges.add(i);
  });
  map.statements.forEach((s, si) => {
    if (s.kind !== 'chain') return;
    const drop = new Set<number>();
    s.tokens.forEach((t, k) => {
      if (t.kind === 'vertex' && ids.has(t.id)) drop.add(k);
    });
    if (!drop.size) return;
    replaceStatement(p, s.span, cutChain(map, s, drop, new Set(), seenBefore(map, si)));
  });
  return droppedEdges;
}

// ── groups ───────────────────────────────────────────────────────────

function topBlock(map: FlowchartSourceMap, group: string): SubgraphStatement {
  let sg = groupStatement(map, group)!;
  while (sg.group !== null) sg = groupStatement(map, sg.group)!;
  return sg;
}

// Take `id` out of every group: each statement inside a group block
// that mentions it moves to just after the block's outermost group,
// leaving the other nodes it mentioned (verbatim) where they were.
// Returns the new edge order (old indexes), for linkStyle renumbering.
function detachNode(p: Patcher, map: FlowchartSourceMap, id: string): number[] {
  const src = map.source;
  const moves = new Map<number, Array<{ stmt: number; text: string }>>();
  map.statements.forEach((s, si) => {
    if (s.kind !== 'chain' || s.group === null) return;
    if (!s.tokens.some((t) => t.kind === 'vertex' && t.id === id)) return;
    const top = topBlock(map, s.group);
    // The moved copy: this node's tokens as written, the others bare.
    const moved = s.tokens
      .map((t, k) => {
        if (t.kind === 'vertex' && t.id !== id) return t.id;
        if (t.kind === 'arrow') {
          const prevEnd = s.tokens[k - 1].span.end;
          const nextStart = s.tokens[k + 1].span.start;
          return src.slice(prevEnd, nextStart).trim();
        }
        return t.kind === 'amp' ? '&' : src.slice(t.span.start, t.span.end);
      })
      .join(' ');
    const list = moves.get(top.end.start) ?? [];
    list.push({ stmt: si, text: moved });
    moves.set(top.end.start, list);
    // What stays: the other vertices, as written.
    const others: string[] = [];
    const seenIds = new Set<string>();
    s.tokens.forEach((t) => {
      if (t.kind === 'vertex' && t.id !== id && !(t.label === undefined && !t.attrs && seenIds.has(t.id))) {
        others.push(src.slice(t.span.start, t.span.end));
        seenIds.add(t.id);
      }
    });
    replaceStatement(p, s.span, others.length ? [others.join(' & ')] : []);
  });
  // New edge order: statements moved after a block's end come after
  // everything up to that end.
  const order: number[] = [];
  const movedStmts = new Set<number>();
  for (const list of moves.values()) list.forEach((m) => movedStmts.add(m.stmt));
  const edgesOf = (si: number) => (map.statements[si] as ChainStatement).edges.map((e) => e.edge);
  map.statements.forEach((s, si) => {
    if (s.kind === 'chain' && !movedStmts.has(si)) order.push(...edgesOf(si));
    if (s.kind === 'end') {
      const list = moves.get(s.span.start);
      if (list) list.forEach((m) => order.push(...edgesOf(m.stmt)));
    }
  });
  for (const [endPos, list] of moves) {
    insertLinesAfter(p, endPos, list.map((m) => indentAt(src, endPos) + m.text));
  }
  return order;
}

function orderMapping(order: number[]): Map<number, number> {
  const m = new Map<number, number>();
  order.forEach((old, i) => m.set(old, i));
  return m;
}

// ── apply ────────────────────────────────────────────────────────────

// Apply one visual edit to flowchart `source`. Returns null when the
// source isn't one the editor can read or the edit names something that
// doesn't exist.
export function applyFlowchartEdit(source: string, edit: FlowchartEdit): FlowchartEditResult | null {
  const parsed = parseMermaidSource(source);
  if (!parsed.ok) return null;
  const { graph, map } = parsed;
  const p = new Patcher(source, map.eol);
  let newId: string | undefined;

  switch (edit.kind) {
    case 'setNodeLabel':
    case 'setNodeShape': {
      const node = graph.nodes.get(edit.id);
      const refs = map.nodeTokens.get(edit.id);
      if (!node || !refs?.length) return null;
      const tokens = refs.map((r) => (map.statements[r.stmt] as ChainStatement).tokens[r.token] as VertexToken);
      if (edit.kind === 'setNodeLabel') {
        // The last definition is the one mermaid shows.
        const def = [...tokens].reverse().find((t) => t.label !== undefined);
        if (def?.attrs) {
          // v11 `@{}` labels are markdown to mermaid; plain text has its
          // markdown markers escaped so it shows as typed.
          const text = edit.markdown ? edit.label : edit.label.replace(/[\\*_`]/g, (c) => `\\${c}`);
          const value = `"${text.replace(/"/g, '#quot;')}"`;
          if (def.attrs.labelSpan) p.replace(def.attrs.labelSpan.start, def.attrs.labelSpan.end, value);
        } else if (def?.shape) {
          p.replace(def.shape.labelSpan.start, def.shape.labelSpan.end, emitAnyLabel(edit.label, edit.markdown));
        } else {
          // Never defined: give it a definition where it first appears.
          const t = tokens[0];
          const attrsShape = [...tokens].reverse().find((x) => x.attrs?.shapeSpan);
          if (attrsShape?.attrs) {
            const at = attrsShape.attrs.span.end - 1;
            const text = edit.markdown ? edit.label : edit.label.replace(/[\\*_`]/g, (c) => `\\${c}`);
            p.replace(at, at, `, label: "${text.replace(/"/g, '#quot;')}" `);
          } else {
            const [open, close] = shapeDelims(node.shape);
            p.replace(t.idSpan.start, t.idSpan.end, `${t.id}${open}${emitAnyLabel(edit.label, edit.markdown)}${close}`);
          }
        }
      } else {
        const def = [...tokens].reverse().find((t) => t.shape || t.attrs?.shapeSpan);
        if (def?.shape) {
          // Only the brackets change; the label keeps its exact bytes
          // (quoting, entity codes) — nobody edited it.
          const [open, close] = shapeDelims(edit.shape);
          const ls = def.shape.labelSpan;
          p.replace(ls.start - def.shape.open.length, ls.start, open);
          p.replace(ls.end, ls.end + def.shape.close.length, close);
        } else if (def?.attrs?.shapeSpan) {
          p.replace(def.attrs.shapeSpan.start, def.attrs.shapeSpan.end, ATTR_SHAPE_NAMES[edit.shape][0]);
        } else {
          const attrs = tokens.find((t) => t.attrs);
          if (attrs?.attrs) {
            const at = attrs.attrs.span.start + 2;
            p.replace(at, at, ` shape: ${ATTR_SHAPE_NAMES[edit.shape][0]},`);
          } else {
            const t = tokens[0];
            p.replace(t.idSpan.start, t.idSpan.end, emitNode({ ...node, shape: edit.shape }));
          }
        }
      }
      break;
    }
    case 'setEdgeLabel':
    case 'setEdgeStroke':
    case 'setEdgeEnds': {
      const e = graph.edges[edit.index];
      const ref = map.edgeSource[edit.index];
      if (!e || !ref) return null;
      const st = map.statements[ref.stmt] as ChainStatement;
      const tok = st.tokens[ref.arrow] as ArrowToken;
      const next: MermaidEdge = { ...e };
      if (edit.kind === 'setEdgeLabel') {
        next.label = edit.label || undefined;
        next.markdown = edit.label && edit.markdown ? true : undefined;
      } else if (edit.kind === 'setEdgeStroke') {
        next.stroke = edit.stroke === 'solid' ? undefined : edit.stroke;
      } else {
        next.ends = edit.ends === 'arrow' ? undefined : edit.ends;
      }
      const arrow = `${tok.edgeId ? `${tok.edgeId}@` : ''}${emitArrow(next)}`;
      if (isFan(map, edit.index)) {
        replaceStatement(p, st.span, splitFan(map, ref.stmt, edit.index, arrow));
      } else {
        p.replace(tok.span.start, tok.span.end, arrow);
      }
      break;
    }
    case 'deleteEdge': {
      const ref = map.edgeSource[edit.index];
      if (!ref) return null;
      if (isFan(map, edit.index)) {
        replaceStatement(p, map.statements[ref.stmt].span, splitFan(map, ref.stmt, edit.index, null));
      } else {
        const st = map.statements[ref.stmt] as ChainStatement;
        replaceStatement(p, st.span, cutChain(map, st, new Set(), new Set([ref.arrow]), seenBefore(map, ref.stmt)));
      }
      dropEdgeAttrs(p, map, graph, new Set([edit.index]));
      renumberLinkStyles(p, map, dropEdgesMapping(graph.edges.length, new Set([edit.index])), graph.edges.length);
      break;
    }
    case 'deleteNode': {
      if (!graph.nodes.has(edit.id)) return null;
      const dropped = removeVertices(p, map, graph, new Set([edit.id]));
      dropNodeReferences(p, map, edit.id);
      dropEdgeAttrs(p, map, graph, dropped);
      renumberLinkStyles(p, map, dropEdgesMapping(graph.edges.length, dropped), graph.edges.length);
      break;
    }
    case 'addNode': {
      if (edit.connectFrom !== undefined && !graph.nodes.has(edit.connectFrom)) return null;
      if (edit.group !== undefined && !graph.subgraphs.has(edit.group)) return null;
      const id = nextNodeId(graph);
      const def = emitNode({ id, shape: edit.shape, label: edit.label });
      const group = edit.group ?? (edit.connectFrom !== undefined ? graph.groupOf.get(edit.connectFrom) ?? null : null);
      const top = insertionPoint(map, null);
      if (group) {
        // Joins the group through a line in its block; the edge goes at
        // the top level so edge order (and linkStyle indexes) holds.
        const at = insertionPoint(map, group);
        insertLinesAfter(p, at.pos, [at.indent + def]);
        if (edit.connectFrom !== undefined) insertLinesAfter(p, top.pos, [`${top.indent}${edit.connectFrom} --> ${id}`]);
      } else {
        insertLinesAfter(p, top.pos, [top.indent + (edit.connectFrom !== undefined ? `${edit.connectFrom} --> ${def}` : def)]);
      }
      newId = id;
      break;
    }
    case 'addEdge': {
      const ok = (x: string) => graph.nodes.has(x) || graph.subgraphs.has(x);
      if (!ok(edit.from) || !ok(edit.to)) return null;
      const top = insertionPoint(map, null);
      insertLinesAfter(p, top.pos, [`${top.indent}${edit.from} --> ${edit.to}`]);
      break;
    }
    case 'setDirection': {
      // TB and TD are the same layout; keep whichever is written.
      if (graph.direction === edit.direction) return { source };
      const topDir = map.statements.filter((s) => s.kind === 'direction' && s.group === null);
      const last = topDir[topDir.length - 1];
      if (last && last.kind === 'direction') p.replace(last.valueSpan.start, last.valueSpan.end, edit.direction);
      else if (map.directionSpan) p.replace(map.directionSpan.start, map.directionSpan.end, edit.direction);
      else p.replace(map.header.end, map.header.end, ` ${edit.direction}`);
      break;
    }
    case 'setNodeColor': {
      if (!graph.nodes.has(edit.id)) return null;
      const styles = map.statements.filter((s) => s.kind === 'style' && s.id === edit.id);
      const last = styles[styles.length - 1];
      // Earlier statements lose the property; the last one carries it.
      for (const s of styles) {
        if (s.kind !== 'style') continue;
        const props = s === last ? withProp(s.props, edit.prop, edit.value) : withProp(s.props, edit.prop, null);
        if (props.length === s.props.length && props.every((x, i) => x.name === s.props[i].name && x.value === s.props[i].value)) continue;
        if (!props.length) replaceStatement(p, s.span, []);
        else p.replace(s.propsSpan.start, s.propsSpan.end, emitProps(props));
      }
      if (!last && edit.value !== null) {
        const top = insertionPoint(map, null);
        insertLinesAfter(p, top.pos, [`${top.indent}style ${edit.id} ${edit.prop}:${edit.value}`]);
      }
      break;
    }
    case 'setEdgeColor': {
      if (!graph.edges[edit.index]) return null;
      const naming = map.statements.filter(
        (s): s is LinkStyleStatement => s.kind === 'linkStyle' && s.targets !== 'default' && s.targets.includes(edit.index),
      );
      // The last statement naming an edge is its whole style (mermaid
      // replaces, it doesn't merge).
      const last = naming[naming.length - 1];
      const props = withProp(last?.props ?? [], edit.prop, edit.value);
      if (naming.length === 1 && (last.targets as number[]).length === 1) {
        if (!props.length) replaceStatement(p, last.span, []);
        else p.replace(last.propsSpan.start, last.propsSpan.end, emitProps(props));
        break;
      }
      // Shared statements keep styling their other edges; this edge
      // leaves all of them (or an earlier one would take over) and gets
      // a statement of its own.
      for (const s of naming) {
        const rest = (s.targets as number[]).filter((i) => i !== edit.index);
        if (!rest.length) {
          replaceStatement(p, s.span, []);
          continue;
        }
        const sep = /,\s/.test(source.slice(s.targetsSpan.start, s.targetsSpan.end)) ? ', ' : ',';
        p.replace(s.targetsSpan.start, s.targetsSpan.end, rest.join(sep));
      }
      if (props.length) {
        const top = insertionPoint(map, null);
        insertLinesAfter(p, top.pos, [`${top.indent}linkStyle ${edit.index} ${emitProps(props)}`]);
      }
      break;
    }
    case 'setGroupTitle': {
      const sg = groupStatement(map, edit.id);
      if (!sg) return null;
      const label = emitAnyLabel(edit.title, edit.markdown);
      if (sg.titleForm === 'bracket' && sg.titleSpan) {
        p.replace(sg.titleSpan.start, sg.titleSpan.end, label);
      } else if (sg.idGenerated && sg.titleSpan) {
        // Its id comes from having no id: the title must stay quoted.
        const quoted = label.startsWith('"') ? label : `"${label}"`;
        p.replace(sg.titleSpan.start, sg.titleSpan.end, quoted);
      } else {
        p.replace(sg.headSpan.start, sg.headSpan.end, `${sg.id} [${label}]`);
      }
      break;
    }
    case 'addGroup': {
      if (!edit.members.length || edit.members.some((m) => !graph.nodes.has(m))) return null;
      const id = nextGroupId(graph);
      // Several members: detaching one changes the map the next relies
      // on — make the group with the first, then move the others in.
      if (edit.members.length > 1) return addGroupOfMany(source, edit, id);
      const [member] = edit.members;
      const order = graph.groupOf.has(member) || hasGroupedMentions(map, member) ? detachNode(p, map, member) : null;
      const top = insertionPoint(map, null);
      insertLinesAfter(p, top.pos, [
        `${top.indent}subgraph ${id} [${emitLabel(edit.title)}]`,
        `${top.indent}${DEFAULT_INDENT}${member}`,
        `${top.indent}end`,
      ]);
      if (order) renumberLinkStyles(p, map, orderMapping(order), graph.edges.length);
      newId = id;
      break;
    }
    case 'ungroup': {
      const sg = groupStatement(map, edit.id);
      if (!sg) return null;
      replaceStatement(p, sg.span, []);
      replaceStatement(p, sg.end, []);
      for (const s of map.statements) {
        if (s.kind === 'direction' && s.group === edit.id) replaceStatement(p, s.span, []);
      }
      // Links to the group itself have nothing to point at any more.
      const dropped = removeVertices(p, map, graph, new Set([edit.id]));
      dropNodeReferences(p, map, edit.id);
      dropEdgeAttrs(p, map, graph, dropped);
      renumberLinkStyles(p, map, dropEdgesMapping(graph.edges.length, dropped), graph.edges.length);
      break;
    }
    case 'setNodeGroup': {
      if (!graph.nodes.has(edit.id)) return null;
      if (edit.group !== null && !graph.subgraphs.has(edit.group)) return null;
      const current = graph.groupOf.get(edit.id) ?? null;
      if (current === edit.group) return { source };
      let order: number[] | null = null;
      if (current !== null || hasGroupedMentions(map, edit.id)) order = detachNode(p, map, edit.id);
      if (edit.group !== null) {
        const at = insertionPoint(map, edit.group);
        insertLinesAfter(p, at.pos, [at.indent + edit.id]);
      }
      if (order) renumberLinkStyles(p, map, orderMapping(order), graph.edges.length);
      break;
    }
  }

  return { source: p.apply(), ...(newId !== undefined ? { id: newId } : {}) };
}

function hasGroupedMentions(map: FlowchartSourceMap, id: string): boolean {
  return map.statements.some((s) => s.kind === 'chain' && s.group !== null && s.tokens.some((t) => t.kind === 'vertex' && t.id === id));
}

function addGroupOfMany(source: string, edit: Extract<FlowchartEdit, { kind: 'addGroup' }>, id: string): FlowchartEditResult | null {
  let r = applyFlowchartEdit(source, { kind: 'addGroup', title: edit.title, members: edit.members.slice(0, 1) });
  if (!r) return null;
  for (const m of edit.members.slice(1)) {
    const next = applyFlowchartEdit(r.source, { kind: 'setNodeGroup', id: m, group: id });
    if (!next) return null;
    r = { source: next.source, id };
  }
  return { source: r.source, id };
}
