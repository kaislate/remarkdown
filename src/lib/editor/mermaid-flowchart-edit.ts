// Source-preserving visual edits for flowcharts.
//
// The visual editor used to rebuild the whole diagram source from the
// parsed graph after every popover edit — which threw away everything
// the graph doesn't model: `%%` comments, `%%{init}%%` directives,
// blank lines, chain formatting (`A --> B --> C`), `TB` spelled as
// `TB`, implicit nodes, indentation. That is data loss for anyone whose
// diagram came from somewhere else.
//
// Each edit here instead changes only the source text it is about,
// located through the parser's source map (mermaid-parser.ts):
//   - label / shape / arrow-style / edge-label edits splice one token
//     in place; the rest of its line stays byte-identical
//   - a delete removes the affected tokens; a chain line it cuts
//     through is rewritten as its surviving segments (one per line,
//     same indentation), every other line is untouched
//   - new statements are inserted after the last existing statement,
//     with its indentation
//   - a direction change rewrites just the direction keyword
// Invariant (property-tested over the corpus): every line the edit did
// not semantically touch is byte-identical, and parsing the result
// gives exactly the graph the pure mermaid-graph.ts helper would.
import {
  parseMermaidSource,
  type FlowToken,
  type FlowchartSourceMap,
  type TokenRef,
} from './mermaid-parser';
import { emitArrow, emitNode, OPEN, CLOSE } from './mermaid-serializer';
import {
  addNode,
  type EdgeStyle,
  type MermaidDirection,
  type MermaidShape,
} from './mermaid-graph';

export type FlowchartEdit =
  | { kind: 'setNodeLabel'; id: string; label: string }
  | { kind: 'setNodeShape'; id: string; shape: MermaidShape }
  | { kind: 'deleteNode'; id: string }
  | { kind: 'setEdgeLabel'; index: number; label: string }
  | { kind: 'setEdgeStyle'; index: number; style: EdgeStyle }
  | { kind: 'deleteEdge'; index: number }
  // New node (next free id), optionally with an edge from `connectFrom`.
  | { kind: 'addNode'; shape: MermaidShape; label: string; connectFrom?: string }
  | { kind: 'addEdge'; from: string; to: string }
  | { kind: 'setDirection'; direction: MermaidDirection };

export interface FlowchartEditResult {
  source: string;
  // Id of the node an addNode edit created.
  id?: string;
}

// Indentation for statements added to a chart that has none to copy.
const DEFAULT_INDENT = '    ';

function indentOf(line: string): string {
  return /^\s*/.exec(line)![0];
}

function replaceSpan(line: string, start: number, end: number, text: string): string {
  return line.slice(0, start) + text + line.slice(end);
}

function spliceToken(lines: string[], map: FlowchartSourceMap, ref: TokenRef, text: string): void {
  const stmt = map.statements[ref.stmt];
  const { span } = stmt.tokens[ref.token];
  lines[stmt.line] = replaceSpan(lines[stmt.line], span.start, span.end, text);
}

// Insert a statement after the last existing one (or right after the
// directive in an empty chart).
function insertStatement(lines: string[], map: FlowchartSourceMap, text: string): void {
  const last = map.statements[map.statements.length - 1];
  const after = last ? last.line : map.directiveLine;
  const indent = last ? indentOf(lines[last.line]) : DEFAULT_INDENT;
  lines.splice(after + 1, 0, indent + text);
}

// Remove the given tokens. Statement lines without removals are kept
// verbatim; a line that loses tokens is replaced by its surviving
// segments (the original text of each run of kept tokens), one per
// line. A segment that is just a bare reference to a node already
// seen earlier carries no information and is dropped; one whose node
// first appears there is kept, so the node and the node order survive.
function removeTokens(map: FlowchartSourceMap, removed: Map<number, Set<number>>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stmtByLine = new Map(map.statements.map((s, i) => [s.line, i]));
  const note = (toks: FlowToken[]) => {
    for (const t of toks) if (t.kind !== 'arrow') seen.add(t.id);
  };
  map.lines.forEach((line, ln) => {
    const si = stmtByLine.get(ln);
    if (si === undefined) {
      out.push(line);
      return;
    }
    const stmt = map.statements[si];
    const rm = removed.get(si);
    if (!rm || rm.size === 0) {
      note(stmt.tokens);
      out.push(line);
      return;
    }
    const segments: FlowToken[][] = [];
    let cur: FlowToken[] = [];
    stmt.tokens.forEach((t, k) => {
      if (rm.has(k)) {
        if (cur.length) segments.push(cur);
        cur = [];
      } else {
        cur.push(t);
      }
    });
    if (cur.length) segments.push(cur);
    const indent = indentOf(line);
    for (const seg of segments) {
      // Defensive: a segment can't start or end with a dangling arrow
      // (callers remove arrows together with their nodes).
      while (seg.length && seg[0].kind === 'arrow') seg.shift();
      while (seg.length && seg[seg.length - 1].kind === 'arrow') seg.pop();
      if (seg.length === 0) continue;
      const only = seg[0];
      if (seg.length === 1 && only.kind === 'noderef' && seen.has(only.id)) continue;
      out.push(indent + line.slice(seg[0].span.start, seg[seg.length - 1].span.end));
      note(seg);
    }
  });
  return out;
}

