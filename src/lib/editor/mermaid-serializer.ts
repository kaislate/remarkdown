// Emit a MermaidGraph as flowchart source. One declaration per node,
// then edges. The serializer is the source of truth for the
// `parse(emit(parse(text))) === parse(text)` round-trip property —
// keep it minimal and stable so future additions don't drift.
import type { MermaidGraph, MermaidNode, MermaidShape } from './mermaid-graph';

const OPEN: Record<MermaidShape, string> = {
  rect: '[',
  rounded: '(',
  circle: '((',
  diamond: '{',
};
const CLOSE: Record<MermaidShape, string> = {
  rect: ']',
  rounded: ')',
  circle: '))',
  diamond: '}',
};

// Reserved-ish characters that force us to wrap the label in double
// quotes for safety in mermaid's parser. Keep this tight — mermaid's
// own grammar is permissive but we err on the side of wrapping when
// in doubt.
const RESERVED = /[[\](){}|"<>]/;

function emitLabel(label: string): string {
  if (RESERVED.test(label)) {
    // Escape any embedded quotes by doubling them up — mermaid's
    // grammar accepts "" inside a quoted literal.
    return `"${label.replace(/"/g, '""')}"`;
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
    if (edge.label) {
      lines.push(`${edge.from} -->|${edge.label}| ${edge.to}`);
    } else {
      lines.push(`${edge.from} --> ${edge.to}`);
    }
  }
  return lines.join('\n') + '\n';
}
