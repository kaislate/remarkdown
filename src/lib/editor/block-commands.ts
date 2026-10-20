// Making the shape of the text — headings, lists, quotes, divider lines —
// without knowing markdown: the toolbar's "Text style" menu, keyboard
// shortcuts (as in Google Docs and Word), and, for people who do know a
// little markdown, typing `# `, `- `, `1. `, `> ` or `---` at the start
// of a line (input rules).
//
// Each style is a toggle-ish switch on the block the cursor is in:
// picking Bulleted list in a bulleted list takes the list away again;
// picking Normal text takes the block out of any list or quote.

import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Fragment, type NodeType, type ResolvedPos } from 'prosemirror-model';
import { findWrapping } from 'prosemirror-transform';
import { setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule } from 'prosemirror-inputrules';
import { editorSchema } from './schema';

export type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'quote';

export const BLOCK_STYLES: Array<{ style: BlockStyle; label: string; keys: string }> = [
  { style: 'paragraph', label: 'Normal text', keys: 'Ctrl+Alt+0' },
  { style: 'h1', label: 'Heading 1', keys: 'Ctrl+Alt+1' },
  { style: 'h2', label: 'Heading 2', keys: 'Ctrl+Alt+2' },
  { style: 'h3', label: 'Heading 3', keys: 'Ctrl+Alt+3' },
  { style: 'bullet', label: 'Bulleted list', keys: 'Ctrl+Shift+8' },
  { style: 'ordered', label: 'Numbered list', keys: 'Ctrl+Shift+7' },
  { style: 'quote', label: 'Quote', keys: 'Ctrl+Shift+9' },
];

const nodes = editorSchema.nodes;

// The nearest list or quote around the cursor, with its depth.
function nearest($from: ResolvedPos, types: NodeType[]): { depth: number; type: NodeType } | null {
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type;
    if (types.includes(t)) return { depth: d, type: t };
  }
  return null;
}

// What the toolbar shows for the cursor's block: a heading's level, else
// the nearest list or quote around it, else normal text. null for things
// that aren't text styles (code, a diagram, a table cell…).
export function currentBlockStyle(state: EditorState): BlockStyle | null {
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type === nodes.heading) {
    const level = Number(parent.attrs.level);
    return level <= 3 ? (`h${level}` as BlockStyle) : null;
  }
  if (parent.type !== nodes.paragraph) return null;
  const around = nearest($from, [nodes.bullet_list, nodes.ordered_list, nodes.blockquote]);
  if (around?.type === nodes.bullet_list) return 'bullet';
  if (around?.type === nodes.ordered_list) return 'ordered';
  if (around?.type === nodes.blockquote) return 'quote';
  // Inside a table cell or a callout a paragraph is still normal text.
  return 'paragraph';
}

// Runs commands one after another on the view (they merge into one undo
// step, being back to back). Stops at the first that can't run.
function run(view: EditorView, ...cmds: Command[]): boolean {
  let any = false;
  for (const cmd of cmds) {
    if (!cmd(view.state, view.dispatch, view)) break;
    any = true;
  }
  return any;
}

// Lifts the cursor's block out of every list around it.
function leaveLists(view: EditorView): void {
  const lift1 = liftListItem(nodes.list_item);
  for (let i = 0; i < 8 && nearest(view.state.selection.$from, [nodes.bullet_list, nodes.ordered_list]); i++) {
    if (!lift1(view.state, view.dispatch)) break;
  }
}

function leaveQuote(view: EditorView): void {
  for (let i = 0; i < 8 && nearest(view.state.selection.$from, [nodes.blockquote]); i++) {
    if (!lift(view.state, view.dispatch)) break;
  }
}

function toList(view: EditorView, type: NodeType): boolean {
  const other = type === nodes.bullet_list ? nodes.ordered_list : nodes.bullet_list;
  const around = nearest(view.state.selection.$from, [nodes.bullet_list, nodes.ordered_list]);
  if (around?.type === type) {
    leaveLists(view);
    return true;
  }
  if (around?.type === other) {
    // Same items, the other kind of list.
    const pos = view.state.selection.$from.before(around.depth);
    const list = view.state.doc.nodeAt(pos)!;
    const attrs = type === nodes.ordered_list ? { order: 1, tight: list.attrs.tight } : { tight: list.attrs.tight };
    view.dispatch(view.state.tr.setNodeMarkup(pos, type, attrs));
    return true;
  }
  if (view.state.selection.$from.parent.type === nodes.heading) setBlockType(nodes.paragraph)(view.state, view.dispatch);
  return run(view, wrapInList(type));
}

