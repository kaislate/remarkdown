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
import { editorSchema, parseMarkdown, serializeToMarkdown } from './markdown';

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
