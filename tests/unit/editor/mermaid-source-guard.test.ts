// A diagram's source is only ever changed by the visual editor (or by
// undo/redo of its edits). Keyboard commands next to a diagram used to
// reach the hidden source: Delete at the end of the paragraph before a
// diagram erased its whole source.
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import type { EditorView } from 'prosemirror-view';
import { createEditorView } from '../../../src/lib/editor/view';
import { MERMAID_EDIT_META } from '../../../src/lib/editor/mermaid-source-guard';

const MD = '# T\n\nBefore para.\n\n```mermaid\nsequenceDiagram\n    A->>B: one\n    B->>A: two\n```\n\nAfter para.\n';
const SOURCE = 'sequenceDiagram\n    A->>B: one\n    B->>A: two';

let view: EditorView | null = null;
let parent: HTMLElement | null = null;
afterEach(() => {
  view?.destroy();
  parent?.remove();
  view = null;
});

function setup(): EditorView {
  parent = document.createElement('div');
  document.body.appendChild(parent);
  view = createEditorView(parent, MD, () => {});
  return view;
}

function mermaidBlock(v: EditorView): { pos: number; text: string } | null {
  let found: { pos: number; text: string } | null = null;
  v.state.doc.descendants((n, pos) => {
    if (n.type.name === 'code_block') found = { pos, text: n.textContent };
    return !found;
  });
  return found;
}

function caretIn(v: EditorView, text: string, at: 'start' | 'end'): void {
  let target = -1;
  v.state.doc.descendants((n, pos) => {
    if (n.isTextblock && n.textContent === text) target = at === 'start' ? pos + 1 : pos + 1 + n.content.size;
    return target < 0;
  });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, target)));
}

function press(v: EditorView, key: string): boolean {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return !!v.someProp('handleKeyDown', (f) => f(v, ev));
}

describe('mermaid source guard', () => {
  it('Delete at the end of the paragraph before a diagram selects the diagram instead of eating its source', () => {
    const v = setup();
    caretIn(v, 'Before para.', 'end');
    press(v, 'Delete');
    expect(mermaidBlock(v)?.text).toBe(SOURCE);
    expect(v.state.selection).toBeInstanceOf(NodeSelection);
    expect((v.state.selection as NodeSelection).node.type.name).toBe('code_block');
    // A second Delete removes the whole diagram (like a selected picture
    // in a word processor) — still never a partial edit.
    press(v, 'Delete');
    expect(mermaidBlock(v)).toBeNull();
    expect(v.state.doc.textContent).toContain('Before para.');
    expect(v.state.doc.textContent).toContain('After para.');
  });

  it('Backspace at the start of the paragraph after a diagram selects the diagram', () => {
    const v = setup();
    caretIn(v, 'After para.', 'start');
    press(v, 'Backspace');
    expect(mermaidBlock(v)?.text).toBe(SOURCE);
    expect(v.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('Backspace in an empty paragraph after a diagram removes the paragraph and selects the diagram', () => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    const v = (view = createEditorView(parent, '# T\n\n```mermaid\nflowchart TD\nA --> B\n```\n\nAfter.\n', () => {}));
    // Make an empty paragraph right after the diagram.
    caretIn(v, 'After.', 'start');
    v.dispatch(v.state.tr.split(v.state.selection.from));
    const before = v.state.doc.childCount;
    caretIn(v, '', 'start');
    press(v, 'Backspace');
    expect(v.state.doc.childCount).toBe(before - 1);
    expect(v.state.selection).toBeInstanceOf(NodeSelection);
    expect(mermaidBlock(v)?.text).toBe('flowchart TD\nA --> B');
  });

  it('rejects any other transaction that changes diagram text', () => {
    const v = setup();
    const b = mermaidBlock(v)!;
    // e.g. what a native DOM edit inside the hidden source would produce
    v.dispatch(v.state.tr.insertText('X', b.pos + 5));
    expect(mermaidBlock(v)?.text).toBe(SOURCE);
    // a join that glues two source lines together
    const nl = b.pos + 1 + SOURCE.indexOf('\n    B->>A');
    v.dispatch(v.state.tr.delete(nl, nl + 5));
    expect(mermaidBlock(v)?.text).toBe(SOURCE);
  });

  it('lets the visual editor (tagged transactions) and undo through', () => {
    const v = setup();
    const b = mermaidBlock(v)!;
    const tr = v.state.tr.insertText(' and more', b.pos + 1 + SOURCE.indexOf('one') + 3);
    tr.setMeta(MERMAID_EDIT_META, true);
    v.dispatch(tr);
    expect(mermaidBlock(v)?.text).toContain('one and more');
    undo(v.state, v.dispatch);
    expect(mermaidBlock(v)?.text).toBe(SOURCE);
  });

  it('still allows removing a diagram as a whole, and editing other text', () => {
    const v = setup();
    caretIn(v, 'After para.', 'end');
    v.dispatch(v.state.tr.insertText('!'));
    expect(v.state.doc.textContent).toContain('After para.!');
    const b = mermaidBlock(v)!;
    const node = v.state.doc.nodeAt(b.pos)!;
    v.dispatch(v.state.tr.delete(b.pos, b.pos + node.nodeSize));
    expect(mermaidBlock(v)).toBeNull();
  });
});
