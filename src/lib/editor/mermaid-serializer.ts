// Emit a MermaidGraph as flowchart source. One declaration per node,
// then edges. The serializer is the source of truth for the
// `parse(emit(parse(text))) === parse(text)` round-trip property —
// keep it minimal and stable so future additions don't drift.
import type { MermaidGraph, MermaidNode, MermaidShape, EdgeStyle } from './mermaid-graph';

const OPEN: Record<MermaidShape, string> = {
  rect: '[',
  rounded: '(',
  circle: '((',
  diamond: '{',
  hexagon: '{{',
  cylinder: '[(',
  stadium: '([',
  parallelogram: '[/',
};
const CLOSE: Record<MermaidShape, string> = {
  rect: ']',
  rounded: ')',
  circle: '))',
  diamond: '}',
  hexagon: '}}',
  cylinder: ')]',
  stadium: '])',
  parallelogram: '/]',
};

const EDGE_DELIM: Record<EdgeStyle, string> = {
  arrow: '-->',
  line: '---',
  dotted: '-.->',
  thick: '==>',
};

// Reserved-ish characters that force us to wrap the label in double
// quotes for safety in mermaid's parser. Keep this tight — mermaid's
// own grammar is permissive but we err on the side of wrapping when
// in doubt.
const RESERVED = /[[\](){}|"<>]/;

function emitLabel(label: string): string {
  // Mermaid rejects empty labels (`A[]` is a parse error) — emit a
  // quoted single space instead, which renders as a blank shape. The
  // label round-trips as ' ' from then on.
  if (label === '') return '" "';
  if (RESERVED.test(label)) {
    // Escape embedded quotes with mermaid's #quot; entity — the
    // doubled-"" escape is NOT accepted by mermaid 11's grammar.
    return `"${label.replace(/"/g, '#quot;')}"`;
  }
  return label;
}

function emitNode(n: MermaidNode): string {
  return `${n.id}${OPEN[n.shape]}${emitLabel(n.label)}${CLOSE[n.shape]}`;
}

export function serializeMermaid(graph: MermaidGraph): string {
  const lines: string[] = [`flowchart ${graph.direction}`];
  for (const node of graph.nodes.values()) {
    lines.push(emitNode(node));
  }
  for (const edge of graph.edges) {
    const delim = EDGE_DELIM[edge.style ?? 'arrow'];
    if (edge.label) {
      // emitLabel quote-wraps when the label contains reserved chars
      // (notably `|`, which would otherwise terminate the label early
      // and break the whole line for mermaid AND our parser).
      lines.push(`${edge.from} ${delim}|${emitLabel(edge.label)}| ${edge.to}`);
    } else {
      lines.push(`${edge.from} ${delim} ${edge.to}`);
    }
  }
  return lines.join('\n') + '\n';
}
