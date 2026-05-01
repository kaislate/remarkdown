// Factory wrapping ProseMirror EditorState + EditorView setup. We bind
// the default markdown keymap (Ctrl/Cmd-B for bold, Ctrl/Cmd-I for
// italic, Enter for paragraph split, Tab inside lists, etc.) plus the
// history plugin so Cmd-Z works out of the box.
import { EditorState, TextSelection, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import {
  baseKeymap,
  chainCommands,
  exitCode,
  newlineInCode,
  toggleMark,
} from 'prosemirror-commands';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { findWrapping } from 'prosemirror-transform';
import { editorSchema } from './schema';
import { parseMarkdown, serializeToMarkdown } from './markdown';
import { CalloutNodeView } from './callout-node-view';
import { CodeBlockNodeView } from './code-block-node-view';
import { createCodeBlockHighlightPlugin } from './code-block-highlight';

// Insert N spaces at the cursor, but only if the cursor is inside a
// code_block. Outside code_blocks this returns false and the chained
// list-indent command runs.
function indentCodeBlock(n: number) {
  const indent = ' '.repeat(n);
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { $from } = state.selection;
    if ($from.parent.type.name !== 'code_block') return false;
    if (dispatch) dispatch(state.tr.insertText(indent).scrollIntoView());
    return true;
  };
}

// Remove up to N leading spaces immediately before the cursor on the
// current line, only inside a code_block.
function dedentCodeBlock(n: number) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { $from } = state.selection;
    if ($from.parent.type.name !== 'code_block') return false;
    const lineStart = $from.start();
    const text = $from.parent.textContent;
    const offset = $from.parentOffset;
    // Walk back from offset to the start of the current line.
    let lineOffset = offset;
    while (lineOffset > 0 && text[lineOffset - 1] !== '\n') lineOffset--;
    let removed = 0;
    while (removed < n && text[lineOffset + removed] === ' ') removed++;
    if (removed === 0) return false;
    if (dispatch) {
      const from = lineStart + lineOffset;
      const to = from + removed;
      dispatch(state.tr.delete(from, to).scrollIntoView());
    }
    return true;
  };
}

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
    // Inside a code_block, Enter inserts a literal newline (don't split
    // the block); Mod-Enter exits to a fresh paragraph below; Tab and
    // Shift-Tab indent / dedent two spaces. Outside code blocks the
    // commands no-op (return false) and the chained list command runs.
    'Enter': chainCommands(newlineInCode, splitListItem(editorSchema.nodes.list_item)),
    'Mod-Enter': exitCode,
    'Tab': chainCommands(indentCodeBlock(2), sinkListItem(editorSchema.nodes.list_item)),
    'Shift-Tab': chainCommands(dedentCodeBlock(2), liftListItem(editorSchema.nodes.list_item)),
  };

  const state = EditorState.create({
    doc,
    plugins: [
      history(),
      keymap(baseKeys),
      keymap(baseKeymap),
      createCodeBlockHighlightPlugin(),
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
      code_block: (node, editorView, getPos) =>
        new CodeBlockNodeView(node, editorView, getPos),
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

/**
 * Replace the current selection's enclosing block with an empty
 * code_block of the given language. If the selection is already
 * inside a code_block, this is a no-op.
 */
export function insertCodeBlock(language: string) {
  return (
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
  ): boolean => {
    const cbType = editorSchema.nodes.code_block;
    if (!cbType) return false;
    const { $from } = state.selection;
    if ($from.parent.type.name === 'code_block') return false;
    const range = $from.blockRange();
    if (!range) return false;
    if (dispatch) {
      const block = cbType.create({ language }, []);
      const tr = state.tr.replaceRangeWith(range.start, range.end, block);
      // Place the cursor inside the new (empty) block.
      const newPos = range.start + 1;
      tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
