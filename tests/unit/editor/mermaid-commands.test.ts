import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { insertMermaid } from '../../../src/lib/editor/mermaid-commands';

describe('insertMermaid command', () => {
  it('inserts an empty mermaid code_block at the current paragraph', () => {
    const doc = parseMarkdownToDoc('hello\n');
    let state = EditorState.create({ doc, schema: editorSchema });
    let dispatched = false;
    insertMermaid()(state, (tr) => {
      state = state.apply(tr);
      dispatched = true;
    });
    expect(dispatched).toBe(true);
    let firstBlock: { type: { name: string }; attrs: { language: unknown }; textContent: string } | null = null;
    state.doc.descendants((n) => {
      if (n.type.name === 'code_block' && firstBlock === null) {
        firstBlock = n as never;
      }
    });
    expect(firstBlock).not.toBeNull();
    expect(firstBlock!.attrs.language).toBe('mermaid');
    expect(firstBlock!.textContent).toBe('flowchart TD\n');
  });

  it('returns false when called inside an existing code_block', () => {
    const doc = parseMarkdownToDoc('```mermaid\nflowchart TD\n```\n');
    const state = EditorState.create({ doc, schema: editorSchema });
    const ok = insertMermaid()(state, () => {});
    expect(ok).toBe(false);
  });
});
