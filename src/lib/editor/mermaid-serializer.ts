// Emitters for flowchart source. The visual editor's edits go through
// mermaid-flowchart-edit.ts, which uses the token emitters below for the
// text an edit is about; serializeMermaid writes a whole graph (tests,
// fresh diagrams).
import type { MermaidGraph, MermaidNode, MermaidShape, EdgeStroke, EdgeEnds } from './mermaid-graph';
import { SHAPE_DELIMS } from './mermaid-parser';

// Characters that make us wrap the label in double quotes for safety in
// mermaid's parser. Keep this tight — mermaid's own grammar is
// permissive but we err on the side of wrapping when in doubt.
//   - brackets/braces/parens/pipe/quote/angle: shape + label syntax
//   - backtick: a "`…`" label is a markdown string ONLY while quoted;
//     unquoted, mermaid shows the backticks and asterisks literally
//   - # and ;: entity codes and the statement separator
//   - &, <: written as entity codes (below) — raw, mermaid's HTML
//     labels could read `<b>` as markup and `&amp;` as an entity. (`>`
//     alone can't start either; it stays raw so "x -> y" stays
//     readable.)
//   - % and a leading/trailing dash or dot: `%%` starts a comment, and
//     a label such as "-x" could read as part of a link.
const RESERVED = /[[\](){}|"<>`#;&%\\/]|^[\s.=~-]|[\s.=~-]$|\n/;

const ENTITY: Record<string, string> = { '"': '#quot;', '&': '#amp;', '<': '#lt;' };

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
      // escape is NOT accepted by mermaid 11's grammar. & and < use
      // theirs so they show as typed rather than as HTML.
      .replace(/["&<]/g, (c) => ENTITY[c])
      // A line break in a plain label is mermaid's <br>.
      .replace(/\r\n|\r|\n/g, '<br>');
    return `"${escaped}"`;
  }
  return label;
}

// A markdown-string label: "`…`" (bold / italic / line breaks are
// markdown inside). Quotes can't appear raw inside the string.
export function emitMarkdownLabel(markdown: string): string {
  return `"\`${markdown.replace(/"/g, '#quot;')}\`"`;
}

export function emitAnyLabel(label: string, markdown: boolean | undefined): string {
  return markdown ? emitMarkdownLabel(label) : emitLabel(label);
}

export function shapeDelims(shape: MermaidShape): [string, string] {
  return SHAPE_DELIMS[shape === 'other' ? 'rect' : shape];
}

export function emitNode(n: MermaidNode): string {
  const [open, close] = shapeDelims(n.shape);
  return `${n.id}${open}${emitAnyLabel(n.label, n.markdown)}${close}`;
}

const TAIL: Record<EdgeEnds, string> = {
  arrow: '>',
  none: '',
  circle: 'o',
  cross: 'x',
  'both-arrow': '>',
  'both-circle': 'o',
  'both-cross': 'x',
};

const HEAD: Record<EdgeEnds, string> = {
  arrow: '',
  none: '',
  circle: '',
  cross: '',
  'both-arrow': '<',
  'both-circle': 'o',
  'both-cross': 'x',
};

// The link token for `stroke` / `ends` / `length`, without a label.
export function emitLink(stroke: EdgeStroke = 'solid', ends: EdgeEnds = 'arrow', length = 1): string {
  const n = Math.max(1, length);
  const head = HEAD[ends];
  const tail = TAIL[ends];
  switch (stroke) {
    case 'invisible':
      return '~'.repeat(n + 2);
    case 'thick':
      return `${head}${'='.repeat(n + 1)}${tail || '='}`;
    case 'dotted':
      return `${head}-${'.'.repeat(n)}-${tail}`;
    default:
      return `${head}${'-'.repeat(n + 1)}${tail || '-'}`;
  }
}

// The arrow token, including its `|label|` when there is one.
export function emitArrow(
  edge: { stroke?: EdgeStroke; ends?: EdgeEnds; length?: number; label?: string; markdown?: boolean },
): string {
  const link = emitLink(edge.stroke, edge.ends, edge.length);
  // emitLabel quote-wraps when the label contains reserved chars
  // (notably `|`, which would otherwise terminate the label early and
  // break the whole line for mermaid AND our parser).
  return edge.label ? `${link}|${emitAnyLabel(edge.label, edge.markdown)}|` : link;
}

export function serializeMermaid(graph: MermaidGraph): string {
  const lines: string[] = [`flowchart ${graph.direction}`];
  for (const node of graph.nodes.values()) {
    lines.push(emitNode(node));
  }
  for (const edge of graph.edges) {
    lines.push(`${edge.from} ${edge.id ? `${edge.id}@` : ''}${emitArrow(edge)} ${edge.to}`);
  }
  return lines.join('\n') + '\n';
}
