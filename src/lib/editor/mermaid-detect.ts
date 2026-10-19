// Detect the diagram type from a mermaid source string. Used by
// MermaidNodeView to pick the type's controller (mermaid/registry.ts);
// a type without one renders read-only.
//
// Detection is intentionally minimal: skip YAML frontmatter, blank
// lines and `%%` comments / directives, then match the header keyword.
// We don't validate the rest of the source — that's the per-type
// parser's job.
import { findPreamble } from './mermaid/source-text';

export type MermaidDiagramType =
  | 'flowchart'
  | 'sequence'
  | 'pie'
  | 'gantt'
  | 'state'
  | 'class'
  | 'er'
  | 'mindmap'
  | 'timeline'
  | 'kanban'
  | 'journey'
  | 'quadrant'
  | 'xychart'
  | 'gitgraph'
  | 'sankey'
  | 'block'
  | 'c4'
  | 'requirement'
  | 'architecture'
  | 'packet'
  | 'radar'
  | 'unsupported';

// Header keyword → type, longest keywords first where one prefixes
// another (`stateDiagram-v2` / `stateDiagram`).
const HEADERS: Array<[RegExp, MermaidDiagramType]> = [
  [/^(flowchart|flowchart-elk|graph)(\s|;|$)/, 'flowchart'],
  [/^sequenceDiagram\b/, 'sequence'],
  [/^pie\b/, 'pie'],
  [/^gantt\b/, 'gantt'],
  [/^stateDiagram(-v2)?\b/, 'state'],
  [/^classDiagram(-v2)?\b/, 'class'],
  [/^erDiagram\b/, 'er'],
  [/^mindmap\b/, 'mindmap'],
  [/^timeline\b/, 'timeline'],
  [/^kanban\b/, 'kanban'],
  [/^journey\b/, 'journey'],
  [/^quadrantChart\b/, 'quadrant'],
  [/^xychart(-beta)?\b/, 'xychart'],
  [/^gitGraph\b/, 'gitgraph'],
  [/^sankey(-beta)?\b/, 'sankey'],
  [/^block(-beta)?\b/, 'block'],
  [/^C4(Context|Container|Component|Dynamic|Deployment)\b/, 'c4'],
  [/^requirementDiagram\b/, 'requirement'],
  [/^architecture(-beta)?\b/, 'architecture'],
  [/^packet(-beta)?\b/, 'packet'],
  [/^radar(-beta)?\b/, 'radar'],
];

export function detectDiagramType(source: string): MermaidDiagramType {
  const lines = source.split(/\r?\n/);
  const { headerLine } = findPreamble(lines);
  if (headerLine === -1) return 'unsupported';
  const line = lines[headerLine].trim();
  for (const [re, type] of HEADERS) if (re.test(line)) return type;
  return 'unsupported';
}
