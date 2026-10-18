// Keeps a diagram's source out of reach of ordinary text editing.
//
// In edit mode a mermaid diagram is a code_block whose text (the
// mermaid source) PM still owns, hidden behind the rendered diagram.
// Only the visual editor is supposed to change that text — but PM's
// stock commands don't know that. Found while tracing where the
// "glued statement" message text behind the old sequence-serializer
// truncation came from:
//   - Backspace at the start of the paragraph after a diagram joined
//     the paragraph INTO the diagram, gluing its text onto the last
//     source line ('B->>A: twoAfter para.')
//   - Delete at the end of the paragraph before a diagram erased the
//     diagram's whole source
// Two layers:
//   1. diagramKeymap — Backspace / Delete next to a diagram select it
//      (a NodeSelection, like a picture in a word processor); a second
//      press removes the diagram as a whole.
//   2. createMermaidSourceGuard — a filterTransaction backstop: any
//      transaction that changes the text of an existing diagram is
//      dropped unless it's a visual edit (tagged MERMAID_EDIT_META by
//      MermaidNodeView) or undo/redo. Removing a diagram entirely, or
//      changing only its fence attrs, is allowed.
import { Plugin, NodeSelection, type Command, type EditorState } from 'prosemirror-state';
import { isHistoryTransaction } from 'prosemirror-history';
import type { Node, ResolvedPos } from 'prosemirror-model';
import { isMermaidFence } from '../mermaid-fence';

export const MERMAID_EDIT_META = 'mermaidVisualEdit';

function isDiagram(node: Node | null | undefined): boolean {
  return !!node && node.type.name === 'code_block' && isMermaidFence(String(node.attrs.language || ''));
}

export function createMermaidSourceGuard(): Plugin {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta(MERMAID_EDIT_META) || isHistoryTransaction(tr)) return true;
      let ok = true;
      state.doc.descendants((node, pos) => {
        if (!ok) return false;
        // Diagrams are textblocks; no need to walk into other textblocks'
        // inline content on every keystroke.
        if (!isDiagram(node)) return !node.isTextblock;
        const start = tr.mapping.mapResult(pos, 1).pos;
        const end = tr.mapping.mapResult(pos + node.nodeSize, -1).pos;
        // Removed as a whole: fine.
        if (end <= start) return false;
        const after = tr.doc.nodeAt(start);
        if (
          !after ||
          after.type !== node.type ||
          start + after.nodeSize !== end ||
          after.textContent !== node.textContent
        ) {
          ok = false;
        }
        return false;
      });
      return ok;
    },
  });
}

// The position just past (dir 1) / before (dir -1) the textblock the
// cursor is at the edge of, walking up while that block is the
// last / first child — the same "cut" PM's joinForward/joinBackward use.
function findCut($pos: ResolvedPos, dir: 1 | -1): ResolvedPos | null {
  for (let d = $pos.depth - 1; d >= 0; d--) {
    const index = $pos.index(d);
    const parent = $pos.node(d);
    if (dir > 0 ? index < parent.childCount - 1 : index > 0) {
      return $pos.doc.resolve(dir > 0 ? $pos.after(d + 1) : $pos.before(d + 1));
    }
    if (parent.type.spec.isolating) return null;
  }
  return null;
}

function selectAdjacentDiagram(dir: 1 | -1): Command {
  return (state: EditorState, dispatch) => {
    const sel = state.selection;
    if (!sel.empty) return false;
    const $pos = sel.$from;
    if (!$pos.parent.isTextblock || isDiagram($pos.parent)) return false;
    const atEdge = dir > 0 ? $pos.parentOffset === $pos.parent.content.size : $pos.parentOffset === 0;
    if (!atEdge) return false;
    const $cut = findCut($pos, dir);
    const neighbour = dir > 0 ? $cut?.nodeAfter : $cut?.nodeBefore;
    if (!$cut || !neighbour || !isDiagram(neighbour)) return false;
    if (dispatch) {
      const tr = state.tr;
      let at = dir > 0 ? $cut.pos : $cut.pos - neighbour.nodeSize;
      // An empty paragraph next to the diagram goes away (what the key
      // means there), then the diagram is selected. Left alone, PM's
      // join would park the caret inside the hidden source.
      if ($pos.parent.content.size === 0) {
        tr.delete($pos.before(), $pos.after());
        at = tr.mapping.map(at, dir > 0 ? 1 : -1);
      }
      const node = tr.doc.nodeAt(at);
      if (isDiagram(node)) tr.setSelection(NodeSelection.create(tr.doc, at));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// Bound ahead of the base keymap in createEditorView.
export const diagramKeymap: Record<string, Command> = {
  Backspace: selectAdjacentDiagram(-1),
  Delete: selectAdjacentDiagram(1),
  'Mod-Backspace': selectAdjacentDiagram(-1),
  'Mod-Delete': selectAdjacentDiagram(1),
};