function mark(removed: Map<number, Set<number>>, ref: TokenRef): void {
  const set = removed.get(ref.stmt) ?? new Set<number>();
  set.add(ref.token);
  removed.set(ref.stmt, set);
}

// Apply one visual edit to flowchart `source`. Returns null when the
// source is outside the editable subset or the edit names something
// that doesn't exist.
export function applyFlowchartEdit(source: string, edit: FlowchartEdit): FlowchartEditResult | null {
  const parsed = parseMermaidSource(source);
  if (!parsed.ok) return null;
  const { graph, map } = parsed;
  let lines = [...map.lines];
  let newId: string | undefined;

  switch (edit.kind) {
    case 'setNodeLabel':
    case 'setNodeShape': {
      const node = graph.nodes.get(edit.id);
      const refs = map.nodeTokens.get(edit.id);
      if (!node || !refs?.length) return null;
      const next =
        edit.kind === 'setNodeLabel' ? { ...node, label: edit.label } : { ...node, shape: edit.shape };
      // The last definition is the one mermaid shows. An implicit node
      // (never defined) gets its definition where it first appears.
      const defs = refs.filter((r) => map.statements[r.stmt].tokens[r.token].kind === 'node');
      const target = defs[defs.length - 1] ?? refs[0];
      const tok = map.statements[target.stmt].tokens[target.token];
      if (edit.kind === 'setNodeShape' && tok.kind === 'node') {
        // Only the brackets change; the label keeps its exact bytes
        // (quoting, entity codes) — nobody edited it.
        const line = lines[map.statements[target.stmt].line];
        const rawLabel = line.slice(tok.labelSpan.start, tok.labelSpan.end);
        spliceToken(lines, map, target, `${edit.id}${OPEN[edit.shape]}${rawLabel}${CLOSE[edit.shape]}`);
      } else {
        spliceToken(lines, map, target, emitNode(next));
      }
      break;
    }
    case 'setEdgeLabel':
    case 'setEdgeStyle': {
      const e = graph.edges[edit.index];
      const ref = map.edgeArrows[edit.index];
      if (!e || !ref) return null;
      const arrow =
        edit.kind === 'setEdgeLabel' ? emitArrow(e.style, edit.label) : emitArrow(edit.style, e.label);
      spliceToken(lines, map, ref, arrow);
      break;
    }
    case 'deleteEdge': {
      const ref = map.edgeArrows[edit.index];
      if (!ref) return null;
      const removed = new Map<number, Set<number>>();
      mark(removed, ref);
      lines = removeTokens(map, removed);
      break;
    }
    case 'deleteNode': {
      const refs = map.nodeTokens.get(edit.id);
      if (!graph.nodes.has(edit.id) || !refs) return null;
      const removed = new Map<number, Set<number>>();
      for (const ref of refs) {
        mark(removed, ref);
        // Edges touching the node go with it: the arrows on either side
        // of each of its tokens.
        const toks = map.statements[ref.stmt].tokens;
        if (toks[ref.token - 1]?.kind === 'arrow') mark(removed, { stmt: ref.stmt, token: ref.token - 1 });
        if (toks[ref.token + 1]?.kind === 'arrow') mark(removed, { stmt: ref.stmt, token: ref.token + 1 });
      }
      lines = removeTokens(map, removed);
      break;
    }
    case 'addNode': {
      if (edit.connectFrom !== undefined && !graph.nodes.has(edit.connectFrom)) return null;
      const { id } = addNode(graph, { shape: edit.shape, label: edit.label });
      const def = emitNode({ id, shape: edit.shape, label: edit.label });
      insertStatement(lines, map, edit.connectFrom !== undefined ? `${edit.connectFrom} --> ${def}` : def);
      newId = id;
      break;
    }
    case 'addEdge': {
      if (!graph.nodes.has(edit.from) || !graph.nodes.has(edit.to)) return null;
      insertStatement(lines, map, `${edit.from} --> ${edit.to}`);
      break;
    }
    case 'setDirection': {
      // TB and TD are the same layout; keep whichever is written.
      if (graph.direction === edit.direction) return { source };
      const ln = map.directiveLine;
      lines[ln] = replaceSpan(lines[ln], map.directionSpan.start, map.directionSpan.end, edit.direction);
      break;
    }
  }

  return { source: lines.join(map.eol), ...(newId !== undefined ? { id: newId } : {}) };
}
