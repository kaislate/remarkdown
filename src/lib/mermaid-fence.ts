// Single definition of "this fenced block is a mermaid diagram", shared
// by the reader (MarkdownRenderer.ts) and the editor (code_block
// NodeView routing in editor/view.ts + MermaidNodeView.update) so the
// two can never disagree about which fences are diagrams.
//
// The language is the first word of the fence's info string, matched
// case-insensitively — ```Mermaid and ```mermaid title="…" are both
// diagrams. The rest of the info string is left alone: the editor keeps
// the full string in the code_block's `language` attr and writes it
// back verbatim.
export function isMermaidFence(info: string | null | undefined): boolean {
  const lang = String(info ?? '').trim().split(/\s+/)[0] ?? '';
  return lang.toLowerCase() === 'mermaid';
}
