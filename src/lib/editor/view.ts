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
import { tableEditing } from 'prosemirror-tables';
import { editorSchema } from './schema';
import { parseMarkdown, serializeToMarkdown } from './markdown';
import { CalloutNodeView } from './callout-node-view';
import { CodeBlockNodeView } from './code-block-node-view';
import { MermaidNodeView } from './mermaid-node-view';
import { TaskItemNodeView } from './task-item-node-view';
import { createCodeBlockHighlightPlugin } from './code-block-highlight';
import { tabInTable } from './table-commands';
import { createTableActionsPlugin } from './table-actions-plugin';

// Insert N spaces at the cursor, but only if the cursor is inside a
// code_block. Outside code_blocks this returns false and the chained
// list-indent command runs.
export function indentCodeBlock(n: number) {
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

// Wrapper around prosemirror-schema-list's splitListItem that resets
// the new sibling's `checked` attr to false when the parent was a
// checked task. Without this, splitting a `[x] done` task would
// produce another `[x]` item — every other task UX (Notion, Obsidian,
// GitHub) defaults the new task to unchecked.
export function splitTaskOrListItem(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const original = splitListItem(editorSchema.nodes.list_item);
  if (!dispatch) return original(state, undefined);
  let captured: Transaction | null = null;
  const ok = original(state, (tr) => {
    captured = tr;
  });
  if (!ok || !captured) return false;
  // Find the newly-created list_item (the one AFTER the cursor in the
  // resulting tr) and clear its checked state if it inherited a task
  // marker.
  const trAny = captured as Transaction;
  const $cursor = trAny.selection.$from;
  // Walk up until we find the list_item ancestor of the new cursor.
  for (let d = $cursor.depth; d >= 0; d--) {
    const n = $cursor.node(d);
    if (n.type.name === 'list_item' && n.attrs.checked === true) {
      const pos = $cursor.before(d);
      trAny.setNodeMarkup(pos, undefined, { ...n.attrs, checked: false });
      break;
    }
  }
  dispatch(trAny);
  return true;
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
    // `Mod-,` and `Mod-.` for sub/sup — same convention as Google Docs.
    // Matches the bubble-menu's Subscript / Superscript buttons.
    'Mod-,': toggleMark(editorSchema.marks.sub),
    'Mod-.': toggleMark(editorSchema.marks.sup),
    // Inside a code_block, Enter inserts a literal newline (don't split
    // the block); Mod-Enter exits to a fresh paragraph below; Tab and
    // Shift-Tab indent / dedent two spaces. Outside code blocks the
    // commands no-op (return false) and the chained list command runs.
    // The trailing `() => true` on the Tab chains consumes the key
    // even outside code-block / list contexts so focus doesn't escape
    // the editor surface to the next focusable element on the page.
    'Enter': chainCommands(newlineInCode, splitTaskOrListItem),
    'Mod-Enter': exitCode,
    'Tab': chainCommands(
      tabInTable,
      indentCodeBlock(2),
      sinkListItem(editorSchema.nodes.list_item),
      () => true,
    ),
    'Shift-Tab': chainCommands(
      dedentCodeBlock(2),
      liftListItem(editorSchema.nodes.list_item),
      () => true,
    ),
  };

  const state = EditorState.create({
    doc,
    plugins: [
      history(),
      keymap(baseKeys),
      keymap(baseKeymap),
      createCodeBlockHighlightPlugin(),
      tableEditing(),
      createTableActionsPlugin(),
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
      code_block: (node, editorView, getPos) => {
        if (String(node.attrs.language || '') === 'mermaid') {
          return new MermaidNodeView(node, editorView, getPos);
        }
        return new CodeBlockNodeView(node, editorView, getPos);
      },
      list_item: (node, editorView, getPos) =>
        new TaskItemNodeView(node, editorView, getPos),
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

/**
 * Wrap the current selection's enclosing block in a bullet_list whose
 * single list_item is an unchecked task (`checked: false`). If the
 * selection is already inside a list_item, this is a no-op — use the
 * checkbox to toggle existing items.
 */
export function insertTaskList() {
  return (
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
  ): boolean => {
    const ulType = editorSchema.nodes.bullet_list;
    const liType = editorSchema.nodes.list_item;
    if (!ulType || !liType) return false;
    const { $from, $to } = state.selection;
    if ($from.parent.type.name === 'list_item') return false;
    const range = $from.blockRange($to);
    if (!range) return false;
    const wrapping = findWrapping(range, ulType);
    if (!wrapping) return false;
    if (dispatch) {
      const tr = state.tr.wrap(range, wrapping);
      // After wrap, the bullet_list starts at range.start and the new
      // list_item starts at range.start + 1. Setting checked: false
      // directly by position is more precise than walking descendants
      // and matching on `checked: null` — which would also match any
      // pre-existing plain list_items elsewhere in the doc.
      const liPos = range.start + 1;
      const liNode = tr.doc.nodeAt(liPos);
      if (liNode && liNode.type === liType) {
        tr.setNodeMarkup(liPos, undefined, { ...liNode.attrs, checked: false });
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export { insertTable } from './table-commands';
export { insertMermaid, insertSequenceDiagram } from './mermaid-commands';
