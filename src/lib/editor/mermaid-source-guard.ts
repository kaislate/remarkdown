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
//   1. diagramKeymap — Backspace / Delete behave exactly as PM's
//      defaults, except where the default would cut into a diagram:
//      there they select the diagram instead (a NodeSelection, like a
//      picture in a word processor); a second press removes it whole.
//   2. createMermaidSourceGuard — a filterTransaction backstop: any
//      transaction with a step that reaches inside a diagram (its text
//      would change, or a join/split would cut through it) is dropped
//      unless it's a visual edit (tagged MERMAID_EDIT_META by
//      MermaidNodeView) or undo/redo. Removing, replacing or moving a
//      diagram whole, or changing only its fence attrs, is allowed.
import {
  Plugin,
  NodeSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { ReplaceStep, ReplaceAroundStep } from 'prosemirror-transform';
import { isHistoryTransaction } from 'prosemirror-history';
import { baseKeymap } from 'prosemirror-commands';
import type { Node, ResolvedPos } from 'prosemirror-model';
import { isMermaidFence } from '../mermaid-fence';

export const MERMAID_EDIT_META = 'mermaidVisualEdit';

function isDiagram(node: Node | null | undefined): boolean {
  return !!node && node.type.name === 'code_block' && isMermaidFence(String(node.attrs.language || ''));
}

// Does any step of `tr` reach INTO a diagram — a replace boundary
// strictly inside a diagram's node (pos < x < pos + nodeSize)? That's
// what editing, joining or splitting its text takes. Steps that replace
// a diagram node exactly, or don't touch it, have every boundary at or
// outside its edges: removing / replacing / moving a diagram whole, and
// typing over a selected one, all pass.
export function stepsReachIntoDiagram(tr: Transaction): boolean {
  return tr.steps.some((step, i) => {
    if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) return false;
    const s = step as ReplaceStep & Partial<Pick<ReplaceAroundStep, 'gapFrom' | 'gapTo'>>;
    const cuts = [s.from, s.to];
    if (step instanceof ReplaceAroundStep) cuts.push(step.gapFrom, step.gapTo);
    const doc = tr.docs[i];
    let inside = false;
    doc.nodesBetween(Math.max(0, Math.min(...cuts) - 1), Math.min(doc.content.size, Math.max(...cuts) + 1), (node, pos) => {
      if (inside) return false;
      if (!isDiagram(node)) return !node.isTextblock;
      if (cuts.some((x) => x > pos && x < pos + node.nodeSize)) inside = true;
      return false;
    });
    return inside;
  });
}

export function createMermaidSourceGuard(): Plugin {
  return new Plugin({
    filterTransaction(tr) {
      if (!tr.docChanged || tr.getMeta(MERMAID_EDIT_META) || isHistoryTransaction(tr)) return true;
      return !stepsReachIntoDiagram(tr);
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

// Backspace / Delete: run PM's own command, but look at what it would
// do first (capturing dispatch). If it doesn't reach into a diagram —
// lifting a list item out of a list, joining two paragraphs, selecting
// the diagram node — it's dispatched unchanged, exactly as anywhere
// else in the document. Only when it WOULD cut into a diagram's text
// (joining a neighbouring paragraph into it, or it into the paragraph)
// do we select the diagram instead. If neither applies, the key is
// swallowed: the guard would drop that transaction anyway.
function guardedDefault(key: 'Backspace' | 'Delete', dir: 1 | -1): Command {
  const base = baseKeymap[key];
  return (state, dispatch, view) => {
    let captured: Transaction | null = null;
    const handled = base(state, (tr) => { captured = tr; }, view);
    const tr = captured as Transaction | null;
    if (!handled) return false;
    if (!tr || !stepsReachIntoDiagram(tr)) {
      if (tr && dispatch) dispatch(tr);
      return true;
    }
    selectAdjacentDiagram(dir)(state, dispatch, view);
    return true;
  };
}

// Bound ahead of the base keymap in createEditorView.
export const diagramKeymap: Record<string, Command> = {
  Backspace: guardedDefault('Backspace', -1),
  Delete: guardedDefault('Delete', 1),
  'Mod-Backspace': guardedDefault('Backspace', -1),
  'Mod-Delete': guardedDefault('Delete', 1),
};
