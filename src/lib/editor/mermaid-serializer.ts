// Emit a MermaidGraph as flowchart source. One declaration per node,
// then edges. Used for whole-graph output (tests, fresh diagrams); the
// visual editor's edits go through mermaid-flowchart-edit.ts, which
// reuses the token emitters below but only rewrites the text an edit
// is about.
import type { MermaidGraph, MermaidNode, MermaidShape, EdgeStyle } from './mermaid-graph';

export const OPEN: Record<MermaidShape, string> = {
  rect: '[',
  rounded: '(',
  circle: '((',
  diamond: '{',
  hexagon: '{{',
  cylinder: '[(',
  stadium: '([',
  parallelogram: '[/',
};
export const CLOSE: Record<MermaidShape, string> = {
  rect: ']',
  rounded: ')',
  circle: '))',
  diamond: '}',
  hexagon: '}}',
  cylinder: ')]',
  stadium: '])',
  parallelogram: '/]',
};

export const EDGE_DELIM: Record<EdgeStyle, string> = {
  arrow: '-->',
  line: '---',
  dotted: '-.->',
  thick: '==>',
};

// Characters that make us wrap the label in double quotes for safety in
// mermaid's parser. Keep this tight — mermaid's own grammar is
// permissive but we err on the side of wrapping when in doubt.
//   - brackets/braces/parens/pipe/quote/angle: shape + label syntax
//   - backtick: a "`…`" label is a markdown string ONLY while quoted;
//     unquoted, mermaid shows the backticks and asterisks literally
//   - # and ;: entity codes and the statement separator
const RESERVED = /[[\](){}|"<>`#;]/;

export function emitLabel(label: string): string {
  // Mermaid rejects empty labels (`A[]` is a parse error) — emit a
  // quoted single space instead, which renders as a blank shape. The
  // label round-trips as ' ' from then on.
  if (label === '') return '" "';
  if (RESERVED.test(label)) {
    const escaped = label
      // mermaid decodes `#name;` / `#123;` anywhere in the text; a `#`
      // that would start one is itself encoded so the user's literal
      // text survives (`a #59; b` stays `a #59; b`, not `a ; b`).
      .replace(/#(?=\w+;)/g, '#35;')
      // Embedded quotes use mermaid's #quot; entity — the doubled-""
      // escape is NOT accepted by mermaid 11's grammar.
      .replace(/"/g, '#quot;');
    return `"${escaped}"`;
  }
  return label;
}

export function emitNode(n: MermaidNode): string {
  return `${n.id}${OPEN[n.shape]}${emitLabel(n.label)}${CLOSE[n.shape]}`;
}

// The arrow token, including its `|label|` when there is one.
export function emitArrow(style: EdgeStyle | undefined, label: string | undefined): string {
  const delim = EDGE_DELIM[style ?? 'arrow'];
  // emitLabel quote-wraps when the label contains reserved chars
  // (notably `|`, which would otherwise terminate the label early and
  // break the whole line for mermaid AND our parser).
  return label ? `${delim}|${emitLabel(label)}|` : delim;
}

export function serializeMermaid(graph: MermaidGraph): string {
  const lines: string[] = [`flowchart ${graph.direction}`];
  for (const node of graph.nodes.values()) {
    lines.push(emitNode(node));
  }
  for (const edge of graph.edges) {
    lines.push(`${edge.from} ${emitArrow(edge.style, edge.label)} ${edge.to}`);
  }
  return lines.join('\n') + '\n';
}
