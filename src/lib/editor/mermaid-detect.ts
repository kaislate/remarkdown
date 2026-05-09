// Detect the diagram type from a mermaid source string. Used by
// MermaidNodeView to route to the correct parser/serializer/popover
// set. The same NodeView dispatches both flowchart and sequence
// diagrams (and treats anything else as render-only fallback).
//
// Detection is intentionally minimal: just look at the first non-
// blank, non-comment line and match against the directive keywords
// we support. We don't validate the rest of the source — that's
// the per-type parser's job.

export type MermaidDiagramType = 'flowchart' | 'sequence' | 'unsupported';

export function detectDiagramType(source: string): MermaidDiagramType {
  const lines = source.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('%%')) continue;
    if (/^flowchart\s+(TD|TB|LR|BT|RL)\b/.test(line)) return 'flowchart';
    if (/^sequenceDiagram\b/.test(line)) return 'sequence';
    return 'unsupported';
  }
  return 'unsupported';
}