// Quotes the selected blocks — a list whole, not one item of it.
const quoteWhole: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  const listy = [nodes.bullet_list, nodes.ordered_list, nodes.list_item];
  const range = $from.blockRange($to, (n) => !listy.includes(n.type));
  const wrapping = range && findWrapping(range, nodes.blockquote);
  if (!range || !wrapping) return wrapIn(nodes.blockquote)(state, dispatch);
  if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView());
  return true;
};

// The command for a style (the toolbar, shortcuts). Needs the view: some
// styles take more than one step.
export function setBlockStyle(style: BlockStyle): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    if (currentBlockStyle(state) === null && style !== 'quote') return false;
    if (!dispatch) return true;
    switch (style) {
      case 'paragraph':
        leaveLists(view);
        leaveQuote(view);
        return run(view, setBlockType(nodes.paragraph)) || true;
      case 'h1':
      case 'h2':
      case 'h3':
        leaveLists(view);
        return run(view, setBlockType(nodes.heading, { level: Number(style[1]) }));
      case 'bullet':
        return toList(view, nodes.bullet_list);
      case 'ordered':
        return toList(view, nodes.ordered_list);
      case 'quote':
        if (nearest(view.state.selection.$from, [nodes.blockquote])) {
          leaveQuote(view);
          return true;
        }
        return run(view, quoteWhole);
    }
  };
}

// A divider line after the cursor's block (in place of it, if it's an
// empty paragraph), with the cursor on a fresh line below.
export const insertDivider: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code || $from.depth < 1) return false;
  if (!dispatch) return true;
  const hr = nodes.horizontal_rule.create();
  const para = nodes.paragraph.create();
  const emptyPara = $from.parent.type === nodes.paragraph && $from.parent.content.size === 0;
  let tr: Transaction;
  let after: number;
  if (emptyPara) {
    const start = $from.before();
    tr = state.tr.replaceWith(start, $from.after(), Fragment.from([hr, para]));
    after = start + hr.nodeSize + 1;
  } else {
    const end = $from.after();
    tr = state.tr.insert(end, Fragment.from([hr, para]));
    after = end + hr.nodeSize + 1;
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(after)));
  dispatch(tr.scrollIntoView());
  return true;
};

// Keyboard shortcuts for the styles.
export const blockStyleKeys: Record<string, Command> = {
  'Mod-Alt-0': setBlockStyle('paragraph'),
  'Mod-Alt-1': setBlockStyle('h1'),
  'Mod-Alt-2': setBlockStyle('h2'),
  'Mod-Alt-3': setBlockStyle('h3'),
  'Mod-Shift-8': setBlockStyle('bullet'),
  'Mod-Shift-7': setBlockStyle('ordered'),
  'Mod-Shift-9': setBlockStyle('quote'),
};

// Typing markdown's own way at the start of a line: `# ` … `### `,
// `- ` / `* ` / `+ `, `1. `, `> `, and `---` for a divider. (Not in code.)
export function blockInputRules() {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (m) => ({ level: m[1].length })),
      wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list, (m) => ({ bullet: m[1] })),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        nodes.ordered_list,
        (m) => ({ order: Number(m[1]) }),
        (m, node) => node.childCount + Number(node.attrs.order) === Number(m[1]),
      ),
      wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
      new InputRule(/^(?:---|\*\*\*|___)$/, (state, _m, start) => {
        const $start = state.doc.resolve(start);
        if ($start.parent.type !== nodes.paragraph || $start.parentOffset !== 0) return null;
        const from = $start.before();
        const tr = state.tr.replaceWith(from, $start.after(), Fragment.from([nodes.horizontal_rule.create(), nodes.paragraph.create()]));
        tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2)));
        return tr;
      }),
    ],
  });
}

// A formula: selected text becomes one (in the line); on an empty line, a
// formula block; otherwise an empty one in the line. `opened` gets the new
// node's position, so its editor can be opened straight away.
export function insertFormula(opened?: (pos: number) => void): Command {
  return (state, dispatch) => {
    const { $from, $to, empty } = state.selection;
    if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
    if (!dispatch) return true;
    const emptyPara = empty && $from.parent.type === nodes.paragraph && $from.parent.content.size === 0;
    let tr: Transaction;
    let pos: number;
    if (emptyPara && $from.depth >= 1) {
      pos = $from.before();
      tr = state.tr.replaceWith(pos, $from.after(), nodes.math_block.create({ tex: '' }));
    } else {
      const tex = $from.sameParent($to) ? state.doc.textBetween($from.pos, $to.pos, ' ') : '';
      pos = $from.pos;
      tr = state.tr.replaceSelectionWith(nodes.math_inline.create({ tex }), false);
    }
    dispatch(tr.scrollIntoView());
    opened?.(pos);
    return true;
  };
}

// A picture, at the cursor (in place of any selection).
export function insertImage(src: string, alt: string): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.inlineContent || $from.parent.type.spec.code) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(nodes.image.create({ src, alt }), false).scrollIntoView());
    return true;
  };
}
