import { describe, it, expect } from 'vitest';
import { undo } from 'prosemirror-history';
import { createEditorView } from '../../../src/lib/editor/view';

// Tabs keep the editor's EditorState when the user switches away and back.
// A view rebuilt from that state must carry the document, the selection and
// the undo history.
describe('createEditorView with a restored state', () => {
  it('keeps content and undo history across a destroy / recreate', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const v1 = createEditorView(host, 'Hello\n', () => {});
    v1.dispatch(v1.state.tr.insertText(' world', v1.state.doc.content.size - 1));
    expect(v1.state.doc.textContent).toBe('Hello world');
    const saved = v1.state;
    v1.destroy();

    // The markdown argument is stale on purpose: the restored state wins.
    const v2 = createEditorView(host, 'Hello\n', () => {}, saved);
    expect(v2.state.doc.textContent).toBe('Hello world');
    expect(undo(v2.state, v2.dispatch)).toBe(true);
    expect(v2.state.doc.textContent).toBe('Hello');
    v2.destroy();
    host.remove();
  });

  it('still reports changes through the new onChange callback', () => {
    const host = document.createElement('div');
    const v1 = createEditorView(host, 'A\n', () => {});
    const saved = v1.state;
    v1.destroy();
    const seen: string[] = [];
    const v2 = createEditorView(host, 'A\n', (md) => seen.push(md), saved);
    v2.dispatch(v2.state.tr.insertText('B', 1));
    expect(seen.at(-1)).toContain('BA');
    v2.destroy();
  });
});
