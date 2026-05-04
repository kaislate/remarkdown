// Subset parser for mermaid flowcharts. Supports the syntax the
// editor's visual UI can fully round-trip; anything else returns
// `{ ok: false, reason }` and the NodeView falls back to render-only.
//
// Supported:
//   - `flowchart TD/TB/LR/BT/RL` directive (TB is normalized to TD)
//   - Node shapes: rect `A[label]`, rounded `A(label)`, circle `A((label))`,
//     diamond `A{label}`
//   - Edges: `A --> B` and labelled `A -->|text| B`
//   - Inline node definitions on edge lines: `A[a] --> B[b] --> C[c]`
//   - Quoted labels: `A["has [brackets]"]` and the `""` escape for
//     embedded quotes
//   - Blank lines and `%%` comments
//
// Not supported (parser bails to `ok: false`):
//   - Other diagram types (sequenceDiagram, classDiagram, etc.)
//   - The legacy `graph` keyword (we accept `flowchart` only — keeps
//     the surface minimal; users can rewrite the directive once)
//   - Subgraphs (`subgraph` ... `end`)
//   - classDef / class / click directives
//   - Other shapes (asymmetric `A>...]`, parallelogram `A[/.../]`, etc.)
//   - Other edge styles (`A --- B`, `A ==> B`, `A -.- B`)
import {
  emptyGraph,
  type MermaidGraph,
  type MermaidShape,
  type MermaidDirection,
} from './mermaid-graph';

type ParseResult =
  | { ok: true; graph: MermaidGraph }
  | { ok: false; reason: string };

// Tokenizer for a single line — returns a flat list of tokens.
// (We don't need a full lexer; line-by-line + per-line regex is
// sufficient for the subset.)
type LineToken =
  | { kind: 'node'; id: string; shape: MermaidShape; label: string }
  | { kind: 'noderef'; id: string }
  | { kind: 'arrow'; label?: string };

