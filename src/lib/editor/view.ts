// Factory wrapping ProseMirror EditorState + EditorView setup. We bind
// the default markdown keymap (Ctrl/Cmd-B for bold, Ctrl/Cmd-I for
// italic, Enter for paragraph split, Tab inside lists, etc.) plus the
// history plugin so Cmd-Z works out of the box.
import { EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { findWrapping } from 'prosemirror-transform';
import { editorSchema } from './schema';
import { parseMarkdown, serializeToMarkdown } from './markdown';
import { CalloutNodeView } from './callout-node-view';

export function createEditorView(
  parent: HTMLElement,
  initialMarkdown: string,
  onChange: (markdown: string) => void,
): EditorView {
  const doc = parseMarkdown(initialMarkdown);

  const baseKeys = {
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
    'Mod-b': toggleMark(editorSchema.marks.strong),
    'Mod-i': toggleMark(editorSchema.marks.em),
    'Mod-`': toggleMark(editorSchema.marks.code),
    'Enter': splitListItem(editorSchema.nodes.list_item),
    'Tab': sinkListItem(editorSchema.nodes.list_item),
    'Shift-Tab': liftListItem(editorSchema.nodes.list_item),
  };

  const state = EditorState.create({
    doc,
    plugins: [
      history(),
      keymap(baseKeys),
      keymap(baseKeymap),
    ],
  });

  // ProseMirror's dispatchTransaction needs to call view.updateState +
  // read view.state, but the closure captures `view` BEFORE the
  // EditorView constructor returns. Declare with `let` and assign
  // separately so TypeScript is happy with the forward reference.
  let view: EditorView;
  view = new EditorView(parent, {
    state,
    // Apply the same `md-rendered` class the reader uses, so all of
    // article.css's rules (callout boxes, list bullets, table styling,
    // code-block backgrounds, etc.) automatically render in the editor.
    attributes: {
      class: 'md-rendered',
    },
    nodeViews: {
      // Custom NodeView so the callout's fold chevron can dispatch a
      // transaction that updates the node's `fold` attr (rather than
      // the read-mode delegated handler in Viewer.svelte, which only
      // mutates DOM and would be lost on the next state apply).
      callout: (node, editorView, getPos) =>
        new CalloutNodeView(node, editorView, getPos),
    },
    dispatchTransaction(tr: Transaction) {
      const newState = view.state.apply(tr);
      view.updateState(newState);
      if (tr.docChanged) {
        onChange(serializeToMarkdown(newState.doc));
      }
    },
  });

  return view;
}

/**
 * Wrap the current selection's enclosing block(s) in a callout of the
 * given type. If the selection already sits inside a callout (or is
 * not in a wrappable block range), this is a no-op.
 */
export function insertCallout(type: string) {
  return (
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
  ): boolean => {
    const calloutType = editorSchema.nodes.callout;
    if (!calloutType) return false;

    const { $from, $to } = state.selection;
    const range = $from.blockRange($to);
    if (!range) return false;

    const wrapping = findWrapping(range, calloutType, { type, title: '', fold: '' });
    if (!wrapping) return false;

    if (dispatch) {
      const tr = state.tr.wrap(range, wrapping);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