const ID_RE = /^[A-Za-z][A-Za-z0-9_]*/;
const SHAPE_RE = /^(\[\[|\(\(|\[|\(|\{)/;

function tokenizeLine(line: string): LineToken[] | null {
  const tokens: LineToken[] = [];
  let s = line.trim();
  while (s.length > 0) {
    // Whitespace
    if (s[0] === ' ' || s[0] === '\t') {
      s = s.replace(/^\s+/, '');
      continue;
    }
    // Edge: -->|label| or -->
    if (s.startsWith('-->')) {
      let rest = s.slice(3);
      let label: string | undefined;
      if (rest.startsWith('|')) {
        const closeIdx = rest.indexOf('|', 1);
        if (closeIdx === -1) return null;
        label = rest.slice(1, closeIdx);
        rest = rest.slice(closeIdx + 1);
      }
      tokens.push({ kind: 'arrow', label });
      s = rest.trim();
      continue;
    }
    // ID (start of a node-def or node-ref)
    const idMatch = ID_RE.exec(s);
    if (idMatch) {
      const id = idMatch[0];
      s = s.slice(id.length);
      // Look for an opening shape bracket
      const shapeMatch = SHAPE_RE.exec(s);
      if (shapeMatch) {
        const open = shapeMatch[0];
        const shape: MermaidShape =
          open === '[' ? 'rect'
          : open === '(' ? 'rounded'
          : open === '((' ? 'circle'
          : open === '{' ? 'diamond'
          : 'rect';
        const close =
          shape === 'rect' ? ']'
          : shape === 'rounded' ? ')'
          : shape === 'circle' ? '))'
          : '}';
        s = s.slice(open.length);
        // Read label until matching close. Handle quoted labels.
        let label = '';
        if (s.startsWith('"')) {
          // Quoted label: read until unescaped closing "
          s = s.slice(1);
          let i = 0;
          while (i < s.length) {
            if (s[i] === '"' && s[i + 1] === '"') {
              label += '"';
              i += 2;
              continue;
            }
            if (s[i] === '"') break;
            label += s[i];
            i++;
          }
          if (s[i] !== '"') return null;
          s = s.slice(i + 1);
        } else {
          // Unquoted: read until close
          const closeIdx = s.indexOf(close);
          if (closeIdx === -1) return null;
          label = s.slice(0, closeIdx);
          s = s.slice(closeIdx);
        }
        if (!s.startsWith(close)) return null;
        s = s.slice(close.length);
        tokens.push({ kind: 'node', id, shape, label });
      } else {
        tokens.push({ kind: 'noderef', id });
      }
      continue;
    }
    // Anything else: unsupported syntax on this line
    return null;
  }
  return tokens;
}

export function parseMermaid(source: string): ParseResult {
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
  const directiveLine = lines[i].trim();
  i++;

  const flowchartMatch = /^flowchart\s+(TD|TB|LR|BT|RL)\s*$/.exec(directiveLine);
  if (!flowchartMatch) {
    return { ok: false, reason: `unsupported directive: ${directiveLine}` };
  }
  const rawDir = flowchartMatch[1];
  const direction: MermaidDirection = rawDir === 'TB' ? 'TD' : (rawDir as MermaidDirection);

  // 2. Walk the body.
  const graph: MermaidGraph = { ...emptyGraph(), direction };

  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length === 0 || t.startsWith('%%')) continue;

    // Reject deferred features explicitly.
    if (
      /^(subgraph|end|classDef|class\b|click\b|style\b|linkStyle\b)/.test(t)
    ) {
      return { ok: false, reason: `unsupported directive: ${t}` };
    }

    const tokens = tokenizeLine(t);
    if (tokens === null) {
      return { ok: false, reason: `unparseable line: ${t}` };
    }

    // Process tokens left-to-right. A `node` token defines a node
    // (and remembers its id for chaining). A `noderef` references an
    // existing or implicit node. An `arrow` connects the previous id
    // to the next id.
    let previousId: string | null = null;
    let pendingArrowLabel: string | undefined;
    let hasPendingArrow = false;

    for (const tok of tokens) {
      if (tok.kind === 'node') {
        if (!graph.nodes.has(tok.id)) {
          graph.nodes.set(tok.id, {
            id: tok.id,
            shape: tok.shape,
            label: tok.label,
          });
        } else {
          // Node referenced again — update its shape/label if a
          // later definition gives one. Mermaid's behaviour here is
          // "last definition wins" for shape, "first label wins"
          // for label. Match that by keeping the existing label
          // (don't overwrite) but allowing shape upgrade.
          const existing = graph.nodes.get(tok.id)!;
          graph.nodes.set(tok.id, {
            ...existing,
            shape: tok.shape,
            label: existing.label || tok.label,
          });
        }
        if (hasPendingArrow && previousId !== null) {
          graph.edges.push({
            from: previousId,
            to: tok.id,
            ...(pendingArrowLabel ? { label: pendingArrowLabel } : {}),
          });
          hasPendingArrow = false;
          pendingArrowLabel = undefined;
        }
        previousId = tok.id;
      } else if (tok.kind === 'noderef') {
        if (!graph.nodes.has(tok.id)) {
          // Implicit node — mermaid auto-creates a rect with the id
          // as the label.
          graph.nodes.set(tok.id, {
            id: tok.id,
            shape: 'rect',
            label: tok.id,
          });
        }
        if (hasPendingArrow && previousId !== null) {
          graph.edges.push({
            from: previousId,
            to: tok.id,
            ...(pendingArrowLabel ? { label: pendingArrowLabel } : {}),
          });
          hasPendingArrow = false;
          pendingArrowLabel = undefined;
        }
        previousId = tok.id;
      } else if (tok.kind === 'arrow') {
        if (previousId === null) {
          return { ok: false, reason: `arrow with no source: ${t}` };
        }
        hasPendingArrow = true;
        pendingArrowLabel = tok.label;
      }
    }

    if (hasPendingArrow) {
      return { ok: false, reason: `arrow with no destination: ${t}` };
    }
  }

  return { ok: true, graph };
}
